import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0";
import { z } from "https://esm.sh/zod@3.23.8";
import pdfParse from "npm:pdf-parse@1.1.1";
import { Buffer } from "node:buffer";
import { generateCandidatesStageA } from "./stageA_candidates.ts";
import { executeStageB } from "./stageB_llm.ts";
import { safeMergeMetadata as safeMergePure, persistStageBMetaAtomic } from "./persistence_helper.ts";

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
const STAGEB_BUILD_SIG = "stageb-docrole-fix-2026-02-22";

// -----------------------------
// SAFETY LIMITS
// -----------------------------
const FULLSCAN_MAX_CHARS = 50_000; // Limit to avoid CPU timeout on parsed text

// -----------------------------
// COMPLETENESS THRESHOLDS (OCR for Completeness)
// -----------------------------
const COMPLETENESS_MIN_VALID_ITEMS = 30;

// -----------------------------
// MAX EXTRACTION CONFIG (MAXIMAL V1)
// -----------------------------
const LINES_PER_CHUNK = 160;
const OVERLAP_LINES = 25;
const MAX_CHUNKS_PER_FILE = 120; // Physical cap
const MAX_ITEMS_PER_CHUNK = 200;
const MAX_TOTAL_ITEMS_PER_FILE = 5000;
const MAX_FALLBACK_LINES_PER_FILE = 600;
const MAX_RETRIES_PER_CHUNK = 3;
const BACKOFF_MS = [500, 1500, 3500];


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
        if (depth > maxDepth) return '[max depth reached]';
        if (val === null || val === undefined) return val;
        const type = typeof val;
        if (type === 'string') return truncate(val, maxStringLength);
        if (type === 'number' || type === 'boolean') return val;
        if (type === 'function') return '[Function]';
        if (type === 'symbol') return '[Symbol]';
        if (type === 'bigint') return `[BigInt: ${val.toString()}]`;
        if (type === 'object') {
            if (seen.has(val)) return '[Circular]';
            seen.add(val);
            if (Array.isArray(val)) {
                const truncatedArray = val.slice(0, maxArrayLength);
                const result = truncatedArray.map(item => helper(item, depth + 1));
                if (val.length > maxArrayLength) result.push(`...${val.length - maxArrayLength} more items`);
                return result;
            }
            if (val instanceof Date) return val.toISOString();
            if (val instanceof Error) return { name: val.name, message: truncate(val.message, maxStringLength), stack: val.stack ? truncate(val.stack, maxStringLength) : undefined };
            const result: any = {};
            let count = 0;
            const maxKeys = 50;
            for (const key in val) {
                if (count >= maxKeys) { result['...'] = `${Object.keys(val).length - maxKeys} more keys`; break; }
                try { result[key] = helper(val[key], depth + 1); count++; } catch (e) { result[key] = '[error reading property]'; }
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

function createSafeDebugInfo(raw: any): Record<string, any> {
    const safe: Record<string, any> = {};
    if (raw.jobId) safe.job_id = String(raw.jobId);
    if (raw.stage) safe.stage = String(raw.stage).substring(0, 100);
    if (typeof raw.total_items === 'number') safe.total_items = raw.total_items;
    if (typeof raw.rate_limit_encountered === 'boolean') safe.rate_limit_encountered = raw.rate_limit_encountered;
    if (typeof raw.db_verified_count === 'number') safe.db_verified_count = raw.db_verified_count;
    if (raw.ocr_config_error) safe.ocr_config_error = String(raw.ocr_config_error).substring(0, 200);
    if (raw.ocr_health_warning) safe.ocr_health_warning = String(raw.ocr_health_warning).substring(0, 200);

    if (Array.isArray(raw.files)) {
        safe.files = raw.files.slice(0, 10).map((f: any) => ({
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
            pdf_attempted: typeof f.pdf_attempted === 'boolean' ? f.pdf_attempted : false,
            pdf_duration_ms: typeof f.pdf_duration_ms === 'number' ? f.pdf_duration_ms : null,
            pdf_text_len: typeof f.pdf_text_len === 'number' ? f.pdf_text_len : 0,
            pdf_pages_total: typeof f.pdf_pages_total === 'number' ? f.pdf_pages_total : null,
            ocr_attempted: typeof f.ocr_attempted === 'boolean' ? f.ocr_attempted : false,
            ocr_status: f.ocr_status ? String(f.ocr_status).substring(0, 30) : 'skipped',
            ocr_text_len: typeof f.ocr_text_len === 'number' ? f.ocr_text_len : 0,
            text_extraction_method: f.text_extraction_method ? String(f.text_extraction_method) : null
        }));
        if (raw.files.length > 10) safe.files_truncated = `${raw.files.length - 10} more files not shown`;
    }
    return safe;
}

// -----------------------------
// DEDUPLICATION HELPERS
// -----------------------------
function normalizeForDedup(description: string): string {
    if (!description) return '';
    return description.toUpperCase().trim().replace(/\s+/g, ' ').replace(/[.,;:()\[\]]/g, '');
}

function normalizeNumberForDedup(val: any): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'number') return String(Math.round(val * 100) / 100);
    const s = String(val).trim();
    return s.replace(/\./g, '').replace(',', '.');
}

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
function extractBalancedJson(text: string): string | null {
    const arrayStart = text.indexOf('[');
    const objStart = text.indexOf('{');
    if (arrayStart === -1 && objStart === -1) return null;
    const startIdx = (arrayStart !== -1 && objStart !== -1) ? Math.min(arrayStart, objStart) : Math.max(arrayStart, objStart);
    const startChar = text[startIdx];
    const endChar = startChar === '[' ? ']' : '}';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = startIdx; i < text.length; i++) {
        const char = text[i];
        if (escaped) { escaped = false; continue; }
        if (char === '\\') { escaped = true; continue; }
        if (char === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (char === startChar) depth++;
        if (char === endChar) { depth--; if (depth === 0) return text.substring(startIdx, i + 1); }
    }
    return null;
}

function parseJsonLenient(text: string): { success: boolean; data: any; recovered: boolean; reason: string | null; } {
    try { return { success: true, data: JSON.parse(text), recovered: false, reason: null }; }
    catch (e1) {
        try {
            const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
            return { success: true, data: JSON.parse(cleaned), recovered: true, reason: "removed_markdown_blocks" };
        } catch (e2) {
            const extracted = extractBalancedJson(text);
            if (extracted) {
                try { return { success: true, data: JSON.parse(extracted), recovered: true, reason: "extracted_balanced_json" }; } catch (e3) { }
            }
            return { success: false, data: null, recovered: false, reason: `parse_failed: ${String(e1).substring(0, 100)}` };
        }
    }
}

// -----------------------------
// CORS HELPERS
// -----------------------------
function normalizeOrigin(origin: string): string {
    let normalized = origin.trim();
    if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
    return normalized;
}

