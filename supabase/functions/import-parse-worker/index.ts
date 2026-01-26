// supabase/functions/import-parse-worker/index.ts
// ============================================================================
// NABOORÇA • WORKER DE PARSING PESADO — Edge Function (Deno)
// Função: import-parse-worker
// Invocação: POST { "job_id": "uuid" }
//
// Responsabilidades:
// 1) Resolução Segura de Arquivo (Polling)
// 2) Fluxo ASSÍNCRONO de OCR (Self-Hosted)
//    - Inicia Job -> Retorna
//    - Consulta Job -> Se pronto, persiste e continua
// 3) Persistência de Metadados e Checkpoints
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// -----------------------------
// Env
// -----------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OCR_SERVICE_URL = Deno.env.get("OCR_SERVICE_URL") ?? "";

// -----------------------------
// Types
// -----------------------------
type ImportFileRow = {
    id: string;
    user_id: string;
    job_id: string;
    file_kind: string;
    doc_role: string;
    original_filename: string | null;
    content_type: string | null;
    storage_bucket: string | null;
    storage_path: string;
    extracted_text: string | null;
    metadata: Record<string, unknown> | null;
    created_at?: string;
    page_count: number | null;
};

// -----------------------------
// Utilities
// -----------------------------
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
            "access-control-allow-methods": "POST, OPTIONS",
        },
    });
}

function getSupabase(): SupabaseClient {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
        global: { headers: { "X-Client-Info": "nabo-parse-worker/3.0-async" } },
    });
}

// -----------------------------
// Resolvers
// -----------------------------
async function resolveImportFileWithPolling(supabase: SupabaseClient, jobId: string, maxAttempts = 10): Promise<ImportFileRow> {
    const delays = [250, 500, 1000];
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const { data: file, error } = await supabase
            .from("import_files")
            .select("id,user_id,job_id,file_kind,doc_role,original_filename,content_type,storage_bucket,storage_path,page_count,extracted_text,metadata,created_at")
            .eq("job_id", jobId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.warn(`[FILE-RESOLVE] attempt=${attempt} job=${jobId} db_error=${error.message}`);
            lastError = error;
        } else if (file) {
            if (!file.storage_path || file.storage_path.trim().length < 5) {
                // Wait a bit, maybe storage path updates late?
            } else {
                return file as ImportFileRow;
            }
        }

        if (attempt < maxAttempts) {
            const ms = delays[Math.min(attempt - 1, delays.length - 1)];
            await new Promise(r => setTimeout(r, ms));
        }
    }
    throw new Error(`Import file record or storage_path not found for job_id=${jobId} after attempts.`);
}

