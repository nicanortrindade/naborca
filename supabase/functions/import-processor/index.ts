// supabase/functions/import-processor/index.ts
// ============================================================================
// NABOORÇA • MÓDULO UNIVERSAL DE IMPORTAÇÃO — Edge Function (Deno)
// Função: import-processor
// Invocação: POST { "job_id": "uuid" }
// Stack: Supabase (DB + Storage) + Gemini 1.5 Flash
//
// Responsabilidades:
// 1) Carrega import_job + import_files
// 2) Baixa arquivo(s) do Storage (bucket imports)
// 3) Envia para Gemini 1.5 Flash com System Prompt de engenharia
// 4) Loop defensivo de validação Zod + autocorreção (máx 2 retries)
// 5) Persiste header -> import_jobs.document_context
// 6) Persiste items -> import_ai_items (staging)
// 7) Atualiza status do job: waiting_user (sucesso) / failed (erro)
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
// GoogleGenerativeAI import removed (Orchestrator Mode)
import { z } from "https://esm.sh/zod@3.23.8";
// PDF.js via ESM.sh - Deno compatible (no node:buffer dependency)
// pdfjsLib import removed

// -----------------------------
// Env
// -----------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("GEMINI_API_KEY".toLowerCase()) ?? "";
// NOTE: GEMINI_MODEL is now dynamically discovered via resolveGeminiModelName()

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[BOOT] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
if (!GEMINI_API_KEY) {
    console.error("[BOOT] Missing GEMINI_API_KEY");
}

// -----------------------------
// Types (DB shapes - minimal)
// -----------------------------
type ImportJobStatus = "queued" | "processing" | "waiting_user" | "applying" | "done" | "failed" | "waiting_user_rate_limited" | "waiting_user_extraction_failed";
type ImportDocRole = "synthetic" | "analytical" | "unknown";
type ImportFileKind = "pdf" | "excel" | "other";

type ImportJobRow = {
    id: string;
    user_id: string;
    status: ImportJobStatus;
    doc_role: ImportDocRole;
    is_desonerado: boolean | null;
    document_context: Record<string, unknown> | null;
    progress: number;
    current_step: string | null;
};

type ImportFileRow = {
    id: string;
    user_id: string;
    job_id: string;
    file_kind: ImportFileKind;
    doc_role: ImportDocRole;
    original_filename: string | null;
    content_type: string | null;
    storage_bucket: string | null;
    storage_path: string;
    storage_url: string | null;
    sha256: string | null;
    page_count: number | null;
    extraction_method: string | null;
    metadata: Record<string, unknown> | null;
};

// -----------------------------
// Zod schema (AI output contract)
// -----------------------------
const PriceTypeSchema = z.union([
    z.literal("desonerado"),
    z.literal("nao_desonerado"),
    z.literal("unico"),
]);

const HeaderSchema = z.object({
    reference_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD (use primeiro dia do mês se só tiver MM/YYYY)
    bdi_percent: z.number().finite().min(0).max(999),
    charges_percent: z.number().finite().min(0).max(999),
    is_desonerado_detected: z.boolean(),
});

const ItemSchema = z.object({
    code_raw: z.string().optional().default(""),
    code: z.string().optional().default("SEM_CODIGO"), // Default para evitar quebra se vier vazio
    source: z.string().optional().default("ai_extraction"),
    description: z.string().min(1),
    unit: z.string().optional().default("UN"),
    quantity: z.number().finite().nonnegative().optional().default(1),
    unit_price: z.number().finite().nonnegative().optional().default(0),
    price_type: PriceTypeSchema.optional().default("unico"),
    confidence: z.number().finite().min(0).max(1).default(0.5),
    needs_manual_review: z.boolean().optional().default(false),
});

const GeminiOutputSchema = z.object({
    header: HeaderSchema,
    items: z.array(ItemSchema).default([]),
});

type GeminiOutput = z.infer<typeof GeminiOutputSchema>;

// -----------------------------
// RATE LIMIT HELPERS (NEW)
// -----------------------------
class RateLimitError extends Error {
    constructor(public originalError: any) {
        super("RateLimitHit");
    }
}

function isRateLimitError(e: any): boolean {
    const msg = e?.message?.toLowerCase() || "";
    // Check status 429 or known Google/Gemini quota messages
    return (
        e?.status === 429 ||
        msg.includes("too many requests") ||
        msg.includes("quota exceeded") ||
        msg.includes("generate_content_free_tier_requests")
    );
}

// -----------------------------
// SOFT TIMEOUT GUARD
// -----------------------------
const SOFT_DEADLINE_MS = 75_000;

class SoftTimeoutError extends Error {
    public context: any;
    constructor(message: string, context: any) {
        super(message);
        this.context = context;
    }
}

function checkSoftTimeout(processStartMs: number, checkpointName: string) {
    const elapsedMs = Date.now() - processStartMs;
    // console.log(`[TIMEOUT-GUARD] check: ${checkpointName} (elapsed: ${elapsedMs}ms)`);
    if (elapsedMs >= SOFT_DEADLINE_MS) {
        throw new SoftTimeoutError("SoftTimeoutHit", {
            kind: "soft_timeout",
            elapsed_ms: elapsedMs,
            deadline_ms: SOFT_DEADLINE_MS,
            checkpoint: checkpointName
        });
    }
}

// -----------------------------
// STEP TIMEOUT HELPERS (NEW)
// -----------------------------
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
        const id = setTimeout(() => {
            reject(new Error(`TIMEOUT_STEP:${label}`));
        }, ms);
        // Clean up timeout if promise completes first?
        // In Promise.race, the timer keeps running until callback.
        // For strict cleanup we'd need a wrapper that clears timeout.
        // But for Edge Functions short-lived, basic race is acceptable if we accept dangling timer for a few seconds.
        // Better implementation:
        promise.finally(() => clearTimeout(id));
    });
    return Promise.race([promise, timeoutPromise]);
}

async function setCheckpoint(supabase: SupabaseClient, jobId: string, checkpointName: string) {
    try {
        console.log(`[CHECKPOINT] ${checkpointName}`);
        const { error } = await supabase.rpc("import_job_set_checkpoint", {
            p_job_id: jobId,
            p_checkpoint: checkpointName,
            p_checkpoint_ts: new Date().toISOString(),
        });
        if (error) throw error;
    } catch (e) {
        console.warn(`[CHECKPOINT_FAIL] ${checkpointName}`, e);
    }
}

/**
 * Handles graceful shutdown when soft timeout is hit.
 * Queries real DB count (SSOT) and saves a controlled state.
 */
/**
 * Handles graceful shutdown for ANY timeout (Soft or Hard) or critical error.
 * Queries real DB count (SSOT) and saves a controlled state.
 */
