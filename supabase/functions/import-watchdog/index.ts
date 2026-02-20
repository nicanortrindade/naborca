
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 4 minutes grace period
const GRACE_PERIOD_MS = 4 * 60 * 1000;

serve(async (req) => {
    // Cron logic often sends POST, but we can handle GET too for manual testing
    if (req.method !== "POST" && req.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const nowMs = Date.now();
    const nowIso = new Date().toISOString();

    console.log(`[IMPORT-WATCHDOG] Run started at ${nowIso}`);

    try {
        // 1. Fetch Candidates: queued or processing
        const { data: candidates, error: fetchErr } = await supabase
            .from("import_files")
            .select("id, extraction_status, extracted_started_at, metadata")
            .in("extraction_status", ["queued", "processing"]);

        if (fetchErr) {
            console.error("[IMPORT-WATCHDOG] Failed to fetch candidates", fetchErr);
            return new Response(JSON.stringify({ error: fetchErr }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }

        const stats = {
            scanned: candidates?.length || 0,
            processed: 0,
            fixed: 0,
            details: [] as any[]
        };

        if (candidates && candidates.length > 0) {
            for (const f of candidates) {
                stats.processed++;

                // Must have started_at to calculate elapsed
                if (!f.extracted_started_at) continue;

                const startedMs = new Date(f.extracted_started_at).getTime();
                const elapsed = nowMs - startedMs;

                // Check Grace Period
                if (elapsed > GRACE_PERIOD_MS) {
                    // Check for worker entry (Metadata) OR OCR Evidence
                    const debug = f.metadata?.debug || {};
                    const ocr = f.metadata?.ocr || {};

                    const stageA = f.metadata?.stageA || {};

                    const workerEntered = debug.worker_entered_at || ocr.worker_entered_at;
                    const hasOcrActivity = (ocr.text_length > 0) || !!ocr.extracted_at;
                    const hasStageActivity = !!stageA.generated_at || (stageA.candidate_count !== undefined);

                    // FIX: Check for Stage A activity too (since persistOCR is late)
                    if (!workerEntered && !hasOcrActivity && !hasStageActivity) {
                        // Check for Queue Row (Async) - ROBUST CHECK (limit 1)
                        const { data: qRows, error: qErr } = await supabase
                            .from('import_ocr_jobs')
                            .select('id')
                            .eq('import_file_id', f.id)
                            .limit(1);

                        // Explicit boolean derivation
                        const hasQueue = Array.isArray(qRows) && qRows.length > 0;
                        const isInternalDelegate = f.metadata?.routing?.delegate_ok === true;

                        if (isInternalDelegate) {
                            console.error(`[IMPORT-WATCHDOG] STUCK INTERNAL JOB: File ${f.id} elapsed=${elapsed}ms. Marking failed.`);
                            const { error: updateErr } = await supabase.from('import_files').update({
                                extraction_status: 'failed',
                                extraction_last_error: 'internal_execution_timeout_no_activity',
                                extracted_completed_at: new Date().toISOString()
                            }).eq('id', f.id);
                            if (!updateErr) {
                                stats.fixed++;
                                stats.details.push({ file_id: f.id, elapsed, action: 'marked_failed_internal' });
                            }
                        } else if (!hasQueue && !qErr) {
                            console.error(`[IMPORT-WATCHDOG] STUCK JOB DETECTED: File ${f.id} elapsed=${elapsed}ms. Marking failed.`);

                            // FIX IT
                            const { error: updateErr } = await supabase.from('import_files').update({
                                extraction_status: 'failed',
                                extraction_last_error: 'ocr_delegation_stuck_no_worker_no_queue',
                                extracted_completed_at: new Date().toISOString()
                            }).eq('id', f.id);

                            if (!updateErr) {
                                stats.fixed++;
                                stats.details.push({ file_id: f.id, elapsed, action: 'marked_failed' });
                            } else {
                                console.error(`[IMPORT-WATCHDOG] Failed to update file ${f.id}`, updateErr);
                            }
                        }
                    }
                }
            }
        }

        console.log(`[IMPORT-WATCHDOG] Run completed. Fixed ${stats.fixed} stuck files.`);

        return new Response(JSON.stringify(stats), {
            headers: { "Content-Type": "application/json" },
        });

    } catch (e: any) {
        console.error("[IMPORT-WATCHDOG] Fatal Error", e);
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
});