function isAllowedOrigin(origin: string): boolean {
    const allowed = ["https://naboorca.com", "https://www.naboorca.com", "http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:54321"];
    if (allowed.includes(origin)) return true;
    if (/^https:\/\/[a-z0-9-]+\.naboorca\.pages\.dev$/i.test(origin)) return true;
    return false;
}

function corsHeadersStrict(req: Request): Record<string, string> {
    const rawOrigin = req.headers.get("origin");
    const origin = normalizeOrigin(rawOrigin || "");
    const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-id, x-job-id, x-internal-call",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };
    if (rawOrigin && isAllowedOrigin(origin)) {
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Access-Control-Allow-Credentials"] = "true";
    } else if (rawOrigin) {
        headers["Access-Control-Allow-Origin"] = "null";
    }
    return headers;
}

function jsonResponse(body: unknown, status = 200, req?: Request) {
    const headers = req ? corsHeadersStrict(req) : {
        "Access-Control-Allow-Origin": "https://naborca.com",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Credentials": "true"
    };
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

// -----------------------------
// PERSISTENCE HELPERS
// -----------------------------
type ExtractionStatus = 'pending' | 'processing' | 'done' | 'skipped' | 'failed';
interface ExtractionStateUpdate {
    extraction_status?: ExtractionStatus;
    extraction_reason?: string;
    extraction_last_error?: string;
    extracted_started_at?: string;
    extracted_completed_at?: string;
    extracted_text?: string;
    extracted_text_len?: number;
    extraction_items_inserted?: number;
}

async function updateImportFileExtractionState(supabase: any, fileId: string, update: ExtractionStateUpdate, checkpoint: string): Promise<void> {
    console.log(`[CHECKPOINT] ${checkpoint} file_id=${fileId} update=${JSON.stringify(update)}`);
    const { error } = await supabase.from('import_files').update(update).eq('id', fileId);
    if (error) {
        console.error(`[CHECKPOINT] ${checkpoint} UPDATE FAILED: ${error.message}`);
        throw new Error(`Failed to update file status at ${checkpoint}: ${error.message}`);
    }
}

function truncateSafe(val: any, limit = 100): any {
    if (Array.isArray(val)) {
        if (val.length <= limit) return val;
        return [...val.slice(0, limit), `...(${val.length - limit} more items)`];
    }
    if (typeof val === 'string') {
        if (val.length <= limit) return val;
        return val.substring(0, limit) + '...[truncated]';
    }
    return val;
}

async function safeMergeMetadata(supabase: any, fileId: string, patch: Record<string, any>, checkpoint: string): Promise<boolean> {
    const { data: current, error: fetchErr } = await supabase.from('import_files').select('metadata').eq('id', fileId).single();
    if (fetchErr || !current) {
        console.error(`[check=${checkpoint}] safeMerge failed to fetch: ${fetchErr?.message}`);
        return false;
    }
    const currentMeta = current.metadata || {};
    const newMeta = safeMergePure(currentMeta, patch);
    const { error: updateErr } = await supabase.from('import_files').update({ metadata: newMeta }).eq('id', fileId);
    if (updateErr) {
        console.error(`[check=${checkpoint}] safeMerge failed to update: ${updateErr.message}`);
        return false;
    }
    return true;
}

async function persistOCR(supabase: any, fileId: string, text: string, method: string, oversized: boolean = false): Promise<void> {
    const textLen = text ? text.length : 0;
    const patch = { ocr: { text_length: textLen, text_sample: text ? text.slice(0, 20000) : "", extracted_at: new Date().toISOString(), method, oversized } };
    await safeMergeMetadata(supabase, fileId, patch, 'persist_ocr_text');
    console.log(`[OCR-PERSIST] Saved OCR metadata (len=${textLen}) for file ${fileId}`);
}

// -----------------------------
// AI PIPELINE HELPERS
// -----------------------------
const ItemSchema = z.object({
    composition_code: z.string().optional().nullable().default(null),
    description: z.string().min(1),
    unit: z.string().optional().nullable().default(null),
    quantity: z.union([z.number(), z.string()]).optional().nullable().default(null),
    unit_price: z.union([z.number(), z.string()]).optional().nullable().default(null),
    total: z.union([z.number(), z.string()]).optional().nullable().default(null),
    raw_line: z.string().optional().nullable().default(null),
    category: z.string().optional().nullable().default(null),
    confidence: z.number().optional().default(0.6),
});

const GeminiOutputSchema = z.object({
    items: z.array(ItemSchema).default([]),
    meta: z.object({ chunk_index: z.number().optional(), truncated_by_cap: z.boolean().optional(), notes: z.array(z.string()).optional() }).optional()
});

const SYSTEM_PROMPT = `Extraia itens de orçamento conforme JSON de itens candidatos: service/material description, numbers (unit, qty, price, total). Use raw_line para o texto original.`;

function getUserPrompt(params: any) {
    return `job_id: ${params.job_id} | import_file_id: ${params.import_file_id} | chunk_index: ${params.chunk_index}\nTEXT:\n${params.chunk_text}`;
}

class RateLimitError extends Error { constructor(public originalError: any) { super("RateLimitHit"); } }
function isRateLimitError(e: any): boolean {
    const msg = e?.message?.toLowerCase() || "";
    return e?.status === 429 || msg.includes("too many requests") || msg.includes("quota exceeded") || msg.includes("generate_content_free_tier_requests");
}

async function generateContentWithRetry(model: any, params: any, maxRetries = 2) {
    let attempt = 0;
    while (true) {
        try { return await model.generateContent(params); }
        catch (e: any) {
            if (isRateLimitError(e)) {
                if (attempt < maxRetries) {
                    const waitMs = attempt === 0 ? 15000 : 30000;
                    console.warn(`[OCR-FB-DEBUG] Gemini Rate Limit. Retrying in ${waitMs / 1000}s...`);
                    await new Promise(r => setTimeout(r, waitMs));
                    attempt++; continue;
                }
                throw new RateLimitError(e);
            }
            throw e;
        }
    }
}

async function discoverGeminiModel(apiKey: string, preferredModel = "gemini-1.5-flash"): Promise<{ modelId: string; fallbackUsed: boolean; }> {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    try {
        const resp = await fetch(listUrl);
        if (!resp.ok) return { modelId: "gemini-2.0-flash-exp", fallbackUsed: true };
        const data = await resp.json();
        const models = data.models || [];
        const validModels = models.filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"));
        const preferredExists = validModels.some((m: any) => m.name?.includes(preferredModel));
        if (preferredExists) return { modelId: preferredModel, fallbackUsed: false };
        let fallback = validModels.find((m: any) => m.name?.includes("gemini-2.0-flash")) || validModels[0];
        return { modelId: fallback.name.replace("models/", ""), fallbackUsed: true };
    } catch {
        return { modelId: "gemini-2.0-flash-exp", fallbackUsed: true };
    }
}

async function generateDedupKey(params: { job_id: string, import_file_id: string, description: string | null, chunk_index: number, raw_line?: string | null }): Promise<string> {
    const encoder = new TextEncoder();
    const baseText = (params.description || params.raw_line || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (!baseText) return `empty_${crypto.randomUUID()}`;
    const data = `${params.job_id}|${params.import_file_id}|${params.chunk_index}|${baseText}`;
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function createLineChunks(text: string): { chunk_index: number, text: string }[] {
    const lines = text.split(/\r?\n/);
    const chunks = [];
    let chunkIndex = 0;
    for (let i = 0; i < lines.length; i += (LINES_PER_CHUNK - OVERLAP_LINES)) {
        if (chunks.length >= MAX_CHUNKS_PER_FILE) break;
        const chunkLines = lines.slice(i, i + LINES_PER_CHUNK);
        chunks.push({ chunk_index: chunkIndex++, text: chunkLines.join('\n') });
        if (i + LINES_PER_CHUNK >= lines.length) break;
    }
    return chunks;
}

async function processMaxExtraction(supabase: any, jobId: string, fileId: string, fullText: string, debugContext: any, model: any) {
    const chunks = createLineChunks(fullText);
    let totalItemsSaved = 0;
    let fallbackItemsSaved = 0;

    for (const chunk of chunks) {
        if (totalItemsSaved >= MAX_TOTAL_ITEMS_PER_FILE) break;
        const prompt = getUserPrompt({ job_id: jobId, import_file_id: fileId, chunk_index: chunk.chunk_index, chunk_text: chunk.text });
        let rawItems: any[] = [];
        let success = false;

        for (let attempt = 0; attempt <= MAX_RETRIES_PER_CHUNK; attempt++) {
            try {
                if (attempt > 0) await new Promise(r => setTimeout(r, BACKOFF_MS[attempt - 1]));
                const result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT + "\n" + prompt }] }], generationConfig: { responseMimeType: "application/json" } });
                const text = result.response.text();
                const parsed = parseJsonLenient(text);
                if (parsed.success && parsed.data && Array.isArray(parsed.data.items)) { rawItems = parsed.data.items; success = true; break; }
            } catch (e: any) { if (isRateLimitError(e)) await new Promise(r => setTimeout(r, 10000)); }
        }

        if (rawItems.length === 0 && chunk.text.trim().length > 8) {
            const lines = chunk.text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length >= 8);
            if (lines.length > 0) {
                rawItems = lines.slice(0, MAX_FALLBACK_LINES_PER_FILE - fallbackItemsSaved).map(line => ({ description: line, raw_line: line, category: 'fallback_line_item', confidence: 0.1 }));
                fallbackItemsSaved += rawItems.length;
            } else {
                rawItems = [{ description: chunk.text.trim().substring(0, 500), raw_line: chunk.text.trim(), category: 'fallback_blob_item', confidence: 0.05 }];
                fallbackItemsSaved += 1;
            }
        }

        if (rawItems.length > 0) {
            const finalItems = await Promise.all(rawItems.slice(0, MAX_ITEMS_PER_CHUNK).map(async (item: any, idxInChunk: number) => {
                const dedupKey = await generateDedupKey({ job_id: jobId, import_file_id: fileId, description: item.description, chunk_index: chunk.chunk_index, raw_line: item.raw_line });
                const cleanNum = (v: any) => {
                    if (v === null || v === undefined) return null;
                    if (typeof v === 'number') return v;
                    const s = String(v).replace(/\./g, '').replace(',', '.').trim();
                    const f = parseFloat(s);
                    return isNaN(f) ? null : f;
                };
                return { job_id: jobId, import_file_id: fileId, chunk_index: chunk.chunk_index, idx: idxInChunk, dedup_key: dedupKey, description: item.description || item.raw_line || "Item sem descrição", unit: item.unit?.substring(0, 20) || null, quantity: cleanNum(item.quantity), unit_price: cleanNum(item.unit_price), total: cleanNum(item.total), category: item.category || 'general_item', raw_line: item.raw_line?.substring(0, 1000) || null, confidence: typeof item.confidence === 'number' ? item.confidence : 0.6 };
            }));

            const keysToCheck = finalItems.map(i => i.dedup_key);
            const { data: existing } = await supabase.from('import_ai_items').select('dedup_key').eq('job_id', jobId).in('dedup_key', keysToCheck);
            const existingKeys = new Set((existing || []).map((e: any) => e.dedup_key));
            const distinctItems = finalItems.filter(i => !existingKeys.has(i.dedup_key));

            if (distinctItems.length > 0) {
                const { error: insErr } = await supabase.from('import_ai_items').insert(distinctItems);
                if (!insErr) totalItemsSaved += distinctItems.length;
            }
        }
    }
}