async function finalizeTimeout(
    supabase: SupabaseClient,
    jobId: string,
    existingContext: any,
    debugInfo: any,
    reason: string,
    req?: Request
) {
    console.warn(`[TIMEOUT_GUARD] Finalizing job ${jobId} reason=${reason}...`);

    // 1. Get Real DB Count (SSOT)
    const { count: realDbCount } = await supabase
        .from("import_ai_items")
        .select("*", { count: "exact", head: true })
        .eq("job_id", jobId);

    const finalCount = realDbCount || 0;

    // 2. Prepare Context Updates
    const finalizeGuard = {
        applied: true,
        reason: reason,
        real_db_count: finalCount,
        count_query_ran: true,
        timestamp: new Date().toISOString()
    };

    const userAction = {
        required: true,
        reason: "timeout_extraction",
        message: "O processamento demorou muito. Verifique os itens extraídos ou adicione manualmente.",
        items_count: finalCount
    };

    // Ensure debug_info has minimal fields
    const safeDebugInfo = {
        stage: "timeout_finalized",
        timeout_reason: reason,
        db_verified_count: finalCount,
        finalized_at: new Date().toISOString(),
        ...debugInfo
    };

    const updatedContext = {
        ...(existingContext || {}),
        inserted_items_count: finalCount,
        finalize_guard: finalizeGuard,
        user_action: userAction,
        last_error_recovered: reason,
        debug_info: {
            ...((existingContext?.debug_info) || {}),
            ...safeDebugInfo
        }
    };

    // 3. Update Job (Robust Single Call)
    // If items exist, never mark as failed.
    const status: ImportJobStatus = finalCount > 0
        ? "waiting_user"
        : "waiting_user_extraction_failed";
    const currentStep = finalCount > 0 ? "waiting_user_timeout_partial" : "waiting_user_extraction_failed";

    // Merge context manually to ensure we send the specific shape we want
    const finalUpdatePayload = {
        status: status,
        progress: 100,
        current_step: currentStep,
        document_context: updatedContext,
        error_message: null // Clear error message to avoid UI "red state" if we have items
    };

    try {
        console.log(`[TIMEOUT_GUARD] Updating job ${jobId} -> status=${status}, step=${currentStep}`);
        const { error: updateErr } = await supabase
            .from("import_jobs")
            .update(finalUpdatePayload)
            .eq("id", jobId);

        if (updateErr) {
            throw updateErr;
        }
    } catch (updErr: any) {
        console.error(`[TIMEOUT_GUARD] Update FAILED for job ${jobId}`, safeStringify(updErr));

        // Fallback: Try minimal update (Status + Step only)
        try {
            console.warn(`[TIMEOUT_GUARD] Retrying minimal update (status/step only)...`);
            await supabase
                .from("import_jobs")
                .update({
                    status: status,
                    current_step: currentStep,
                    error_message: `Recovery failed: ${updErr.message || "Unknown DB error"}`
                })
                .eq("id", jobId);
        } catch (fallbackErr) {
            console.error(`[TIMEOUT_GUARD] CRITICAL: Minimal update also failed`, fallbackErr);
            // We cannot do much more, but we shouldn't throw to crash the 200 OK response if possible.
            // However, if we can't update status, UI handles it badly.
            throw fallbackErr; // Let global handler log it
        }
    }

    return jsonResponse({
        ok: true,
        status: status,
        reason: reason,
        message: userAction.message,
        items_count: finalCount
    }, 200, req);
}

// -----------------------------
// Utilities
// -----------------------------
// -----------------------------
// Utilities
// -----------------------------
function buildCorsHeaders(req: Request): HeadersInit {
    const origin = req.headers.get("origin") || "";

    const headers: any = {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin"
    };

    if (origin) {
        headers["Access-Control-Allow-Origin"] = origin;
    } else {
        headers["Access-Control-Allow-Origin"] = "*";
    }

    return headers;
}

function jsonResponse(body: unknown, status = 200, req?: Request) {
    let headers: any;
    if (req) {
        headers = buildCorsHeaders(req);
    } else {
        headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
        };
    }

    return new Response(JSON.stringify(body, null, 2), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            ...headers,
        },
    });
}

function corsPreflight(req: Request) {
    return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(req),
    });
}

function safeStringify(obj: unknown) {
    try {
        return JSON.stringify(obj);
    } catch {
        return String(obj);
    }
}

function safeTrim(v: unknown): string {
    if (typeof v === "string") return v.trim();
    if (v === null || v === undefined) return "";
    try {
        return String(v).trim();
    } catch {
        return "";
    }
}

function extractJsonFromModelText(text: string): string {
    // Remove code fences if present
    const trimmed = safeTrim(text);

    // Case 1: ```json ... ```
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) return fenceMatch[1].trim();

    // Case 2: attempt to locate first '{' and last '}' and slice
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1).trim();
    }

    return trimmed;
}

function parseJsonLenient(rawText: string): unknown {
    const candidate = extractJsonFromModelText(rawText);
    if (!candidate) return null;

    // Basic strict parse
    try {
        return JSON.parse(candidate);
    } catch (_e) {
        // Second attempt: remove trailing commas (common model error)
        const noTrailingCommas = candidate
            .replace(/,\s*}/g, "}")
            .replace(/,\s*]/g, "]");
        return JSON.parse(noTrailingCommas);
    }
}

function buildValidationErrorSummary(zodError: z.ZodError): string {
    // Keep concise but actionable
    return zodError.issues
        .slice(0, 25)
        .map((iss, idx) => {
            const path = iss.path.length ? iss.path.join(".") : "<root>";
            return `${idx + 1}) path="${path}" code=${iss.code} message="${iss.message}"`;
        })
        .join("\n");
}

// Helper Block 1 Removed (guessMimeType, selectExtractionMethod, calculateSha256, extractPdfText, chunkText)

function normalizeReferenceDate(input: string): string {
    // Expect: either "YYYY-MM-DD" already; or "MM/YYYY"; or "YYYY/MM"; or "YYYY-MM"
    const s = safeTrim(input);

    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // MM/YYYY
    const mmYYYY = s.match(/^(\d{2})\/(\d{4})$/);
    if (mmYYYY) return `${mmYYYY[2]}-${mmYYYY[1]}-01`;

    // YYYY/MM
    const yyyyMMslash = s.match(/^(\d{4})\/(\d{2})$/);
    if (yyyyMMslash) return `${yyyyMMslash[1]}-${yyyyMMslash[2]}-01`;

    // YYYY-MM
    const yyyyMM = s.match(/^(\d{4})-(\d{2})$/);
    if (yyyyMM) return `${yyyyMM[1]}-${yyyyMM[2]}-01`;

    // fallback: today
    const d = new Date();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}-01`;
}

// -----------------------------
// System prompt (Business rules)
// -----------------------------
const SYSTEM_PROMPT = `
Você é um parser de engenharia especializado em RESILIÊNCIA. Sua missão é extrair itens de orçamento de documentos PDF/Excel, MESMO QUE estejam desformatados, incompletos ou confusos.

DIRETRIZ PRINCIPAL: PREFERIR EXTRAÇÃO IMPERFEITA A NENHUMA EXTRAÇÃO.
Nunca retorne lista vazia se houver qualquer texto que pareça um serviço, material ou etapa de obra.

REGRAS DE EXTRAÇÃO PERMISSIVA (HEURÍSTICAS):

1. **Identificação de Itens:**
   - Procure por linhas contendo palavras-chave: "serviço", "fornecimento", "execução", "instalação", "demolição", "construção", "pintura", "piso", "concreto", "alvenaria".
   - Texto corrido ou listas sem colunas claras DEVEM ser interpretados como itens.
   - Cabeçalhos de seção (ex: "1. INSTALAÇÕES ELÉTRICAS") DEVEM virar itens (provavelmente type=etapa, mas extraia como item normal se dúvida).

2. **Tratamento de Campos Faltantes (DEFAULTS):**
   - **Código/Code:** Se não houver código visível (ex: SINAPI 1234), gere um item SEM código ou invente um ID sequencial se ajudar. NÃO descarte o item por falta de código.
   - **Preço/Unit Price:** Se não houver preço, assuma 0.00. O usuário preencherá depois.
   - **Quantidade:** Se não houver quantidade, assuma 1.
   - **Unidade:** Se não houver, assuma "UN".

3. **Source / Base:**
   - Tente identificar SINAPI, ORSE, SBC, etc.
   - Se não identificar, use source="ai_extraction".

4. **Confiança e Revisão:**
   - Se o item foi inferido de texto confuso ou sem preço, marque \`needs_manual_review: true\` e \`confidence: 0.5\` (ou menos).
   - Se o item parece apenas um título ou texto explicativo, extraia-o mesmo assim, pois pode ser importante como descrição.

5. **Correção de Texto:**
   - Normalize quebras de linha: "CONCRE\nTO" -> "CONCRETO".
   - Remova caracteres estranhos de OCR.

SCHEMA DE SAÍDA JSON (OBRIGATÓRIO):
{
  "header": {
    "reference_date": "YYYY-MM-DD", // ou hoje
    "bdi_percent": 0,
    "charges_percent": 0,
    "is_desonerado_detected": false
  },
  "items": [
    {
      "code": "1.2", // ou "SEM_CODIGO"
      "description": "Execução de alvenaria...",
      "unit": "M2",
      "quantity": 100.0,
      "unit_price": 50.00, // ou 0
      "source": "SINAPI", // ou "ai_extraction"
      "price_type": "unico",
      "confidence": 0.8,
      "needs_manual_review": false
    }
  ]
}

CASO EXTREMO (SÓ EM ÚLTIMO CASO):
Se o documento for TOTALMENTE ilegível ou vazio, gere UM item placeholder:
- description: "Documento ilegível ou sem itens identificáveis - verificar manual"
- needs_manual_review: true
- confidence: 0.1

NÃO adicione comentários fora do JSON.
`;

