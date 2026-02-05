import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0";
import { z } from "https://esm.sh/zod@3.23.8";
import pdfParse from "npm:pdf-parse@1.1.1";
import { Buffer } from "node:buffer";

// -----------------------------
// ENV & CONFIG
// -----------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const OCR_EC2_URL = Deno.env.get("OCR_EC2_URL") ?? "";

// -----------------------------
// EXTRACTION THRESHOLDS
// -----------------------------
const MIN_ITEMS_SUCCESS = 3;
const MIN_TEXT_LEN_FOR_PARSE = 200;
const DEBUG_TRUNC_STR = 200;
const FULL_SCAN_MIN_TEXT_LEN = 500; // Min chars to attempt full scan
const CHUNK_SIZE_PAGES = 5;
const CHUNK_OVERLAP_PAGES = 1;

// -----------------------------
// SAFETY LIMITS
// -----------------------------
const FULL_SCAN_TIMEOUT_MS = 40000; // 40s Safety Timebox for Strategy 0
const FULLSCAN_MAX_CHARS = 50_000; // Limit to avoid CPU timeout on parsed text
const BUILD_ID = "ocrfb_fullscan_ucond_persist_v4_2026-02-04";

// -----------------------------
// COMPLETENESS THRESHOLDS (OCR for Completeness)
// -----------------------------
const COMPLETENESS_MIN_VALID_ITEMS = 30;
const COMPLETENESS_MIN_PAGES_FOR_ENFORCE = 2;
const ITEMS_PER_PAGE_BASELINE = 12;
const COMPLETENESS_PDF_DURATION_MS_THRESHOLD = 20000;


// -----------------------------
// TYPE DEFINITIONS
// -----------------------------
interface PdfFirstResult {
    attempted: boolean;
    mode: 'success' | 'error' | 'skipped';
    stage_reached?: string;
    items_count: number;
    extracted_text_len?: number;
    error_name?: string;
    error_message_truncated?: string;
    elapsed_ms: number;
}

interface OcrResult {
    attempted: boolean;
    mode: 'success' | 'error' | 'config_error';
    text_len: number;
    error_message_truncated?: string;
    elapsed_ms: number;
    timestamp: string;
}

// -----------------------------
// DETERMINISTIC DECISION LOGIC
// -----------------------------
/**
 * Determines whether OCR EC2 fallback should be attempted.
 * This is the single source of truth for OCR fallback decisions.
 */
function shouldRunOcrFallback(
    pdfResult: PdfFirstResult,
    ocrConfigured: boolean,
    rateLimitDetected: boolean
): boolean {
    // Short-circuit: never run OCR if rate-limited
    if (rateLimitDetected) {
        return false;
    }

    // Can't run OCR if not configured
    if (!ocrConfigured) {
        return false;
    }

    // Run OCR if PDF-first failed or produced insufficient results
    return (
        pdfResult.mode === 'error' ||
        pdfResult.mode === 'skipped' ||
        pdfResult.items_count < MIN_ITEMS_SUCCESS ||
        (pdfResult.extracted_text_len !== undefined && pdfResult.extracted_text_len < MIN_TEXT_LEN_FOR_PARSE)
    );
}

// -----------------------------
// SAFE STRINGIFY (ANTI-CIRCULAR)
// -----------------------------
/**
 * Safely stringifies any value without throwing on circular references.
 * - Truncates max depth to prevent stack overflow
 * - Truncates arrays/strings to prevent memory issues
 * - Never throws errors
 * - ONLY for debug/logging - NEVER for business logic
 */
function safeStringify(value: any, options?: { maxDepth?: number; maxArrayLength?: number; maxStringLength?: number }): string {
    const maxDepth = options?.maxDepth ?? 3;
    const maxArrayLength = options?.maxArrayLength ?? 20;
    const maxStringLength = options?.maxStringLength ?? 500;
    const seen = new WeakSet();

    const truncate = (str: string, max: number) => {
        if (str.length <= max) return str;
        return str.substring(0, max) + '...[truncated]';
    };

    const helper = (val: any, depth: number): any => {
        if (depth > maxDepth) {
            return '[max depth reached]';
        }

        if (val === null || val === undefined) {
            return val;
        }

        const type = typeof val;

        if (type === 'string') {
            return truncate(val, maxStringLength);
        }

        if (type === 'number' || type === 'boolean') {
            return val;
        }

        if (type === 'function') {
            return '[Function]';
        }

        if (type === 'symbol') {
            return '[Symbol]';
        }

        if (type === 'bigint') {
            return `[BigInt: ${val.toString()}]`;
        }

        if (type === 'object') {
            // Detect circular references
            if (seen.has(val)) {
                return '[Circular]';
            }

            seen.add(val);

            if (Array.isArray(val)) {
                const truncatedArray = val.slice(0, maxArrayLength);
                const result = truncatedArray.map(item => helper(item, depth + 1));
                if (val.length > maxArrayLength) {
                    result.push(`...${val.length - maxArrayLength} more items`);
                }
                return result;
            }

            if (val instanceof Date) {
                return val.toISOString();
            }

            if (val instanceof Error) {
                return {
                    name: val.name,
                    message: truncate(val.message, maxStringLength),
                    stack: val.stack ? truncate(val.stack, maxStringLength) : undefined
                };
            }

            // Plain object
            const result: any = {};
            let count = 0;
            const maxKeys = 50;

            for (const key in val) {
                if (count >= maxKeys) {
                    result['...'] = `${Object.keys(val).length - maxKeys} more keys`;
                    break;
                }
                try {
                    result[key] = helper(val[key], depth + 1);
                    count++;
                } catch (e) {
                    result[key] = '[error reading property]';
                }
            }

            return result;
        }

        return '[unknown type]';
    };

    try {
        const sanitized = helper(value, 0);
        return JSON.stringify(sanitized, null, 2);
    } catch (e: any) {
        return `[safeStringify error: ${e.message}]`;
    }
}

/**
 * Creates a safe, minimal debug object suitable for document_context.
 * - Only primitives, counts, and truncated samples
 * - No nested objects, circular refs, or large payloads
 */
function createSafeDebugInfo(raw: any): Record<string, any> {
    const safe: Record<string, any> = {};

    // Only extract safe, primitive data
    if (raw.jobId) safe.job_id = String(raw.jobId);
    if (raw.stage) safe.stage = String(raw.stage).substring(0, 100);
    if (typeof raw.total_items === 'number') safe.total_items = raw.total_items;
    if (typeof raw.rate_limit_encountered === 'boolean') safe.rate_limit_encountered = raw.rate_limit_encountered;
    if (typeof raw.db_verified_count === 'number') safe.db_verified_count = raw.db_verified_count;
    if (raw.ocr_config_error) safe.ocr_config_error = String(raw.ocr_config_error).substring(0, 200);
    if (raw.ocr_health_warning) safe.ocr_health_warning = String(raw.ocr_health_warning).substring(0, 200);

    // Safely handle files array
    if (Array.isArray(raw.files)) {
        safe.files = raw.files.slice(0, 10).map((f: any) => ({
            // Existing fields
            file_id: f.file_id ? String(f.file_id) : null,
            filename: f.filename ? String(f.filename).substring(0, 100) : null,
            pdf_mode: f.pdf_mode ? String(f.pdf_mode) : 'skipped',
            pdf_items: typeof f.pdf_items === 'number' ? f.pdf_items : 0,
            ocr_mode: f.ocr_mode ? String(f.ocr_mode) : 'skipped',
            ocr_len: typeof f.ocr_len === 'number' ? f.ocr_len : 0,
            gemini_1_items: typeof f.gemini_1_items === 'number' ? f.gemini_1_items : 0,
            gemini_2_items: typeof f.gemini_2_items === 'number' ? f.gemini_2_items : 0,
            db_inserted: typeof f.db_inserted === 'number' ? f.db_inserted : 0,
            error: f.error ? String(f.error).substring(0, 200) : null,

            // PDF-First Metrics
            pdf_attempted: typeof f.pdf_attempted === 'boolean' ? f.pdf_attempted : false,
            pdf_duration_ms: typeof f.pdf_duration_ms === 'number' ? f.pdf_duration_ms : null,
            pdf_text_len: typeof f.pdf_text_len === 'number' ? f.pdf_text_len : 0,
            pdf_pages_total: typeof f.pdf_pages_total === 'number' ? f.pdf_pages_total : null,
            pdf_pages_used: typeof f.pdf_pages_used === 'number' ? f.pdf_pages_used : null,

            // PDF Model Tracking
            pdf_model_primary: f.pdf_model_primary ? String(f.pdf_model_primary).substring(0, 50) : null,
            pdf_model_used: f.pdf_model_used ? String(f.pdf_model_used).substring(0, 50) : null,
            pdf_model_fallback_reason: f.pdf_model_fallback_reason ? String(f.pdf_model_fallback_reason).substring(0, 50) : null,
            pdf_error_message: f.pdf_error_message ? String(f.pdf_error_message).substring(0, 200) : null,

            // PDF JSON Recover
            pdf_json_parse_recovered: typeof f.pdf_json_parse_recovered === 'boolean' ? f.pdf_json_parse_recovered : false,
            pdf_json_recover_reason: f.pdf_json_recover_reason ? String(f.pdf_json_recover_reason).substring(0, 80) : null,

            // OCR Metrics
            ocr_attempted: typeof f.ocr_attempted === 'boolean' ? f.ocr_attempted : false,
            ocr_status: f.ocr_status ? String(f.ocr_status).substring(0, 30) : 'skipped',
            ocr_text_len: typeof f.ocr_text_len === 'number' ? f.ocr_text_len : 0,
            ocr_duration_ms: typeof f.ocr_duration_ms === 'number' ? f.ocr_duration_ms : null,
            ocr_skip_reason: f.ocr_skip_reason ? String(f.ocr_skip_reason).substring(0, 80) : null,

            // OCR HTTP Instrumentation
            ocr_http_status: typeof f.ocr_http_status === 'number' ? f.ocr_http_status : null,
            ocr_response_len: typeof f.ocr_response_len === 'number' ? f.ocr_response_len : null,
            ocr_error_body_sample: f.ocr_error_body_sample ? String(f.ocr_error_body_sample).substring(0, 200) : null,
            ocr_empty_text: typeof f.ocr_empty_text === 'boolean' ? f.ocr_empty_text : false,
            ocr_empty_text_reason: f.ocr_empty_text_reason ? String(f.ocr_empty_text_reason).substring(0, 80) : null,

            // PDF.co Fallback
            pdfco_attempted: typeof f.pdfco_attempted === 'boolean' ? f.pdfco_attempted : false,
            pdfco_status: f.pdfco_status ? String(f.pdfco_status).substring(0, 20) : null,
            pdfco_text_len: typeof f.pdfco_text_len === 'number' ? f.pdfco_text_len : null,
            pdfco_duration_ms: typeof f.pdfco_duration_ms === 'number' ? f.pdfco_duration_ms : null,
            pdfco_skip_reason: f.pdfco_skip_reason ? String(f.pdfco_skip_reason).substring(0, 80) : null,

            // PDF.co HTTP Instrumentation
            pdfco_http_status: typeof f.pdfco_http_status === 'number' ? f.pdfco_http_status : null,
            pdfco_response_len: typeof f.pdfco_response_len === 'number' ? f.pdfco_response_len : null,
            pdfco_error_body_sample: f.pdfco_error_body_sample ? String(f.pdfco_error_body_sample).substring(0, 200) : null,
            pdfco_triggered_by: f.pdfco_triggered_by ? String(f.pdfco_triggered_by).substring(0, 80) : null,

            // Completeness & Dedup Metrics
            ocr_triggered_by: f.ocr_triggered_by ? String(f.ocr_triggered_by).substring(0, 30) : null,
            completeness_threshold_items: typeof f.completeness_threshold_items === 'number' ? f.completeness_threshold_items : null,
            items_per_page_baseline: typeof f.items_per_page_baseline === 'number' ? f.items_per_page_baseline : null,
            expected_items: typeof f.expected_items === 'number' ? f.expected_items : null,
            is_low_completeness: typeof f.is_low_completeness === 'boolean' ? f.is_low_completeness : null,
            completeness_reason: f.completeness_reason ? String(f.completeness_reason).substring(0, 80) : null,

            pre_ocr_valid_items: typeof f.pre_ocr_valid_items === 'number' ? f.pre_ocr_valid_items : null,
            post_ocr_valid_items: typeof f.post_ocr_valid_items === 'number' ? f.post_ocr_valid_items : null,
            ocr_added_items: typeof f.ocr_added_items === 'number' ? f.ocr_added_items : null,
            ocr_deduped_items: typeof f.ocr_deduped_items === 'number' ? f.ocr_deduped_items : null,
            pdfco_added_items: typeof f.pdfco_added_items === 'number' ? f.pdfco_added_items : null,
            pdfco_deduped_items: typeof f.pdfco_deduped_items === 'number' ? f.pdfco_deduped_items : null,
            merged_total_valid_items: typeof f.merged_total_valid_items === 'number' ? f.merged_total_valid_items : null,

            dedup_keys_sample: Array.isArray(f.dedup_keys_sample) ? f.dedup_keys_sample.slice(0, 5) : null,

            // Full Scan Metrics
            text_extraction_method: f.text_extraction_method ? String(f.text_extraction_method) : null,
            pages_total: typeof f.pages_total === 'number' ? f.pages_total : null,
            chunks_processed: typeof f.chunks_processed === 'number' ? f.chunks_processed : null,
            full_scan_items: typeof f.full_scan_items === 'number' ? f.full_scan_items : null
        }));
        if (raw.files.length > 10) {
            safe.files_truncated = `${raw.files.length - 10} more files not shown`;
        }
    }

    return safe;
}

