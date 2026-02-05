
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Type shim for EdgeRuntime
declare const EdgeRuntime: any;

// Worker Constants
const WORKER_ID = `worker-${crypto.randomUUID().split('-')[0]}`;
const CHUNK_BATCH_SIZE = 1; // Process 1 chunk per invocation to be safe, or more if fast
const MAX_EXECUTION_TIME_MS = 45000; // Leave buffer for overhead

// Reuse logic from fallback? 
// For now, we will just implement the structure and call the existing logic via import-ocr-fallback 
// OR better: Move the logic here. Since import-ocr-fallback is huge, let's call it with specific range? 
// Actually, moving the "Process Chunk" logic here is cleaner. 
// But copying 2000 lines is risky.
// Strategy: "ocr-worker" acts as the orchestrator. It claims a job, then calls "import-ocr-fallback"
// passing "start_chunk" and "end_chunk". "import-ocr-fallback" will be modified to respect this range.
// This keeps the logic in one place.

serve(async (req) => {
    const requestId = crypto.randomUUID().split('-')[0];
    console.log(`[OCR-WORKER] [${requestId}] Started ${WORKER_ID}`);
    console.log(`[OCR-WORKER] Worker invoked - Internal Only Mode`);

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 1. Recover stale locks
        const { data: recovered } = await supabase.rpc('recover_stale_ocr_locks');
        if (recovered > 0) console.log(`[OCR-WORKER] Recovered ${recovered} stale locks`);

        // 1.5. Cleanup Stale Processing (Watchdog)
        const { data: watchdog } = await supabase.rpc('cleanup_stale_ocr_jobs');
        if (watchdog && (watchdog[0]?.requeued_count > 0 || watchdog[0]?.failed_count > 0)) {
            console.log(`[OCR-WORKER] Watchdog: Requeued=${watchdog[0].requeued_count}, Failed=${watchdog[0].failed_count}`);
        }

        const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

        // 2. Claim Job
        const { data: jobs, error: claimErr } = await supabase.rpc('claim_next_ocr_job', {
            p_worker_id: WORKER_ID
        });

        if (claimErr) throw claimErr;
        if (!jobs || jobs.length === 0) {
            return new Response(JSON.stringify({ status: 'no_work' }), { headers: { "Content-Type": "application/json" } });
        }

        const job = jobs[0]; // One job per run
        console.log(`[OCR-WORKER] Claimed Job ${job.id} (File: ${job.import_file_id}, Next: ${job.next_chunk_index})`);

        let finalStatus = 'pending';
        let finalError = null;
        let finalRetryCount: number | null = null;
        let shouldRedispatch = false;

        try {
            // 2.5: Fetch user_id from parent job (REQUIRED for internal auth)
            const { data: parentJob, error: parentErr } = await supabase
                .from('import_jobs')
                .select('user_id')
                .eq('id', job.job_id)
                .single();

            if (parentErr) {
                console.error(`[OCR-WORKER] Error fetching parent job ${job.job_id}:`, parentErr);
            }

            const userIdToDelegate = parentJob?.user_id;
            const resolvedJobId = job.job_id;
            const resolvedImportFileId = job.import_file_id;

            // VALIDATION GUARD
            const hasValidUser = isUuid(userIdToDelegate);
            const hasValidJobId = isUuid(resolvedJobId);

            if (!hasValidUser || !hasValidJobId) {
                console.error(`[OCR-WORKER] CRITICAL: Valid user_id/job_id missing for job ${job.id}. User=${userIdToDelegate}, Job=${resolvedJobId}. Marking failed.`);
                finalStatus = 'failed';
                finalError = `Delegation abort: Invalid UUIDs. User=${userIdToDelegate}, Job=${resolvedJobId}`;
            } else {
                // 3. Invoke Extraction Logic (Delegated)
                const fallbackUrl = `${SUPABASE_URL}/functions/v1/import-ocr-fallback`;
                const payload = {
                    job_id: resolvedJobId,
                    target_file_id: resolvedImportFileId,
                    mode: 'worker_chunk_process', // Instruction: Run specific chunk range
                    start_chunk_index: job.next_chunk_index,
                    max_chunks: 3, // Process up to 3 chunks per run
                    ocr_job_id: job.id // Pass ID to update progress
                };

                // Log Headers (for debugging)
                const requestHeaders: Record<string, string> = {
                    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    'apikey': `${SUPABASE_SERVICE_ROLE_KEY}`,
                    'Content-Type': 'application/json',
                    'x-internal-call': '1',
                    'x-job-id': resolvedJobId,
                    'x-user-id': userIdToDelegate
                };

                if (resolvedImportFileId && isUuid(resolvedImportFileId)) {
                    requestHeaders['x-import-file-id'] = resolvedImportFileId;
                }

                console.log(`[OCR-WORKER] Delegating to fallback: Job=${resolvedJobId}, User=${userIdToDelegate}, Headers=${JSON.stringify(Object.keys(requestHeaders))}`);

                const resp = await fetch(fallbackUrl, {
                    method: 'POST',
                    headers: requestHeaders,
                    body: JSON.stringify(payload)
                });

                if (!resp.ok) {
                    const txt = await resp.text();
                    console.error(`[OCR-WORKER] DELEGATION_FAILED: ${resp.status} - ${txt.slice(0, 500)}`);

                    // ERROR HANDLING: Retry or Fail
                    const maxRetries = 10;
                    const newRetryCount = (job.retry_count || 0) + 1;
                    finalRetryCount = newRetryCount;

                    if (newRetryCount >= maxRetries) {
                        console.error(`[OCR-WORKER] Max retries exhausted for job ${job.id}. Failing.`);
                        finalStatus = 'failed';
                        finalError = `Delegation max retries exceeded. Last status: ${resp.status}. Body: ${txt.slice(0, 200)}`;
                    } else {
                        console.log(`[OCR-WORKER] Transient delegation error. Requeuing job ${job.id} (Retry ${newRetryCount}/${maxRetries}).`);
                        finalStatus = 'pending'; // Requeue
                        finalError = `Msg: Delegation failed ${resp.status}. Retry pending.`;
                    }
                } else {
                    const result = await resp.json();

                    // Success!
                    // Check if continued or completed
                    if (result.status === 'continued') {
                        // Job is technically 'pending' still (waiting for next chunk), OR we mark it done?
                        // Wait. 'import_ocr_jobs' represents the abstract OCR task. 
                        // If we are 'continued', we likely need to run AGAIN.
                        // But wait, 'import_ocr_jobs' row usually represents a FILE or a BATCH?
                        // In this system, 'import_ocr_jobs' seems to be 1:1 with file.
                        // If chunking, we should probably keep it 'processing' or 'pending' for next run?
                        // BUT `claim_next_ocr_job` logic handles this? 
                        // Assuming current logic: If 'continued', we are NOT done. We re-queue self. 
                        // Does 'ocr-worker' update 'next_chunk_index'? 
                        // The `import-ocr-fallback` updates progress? Yes `save_chunk_progress`.
                        // So we just need to Release Lock (status='pending') so it can be claimed again?
                        // OR if we want immediate processing, we trigger worker.

                        console.log(`[OCR-WORKER] Job ${job.id} continued. Releasing lock for next chunk.`);
                        finalStatus = 'pending'; // Release lock, stay pending
                        shouldRedispatch = true;
                    } else {
                        finalStatus = 'completed'; // Done
                        console.log(`[OCR-WORKER] Job ${job.id} completed successfully.`);
                    }
                }
            }

        } catch (execErr: any) {
            console.error(`[OCR-WORKER] Execution Exception:`, execErr);
            finalStatus = 'failed';
            finalError = `Worker Exception: ${execErr.message}`;
        } finally {
            // GUARANTEED FINALIZATION
            console.log(`[OCR-WORKER] Finalizing Job ${job.id} -> ${finalStatus} (Error: ${finalError ? 'Yes' : 'No'})`);

            await supabase.rpc('finalize_ocr_job', {
                p_id: job.id,
                p_status: finalStatus,
                p_last_error: finalError,
                p_retry_count: finalRetryCount
            });

            // 5. Sync Parent Job Status (Best Effort)
            const { data: syncRes, error: syncErr } = await supabase.rpc('sync_import_job_from_ocr', {
                p_job_id: job.job_id
            });
            if (syncErr) console.error(`[OCR-WORKER] Sync Failed:`, syncErr);
            else console.log(`[OCR-WORKER] Sync Result:`, JSON.stringify(syncRes));

            // Auto-continue (Queue Self) if needed
            if (shouldRedispatch) {
                console.log(`[OCR-WORKER] Re-dispatching worker for continued job.`);
                EdgeRuntime.waitUntil(
                    fetch(`${SUPABASE_URL}/functions/v1/ocr-worker`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
                    })
                );
            }
        }

        return new Response(JSON.stringify({ status: finalStatus, error: finalError }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err: any) {
        console.error(`[OCR-WORKER] Fatal Error outside job loop: ${err.message}`);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
});
