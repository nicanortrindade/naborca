
// supabase/functions/import-extract-retry-sweep/index.ts
// ============================================================================
// NABOORÇA • RETRY SWEEP — Edge Function (Deno)
// Função: import-extract-retry-sweep
// 
// RESPONSAIBILIDADES:
// 1. Executa o watchdog para identificar jobs travados.
// 2. Busca jobs marcados como extraction_retryable que atingiram o next_retry_at.
// 3. Re-dispara o import-extract-worker para cada um.
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

serve(async (req) => {
    // CORS
    if (req.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "access-control-allow-origin": "*",
                "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
                "access-control-allow-methods": "POST, GET, OPTIONS",
            },
        });
    }

    const requestId = crypto.randomUUID();
    console.log(`[SWEEP ${requestId}] Starting sweep...`);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return jsonResponse({ error: "Server misconfigured (env)" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
    });

    try {
        // 1. RODAR WATCHDOG
        console.log(`[SWEEP ${requestId}] Running watchdog...`);
        const { data: watchdogStuckCount, error: watchdogErr } = await supabase.rpc('import_extraction_watchdog');
        let stuckMarked = 0;
        if (watchdogErr) {
            console.warn(`[SWEEP ${requestId}] Watchdog warning:`, watchdogErr.message);
        } else {
            stuckMarked = Number(watchdogStuckCount) || 0;
            console.log(`[SWEEP ${requestId}] Watchdog caught ${stuckMarked} stuck jobs.`);
        }

        // 2. BUSCAR JOBS (NOVOS + RETRIES)
        const jobs = [];

        // 2a. Novos jobs (extraction_queued)
        const { data: newJobs, error: newJobsErr } = await supabase
            .from('import_jobs')
            .select('job_id:id')
            .eq('stage', 'extraction_queued')
            .neq('status', 'failed')
            .limit(10);

        if (newJobsErr) {
            console.error(`[SWEEP ${requestId}] Error fetching new jobs:`, newJobsErr);
        } else if (newJobs) {
            jobs.push(...newJobs);
        }

        // 2b. Retries (se houver espaço)
        if (jobs.length < 10) {
            const limitRetries = 10 - jobs.length;
            // Usando query direta em vez de RPC para flexibilidade
            const { data: retryJobs, error: retryErr } = await supabase
                .from('import_jobs')
                .select('job_id:id')
                .eq('extraction_retryable', true)
                .lte('extraction_next_retry_at', new Date().toISOString())
                .neq('status', 'failed')
                .order('extraction_next_retry_at', { ascending: true })
                .limit(limitRetries);

            if (retryErr) {
                console.error(`[SWEEP ${requestId}] Error fetching retries:`, retryErr);
            } else if (retryJobs) {
                jobs.push(...retryJobs);
            }
        }

        if (!jobs || jobs.length === 0) {
            console.log(`[SWEEP ${requestId}] No pending retries found.`);
            return jsonResponse({ ok: true, stuck_marked: stuckMarked, dispatched: 0, message: "No jobs to retry" });
        }

        console.log(`[SWEEP ${requestId}] Found ${jobs.length} jobs to retry.`);

        const results = [];
        let dispatchedCount = 0;

        // 3. DISPARAR WORKER PARA CADA JOB
        for (const job of jobs) {
            console.log(`[SWEEP ${requestId}] Re-dispatching job=${job.job_id}`);

            try {
                // Tenta resetar estado via RPC reprocess_extraction
                const { data: reprocessData, error: reprocessErr } = await supabase.rpc('reprocess_extraction', {
                    p_job_id: job.job_id
                });

                if (reprocessErr) {
                    console.error(`[SWEEP ${requestId}] Error resetting job=${job.job_id}:`, reprocessErr);
                    results.push({ job_id: job.job_id, status: "error_resetting", error: reprocessErr.message });
                    continue;
                }

                // Invocação assíncrona do worker
                // Usamos o cabeçalho 'X-Client-Info' para indicar que foi disparado pelo sweep
                const { error: invokeErr } = await supabase.functions.invoke("import-extract-worker", {
                    body: { job_id: job.job_id }
                });

                if (invokeErr) {
                    console.error(`[SWEEP ${requestId}] Worker invoke error for job=${job.job_id}:`, invokeErr);
                    results.push({ job_id: job.job_id, status: "invoke_error", error: invokeErr.message });
                } else {
                    dispatchedCount++;
                    results.push({ job_id: job.job_id, status: "dispatched" });
                }
            } catch (jobErr: any) {
                console.error(`[SWEEP ${requestId}] Exception for job=${job.job_id}:`, jobErr.message);
                results.push({ job_id: job.job_id, status: "exception", error: jobErr.message });
            }
        }

        return jsonResponse({
            ok: true,
            stuck_marked: stuckMarked,
            dispatched: dispatchedCount,
            total_processed: results.length,
            results: results.slice(0, 10)
        });

    } catch (err: any) {
        console.error(`[SWEEP ${requestId}] Critical error:`, err.message);
        return jsonResponse({ error: "Sweep failed", details: err.message }, 500);
    }
});