// -----------------------------
// DEDUPLICATION HELPERS
// -----------------------------
/**
 * Computes a completeness score and determines if low completeness logic should trigger.
 */
function computeCompletenessScore(fileDebug: any): { is_low_completeness: boolean; reason: string | null } {
    const validItems = fileDebug.gemini_valid_items || 0;
    const pagesTotal = fileDebug.pdf_pages_total || 0;
    const duration = fileDebug.pdf_duration_ms || 0;

    // Expected items heuristic
    const expectedItems = Math.max(
        COMPLETENESS_MIN_VALID_ITEMS,
        (pagesTotal >= COMPLETENESS_MIN_PAGES_FOR_ENFORCE ? pagesTotal * ITEMS_PER_PAGE_BASELINE : 0)
    );

    fileDebug.expected_items = expectedItems;
    fileDebug.items_per_page_baseline = ITEMS_PER_PAGE_BASELINE;
    fileDebug.completeness_threshold_items = COMPLETENESS_MIN_VALID_ITEMS;

    // RULE 1: Absolute minimum (e.g. 30 items)
    if (validItems < COMPLETENESS_MIN_VALID_ITEMS) {
        return { is_low_completeness: true, reason: 'valid_items_below_threshold' };
    }

    // RULE 2: Multi-page heuristic (if we know page count)
    if (pagesTotal >= COMPLETENESS_MIN_PAGES_FOR_ENFORCE && validItems < expectedItems) {
        return { is_low_completeness: true, reason: 'pages_heuristic_mismatch' };
    }

    // RULE 3: Slow extraction but low items (possible timeout cut-off)
    if (duration > COMPLETENESS_PDF_DURATION_MS_THRESHOLD && validItems < 50) {
        return { is_low_completeness: true, reason: 'slow_pdf_low_items' };
    }

    return { is_low_completeness: false, reason: 'sufficient_coverage' };
}

// -----------------------------
// DEDUPLICATION HELPERS
// -----------------------------
/**
 * Normalizes a description string for deduplication.
 * Removes case sensitivity, punctuation, and extra whitespace.
 */
function normalizeForDedup(description: string): string {
    if (!description) return '';
    return description
        .toUpperCase()
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[.,;:()\[\]]/g, '');
}

function normalizeNumberForDedup(val: any): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'number') return String(Math.round(val * 100) / 100);
    // Try to normalize string "1.234,56" -> 1234.56
    const s = String(val).trim();
    return s.replace(/\./g, '').replace(',', '.');
}

/**
 * Creates a deduplication key from an item.
 * Key format: normalized_description|unit|quantity|unit_price|total
 */
function createDedupKey(item: any): string {
    const desc = normalizeForDedup(item.description || '');
    const unit = (item.unit || '').toUpperCase().trim();
    const qty = normalizeNumberForDedup(item.quantity);
    const price = normalizeNumberForDedup(item.unit_price);
    const total = normalizeNumberForDedup(item.total);

    return `${desc}|${unit}|${qty}|${price}|${total}`;
}

// -----------------------------
// LENIENT JSON PARSING
// -----------------------------
/**
 * Extracts balanced JSON (object or array) from text that may contain garbage.
 * Finds first { or [ and matches closing brace/bracket accounting for nesting and strings.
 */
function extractBalancedJson(text: string): string | null {
    // Find first { or [
    const arrayStart = text.indexOf('[');
    const objStart = text.indexOf('{');

    if (arrayStart === -1 && objStart === -1) return null;

    const startIdx = (arrayStart !== -1 && objStart !== -1)
        ? Math.min(arrayStart, objStart)
        : Math.max(arrayStart, objStart);

    const startChar = text[startIdx];
    const endChar = startChar === '[' ? ']' : '}';

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIdx; i < text.length; i++) {
        const char = text[i];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\') {
            escaped = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (char === startChar) depth++;
        if (char === endChar) {
            depth--;
            if (depth === 0) {
                return text.substring(startIdx, i + 1);
            }
        }
    }

    return null;
}

/**
 * Attempts to parse JSON with multiple fallback strategies.
 * Returns success status, parsed data, and recovery metadata.
 */
function parseJsonLenient(text: string): {
    success: boolean;
    data: any;
    recovered: boolean;
    reason: string | null;
} {
    // Try direct parse first
    try {
        return {
            success: true,
            data: JSON.parse(text),
            recovered: false,
            reason: null
        };
    } catch (e1) {
        // Try removing markdown code blocks
        try {
            const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
            return {
                success: true,
                data: JSON.parse(cleaned),
                recovered: true,
                reason: "removed_markdown_blocks"
            };
        } catch (e2) {
            // Try extracting balanced JSON substring
            const extracted = extractBalancedJson(text);
            if (extracted) {
                try {
                    return {
                        success: true,
                        data: JSON.parse(extracted),
                        recovered: true,
                        reason: "extracted_balanced_json"
                    };
                } catch (e3) {
                    // Extraction found structure but still invalid JSON
                }
            }
            // All recovery attempts failed
            const errorMsg = String(e1).substring(0, 100);
            return {
                success: false,
                data: null,
                recovered: false,
                reason: `parse_failed: ${errorMsg}`
            };
        }
    }
}



// CORS Helpers
// CORS Helpers
function normalizeOrigin(origin: string): string {
    let normalized = origin.trim();
    if (normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

function isAllowedOrigin(origin: string): boolean {
    const allowed = [
        "https://naboorca.com",
        "https://www.naboorca.com",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:54321"
    ];
    if (allowed.includes(origin)) return true;

    // Cloudflare Pages Preview Regex: https://<branch>.naboorca.pages.dev
    if (/^https:\/\/[a-z0-9-]+\.naboorca\.pages\.dev$/i.test(origin)) return true;

    return false;
}

function corsHeadersStrict(req: Request): Record<string, string> {
    const rawOrigin = req.headers.get("origin");
    const origin = normalizeOrigin(rawOrigin || "");

    // Base CORS headers
    const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-id, x-job-id, x-internal-call",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };

    if (!rawOrigin) {
        return headers;
    }

    if (isAllowedOrigin(origin)) {
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Access-Control-Allow-Credentials"] = "true";
    } else {
        headers["Access-Control-Allow-Origin"] = "null";
    }

    return headers;
}

function corsHeaders(req: Request): Record<string, string> {
    const rawOrigin = req.headers.get("origin") ?? "";
    const origin = normalizeOrigin(rawOrigin);

    const headers: Record<string, string> = {
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-id, x-job-id, x-internal-call",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };

    if (isAllowedOrigin(origin)) {
        headers["Access-Control-Allow-Origin"] = origin;
    } else {
        // If not allowed, we DO NOT send Access-Control-Allow-Origin.
        // This causes the browser to fail CORS, which is correct for unauthorized origins.
        // If we defaulted to "https://naborca.com", it would also fail (mismatch), but this is cleaner.
    }

    return headers;
}

function jsonResponse(body: unknown, status = 200, req?: Request) {
    const headers = req ? corsHeadersStrict(req) : {
        "Access-Control-Allow-Origin": "https://naborca.com", // Safe fallback checking only
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Credentials": "true"
    };
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers }
    });
}


// -----------------------------
// SCHEMA & PROMPT (Mirrors import-processor)
// -----------------------------
// -----------------------------
// SCHEMA & PROMPT (Tolerant Extraction)
// -----------------------------
const ItemSchema = z.object({
    code: z.string().optional().nullable().default(null),
    description: z.string().min(1), // Unique mandatory field
    unit: z.string().optional().nullable().default(null),
    quantity: z.number().optional().nullable().default(null),
    unit_price: z.number().optional().nullable().default(null),
    total: z.number().optional().nullable().default(null),
    raw_line: z.string().optional().nullable().default(null),
    confidence: z.number().finite().min(0).max(1).default(0.6),
});

const GeminiOutputSchema = z.object({
    items: z.array(ItemSchema).default([]),
});

const SYSTEM_PROMPT = `
# CONTEXTO
Você é um sistema de extração estruturada de itens orçamentários a partir de TEXTO OCR de PDFs de orçamento/planilha de obra.

O texto abaixo corresponde a linhas OCR (linha a linha) de um orçamento.
Cada linha pode ou não conter:
- descrição do item
- unidade (UN, M, M2, M3, KG, H, VB, etc.)
- quantidade
- valor unitário
- valor total

IMPORTANTE:
- Nem toda linha terá todos os campos.
- Quando um valor NÃO estiver explícito, você NÃO deve inventar.
- Zero NUNCA é um default silencioso.
- Ausência deve ser representada como null.

Seu output será usado para popular diretamente a tabela \`import_ai_items\`.

# OBJETIVO
Extrair CADA ITEM como uma linha independente, preenchendo:
- description (obrigatório)
- unit (string curta, ex: "UN", "M2", "M3", "VB") ou null
- quantity (numérico) ou null
- unit_price (numérico) ou null
- total (numérico) ou null
- raw_line (linha original OCR, sem alteração)
- confidence (0 a 1, confiança da extração numérica)

# REGRAS CRÍTICAS (NÃO VIOLAR)
1) NUNCA preencha quantity, unit_price ou total com 0 se o valor não estiver explícito.
2) Se um número existir na linha, mas você não tiver certeza do campo correto:
   - Prefira preencher total
   - Marque confidence < 0.6
3) Se quantity e unit_price existirem, calcule total SOMENTE se o total não estiver explícito.
4) NÃO normalize preços, NÃO aplique impostos, NÃO arredonde.
5) NÃO consolide linhas.
6) NÃO elimine linhas aparentemente “descritivas” — extraia mesmo assim.
7) NÃO invente unidade.
8) Use ponto como separador decimal (ex: 1234.56).

# HEURÍSTICAS PERMITIDAS
- Padrões comuns:
  - "1,00 UN 350,00 350,00"
  - "M2 120,50 3.200,00"
  - "QTDE: 2 VALOR UNIT: 500 TOTAL: 1000"
- Se houver apenas UM valor monetário:
  - Preencha total
- Se houver dois valores:
  - O menor tende a ser unit_price
  - O maior tende a ser total
- Quantidade normalmente é o menor número não monetário > 0

# FORMATO DE SAÍDA (OBRIGATÓRIO)
Retorne APENAS um JSON válido no formato:

{
  "items": [
    {
      "description": "...",
      "unit": "UN",
      "quantity": 1,
      "unit_price": 350.00,
      "total": 350.00,
      "raw_line": "...",
      "confidence": 0.92
    }
  ]
}

- NÃO inclua comentários
- NÃO inclua texto fora do JSON
- Use null explicitamente quando o campo não existir
`;

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