// -----------------------------
// Supabase client (Service Role)
// -----------------------------
function getSupabase(): SupabaseClient {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
        global: { headers: { "X-Client-Info": "nabo-import-processor/1.0" } },
    });
}

// -----------------------------
// SSOT for Gemini model name - Dynamic discovery via HTTP
// -----------------------------
interface GeminiModelInfo {
    name: string;
    supportedGenerationMethods?: string[];
}

interface GeminiListModelsResponse {
    models?: GeminiModelInfo[];
}

/**
 * Descobre dinamicamente um modelo Gemini compatível com generateContent.
 * @returns { modelName: string } on success, or { error: string, allModels: string[] } on failure
 */
// Gemini Model Discovery Helpers REMOVED (Delegated to workers)

// -----------------------------
// DB helpers
// -----------------------------
async function updateJob(
    supabase: SupabaseClient,
    jobId: string,
    patch: Partial<Pick<ImportJobRow, "status" | "progress" | "current_step" | "document_context">> & { error_message?: string | null },
) {
    const { error } = await supabase
        .from("import_jobs")
        .update({
            ...patch,
            ...(patch.error_message !== undefined ? { error_message: patch.error_message } : {}),
        })
        .eq("id", jobId);

    if (error) {
        console.error("[DB] Failed to update import_jobs", { jobId, error: safeStringify(error) });
        throw new Error(`DB update import_jobs failed: ${error.message}`);
    }
}

async function loadJobAndFiles(supabase: SupabaseClient, jobId: string): Promise<{ job: ImportJobRow; files: ImportFileRow[] }> {
    const { data: job, error: jobErr } = await supabase
        .from("import_jobs")
        .select("id,user_id,status,doc_role,is_desonerado,document_context,progress,current_step")
        .eq("id", jobId)
        .maybeSingle();

    if (jobErr) {
        console.error("[DB] Failed to load import_job", { jobId, error: safeStringify(jobErr) });
        throw new Error(`DB load import_job failed: ${jobErr.message}`);
    }
    if (!job) {
        throw new Error(`Job not found: ${jobId}`);
    }

    const { data: files, error: filesErr } = await supabase
        .from("import_files")
        .select("id,user_id,job_id,file_kind,doc_role,original_filename,content_type,storage_bucket,storage_path,storage_url,sha256,page_count,extraction_method,metadata")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true });

    if (filesErr) {
        console.error("[DB] Failed to load import_files", { jobId, error: safeStringify(filesErr) });
        throw new Error(`DB load import_files failed: ${filesErr.message}`);
    }

    if (!files || files.length === 0) {
        throw new Error(`No files associated with job: ${jobId}`);
    }

    return { job: job as ImportJobRow, files: files as ImportFileRow[] };
}

// downloadStorageFile REMOVED (Bytes handling delegated to workers)

// Local Processing Helpers REMOVED (insertImportItems, Gemini extraction loops)

// -----------------------------
// TASK PERSISTENCE HELPER (NEW - ROBUSTNESS FIX)
// -----------------------------
async function ensureParseTaskForFile(supabase: SupabaseClient, jobId: string, fileId: string, requestId: string): Promise<any> {
    console.log(`[REQ ${requestId}] PARSE_TASK_ENSURE_START {job_id: ${jobId}, file_id: ${fileId}}`);

    // 1. Tentar buscar existente
    const { data: existing, error: fetchErr } = await supabase
        .from('import_parse_tasks')
        .select('*')
        .eq('job_id', jobId)
        .eq('file_id', fileId)
        .maybeSingle();

    if (fetchErr) {
        console.error(`[REQ ${requestId}] Error fetching tasks: ${fetchErr.message}`);
        throw fetchErr;
    }

    if (existing) {
        console.log(`[REQ ${requestId}] PARSE_TASK_EXISTS {task_id: ${existing.id}, status: ${existing.status}, attempts: ${existing.attempts}, max_attempts: ${existing.max_attempts}}`);
        return existing;
    }

    // 2. Criar nova
    const newTask = {
        job_id: jobId,
        file_id: fileId,
        status: 'queued',
        attempts: 0,
        max_attempts: 3
    };

    const { data: created, error: insertErr } = await supabase
        .from('import_parse_tasks')
        .insert(newTask)
        .select()
        .single();

    if (insertErr) {
        // Race condition check (Unique violation)
        if (insertErr.code === '23505') {
            console.warn(`[REQ ${requestId}] Race condition on insert task, retrying fetch...`);
            const { data: retryTask } = await supabase
                .from('import_parse_tasks')
                .select('*')
                .eq('job_id', jobId)
                .eq('file_id', fileId)
                .single();
            if (retryTask) {
                console.log(`[REQ ${requestId}] PARSE_TASK_EXISTS (Retry) {task_id: ${retryTask.id}, status: ${retryTask.status}}`);
                return retryTask;
            }
        }
        console.error(`[REQ ${requestId}] Error inserting task: ${insertErr.message}`);
        throw insertErr;
    }

    console.log(`[REQ ${requestId}] PARSE_TASK_CREATED {task_id: ${created.id}, status: ${created.status}, attempts: ${created.attempts}, max_attempts: ${created.max_attempts}}`);
    return created;
}

// -----------------------------
// FIRE-AND-FORGET DELEGATION HELPER (NEW)
// -----------------------------
interface DelegationOpts {
    url: string;
    headers: Record<string, string>;
    payload: any;
    requestId: string;
    fileId: string;
}

interface DelegationResult {
    success: boolean;
    status: number;
    error?: string;
    bodySample?: string;
}

async function fireAndForgetDelegate(opts: DelegationOpts): Promise<DelegationResult> {
    const { url, headers, payload, requestId, fileId } = opts;
    const controller = new AbortController();
    // Short timeout just to get ACK
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        // We don't read body fully, just a sample if error
        let bodySample: string | undefined;
        if (resp.status >= 400) {
            try {
                bodySample = await resp.text();
                bodySample = bodySample.substring(0, 300);
            } catch { /* ignore */ }
        }

        if (resp.status >= 400) {
            console.error(`[REQ ${requestId}] [DELEGATE_ACK_ERROR] File ${fileId}: Status ${resp.status} (Not OK)`);
            return { success: false, status: resp.status, error: `HTTP ${resp.status}`, bodySample };
        } else {
            console.log(`[REQ ${requestId}] [DELEGATE_ACK_OK] File ${fileId}: Status ${resp.status}`);
            return { success: true, status: resp.status };
        }

    } catch (err: any) {
        if (err.name === 'AbortError') {
            // Expected behavior if worker takes > 1.5s to start sending specific headers
            // TIMEOUT is actually SUCCESS for our fire-and-forget purpose (request sent)
            console.warn(`[REQ ${requestId}] [DELEGATE_ACK_TIMEOUT] File ${fileId}: Request likely sent, moving on.`);
            return { success: true, status: 202, error: 'timout_ack_assumed_ok' };
        }
        console.warn(`[REQ ${requestId}] [DELEGATE_NET_ERROR] File ${fileId}: ${err.message}`);
        return { success: false, status: 0, error: err.message };
    } finally {
        clearTimeout(timeoutId);
    }
}


// -----------------------------
// WATCHDOG HELPERS (NEW)
// -----------------------------
function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function countAiItems(supabase: SupabaseClient, jobId: string): Promise<number> {
    const { count, error } = await supabase
        .from('import_ai_items')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', jobId);

    if (error) {
        console.warn(`[WATCHDOG] countAiItems error: ${error.message}`);
        return -1; // Error signal
    }
    return count || 0;
}

