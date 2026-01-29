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
// 6) Persiste items -> import_items (staging)
// 7) Atualiza status do job: waiting_user (sucesso) / failed (erro)
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0";
import { z } from "https://esm.sh/zod@3.23.8";
// PDF.js via ESM.sh - Deno compatible (no node:buffer dependency)
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.0.379/build/pdf.min.mjs";

// Disable worker for Edge Runtime (single-threaded)
// @ts-ignore - GlobalWorkerOptions exists at runtime
pdfjsLib.GlobalWorkerOptions.workerSrc = "";

// -----------------------------
// Env
// -----------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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
type ImportJobStatus = "queued" | "processing" | "waiting_user" | "applying" | "done" | "failed";
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

function guessMimeType(file: ImportFileRow): string {
    const ct = safeTrim(file.content_type);
    if (ct) return ct;

    // fallback by file_kind or extension
    const path = file.storage_path.toLowerCase();
    if (file.file_kind === "pdf" || path.endsWith(".pdf")) return "application/pdf";
    if (file.file_kind === "excel" || path.endsWith(".xlsx")) {
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
    if (path.endsWith(".xls")) return "application/vnd.ms-excel";
    return "application/octet-stream";
}

async function calculateSha256(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

async function extractPdfText(
    buffer: Uint8Array,
    onProgress?: () => Promise<void>,
    onMetadata?: (pages: number, info: Record<string, unknown>) => Promise<void>
): Promise<{
    text: string;
    pageCount: number;
    info: Record<string, unknown>;
    method: string;
}> {
    const attemptedAt = new Date().toISOString();

    try {
        // Convert Uint8Array to ArrayBuffer for pdfjs
        const arrayBuffer = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
        );

        // Load PDF document
        const loadingTask = pdfjsLib.getDocument({
            data: arrayBuffer,
            // Disable features not needed for text extraction
            useWorkerFetch: false,
            isEvalSupported: false,
            useSystemFonts: true,
        });

        const pdfDocument = await loadingTask.promise;
        const numPages = pdfDocument.numPages;

        console.log(`[PDF] Document loaded: ${numPages} pages`);

        // Metadata early report
        if (onMetadata) {
            try { await onMetadata(numPages, {}); } catch (e) { console.warn("[PDF] onMetadata cb failed", e); }
        }

        // Extract text from all pages
        const textParts: string[] = [];

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            if (onProgress) {
                try { await onProgress(); } catch (e) { console.warn("[PDF] onProgress cb failed", e); }
            }
            try {
                const page = await pdfDocument.getPage(pageNum);
                const textContent = await page.getTextContent();

                // Concatenate text items
                const pageText = textContent.items
                    .map((item: any) => item.str || "")
                    .join(" ");

                textParts.push(pageText);
            } catch (pageErr) {
                console.warn(`[PDF] Failed to extract page ${pageNum}:`, pageErr);
                textParts.push(""); // Continue with other pages
            }
        }

        const fullText = textParts.join("\n\n");

        // Get metadata if available
        let info: Record<string, unknown> = {};
        try {
            const metadata = await pdfDocument.getMetadata();
            info = metadata?.info || {};
        } catch {
            // Metadata extraction is optional
        }

        return {
            text: fullText,
            pageCount: numPages,
            info,
            method: "pdfjs-dist",
        };
    } catch (e: any) {
        console.error("[PDF] Extraction failed:", e?.message || e);
        throw new Error(`PDF Extraction failed (pdfjs-dist): ${e?.message || String(e)}`);
    }
}