async function generateContentWithRetry(model: any, params: any, maxRetries = 2) {
    let attempt = 0;
    while (true) {
        try {
            return await model.generateContent(params);
        } catch (e: any) {
            if (isRateLimitError(e)) {
                if (attempt < maxRetries) {
                    const waitMs = attempt === 0 ? 15000 : 30000;
                    console.warn(`[OCR-FB-DEBUG] Gemimi Rate Limit (429). Retrying in ${waitMs / 1000}s... (Attempt ${attempt + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                    attempt++;
                    continue;
                }
                // Retries exhausted
                throw new RateLimitError(e);
            }
            // Not a rate limit error, throw immediately
            throw e;
        }
    }
}


// -----------------------------
// GEMINI MODEL DISCOVERY & FALLBACK
// -----------------------------
/**
 * Checks if an error is a 404 model not found error
 */
function isModel404Error(e: any): boolean {
    return e?.status === 404 ||
        e?.message?.includes("404") ||
        e?.message?.toLowerCase().includes("not found");
}

/**
 * Discovers a working Gemini model, with automatic fallback if primary model is not found.
 * Returns model ID and metadata about fallback usage.
 */
async function discoverGeminiModel(apiKey: string, preferredModel: string = "gemini-1.5-flash"): Promise<{
    modelId: string;
    fallbackUsed: boolean;
    availableCount: number;
}> {
    // List all available models from Gemini API (NO test call to avoid 404)

    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const resp = await fetch(listUrl);

        if (!resp.ok) {
            console.warn(`[GEMINI] Failed to list models (${resp.status}), using fallback`);
            return {
                modelId: "gemini-2.0-flash-exp",
                fallbackUsed: true,
                availableCount: 0
            };
        }

        const data = await resp.json();
        const models = data.models || [];

        // Filter models that support generateContent method
        const validModels = models.filter((m: any) =>
            m.supportedGenerationMethods?.includes("generateContent")
        );

        if (validModels.length === 0) {
            throw new Error("No valid Gemini models available for generateContent");
        }

        // Check if preferred model exists in the list
        const preferredExists = validModels.some((m: any) =>
            m.name?.includes(preferredModel)
        );

        if (preferredExists) {
            console.log(`[GEMINI] Using preferred model: ${preferredModel}`);
            return {
                modelId: preferredModel,
                fallbackUsed: false,
                availableCount: validModels.length
            };
        }

        // Preferred not found - select fallback
        console.warn(`[GEMINI] Preferred model ${preferredModel} not available, selecting fallback...`);

        // Fallback priority: gemini-2.5-flash > gemini-2.0-flash > any flash > first valid
        let fallback = validModels.find((m: any) => m.name?.includes("gemini-2.5-flash"));
        if (!fallback) {
            fallback = validModels.find((m: any) => m.name?.includes("gemini-2.0-flash"));
        }
        if (!fallback) {
            fallback = validModels.find((m: any) => m.name?.includes("flash"));
        }
        if (!fallback) {
            fallback = validModels[0];
        }

        // Extract model ID from full name (e.g., "models/gemini-2.0-flash" -> "gemini-2.0-flash")
        const modelId = fallback.name.replace("models/", "");

        console.log(`[GEMINI] Using fallback model: ${modelId} (${validModels.length} models available)`);

        return {
            modelId,
            fallbackUsed: true,
            availableCount: validModels.length
        };
    } catch (err: any) {
        // Complete failure - use hardcoded fallback
        console.error(`[GEMINI] Model discovery failed: ${err.message}, using hardcoded fallback`);
        return {
            modelId: "gemini-2.0-flash-exp",
            fallbackUsed: true,
            availableCount: 0
        };
    }
}

/**
 * Generates consistent user-facing error message based on actual execution.
 * Prevents claiming OCR ran when it didn't.
 */
function generateExtractionFailedMessage(files: any[]): string {
    if (!files || files.length === 0) {
        return "Não foi possível processar o arquivo.";
    }

    const file = files[0]; // Check first file

    const pdfAttempted = file.pdf_attempted === true;
    const ocrAttempted = file.ocr_attempted === true;
    const ocrSkipReason = file.ocr_skip_reason;

    if (pdfAttempted && ocrAttempted) {
        // Both attempted - genuine extraction failure
        return "PDF-first e OCR Avançado não identificaram itens. O arquivo pode ser uma imagem sem texto claro ou manuscrito.";
    }

    if (pdfAttempted && !ocrAttempted) {
        // PDF tried, OCR skipped
        if (ocrSkipReason) {
            return `PDF-first falhou e OCR não foi executado: ${ocrSkipReason}. Configure OCR_EC2_URL para habilitar OCR avançado.`;
        }
        return "PDF-first falhou e OCR não foi executado. Configure OCR para processamento avançado.";
    }

    if (!pdfAttempted && ocrAttempted) {
        // Only OCR attempted
        return "OCR Avançado não identificou itens. O arquivo pode ser uma imagem sem texto claro.";
    }

    // Neither attempted (shouldn't happen, but handle gracefully)
    return "Não foi possível extrair itens do arquivo. Verifique se o arquivo contém uma tabela de orçamento legível.";
}

// -----------------------------
// FULL SCAN HELPERS
// -----------------------------

async function extractPdfText(buffer: ArrayBuffer): Promise<{ text: string, numpages: number } | null> {
    try {
        // pdf-parse expects Buffer, but Deno works with ArrayBuffer/Uint8Array
        // We might need to cast or fallback
        const data = await pdfParse(Buffer.from(buffer));
        return {
            text: data.text,
            numpages: data.numpages
        };
    } catch (e: any) {
        console.warn("[FULL-SCAN] Local PDF text extraction failed:", e.message);
        return null;
    }
}

interface ChunkResult {
    chunkIndex: number;
    items: any[];
    textLen: number;
}

/**
 * Splits text into page-based chunks if possible, or char-based if not.
 * Since pdf-parse returns a single string, we use heuristic page markers if present, 
 * or simple splitting if no markers found.
 * 
 * NOTE: pdf-parse usually joins pages with \n\n. We can't easily distinguish exact pages 
 * without a custom render. For robustness, we will try to split by form-feed \f if available 
 * or just treat the whole text as a stream and split by Chars.
 * 
 * Update: To support "Chunking by Pages" properly we really need per-page info.
 * Since pdf-parse basic usage returns one string, we will assume ~3000 chars per page 
 * as a safe estimation for chunk boundaries if \f is missing.
 */
function createTextChunks(text: string, totalPages: number): { text: string, startPage: number, endPage: number }[] {
    // Try splitting by Form Feed (common in PDF text)
    const pages = text.split(/\f/);
    const hasFormFeeds = pages.length > 1;

    // If we have distinct pages detected
    if (hasFormFeeds && Math.abs(pages.length - totalPages) < 5) { // Sanity check
        const chunks: { text: string, startPage: number, endPage: number }[] = [];
        for (let i = 0; i < pages.length; i += (CHUNK_SIZE_PAGES - CHUNK_OVERLAP_PAGES)) {
            const chunkPages = pages.slice(i, i + CHUNK_SIZE_PAGES);
            const chunkText = chunkPages.join("\n\n---\n\n");
            chunks.push({
                text: chunkText,
                startPage: i + 1,
                endPage: Math.min(i + CHUNK_SIZE_PAGES, pages.length)
            });
            // Stop if we reached end
            if (i + CHUNK_SIZE_PAGES >= pages.length) break;
        }
        return chunks;
    }

    // Fallback: Character based chunking (approx 3000 chars * 5 pages = 15000 chars)
    const CHARS_PER_PAGE_EST = 3000;
    const CHUNK_CHARS = CHARS_PER_PAGE_EST * CHUNK_SIZE_PAGES;
    const OVERLAP_CHARS = CHARS_PER_PAGE_EST * CHUNK_OVERLAP_PAGES;

    const chunks: { text: string, startPage: number, endPage: number }[] = [];
    for (let i = 0; i < text.length; i += (CHUNK_CHARS - OVERLAP_CHARS)) {
        const chunkText = text.substring(i, i + CHUNK_CHARS);
        chunks.push({
            text: chunkText,
            startPage: Math.floor(i / CHARS_PER_PAGE_EST) + 1,
            endPage: Math.floor((i + chunkText.length) / CHARS_PER_PAGE_EST) + 1
        });
        if (i + CHUNK_CHARS >= text.length) break;
    }
    return chunks;
}

/**
 * Robust detection of PDF files for Strategy 0 trigger
 */
function isPdfFile(file: any): { isPdf: boolean; trigger: string | null; normalizedContentType: string; normalizedFilename: string } {
    const rawCt = file.content_type ?? '';
    const ct = String(rawCt).toLowerCase().trim();

    const rawFn = file.original_filename ?? '';
    const fn = String(rawFn).toLowerCase().trim();

    // Detect by content-type OR extension (case-insensitive)
    const byCt = ct.includes('pdf');
    const byExt = fn.endsWith('.pdf');

    const isPdf = byCt || byExt;
    const trigger = byCt ? 'content_type' : (byExt ? 'extension' : null);

    return { isPdf, trigger, normalizedContentType: ct, normalizedFilename: fn };
}

// ------------------------------------------------------------------
// HELPER: Compute Extraction Metrics (Structural Validation)
// ------------------------------------------------------------------
function computeExtractionMetrics(params: {
    pagesTotal: number | null,
    itemsValidCount: number,
    itemsPerPageBaseline: number,
    pdfTextLen: number,
    ocrAttempted: boolean
}): {
    pages_total: number | null,
    items_valid: number,
    expected_items: number,
    coverage_ratio: number,
    structurally_valid: boolean,
    structural_reasons: string[]
} {
    const { pagesTotal, itemsValidCount, itemsPerPageBaseline } = params;
    const pages = pagesTotal || 1; // Default to 1 if unknown to avoid div/0
    const baseline = itemsPerPageBaseline || 8;
    const expected_items = pages * baseline;

    // Cap default expected items to avoid extreme ratios on huge files if unknown
    // But if pages is known, we trust it.

    const coverage_ratio = itemsValidCount / expected_items;
    const reasons: string[] = [];
    let valid = true;

    // RULE 1: High page count, near-zero items (The "14 pages -> 1 item" bug)
    if (pages >= 5 && itemsValidCount <= 1) {
        valid = false;
        reasons.push(`critical_low_yield_for_pages (pages=${pages}, items=${itemsValidCount})`);
    }

    // RULE 2: Very low coverage on multi-page docs
    if (pages >= 3 && coverage_ratio < 0.05) {
        // e.g. 10 pages * 8 = 80 expected. If we get 3 items -> 3/80 = 0.0375 -> INVALID
        valid = false;
        reasons.push(`low_coverage_ratio (ratio=${coverage_ratio.toFixed(2)}, expected=${expected_items})`);
    }

    // RULE 3: Single item generic check (heuristic)
    // (Skipped for now as we don't pass item descriptions here, but Rule 1 covers the 1-item case for 5+ pages)

    return {
        pages_total: pages,
        items_valid: itemsValidCount,
        expected_items,
        coverage_ratio,
        structurally_valid: valid,
        structural_reasons: reasons
    };
}

// ------------------------------------------------------------------
// HELPER: Resolve Budget ID
// ------------------------------------------------------------------
async function resolveBudgetIdForJob(supabase: any, jobId: string, jobData: any): Promise<string | null> {
    // 1. Try result_budget_id from jobData (if available)
    if (jobData?.result_budget_id) {
        console.log(`[RESOLVE_BUDGET_ID] Found result_budget_id in job: ${jobData.result_budget_id}`);
        return jobData.result_budget_id;
    }

    // 2. Try import_finalization_runs (most recent)
    const { data: runData } = await supabase
        .from('import_finalization_runs')
        .select('budget_id')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (runData?.budget_id) {
        console.log(`[RESOLVE_BUDGET_ID] Found budget_id in import_finalization_runs: ${runData.budget_id}`);
        return runData.budget_id;
    }

    // 3. Try import_budget_finalizations (most recent)
    const { data: finData } = await supabase
        .from('import_budget_finalizations')
        .select('budget_id')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (finData?.budget_id) {
        console.log(`[RESOLVE_BUDGET_ID] Found budget_id in import_budget_finalizations: ${finData.budget_id}`);
        return finData.budget_id;
    }

    console.warn(`[RESOLVE_BUDGET_ID] Could not resolve budget_id for job ${jobId}`);
    return null;
}

// ------------------------------------------------------------------
// HELPER: Hydrate Budget Items (Idempotent)
// ------------------------------------------------------------------
async function hydrateBudgetItemsFromAI(params: {
    supabase: any,
    requestId: string,
    jobId: string,
    budgetId: string
}): Promise<{ inserted: number, skippedExisting: number }> {
    const { supabase, requestId, jobId, budgetId } = params;

    console.log(`[REQ ${requestId}] BUDGET_HYDRATION_START jobId=${jobId} budgetId=${budgetId}`);

    // 1. Fetch AI Items
    const { data: aiItems, error: fetchAiErr } = await supabase
        .from("import_ai_items")
        .select("id, description, unit, quantity, unit_price, total, idx")
        .eq("job_id", jobId)
        .order('idx', { ascending: true, nullsFirst: false });

    if (fetchAiErr) {
        throw new Error(`Failed to fetch AI items: ${fetchAiErr.message}`);
    }

    if (!aiItems || aiItems.length === 0) {
        console.log(`[REQ ${requestId}] BUDGET_HYDRATION_DONE ai_count=0 (No items to hydrate)`);
        return { inserted: 0, skippedExisting: 0 };
    }

    console.log(`[REQ ${requestId}] BUDGET_HYDRATION_AI_ITEMS_FOUND count=${aiItems.length}`);

    // 2. Fetch Existing Budget Items (Idempotency)
    const existingSet = new Set<string>();

    // Optimization: Check for existing items linked to this job in this budget
    const { data: existingLinks, error: checkErr } = await supabase
        .from("budget_items")
        .select("source_import_item_id")
        .eq("budget_id", budgetId)
        .not("source_import_item_id", "is", null);

    if (existingLinks) {
        existingLinks.forEach((row: any) => {
            if (row.source_import_item_id) existingSet.add(row.source_import_item_id);
        });
    }

    console.log(`[REQ ${requestId}] BUDGET_HYDRATION_EXISTING_IN_BUDGET count=${existingSet.size}`);

    // 3. Filter New Items
    const itemsToInsert = aiItems
        .filter((item: any) => !existingSet.has(item.id))
        .map((item: any) => ({
            budget_id: budgetId,
            source_import_item_id: item.id, // IDEMPOTENCY KEY
            description: item.description || "Item sem descrição",
            unit: item.unit || "UN",
            quantity: item.quantity || 0,
            unit_price: item.unit_price || 0,
            total_price: item.total || ((item.quantity || 0) * (item.unit_price || 0)),
            source: 'AI_EXTRACTION'
        }));

    if (itemsToInsert.length === 0) {
        console.log(`[REQ ${requestId}] BUDGET_HYDRATION_SKIPPED_ALREADY_PRESENT count=${existingSet.size}`);
        console.log(`[REQ ${requestId}] BUDGET_HYDRATION_DONE total_created=0`);
        return { inserted: 0, skippedExisting: existingSet.size };
    }

    // 4. Batch Insert
    const { error: insertErr } = await supabase.from("budget_items").insert(itemsToInsert);

    if (insertErr) {
        console.error(`[REQ ${requestId}] BUDGET_HYDRATION_FAILED Insert Error:`, insertErr);
        throw insertErr; // Propagate error
    }

    console.log(`[REQ ${requestId}] BUDGET_HYDRATION_CREATED count=${itemsToInsert.length}`);
    console.log(`[REQ ${requestId}] BUDGET_HYDRATION_DONE total_created=${itemsToInsert.length}`);

    return { inserted: itemsToInsert.length, skippedExisting: existingSet.size };
}

// -----------------------------
// CORS Helpers
// -----------------------------
serve(async (req) => {
    // 0. CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { status: 200, headers: corsHeadersStrict(req) });
    }

    const requestId = crypto.randomUUID().split("-")[0];
    console.log(`[REQ ${requestId}] OCR_FALLBACK_START`);
    console.log(`[OCR-FB] [REQ ${requestId}] BUILD_ID=${BUILD_ID}`);

    // Capture context variables for error handler scope
    let currentJobId: string | null = null;
    let jobData: any = null; // to keep existing context
    let debugSummary: any = {
        stage: 'init',
        files: [],
        total_items: 0,
        rate_limit_encountered: false
    };

    // DEBUG & TRACE
    const dbVerificationTrace: string[] = [];
    const traceTrace = (val: number | string, src: string, tag: string) => {
        const msg = `set inserted_items_count from ${src}: ${val} at ${tag}`;
        dbVerificationTrace.push(msg);
        console.log(`[OCR-FB-TRACE] ${msg}`);
    };

    let realDbCountVerified: number | null = null;
    let countQueryRan = false;

    try {
        // 1. Dual-Mode Auth Check (Internal vs Public)
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const authHeader = req.headers.get("Authorization");
        let userId: string | undefined;
        const isInternalCall = req.headers.get('x-internal-call') === '1';

        if (!authHeader) {
            return jsonResponse({ code: 401, message: "Missing Authorization Header" }, 401, req);
        }

        const token = authHeader.replace("Bearer ", "");

        if (isInternalCall) {
            // ============================================================
            // INTERNAL MODE: Validate Service Role Token
            // ============================================================
            console.log(`[REQ ${requestId}] Internal call detected`);

            // Validate service role token (simple string match)
            if (token !== SUPABASE_SERVICE_ROLE_KEY) {
                console.warn(`[REQ ${requestId}] Invalid service role token for internal call`);
                return jsonResponse({
                    code: 401,
                    message: "Invalid service role token for internal call"
                }, 401, req);
            }

            // Extract and validate required headers
            const xUserId = req.headers.get('x-user-id');
            const xJobId = req.headers.get('x-job-id');

            if (!xUserId || !xJobId) {
                console.warn(`[REQ ${requestId}] Missing x-user-id or x-job-id headers`);
                return jsonResponse({
                    code: 401,
                    message: "Missing x-user-id or x-job-id headers for internal call"
                }, 401, req);
            }

            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(xUserId) || !uuidRegex.test(xJobId)) {
                console.warn(`[REQ ${requestId}] Invalid UUID format in headers`);
                return jsonResponse({
                    code: 401,
                    message: "Invalid UUID format in x-user-id or x-job-id headers"
                }, 401, req);
            }

            userId = xUserId;
            console.log(`[REQ ${requestId}] Internal auth OK: user=${userId} job=${xJobId}`);

            // Instrumentation for internal mode
            debugSummary.internal_auth = {
                mode: 'internal',
                user_id: xUserId,
                job_id: xJobId,
                ok: true,
                ts: new Date().toISOString()
            };

            debugSummary.auth_checked = {
                gateway_verify_jwt: false,
                manual_auth_ok: false,
                internal_auth_ok: true,
                ts: new Date().toISOString()
            };

        } else {
            // ============================================================
            // PUBLIC MODE: Validate User JWT
            // ============================================================
            console.log(`[REQ ${requestId}] Public call - validating user JWT`);

            const { data: { user }, error: userErr } = await supabase.auth.getUser(token);

            if (userErr || !user) {
                console.warn(`[REQ ${requestId}] Manual JWT check failed:`, userErr);
                return jsonResponse({
                    code: 401,
                    message: "Invalid JWT (manual check)",
                    details: userErr?.message || "User not found"
                }, 401, req);
            }

            userId = user.id;
            console.log(`[REQ ${requestId}] Public auth OK: user=${userId}`);

            // Instrumentation for public mode
            debugSummary.auth_checked = {
                gateway_verify_jwt: false,
                manual_auth_ok: true,
                internal_auth_ok: false,
                ts: new Date().toISOString()
            };
        }

        const reqBody = await req.json();
        const { job_id } = reqBody;
        if (!job_id) throw new Error("Missing job_id");
        currentJobId = job_id;


        // ============================================================
        // PUBLIC MODE: Enqueue & Return (Avoid Timeout)
        // ============================================================
        // ============================================================
        // PUBLIC MODE: Enqueue into Durable Table & Trigger Worker
        // ============================================================
        if (!isInternalCall) {
            console.log(`[REQ ${requestId}] Public Mode: Enqueuing persistent OCR jobs.`);

            // 1. Identify PDF Files for this Job
            const { data: pdfFiles, error: filesErr } = await supabase
                .from("import_files")
                .select("id")
                .eq("job_id", job_id)
                .ilike("content_type", "%pdf%");

            if (filesErr) {
                console.error(`[REQ ${requestId}] Failed to fetch files:`, filesErr);
                return jsonResponse({ error: "Failed to fetch files for queuing" }, 500, req);
            }

            if (!pdfFiles || pdfFiles.length === 0) {
                console.warn(`[REQ ${requestId}] No PDF files found to enqueue.`);
                return jsonResponse({
                    status: "skipped",
                    message: "Nenhum arquivo PDF encontrado para processamento OCR."
                }, 200, req);
            }

            console.log(`[REQ ${requestId}] Found ${pdfFiles.length} PDF files to enqueue.`);

            // 2. Insert into import_ocr_jobs (Queue)
            const queueRows = pdfFiles.map(f => ({
                job_id: job_id,
                import_file_id: f.id,
                status: 'pending',
                priority: 0,
                retry_count: 0
            }));

            const { error: queueErr } = await supabase
                .from("import_ocr_jobs")
                .upsert(queueRows, { onConflict: 'job_id, import_file_id', ignoreDuplicates: true });

            if (queueErr) {
                console.error(`[REQ ${requestId}] Queue Insert Failed:`, queueErr);
                return jsonResponse({ error: "Failed to enqueue OCR jobs" }, 500, req);
            }

            // 3. Update Parent Job Status -> processing
            // This ensures UI shows "Processando..." immediately
            await supabase.from('import_jobs')
                .update({
                    status: 'processing',
                    stage: 'ocr_queued', // detailed status if schema supports it, otherwise ignored or helpful for debug
                    updated_at: new Date().toISOString()
                })
                .eq('id', job_id)
                .neq('status', 'done');

            // 4. Trigger OCR Worker (Fire & Forget - Self Trigger)
            const workerUrl = `${SUPABASE_URL}/functions/v1/ocr-worker`;
            console.log(`[REQ ${requestId}] Triggering Worker (Poke): ${workerUrl}`);

            const workerTask = (async () => {
                try {
                    const res = await fetch(workerUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                            'apikey': `${SUPABASE_SERVICE_ROLE_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ reason: 'enqueue_poke', job_id })
                    });
                    const txt = await res.text();
                    console.log(`[REQ ${requestId}] Worker poke status=${res.status} ok=${res.ok} body=${txt.slice(0, 500)}`);
                } catch (e) {
                    console.error(`[REQ ${requestId}] Worker poke failed:`, e);
                }
            })();

            if (typeof (globalThis as any).EdgeRuntime?.waitUntil === 'function') {
                (globalThis as any).EdgeRuntime.waitUntil(workerTask);
            }

            return jsonResponse({
                status: "queued",
                message: "OCR iniciado em background (Persistente).",
                started_in_background: true,
                job_id,
                files_queued: pdfFiles.length
            }, 202, req);
        }

        // ============================================================
        // INTERNAL MODE: Execute Heavy Processing
        // ============================================================
        console.log(`[REQ ${requestId}] Internal Worker: Starting Heavy Processing...`);

        // ... (Continue to File Processing Logic) ...

        // 2. Fetch Job & Files
        // ... (Existing Logic kept via flow, but ensure indentation matches)

        let jobQuery = supabase.from("import_jobs").select("*").eq("id", job_id).single();
        if (userId) jobQuery = supabase.from("import_jobs").select("*").eq("id", job_id).eq("user_id", userId).single();

        const { data: job, error: jobErr } = await jobQuery;
        if (jobErr || !job) return jsonResponse({ error: "Job invalid or access denied" }, 403, req);
        jobData = job;

        // Fetch PDF Files
        let filesQuery = supabase
            .from("import_files")
            .select("*")
            .eq("job_id", job_id)
            .ilike("content_type", "%pdf%");

        // OPTIMIZATION: If worker passed a specific target file, only fetch that one.
        if (reqBody.target_file_id) {
            filesQuery = filesQuery.eq("id", reqBody.target_file_id);
        }

        const { data: files, error: filesErr } = await filesQuery;


        if (filesErr || !files || files.length === 0) {
            console.log(`[OCR-FLOW-DEBUG] [REQ ${requestId}] Exit: No PDF files found for job ${job_id} (Target: ${reqBody.target_file_id || 'All'})`);
            return jsonResponse({ error: "No PDF files found for this job" }, 404, req);
        }
        console.log(`[OCR-FLOW-DEBUG] [REQ ${requestId}] Found ${files.length} PDF files to process`);

        // 3. OPTIMISTIC LOCK: Update Status -> processing
        // Only allow if status is 'uploaded', 'queued', or 'pending'
        // FIX: SKIP LOCK IF INTERNAL CALL (Already locked by dispatcher or we want to force run)
        if (!isInternalCall) {
            const { data: lockJob, error: lockErr } = await supabase.from("import_jobs")
                .update({
                    status: "processing",
                    current_step: "ocr_fallback_running",
                    progress: 10,
                    started_at: new Date().toISOString(),
                    last_error: null
                })
                .eq("id", job_id)
                .in("status", ["uploaded", "queued", "pending"]) // Safe set for initial states
                .select()
                .single();

            if (lockErr || !lockJob) {
                console.warn(`[REQ ${requestId}] Internal Worker: already processing or done (Lock Failed).`);
                return jsonResponse({
                    error: "Job locked or invalid status",
                    details: "Optimistic lock failed - job already processing?"
                }, 409, req);
            }
            console.log(`[REQ ${requestId}] Lock acquired for job ${job_id}`);
        } else {
            console.log(`[REQ ${requestId}] INTERNAL MODE: Skipping Optimistic Lock (Job likely already processing)`);
        }

        let totalItemsFound = 0;

        // 4. Process Each File
        debugSummary = {
            jobId: job_id,
            stage: 'processing_files',
            files: [] as any[],
            total_items: 0,
            rate_limit_encountered: false
        };

        for (const file of files) {
            console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Processing file: ${file.original_filename} (${file.id})`);
            const fileDebug: any = {
                file_id: file.id,
                filename: file.original_filename,
                // ... (Metrics preserved in object spread or recreating strict necessary fields)
                pdf_attempted: false,
                ocr_attempted: false
            };
            debugSummary.files.push(fileDebug);

            // A. Download
            const { data: fileBlob, error: downloadErr } = await supabase.storage
                .from(file.storage_bucket || "imports")
                .download(file.storage_path);

            if (downloadErr || !fileBlob) {
                fileDebug.error = `Download failed: ${downloadErr?.message}`;
                throw new Error(fileDebug.error!);
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // HELPER: Chunked Base64 Encoding
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            function arrayBufferToBase64(buffer: ArrayBuffer): string {
                const bytes = new Uint8Array(buffer);
                const CHUNK_SIZE = 8192;
                let binary = '';
                for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
                    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
                    binary += String.fromCharCode.apply(null, Array.from(chunk));
                }
                return btoa(binary);
            }

            // Strategy 0 State
            let fullScanSuccess = false;
            let usedPdfFirst = false;

            console.log(`[OCR-FLOW-DEBUG] [REQ ${requestId}] File ${file.id}: Starting Strategy 0 (Full Scan) Check`);

            // B. Full Scan Strategy
            const pdfDet = isPdfFile(file);
            if (pdfDet.isPdf) {
                console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] 🎯 ENTER_STRATEGY_0_FULLSCAN`);

                try {
                    // Extract context params early for Guard
                    const { mode, ocr_job_id } = reqBody;
                    const isWorkerMode = mode === 'worker_chunk_process';

                    // HARDENED GUARD: Check metadata BEFORE heavy lifting (download/extract)
                    // If we know it's oversized, fail immediately to save CPU/Memory
                    if (file.metadata?.ocr?.oversized === true) {
                        console.warn(`[OCR-FLOW-DEBUG] [REQ ${requestId}] Early Skip: File flagged as oversized in metadata.`);

                        if (isWorkerMode && ocr_job_id) {
                            console.log(`[OCR-FB-DEBUG] worker_mode + meta_oversized -> Locking down job ${ocr_job_id} as COMPLETED_WITH_WARNINGS.`);

                            // 1. Create Placeholder Item (Mandatory for "Always Produce Items")
                            await supabase.from("import_ai_items").insert([{
                                job_id,
                                import_file_id: file.id,
                                idx: 0,
                                description: "Falha na leitura automática (Arquivo muito grande). Revisão manual necessária.",
                                unit: null,
                                quantity: null,
                                unit_price: null,
                                total: null,
                                confidence: 0.0,
                                raw_line: "OVERSIZED_METADATA_GUARD"
                            }]);

                            // 2. Mark OCR Job as Completed (NOT Failed)
                            // Using RPC to ensure atomic status + lock release
                            await supabase.rpc('update_ocr_job_status', {
                                p_id: ocr_job_id,
                                p_status: 'completed', // Or 'completed_with_warnings' if available, defaulting to completed for compatibility
                                p_last_error: `Warning: Oversized file (Metadata). Placeholder created.`
                            });

                            return jsonResponse({
                                status: "completed",
                                reason: "oversized_guard_early_metadata_handled"
                            });
                        }
                    }

                    const blobBuffer = await fileBlob.arrayBuffer();
                    const pdfData = await extractPdfText(blobBuffer);

                    if (pdfData && pdfData.text && pdfData.text.length > FULL_SCAN_MIN_TEXT_LEN) {



                        // FIX: PROTECT AGAINST HUGE TEXT (CPU KILLER) - HARD SKIP STRUCTURAL
                        const realLen = pdfData?.text?.length || 0;
                        const isTextOversized = realLen > FULLSCAN_MAX_CHARS;

                        // Check if file metadata explicitly says it's oversized (from previous attempts)
                        const metaOversized = (file.metadata?.ocr?.oversized === true);
                        const effectiveOversized = isTextOversized || metaOversized;

                        // Pre-calculate common metadata vars
                        let chunks: ReturnType<typeof createTextChunks> | null = null;
                        let fullScanModelName: string | null = null;

                        // Extract context params early
                        const { mode, start_chunk_index, max_chunks, ocr_job_id } = reqBody;
                        const isWorkerMode = mode === 'worker_chunk_process';

                        if (effectiveOversized) {
                            console.warn(`[OCR-FLOW-DEBUG] [REQ ${requestId}] FullScan skipped: text too large (${realLen} chars) - Effective Oversized: ${effectiveOversized}`);

                            if (isWorkerMode && ocr_job_id) {
                                console.log(`[OCR-FB-DEBUG] worker_mode + oversized -> Marking job ${ocr_job_id} as COMPLETED_WITH_WARNINGS.`);

                                // 1. Create Placeholder Item (Mandatory for "Always Produce Items")
                                await supabase.from("import_ai_items").insert([{
                                    job_id,
                                    import_file_id: file.id,
                                    idx: 0,
                                    description: `Falha na leitura automática (Texto muito longo: ${realLen} chars). Revisão manual necessária.`,
                                    unit: null,
                                    quantity: null,
                                    unit_price: null,
                                    total: null,
                                    confidence: 0.0,
                                    raw_line: "OVERSIZED_TEXT_GUARD"
                                }]);

                                // 2. Mark OCR Job as Completed (NOT Failed)
                                await supabase.rpc('update_ocr_job_status', {
                                    p_id: ocr_job_id,
                                    p_status: 'completed',
                                    p_last_error: `Warning: Oversized text (${realLen} chars). Placeholder created.`
                                });

                                return jsonResponse({
                                    status: "completed",
                                    reason: "oversized_guard_success"
                                });
                            }
                            // Fall through to ensure metadata update if not worker mode
                        } else {
                            // --- NORMAL STRATEGY 0 EXECUTION (Text Size OK) ---
                            console.log(`[OCR-FB-DEBUG] FullScan Text Len: ${realLen}`);

                            // Chunking
                            chunks = createTextChunks(pdfData.text, pdfData.numpages);

                            const fsModelInfo = await discoverGeminiModel(GEMINI_API_KEY, "gemini-1.5-flash");
                            fullScanModelName = fsModelInfo.modelId;

                            // Chunk Loop
                            const { mode, start_chunk_index, max_chunks, ocr_job_id } = reqBody;
                            const isWorkerMode = mode === 'worker_chunk_process';
                            const startIdx = isWorkerMode ? (start_chunk_index || 0) : 0;
                            const chunkLimit = isWorkerMode ? (max_chunks || 3) : chunks.length;
                            const endIdx = Math.min(startIdx + chunkLimit, chunks.length);

                            console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Loop: ${startIdx} to ${endIdx}`);

                            for (let cIdx = startIdx; cIdx < endIdx; cIdx++) {
                                // Extract
                                const chunk = chunks[cIdx];
                                const CHUNK_PROMPT = `
# CONTEXTO
Você é um sistema de extração estruturada de itens orçamentários.
# OBJETIVO
Extrair itens como JSON { "items": [...] }.
TEXTO:
`;
                                const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
                                const model = genAI.getGenerativeModel({ model: fullScanModelName, generationConfig: { responseMimeType: "application/json" } });

                                try {
                                    const result = await generateContentWithRetry(model, {
                                        contents: [{ role: "user", parts: [{ text: CHUNK_PROMPT + "\n\nTEXT:\n" + chunk.text.slice(0, 100000) }] }]
                                    });
                                    const txt = result.response.text();
                                    const parsed = parseJsonLenient(txt);

                                    if (parsed.success && parsed.data?.items?.length > 0) {
                                        const chunkItems = parsed.data.items;

                                        // Prepare Rows
                                        const rows = chunkItems.map((it: any, idx: number) => {
                                            const dedupKey = `${normalizeForDedup(it.description)}|${normalizeNumberForDedup(it.total)}|${cIdx}|${idx}`;
                                            return {
                                                job_id,
                                                import_file_id: file.id,
                                                chunk_index: cIdx,
                                                idx: (cIdx * 1000) + idx,
                                                description: it.description || "Item FullScan",
                                                unit: it.unit,
                                                quantity: it.quantity,
                                                unit_price: it.unit_price,
                                                total: it.total,
                                                confidence: 0.9,
                                                dedup_key: dedupKey,
                                                raw_line: it.raw_line
                                            };
                                        });

                                        // FIX: DELETE + INSERT (Idempotency by Chunk)
                                        // Avoids 42P10 error with Upsert Partial Index
                                        const { error: delErr } = await supabase.from("import_ai_items")
                                            .delete()
                                            .eq("job_id", job_id)
                                            .eq("import_file_id", file.id)
                                            .eq("chunk_index", cIdx);

                                        if (delErr) console.warn(`[OCR-FB-DEBUG] Delete Error Chunk ${cIdx}:`, delErr);

                                        const { error: insErr } = await supabase.from("import_ai_items")
                                            .insert(rows);

                                        if (insErr) console.warn(`[OCR-FB-DEBUG] Insert Error Chunk ${cIdx}:`, insErr);
                                        else totalItemsFound += rows.length;
                                    }

                                    // Checkpoint Update
                                    if (isWorkerMode && ocr_job_id) {
                                        await supabase.rpc('save_chunk_progress', {
                                            p_ocr_job_id: ocr_job_id,
                                            p_chunk_index: cIdx,
                                            p_total_chunks: chunks.length,
                                            p_is_final: (cIdx === chunks.length - 1)
                                        });
                                    }

                                } catch (chunkErr) {
                                    console.warn(`[OCR-FB-DEBUG] Chunk ${cIdx} failed:`, chunkErr);
                                }
                            } // End Loop


                            // Worker Mode: Exit after processing batch
                            if (isWorkerMode) {
                                const isComplete = endIdx >= (chunks?.length || 0);
                                // Return response to stop execution (Worker expects one batch per call)
                                return jsonResponse({
                                    status: isComplete ? 'completed' : 'continued',
                                    chunks_done: endIdx
                                });
                            }
                        } // End else isTextOversized

                        // PERSISTENCE (Strategy 0 - UNCONDITIONAL): Save evidence even if oversized
                        try {
                            const textToSave = isTextOversized ? null : pdfData.text.slice(0, FULLSCAN_MAX_CHARS);

                            const { error: fileUpdErr } = await supabase.from('import_files')
                                .update({
                                    extracted_text: textToSave,
                                    metadata: {
                                        ...(file.metadata ?? {}), // Safe merge
                                        ocr: {
                                            method: 'fullscan_strategy_0',
                                            text_len: realLen,
                                            oversized: isTextOversized,
                                            chunks_total: chunks ? chunks.length : null,
                                            model: fullScanModelName || null,
                                            ts: new Date().toISOString()
                                        }
                                    }
                                })
                                .eq('id', file.id);

                            if (fileUpdErr) console.error(`[OCR-FB-DEBUG] Failed to persist Strategy 0 metadata:`, fileUpdErr);
                            else console.log(`[OCR-FB-DEBUG] Persisted Strategy 0 metadata (Oversized=${isTextOversized})`);

                        } catch (persistErr) {
                            console.error(`[OCR-FB-DEBUG] Persistence Error:`, persistErr);
                        }

                    } else {
                        fileDebug.text_extraction_method = 'failed_or_empty';
                    }
                } catch (fsErr) {
                    console.error("FullScan Error", fsErr);
                    fileDebug.text_extraction_method = 'error';
                }
            } else {
                console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] SKIP_STRATEGY_0_NOT_PDF: File: ${file.original_filename} (${file.content_type})`);
                console.log(`[OCR-FLOW-DEBUG] [REQ ${requestId}] File ${file.id}: Strategy 0 Skipped (Not PDF)`);
            }

            // --- STRATEGY 1: PDF-FIRST (Direct Gemini Document) ---
            // Only run if Full Scan didn't happen or failed
            let pdfFirstSuccess = false;

            if (!fullScanSuccess) {
                console.log(`[OCR-FLOW-DEBUG] [REQ ${requestId}] File ${file.id}: Entering Strategy 1 (PDF-First)`);
                // ... Existing PDF-First Logic ...
                usedPdfFirst = true;

                // ... (keep existing PDF First block below, wrapped or guarded)

                const pdfDebugStart = Date.now();

                // Limit PDF first to reasonable size (e.g. 15MB) to avoid OOM or timeout
                if (fileBlob.size < 15 * 1024 * 1024 && GEMINI_API_KEY) {
                    console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] PDF-First: Starting extraction on ${fileBlob.size} bytes...`);

                    // Start PDF-first tracking
                    fileDebug.pdf_attempted = true;
                    fileDebug.pdf_mode = 'attempted';
                    const pdfStart = Date.now();

                    // 🛡️ BLINDAGEM COMPLETA: Capture ALL errors except rate-limit
                    try {
                        const arrayBuffer = await fileBlob.arrayBuffer();

                        // Use chunked encoding to prevent stack overflow on large files
                        const base64Data = arrayBufferToBase64(arrayBuffer);

                        // Discover working Gemini model (NO test call to avoid 404)
                        const primaryModel = "gemini-1.5-flash";
                        fileDebug.pdf_model_primary = primaryModel;  // Set BEFORE discovery
                        fileDebug.pdf_model_used = primaryModel;  // Default to primary

                        const modelInfo = await discoverGeminiModel(GEMINI_API_KEY, primaryModel);

                        // Update with actual model used
                        fileDebug.pdf_model_used = modelInfo.modelId;
                        if (modelInfo.fallbackUsed) {
                            fileDebug.pdf_model_fallback_reason = "preferred_not_available";
                        }

                        console.log(`[PDF-FIRST] Using model: ${modelInfo.modelId} (fallback: ${modelInfo.fallbackUsed}, available: ${modelInfo.availableCount})`);

                        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
                        const model = genAI.getGenerativeModel({
                            model: modelInfo.modelId,
                            generationConfig: { responseMimeType: "application/json" }
                        });

                        const PDF_PROMPT = `
# CONTEXTO
Você é um sistema de extração estruturada de itens orçamentários a partir de PDF (PDF Parser).

# OBJETIVO
Extrair CADA ITEM como uma linha independente, preenchendo:
- description (obrigatório)
- unit
- quantity
- unit_price
- total
- raw_line
- confidence

# REGRAS CRÍTICAS
1) NUNCA preencha quantity, unit_price ou total com 0 se o valor não estiver explícito.
2) Use ponto como separador decimal.
3) NÃO consolide linhas.