async function extractPdfText(buffer: ArrayBuffer): Promise<{ text: string, numpages: number } | null> {
    try {
        const data = await pdfParse(Buffer.from(buffer));
        return { text: data.text, numpages: data.numpages };
    } catch (e: any) {
        console.warn("[FULL-SCAN] Local PDF text extraction failed:", e.message);
        return null;
    }
}

function isPdfFile(file: any): { isPdf: boolean; trigger: string | null; } {
    const ct = String(file.content_type ?? '').toLowerCase().trim();
    const fn = String(file.original_filename ?? '').toLowerCase().trim();
    const byCt = ct.includes('pdf');
    const byExt = fn.endsWith('.pdf');
    return { isPdf: byCt || byExt, trigger: byCt ? 'content_type' : (byExt ? 'extension' : null) };
}

async function markJobFailed(supabase: any, jobId: string, currentJobData: any, reason: string, userMessage: string, debugSummary: any, technicalError?: string) {
    const errorMsg = technicalError ? String(technicalError).substring(0, 500) : null;
    await supabase.from('import_jobs').update({ status: 'done', current_step: technicalError ? 'waiting_user_technical_failure' : 'waiting_user_extraction_failed', last_error: errorMsg || reason, error_message: userMessage, stage: 'ocr_failed', stage_updated_at: new Date().toISOString(), updated_at: new Date().toISOString(), document_context: { ...(currentJobData?.document_context || {}), ocr_fallback_executed: true, debug_info: { ...createSafeDebugInfo(debugSummary), failure_reason: reason, failure_technical: errorMsg }, user_action: { required: true, reason, message: userMessage, items_count: 0 } } }).eq('id', jobId);
}

async function resolveBudgetIdForJob(supabase: any, jobId: string, jobData: any): Promise<string | null> {
    if (jobData?.result_budget_id) return jobData.result_budget_id;
    const { data: runData } = await supabase.from('import_finalization_runs').select('budget_id').eq('job_id', jobId).order('created_at', { ascending: false }).limit(1).single();
    if (runData?.budget_id) return runData.budget_id;
    const { data: finData } = await supabase.from('import_budget_finalizations').select('budget_id').eq('job_id', jobId).order('created_at', { ascending: false }).limit(1).single();
    return finData?.budget_id || null;
}