function chunkText(text: string, size = 12000): string[] {
    const chunks: string[] = [];
    let index = 0;
    while (index < text.length) {
        let end = Math.min(index + size, text.length);
        // Try to break at newline
        if (end < text.length) {
            const lastNewline = text.lastIndexOf('\n', end);
            if (lastNewline > index + size * 0.8) {
                end = lastNewline + 1;
            }
        }
        chunks.push(text.slice(index, end));
        index = end;
    }
    return chunks;
}

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
async function resolveGeminiModelName(): Promise<{ modelName: string } | { error: string; allModels: string[] }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;

    console.log("[GEMINI] Discovering available models via HTTP...");

    let response: Response;
    try {
        response = await fetch(url, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        });
    } catch (fetchErr) {
        const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.error("[GEMINI] Fetch failed:", errMsg);
        return { error: `FETCH_FAILED: ${errMsg}`, allModels: [] };
    }

    if (!response.ok) {
        const bodyText = await response.text().catch(() => "(no body)");
        console.error("[GEMINI] List models HTTP error:", response.status, bodyText.slice(0, 500));
        return { error: `HTTP_${response.status}: ${bodyText.slice(0, 200)}`, allModels: [] };
    }

    let data: GeminiListModelsResponse;
    try {
        data = await response.json();
    } catch (jsonErr) {
        console.error("[GEMINI] Failed to parse models JSON:", jsonErr);
        return { error: "JSON_PARSE_FAILED", allModels: [] };
    }

    const models = data.models ?? [];
    const allModelNames = models.map(m => m.name);

    console.log("[GEMINI] All models returned:", allModelNames.slice(0, 20).join(", "), models.length > 20 ? `... (${models.length} total)` : "");

    // Filter models that support generateContent
    const compatibleModels = models.filter(m => {
        const methods = m.supportedGenerationMethods;
        if (!methods || !Array.isArray(methods)) {
            // No supportedGenerationMethods = unknown capability, skip
            return false;
        }
        return methods.includes("generateContent");
    });

    console.log("[GEMINI] Compatible models (generateContent):", compatibleModels.map(m => m.name).join(", ") || "(none)");

    if (compatibleModels.length === 0) {
        return {
            error: "NO_COMPATIBLE_MODELS",
            allModels: allModelNames.slice(0, 50)
        };
    }

    // Selection priority:
    // 1. Prefer model with "gemini" AND "flash" in name
    // 2. Else, first model with "gemini" in name
    // 3. Else, first compatible model

    const geminiFlash = compatibleModels.find(m =>
        m.name.toLowerCase().includes("gemini") && m.name.toLowerCase().includes("flash")
    );
    if (geminiFlash) {
        console.log("[GEMINI] Selected (gemini+flash):", geminiFlash.name);
        return { modelName: geminiFlash.name };
    }

    const geminiAny = compatibleModels.find(m => m.name.toLowerCase().includes("gemini"));
    if (geminiAny) {
        console.log("[GEMINI] Selected (gemini):", geminiAny.name);
        return { modelName: geminiAny.name };
    }

    const firstCompatible = compatibleModels[0];
    console.log("[GEMINI] Selected (first compatible):", firstCompatible.name);
    return { modelName: firstCompatible.name };
}

/**
 * Normaliza o nome do modelo para uso com o SDK.
 * O SDK @google/generative-ai espera nome sem prefixo "models/".
 */
function normalizeModelNameForSDK(fullName: string): string {
    if (fullName.startsWith("models/")) {
        return fullName.replace("models/", "");
    }
    return fullName;
}

// Gemini client
// -----------------------------
type GeminiModelResult =
    | { success: true; model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>; modelName: string }
    | { success: false; error: string; allModels: string[] };

async function getGeminiModel(): Promise<GeminiModelResult> {
    const resolved = await resolveGeminiModelName();

    if ("error" in resolved) {
        // No compatible model found
        const errorMsg = `${resolved.error}: ${resolved.allModels.slice(0, 20).join(", ")}`.slice(0, 800);
        console.error("[GEMINI] No compatible model found:", errorMsg);
        return { success: false, error: errorMsg, allModels: resolved.allModels };
    }

    const fullModelName = resolved.modelName;
    const sdkModelName = normalizeModelNameForSDK(fullModelName);

    console.log("[GEMINI] Using model:", sdkModelName, "(original:", fullModelName + ")");

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: sdkModelName,
        systemInstruction: SYSTEM_PROMPT,
    });

    return { success: true, model, modelName: fullModelName };
}

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