// -----------------------------
// Async OCR Logic
// -----------------------------
async function processAsyncOcrFlow(supabase: SupabaseClient, file: ImportFileRow): Promise<{ status: "running" | "done" | "error" | "started"; text?: string }> {
    const jobId = file.job_id;
    const meta = (file.metadata || {}) as any;
    const ocrMeta = meta.ocr || {};

    // 1. Check if already done (Idempotency) - handled better in main handler now, but kept as safety
    if ((file.extracted_text && file.extracted_text.length > 50) || ocrMeta.completed_at) {
        return { status: "done", text: file.extracted_text || "" };
    }

    if (!OCR_SERVICE_URL) {
        throw new Error("[CRITICAL] OCR_SERVICE_URL not configured");
    }

    const requestId = ocrMeta.request_id;

    // A. OCR NOT STARTED (INIT State)
    if (!requestId) {
        const startUrl = `${OCR_SERVICE_URL.replace(/\/+$/, "")}/ocr/async`;
        console.log(`[OCR-ASYNC] Starting new OCR job. url=${startUrl} job=${jobId}`);

        // Signed URL
        const bucket = file.storage_bucket || "imports";
        const objectPath = file.storage_path.replace(/^\/?imports\//, "");
        const { data: signed, error: signErr } = await supabase.storage.from(bucket).createSignedUrl(objectPath, 3600);

        if (signErr || !signed) throw new Error(`Signed URL failed: ${signErr?.message}`);

        // Call Service
        try {
            const payload = { file_url: signed.signedUrl, max_pages: 50 };
            const resp = await fetch(startUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(20000) // 20s timeout
            });

            if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(`OCR Service Start Error ${resp.status}: ${errText}`);
            }

            const body = await resp.json();
            const newReqId = body.request_id;

            if (!newReqId) throw new Error("OCR Service returned no request_id");

            // Persist "Running" state
            const newMeta = {
                ...meta,
                ocr: {
                    provider: "self-hosted-async",
                    status: "running",
                    request_id: newReqId,
                    started_at: new Date().toISOString(),
                    checked_at: new Date().toISOString()
                }
            };

            await supabase.from("import_files").update({ metadata: newMeta }).eq("id", file.id);

            // Updating Job stage
            await supabase.from("import_jobs").update({
                stage: "ocr_started",
                status: "processing",
                last_error: null
            }).eq("id", jobId);

            console.log(`[OCR-ASYNC] Job started. request_id=${newReqId}.`);
            return { status: "started" };

        } catch (e: any) {
            console.error(`[OCR-ASYNC] Start failed: ${e.message}`);
            throw e;
        }
    }

    // B. OCR ALREADY RUNNING
    else {
        // Status endpoint
        const statusUrl = `${OCR_SERVICE_URL.replace(/\/+$/, "")}/ocr/status/${requestId}`;
        console.log(`[OCR-ASYNC] Checking status for req=${requestId}`);

        try {
            const resp = await fetch(statusUrl, {
                method: "GET",
                signal: AbortSignal.timeout(10000) // 10s check timeout
            });

            if (resp.status === 404) {
                console.error(`[OCR-ASYNC] Job ID not found in service.`);
                throw new Error("OCR Job ID not found (404) in provider");
            }

            if (!resp.ok) throw new Error(`OCR Status Error ${resp.status}`);

            const statusJson = await resp.json();
            const status = statusJson.status;

            if (status === "running") {
                // Update heartbeat
                const updateMeta = {
                    ...meta,
                    ocr: { ...ocrMeta, updated_at: new Date().toISOString(), checked_at: new Date().toISOString() }
                };
                await supabase.from("import_files").update({ metadata: updateMeta }).eq("id", file.id);
                // Ping job
                await supabase.from("import_jobs").update({ stage: "ocr_running", status: "processing" }).eq("id", jobId);
                return { status: "running" };
            }

            if (status === "error") {
                const errMeta = {
                    ...meta,
                    ocr: { ...ocrMeta, status: "error", error_message: statusJson.error_message, completed_at: new Date().toISOString() }
                };
                await supabase.from("import_files").update({ metadata: errMeta }).eq("id", file.id);
                throw new Error(`Provider reported error: ${statusJson.error_message}`);
            }

            if (status === "done") {
                const txt = statusJson.text || "";
                console.log(`[OCR-ASYNC] Done! Len=${statusJson.text_len}`);

                const doneMeta = {
                    ...meta,
                    ocr: {
                        ...ocrMeta,
                        status: "done",
                        provider: "self-hosted-async",
                        completed_at: new Date().toISOString(),
                        page_count: statusJson.page_count,
                        text_len: statusJson.text_len || 0,
                        raw_info: statusJson.raw_info,
                        error: null // clear error
                    }
                };

                // Persist Text + Metadata
                const { error: saveErr } = await supabase.from("import_files").update({
                    extracted_text: txt,
                    page_count: statusJson.page_count,
                    metadata: doneMeta
                }).eq("id", file.id);

                if (saveErr) throw new Error(`DB Save failed: ${saveErr.message}`);

                return { status: "done", text: txt };
            }

            return { status: "running" };

        } catch (e: any) {
            console.error(`[OCR-ASYNC] Check failed: ${e.message}`);
            throw e;
        }
    }
}