async function hydrateBudgetItemsFromAI(params: { supabase: any, requestId: string, jobId: string, budgetId: string }): Promise<{ inserted: number, skippedExisting: number }> {
    const { supabase, requestId, jobId, budgetId } = params;
    const { data: aiItems, error: fetchAiErr } = await supabase.from("import_ai_items").select("id, description, unit, quantity, unit_price, total, idx").eq("job_id", jobId).order('idx', { ascending: true, nullsFirst: false });
    if (fetchAiErr || !aiItems || aiItems.length === 0) return { inserted: 0, skippedExisting: 0 };
    const { data: existingLinks } = await supabase.from("budget_items").select("source_import_item_id").eq("budget_id", budgetId).not("source_import_item_id", "is", null);
    const existingSet = new Set((existingLinks || []).map((row: any) => row.source_import_item_id));
    const itemsToInsert = aiItems.filter((item: any) => !existingSet.has(item.id)).map((item: any) => ({ budget_id: budgetId, source_import_item_id: item.id, description: item.description || "Item sem descrição", unit: item.unit || "UN", quantity: item.quantity || 0, unit_price: item.unit_price || 0, total_price: item.total || ((item.quantity || 0) * (item.unit_price || 0)), source: 'AI_EXTRACTION' }));
    if (itemsToInsert.length === 0) return { inserted: 0, skippedExisting: existingSet.size };
    const { error: insertErr } = await supabase.from("budget_items").insert(itemsToInsert);
    if (insertErr) throw insertErr;
    return { inserted: itemsToInsert.length, skippedExisting: existingSet.size };
}