async function downloadStorageFile(supabase: SupabaseClient, file: ImportFileRow): Promise<Uint8Array> {
    const bucket = "imports";
    const objectPath = file.storage_path.replace(/^\/?imports\//, "");

    // Verify existence
    const folder = objectPath.split("/")[0];
    const filename = objectPath.split("/").slice(1).join("/");

    const { data: list, error: listError } = await supabase.storage.from(bucket).list(folder, {
        search: filename || undefined, // undefined if filename is empty string? search expects string?
    });

    if (listError) {
        throw new Error(`Storage list failed bucket=${bucket} prefix=${objectPath}: ${listError.message}`);
    }

    if (!list || list.length === 0) {
        // Debug: list contents of the folder
        const { data: debugList } = await supabase.storage.from(bucket).list(folder, { limit: 20 });
        const existing = debugList ? debugList.map(f => f.name).slice(0, 10).join(", ") : "error_listing";
        throw new Error(`Storage NOT FOUND bucket=${bucket} tried=${objectPath} exists_in_${folder}=[${existing}]`.slice(0, 800));
    }

    console.log("[STORAGE] Download start", { bucket, objectPath, fileId: file.id });

    const { data, error } = await supabase.storage.from(bucket).download(objectPath);

    if (error || !data) {
        console.error("[STORAGE] Download failed", { bucket, objectPath, fileId: file.id, error: safeStringify(error) });
        const details = typeof error === 'object' ? JSON.stringify(error) : String(error);
        throw new Error(`Storage download failed bucket=${bucket} path=${objectPath} details=${details}`);
    }

    const buf = new Uint8Array(await data.arrayBuffer());
    console.log("[STORAGE] Download ok", { bucket, objectPath, bytes: buf.byteLength, fileId: file.id });

    return buf;
}

async function insertImportItems(
    supabase: SupabaseClient,
    job: ImportJobRow,
    file: ImportFileRow,
    parsed: GeminiOutput,
) {
    // Map schema -> import_items
    const rows = parsed.items.map((it) => {
        const source = safeTrim(it.source);
        const detectedBase = source || null;

        const priceSelected = it.unit_price;
        const priceDes = it.price_type === "desonerado" ? it.unit_price : null;
        const priceNao = it.price_type === "nao_desonerado" ? it.unit_price : null;

        return {
            user_id: job.user_id,
            job_id: job.id,
            file_id: file.id,

            code_raw: it.code_raw,
            code: it.code,
            description_normalized: it.description,
            unit: it.unit,
            quantity: it.quantity,

            detected_base: detectedBase,
            is_proprio: source.toUpperCase() === "PROPRIO" || source.toUpperCase() === "PRÓPRIO" || source === "ai_extraction",
            is_desonerado: job.is_desonerado ?? null,

            price_desonerado: priceDes,
            price_nao_desonerado: priceNao,
            price_selected: priceSelected,

            validation_status: "pending",
            confidence_score: it.confidence,

            issues: [],
            source_refs: {},

            raw_ai_json: parsed,        // auditoria do retorno (por arquivo)
            normalized_json: it,        // auditoria por item
        };
    });

    if (rows.length === 0) {
        console.log("[DB] No items to insert for file", { fileId: file.id, jobId: job.id });
        return;
    }

    console.log("[DB] Inserting import_items", { count: rows.length, jobId: job.id, fileId: file.id });

    const { error } = await supabase.from("import_items").insert(rows);

    if (error) {
        console.error("[DB] Insert import_items failed", { jobId: job.id, fileId: file.id, error: safeStringify(error) });
        throw new Error(`DB insert import_items failed: ${error.message}`);
    }
}

// -----------------------------
// Gemini call + validation loop
// -----------------------------
async function callGeminiWithFile(model: any, input: { type: 'bytes', data: Uint8Array, mime: string } | { type: 'text', content: string }) {
    if (input.type === 'bytes') {
        const b64 = btoa(String.fromCharCode(...input.data));
        const result = await model.generateContent([
            {
                inlineData: {
                    data: b64,
                    mimeType: input.mime,
                },
            },
            {
                text: "Extraia e retorne o JSON conforme schema. Lembre: APENAS JSON.",
            },
        ]);
        return result.response.text();
    } else {
        const result = await model.generateContent([
            {
                text: input.content
            },
            {
                text: "\n(FIM DO TRECHO) - Extraia items deste trecho. Se não houver cabeçalho, use padrões."
            }
        ]);
        return result.response.text();
    }
}

async function callGeminiCorrection(
    model: any,
    previousText: string,
    zodError: z.ZodError,
) {
    const errorSummary = buildValidationErrorSummary(zodError);

    const correctionPrompt = `
Seu JSON está INVÁLIDO no schema. Corrija e retorne APENAS um JSON válido.
ERROS DE VALIDAÇÃO (Zod):
${errorSummary}

JSON RECEBIDO (inválido):
${previousText}

REGRAS:
- Retorne APENAS o JSON corrigido.
- Não use markdown, nem crases, nem texto adicional.
`;

    const result = await model.generateContent([{ text: correctionPrompt }]);
    return result.response.text();
}

async function getValidatedGeminiJsonForFile(
    model: any,
    input: { type: 'bytes', data: Uint8Array, mime: string } | { type: 'text', content: string },
): Promise<GeminiOutput> {
    let rawText: string | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            if (attempt === 0) {
                console.log("[GEMINI] generateContent attempt=1");
                rawText = await callGeminiWithFile(model, input);
                console.log(`[GEMINI] Raw response length: ${rawText ? rawText.length : 0}`);
            } else {
                // Correction attempts use the last zod error collected below
                // rawText will be replaced after correction call
            }

            if (!rawText || safeTrim(rawText).length === 0) {
                throw new Error("Gemini returned empty response");
            }

            const parsedUnknown = parseJsonLenient(rawText);
            const safe = GeminiOutputSchema.safeParse(parsedUnknown);

            if (safe.success) {
                // normalize reference_date defensively
                const out = safe.data;
                out.header.reference_date = normalizeReferenceDate(out.header.reference_date);

                return out;
            }

            console.warn("[ZOD] Validation failed", {
                attempt: attempt + 1,
                issues: safe.error.issues.slice(0, 10),
            });

            if (attempt >= 2) {
                throw new Error(`Zod validation failed after retries:\n${buildValidationErrorSummary(safe.error)}`);
            }

            // Ask Gemini to correct
            console.log("[GEMINI] correction attempt", { attempt: attempt + 1 });
            rawText = await callGeminiCorrection(model, extractJsonFromModelText(rawText), safe.error);
            // loop continues, next iteration will parse and validate `rawText` again
            const parsedUnknown2 = parseJsonLenient(rawText);
            const safe2 = GeminiOutputSchema.safeParse(parsedUnknown2);
            if (safe2.success) {
                const out = safe2.data;
                out.header.reference_date = normalizeReferenceDate(out.header.reference_date);
                return out;
            }

            // If still invalid, keep looping (attempt increments)
            // Store updated rawText and let next iteration correct again using safe2.error
            rawText = extractJsonFromModelText(rawText);
            // Replace rawText with a combined prompt-like; but we keep it as "previousText"
            // We'll just continue; next iteration will rerun correction based on safe2.error
            // To do that, we need to call correction directly here and continue.
            // But we already did once per iteration; so let loop go around:
            //   - it will go to correction again if still invalid.
            // We'll set rawText as invalid JSON (string) and handle again:
            // However, our loop structure calls correction inside same iteration only once.
            // So we set rawText and let next iteration call correction using latest zod error.
            // To enable that, we do a small trick:
            // - if still invalid, call correction immediately and continue attempt+1.
            console.log("[GEMINI] correction reattempt scheduled", { nextAttempt: attempt + 2 });

            // prepare for next attempt by overwriting rawText with the invalid string
            // and re-running correction in next loop cycle
            // (we can't carry zodError across loop easily without state; so we just re-parse each time)
            // We'll continue and let next iteration do another correction by re-validating first,
            // then calling correction.
            rawText = rawText;

        } catch (e) {
            console.error("[GEMINI] Error during parsing/validation", { attempt: attempt + 1, error: safeStringify(e) });
            if (attempt >= 2) throw e;
            // if error was JSON parse, ask correction with a generic instruction
            if (rawText || (e instanceof Error && e.message.includes("empty response"))) {
                const fallbackPrompt = `
Seu retorno não pôde ser interpretado como JSON válido (ou veio vazio). Refaça e retorne APENAS o JSON no schema obrigatório.
Retorno anterior:
${rawText || "(vazio)"}
`;
                const result = await model.generateContent([{ text: fallbackPrompt }]);
                rawText = result.response.text();
            }
        }
    }

    throw new Error("Unexpected: validation loop exhausted");
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
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

    const requestId = crypto.randomUUID();
    const contentType = req.headers.get("content-type") || "";
    console.log(`[REQ ${requestId}] import-processor HIT method=${req.method} url=${req.url} ct=${contentType}`);

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

    // ========================================================================
    // TOP LEVEL PDF DETECTION & ENQUEUE
    // ========================================================================
    const isPdfTop = pMime === "application/pdf"
        || pKind === "pdf"
        || pOrig.toLowerCase().endsWith(".pdf")
        || pSPath.toLowerCase().endsWith(".pdf");

    if (isPdfTop) {
        console.log(`[REQ ${requestId}] PDF DETECTED AT TOP jobId=${pJobId} fileId=${pFileId} mime=${pMime} kind=${pKind}`);
        console.log(`[REQ ${requestId}] BYPASSING parse-worker stub; continuing inline extraction (Gemini/Vision) for PDF.`);

        // CRITICAL FIX: The database trigger 'trg_enqueue_pdf_parse_task' creates a task automatically on INSERT.
        // Since we want to process INLINE and ignore the worker stub, we must DELETE that task here to prevent
        // the worker from picking it up and creating conflicting 'failed' statuses or placeholders.
        if (pJobId && pFileId) {
            const sbAdmin = getSupabase();
            const { error: delErr } = await sbAdmin
                .from("import_parse_tasks")
                .delete()
                .match({ job_id: pJobId, file_id: pFileId });

            if (delErr) {
                console.warn(`[REQ ${requestId}] Failed to cleanup trigger-created task:`, delErr);
            } else {
                console.log(`[REQ ${requestId}] Auto-cleaned queued tasks for PDF (trigger mitigation).`);
            }
        }
    }

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
            if (!GEMINI_API_KEY) {
                return jsonResponse({ error: "Server misconfigured (GEMINI_API_KEY missing)" }, 500, req);
            }

            // B) Setup Gemini (Dynamic discovery)
            const modelResult = await getGeminiModel();
            if (!modelResult.success) {
                const errorMsg = `NO_COMPATIBLE_MODELS: ${modelResult.error}`.slice(0, 800);
                console.error(`[REQ ${requestId}] No compatible Gemini model:`, errorMsg);
                await supabase.from("import_jobs").update({
                    status: 'failed',
                    error_message: errorMsg,
                }).eq('id', jobId);
                return jsonResponse({
                    ok: false,
                    error: "No compatible Gemini model found",
                    message: errorMsg,
                    available_models: modelResult.allModels.slice(0, 20),
                }, 500, req);
            }

            const model = modelResult.model;
            const selectedModelName = modelResult.modelName;
            console.log(`[REQ ${requestId}] Gemini model ready:`, selectedModelName);

            // C) Carregamento de Job e Arquivos
            console.log(`[REQ ${requestId}] Load job/files`, { jobId });
            const { job, files } = await loadJobAndFiles(supabase, jobId);

            await updateJob(supabase, jobId, {
                status: "processing",
                progress: 5,
                current_step: "download_and_parse",
                error_message: null,
            });

            const aggregatedHeaders: Array<GeminiOutput["header"]> = [];
            let totalInserted = 0;

            // D) Loop de Processamento de Arquivos
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (file.user_id !== job.user_id) throw new Error("Security check failed");

                // =========================================================
                // EARLY GUARD: Detect & Enqueue PDF BEFORE Download
                // =========================================================
                const rawMime = (file.content_type || "").toLowerCase();
                const rawPath = (file.storage_path || "").toLowerCase();
                const rawName = (file.original_filename || "").toLowerCase();

                // PATCH: desabilitar desvio para import-parse-worker (stub). Processar PDFs inline.
                const isPdfEarly = false;
                /*
                const isPdfEarly = rawMime === "application/pdf"
                    || file.file_kind === "pdf"
                    || rawName.endsWith(".pdf")
                    || rawPath.endsWith(".pdf");
                */

                if (isPdfEarly) {
                    console.log(`[REQ ${requestId}] PDF EARLY-QUEUED job=${jobId} file=${file.id} storage=${file.storage_path} mime=${rawMime}`);
                    const attemptedAt = new Date().toISOString();

                    // 1. Enqueue Task (Upsert for safety)
                    const { error: taskError } = await supabase.from("import_parse_tasks").upsert({
                        job_id: jobId,
                        file_id: file.id,
                        status: "queued",
                        attempts: 0,
                        created_at: attemptedAt,
                        updated_at: attemptedAt
                    }, { onConflict: "job_id", ignoreDuplicates: true });

                    if (taskError) {
                        // Tolerate duplicate if it implies we already queued it?
                        // But user said "Se INSERT falhar: logar e falhar". 
                        // Upsert with ignoreDuplicates handles the unique constraint safely (succeeds or does nothing).
                        // Real errors (connection, permission) should be hard fails.
                        if (!taskError.message?.includes("duplicate") && !taskError.message?.includes("unique")) {
                            console.error(`[REQ ${requestId}] Early Enqueue failed`, taskError);
                            await updateJob(supabase, jobId, { status: "failed", error_message: "enqueue_parse_task_failed", current_step: "failed" });
                            return jsonResponse({ error: "enqueue_parse_task_failed", details: taskError.message }, 500, req);
                        }
                    }

                    // 2. Update Job
                    try {
                        await updateJob(supabase, jobId, {
                            status: "processing",
                            progress: 1,
                            current_step: "queued_for_parse_worker",
                            updated_at: new Date().toISOString()
                        });
                    } catch (e) { console.warn("Best effort job update failed", e); }

                    // 3. Return Immediately
                    stopHeartbeat();
                    return jsonResponse({ ok: true, job_id: jobId, file_id: file.id, status: "queued_for_parse_worker" }, 202, req);
                }
                // =========================================================
                // END EARLY GUARD
                // =========================================================

                const mimeType = guessMimeType(file);
                await updateJob(supabase, jobId, {
                    progress: Math.min(10 + i * 10, 80),
                    current_step: `processing_file_${i + 1}_of_${files.length}`,
                });

                const bytes = await downloadStorageFile(supabase, file);
                const fileSize = bytes.byteLength;
                let sha256 = "";
                try { sha256 = await calculateSha256(bytes); } catch { }

                // Robust PDF identification
                // PATCH: desabilitar desvio para import-parse-worker (stub). Processar PDFs inline.
                const isPdf = false;
                /*
                const isPdf = mimeType === "application/pdf"
                    || file.file_kind === "pdf"
                    || (file.original_filename && file.original_filename.toLowerCase().endsWith(".pdf"))
                    || file.storage_path.toLowerCase().endsWith(".pdf");
                */

                if (isPdf) {
                    // =========================================================
                    // FASE 1.5: ENFILEIRAR PDF PARA WORKER EM BACKGROUND
                    // =========================================================
                    // PDFs são processados pelo import-parse-worker para evitar
                    // timeout do watchdog. O processamento pesado de extração de
                    // texto e parsing via Gemini ocorre fora desta Edge Function.
                    // =========================================================
                    console.log(`[REQ ${requestId}] PDF detected: ${file.original_filename} (kind=${file.file_kind}). Enqueueing for background worker.`);
                    const attemptedAt = new Date().toISOString();

                    // Checkpoint inicial do arquivo
                    await supabase.from("import_files").update({
                        extraction_method: "queued_for_worker",
                        metadata: {
                            extraction: {
                                attempted_at: attemptedAt,
                                method: "queued_for_worker",
                                file_size_bytes: fileSize,
                                sha256: sha256 || null,
                                page_count: null,
                                text_length: 0,
                                queued_at: attemptedAt
                            }
                        }
                    }).eq("id", file.id);

                    // Inserir/Upsert task na fila de parsing
                    // Usar upsert para evitar duplicatas (constraint unique_parse_task_per_job)
                    const { error: taskError } = await supabase
                        .from("import_parse_tasks")
                        .upsert({
                            job_id: jobId,
                            file_id: file.id,
                            status: "queued",
                            attempts: 0,
                            created_at: attemptedAt,
                            updated_at: attemptedAt,
                        }, {
                            onConflict: "job_id, file_id",
                            ignoreDuplicates: true,
                        });

                    if (taskError) {
                        console.warn(`[REQ ${requestId}] Failed to enqueue parse task (may already exist):`, safeStringify(taskError));
                        // Se falhou por duplicate, não é erro crítico
                        if (!taskError.message?.includes("duplicate") && !taskError.message?.includes("unique")) {
                            throw new Error(`Failed to enqueue parse task: ${taskError.message}`);
                        }
                    } else {
                        console.log(`[REQ ${requestId}] Parse task enqueued for job=${jobId} file=${file.id}`);
                    }

                    // Atualizar job para indicar que está na fila do worker
                    await updateJob(supabase, jobId, {
                        status: "processing",
                        progress: 5,
                        current_step: "queued_for_parse_worker",
                    });

                    // RETORNAR IMEDIATAMENTE - não fazer parse pesado aqui
                    // O pg_cron vai disparar o import-parse-worker que processará a task
                    stopHeartbeat();
                    return jsonResponse({
                        ok: true,
                        job_id: jobId,
                        status: "queued_for_parse_worker",
                        message: "PDF enqueued for background processing. Poll job status for updates.",
                        file_id: file.id,
                        queued_at: attemptedAt,
                    }, 200, req);

                } else {
                    // Excel / Imagem
                    const attemptedAt = new Date().toISOString();
                    const parsed = await getValidatedGeminiJsonForFile(model, { type: 'bytes', data: bytes, mime: mimeType });
                    aggregatedHeaders.push(parsed.header);
                    await insertImportItems(supabase, job, file, parsed);
                    totalInserted += parsed.items.length;

                    await supabase.from("import_files").update({
                        extraction_method: "gemini-vision",
                        metadata: {
                            extraction: { attempted_at: attemptedAt, finished_at: new Date().toISOString(), method: "gemini-vision", file_size_bytes: fileSize, sha256: sha256 || null },
                            inserted_items_count: parsed.items.length
                        }
                    }).eq("id", file.id);
                }
            }

            // E) Conclusão do Job
            const headerFinal = aggregatedHeaders[0] || { reference_date: normalizeReferenceDate(""), bdi_percent: 0, charges_percent: 0, is_desonerado_detected: false };
            const { count: finalItemCount } = await supabase.from("import_items").select("*", { count: "exact", head: true }).eq("job_id", jobId);

            if (!finalItemCount) {
                const noItemsMsg = "NO_ITEMS_EXTRACTED: Nenhum item extraído com sucesso.";
                await updateJob(supabase, jobId, { status: "failed", error_message: noItemsMsg, progress: 100 });
                return jsonResponse({ ok: false, error: "NO_ITEMS_EXTRACTED", message: noItemsMsg }, 400, req);
            }

            const mergedContextFinal = { ...(job.document_context || {}), header: headerFinal, processed_files_count: files.length, inserted_items_count: finalItemCount, db_verified: true };

            // Proteção contra race condition: o race timeout pode ter marcado como failed enquanto mainPromise terminava
            const { data: currentJob } = await supabase.from("import_jobs").select("status, error_message").eq("id", jobId).single();
            if (currentJob?.status === 'failed' && currentJob?.error_message === 'timeout_hard_90s') {
                console.warn(`[REQ ${requestId}] mainPromise finished after hard timeout. Aborting success update.`);
                return jsonResponse({ ok: false, error: "timeout_hard_90s", job_id: jobId }, 504, req);
            }

            // ------------------------------------------------------------------
            // DECISÃO DE STATUS FINAL (Smart Finish)
            // ------------------------------------------------------------------
            // 1) Contar pendências de hidratação (se houver items inseridos)
            const { count: issuesCount } = await supabase
                .from("import_hydration_issues")
                .select("*", { count: "exact", head: true })
                .eq("job_id", jobId)
                .eq("status", "open");

            const pendingIssues = issuesCount || 0;

            // 2) Verificar parâmetros obrigatórios para finalização automática
            //    Exemplo: UF, Competence, e configuração de Desoneração/BDI.
            //    Esses dados geralmente vêm do header extraído ou input do usuário.
            //    Se a IA não detectou com confiança, precisamos perguntar.
            const hasUf = !!(headerFinal.reference_date); // Simplificação: reference_date funciona como competence proxy

            let finalStatus: ImportJobStatus = "done";
            let finalStep = "done";
            let userActionPayload: any = null;

            let canAutoFinalize = finalItemCount > 0 && finalItemCount < 3000;

            // SMART_FINISH CHECKS
            // 1. Validar se a extração retornou itens reais ou apenas o fallback de erro
            if (canAutoFinalize) {
                // Checagem Determinística de Fallback (Extração Falhou mas gerou item placeholder)
                const { count: failureCount } = await supabase
                    .from("import_items")
                    .select("id", { count: "exact", head: true })
                    .eq("job_id", jobId)
                    .eq("price_selected", 0)
                    .eq("validation_status", "pending")
                    .eq("detected_base", "ai_extraction")
                    .or("description_normalized.ilike.%documento ilegível%,description_normalized.ilike.%sem itens%");

                if (failureCount && failureCount > 0) {
                    console.warn(`[REQ ${requestId}] SMART_FINISH: extraction_failed -> waiting_user (non-fatal)`);

                    userActionPayload = {
                        required: true,
                        next: "review",
                        reason: "extraction_failed",
                        message: "Extração não identificou itens válidos. Verifique manualmente ou envie PDF com melhor qualidade.",
                        items_count: finalItemCount,
                        job_id: jobId
                    };

                    // Atualiza Contexto com Payload de Ação
                    mergedContextFinal["user_action"] = userActionPayload;

                    await updateJob(supabase, jobId, {
                        status: "waiting_user",
                        progress: 100,
                        current_step: "waiting_user_extraction_failed",
                        document_context: mergedContextFinal
                    });

                    // Retorno IMEDIATO 200 OK (Non-fatal)
                    return jsonResponse({
                        ok: true,
                        job_id: jobId,
                        status: "waiting_user",
                        reason: "extraction_failed",
                        user_action: userActionPayload
                    }, 200, req);
                }
            }

            // 2. Hydration Check (Legacy but kept for safety)
            if (canAutoFinalize) {
                const { count: pendingCount } = await supabase.from("import_items").select("*", { count: "exact", head: true }).eq("job_id", jobId).eq("validation_status", "pending");
                if (pendingCount && pendingCount > 0) {
                    canAutoFinalize = false;
                    finalStatus = "waiting_user";
                    finalStep = "waiting_user_hydration_pending";
                    userActionPayload = { required: true, next: "review", reason: "hydration_pending", pending_items: pendingCount };
                }
            }

            // 2. Missing Critical Params
            if (canAutoFinalize) {
                if (!headerFinal.bdi_percent) headerFinal.bdi_percent = 0;
                if (!headerFinal.charges_percent) headerFinal.charges_percent = 0;
            }

            // TRIGGER AUTO-FINALIZE
            if (canAutoFinalize) {
                console.log(`[REQ ${requestId}] AUTO_FINALIZE Triggered for Job ${jobId}`);
                try {
                    const finalizeUrl = `${SUPABASE_URL}/functions/v1/import-finalize-budget`;

                    // Defaults for Auto-Finalize
                    // Note: UF defaulting to BA is a business rule assumption for Phase 2.
                    // Ideally this should come from user settings or extraction.
                    const payload = {
                        job_id: jobId,
                        uf: 'BA',
                        competence: headerFinal.reference_date || new Date().toISOString().slice(0, 7) + '-01',
                        desonerado: headerFinal.is_desonerado_detected,
                        bdi_mode: 'padrao', // Default
                        social_charges: 0 // Default
                    };

                    const finalizeResp = await fetch(finalizeUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                        },
                        body: JSON.stringify(payload)
                    });

                    if (!finalizeResp.ok) {
                        const errText = await finalizeResp.text();
                        throw new Error(`HTTP ${finalizeResp.status}: ${errText}`);
                    }

                    const finalizeResult = await finalizeResp.json();

                    if (finalizeResult.ok || finalizeResult.result_budget_id || finalizeResult.budget_id) {
                        const budgetId = finalizeResult.result_budget_id || finalizeResult.budget_id || finalizeResult.data;
                        console.log(`[REQ ${requestId}] AUTO_FINALIZE_OK budgetId=${budgetId}`);
                        // Done logic remains
                        // Ensure context is updated if needed
                        mergedContextFinal["auto_finalize"] = { success: true, budget_id: budgetId, attempted_at: new Date().toISOString() };
                    } else {
                        throw new Error(`Result not OK: ${safeStringify(finalizeResult)}`);
                    }

                } catch (finalizeErr) {
                    const errMsg = finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr);
                    console.warn(`[REQ ${requestId}] AUTO_FINALIZE_FAILED details=${errMsg}`);

                    // Revert to waiting_user to allow manual retry
                    finalStatus = "waiting_user";
                    finalStep = "waiting_user_finalize_failed";
                    userActionPayload = {
                        required: true,
                        reason: "finalize_failed",
                        error_detail: errMsg,
                        next: "review",
                        job_id: jobId
                    };
                }
            } else if (pendingIssues > 0) {
                finalStatus = "waiting_user";
                finalStep = "waiting_user_hydration";
                userActionPayload = {
                    required: true,
                    reason: "hydration_issues",
                    issues_count: pendingIssues,
                    next: "review",
                    job_id: jobId
                };
                console.log(`[REQ ${requestId}] Job ${jobId} -> WAITING_USER (Hydration Issues: ${pendingIssues})`);
            } else if (missingParams) {
                finalStatus = "waiting_user";
                finalStep = "waiting_user_params";
                userActionPayload = {
                    required: true,
                    reason: "missing_params",
                    details: { has_date: hasUf, has_bdi: hasBdi },
                    next: "review",
                    job_id: jobId
                };
                console.log(`[REQ ${requestId}] Job ${jobId} -> WAITING_USER (Missing Params)`);
            } else {
                console.log(`[REQ ${requestId}] Job ${jobId} -> DONE (Ready for finalization)`);
                console.log(`[REQ ${requestId}] AUTO_FINALIZE_START`);

                try {
                    const finalizeUrl = `${SUPABASE_URL}/functions/v1/import-finalize-budget`;

                    // Defaults for Auto-Finalize
                    // Note: UF defaulting to BA is a business rule assumption for Phase 2.
                    // Ideally this should come from user settings or extraction.
                    const payload = {
                        job_id: jobId,
                        uf: 'BA',
                        competence: headerFinal.reference_date || new Date().toISOString().slice(0, 7) + '-01',
                        desonerado: headerFinal.is_desonerado_detected,
                        bdi_mode: 'padrao', // Default
                        social_charges: 0 // Default
                    };

                    const finalizeResp = await fetch(finalizeUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                        },
                        body: JSON.stringify(payload)
                    });

                    if (!finalizeResp.ok) {
                        const errText = await finalizeResp.text();
                        throw new Error(`HTTP ${finalizeResp.status}: ${errText}`);
                    }

                    const finalizeResult = await finalizeResp.json();

                    if (finalizeResult.ok || finalizeResult.result_budget_id || finalizeResult.budget_id) {
                        const budgetId = finalizeResult.result_budget_id || finalizeResult.budget_id || finalizeResult.data;
                        console.log(`[REQ ${requestId}] AUTO_FINALIZE_OK budgetId=${budgetId}`);
                        // Done logic remains
                        // Ensure context is updated if needed
                        mergedContextFinal["auto_finalize"] = { success: true, budget_id: budgetId, attempted_at: new Date().toISOString() };
                    } else {
                        throw new Error(`Result not OK: ${safeStringify(finalizeResult)}`);
                    }

                } catch (finalizeErr) {
                    const errMsg = finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr);
                    console.warn(`[REQ ${requestId}] AUTO_FINALIZE_FAILED details=${errMsg}`);

                    // Revert to waiting_user to allow manual retry
                    finalStatus = "waiting_user";
                    finalStep = "waiting_user_finalize_failed";
                    userActionPayload = {
                        required: true,
                        reason: "finalize_failed",
                        error_detail: errMsg,
                        next: "review",
                        job_id: jobId
                    };
                }
            }

            // Atualiza Contexto com Payload de Ação
            if (userActionPayload) {
                mergedContextFinal["user_action"] = userActionPayload;
            }

            await updateJob(supabase, jobId, {
                status: finalStatus,
                progress: 100,
                current_step: finalStep,
                document_context: mergedContextFinal
            });

            return jsonResponse({
                ok: true,
                job_id: jobId,
                status: finalStatus,
                inserted_items_count: finalItemCount,
                processed_files_count: files.length,
                header: headerFinal,
                user_action: userActionPayload
            }, 200, req);
        })();

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("timeout_hard_90s")), HARD_TIMEOUT_MS);
        });

        return await Promise.race([mainPromise, timeoutPromise]);

    } catch (globalErr) {
        const rawMsg = globalErr instanceof Error ? globalErr.message : String(globalErr);
        console.error(`[REQ ${requestId}] ERROR CAUGHT: ${rawMsg}`);

        let finalStatus: ImportJobStatus = "failed";
        let finalStep = "failed";
        let userAction = null;

        // TIMEOUT OR GENERIC ERROR -> RECOVER TO MANUAL
        // Phase 3 Requirement: Never show 500 for extraction failures.
        // Always allow manual fallback.

        if (rawMsg === "timeout_hard_90s" || rawMsg.includes("timeout")) {
            console.log(`[REQ ${requestId}] Converting TIMEOUT to MANUAL FALLBACK`);
            finalStatus = "waiting_user";
            finalStep = "waiting_user_extraction_failed";
            userAction = {
                required: true,
                reason: "timeout_extraction",
                message: "O processamento demorou muito. Verifique os itens extraídos ou adicione manualmente."
            };
        } else {
            // Other errors (Parsing, OCR, Storage)
            console.log(`[REQ ${requestId}] Converting EXCEPTION to MANUAL FALLBACK`);
            finalStatus = "waiting_user";
            finalStep = "waiting_user_extraction_failed";
            userAction = {
                required: true,
                reason: "extraction_error",
                message: `Falha técnica na extração: ${rawMsg.slice(0, 100)}. Tente o modo manual.`
            };
        }

        if (jobIdString) {
            try {
                const supabase = supabaseForError || getSupabase();
                // Ensure we update job to searchable state
                await updateJob(supabase, jobIdString, {
                    status: finalStatus,
                    progress: 100,
                    current_step: finalStep,
                    error_message: null, // Clear error message so UI doesn't show Red Alert
                    document_context: {
                        user_action: userAction,
                        last_error_recovered: rawMsg
                    }
                });
            } catch (dbErr) {
                console.error("[REQ] Failed to save error recovery state", dbErr);
            }
        }

        // RETURN 200 OK (Recovered)
        return jsonResponse({
            ok: false,
            recovered: true,
            status: finalStatus,
            job_id: jobIdString,
            message: "Processamento finalizado com recuperação de erro (Manual mode enabled)"
        }, 200, req);

    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        stopHeartbeat();
    }
}