async function waitForParseTasksToSettle(
    supabase: SupabaseClient,
    jobId: string,
    requestId: string
): Promise<{ settled: boolean, total: number, done: number, failed: number, running: number }> {

    const MAX_WAIT_MS = 25000;
    const INTERVAL_MS = 1500;
    const start = Date.now();
    let lastStats = { settled: false, total: 0, done: 0, failed: 0, running: 0 };

    while (Date.now() - start < MAX_WAIT_MS) {
        const { data, error } = await supabase
            .from('import_parse_tasks')
            .select('status')
            .eq('job_id', jobId);

        if (error) {
            console.warn(`[REQ ${requestId}] PARSE_TASKS_POLL error: ${error.message}`);
            await sleep(INTERVAL_MS);
            continue;
        }

        const tasks = data || [];
        const total = tasks.length;
        const done = tasks.filter((t: any) => t.status === 'done').length;
        const failed = tasks.filter((t: any) => t.status === 'failed').length;
        // Consider 'queued' and 'processing' as running
        const running = tasks.filter((t: any) => t.status === 'running' || t.status === 'queued' || t.status === 'processing').length;

        lastStats = { settled: false, total, done, failed, running };
        console.log(`[REQ ${requestId}] PARSE_TASKS_POLL {running: ${running}, done: ${done}, failed: ${failed}, total: ${total}}`);

        if (total > 0 && running === 0) {
            return { settled: true, total, done, failed, running };
        }

        await sleep(INTERVAL_MS);
    }

    return lastStats;
}

// -----------------------------
// Main handler
// -----------------------------
// -----------------------------
// Entrypoint (Strict CORS)
// -----------------------------
serve(async (req) => {
    try {
        // 1. Handle Preflight OPTIONS immediately
        if (req.method === "OPTIONS") {
            return corsPreflight(req);
        }

        // 2. Delegate to Async Handler
        return await handleRequest(req);
    } catch (err) {
        console.error("[FATAL import-processor]", err);

        return jsonResponse(
            {
                ok: false,
                error: "import_processor_fatal",
                message: err instanceof Error ? err.message : String(err),
            },
            500,
            req
        );
    }
});

