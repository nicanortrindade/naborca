// supabase/functions/import-parse-dispatcher/index.ts
// ============================================================================
// NABOORÇA • DISPATCHER (PURE STATELESS + BACKOFF)
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// --- CONFIG ---
const DB_FETCH_LIMIT = 50;
const MAX_TASKS_PER_TICK = 10;

// Backoff config
const BACKOFF_DEFAULT_MIN = 5;
const BACKOFF_429_MIN = 1; // 60s for 429/Fallback scenarios

// --- HELPERS ---
function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
        },
    });
}

// --- MAIN ---
serve(async (req: Request) => {
    const dispatchId = `dispatch-${crypto.randomUUID().slice(0, 6)}`;
    console.log(`[DISPATCH ${dispatchId}] tick`);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        console.error(`[DISPATCH ${dispatchId}] missing env SUPABASE_URL or SERVICE_ROLE_KEY`);
        return jsonResponse({ error: "Server misconfigured (Env)" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
    });

    try {
        // 1. SELECT ELIGIBLE TASKS
        // Criteria: 
        // - status 'queued' 
        // - attempts < max
        // - BACKOFF: updated_at check depending on last_error

        // We fetch a bit more to filter in memory for complex backoff logic
        // Because "last_error" might need checking.
        // Or we use a safe common denominator (1 min) in DB and filter 5 min in memory?
        // Let's rely on DB for the base 1 min (minimum backoff) and filter specifically for 5 min default.

        const minBackoffThreshold = new Date(Date.now() - 60000).toISOString(); // 1 min ago

        const { data: tasks, error } = await supabase
            .from("import_parse_tasks")
            .select("id, job_id, file_id, status, locked_at, attempts, max_attempts, updated_at, last_error")
            .eq("status", "queued")
            .lt("updated_at", minBackoffThreshold) // At least 1 min cooldown for everyone
            .order("updated_at", { ascending: true })
            .limit(DB_FETCH_LIMIT);

        if (error) {
            console.error(`[DISPATCH ${dispatchId}] DB Error: ${error.message}`);
            return jsonResponse({ error: error.message }, 500);
        }

        if (!tasks || tasks.length === 0) {
            console.log(`[DISPATCH ${dispatchId}] found 0 (after base backoff)`);
            return jsonResponse({ count: 0, message: "No tasks ready" });
        }

        // 2. FILTER (Memory - Complex Backoff + Lock Expiry)
        const candidates = tasks.filter((t: any) => {
            const max = t.max_attempts || 5;
            if (t.attempts >= max) return false;

            if (t.locked_at) {
                const lockedTime = new Date(t.locked_at).getTime();
                const tenMin = 10 * 60 * 1000;
                if (Date.now() - lockedTime < tenMin) return false;
            }

            // Dynamic Backoff
            // If last_error includes GEMINI_429, we accept the 1 min DB filter (already passed).
            // If OTHER error execution, enforce 5 min.
            // If NULL last_error (new task), 1 min filter is fine (or 0, but updated_at usually old)

            if (t.last_error && !t.last_error.includes("GEMINI_429")) {
                const updatedTime = new Date(t.updated_at).getTime();
                const fiveMin = 5 * 60 * 1000;
                if (Date.now() - updatedTime < fiveMin) return false;
            }

            return true;
        }).slice(0, MAX_TASKS_PER_TICK);

        console.log(`[DISPATCH ${dispatchId}] found ${candidates.length} ready (from ${tasks.length} fetched)`);

        if (candidates.length === 0) {
            return jsonResponse({ count: 0 });
        }

        // 3. INVOKE LOOP (Direct Fetch)
        const results = [];
        const workerUrl = `${SUPABASE_URL}/functions/v1/import-parse-worker`;

        for (const task of candidates) {
            const taskId = task.id;
            console.log(`[DISPATCH ${dispatchId}] invoking worker task_id=${taskId}`);

            try {
                // Direct Fetch Call
                const res = await fetch(workerUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                    },
                    body: JSON.stringify({
                        task_id: taskId,
                        job_id: task.job_id,
                        file_id: task.file_id
                    })
                });

                const status = res.status;
                let bodySnippet = "";
                if (!res.ok || status === 200) {
                    const txt = await res.text();
                    bodySnippet = txt.slice(0, 200);
                }

                console.log(`[DISPATCH ${dispatchId}] worker response task_id=${taskId} status=${status}`);

                results.push({
                    id: taskId,
                    http_status: status,
                    status: res.ok ? 'ok' : 'error',
                    body_snippet: bodySnippet
                });

            } catch (err: any) {
                console.error(`[DISPATCH ${dispatchId}] worker fetch failed task_id=${taskId} err=${err.message}`);
                results.push({ id: taskId, status: "fetch_exception", error: err.message });
            }
        }

        return jsonResponse({
            count: results.length,
            details: results
        });

    } catch (e: any) {
        console.error(`[DISPATCH ${dispatchId}] Fatal: ${e.message}`);
        return jsonResponse({ error: e.message }, 500);
    }
});
