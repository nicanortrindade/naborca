import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Type shim for EdgeRuntime auto-continue
declare const EdgeRuntime: any;

const WORKER_ID = `hydration-${crypto.randomUUID().split("-")[0]}`;
const BATCH_SIZE = 20;
const MAX_RETRIES = 3;

Deno.serve(async (req) => {
    const requestId = crypto.randomUUID().split("-")[0];
    console.log(`[HYDRATION-WORKER] [${requestId}] Started ${WORKER_ID}`);

    try {
        const body = await req.json().catch(() => ({}));
        const { budget_id, job_id, user_id, uf, competence, desonerado, _retry_count } = body;

        if (!budget_id || !job_id || !user_id) {
            console.error(`[HYDRATION-WORKER] Missing required fields: budget_id=${budget_id}, job_id=${job_id}, user_id=${user_id}`);
            return new Response(JSON.stringify({ ok: false, reason: "missing_required_fields" }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        const retryCount: number = typeof _retry_count === "number" ? _retry_count : 0;
        console.log(`[HYDRATION-WORKER] Processing: budget=${budget_id}, job=${job_id}, retry=${retryCount}`);

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Chamar RPC process_hydration_batch
        const { data: batchResult, error: batchError } = await supabase.rpc("process_hydration_batch", {
            p_budget_id: budget_id,
            p_job_id: job_id,
            p_user_id: user_id,
            p_uf: uf ?? "BA",
            p_competence: competence ?? null,
            p_desonerado: desonerado !== false, // default true
            p_batch_size: BATCH_SIZE
        });

        if (batchError) {
            const errMsg = batchError.message ?? JSON.stringify(batchError);
            console.error(`[HYDRATION-WORKER] RPC Error:`, errMsg);

            // Retry logic
            if (retryCount < MAX_RETRIES) {
                console.warn(`[HYDRATION-WORKER] Retrying (${retryCount + 1}/${MAX_RETRIES})...`);
                const nextPayload = { budget_id, job_id, user_id, uf, competence, desonerado, _retry_count: retryCount + 1 };

                EdgeRuntime.waitUntil(
                    fetch(`${SUPABASE_URL}/functions/v1/hydration-worker`, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                            "Content-Type": "application/json",
                            "x-internal-call": "true"
                        },
                        body: JSON.stringify(nextPayload)
                    })
                );

                return new Response(JSON.stringify({ status: "retry_scheduled", retry: retryCount + 1 }), {
                    headers: { "Content-Type": "application/json" }
                });
            }

            // Max retries exhausted: marcar job como falha de hydration
            await supabase
                .from("import_jobs")
                .update({ stage: "hydration_failed", updated_at: new Date().toISOString() })
                .eq("id", job_id);

            return new Response(JSON.stringify({ status: "failed", reason: errMsg }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }

        const processed: number = batchResult?.processed ?? 0;
        const remaining: number = batchResult?.remaining ?? 0;
        const isComplete: boolean = batchResult?.is_complete === true;

        console.log(`[HYDRATION-WORKER] Batch done: processed=${processed}, remaining=${remaining}, is_complete=${isComplete}`);

        if (isComplete) {
            // Hydration finalizada! job.stage já foi marcado como 'finalized' pelo RPC.
            console.log(`[HYDRATION-WORKER] All items hydrated! Job ${job_id} is now FINALIZED.`);
            return new Response(JSON.stringify({
                status: "finalized",
                budget_id,
                job_id,
                stats: {
                    processed: batchResult?.processed,
                    hydrated_a: batchResult?.hydrated_a,
                    hydrated_b: batchResult?.hydrated_b
                }
            }), { headers: { "Content-Type": "application/json" } });
        }

        // Ainda há itens — auto-redispatch para próximo lote (fire-and-forget)
        console.log(`[HYDRATION-WORKER] Scheduling next batch (${remaining} remaining)...`);
        const nextPayload = { budget_id, job_id, user_id, uf, competence, desonerado, _retry_count: 0 };

        EdgeRuntime.waitUntil(
            fetch(`${SUPABASE_URL}/functions/v1/hydration-worker`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    "Content-Type": "application/json",
                    "x-internal-call": "true"
                },
                body: JSON.stringify(nextPayload)
            })
        );

        return new Response(JSON.stringify({
            status: "continued",
            processed,
            remaining
        }), { headers: { "Content-Type": "application/json" } });

    } catch (err: any) {
        console.error(`[HYDRATION-WORKER] Fatal error: ${err.message}`, err);
        return new Response(JSON.stringify({ ok: false, reason: "internal_error", details: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
});