// -----------------------------
// MAIN HANDLER
// -----------------------------
serve(async (req: Request) => {
    // [BUILD-SENTINEL] PROOF OF DEPLOY
    console.log(`[BUILD-SENTINEL] import-ocr-fallback build=${STAGEB_BUILD_SIG}`);

    if (req.method === "OPTIONS") {
        return new Response("ok", { status: 200, headers: corsHeadersStrict(req) });
    }
    const requestId = crypto.randomUUID().split("-")[0];
    let currentJobId: string | null = null;
    let jobData: any = null;
    let debugSummary: any = { stage: 'init', files: [], total_items: 0, rate_limit_encountered: false };

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const isInternalCall = req.headers.get('x-internal-call') === '1' || req.headers.get('x-internal-call') === 'true';
        const enqueueOnly = req.headers.get('x-ocr-enqueue-only') === '1' || req.headers.get('x-ocr-enqueue-only') === 'true';
        let authHeader = req.headers.get("Authorization");
        if (!isInternalCall && !authHeader) return jsonResponse({ code: 401, message: "Missing Authorization" }, 401, req);
        const token = authHeader ? authHeader.replace("Bearer ", "") : (isInternalCall ? SUPABASE_SERVICE_ROLE_KEY : "");
        let userId: string | undefined;
        if (isInternalCall) {
            if (token !== SUPABASE_SERVICE_ROLE_KEY) return jsonResponse({ code: 401, message: "Invalid service token" }, 401, req);
            userId = req.headers.get('x-user-id') || undefined;
            currentJobId = req.headers.get('x-job-id');
        } else {
            const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
            if (userErr || !user) return jsonResponse({ code: 401, message: "Invalid JWT" }, 401, req);
            userId = user.id;
        }

        const reqBody = await req.json();
        const job_id = currentJobId || reqBody.job_id;
        if (!job_id) throw new Error("Missing job_id");
        currentJobId = job_id;
        const targetFileId = reqBody.target_file_id ?? reqBody.file_id ?? null;

        if (!isInternalCall) {
            // Public Mode: Queue and return
            const { data: allFiles } = await supabase.from("import_files").select("id, content_type, original_filename").eq("job_id", job_id);
            const pdfFiles = (allFiles || []).filter(f => isPdfFile(f).isPdf);
            if (pdfFiles.length === 0) return jsonResponse({ status: "skipped", message: "Nenhum PDF encontrado" }, 200, req);
            await supabase.from("import_ocr_jobs").upsert(pdfFiles.map(f => ({ job_id, import_file_id: f.id, status: 'pending' })), { onConflict: 'job_id, import_file_id', ignoreDuplicates: true });
            await supabase.from('import_jobs').update({ status: 'processing', stage: 'ocr_queued', updated_at: new Date().toISOString() }).eq('id', job_id).neq('status', 'done');
            fetch(`${SUPABASE_URL}/functions/v1/ocr-worker`, { method: 'POST', headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'enqueue_poke', job_id }) }).catch(() => { });
            return jsonResponse({ ok: true, status: "queued", job_id, files_queued: pdfFiles.length, started_in_background: true }, 202, req);
        }

        // Internal Enqueue Mode (Fix for delegation skipping queue)
        if (isInternalCall && enqueueOnly) {
            console.log(`[OCR-FALLBACK] INTERNAL_ENQUEUE_ONLY Job=${job_id}, Target=${targetFileId}`);

            let filesQuery = supabase.from("import_files").select("id, content_type, original_filename").eq("job_id", job_id);
            if (targetFileId) filesQuery = filesQuery.eq("id", targetFileId);

            const { data: allFiles } = await filesQuery;
            const pdfFiles = (allFiles || []).filter(f => isPdfFile(f).isPdf);

            if (pdfFiles.length === 0) return jsonResponse({ status: "skipped", message: "Nenhum PDF para enfileirar (Internal)" }, 200, req);

            // Upsert Logic (Same as public)
            await supabase.from("import_ocr_jobs").upsert(
                pdfFiles.map(f => ({ job_id, import_file_id: f.id, status: 'pending' })),
                { onConflict: 'job_id, import_file_id', ignoreDuplicates: true }
            );

            // Update Job Logic
            await supabase.from('import_jobs')
                .update({ status: 'processing', stage: 'ocr_queued', updated_at: new Date().toISOString() })
                .eq('id', job_id)
                .neq('status', 'done');

            // Poke Worker
            fetch(`${SUPABASE_URL}/functions/v1/ocr-worker`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    'apikey': SUPABASE_SERVICE_ROLE_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ reason: 'enqueue_poke', job_id })
            }).catch((err) => console.error("Worker poke failed", err));

            return jsonResponse({
                ok: true,
                status: "queued",
                job_id,
                files_queued: pdfFiles.length,
                started_in_background: true,
                mode: "internal_enqueue_only"
            }, 202, req);
        }

        // Internal Worker: Fast Processing
        const { data: job, error: jobErr } = await supabase.from("import_jobs").select("*").eq("id", job_id).single();
        if (jobErr || !job) return jsonResponse({ error: "Job invalid" }, 403, req);
        jobData = job;

        let filesQuery = supabase.from("import_files").select("*").eq("job_id", job_id);
        if (targetFileId) filesQuery = filesQuery.eq("id", targetFileId);
        const { data: candidateFiles } = await filesQuery;
        let files = (candidateFiles || [])
            .filter(f => isPdfFile(f).isPdf)
            .sort((a, b) => {
                const order = { 'analytical': 0, 'synthetic': 1, 'unknown': 2 };
                return (order[a.doc_role as keyof typeof order] ?? 2) - (order[b.doc_role as keyof typeof order] ?? 2);
            });
        if (files.length === 0) return jsonResponse({ error: "No PDF files" }, 404, req);

        let globalItemsFound = 0;
        let filesFailedCount = 0;

        for (const file of files) {
            try {
                // ATOMIC DEBUG MARKER START
                try {
                    const indexGate = {
                        reached_stageB_block: true,
                        marker: "INDEX_TS_ENTERED_FILE_LOOP",
                        file_id: file.id,
                        job_id: job_id,
                        ts: new Date().toISOString()
                    };

                    // Deep merge manually to avoid safeMergeMetadata issues
                    const newMetadata = structuredClone(file.metadata || {});
                    newMetadata.stageB = newMetadata.stageB || {};
                    newMetadata.stageB.build_sig = STAGEB_BUILD_SIG;
                    newMetadata.stageB.debug = newMetadata.stageB.debug || {};
                    newMetadata.stageB.debug.index_gate = indexGate;

                    // Direct atomic update
                    await supabase
                        .from("import_files")
                        .update({ metadata: newMetadata })
                        .eq("id", file.id);

                    // Immediate Verification
                    const { data: verifyRow } = await supabase
                        .from("import_files")
                        .select("metadata")
                        .eq("id", file.id)
                        .single();

                    console.log("[INDEX-GATE-ATOMIC] persisted?",
                        Boolean(verifyRow?.metadata?.stageB?.debug?.index_gate),
                        "build_sig=", verifyRow?.metadata?.stageB?.build_sig
                    );
                } catch (e) {
                    console.error("[INDEX-GATE-ATOMIC] Failed to persist marker", e);
                }
                // ATOMIC DEBUG MARKER END
                const fileDebug: any = { file_id: file.id, filename: file.original_filename, ocr_attempted: true };
                debugSummary.files.push(fileDebug);
                await updateImportFileExtractionState(supabase, file.id, { extraction_status: 'processing', extracted_started_at: new Date().toISOString() }, 'before_download');

                const { data: fileBlob, error: downloadErr } = await supabase.storage.from(file.storage_bucket || "imports").download(file.storage_path);
                if (downloadErr || !fileBlob) throw new Error(`Download failed: ${downloadErr?.message}`);

                const buffer = await fileBlob.arrayBuffer();
                const pdfData = await extractPdfText(buffer);
                const realLen = pdfData?.text?.length || 0;

                // Salva extracted_text no banco para uso posterior pelo AnalyticReportParser
                if (pdfData?.text && file.doc_role === 'analytical') {
                    await supabase.from('import_files').update({
                        extracted_text: pdfData.text
                    }).eq('id', file.id);
                    // Analytical file: só precisa do texto extraído, não do Stage A/B
                    await updateImportFileExtractionState(supabase, file.id, {
                        extraction_status: 'done',
                        extraction_reason: 'analytical_text_only',
                        extracted_completed_at: new Date().toISOString()
                    }, 'analytical_done');
                    console.log(`[ANALYTICAL] Text saved (${realLen} chars) for file ${file.id}. Skipping Stage A/B.`);
                    continue;
                }

                // Shared state for Stage A -> Stage B
                let finalCandidates: any[] = [];
                let stageBFailed = false;

                let stageAStats: any = {};

                if (pdfData && pdfData.text && realLen > 8) {

                    // STAGE A: Deterministic & Robust Extraction
                    try {
                        const stageAResult = generateCandidatesStageA(pdfData.text, { fileMeta: file.metadata });
                        finalCandidates = stageAResult.candidates || [];
                        stageAStats = stageAResult.stats;

                        // Persist SAMPLE only (prevent metadata explosion)
                        const candidatesSample = finalCandidates.slice(0, 30);

                        await safeMergeMetadata(supabase, file.id, {
                            stageA: {
                                version: stageAResult.version,
                                generated_at: stageAResult.generated_at,
                                doc_type_hints: stageAResult.doc_type_hints,
                                caps: stageAResult.caps,
                                stats: stageAResult.stats,
                                warnings: stageAResult.warnings,
                                candidate_count: finalCandidates.length,
                                candidates_sample: candidatesSample // Only persist first 30
                            }
                        }, 'stage_a_persistence');
                        fileDebug.stage_a_candidates = finalCandidates.length;
                    } catch (e: any) {
                        console.error("[STAGE-A] Failed", e);
                        await safeMergeMetadata(supabase, file.id, { stageA: { version: "v1", generated_at: new Date().toISOString(), candidate_count: 0, warnings: ["stageA_failed"], error: e.message } }, 'stage_a_error');
                    }



                    // STAGE B: Semantic Extraction (Grounding)
                    // let stageBFailed = false; // Moved to outer scope
                    try {
                        const candidates = finalCandidates;
                        const candidatesCount = candidates.length; // LOCAL TRUTH

                        // DEBUG: Index Gate - Prove we reached this block
                        const indexGate = {
                            reached_stageB_block: true,
                            finalCandidates_len: candidatesCount,
                            stageA_candidate_count: candidatesCount, // Use local truth
                            timestamp: new Date().toISOString()
                        };

                        // Log warning if inconsistency detected (legacy check)
                        if (candidatesCount === 0 && (file.metadata?.stageA?.candidate_count || 0) > 0) {
                            console.warn(`[STAGE-B] SKIPPED: In-memory candidates empty despite metadata count (${file.metadata.stageA.candidate_count}).`);
                            (indexGate as any).warning = "CANDIDATES_MISSING_IN_MEMORY_BUT_COUNT_PRESENT";
                        }

                        // Persist gate info immediately
                        await safeMergeMetadata(supabase, file.id, { stageB: { debug: { index_gate: indexGate } } }, 'stage_b_gate_debug');

                        console.log(`[STAGE-B-GATE] Checking candidates. Count: ${candidatesCount}`);
                        if (candidatesCount > 0) {
                            console.log(`[STAGE-B-GATE] Proceeding to executeStageB with ${candidatesCount} candidates.`);

                            // 1. EXECUTE                            // [RESUME] Read Checkpoint
                            const lastBatchIndex = file.metadata?.stageB?.last_persisted_batch_index;

                            console.log(`[STAGE-B-RESUME] File ${file.id}: LastBatch=${lastBatchIndex ?? 'None'}`);

                            // Execution
                            const stageBResult = await executeStageB(
                                GEMINI_API_KEY,
                                requestId,
                                candidates,
                                {
                                    supabase,
                                    jobId: job_id,
                                    fileId: file.id,
                                    onSaveMeta: async (meta) => {
                                        await safeMergeMetadata(supabase, file.id, meta, 'stage_b_atomic_update');
                                    }
                                },
                                {
                                    startBatchIndex: typeof lastBatchIndex === 'number' ? lastBatchIndex + 1 : 0,
                                    onBatchResult: async (batchRes) => {
                                        const { batchIndex, items, candidateCount } = batchRes;
                                        // INCREMENTAL INSERT
                                        if (items && items.length > 0) {
                                            // Filtrar itens sem description (campo obrigatório)
                                            const validItems = items.filter((item: any) => item.description && item.description.trim());

                                            if (validItems.length === 0) {
                                                console.warn('[STAGE-B-DB-SKIP] All items in batch missing description');
                                            } else {
                                                // Helper para normalizar números brasileiros
                                                const parseNum = (v: any) => {
                                                    if (v === null || v === undefined) return null;
                                                    if (typeof v === 'number') return v;
                                                    const s = String(v).replace(/\./g, '').replace(',', '.').trim();
                                                    const f = parseFloat(s);
                                                    return isNaN(f) ? null : f;
                                                };

                                                const dbItems = await Promise.all(
                                                    validItems.map(async (item: any, idxInBatch: number) => {
                                                        const rawLine = item.evidence?.evidence_lines?.[0]?.text || null;

                                                        const dedupKey = await generateDedupKey({
                                                            job_id: job_id,
                                                            import_file_id: file.id,
                                                            description: item.description,
                                                            chunk_index: batchIndex,
                                                            raw_line: rawLine
                                                        });

                                                        // Derivar level a partir do item_path ou kind
                                                        let derivedLevel = 3;
                                                        if (item.kind === 'composition' && !item.code) {
                                                            // Título de seção — level baseado na profundidade do item_path
                                                            const pathDepth = item.item_path
                                                                ? item.item_path.split('.').filter((p: string) => p !== '0' && p !== '').length
                                                                : 1;
                                                            derivedLevel = Math.min(pathDepth, 2);
                                                        } else if (item.item_path) {
                                                            const pathDepth = item.item_path.split('.').filter((p: string) => p !== '0' && p !== '').length;
                                                            derivedLevel = Math.min(Math.max(pathDepth, 1), 3);
                                                        }

                                                        return {
                                                            job_id: job_id,
                                                            import_file_id: file.id,
                                                            idx: (batchIndex * 40) + idxInBatch + 1,

                                                            description: item.description,
                                                            unit: item.unit,
                                                            quantity: parseNum(item.quantity),
                                                            unit_price: parseNum(item.unit_price),
                                                            total: parseNum(item.total_price || item.total),

                                                            category: item.kind || 'stage_b_item',
                                                            raw_line: rawLine ? rawLine.substring(0, 1000) : null,
                                                            confidence: item.confidence_score || 0.8,
                                                            level: derivedLevel,
                                                            chunk_index: batchIndex,
                                                            composition_code: item.code || null,
                                                            dedup_key: dedupKey,
                                                            item_path: item.item_path || null,                        // NOVO
                                                            source_candidate_id: item.evidence?.candidate_id || null  // NOVO
                                                        };
                                                    })
                                                );

                                                // Filtrar itens sem item_path E sem composition_code — são lixo de página
                                                const filteredItems = dbItems.filter(item =>
                                                    item.composition_code !== null || item.item_path !== null
                                                );

                                                // Deduplica por dedup_key — mantém última ocorrência (caso LLM retorne descrições repetidas no mesmo batch)
                                                const deduped = new Map<string, typeof filteredItems[0]>();
                                                for (const item of filteredItems) {
                                                    deduped.set(item.dedup_key, item);
                                                }
                                                const uniqueDbItems = Array.from(deduped.values());

                                                console.log("[STAGE-B-DB-ATTEMPT] (Incremental)", {
                                                    file_id: file.id,
                                                    batch_index: batchIndex,
                                                    items_count: uniqueDbItems.length
                                                });

                                                const { error: insertErr } = await supabase
                                                    .from('import_ai_items')
                                                    .upsert(uniqueDbItems, {
                                                        onConflict: 'job_id,import_file_id,dedup_key',
                                                        ignoreDuplicates: false
                                                    });

                                                if (insertErr) {
                                                    console.error("[STAGE-B-DB-ERROR] (Incremental)", {
                                                        file_id: file.id,
                                                        message: insertErr.message
                                                    });
                                                    throw new Error(`Incremental DB Failure: ${insertErr.message}`);
                                                } else {
                                                    console.log("[STAGE-B-DB-SUCCESS] (Incremental)", {
                                                        file_id: file.id,
                                                        batch_index: batchIndex,
                                                        items_count: uniqueDbItems.length
                                                    });
                                                }
                                            }
                                        }

                                        // UPDATE CHECKPOINT
                                        await safeMergeMetadata(supabase, file.id, {
                                            stageB: {
                                                last_persisted_batch_index: batchRes.batchIndex,
                                                last_persisted_candidate_count: batchRes.candidateCount,
                                                last_persisted_at: new Date().toISOString()
                                            }
                                        }, 'stage_b_checkpoint');
                                    }
                                }
                            );
                            // --- [STAGE-B-VERIFY LOGS START] ---
                            try {
                                console.log("[STAGE-B-VERIFY] stageBResult keys:", Object.keys(stageBResult || {}));
                                console.log("[STAGE-B-VERIFY] item_count:", (stageBResult as any)?.item_count);
                                const itemsLen = Array.isArray((stageBResult as any)?.items) ? (stageBResult as any).items.length : typeof (stageBResult as any)?.items;
                                console.log("[STAGE-B-VERIFY] items type/len:", itemsLen);
                            } catch (e) {
                                console.error("[STAGE-B-VERIFY] Error logging verify stats", e);
                            }
                            // --- [STAGE-B-VERIFY LOGS END] ---

                            // 2. PERSIST ITEMS TO DB (Incremental strategy active)
                            let dbPersistedCount = 0;
                            // We skip bulk insert because items are inserted incrementally.
                            // We calculate count from result for logs.
                            if (stageBResult.items && stageBResult.items.length > 0) {
                                dbPersistedCount = stageBResult.items.length;
                                console.log(`[STAGE-B-DB] Incremental persistence used. New items processed in this run: ${dbPersistedCount}`);
                            }
                            // Original blocked out to prevent duplication
                            /*
                            if (stageBResult.items && stageBResult.items.length > 0) {
                                const dbItems = stageBResult.items.map((item: any, idx: number) => {
                                    // Derivar level a partir do item_path ou kind
                                    let derivedLevel = 3;
                                    if (item.kind === 'composition' && !item.code) {
                                        // Título de seção — level baseado na profundidade do item_path
                                        const pathDepth = item.item_path
                                            ? item.item_path.split('.').filter((p: string) => p !== '0' && p !== '').length
                                            : 1;
                                        derivedLevel = Math.min(pathDepth, 2);
                                    } else if (item.item_path) {
                                        const pathDepth = item.item_path.split('.').filter((p: string) => p !== '0' && p !== '').length;
                                        derivedLevel = Math.min(Math.max(pathDepth, 1), 3);
                                    }

                                    return {
                                        job_id: job_id,
                                        import_file_id: file.id,
                                        idx: idx,
                                        description: item.description,
                                        unit: item.unit,
                                        quantity: item.quantity ? parseFloat(String(item.quantity).replace(',', '.')) : null,
                                        unit_price: item.unit_price ? parseFloat(String(item.unit_price).replace(',', '.')) : null,
                                        total: item.total_price ? parseFloat(String(item.total_price).replace(',', '.')) : null,
                                        category: item.kind || 'stage_b_item',
                                        raw_line: item.evidence?.evidence_lines?.[0]?.text || null,
                                        confidence: item.confidence_score || 0.8,
                                        chunk_index: 0,
                                        level: derivedLevel,
                                        composition_code: item.code || null,
                                        item_path: item.item_path || null,
                                        source_candidate_id: item.evidence?.candidate_id || null
                                    };
                                });
    
                                try {
                                    // [STAGE-B-DB-ATTEMPT]
                                    console.log("[STAGE-B-DB-ATTEMPT]", {
                                        file_id: file.id,
                                        job_id: job_id,
                                        items_to_insert: dbItems.length,
                                        timestamp: new Date().toISOString()
                                    });
    
                                    const { error: insertErr } = await supabase.from('import_ai_items').insert(dbItems);
                                    if (insertErr) {
                                        console.error("[STAGE-B-DB] Failed to insert items:", insertErr);
    
                                        // [STAGE-B-DB-ERROR]
                                        console.error("[STAGE-B-DB-ERROR]", {
                                            file_id: file.id,
                                            job_id: job_id,
                                            message: insertErr.message,
                                            details: insertErr,
                                            timestamp: new Date().toISOString()
                                        });
    
                                        // Log error to metadata but don't throw to prevent total failure if possible?
                                        // No, if DB insert fails, we should fail the file.
                                        throw new Error(`DB Insert Failed: ${insertErr.message}`);
                                    } else {
                                        dbPersistedCount = dbItems.length;
                                        console.log(`[STAGE-B-DB] Successfully inserted ${dbPersistedCount} items.`);
    
                                        // [STAGE-B-DB-SUCCESS]
                                        console.log("[STAGE-B-DB-SUCCESS]", {
                                            file_id: file.id,
                                            job_id: job_id,
                                            inserted_count: dbPersistedCount,
                                            timestamp: new Date().toISOString()
                                        });
                                    }
                                } catch (dbErr: any) {
                                    // Re-throw to be caught by outer loop and mark file failed
                                    throw dbErr;
                                }
                            }
                            */

                            // 3. CONSTRUCT METADATA (Deep Merge Friendly)
                            // Use the outer STAGEB_BUILD_SIG
                            const stageBMetadata = {
                                ...stageBResult,
                                build_sig: STAGEB_BUILD_SIG,
                                items_persisted_to_db: dbPersistedCount,
                                persistence_verified: dbPersistedCount > 0,
                                debug: {
                                    ...(stageBResult.debug || {}),
                                    parse: stageBResult.debug?.parse ? {
                                        ...stageBResult.debug.parse,
                                        accepted_items: truncateSafe(stageBResult.debug.parse.accepted_items, 20),
                                        rejected_items: truncateSafe(stageBResult.debug.parse.rejected_items, 20)
                                    } : undefined
                                }
                            };

                            // 4. PERSIST METADATA (Atomic Deep Merge)
                            await persistStageBMetaAtomic(supabase, file.id, stageBMetadata);

                            fileDebug.stage_b_items = stageBResult.item_count;
                            fileDebug.db_persisted = dbPersistedCount;

                            // 5. UPDATE EXTRACTION STATUS
                            if (dbPersistedCount > 0) {
                                await updateImportFileExtractionState(supabase, file.id, {
                                    extraction_status: 'done',
                                    extraction_items_inserted: dbPersistedCount,
                                    extracted_completed_at: new Date().toISOString()
                                }, 'stage_b_success');
                            } else {
                                // If 0 items but success, mark as done with zero items reason
                                await updateImportFileExtractionState(supabase, file.id, {
                                    extraction_status: 'done',
                                    extraction_items_inserted: 0,
                                    extraction_reason: 'stage_b_zero_items',
                                    extracted_completed_at: new Date().toISOString()
                                }, 'stage_b_zero');
                            }

                        } else {
                            // Explicitly record that Stage B was skipped due to empty Stage A
                            await safeMergeMetadata(supabase, file.id, {
                                stageB: {
                                    skipped: true,
                                    reason: "no_stage_a_candidates",
                                    skipped_at: new Date().toISOString()
                                }
                            }, 'stage_b_skip');

                            // Mark as skipped/done
                            await updateImportFileExtractionState(supabase, file.id, {
                                extraction_status: 'skipped',
                                extraction_reason: 'no_candidates',
                                extracted_completed_at: new Date().toISOString()
                            }, 'stage_b_no_candidates');
                        }
                    } catch (e: any) {
                        stageBFailed = true;
                        console.error("[STAGE-B] Failed", e);
                        // Uses deepMerge, so this ADDS error info, preserves prior debug/LLM data if any
                        await safeMergeMetadata(supabase, file.id, {
                            stageB: {
                                error: e.message,
                                error_at: new Date().toISOString(),
                                llm_last_error: String(e).substring(0, 200)
                            }
                        }, 'stage_b_error');

                        await updateImportFileExtractionState(supabase, file.id, {
                            extraction_status: 'failed',
                            extraction_last_error: `Stage B Error: ${e.message}`,
                            extracted_completed_at: new Date().toISOString()
                        }, 'stage_b_inner_catch_failed');
                    }

                    await persistOCR(supabase, file.id, pdfData.text, 'full_scan_strategy', realLen > FULLSCAN_MAX_CHARS);

                    if (file.role !== 'analytic' && realLen <= FULLSCAN_MAX_CHARS) {
                        const modelDiscovery = await discoverGeminiModel(GEMINI_API_KEY);
                        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
                        await processMaxExtraction(supabase, job_id, file.id, pdfData.text, debugSummary, genAI.getGenerativeModel({ model: modelDiscovery.modelId }));
                    }

                    const { count: itemsInserted } = await supabase.from('import_ai_items').select('*', { count: 'exact', head: true }).eq('import_file_id', file.id);
                    // Double count fix: Do NOT accumulate globalItemsFound here, it will be done at the end of the loop
                    // globalItemsFound += (itemsInserted || 0);
                } else {
                    await updateImportFileExtractionState(supabase, file.id, { extraction_status: 'skipped', extraction_reason: 'text_empty', extracted_completed_at: new Date().toISOString() }, 'skip_file');
                }



                // Finalize Status
                console.log("[FINALIZE_TRACE] ENTER finalize block", {
                    file_id: file.id,
                    job_id: job_id,
                    stageBFailed
                });

                // count is lightweight
                const { count: itemsInserted, error: countErr } = await supabase.from('import_ai_items').select('*', { count: 'exact', head: true }).eq('import_file_id', file.id);

                if (countErr) {
                    console.error("[FINALIZE_TRACE] COUNT ERROR", {
                        file_id: file.id,
                        error: countErr.message
                    });
                } else {
                    console.log("[FINALIZE_TRACE] COUNT RESULT", {
                        file_id: file.id,
                        itemsInserted
                    });
                }

                globalItemsFound += (itemsInserted || 0);

                // --- 7. Finalize (Only if complete) ---
                if (itemsInserted && itemsInserted > 0) {
                    // Success (Recovery or Initial)
                    console.log("[FINALIZE_TRACE] ABOUT TO UPDATE STATUS", {
                        file_id: file.id,
                        next_status: 'done',
                        itemsInserted,
                        stageBFailed
                    });

                    await updateImportFileExtractionState(supabase, file.id, {
                        extraction_status: 'done',
                        extraction_items_inserted: itemsInserted,
                        extracted_completed_at: new Date().toISOString()
                    }, 'finalize_file_success');

                    console.log("[FINALIZE_TRACE] STATUS UPDATE COMPLETE", {
                        file_id: file.id
                    });
                } else {
                    // Zero Items found
                    if (stageBFailed) {
                        // Already marked failed in catch, do nothing (or reinforce?)
                        console.log(`[CHECKPOINT] finalize_skip_failed file_id=${file.id} (Stage B failed, status already set)`);
                        console.log("[FINALIZE_TRACE] SKIPPING UPDATE (Stage B Failed)", { file_id: file.id });
                    } else {
                        // Stage B succeeded (no throw) BUT produced 0 items.
                        // Mark DONE to release lock.
                        console.log("[FINALIZE_TRACE] ABOUT TO UPDATE STATUS (Zero Items)", {
                            file_id: file.id,
                            next_status: 'done',
                            itemsInserted: 0,
                            stageBFailed
                        });

                        await updateImportFileExtractionState(supabase, file.id, {
                            extraction_status: 'done',
                            extraction_reason: 'stage_b_zero_items_finished',
                            extraction_items_inserted: 0,
                            extracted_completed_at: new Date().toISOString()
                        }, 'finalize_file_zero_items');

                        console.log("[FINALIZE_TRACE] STATUS UPDATE COMPLETE", {
                            file_id: file.id
                        });
                    }
                }

            } catch (e: any) {
                console.error(`File loop error (${file.id}):`, e);
                filesFailedCount++;
                await updateImportFileExtractionState(supabase, file.id, { extraction_status: 'failed', extraction_last_error: e.message, extracted_completed_at: new Date().toISOString() }, 'file_fail');
            }
        }

        if (targetFileId) return jsonResponse({ ok: true, file_id: targetFileId, items_found: globalItemsFound, status: 'file_processed' });

        const { count: finalCount } = await supabase
            .from("import_ai_items")
            .select("*", { count: "exact", head: true })
            .eq("job_id", job_id);
        const dbCount = finalCount || 0;

        if (dbCount > 0) {
            const budgetId = await resolveBudgetIdForJob(supabase, job_id, jobData);
            if (budgetId) await hydrateBudgetItemsFromAI({ supabase, requestId, jobId: job_id, budgetId });

            // Verificar se todos os batches foram processados antes de finalizar
            // `candidates` e `stageBResult` não estão no escopo desta última função
            // Vamos recuperar `last_persisted_batch_index` do metadata gravado e 
            // `candidate_count` para estimar os batches.
            const { data: fileDataForBatches } = await supabase
                .from("import_files")
                .select("metadata")
                .eq("job_id", job_id)
                .eq("doc_role", "synthetic");

            let lastPersistedBatch = -1;
            let totalCandidates = 0;
            const BATCH_SIZE_LOCAL = 20; // Deve ser igual ao BATCH_SIZE definido em stageB_llm.ts

            if (fileDataForBatches && fileDataForBatches.length > 0) {
                for (const fd of fileDataForBatches) {
                    const stageA = fd.metadata?.stageA;
                    const stageB = fd.metadata?.stageB;
                    if (stageB && typeof stageB.last_persisted_batch_index === 'number') {
                        if (stageB.last_persisted_batch_index > lastPersistedBatch) {
                            lastPersistedBatch = stageB.last_persisted_batch_index;
                        }
                    }
                    // Fonte primária: stageA.candidate_count
                    if (stageA) {
                        if (typeof stageA.candidate_count === 'number' && stageA.candidate_count > totalCandidates) {
                            totalCandidates = stageA.candidate_count;
                        } else if (typeof (stageA.stats as any)?.candidates_found === 'number' && (stageA.stats as any).candidates_found > totalCandidates) {
                            totalCandidates = (stageA.stats as any).candidates_found;
                        }
                    }
                }
            }
            if (totalCandidates === 0) totalCandidates = 307;

            const totalBatches = Math.max(1, Math.ceil(totalCandidates / BATCH_SIZE_LOCAL));
            const allBatchesDone = lastPersistedBatch >= totalBatches - 1;
            const isComplete = dbCount >= COMPLETENESS_MIN_VALID_ITEMS && allBatchesDone;

            await supabase.from("import_jobs").update({
                status: isComplete ? "done" : "waiting_user",
                current_step: isComplete ? "done" : "waiting_user_partial",
                stage: isComplete ? "ready_to_finalize" : "processing",
                progress: isComplete ? 100 : Math.min(99, Math.round(((lastPersistedBatch + 1) / totalBatches) * 100)),
                document_context: {
                    ...(jobData.document_context || {}),
                    ocr_fallback_executed: true,
                    inserted_items_count: dbCount,
                    debug_info: createSafeDebugInfo(debugSummary)
                }
            }).eq("id", job_id);

            if (isComplete) {
                fetch(`${SUPABASE_URL}/functions/v1/import-finalize-budget`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
                    body: JSON.stringify({ job_id })
                }).catch(() => { });
            }

            return jsonResponse({
                ok: true,
                items: dbCount,
                allBatchesDone,
                status: isComplete ? "done" : "waiting_user"
            });
        } else {
            // No items in DB, check Stage B metadata for diagnostics
            let specificReason = "extraction_failed";
            let failureMsg = filesFailedCount === files.length ? "Falha no processamento de todos os arquivos." : "Nenhum item encontrado no arquivo.";

            // Check Stage B status
            const { data: jobFiles } = await supabase.from("import_files").select("metadata").eq("job_id", job_id);
            const hasStageBItems = jobFiles?.some((f: any) => (f.metadata?.stageB?.item_count || 0) > 0);
            const hasStageACandidates = jobFiles?.some((f: any) => (f.metadata?.stageA?.candidate_count || 0) > 0);

            if (hasStageACandidates && !hasStageBItems) {
                specificReason = "stageB_returned_zero_items";
                failureMsg = "IA não conseguiu estruturar itens a partir dos candidatos encontrados.";
            }

            await markJobFailed(supabase, job_id, jobData, specificReason, failureMsg, debugSummary);
            return jsonResponse({ ok: true, items_found: 0, status: "waiting_user", message: failureMsg });
        }

    } catch (err: any) {
        console.error("Critical Error", err);
        return jsonResponse({ error: err.message }, 500, req);
    }
});