// -----------------------------
// Main Handler
// -----------------------------
serve(async (req) => {
    if (req.method === "OPTIONS") return corsPreflight();

    const reqId = crypto.randomUUID();
    console.log(`[WORKER ${reqId}] Start`);

    try {
        const body = await req.json();
        const { job_id: jobId } = body;

        if (!jobId) return jsonResponse({ error: "Missing job_id" }, 400);

        const supabase = getSupabase();

        // 1. Resolve File
        let file: ImportFileRow;
        const { file_id: explicitFileId, task_id: taskId } = body;

        if (explicitFileId) {
            console.log(`[WORKER ${reqId}] Resolving explicit file_id=${explicitFileId}`);
            const { data: f, error } = await supabase
                .from("import_files")
                .select("*")
                .eq("id", explicitFileId)
                .single();

            if (error || !f) throw new Error(`File not found: ${explicitFileId}`);
            file = f as ImportFileRow;
        } else {
            // Legacy fallback
            console.warn(`[WORKER ${reqId}] No file_id provided, falling back to legacy polling.`);
            file = await resolveImportFileWithPolling(supabase, jobId);
        }

        // === B4. AUTOMATIC RECONCILIATION REMOVED FOR SINGLE FILE CHECK ===
        // We now check completion at the end.

        // 2. Async OCR Flow
        let ocrResult;
        try {
            ocrResult = await processAsyncOcrFlow(supabase, file);
        } catch (e: any) {
            console.error(`[OCR-ASYNC] Flow Error: ${e.message}`);
            // ... (keep logic, but update task if taskId exists)
            if (taskId) {
                await supabase.from("import_parse_tasks").update({
                    status: "failed",
                    last_error: e.message,
                    attempts: 99
                }).eq("task_id", taskId);
            }

            // === B3. CRITICAL GUARD: TRANSIENT ERROR HANDLING === 
            // (Copy existing logic but ensure we don't fail job if other files are running)
            if (ocrMeta.request_id && !ocrMeta.completed_at) {
                console.warn(`[OCR-ASYNC] Transient error. Keeping job alive.`);
                // Do NOT update job status here blindly, it might affect other files.
                // Just return.
                return jsonResponse({
                    status: "ocr_running",
                    message: "OCR in progress (transient check error)",
                    error_details: e.message
                });
            }

            // Hard failure for this file
            await supabase.from("import_files").update({
                metadata: { ...((file.metadata as any) || {}), extraction_error: e.message }
            }).eq("id", file.id);

            return jsonResponse({ error: e.message }, 500);
        }

        // 3. Handle Status Return
        if (ocrResult.status === "started" || ocrResult.status === "running") {
            if (taskId) await supabase.from("import_parse_tasks").update({ status: "running", updated_at: new Date().toISOString() }).eq("task_id", taskId);
            return jsonResponse({ status: ocrResult.status });
        }

        // 4. If DONE
        if (ocrResult.status === "done") {
            const text = ocrResult.text || "";

            // Mark task done
            if (taskId) {
                await supabase.from("import_parse_tasks").update({
                    status: "completed",
                    updated_at: new Date().toISOString()
                }).eq("task_id", taskId);
            }

            if (text.length < 50) {
                // Warning on file, but maybe not fail job if other files are good?
                // For now, let's keep it simple: just mark file as empty.
                console.warn(`[WORKER] File ${file.id} resulted in empty text.`);
            }

            // CHECK IF ALL FILES ARE DONE
            const { data: allFiles } = await supabase.from("import_files").select("id, extracted_text").eq("job_id", jobId);
            const pending = allFiles?.filter(f => !f.extracted_text || f.extracted_text.length < 50) || [];

            if (pending.length === 0) {
                console.log(`[WORKER] All files processed. Advancing job to ocr_done.`);
                // Success -> Job Ready
                await supabase.from("import_jobs").update({
                    status: "waiting_user", // Ready for Next Step (Extraction)
                    stage: "ocr_done",
                    progress: 100,
                    current_step: "ocr_done",
                    error_message: null
                }).eq("id", jobId);
            } else {
                console.log(`[WORKER] File done, but job has ${pending.length} pending files.`);
            }

            return jsonResponse({ status: "success", len: text.length });
        }

        return jsonResponse({ status: "unknown" });

    } catch (e: any) {
        console.error(`[WORKER ${reqId}] Fatal: ${e.message}`);
        return jsonResponse({ error: e.message }, 500);
    }
});
