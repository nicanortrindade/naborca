// supabase/functions/import-parse-worker/index.ts
// ============================================================================
// NABOORÇA • PARSE WORKER
// Handles AI Parsing with robust 429 Fallback to Deterministic parsing
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

// --- ENV VARS ---
const SUPABASE_DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
// INTERNAL OCR ENV (Optional now since we default to existing text)
const OCR_SERVICE_URL = Deno.env.get("OCR_SERVICE_URL") ?? "";
const OCR_SERVICE_TIMEOUT_MS = parseInt(Deno.env.get("OCR_SERVICE_TIMEOUT_MS") ?? "30000");

// --- TYPES ---
type TaskStatus = "queued" | "dispatched" | "done" | "failed";

// --- HELPERS ---
function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function parseBRNumber(value: any): number | null {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    let clean = value.trim();
    if (!clean) return null;
    clean = clean.replace(/[R$\s]/g, "");
    if (clean.includes(",") && clean.includes(".")) {
        clean = clean.replace(/\./g, "").replace(",", ".");
    } else if (clean.includes(",")) {
        clean = clean.replace(",", ".");
    }
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? null : parsed;
}

// DETERMINISTIC PARSER (FALLBACK)
function parseDeterministic(text: string) {
    const lines = text.split(/\r?\n/);
    const items: any[] = [];
    let summary = "Deterministic Parse (Fallback caused by AI Quota/429)\n";

    // Regex for common units in construction
    // m, m2, m3, un, vb, cj, gl, pç, par, kg, l, t, kw, h, mes
    const unitsRaw = "m|m2|m3|m²|m³|un|unid|und|kg|l|cj|vb|h|mes|t|gl|pç|par|sc|kwh|km";
    const unitRegex = new RegExp(`\\b(${unitsRaw})\\b`, "i");

    for (const line of lines) {
        const clean = line.trim();
        if (clean.length < 5) continue;
        if (/^page \d+$/i.test(clean)) continue; // ignore page headers

        const tokens = clean.split(/\s+/);
        if (tokens.length < 3) continue;

        // Try to find the Unit
        let unitIndex = -1;
        let unitStr = "";

        // Scan from right to left to find the unit (usually near end)
        for (let i = tokens.length - 1; i >= 0; i--) {
            if (unitRegex.test(tokens[i])) {
                unitIndex = i;
                unitStr = tokens[i];
                break;
            }
        }

        if (unitIndex > 0) {
            // Numbers usually appear AFTER the unit (Quantity, UnitPrice, Total)
            // or sometimes BEFORE (Quantity Unit)
            // Let's assume standard budget line:  CODE DESCRIPTION UNIT QTY PRICE TOTAL

            const after = tokens.slice(unitIndex + 1);
            const nums = after.map(t => parseBRNumber(t)).filter(n => n !== null) as number[];

            // Heuristic A: Unit is followed by QTY and PRICE
            if (nums.length >= 1) {
                const description = tokens.slice(0, unitIndex).join(" ");
                // If description is too short, might be noise
                if (description.length > 2) {
                    const quantity = nums[0];
                    const unit_price = nums.length >= 2 ? nums[1] : 0; // If only 1 num, assume it's Qty, Price 0

                    items.push({
                        description,
                        unit: unitStr,
                        quantity,
                        unit_price
                    });
                }
            }
            // Heuristic B: Sometimes QTY is before Unit. E.g. "10.0 m2 Wall Painting"
            // (Less common in Brazilian tables unless extracted oddly, skipping for now to keep it simple)
        }
    }

    summary += `Extracted ${items.length} items using regex heuristics.`;
    return { items, summary };
}