RETORNE JSON: { "items": [...] }
`;

                        // USE RETRY WRAPPER
                        const result = await generateContentWithRetry(model, {
                            contents: [{
                                role: "user",
                                parts: [
                                    { text: PDF_PROMPT },
                                    { inlineData: { mimeType: "application/pdf", data: base64Data } }
                                ]
                            }]
                        });

                        const responseText = result.response.text();
                        let parsedPdf: z.infer<typeof GeminiOutputSchema> = { items: [] };

                        const parseResult = parseJsonLenient(responseText);
                        if (!parseResult.success) throw new Error(`JSON parse failed: ${parseResult.reason}`);
                        parsedPdf = parseResult.data;
                        if (parseResult.recovered) {
                            fileDebug.pdf_json_parse_recovered = true;
                            fileDebug.pdf_json_recover_reason = parseResult.reason;
                        }

                        fileDebug.pdf_items = parsedPdf?.items?.length || 0;

                        if (parsedPdf?.items && Array.isArray(parsedPdf.items) && parsedPdf.items.length >= 3) {
                            console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] PDF-First SUCCESS. Items found: ${parsedPdf.items.length}`);

                            // Insert items immediately
                            await supabase.from("import_ai_items").delete()
                                .eq("job_id", job_id)
                                .eq("import_file_id", file.id);

                            const rows = parsedPdf.items.map((it, idx) => ({
                                job_id,
                                import_file_id: file.id,
                                idx: idx,
                                description: it.description || "Item recuperado via PDF",
                                unit: it.unit,
                                quantity: it.quantity,
                                unit_price: it.unit_price,
                                total: (it as any).total ?? ((it.quantity && it.unit_price) ? (it.quantity * it.unit_price) : null),
                                confidence: 0.95, // Very high confidence for direct PDF
                                category: null,
                                raw_line: null
                            }));

                            // LOGGING: NULL NUMBERS
                            rows.forEach(r => {
                                if (r.quantity === null || r.unit_price === null || r.total === null) {
                                    console.log(`[OCR-FB-DEBUG] AI_ITEM_ACCEPTED_WITH_NULL_NUMBERS job=${job_id} idx=${r.idx} desc="${r.description?.substring(0, 30)}"`);
                                }
                            });

                            const { error: insertError } = await supabase.from("import_ai_items").insert(rows);
                            if (!insertError) {
                                totalItemsFound += parsedPdf.items.length;
                                traceTrace(parsedPdf.items.length, 'memory_pdf_first', 'after_pdf_insert');

                                pdfFirstSuccess = true;
                                fileDebug.db_inserted = rows.length;
                                fileDebug.pdf_mode = 'success';

                                // New instrumentation fields
                                fileDebug.pdf_duration_ms = Date.now() - pdfStart;
                                fileDebug.pdf_text_len = 0; // Gemini doesn't return  text len directly
                                fileDebug.gemini_parse_attempted = true;
                                fileDebug.gemini_raw_items = parsedPdf.items.length;
                                fileDebug.gemini_valid_items = parsedPdf.items.filter((it: any) => it.description).length;

                                console.log(`[OCR-FB-PERF] PDF-First: ${fileDebug.pdf_duration_ms}ms, items=${fileDebug.pdf_items}`);

                                // 🎯 INSTRUMENTAÇÃO SEGURA
                                (fileDebug as any).pdf_first_debug = {
                                    mode: 'success',
                                    elapsed_ms: Date.now() - pdfDebugStart,
                                    items_found: parsedPdf.items.length,
                                    timestamp: new Date().toISOString()
                                };
                            } else {
                                console.error(`[OCR-FB-DEBUG] [REQ ${requestId}] PDF-First DB Error:`, insertError);
                                const errorMsg = String(insertError.message || 'Unknown DB error').substring(0, 200);
                                fileDebug.error = `DB Insert Error: ${errorMsg}`;
                                fileDebug.pdf_mode = 'db_error';

                                // New instrumentation fields
                                fileDebug.pdf_duration_ms = Date.now() - pdfStart;
                                fileDebug.pdf_text_len = 0;
                                fileDebug.gemini_parse_attempted = true;
                                fileDebug.gemini_raw_items = parsedPdf.items.length;
                                fileDebug.gemini_valid_items = 0;

                                // 🎯 INSTRUMENTAÇÃO SEGURA
                                (fileDebug as any).pdf_first_debug = {
                                    mode: 'error',
                                    error_name: 'DatabaseError',
                                    error_message_truncated: errorMsg,
                                    stage_reached: 'db_insert',
                                    elapsed_ms: Date.now() - pdfDebugStart,
                                    timestamp: new Date().toISOString()
                                };
                            }
                        } else {
                            console.warn(`[OCR-FB-DEBUG] [REQ ${requestId}] PDF-First low yield (${parsedPdf?.items?.length || 0} items). Falling back...`);
                            fileDebug.pdf_mode = 'low_yield';

                            // New instrumentation fields
                            fileDebug.pdf_duration_ms = Date.now() - pdfStart;
                            fileDebug.pdf_text_len = 0;
                            fileDebug.gemini_parse_attempted = true;
                            fileDebug.gemini_raw_items = parsedPdf?.items?.length || 0;
                            fileDebug.gemini_valid_items = parsedPdf?.items?.length || 0;
                            fileDebug.discard_reason = 'low_yield_min_3_required';

                            // 🎯 INSTRUMENTAÇÃO SEGURA
                            (fileDebug as any).pdf_first_debug = {
                                mode: 'error',
                                error_name: 'LowYield',
                                error_message_truncated: `Only ${parsedPdf?.items?.length || 0} items extracted (min 3 required)`,
                                stage_reached: 'parse_response',
                                elapsed_ms: Date.now() - pdfDebugStart,
                                timestamp: new Date().toISOString()
                            };
                        }

                    } catch (pdfErr: any) {
                        // ⚠️ RATE LIMIT = SHORT CIRCUIT (throw immediately)
                        if (pdfErr instanceof RateLimitError || pdfErr?.message === "RateLimitHit") {
                            console.error(`[OCR-FB-DEBUG] [REQ ${requestId}] PDF-First: Rate limit detected, throwing...`);
                            throw pdfErr;
                        }

                        // ✅ ALL OTHER ERRORS: CAPTURE, LOG, CONTINUE TO OCR
                        const errorName = pdfErr?.name || pdfErr?.constructor?.name || 'UnknownError';
                        const errorMsg = String(pdfErr?.message || 'Unknown error').substring(0, 200);

                        console.warn(`[OCR-FB-DEBUG] [REQ ${requestId}] PDF-First Failed (${errorName}):`, errorMsg);
                        console.warn(`[OCR-FB-DEBUG] [REQ ${requestId}] Will continue to OCR EC2 fallback...`);

                        fileDebug.error = `PDF-First Error: ${errorMsg}`;
                        fileDebug.pdf_error_message = errorMsg;  // Short version for instrumentation
                        fileDebug.pdf_mode = 'error';

                        // New instrumentation fields
                        fileDebug.pdf_duration_ms = Date.now() - pdfStart;
                        fileDebug.pdf_text_len = 0;

                        // 🎯 INSTRUMENTAÇÃO SEGURA (NO CIRCULAR OBJECTS)
                        (fileDebug as any).pdf_first_debug = {
                            mode: 'error',
                            error_name: errorName,
                            error_message_truncated: errorMsg,
                            stage_reached: 'unknown', // Could be load_pdf, send_to_gemini, or parse_response
                            elapsed_ms: Date.now() - pdfDebugStart,
                            timestamp: new Date().toISOString()
                        };

                        // 🚨 CRITICAL: DO NOT THROW - CONTINUE TO OCR EC2
                    }
                } else {
                    console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Skipping PDF-First (Big file or No Key).`);
                    console.log(`[OCR-FLOW-DEBUG] [REQ ${requestId}] File ${file.id}: Strategy 1 Skipped (Criteria not met)`);
                }
            } else {
                console.log(`[OCR-FLOW-DEBUG] [REQ ${requestId}] File ${file.id}: Strategy 1 Skipped (FullScan was success)`);
            } // End if (!fullScanSuccess)

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // COMPLETENESS CHECK (PDF-FIRST)
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            let runOcrFallback = false;

            if (pdfFirstSuccess || fullScanSuccess) {
                const completeness = computeCompletenessScore(fileDebug);
                fileDebug.is_low_completeness = completeness.is_low_completeness;
                fileDebug.completeness_reason = completeness.reason;

                // 🌟 STRUCTURAL VALIDATION (New)
                const validation = computeExtractionMetrics({
                    pagesTotal: fileDebug.pages_total,
                    itemsValidCount: totalItemsFound, // Current accumulated valid items
                    itemsPerPageBaseline: 8,
                    pdfTextLen: fileDebug.pdf_text_len || 0,
                    ocrAttempted: false
                });

                console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] PDF_EXTRACTION_METRICS`, JSON.stringify(validation));

                // Save metrics to fileDebug for persistence
                (fileDebug as any).extraction_metrics = validation;

                // Decision: Low Completeness OR Structurally Invalid
                if (completeness.is_low_completeness || !validation.structurally_valid) {
                    runOcrFallback = true;
                    if (!validation.structurally_valid) {
                        fileDebug.ocr_triggered_by = 'structurally_invalid';
                        console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Structurally invalid extraction (${validation.structural_reasons.join(', ')}). Force Triggering OCR.`);
                    } else {
                        fileDebug.ocr_triggered_by = 'low_completeness';
                        console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Low completeness detected (${completeness.reason}). Triggering OCR.`);
                    }
                } else {
                    fileDebug.ocr_triggered_by = 'not_triggered';
                    console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Completeness & Structure OK. Skipping OCR.`);
                    console.log(`[OCR-FLOW-DEBUG] [REQ ${requestId}] File ${file.id}: OCR Skipped (Completeness & Structure OK)`);
                }
            } else {
                // Determine if we should run OCR based on PDF failure logic
                runOcrFallback = shouldRunOcrFallback({
                    attempted: fileDebug.pdf_attempted,
                    mode: fileDebug.pdf_mode as any,
                    items_count: fileDebug.pdf_items || 0,
                    elapsed_ms: fileDebug.pdf_duration_ms || 0
                } as any, true, false); // Assuming OCR configured true for logic check (verified later)

                if (runOcrFallback) {
                    fileDebug.ocr_triggered_by = fileDebug.pdf_mode === 'error' ? 'pdf_error' : 'zero_items';
                }
            }

            // Check OCR configuration
            const ocrBaseUrl = Deno.env.get("OCR_EC2_URL")?.trim().replace(/\/$/, "") || "";
            const ocrConfigured = !!(ocrBaseUrl && !ocrBaseUrl.includes("placeholder"));

            if (!ocrConfigured && runOcrFallback) {
                console.warn(`[OCR-FB-DEBUG] [REQ ${requestId}] OCR needed but NOT configured.`);
                fileDebug.ocr_skip_reason = 'ocr_config_missing';
                fileDebug.ocr_status = 'config_error';
                runOcrFallback = false;
                console.log(`[OCR-FLOW-DEBUG] [REQ ${requestId}] File ${file.id}: OCR blocked (Configuration Missing)`);
            }

            if (!runOcrFallback) {
                console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] OCR logic skipped, but enforcing 'ALWAYS PRODUCE ITEMS'. Proceeding to Airbag check.`);
                // Force flow to proceed to extraction logic (which will convert empty text -> placeholder)
                // We do NOT continue here. We fall through to the OCR block, which handles empty inputs safely now.
            } else {
                console.log(`[OCR-FLOW-DEBUG] [REQ ${requestId}] File ${file.id}: Entering Strategy 2 (OCR Fallback)`);
            }

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // EXECUTE LAYER: OCR EC2 -> PDF.CO
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            fileDebug.ocr_attempted = true;
            fileDebug.ocr_mode = 'attempted';
            const ocrStart = Date.now();
            const targetOcrUrl = `${ocrBaseUrl}/ocr`;

            const formData = new FormData();
            formData.append("file", fileBlob, file.original_filename);

            let ocrText = "";
            let triggerPdfCo = false;

            try {
                const ocrResp = await fetch(targetOcrUrl, { method: "POST", body: formData });
                fileDebug.ocr_http_status = ocrResp.status;
                const ocrRespText = await ocrResp.text();
                fileDebug.ocr_response_len = ocrRespText.length;

                if (!ocrResp.ok) {
                    fileDebug.ocr_error_body_sample = ocrRespText.substring(0, 200);
                    fileDebug.ocr_empty_text_reason = 'non_200';
                    triggerPdfCo = true;
                    fileDebug.pdfco_triggered_by = 'ocr_non_200';
                    throw new Error(`OCR HTTP ${ocrResp.status}`);
                }

                const ocrJson = JSON.parse(ocrRespText);
                ocrText = ocrJson.text || ocrJson.content || "";
                fileDebug.ocr_text_len = ocrText.length;

                if (ocrText.length < 50) {
                    fileDebug.ocr_empty_text = true;
                    fileDebug.ocr_empty_text_reason = 'text_too_short';
                    triggerPdfCo = true;
                    fileDebug.pdfco_triggered_by = 'ocr_empty_text';
                } else {
                    fileDebug.ocr_status = 'ok';
                    fileDebug.ocr_mode = 'success';
                }

            } catch (e: any) {
                console.warn(`[OCR-FB-DEBUG] [REQ ${requestId}] OCR EC2 Error: ${e.message}`);
                fileDebug.ocr_status = 'error';
                fileDebug.error = `OCR Error: ${e.message}`;
                triggerPdfCo = true; // Try fallback on error
                if (!fileDebug.pdfco_triggered_by) fileDebug.pdfco_triggered_by = 'ocr_error';
            }
            fileDebug.ocr_duration_ms = Date.now() - ocrStart;

            // PDF.CO FALLBACK
            const PDFCO_API_KEY = Deno.env.get("PDFCO_API_KEY") ?? "";
            const ENABLE_PDFCO = (Deno.env.get("ENABLE_PDFCO_FALLBACK") ?? "false").toLowerCase() === "true";

            if (triggerPdfCo && ENABLE_PDFCO && PDFCO_API_KEY) {
                console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Triggering PDF.co Fallback (${fileDebug.pdfco_triggered_by})...`);
                fileDebug.pdfco_attempted = true;
                const pdfcoStart = Date.now();

                try {
                    const { data: urlData } = await supabase.storage.from('import_files').createSignedUrl(file.storage_path, 3600);
                    if (!urlData?.signedUrl) throw new Error("No signed URL");

                    const pdfcoResp = await fetch('https://api.pdf.co/v1/pdf/convert/to/text', {
                        method: 'POST',
                        headers: { 'x-api-key': PDFCO_API_KEY, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: urlData.signedUrl, async: false, inline: true })
                    });

                    fileDebug.pdfco_http_status = pdfcoResp.status;
                    const pdfcoJson = await pdfcoResp.json();

                    if (!pdfcoResp.ok || pdfcoJson.error) {
                        fileDebug.pdfco_error_body_sample = JSON.stringify(pdfcoJson).substring(0, 200);
                        throw new Error(pdfcoJson.message || `HTTP ${pdfcoResp.status}`);
                    }

                    const pdfcoBody = pdfcoJson.body || "";
                    fileDebug.pdfco_response_len = pdfcoBody.length;
                    fileDebug.pdfco_text_len = pdfcoBody.length;

                    if (pdfcoBody.length >= 50) {
                        ocrText = pdfcoBody;
                        fileDebug.pdfco_status = 'ok';
                        console.log(`[OCR-FB-DEBUG] PDF.co success: ${pdfcoBody.length} chars`);
                    } else {
                        fileDebug.pdfco_skip_reason = 'text_too_short';
                        fileDebug.pdfco_status = 'empty_text';
                    }

                } catch (pe: any) {
                    console.warn(`[OCR-FB-DEBUG] PDF.co Error: ${pe.message}`);
                    fileDebug.pdfco_status = 'error';
                    fileDebug.pdfco_skip_reason = pe.message;
                }
                fileDebug.pdfco_duration_ms = Date.now() - pdfcoStart;
            }

            if (!ocrText || ocrText.length < 50) {
                console.warn(`[OCR-FB-DEBUG] [REQ ${requestId}] No text obtained from any OCR source. Skipping.`);
                console.log(`[OCR-FLOW-DEBUG] [REQ ${requestId}] File ${file.id}: Exiting File Loop Early (No OCR text obtained)`);
                continue;
            }

            // Save text
            await supabase.from("import_files").update({
                extracted_text: ocrText,
                metadata: { ...(file.metadata || {}), ocr_engine: 'ec2_tess_v1' }
            }).eq("id", file.id);



            // C. Gemini Parsing (Text -> JSON)
            if (ocrText.length > 50 && GEMINI_API_KEY) {
                console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Pre-processing OCR text...`);
                console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] OCR_TEXT_READY len=${ocrText.length} preview="${ocrText.slice(0, 500).replace(/\n/g, "\\n")}"`);

                // --- HEURISTICS: CLEAN TEXT ---
                const cleanOcrText = (text: string) => {
                    let cleaned = text
                        // Normalize whitespace but keep newlines
                        .replace(/[ \t]+/g, ' ')
                        // Remove common header/footer junk
                        .replace(/Página \d+ de \d+/gi, '')
                        .replace(/Data: \d{2}\/\d{2}\/\d{4}/g, '')
                        .replace(/Relatório Sintético|Relatório Analítico/gi, '')
                        // Attempt to fix BR numbers (1.234,56 -> 1234.56) ONLY if it looks like a price at end of line
                        // This is risky, so we do it conservatively or just let Gemini handle it. 
                        // Gemini is usually good at "1.234,56", so we skip regex replacement to avoid breaking codes like "1.2.3".
                        .trim();

                    // Join broken lines (heuristic: line ends with hyphen or next line starts with lowercase and is short?)
                    // Simplified: just pass the text, Gemini 1.5 is smart.
                    return cleaned;
                };

                const safeText = cleanOcrText(ocrText).slice(0, 100000); // 100k char limit
                console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Text Length before: ${ocrText.length}, after clean: ${safeText.length}`);

                const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
                const model = genAI.getGenerativeModel({
                    model: "gemini-1.5-flash",
                    generationConfig: { responseMimeType: "application/json" }
                });

                let parsed: z.infer<typeof GeminiOutputSchema> = { items: [] };
                let usedFallback = false;

                // --- ATTEMPT 1: STRUCTURED (SINAPI FOCUSED) ---
                const ATTEMPT_1_PROMPT = `
# CONTEXTO
Você é um sistema de extração estruturada de itens orçamentários.

# OBJETIVO
Extrair CADA ITEM como uma linha independente, preenchendo:
- description (obrigatório)
- unit
- quantity
- unit_price
- total
- raw_line
- confidence

# REGRAS
1) NUNCA preencha 0 se o valor não existir.
2) Use null se ausente.
3) Capturar raw_line é importante.

RETORNE JSON: { "items": [...] }
`;

                try {
                    console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Attempt 1: Structured Extraction...`);
                    // LOGGING INPUT
                    console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] GEMINI_INPUT_SAFE_TEXT len=${safeText.length} preview="${safeText.slice(0, 500).replace(/\n/g, "\\n")}"`);

                    // USE RETRY WRAPPER
                    const result1 = await generateContentWithRetry(model, {
                        contents: [{ role: "user", parts: [{ text: ATTEMPT_1_PROMPT + "\n\nTEXTO:\n" + safeText }] }]
                    });
                    const txt1 = result1.response.text();
                    console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] GEMINI_RESPONSE len=${txt1.length} preview="${txt1.slice(0, 500).replace(/\n/g, "\\n")}"`);
                    const parse1 = parseJsonLenient(txt1);
                    if (parse1.success) {
                        parsed = parse1.data;
                        if (parse1.recovered) {
                            fileDebug.pdf_json_parse_recovered = true;
                            fileDebug.pdf_json_recover_reason = parse1.reason;
                        }
                    }
                    fileDebug.gemini_1_items = parsed?.items?.length || 0;
                } catch (e: any) {
                    if (e instanceof RateLimitError) throw e; // BUBBLE UP
                    console.warn(`[OCR-FB-DEBUG] [REQ ${requestId}] Attempt 1 failed (JSON or API):`, e);
                    fileDebug.error = `Attempt 1 Error: ${e.message}`;
                }

                console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Attempt 1 Results: ${parsed?.items?.length || 0} items.`);

                // --- ATTEMPT 2: AGGRESSIVE RECOVERY (If Attempt 1 was poor) ---
                if (!parsed?.items || !Array.isArray(parsed.items) || parsed.items.length < 3) {
                    console.warn(`[OCR-FB-DEBUG] [REQ ${requestId}] Attempt 1 yielded few items. Trying Attempt 2 (Aggressive)...`);
                    usedFallback = true;

                    const ATTEMPT_2_PROMPT = `
MODO: RECUPERAÇÃO AGRESSIVA.
Extraia qualquer linha que pareça um item de orçamento.
Obrigatório: DESCRIPTION.
Se encontrar números soltos, tente inferir: quantity, unit_price, total.
Se não encontrar, use null.
RETORNE JSON: { "items": [...] }
`;
                    try {
                        // USE RETRY WRAPPER
                        const result2 = await generateContentWithRetry(model, {
                            contents: [{ role: "user", parts: [{ text: ATTEMPT_2_PROMPT + "\n\nTEXTO:\n" + safeText }] }]
                        });
                        const txt2 = result2.response.text();
                        const parse2 = parseJsonLenient(txt2);
                        if (parse2.success) {
                            parsed = parse2.data;
                            if (parse2.recovered) {
                                fileDebug.pdf_json_parse_recovered = true;
                                fileDebug.pdf_json_recover_reason = parse2.reason;
                            }
                        }
                        fileDebug.gemini_2_items = parsed?.items?.length || 0;
                    } catch (e: any) {
                        if (e instanceof RateLimitError || e?.message === "RateLimitHit") throw e; // BUBBLE UP
                        console.warn(`[OCR-FB-DEBUG] [REQ ${requestId}] Attempt 2 failed:`, e);
                        fileDebug.error = `Attempt 2 Error: ${e.message}`;
                    }
                    console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Attempt 2 Results: ${parsed?.items?.length || 0} items.`);
                }


                // --- FINAL SAFETY NET (AIRBAG) ---
                if (!parsed?.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
                    console.warn(`[OCR-FB-DEBUG] [REQ ${requestId}] Gemini returned invalid/empty JSON. Applying FORCED FALLBACK item.`);
                    const safeSnippet = ocrText.slice(0, 200).replace(/\n/g, " ").trim();
                    parsed = {
                        items: [{
                            description: `Item recuperado do OCR (Revisar): ${safeSnippet}...`,
                            unit: null,
                            quantity: null,
                            unit_price: null,
                            total: null,
                            raw_line: null,
                            confidence: 0.5,
                            code: null
                        }]
                    };
                }

                // Force type check
                if (!parsed.items) parsed.items = [];

                if (parsed.items.length > 0) {
                    console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] OCR_FALLBACK_GEMINI_OK. Items: ${parsed.items.length}`);
                    // totalItemsFound increment removed (relying on DB count)

                    // Log samples for debug
                    parsed.items.slice(0, 3).forEach((it, i) => {
                        console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Item[${i}]: ${it.description?.substring(0, 50)}... | $${it.unit_price}`);
                    });

                    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    // MERGE/DEDUP LOGIC (for completeness mode)
                    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

                    let itemsToInsert = parsed.items;
                    let dedupedCount = 0;

                    if (pdfFirstSuccess) {
                        // OCR is running for completeness - merge with existing items
                        console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Running MERGE/DEDUP (OCR for completeness mode)...`);

                        // Fetch existing items for this file
                        const { data: existingItems, error: fetchErr } = await supabase
                            .from("import_ai_items")
                            .select("*")
                            .eq("job_id", job_id)
                            .eq("import_file_id", file.id);

                        if (fetchErr) {
                            console.error(`[OCR-FB-DEBUG] [REQ ${requestId}] Error fetching existing items:`, fetchErr);
                        } else {
                            console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Found ${existingItems?.length || 0} existing items to check for duplicates`);

                            if (existingItems && existingItems.length > 0) {
                                // Build dedup Set from existing items
                                const existingKeys = new Set<string>();
                                existingItems.forEach((existingItem: any) => {
                                    const key = createDedupKey(existingItem);
                                    existingKeys.add(key);
                                });

                                // Filter OCR items - only keep non-duplicates
                                const originalCount = parsed.items.length;
                                itemsToInsert = parsed.items.filter((ocrItem: any) => {
                                    const key = createDedupKey(ocrItem);
                                    const isDuplicate = existingKeys.has(key);
                                    if (isDuplicate) {
                                        console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] DEDUP: Skipping duplicate item: ${ocrItem.description?.substring(0, 40)}`);
                                    }
                                    return !isDuplicate;
                                });

                                dedupedCount = originalCount - itemsToInsert.length;
                                console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] DEDUP: ${itemsToInsert.length} new items, ${dedupedCount} duplicates removed`);
                            }
                        }

                        // Update post-OCR tracking
                        fileDebug.post_ocr_valid_items = (fileDebug.pre_ocr_valid_items || 0) + itemsToInsert.length;
                        fileDebug.ocr_added_items = itemsToInsert.length;
                        fileDebug.ocr_deduped_items = dedupedCount;

                        // Also track as PDF.co metrics if source was PDF.co
                        if (fileDebug.pdfco_status === 'ok') {
                            fileDebug.pdfco_added_items = itemsToInsert.length;
                            fileDebug.pdfco_deduped_items = dedupedCount;
                        }
                    } else {
                        // Normal OCR fallback mode - delete and replace
                        console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Normal OCR fallback mode - replacing all items`);
                        await supabase.from("import_ai_items").delete()
                            .eq("job_id", job_id)
                            .eq("import_file_id", file.id);
                    }

                    // D.2 Insert new/non-duplicate items
                    if (itemsToInsert.length > 0) {
                        const rows = itemsToInsert.map((it, idx) => ({
                            job_id,
                            import_file_id: file.id,
                            idx: idx,
                            description: it.description || "Item sem descrição",
                            unit: it.unit,
                            quantity: it.quantity,
                            unit_price: it.unit_price,
                            total: (it as any).total ?? ((it.quantity && it.unit_price) ? (it.quantity * it.unit_price) : null),
                            confidence: it.confidence || (usedFallback ? 0.5 : 0.8),
                            category: null,
                            raw_line: null
                        }));

                        // LOGGING: NULL NUMBERS
                        rows.forEach(r => {
                            if (r.quantity === null || r.unit_price === null || r.total === null) {
                                console.log(`[OCR-FB-DEBUG] AI_ITEM_ACCEPTED_WITH_NULL_NUMBERS job=${job_id} idx=${r.idx} desc="${r.description?.substring(0, 30)}"`);
                            }
                        });

                        const { error: insertError } = await supabase.from("import_ai_items").insert(rows);

                        if (insertError) {
                            console.error(`[OCR-FB-DEBUG] [REQ ${requestId}] Failed to insert items into import_ai_items:`, insertError);
                            fileDebug.error = `DB Insert Error (Fallback): ${insertError.message}`;
                        } else {
                            fileDebug.db_inserted = rows.length;
                            traceTrace(rows.length, 'memory_gemini_fallback', 'after_gemini_insert');
                            console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] Successfully inserted ${rows.length} items`);
                        }
                    } else {
                        console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] No new items to insert after dedup`);
                    }
                }
            }
        }

        debugSummary.total_items = totalItemsFound;

        // ------------------------------------------------------------------
        // FIX: VERIFY REAL DB STATE (SSOT)
        // ------------------------------------------------------------------
        // Invariante: decisão final depende estritamente do banco, não da memória.
        const { count: realDbCount, error: countErr } = await supabase
            .from("import_ai_items")
            .select("*", { count: "exact", head: true })
            .eq("job_id", job_id);

        countQueryRan = true;
        realDbCountVerified = realDbCount || 0;

        const finalCount = realDbCountVerified || 0;
        console.log(`[REQ ${requestId}] DB VERIFICATION: Found ${finalCount} items in import_ai_items (Memory said: ${totalItemsFound})`);
        traceTrace(finalCount, 'db_count_query', 'finalize_job_verification');

        // Update debug summary with real reality
        debugSummary.db_verified_count = finalCount;

        const dbVerificationBlock = {
            job_id_used: job_id,
            count_query_ran: true,
            real_db_count: finalCount,
            timestamp: new Date().toISOString()
        };


        // ------------------------------------------------------------------
        // HELPER: Hydrate Budget Items (Idempotent)
        // ------------------------------------------------------------------


        // 5. Hydrate & Finalize Logic (CLEAN & ROBUST)
        console.log(`[REQ ${requestId}] OCR_FALLBACK_DONE. Items from DB: ${finalCount}`);

        if (finalCount > 0) {
            let hydrationResult = { inserted: 0, skippedExisting: 0 };
            let hydrationError: any = null;
            let resolvedBudgetId: string | null = null;

            // Resolve Budget ID if we have items
            if (finalCount > 0) {
                resolvedBudgetId = await resolveBudgetIdForJob(supabase, String(currentJobId || job_id), jobData);
            }

            // Attempt Hydration if we have items and a budget
            if (finalCount > 0 && resolvedBudgetId) {
                try {
                    hydrationResult = await hydrateBudgetItemsFromAI({
                        supabase,
                        requestId,
                        jobId: String(currentJobId || job_id),
                        budgetId: resolvedBudgetId
                    });
                } catch (err: any) {
                    console.error(`[REQ ${requestId}] Hydration Failed:`, err);
                    hydrationError = err;
                }
            } else if (finalCount > 0 && !resolvedBudgetId) {
                console.warn(`[REQ ${requestId}] Skipping hydration: No budget_id resolved for job.`);
                // We will handle this as a "waiting_user" state below
            }

            // Handle Hydration Failure -> Force Waiting User
            if (hydrationError) {
                const errorMsg = hydrationError.message || "Unknown hydration error";
                await supabase.from("import_jobs").update({
                    status: "waiting_user",
                    current_step: "waiting_user_hydration_failed",
                    last_error: errorMsg,
                    document_context: {
                        ...(jobData.document_context || {}),
                        ocr_fallback_executed: true,
                        inserted_items_count: finalCount,
                        debug_info: createSafeDebugInfo(debugSummary),
                        user_action: {
                            required: true,
                            reason: "technical_error",
                            message: "Itens identificados, mas houve erro ao criar o orçamento. Tente novamente.",
                            items_count: finalCount
                        }
                    }
                }).eq("id", currentJobId || job_id);

                console.log(`[REQ ${requestId}] JOB_MARKED_WAITING_USER_HYDRATION_FAILED`);
                return jsonResponse({ ok: false, status: "waiting_user", error: "hydration_failed" }, 200, req);
            }

            // Handle Missing Budget ID -> Force Waiting User
            if (finalCount > 0 && !resolvedBudgetId) {
                await supabase.from("import_jobs").update({
                    status: "waiting_user",
                    current_step: "waiting_user_budget_id_missing",
                    last_error: "Could not resolve budget_id",
                    document_context: {
                        ...(jobData.document_context || {}),
                        ocr_fallback_executed: true,
                        inserted_items_count: finalCount,
                        debug_info: createSafeDebugInfo(debugSummary),
                        user_action: {
                            required: true,
                            reason: "budget_id_missing",
                            message: "Não foi possível vincular este processamento a um orçamento existente. Por favor, entre em contato com o suporte ou tente novamente.",
                            items_count: finalCount
                        }
                    }
                }).eq("id", currentJobId || job_id);

                console.log(`[REQ ${requestId}] JOB_MARKED_WAITING_USER_BUDGET_ID_MISSING`);
                return jsonResponse({ ok: false, status: "waiting_user", error: "budget_id_missing" }, 200, req);
            }

            // Logic for Done vs Partial
            // 1. Check Completeness Threshold
            const isThresholdMet = finalCount >= COMPLETENESS_MIN_VALID_ITEMS;

            // 2. Check Structural Validity (New)
            const allFilesStructurallyValid = debugSummary.files.every((f: any) => {
                // If we have metrics, check them. If not (e.g. not computed), assume valid if items > 0?
                // Better to assume valid if metrics missing to avoid regression, 
                // BUT we just added metrics for all paths.
                // If metrics present, respect them.
                return f.extraction_metrics ? f.extraction_metrics.structurally_valid : true;
            });

            const isValudationFail = !allFilesStructurallyValid;
            const isComplete = isThresholdMet && allFilesStructurallyValid;

            if (isComplete) {
                // AUTO Finalize Trigger (Fire & Forget)
                try {
                    await fetch(`${SUPABASE_URL}/functions/v1/import-finalize-budget`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
                        body: JSON.stringify({ job_id: currentJobId, uf: 'BA', competence: new Date().toISOString() })
                    });
                } catch (e) {
                    console.warn(`[OCR-FB-DEBUG] Auto-finalize trigger failed (non-blocking):`, e);
                }

                // SUCCESS STATE
                await supabase.from("import_jobs").update({
                    status: "done", // Terminal success
                    current_step: "done",
                    progress: 100,
                    document_context: {
                        ...(jobData.document_context || {}),
                        ocr_fallback_executed: true,
                        inserted_items_count: finalCount,
                        budget_items_created: hydrationResult.inserted,
                        debug_info: createSafeDebugInfo(debugSummary),
                        db_verification: dbVerificationBlock
                    }
                }).eq("id", currentJobId);

                console.log(`[REQ ${requestId}] JOB_MARKED_DONE`);
                return jsonResponse({ ok: true, items: finalCount, status: "done" }, 200, req);

            } else {
                // PARTIAL STATE
                // Detect low completeness specific reason
                const isCompletenessFail = debugSummary.files.some((f: any) => f.is_low_completeness === true);

                // Construct Reason
                let reason = "partial_extraction";
                let userMsg = `Revisão necessária: ${finalCount} itens encontrados.`;

                if (isValudationFail) {
                    reason = "structurally_invalid";
                    userMsg = `Atenção: A extração parece incompleta (poucos itens para o tamanho do arquivo). ${finalCount} itens encontrados.`;
                } else if (isCompletenessFail) {
                    reason = "low_completeness";
                    userMsg = `Revisão necessária: Baixa confiança na completude. ${finalCount} itens encontrados.`;
                }

                await supabase.from("import_jobs").update({
                    status: "waiting_user",
                    current_step: isValudationFail ? "waiting_user_structurally_invalid" : (isCompletenessFail ? "waiting_user_extraction_failed" : "waiting_user_partial"),
                    progress: 100,
                    document_context: {
                        ...(jobData.document_context || {}),
                        ocr_fallback_executed: true,
                        inserted_items_count: finalCount,
                        budget_items_created: hydrationResult.inserted,
                        debug_info: createSafeDebugInfo(debugSummary),
                        db_verification: dbVerificationBlock,
                        users_manual_review_needed: isValudationFail, // Flag for UI
                        user_action: {
                            required: true,
                            reason: reason,
                            message: userMsg,
                            items_count: finalCount
                        }
                    }
                }).eq("id", currentJobId);

                console.log(`[REQ ${requestId}] JOB_MARKED_WAITING_USER_PARTIAL (Reason: ${reason})`);
                return jsonResponse({ ok: true, items: finalCount, status: "waiting_user", reason: reason }, 200, req);
            }
        } else {
            // Still no items (count == 0)

            // Check if we had technical errors (e.g. DB Insert failed)
            const technicalErrors = debugSummary.files.filter((f: any) => f.error);
            const hasDbError = technicalErrors.some((f: any) => f.error && (f.error.includes("DB Insert") || f.error.includes("Database")));

            if (hasDbError) {
                console.warn(`[REQ ${requestId}] Items found in memory but DB Insert failed. Marking as technical error, not extraction failure.`);

                traceTrace(0, 'hardcoded_error_handling', 'waiting_user_db_error');

                await supabase.from("import_jobs").update({
                    status: "waiting_user", // Keep as waiting_user so user sees the error in UI
                    current_step: "waiting_user_db_error",
                    progress: 100,
                    last_error: "DB Insert Error during fallback",
                    document_context: {
                        ...(jobData.document_context || {}),
                        inserted_items_count: 0,
                        debug_info: createSafeDebugInfo(debugSummary), // 🛡️ SAFE SERIALIZATION
                        db_verification: dbVerificationBlock,
                        db_verification_trace: dbVerificationTrace.slice(-10).map(t => String(t).substring(0, 200)),
                        user_action: {
                            required: true,
                            reason: "technical_error",
                            message: "O sistema identificou itens, mas ocorreu um erro técnico ao salvar no banco de dados. Tente novamente.",
                            items_count: 0
                        }
                    }
                }).eq("id", currentJobId || job_id);

                return jsonResponse({ ok: false, status: "waiting_user", error: "db_insert_error" }, 200, req);
            }

            // Genuine Extraction Failure (No items found, no technical errors)
            traceTrace(0, 'hardcoded_failure_handling', 'waiting_user_extraction_failed');

            await supabase.from("import_jobs").update({
                status: "waiting_user",
                current_step: "waiting_user_extraction_failed",
                progress: 100,
                document_context: {
                    ...(jobData.document_context || {}),
                    inserted_items_count: 0, // FORCE UPDATE
                    debug_info: createSafeDebugInfo(debugSummary), // 🛡️ SAFE SERIALIZATION
                    db_verification: dbVerificationBlock,
                    db_verification_trace: dbVerificationTrace.slice(-10).map(t => String(t).substring(0, 200)),
                    user_action: {
                        required: true,
                        reason: "extraction_failed",
                        message: generateExtractionFailedMessage(debugSummary.files),
                        items_count: 0
                    }
                }
            }).eq("id", currentJobId || job_id);

            return jsonResponse({ ok: true, items_found: 0, status: "waiting_user", message: "No items found even with OCR" }, 200, req);
        }

    } catch (err: any) {
        console.error(`[REQ ${requestId}] OCR Fallback Critial Error:`, err);

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // RATE LIMIT SPECIFIC HANDLING
        if ((err instanceof RateLimitError || err?.message === "RateLimitHit") && currentJobId) {
            console.warn(`[OCR-FB-DEBUG] Handling Rate Limit via Safe State.`);
            debugSummary.rate_limit_encountered = true;

            const rateLimitInfo = {
                rate_limited: true,
                rate_limit: {
                    provider: "gemini",
                    model: "gemini-1.5-flash",
                    retry_after_seconds: 45,
                    last_error: err?.originalError?.message || "Rate Limit Detected",
                    occurred_at: new Date().toISOString()
                },
                user_action: {
                    required: true,
                    reason: "rate_limit",
                    message: "Limite temporário da IA atingido. Aguarde cerca de 45 segundos e tente novamente."
                }
            };

            // Need to merge with existing context if possible
            const existingContext = jobData?.document_context || {};

            await supabase.from("import_jobs").update({
                status: "waiting_user_rate_limited",
                current_step: "paused_rate_limit",
                last_error: "Rate Limit Exceeded (429)",
                document_context: {
                    ...existingContext,
                    ...rateLimitInfo,
                    debug_info: createSafeDebugInfo(debugSummary), // 🛡️ SAFE SERIALIZATION
                    db_verification_trace: dbVerificationTrace.slice(-10).map(t => String(t).substring(0, 200))
                }
            }).eq("id", currentJobId);

            console.log(`[REQ ${requestId}] JOB_MARKED_RATE_LIMITED (Waiting 45s)`);

            return jsonResponse({
                type: "RATE_LIMITED",
                provider: "gemini",
                model: "gemini-1.5-flash",
                retry_after_seconds: rateLimitInfo.rate_limit.retry_after_seconds,
                message: rateLimitInfo.user_action.message
            }, 200, req);
        }

        // GENERIC ERROR HANDLING
        // Ensure we revert to waiting user so UI doesn't hang
        // If we cant parse job_id, we cant update.
        if (currentJobId) {
            try {
                // ------------------------------------------------------------------
                // FIX: VERIFY REAL DB STATE ON ERROR/TIMEOUT (SSOT)
                // ------------------------------------------------------------------
                // Query the database to get the real count of items
                const { count: errorRealDbCount, error: errorCountErr } = await supabase
                    .from("import_ai_items")
                    .select("*", { count: "exact", head: true })
                    .eq("job_id", currentJobId);

                const errorFinalCount = errorRealDbCount || 0;
                console.log(`[REQ ${requestId}] ERROR HANDLER: DB VERIFICATION Found ${errorFinalCount} items in import_ai_items`);
                traceTrace(errorFinalCount, 'db_count_query_error_handler', 'error_finalize_verification');

                // Update debugSummary with real DB count
                debugSummary.db_verified_count = errorFinalCount;
                debugSummary.stage = 'error';

                // Create finalize_guard (primitives-only)
                const errorFinalizeGuard = {
                    applied: true,
                    reason: "error",
                    real_db_count: errorFinalCount,
                    timestamp: new Date().toISOString()
                };

                // Determine status and user_action based on real DB count
                let finalStatus: string;
                let finalCurrentStep: string;
                let finalUserAction: any;

                if (errorFinalCount > 0) {
                    // Items were found before error/timeout - mark as waiting_user, NOT failed
                    finalStatus = "waiting_user";
                    finalCurrentStep = "waiting_user_timeout";
                    finalUserAction = {
                        required: true,
                        reason: "timeout_extraction",
                        message: "O processamento demorou muito. Verifique os itens extraídos ou adicione manualmente.",
                        items_count: errorFinalCount
                    };
                } else {
                    // No items found - genuine extraction failure
                    finalStatus = "waiting_user";
                    finalCurrentStep = "waiting_user_extraction_failed";
                    finalUserAction = {
                        required: true,
                        reason: "extraction_failed",
                        message: generateExtractionFailedMessage(debugSummary.files),
                        items_count: 0
                    };
                }

                await supabase.from("import_jobs").update({
                    status: finalStatus,
                    current_step: finalCurrentStep,
                    progress: 100,
                    last_error: String(err.message || 'Unknown error').substring(0, 500),
                    document_context: {
                        ...(jobData?.document_context || {}),
                        inserted_items_count: errorFinalCount, // FORCE UPDATE WITH VERIFIED COUNT
                        debug_info: createSafeDebugInfo(debugSummary), // 🛡️ SAFE SERIALIZATION
                        finalize_guard: errorFinalizeGuard, // NEW: Save finalize_guard
                        db_verification: {
                            job_id_used: currentJobId,
                            count_query_ran: true,
                            real_db_count: errorFinalCount,
                            timestamp: new Date().toISOString()
                        },
                        db_verification_trace: dbVerificationTrace.slice(-10).map(t => String(t).substring(0, 200)),
                        user_action: finalUserAction
                    }
                }).eq("id", currentJobId);

                console.log(`[REQ ${requestId}] JOB_MARKED_${finalStatus.toUpperCase()}_${finalCurrentStep.toUpperCase()} (Error Handler)`);

                console.log(`[REQ ${requestId}] ERROR HANDLER: Job updated with status=${finalStatus}, items=${errorFinalCount}`);

                // --- RETURN 200 OK IF RECOVERED ---
                // We successfully updated the job to a waiting state, so the UI should process it as "success" (ok: false, but HTTP 200)
                // This prevents "Edge Function returned non-2xx"

                return jsonResponse({
                    ok: false,
                    status: finalStatus,
                    error: String(err.message || 'Unknown error').substring(0, 100), // Short error for UI
                    message: finalUserAction?.message || "Erro no processamento."
                }, 200, req);

            } catch (updateErr) {
                console.error(`[REQ ${requestId}] Failed to update job status after critical error:`, updateErr);
                // If we failed to update the DB, we MUST return 500 because the job is likely stuck in processing
            }
        }

        console.log(`[OCR-FB-DEBUG] [REQ ${requestId}] HTTP_EXIT_NON_2XX (500) - Recovery failed or no Job ID.`);
        return jsonResponse({ error: err.message }, 500, req);
    }
});