// -----------------------------
// Main Logic
// -----------------------------
async function handleRequest(req: Request): Promise<Response> {
    const processStartMs = Date.now(); // ⏱️ CAPTURE START TIME
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

    const requestId = crypto.randomUUID();
    const contentType = req.headers.get("content-type") || "";
    console.log(`[REQ ${requestId}] import-processor HIT method=${req.method} url=${req.url} ct=${contentType}`);

    // 1. Manual Auth Check (Bypass Gateway 401)
    // We use anon key to verify the JWT strictly against Supabase Auth.
    let authCheckTrace: any = null;
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
        return jsonResponse({ code: 401, message: "Missing Authorization Header" }, 401, req);
    }

    const token = authHeader.replace("Bearer ", "");
    // Use Anon Key for getUser to validate token signature & expiry
    const localSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY);
    
    // First attempt: Standard getUser (requires 'sub' claim and valid session/user)
    let { data: { user }, error: userErr } = await localSupabase.auth.getUser(token);

    // [New] Support for service_role keys which might not have 'sub' depending on local env or usage
    if (userErr && !user) {
        // Fallback: Manually check if it's a valid service_role token via signature if feasible, 
        // but easier for edge functions is to allow getUser if we have the role in it.
        // Actually, for local dev, let's allow it if it fails getUser due to 'sub' but otherwise looks valid.
        if (userErr.message.includes("sub claim")) {
            console.log(`[REQ ${requestId}] Token is likely service_role, bypassing stric getUser check.`);
            // Mock a user with service_role ID
            user = { id: 'service-role-system-user' } as any;
            userErr = null;
        }
    }

    if (userErr || !user) {
        console.warn(`[REQ ${requestId}] Manual JWT check failed:`, userErr);
        return jsonResponse({
            code: 401,
            message: "Invalid JWT (manual check)",
            details: userErr?.message || "User not found"
        }, 401, req);
    }

    // Auth OK - Store userId for internal calls
    const authenticatedUserId = user.id;
    authCheckTrace = {
        gateway_verify_jwt: false,
        manual_auth_ok: true,
        user_id: authenticatedUserId,
        ts: new Date().toISOString()
    };

    // DEBUG & TRACE
    const dbVerificationTrace: string[] = [];
    const internalCallsDebug: any[] = []; // Track internal function calls
    const traceTrace = (val: number | string, src: string, tag: string) => {
        const msg = `set inserted_items_count from ${src}: ${val} at ${tag}`;
        dbVerificationTrace.push(msg);
        console.log(`[PROCESSOR-TRACE] ${msg}`);
    };

    // ========================================================================
    // TOP LEVEL PAYLOAD PARSING (JSON or MULTIPART) => "bodyPayload"
    // ========================================================================
    let bodyPayload: any = {};
    let formPayload: Record<string, any> | null = null;

    try {
        const clonedReq = req.clone();
        if (contentType.includes("application/json")) {
            bodyPayload = await clonedReq.json().catch(() => null);
            if (bodyPayload) console.log(`[REQ ${requestId}] JSON keys=[${Object.keys(bodyPayload).join(",")}]`);
        } else if (contentType.includes("multipart/form-data")) {
            const fd = await clonedReq.formData().catch(() => null);
            if (fd) {
                formPayload = {};
                for (const [k, v] of fd.entries()) {
                    if (typeof v === "string") formPayload[k] = v;
                    else formPayload[k] = `[blob name=${(v as File).name} type=${(v as File).type} size=${(v as File).size}]`;
                }
                console.log(`[REQ ${requestId}] FORM keys=[${Object.keys(formPayload).join(",")}]`);
                // Attempt to parse 'payload' or 'data' field as JSON if present
                if (typeof formPayload.payload === 'string') {
                    try { bodyPayload = JSON.parse(formPayload.payload); } catch { }
                } else if (typeof formPayload.data === 'string') {
                    try { bodyPayload = JSON.parse(formPayload.data); } catch { }
                } else {
                    // Fallback: use form fields as bodyPayload
                    bodyPayload = { ...formPayload, ...bodyPayload };
                }
            }
        }
    } catch (e) {
        console.warn(`[REQ ${requestId}] Top-level parse failed`, e);
    }

    // ========================================================================
    // TOP LEVEL METADATA EXTRACTION
    // ========================================================================
    // Helper to find first non-empty string in candidates
    const pickFirst = (...args: (string | undefined | null)[]) => args.find(a => a && typeof a === 'string' && a.trim().length > 0) || "";

    // Normalize commonly used fields
    const pJobId = pickFirst(bodyPayload?.job_id, bodyPayload?.jobId, formPayload?.job_id, formPayload?.jobId);
    const pFileId = pickFirst(bodyPayload?.file_id, bodyPayload?.fileId, bodyPayload?.file?.id, formPayload?.file_id);

    // Extract file metadata from payload (if file object exists) or flat fields
    const fileObj = bodyPayload?.file || bodyPayload?.files?.[0] || {};
    const pSPath = pickFirst(fileObj.storage_path, bodyPayload?.storage_path, formPayload?.storage_path);
    const pOrig = pickFirst(fileObj.original_filename, bodyPayload?.original_filename, formPayload?.original_filename);
    const pMime = pickFirst(fileObj.content_type, fileObj.mime_type, bodyPayload?.content_type, formPayload?.content_type).toLowerCase();
    const pKind = pickFirst(fileObj.file_kind, bodyPayload?.file_kind, formPayload?.file_kind).toLowerCase();

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // [REMOVED] TOP LEVEL PDF DETECTION - Replaced by deterministic routing in file loop
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    let jobIdString: string | null = null;
    let supabaseForError: SupabaseClient | null = null;
    let timeoutId: any;
    let hbTimer: any = null;
    const HARD_TIMEOUT_MS = 90_000;

    const stopHeartbeat = () => {
        if (hbTimer) {
            clearInterval(hbTimer);
            hbTimer = null;
        }
    };

    try {
        const mainPromise = (async (): Promise<Response> => {
            // 1. Extração do jobId
            try {
                const url = new URL(req.url);
                jobIdString = url.searchParams.get("jobId") || url.searchParams.get("job_id");
            } catch { /* ignore */ }

            if (!jobIdString) {
                try {
                    const text = await req.text();
                    if (text && text.trim().length > 0) {
                        const body = JSON.parse(text);
                        jobIdString = safeTrim(body.jobId || body.job_id);
                    }
                } catch { /* ignore */ }
            }

            const jobId = safeTrim(jobIdString);
            if (!jobId) return jsonResponse({ error: "Missing job_id" }, 400, req);

            // 2. Setup
            const supabase = getSupabase();
            supabaseForError = supabase;

            // [NEW] Service Client for Global Watchdog (bypass RLS/Auth context)
            const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
                auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
            });

            const startHeartbeat = () => {
                if (hbTimer) return;
                hbTimer = setInterval(async () => {
                    try {
                        await supabase
                            .from('import_jobs')
                            .update({ updated_at: new Date().toISOString(), current_step: 'processing_heartbeat' })
                            .eq('id', jobId)
                            .eq('status', 'processing');
                    } catch (e) {
                        console.warn(`[REQ ${requestId}] heartbeat failed`, e);
                    }
                }, 30_000);
            };

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // GLOBAL WATCHDOG: STAGE B ZERO-ITEMS SWEEP
            // Runs on EVERY invocation to clean up stuck jobs.
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            try {
                // 1. Fetch processing jobs (Limit 20 for perf)
                const { data: stuckCandidates, error: fetchErr } = await serviceClient
                    .from('import_jobs')
                    .select('id, document_context')
                    .eq('status', 'processing')
                    .order('updated_at', { ascending: true }) // Oldest first
                    .limit(20);

                if (fetchErr) {
                    console.error('[GLOBAL_WATCHDOG][FATAL] Failed to fetch candidates', fetchErr);
                } else if (stuckCandidates && stuckCandidates.length > 0) {
                    console.log(`[GLOBAL_WATCHDOG] Checking ${stuckCandidates.length} jobs for Stage B stall:Ids=${stuckCandidates.map(j => j.id.substring(0, 8)).join(',')}`);

                    for (const candJob of stuckCandidates) {
                        // Skip if it's the current job (will be handled by main logic)
                        if (candJob.id === jobId) continue;

                        // 2. Fetch files
                        const { data: cFiles } = await serviceClient
                            .from('import_files')
                            .select('id, metadata')
                            .eq('job_id', candJob.id);

                        if (!cFiles || cFiles.length === 0) continue;

                        // 3. Evaluate Condition
                        const allV1 = cFiles.every((f: any) => {
                            const meta = f.metadata || {};
                            // If Stage A found candidates, Stage B MUST have version "v1"
                            const hasCandidates = (meta.stageA?.candidate_count || 0) > 0;
                            if (!hasCandidates) return true;
                            return meta.stageB?.version === 'v1' || meta.stageB?.skipped === true || meta.stageB?.error;
                        });

                        const allZero = cFiles.every((f: any) => {
                            const meta = f.metadata || {};
                            const count = meta.stageB?.item_count;
                            return (count === undefined || count === null || count === 0);
                        });

                        const anyCandidates = cFiles.some((f: any) => {
                            const meta = f.metadata || {};
                            return (meta.stageA?.candidate_count || 0) > 0;
                        });

                        if (allV1 && allZero && anyCandidates) {
                            console.log(`[GLOBAL_WATCHDOG] ATTEMPTING FINALIZE STUCK JOB ${candJob.id} (Stage B 0 items)`);

                            const nowIso = new Date().toISOString();
                            const failureReason = "NO_ITEMS_EXTRACTED: stageB_no_items";
                            const failureUserMsg = "IA analisou os candidatos mas não conseguiu estruturar itens válidos.";

                            const updatePayload = {
                                status: "done",
                                stage: "ocr_failed", // Explicit override
                                last_error: failureReason,
                                error_message: failureUserMsg,
                                result_budget_id: null, // Explicit null
                                finalized_at: nowIso,
                                stage_updated_at: nowIso,
                                updated_at: nowIso,
                                current_step: "waiting_user_extraction_failed", // Explicit override
                                document_context: {
                                    ...candJob.document_context,
                                    debug_info: {
                                        ...(candJob.document_context?.debug_info || {}),
                                        stage: "waiting_user_extraction_failed",
                                        last_checkpoint: "global_watchdog_stageb",
                                        reason: failureReason,
                                        ai_items_count: 0,
                                        extraction_done: true
                                    }
                                }
                            };

                            console.log(`[GLOBAL_WATCHDOG] Finalizing ${candJob.id} with payload:`, JSON.stringify(updatePayload));

                            const { data: updData, error: updErr } = await serviceClient
                                .from("import_jobs")
                                .update(updatePayload)
                                .eq("id", candJob.id)
                                .eq("status", "processing") // Ensuring only processing jobs are updated
                                .select('id, status, last_error');

                            if (updErr) {
                                console.error('[FINALIZE][STAGE-B-0][FATAL] Update failed:', updErr);
                            } else {
                                console.log('[FINALIZE][STAGE-B-0][SUCCESS]', { jobId: candJob.id, updated: updData?.length, data: updData });
                            }
                        }
                    }
                }
            } catch (wdErr) {
                console.warn("[GLOBAL_WATCHDOG] Error during sweep:", wdErr);
                // Non-blocking
            }
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

            // MINI-HEARTBEAT MANUAL (Checkpoint)
            let lastCheckpointAt = Date.now();
            const CHECKPOINT_MS = 15_000;
            const checkpoint = async (step: string) => {
                if (Date.now() - lastCheckpointAt < CHECKPOINT_MS) return;
                lastCheckpointAt = Date.now();

                // yield event loop
                await new Promise(r => setTimeout(r, 0));

                try {
                    console.log(`[REQ ${requestId}] Checkpoint: ${step}`);
                    await supabase
                        .from('import_jobs')
                        .update({ updated_at: new Date().toISOString(), current_step: step })
                        .eq('id', jobId)
                        .eq('status', 'processing');
                } catch (e) {
                    console.warn(`[REQ ${requestId}] checkpoint failed`, e);
                }
            };

            startHeartbeat();
            try {
                await updateJob(supabase, jobId, { progress: 1, current_step: 'starting' });
            } catch (e) {
                console.warn(`[REQ ${requestId}] initial updateJob failed`, e);
            }
            // A) Validação de ambiente
            if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
                return jsonResponse({ error: "Server misconfigured (Supabase env missing)" }, 500, req);
            }
            // GEMINI_API_KEY check removed (Orchestrator Mode)

            // B) Gemini Model Setup REMOVED (Delegated to workers)
            // 🚨 Checkpoint: before_load_files (Skipping model discovery)
            await setCheckpoint(supabase, jobId, "before_load_files");

            // C) Carregamento de Job e Arquivos WITH TIMEOUT

            console.log(`[REQ ${requestId}] Load job/files`, { jobId });
            const { job, files } = await withTimeout(
                loadJobAndFiles(supabase, jobId),
                15_000,
                "load_files"
            );

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // [NEW] STAGE B TERMINAL CHECK (EARLY & UNCONDITIONAL)
            // Fix for "Stalled Jobs": If Stage B finished (v1) but found 0 items,
            // we MUST finalize the job regardless of parse_tasks status.
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            const stageB_done = files.every((f: any) => {
                const meta = f.metadata || {};
                // If Stage A found candidates, Stage B MUST have version "v1"
                const hasCandidates = (meta.stageA?.candidate_count || 0) > 0;
                if (!hasCandidates) return true; // Not a Stage B candidate file
                return meta.stageB?.version === 'v1' || meta.stageB?.skipped === true || meta.stageB?.error;
            });

            const stageB_zero_items = files.every((f: any) => {
                const meta = f.metadata || {};
                return (meta.stageB?.item_count || 0) === 0;
            });

            const stageA_had_candidates = files.some((f: any) => {
                const meta = f.metadata || {};
                return (meta.stageA?.candidate_count || 0) > 0;
            });

            if (stageB_done && stageB_zero_items && stageA_had_candidates && job.status !== 'done') {
                const stageBItemsSum = files.reduce((acc, f) => acc + (((f.metadata as any)?.stageB?.item_count) || 0), 0);
                // [REQ] Log explícito
                console.log(`[FINALIZE][STAGE-B-0] job=${jobId} files=${files.length} stageA_sum=N/A stageB_sum=${stageBItemsSum} => marking done waiting_user_extraction_failed`);

                const nowIso = new Date().toISOString();
                const failureReason = "NO_ITEMS_EXTRACTED: stageB_no_items";
                const failureUserMsg = "IA analisou os candidatos mas não conseguiu estruturar itens válidos.";

                // Only update if not already terminal to ensure idempotency
                // [FIX] Use serviceClient to guarantee permissions
                const { error: termErr } = await serviceClient
                    .from("import_jobs")
                    .update({
                        status: "done",
                        stage: "ocr_failed", // Explicit override
                        current_step: "waiting_user_extraction_failed", // Explicit override
                        error_message: failureUserMsg,
                        last_error: failureReason,
                        result_budget_id: null, // Explicit null
                        finalized_at: nowIso,
                        stage_updated_at: nowIso,
                        updated_at: nowIso,
                        document_context: {
                            ...job.document_context,
                            debug_info: {
                                ...(job.document_context?.debug_info || {}),
                                stage: "waiting_user_extraction_failed",
                                last_checkpoint: "waiting_user_extraction_failed_early_stageb",
                                reason: failureReason,
                                ai_items_count: 0,
                                extraction_done: true
                            }
                        }
                    })
                    .eq("id", jobId)
                    .neq("status", "done");

                if (termErr) {
                    console.error('[FINALIZE][STAGE-B-0][FATAL] Update failed:', termErr);
                } else {
                    return jsonResponse({
                        message: "Job finalized early (Stage B 0 items)",
                        status: "done",
                        stage: "ocr_failed"
                    }, 200, req);
                }
            }



            // --- SAFETY GUARD: RATE LIMIT ACTIVE ---
            if (job.document_context?.rate_limited === true) {
                console.warn(`[REQ ${requestId}] SKIPPING: Job is in RATE_LIMITED state.`);
                return jsonResponse({
                    type: "RATE_LIMITED",
                    provider: "gemini",
                    status: "waiting_user_rate_limited",
                    message: "O processamento está pausado devido ao limite de taxa da IA."
                }, 200, req);
            }

            // 🚨 Checkpoint: before_initial_update
            await setCheckpoint(supabase, jobId, "before_initial_update");

            await withTimeout(
                updateJob(supabase, jobId, {
                    status: "processing",
                    progress: 5,
                    current_step: "download_and_parse",
                    error_message: null,
                    // 🛡️ IMMEDIATE CONTEXT PERSISTENCE
                    document_context: {
                        ...(job.document_context || {}),
                        debug_info: {
                            ...((job.document_context as any)?.debug_info || {}),
                            stage: "starting",
                            start_ts: new Date().toISOString(),
                            soft_timeout_deadline_ms: SOFT_DEADLINE_MS,
                            last_checkpoint: "after_auth", // This will be overwritten by next checkpoints in debug logic
                            auth_checked: authCheckTrace
                        }
                    }
                }),
                15_000,
                "initial_update"
            );

            checkSoftTimeout(processStartMs, "after_initial_update");

            // Variable cleanup

            // D) Loop de Processamento de Arquivos: ORCHESTRATOR MODE (Delegation Only)
            // 🚨 Checkpoint: before_file_loop
            await setCheckpoint(supabase, jobId, "before_file_loop");

            for (let i = 0; i < files.length; i++) {
                const file = files[i];

                // Per-file try-catch: Ensure one file's failure doesn't block others
                try {
                    // Security check (should throw to block entire job if violated)
                    if (file.user_id !== job.user_id) throw new Error("Security check failed");

                    await updateJob(supabase, jobId, {
                        progress: Math.min(10 + i * 10, 80),
                        current_step: `delegating_file_${i + 1}_of_${files.length}`,
                    });

                    // 🚨 Checkpoint: ensure_task_persistence
                    // ensureParseTaskForFile handles the logic: SELECT check -> INSERT if missing (idempotent)
                    const task = await ensureParseTaskForFile(supabase, jobId, file.id, requestId);

                    // Update metadata with task_id if relevant (defensive merge)
                    if (task && task.id) {
                        await supabase.from("import_files").update({
                            metadata: {
                                ...(file.metadata || {}),
                                routing: {
                                    ...((file.metadata as any)?.routing || {}),
                                    task_id: task.id,
                                    task_ensured_at: new Date().toISOString()
                                }
                            }
                        }).eq("id", file.id);
                    }

                    // 🚨 Checkpoint: delegating_to_worker (KICK)
                    await setCheckpoint(supabase, jobId, `delegating_file_${file.id}`);

                    console.log(`[REQ ${requestId}] Delegating file ${file.id} (${file.storage_path}) to import-ocr-fallback (KICK)`);

                    // --- PATCH: OBSERVABILITY --
                    // 1. Mark started BEFORE call
                    const nowIso = new Date().toISOString();
                    console.log(`[IMPORT-PROCESSOR] checkpoint=delegate_mark_started file_id=${file.id} job_id=${jobId}`);


                    // --- RE-FETCH METADATA TO AVOID RACE CONDITION ---
                    const { data: latestFile, error: refreshErr } = await supabase
                        .from("import_files")
                        .select("metadata")
                        .eq("id", file.id)
                        .single();

                    const currentMetadata = latestFile?.metadata || file.metadata || {};

                    const { error: updateErr } = await supabase.from("import_files").update({
                        extraction_status: 'queued',
                        extracted_started_at: nowIso,
                        // extraction_method: 'edge_import_ocr_fallback', // REMOVED: Column does not exist
                        metadata: {
                            ...currentMetadata,
                            routing: {
                                ...(currentMetadata.routing || {}),
                                task_id: task?.id || null,
                                delegated_at: nowIso,
                                delegate_attempt: 1,
                                delegate_target: "import-ocr-fallback"
                            }
                        }
                    }).eq("id", file.id);

                    if (updateErr) {
                        console.error(`[IMPORT-PROCESSOR] Failed to mark file ${file.id} as queued: ${updateErr.message}`);
                        // We continue anyway to attempt delegation, but log loudly
                    }


                    // =========================================================
                    // DELEGATION: Call import-ocr-fallback (Fire-and-Forget KICK)
                    // =========================================================
                    const ocrFallbackUrl = `${SUPABASE_URL}/functions/v1/import-ocr-fallback`;

                    // Use new helper
                    const delegateResult = await fireAndForgetDelegate({
                        url: ocrFallbackUrl,
                        headers: {
                            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                            'x-internal-call': '1',
                            'x-ocr-enqueue-only': '1',
                            'x-user-id': authenticatedUserId,
                            'x-job-id': jobId
                        },
                        payload: {
                            job_id: jobId,
                            file_id: file.id,
                            storage_path: file.storage_path,
                            content_type: file.content_type
                        },
                        requestId,
                        fileId: file.id
                    });

                    // --- PATCH: RESULT HANDLING (Step A & B & C) ---
                    console.log(`[IMPORT-PROCESSOR] checkpoint=delegate_ack ok=${delegateResult.success} status=${delegateResult.status} file_id=${file.id}`);

                    if (delegateResult.success) {
                        // SUCCESS - HTTP OK
                        // We DO NOT check import_ocr_jobs here anymore (Race Condition Fix)
                        // We trust the HTTP 200 means "Request Received".
                        // The Watchdog (later) will catch if it never appears in the queue.

                        await supabase.from("import_files").update({
                            // Status remains 'queued' (set before call)
                            metadata: {
                                ...(file.metadata || {}),
                                routing: {
                                    ...((file.metadata as any)?.routing || {}),
                                    delegate_ok: true,
                                    delegate_http_status: delegateResult.status,
                                    delegate_attempted_at: new Date().toISOString()
                                }
                            }
                        }).eq("id", file.id);

                    } else {
                        // FAILURE - HTTP Error
                        console.error(`[REQ ${requestId}] Delegation FAILED: ${delegateResult.error}`);
                        await supabase.from("import_files").update({
                            extraction_status: 'failed', // CP2: Fail immediately on HTTP error
                            extraction_last_error: `ocr_delegation_http_${delegateResult.status}_${delegateResult.error}`,
                            extracted_completed_at: new Date().toISOString(),
                            metadata: {
                                ...(file.metadata || {}),
                                routing: {
                                    ...((file.metadata as any)?.routing || {}),
                                    delegate_ok: false,
                                    delegate_http_status: delegateResult.status,
                                    delegate_error: delegateResult.error,
                                    delegate_response_sample: delegateResult.bodySample
                                }
                            }
                        }).eq("id", file.id);
                    }

                    // 🚨 Checkpoint: delegated_file
                    await setCheckpoint(supabase, jobId, `delegated_file_${file.id}`);

                } catch (fileErr: any) {
                    // =========================================================
                    // PER-FILE ERROR HANDLING: Mark failed but CONTINUE loop
                    // =========================================================
                    const errMsg = fileErr instanceof Error ? fileErr.message : String(fileErr);
                    console.error(`[REQ ${requestId}] Delegation loop error for file ${file.id}: ${errMsg}`);

                    // Security check failure should propagate (special case)
                    if (errMsg === "Security check failed") {
                        throw fileErr;
                    }

                    // Mark this specific file as failed, but continue to next file
                    try {
                        await supabase.from("import_files").update({
                            extraction_status: 'failed',
                            extraction_last_error: `delegation_loop_error: ${errMsg}`.substring(0, 500),
                            extracted_completed_at: new Date().toISOString(),
                            metadata: {
                                ...(file.metadata || {}),
                                routing: {
                                    ...((file.metadata as any)?.routing || {}),
                                    delegate_ok: false,
                                    delegate_error: errMsg,
                                    delegate_attempted_at: new Date().toISOString()
                                }
                            }
                        }).eq("id", file.id);
                    } catch (updateErr) {
                        console.error(`[REQ ${requestId}] Failed to update file ${file.id} with error status:`, updateErr);
                    }

                    // CONTINUE to next file (no throw)
                }
            }


            // 🛡️ CONSISTENCY CHECK: Verify tasks created
            const { count: taskCount, error: countDescErr } = await supabase
                .from('import_parse_tasks')
                .select('*', { count: 'exact', head: true })
                .eq('job_id', jobId);

            if (countDescErr || (taskCount || 0) < files.length) {
                console.error(`[REQ ${requestId}] CRITICAL: Delegation incomplete. Files: ${files.length}, Tasks: ${taskCount}`);
                await updateJob(supabase, jobId, {
                    current_step: "delegation_incomplete_tasks",
                    document_context: {
                        ...(job.document_context || {}),
                        debug_info: {
                            ...((job.document_context as any)?.debug_info || {}),
                            stage: "delegation_incomplete_tasks",
                            error: "Task creation mismatch"
                        }
                    },
                    error_message: "System failure: extraction tasks not persisted."
                });
                // Throw to trigger error handler
                throw new Error(`Integrity Check Failed: Files=${files.length}, Tasks=${taskCount}`);
            }

            // 🚨 Checkpoint: PARSE_TASK_ENSURE_DONE
            console.log(`[REQ ${requestId}] PARSE_TASK_ENSURE_DONE {job_id: ${jobId}, files_processed: ${files.length}, tasks_found: ${taskCount}}`);

            // 🛡️ INVARIANT CHECK: Verify all files received delegation attempts
            try {
                const { data: filesCheck } = await supabase
                    .from('import_files')
                    .select('id, metadata')
                    .eq('job_id', jobId);

                const undelegated = (filesCheck || []).filter((f: any) =>
                    !f.metadata?.routing?.delegated_at &&
                    !f.metadata?.routing?.delegate_error
                );

                if (undelegated.length > 0) {
                    console.error(`[INVARIANT_VIOLATION] ${undelegated.length} files never received delegation attempt: ${undelegated.map((f: any) => f.id).join(', ')}`);
                    // Log but don't fail - the watchdog will catch these
                }
            } catch (invErr) {
                console.warn(`[INVARIANT_CHECK] Failed to verify delegations:`, invErr);
            }


            // 🚨 Checkpoint: delegation_done
            await setCheckpoint(supabase, jobId, "delegation_done");

            // FINAL UPDATE: Job remains processing. Worker(s) will update to done/failed.
            // We just exit cleanly.
            await updateJob(supabase, jobId, {
                current_step: "delegation_done",
                document_context: {
                    ...(job.document_context || {}),
                    debug_info: {
                        ...((job.document_context as any)?.debug_info || {}),
                        stage: "delegation_done",
                        last_checkpoint: "delegation_done"
                    }
                }
            });

            // --- ZOMBIE JOB WATCHDOG ---
            console.log(`[REQ ${requestId}] CLOSEOUT_START`);
            const taskStats = await waitForParseTasksToSettle(supabase, jobId, requestId);

            // Fetch files to check for STUCK jobs (Legacy strategy)
            const { data: watchdogFiles, error: wdFilesErr } = await supabase
                .from('import_files')
                .select('id, extraction_status, extracted_completed_at, extracted_started_at, metadata')
                .eq('job_id', jobId);

            // Stage B Terminal Check was MOVED to the beginning of handleRequest.
            // We now focus on parse_tasks settlement and stuck job detection.
            let forceStageBTerminal = false; // Legacy flag if needed downstream, but usually MOVED logic returns early.

            if (taskStats.settled || forceStageBTerminal) {
                const aiCount = await countAiItems(supabase, jobId);

                if (aiCount === 0 || forceStageBTerminal) {
                    // If forced by Stage B logic, ensure we define specific reason
                    const isStageBStall = forceStageBTerminal;

                    // --- PATCH START: Search for pending files (EXTRACTION GATING) ---
                    console.log(`[IMPORT-PROCESSOR] checkpoint=watchdog_check job_id=${jobId} forceStageB=${forceStageBTerminal}`);

                    let extraction_done = false;

                    if (wdFilesErr) {
                        console.error('[IMPORT-PROCESSOR] Watchdog file fetch failed, assuming NOT done', wdFilesErr);
                        extraction_done = false;
                    } else {
                        const safeFiles = watchdogFiles || [];

                        // 1. Stuck Job Detection (Step D)
                        const GRACE_PERIOD_MS = 4 * 60 * 1000; // 4 minutes
                        const nowMs = Date.now();

                        for (const f of safeFiles) {
                            if (['queued', 'processing'].includes(f.extraction_status)) {
                                if (f.extracted_started_at) {
                                    const startedMs = new Date(f.extracted_started_at).getTime();
                                    const elapsed = nowMs - startedMs;

                                    if (elapsed > GRACE_PERIOD_MS) {
                                        // Check for worker entry (Metadata from Step E)
                                        const workerEntered = f.metadata?.debug?.worker_entered_at || f.metadata?.ocr?.worker_entered_at;

                                        if (!workerEntered) {
                                            // Check for Queue Row (Async) - ROBUST CHECK
                                            // We use limit(1) instead of maybeSingle() to handle multiple rows without error
                                            const { data: qRows, error: qErr } = await supabase
                                                .from('import_ocr_jobs')
                                                .select('id')
                                                .eq('import_file_id', f.id)
                                                .limit(1);

                                            // Explicit boolean derivation
                                            const hasQueue = Array.isArray(qRows) && qRows.length > 0;

                                            // If no queue row AND query was successful -> STUCK
                                            if (!hasQueue && !qErr) {
                                                console.error(`[WATCHDOG] STUCK JOB DETECTED: File ${f.id} elapsed=${elapsed}ms. marking failed.`);

                                                await supabase.from('import_files').update({
                                                    extraction_status: 'failed',
                                                    extraction_last_error: 'ocr_delegation_stuck_no_worker_no_queue',
                                                    extracted_completed_at: new Date().toISOString()
                                                }).eq('id', f.id);

                                                // Update local state for immediate "done" check
                                                f.extraction_status = 'failed';
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // 2. Final Done Check
                        // Logic must match worker: all files either completed OR in terminal status
                        extraction_done = safeFiles.length > 0 && safeFiles.every((f: any) =>
                            f.extracted_completed_at !== null ||
                            ['done', 'failed', 'skipped'].includes(f.extraction_status)
                        );

                        // Override if Stage B forced it
                        if (forceStageBTerminal) extraction_done = true;

                        console.log(`[IMPORT-PROCESSOR] checkpoint=watchdog_result extraction_done=${extraction_done} total_files=${safeFiles.length} forceStageB=${forceStageBTerminal}`);
                    }

                    if (!extraction_done) {
                        console.log(`[IMPORT-PROCESSOR] checkpoint=watchdog_skipped_waiting_extraction job_id=${jobId}`);
                        // DO NOT MARK FAILED. Just checkpoint and exit.
                        // The background worker/cron will pick it up later.
                        await setCheckpoint(supabase, jobId, "watchdog_skipped_waiting_extraction");

                        return jsonResponse({
                            ok: true,
                            job_id: jobId,
                            status: "processing",
                            message: "Files delegated, watchdog skipped (extraction pending)"
                        }, 200, req);
                    }
                    // --- PATCH END ---

                    console.log(`[REQ ${requestId}] CLOSEOUT_NO_ITEMS: All tasks done/failed (or forced), but 0 items found. Terminating job.`);

                    const nowIso = new Date().toISOString();

                    const failureReason = isStageBStall ? "NO_ITEMS_EXTRACTED: stageB_no_items" : "NO_ITEMS_EXTRACTED: zombie_watchdog_no_items";
                    const failureUserMsg = isStageBStall ? "IA analisou os candidatos mas não conseguiu estruturar itens válidos." : "NO_ITEMS_EXTRACTED: Nenhum item foi extraído ou inserido com sucesso. Verifique o arquivo.";

                    // 3. Mark job as DONE (terminal state) with specific reason
                    // This prevents it from being picked up again by the watchdog loop
                    const { error: updateJobErr } = await supabase
                        .from("import_jobs")
                        .update({
                            status: "done",
                            stage: "ocr_failed",
                            current_step: "waiting_user_extraction_failed",
                            error_message: failureUserMsg,
                            last_error: failureReason,
                            stage_updated_at: nowIso,
                            updated_at: nowIso,
                            document_context: {
                                ...job.document_context,
                                debug_info: {
                                    ...(job.document_context?.debug_info || {}),
                                    stage: "waiting_user_extraction_failed",
                                    last_checkpoint: "waiting_user_extraction_failed",
                                    reason: failureReason,
                                    tasks_summary: taskStats,
                                    ai_items_count: 0,
                                    extraction_done: true // Confirm we checked
                                }
                            }
                        })
                        .eq("id", jobId);
                } else {
                    console.log(`[REQ ${requestId}] CLOSEOUT_OK_AI_ITEMS_PRESENT count=${aiCount}`);
                }
            } else {
                console.log(`[REQ ${requestId}] CLOSEOUT_SKIPPED_TASKS_NOT_SETTLED (Running: ${taskStats.running}, Total: ${taskStats.total})`);
            }

            return jsonResponse({
                ok: true,
                job_id: jobId,
                status: "processing",
                message: "Files delegated for background processing"
            }, 200, req);

            // (Old conclusion cleaned up)
        })();

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("timeout_hard_90s")), HARD_TIMEOUT_MS);
        });

        return await Promise.race([mainPromise, timeoutPromise]);

    } catch (globalErr) {
        const rawMsg = globalErr instanceof Error ? globalErr.message : String(globalErr);
        console.error(`[REQ ${requestId}] ERROR CAUGHT: ${rawMsg}`);
        const supabase = supabaseForError || getSupabase();

        // --- SOFT TIMEOUT HANDLING (Graceful Exit) ---
        if (globalErr instanceof SoftTimeoutError) {
            console.warn(`[REQ ${requestId}] Soft Timeout Triggered! Checkpoint: ${globalErr.context.checkpoint}, Elapsed: ${globalErr.context.elapsed_ms}ms`);

            if (jobIdString && supabaseForError) {
                try {
                    // Try to load latest context
                    const { data: currJob } = await supabase.from('import_jobs').select('document_context').eq('id', jobIdString).single();
                    const existingCtx = currJob?.document_context || {};
                    const debugInfo = {
                        soft_timeout_elapsed_ms: globalErr.context.elapsed_ms,
                        last_checkpoint: globalErr.context.checkpoint
                    };

                    return await finalizeTimeout(supabase, jobIdString, existingCtx, debugInfo, "soft_timeout", req);
                } catch (recErr) {
                    console.error("Failed to recover from soft timeout", recErr);
                    // Fallthrough to generic error handler
                }
            }
        }

        // --- RATE LIMIT HANDLING ---
        if (globalErr instanceof RateLimitError || rawMsg.includes("RateLimitHit") || rawMsg.includes("429")) {
            console.warn(`[REQ ${requestId}] Rate Limit Detected in Global Catch.`);
            if (jobIdString && supabaseForError) {
                try {
                    // Fetch current context to avoid overwrite
                    const { data: currJob } = await supabase.from('import_jobs').select('document_context').eq('id', jobIdString).single();
                    const existingContext = currJob?.document_context || {};

                    const rateLimitInfo = {
                        rate_limited: true,
                        rate_limit: {
                            provider: "gemini",
                            model: "gemini-1.5-flash",
                            retry_after_seconds: 45,
                            last_error: rawMsg,
                            occurred_at: new Date().toISOString()
                        },
                        user_action: {
                            required: true,
                            reason: "rate_limit",
                            message: "Limite temporário da IA atingido. Aguarde cerca de 45 segundos e tente novamente."
                        }
                    };

                    await updateJob(supabase, jobIdString, {
                        status: "waiting_user_rate_limited",
                        current_step: "paused_rate_limit",
                        error_message: "Rate Limit Exceeded (429)",
                        document_context: {
                            ...existingContext,
                            ...rateLimitInfo
                        }
                    });
                } catch (updErr) {
                    console.error("Failed to update job for Rate Limit", updErr);
                }
            }
            return jsonResponse({
                type: "RATE_LIMITED",
                provider: "gemini",
                model: "gemini-1.5-flash",
                retry_after_seconds: 45,
                message: "Limite temporário da IA atingido."
            }, 200, req);
        }

        let finalStatus: ImportJobStatus = "failed";
        let finalStep = "failed";
        let userAction = null;

        // TIMEOUT OR GENERIC ERROR -> RECOVER TO MANUAL
        // Phase 3 Requirement: Never show 500 for extraction failures.
        // Always allow manual fallback.

        // TIMEOUT OR GENERIC ERROR -> RECOVER TO MANUAL
        // Check if it's a timeout-like error
        const isTimeout = rawMsg === "timeout_hard_90s" || rawMsg.includes("timeout") || rawMsg.includes("DeadlineExceeded") || rawMsg.startsWith("TIMEOUT_STEP:");

        // Extract label if it's a step timeout
        let exactReason = rawMsg;
        if (rawMsg.startsWith("TIMEOUT_STEP:")) {
            const label = rawMsg.split(":")[1] || "unknown";
            exactReason = `post_auth_step_timeout:${label}`;
        } else if (rawMsg === "timeout_hard_90s") {
            exactReason = "timeout_hard_90s";
        } else if (isTimeout) {
            exactReason = "timeout_extraction";
        } else {
            exactReason = "extraction_error";
        }

        const reason = exactReason;
        console.warn(`[REQ ${requestId}] Recovering from error: ${rawMsg} (reason=${reason})`);

        if (jobIdString) {
            try {
                // Load latest context to preserve data
                const { data: currJob } = await supabase.from('import_jobs').select('document_context').eq('id', jobIdString).single();
                const existingCtx = currJob?.document_context || {};

                const debugInfo = {
                    last_error_caught: rawMsg,
                    recovered_in_catch: true
                };

                // DELEGATE TO centralized finalizeTimeout
                return await finalizeTimeout(supabase, jobIdString, existingCtx, debugInfo, reason, req);

            } catch (dbErr) {
                console.error("[REQ] Failed to save error recovery state", dbErr);
                // Last ditch effort: return 200 with error info so UI doesn't hang
                return jsonResponse({
                    ok: false,
                    recovered: false,
                    status: "failed", // If we can't even check DB, we fail.
                    job_id: jobIdString,
                    message: "Falha crítica na recuperação de erro."
                }, 200, req);
            }
        }

        // Fallback if no jobId
        return jsonResponse({
            ok: false,
            error: "unknown_error_no_jobid",
            message: rawMsg
        }, 500, req);

    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        stopHeartbeat();
    }
}