// Gemini logic (Concurrency=1 via sequential loop)
async function callGemini(model: string, prompt: string, apiKey: string) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { response_mime_type: "application/json" }
        }),
    });

    if (!response.ok) {
        let errText = await response.text();
        // Check for 429 signatures
        if (response.status === 429 ||
            errText.includes("RESOURCE_EXHAUSTED") ||
            errText.includes("User has exceeded") ||
            errText.includes("quota")
        ) {
            throw new Error("GEMINI_429");
        }
        throw new Error(`Gemini Error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("GEMINI_EMPTY_RESPONSE");
    return JSON.parse(text);
}

// Update task helper
async function updateTaskStatus(
    supabase: SupabaseClient,
    taskId: string,
    updates: any
) {
    const payload: any = { ...updates, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("import_parse_tasks").update(payload).eq("id", taskId);
    if (error) console.error(`[WORKER] updateTaskStatus fail: ${error.message}`);
}

// --- WORKER MAIN ---
serve(async (req: Request) => {
    const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;

    if (!SUPABASE_DB_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        console.error("[WORKER] missing_env");
        return jsonResponse({ error: "missing_env" }, 500);
    }

    const body = await req.json().catch((err) => null);
    if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

    const taskId = body.task_id ?? body.taskId ?? body.id ?? null;
    if (!taskId) return jsonResponse({ error: "missing_task_id" }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false }
    });

    let lockedTask: any = null;

    // 1. SQL LOCK
    try {
        const client = new Client(SUPABASE_DB_URL);
        await client.connect();

        try {
            const timeLimit = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            // Try to lock a queued task
            const result = await client.queryObject`
                UPDATE public.import_parse_tasks
                SET status = 'dispatched',
                    locked_at = now(),
                    locked_by = ${workerId},
                    updated_at = now()
                WHERE id = ${taskId}
                  AND status = 'queued'
                  AND (locked_at IS NULL OR locked_at < ${timeLimit})
                RETURNING id, job_id, file_id, attempts, max_attempts;
            `;

            if (result.rows.length === 0) {
                console.warn(`[WORKER ${workerId}] lock_sql_not_acquired task_id=${taskId}`);
                await client.end();
                return jsonResponse({ error: "lock_not_acquired" }, 409);
            }

            lockedTask = result.rows[0];
            console.log(`[WORKER ${workerId}] lock_sql_acquired task_id=${taskId}`);

        } finally {
            await client.end();
        }

    } catch (dbErr: any) {
        console.error(`[WORKER ${workerId}] SQL connection/query error: ${dbErr.message}`);
        return jsonResponse({ error: "db_connection_failed", details: dbErr.message }, 500);
    }

    // 2. CONTEXT & PREP
    const job_id = lockedTask.job_id;
    const file_id = lockedTask.file_id;

    // Write-early to prove we are alive
    await supabase.from("import_ai_summaries").insert({
        job_id: job_id,
        import_file_id: file_id,
        header: {
            kind: "worker_started",
            task_id: taskId,
            worker_id: workerId,
            ts: new Date().toISOString()
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });

    // 3. DATA FETCHING
    let textToProcess = "";
    let structureSource = "synthetic";
    let job: any = null;

    try {
        const { data: files } = await supabase.from("import_files").select("*").eq("job_id", job_id);
        const { data: jobData } = await supabase.from("import_jobs").select("*").eq("id", job_id).single();
        job = jobData;

        if (!files || !job) throw new Error("Missing job/files context");

        const targetFile = files.find((f: any) => f.id === file_id);
        const synthetic = files.find((f: any) => f.role === "synthetic");
        const analytic = files.find((f: any) => f.role === "analytic");

        if (!targetFile) throw new Error("FATAL:Target file missing");

        // Determine Text Source
        if (targetFile.role === "synthetic") {
            const sText = targetFile.extracted_text || "";
            if (sText.length >= 50) {
                textToProcess = sText;
                structureSource = "synthetic";
            } else {
                const aText = analytic?.extracted_text || "";
                if (aText.length >= 50) {
                    textToProcess = aText;
                    structureSource = "analytic_fallback";
                    // Update job context to reflect fallback source
                    await supabase.from("import_jobs").update({
                        document_context: { ...(job.document_context || {}), structure_source: "analytic_fallback" }
                    }).eq("id", job_id);
                } else {
                    throw new Error("FATAL:OCR_TEXT_MISSING");
                }
            }
        } else {
            textToProcess = targetFile.extracted_text || "";
            structureSource = targetFile.role;
        }

        // 4. GEMINI PROCESSING
        if (!GEMINI_API_KEY) throw new Error("FATAL:Missing GEMINI_API_KEY");

        const CHUNK_SIZE = 14000;
        const chunks: string[] = [];
        for (let i = 0; i < textToProcess.length; i += CHUNK_SIZE) {
            chunks.push(textToProcess.substring(i, i + CHUNK_SIZE));
            if (chunks.length > 50) break;
        }

        console.log(`[WORKER ${workerId}] processing chunks=${chunks.length} model=gemini-2.0-flash`);

        const allItems: any[] = [];
        let fullSummary = "";

        for (const chunk of chunks) {
            let attempts = 0;
            let success = false;
            while (!success && attempts < 3) {
                try {
                    if (attempts > 0) await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempts))); // Backoff

                    const prompt = `Extract construction budget items from text. Return VALID JSON ONLY. { "items": [{"description": string, "unit": string, "quantity": number, "unit_price": number}], "summary": string } \n TEXT: ${chunk}`;
                    const res = await callGemini("gemini-2.0-flash", prompt, GEMINI_API_KEY);
                    if (res.items) allItems.push(...res.items);
                    if (res.summary) fullSummary += res.summary + "\n";
                    success = true;
                } catch (e: any) {
                    // CRITICAL: If 429, rethrow immediately to escape the loop and trigger fallback
                    if (e.message.includes("GEMINI_429")) throw e;

                    console.warn(`[WORKER] Chunk fail attempt ${attempts}: ${e.message}`);
                    attempts++;
                }
            }
        }

        // 5. SUCCESSFUL AI PARSE PERSISTENCE
        const rows = allItems.map((item, idx) => ({
            job_id,
            import_file_id: file_id,
            idx: idx + 1,
            description: (item.description || "").trim(),
            unit: item.unit,
            quantity: parseBRNumber(item.quantity) || 0,
            unit_price: parseBRNumber(item.unit_price) || 0,
            total: (parseBRNumber(item.quantity) || 0) * (parseBRNumber(item.unit_price) || 0),
            confidence: 0.8
        })).filter(r => r.description.length > 0);

        if (rows.length > 0) {
            // Batch insert
            const { error: insErr } = await supabase.from("import_ai_items").insert(rows);
            if (insErr) throw new Error(`FATAL:Item Insert Failed: ${insErr.message}`);
        }

        // Success Summary
        await supabase.from("import_ai_summaries").insert({
            job_id,
            import_file_id: file_id,
            header: {
                kind: "structure_final",
                structure_source,
                completed_at: new Date().toISOString(),
                notes_content: fullSummary || "AI Done.",
                items_count: rows.length
            },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

        // Mark Task DONE
        await updateTaskStatus(supabase, taskId, {
            status: "done",
            result: { items: rows.length, chunks: chunks.length, mode: 'ai' },
            locked_at: null,
            locked_by: null,
            last_error: null
        });

        // Check Job Completion
        const { data: others } = await supabase.from("import_parse_tasks").select("status").eq("job_id", job_id);
        if (others && others.every((t: any) => t.status === 'done' || t.status === 'failed')) {
            await supabase.from("import_jobs").update({
                document_context: { ...(job.document_context || {}), parse_complete: true, parse_completed_at: new Date().toISOString() }
            }).eq("id", job_id);
        }

        return jsonResponse({ status: "success", items: rows.length });

    } catch (e: any) {
        console.error(`[WORKER ${workerId}] ERROR: ${e.message}`);
        if (!taskId) return jsonResponse({ error: e.message }, 500);

        const msg = e.message || "Unknown error";

        // ===========================================
        // FALLBACK HANDLER FOR GEMINI_429
        // ===========================================
        if (msg.includes("GEMINI_429")) {
            console.log(`[WORKER] gemini_429 detected task_id=${taskId}, switching to deterministic fallback`);

            try {
                // Ensure we have deterministic items to save
                // We use textToProcess which we loaded earlier. 
                // If we failed before loading textKey, we can't do much (checked by OCR_TEXT_MISSING FATAL above)

                // 1. Mark Job Context
                await supabase.from("import_jobs").update({
                    document_context: {
                        ...(job?.document_context || {}),
                        ai_mode: 'deterministic_fallback',
                        reason: 'gemini_429'
                    }
                }).eq("id", job_id);

                // 2. Deterministic Parse
                const { items: detItems, summary: detSummary } = parseDeterministic(textToProcess);
                console.log(`[WORKER] deterministic parsed items=${detItems.length}`);

                // 3. Persist Items
                const rows = detItems.map((item, idx) => ({
                    job_id,
                    import_file_id: file_id,
                    idx: idx + 1,
                    description: item.description,
                    unit: item.unit,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    total: (item.quantity || 0) * (item.unit_price || 0),
                    confidence: 0.5
                }));

                if (rows.length > 0) {
                    const { error: insErr } = await supabase.from("import_ai_items").insert(rows);
                    if (insErr) console.error(`[WORKER] deterministic insert fail: ${insErr.message}`);
                }

                // 4. Summaries - Explicitly stating fallback
                await supabase.from("import_ai_summaries").insert({
                    job_id,
                    import_file_id: file_id,
                    header: {
                        kind: "structure_final",
                        structure_source: "deterministic_fallback",
                        completed_at: new Date().toISOString(),
                        notes_content: detSummary,
                        items_count: rows.length,
                        reason: 'gemini_429_quota'
                    },
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });

                // 5. SUCCESS - Mark DONE (Do NOT retry)
                await updateTaskStatus(supabase, taskId, {
                    status: "done",
                    result: { items: rows.length, mode: 'deterministic_fallback' },
                    locked_at: null,
                    locked_by: null,
                    last_error: null // Clear error since we handled it
                });

                // Check completion
                const { data: others } = await supabase.from("import_parse_tasks").select("status").eq("job_id", job_id);
                if (others && others.every((t: any) => t.status === 'done' || t.status === 'failed')) {
                    await supabase.from("import_jobs").update({
                        document_context: { ...(job?.document_context || {}), parse_complete: true, parse_completed_at: new Date().toISOString() }
                    }).eq("id", job_id);
                }

                return jsonResponse({ status: "success", mode: "deterministic_fallback", items: rows.length });

            } catch (fallbackErr: any) {
                console.error("[WORKER] Deterministic Fallback Exception", fallbackErr);
                // If fallback fails, we DO want to fail the task, not retry Gemini 429
                // But we don't want to retry parsing either if it's code error
                await updateTaskStatus(supabase, taskId, {
                    status: "failed", // Fatal failure in fallback
                    last_error: `FALLBACK_FAILED: ${fallbackErr.message}`,
                    locked_at: null,
                    locked_by: null
                });
                return jsonResponse({ error: "fallback_failed" }, 200);
            }
        }

        // ===========================================
        // STANDARD ERROR HANDLING (RETRY/FAIL)
        // ===========================================
        let nextStatus: TaskStatus = "failed";
        let errorLabel = msg;

        if (msg.includes("FATAL")) {
            nextStatus = "failed";
        } else {
            // Transient errors (Network, 500s, etc) - Retry
            const { data: tCheck } = await supabase.from("import_parse_tasks").select("attempts, max_attempts").eq("id", taskId).single();
            if ((tCheck?.attempts || 0) < (tCheck?.max_attempts || 5)) {
                nextStatus = "queued";
                errorLabel = `TRANSIENT: ${msg}`;
            }
        }

        await updateTaskStatus(supabase, taskId, {
            status: nextStatus,
            last_error: errorLabel,
            attempts: (nextStatus === "queued") ? ((await supabase.from("import_parse_tasks").select("attempts").eq("id", taskId).single()).data?.attempts || 0) + 1 : undefined,
            locked_at: null,
            locked_by: null
        });

        return jsonResponse({ ok: false, error: msg }, 200);
    }
});
