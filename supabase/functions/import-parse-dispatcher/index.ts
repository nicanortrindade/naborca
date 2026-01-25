// supabase/functions/import-parse-dispatcher/index.ts
// ============================================================================
// NABOORÇA • DISPATCHER DE PARSE TASKS — Edge Function (Deno)
// Função: import-parse-dispatcher
// 
// QUANDO USAR:
// Esta função é uma ALTERNATIVA ao dispatcher via pg_net.
// Use quando pg_net NÃO estiver habilitado no seu projeto Supabase.
//
// COMO FUNCIONA:
// 1. Esta função é chamada periodicamente (cron externo, cloud scheduler, etc.)
// 2. Busca tasks pendentes via RPC get_pending_parse_tasks
// 3. Para cada task, invoca a Edge Function import-parse-worker
// 4. Retorna status do dispatch
//
// INVOCAÇÃO:
// POST sem body, ou GET
// Header: Authorization: Bearer <service_role_key>
//
// NOTA: Para automatizar, configure um trigger externo (Cloudflare Worker,
// GitHub Actions scheduled, ou outro serviço de cron que chame esta função).
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body, null, 2), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
        },
    });
}

function corsPreflight() {
    return new Response(null, {
        status: 204,
        headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
            "access-control-allow-methods": "POST, GET, OPTIONS",
        },
    });
}

serve(async (req) => {
    if (req.method === "OPTIONS") return corsPreflight();

    const requestId = crypto.randomUUID();
    console.log(`[DISPATCHER ${requestId}] Start`);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return jsonResponse({ error: "Server misconfigured (Supabase env)" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
    });

    try {
        // Buscar tasks pendentes via RPC
        const { data: tasks, error: rpcError } = await supabase.rpc("get_pending_parse_tasks", {
            max_tasks: 2,
        });

        if (rpcError) {
            console.error(`[DISPATCHER ${requestId}] RPC error:`, rpcError);
            return jsonResponse({ error: "Failed to get pending tasks", details: rpcError.message }, 500);
        }

        if (!tasks || tasks.length === 0) {
            console.log(`[DISPATCHER ${requestId}] No pending tasks`);
            return jsonResponse({ ok: true, dispatched: 0, message: "No pending tasks" });
        }

        console.log(`[DISPATCHER ${requestId}] Found ${tasks.length} tasks to dispatch`);

        const results: Array<{ task_id: string; status: string; error?: string }> = [];

        // Dispatch each task
        for (const task of tasks) {
            console.log(`[DISPATCHER ${requestId}] Dispatching task=${task.task_id}`);

            try {
                // Invoke import-parse-worker
                const { data, error } = await supabase.functions.invoke("import-parse-worker", {
                    body: {
                        task_id: task.task_id,
                        job_id: task.job_id,
                        file_id: task.file_id,
                    },
                });

                if (error) {
                    console.error(`[DISPATCHER ${requestId}] Worker invoke error for task=${task.task_id}:`, error);
                    results.push({
                        task_id: task.task_id,
                        status: "invoke_error",
                        error: error.message || String(error),
                    });

                    // Mark task as failed if invoke failed
                    await supabase.rpc("mark_parse_task_failed", {
                        p_task_id: task.task_id,
                        p_error: `Dispatcher invoke error: ${error.message || String(error)}`,
                    });
                } else {
                    console.log(`[DISPATCHER ${requestId}] Worker invoked for task=${task.task_id}`);
                    results.push({
                        task_id: task.task_id,
                        status: "dispatched",
                    });
                }
            } catch (invokeErr: unknown) {
                const errMsg = invokeErr instanceof Error ? invokeErr.message : String(invokeErr);
                console.error(`[DISPATCHER ${requestId}] Exception dispatching task=${task.task_id}:`, errMsg);
                results.push({
                    task_id: task.task_id,
                    status: "exception",
                    error: errMsg,
                });
            }
        }

        console.log(`[DISPATCHER ${requestId}] Dispatch complete. Results:`, results);

        return jsonResponse({
            ok: true,
            dispatched: results.filter((r) => r.status === "dispatched").length,
            results,
        });
    } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[DISPATCHER ${requestId}] Critical error:`, errMsg);
        return jsonResponse({ error: "Dispatcher failed", message: errMsg }, 500);
    }
});
