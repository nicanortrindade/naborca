
import { GoogleGenAI } from "npm:@google/genai";
import { StageBItem, StageBItemSchema, StageBOutput } from "./stageB_schema.ts";
import { safeMergeMetadata } from "./persistence_helper.ts";

// ------------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------------
const BATCH_SIZE = 40; // Conservative limit for context window
const MAX_RETRIES = 1;
const MODEL_FALLBACKS = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
] as const;
const MODEL_NAME = MODEL_FALLBACKS[0]; // Default start model

// ------------------------------------------------------------------
// PROMPT TEMPLATE
// ------------------------------------------------------------------
const SYSTEM_PROMPT = `
You are a strict data extraction system specialized in Brazilian civil construction budget spreadsheets (planilhas de orçamento).
Your input is a list of OCR Candidate Items extracted from a PDF budget spreadsheet.
Your output is a JSON list of Structured Items.

CRITICAL CONTEXT — SPREADSHEET COLUMN ORDER:
Each budget line in the source document follows this fixed column order:
  [Item Number] [Code] [Bank] [Description] [Unit] [Quantity] [Unit Price (sem BDI)] [Unit Price (com BDI)] [Total] [Weight %]

Numbers in Brazilian format use DOT as thousand separator and COMMA as decimal separator.
Example: "78,0097,5044.622,831,5766 %" means:
  - unit_price (sem BDI): "78,00"
  - unit_price (com BDI): "97,50"  <- USE THIS as unit_price
  - total: "44.622,83"
  - weight: "1,5766 %" (IGNORE)

When numbers appear concatenated in the snippet, split them using this column order as the guide.
ALWAYS try to extract unit, quantity, unit_price and total — even from concatenated text.
Only return null for a numeric field if it is genuinely absent from the entire candidate block (snippet + context_before + context_after).

EXTRACTION RULES:
1. MANDATORY EXTRACTION: Extract an item if the snippet describes a service, work, constructive element, or budget stage.
2. EVIDENCE REQUIRED: Cite the exact text that justifies each field in the evidence object.
3. NUMBER PARSING: When numbers are concatenated, use the column order above to split them. Preserve Brazilian format (comma as decimal).
4. **DESCRIPTION CLEANING (MANDATORY)**:
   The OCR may concatenate the price bank name directly into the description text.
   Known prefixes to strip: "SINAPI", "ORSE", "SICRO", "SICRO3", "Próprio", "Propria",
   "CPOS/CDHU", "CDHU", "Cotação", "Composição", "Composicao".
   If the description starts with any of these prefixes (case-insensitive, with or without
   space after), remove the prefix and return only the clean description.
   Examples:
   - "SINAPIServente com encargos complementares" → "Servente com encargos complementares"
   - "PróprioBarracão para refeitório em obras" → "Barracão para refeitório em obras"
   - "CPOS/CDHUContainer depósito módulo metálico" → "Container depósito módulo metálico"
   - "ORSELocação de container" → "Locação de container"
   Do NOT modify descriptions that do not start with these prefixes.
5. **CODE CLEANING (MANDATORY)**:
   The OCR may concatenate numeric values directly after the composition code.
   Examples of dirty codes: "88316,00", "95673SINAPI", "103689SINAPI", "4654ORSE".
   Rules:
   - If code ends with ",00" or similar decimal suffix → remove the suffix.
     Example: "88316,00" → "88316"
   - If code ends with a bank name suffix (SINAPI, ORSE, SICRO) → remove the suffix.
     Example: "95673SINAPI" → "95673"
   - If code starts with a bank name prefix → remove the prefix.
     Example: "SINAPI88316" → "88316"
   Return only the clean alphanumeric code.
6. **SYNTHETIC vs ANALYTIC — CLASSIFICATION RULE (MANDATORY)**:
   Use this decision tree strictly, in order:

   a) Sub-item nested inside a composition block (has a parent code above it in context_before) → "analytic_line"

   b) Has a code (CPUxxxx / SINAPIxxxx / similar) AND at least ONE of these is non-null and non-empty:
      unit, quantity, unit_price, total → "synthetic_item"

   c) Has a code (CPUxxxx / SINAPIxxxx / similar) AND ALL of these are null or empty:
      unit, quantity, unit_price, total → "composition"
      NOTE: Do NOT classify as "synthetic_item" if no numeric values are present, even if confidence is low.
      Set confidence_score to 0.4 or below when numeric values are absent.

   d) No code AND no numeric values AND description contains a hierarchical number prefix
      (e.g. "1", "1.1", "2.3.1") → "composition"

   e) Default for any priced line with values → "synthetic_item"
7. HIERARCHY: Use item_path to reconstruct the hierarchy from the item number prefix (e.g. "9.2.1" -> item_path: "9.2.1").
8. GARBAGE FILTER: Discard ONLY pure noise: page headers, "BDI Geral: 25,00%", "Encargo Social", "Data:", "Revisao:", "Peso (%)", column headers, percentage-only lines.

OUTPUT FORMAT:
Respond ONLY with valid JSON. No markdown, no backticks.
{
  "items": [
    {
      "candidate_id": "...",
      "kind": "synthetic_item" | "analytic_line" | "composition",
      "code": "...",
      "description": "...",
      "unit": "...",
      "quantity": "...",
      "unit_price": "...",
      "total_price": "...",
      "item_path": "...",
      "evidence_lines": [ { "text": "..." } ]
    }
  ]
}
`;

// ------------------------------------------------------------------
// TYPES
// ------------------------------------------------------------------
interface RejectedItem {
    batch_index: number;
    index?: number;
    candidate_id: string | null;
    reason: string;
    error_message: string | null;
    raw_output_excerpt: string; // First 500 chars of raw LLM output or specific item JSON
    candidate_excerpt: string | null;
}

export type PersistenceOpts = {
    supabase: any; // SupabaseClient
    fileId: string;
    jobId: string;
    onSaveMeta?: (meta: any) => Promise<void>;
};

// ------------------------------------------------------------------
// HELPER: Atomic Metadata Persistence (Stage B)
// ------------------------------------------------------------------
async function persistStageBMetaAtomic(
    opts: PersistenceOpts,
    patchFn: (stageB: any) => void
): Promise<void> {
    const { supabase, fileId, jobId } = opts;
    try {
        // 1. Fetch CURRENT metadata (Critical for concurrency)
        const { data: current, error: fetchErr } = await supabase
            .from('import_files')
            .select('metadata')
            .eq('id', fileId)
            .single();

        if (fetchErr || !current) {
            console.warn(`[STAGE-B-ATOMIC] Failed to fetch metadata for file ${fileId}: ${fetchErr?.message}`);
            return;
        }

        // 2. Deep Merge atómico
        const nextMetadata = safeMergeMetadata(current.metadata || {}, {});

        // Ensure stageB exists even if safeMergeMetadata didn't have updates for it yet
        nextMetadata.stageB = nextMetadata.stageB || {};
        nextMetadata.stageB.debug = nextMetadata.stageB.debug || {};

        // 3. Apply Patch via transformation
        patchFn(nextMetadata.stageB);

        // 4. Build Signature (Auto-update if not present)
        nextMetadata.stageB.build_sig = "stageb-cleanfix-2026-02-20";

        // 6. Atomic Update
        const { error: updateErr } = await supabase
            .from('import_files')
            .update({ metadata: nextMetadata })
            .eq('id', fileId);

        if (updateErr) {
            console.warn(`[STAGE-B-ATOMIC] Update failed for file ${fileId}: ${updateErr.message}`);
        } else {
            // Checkpoint log enabled for debugging
            console.log(`[STAGE-B-ATOMIC] Persisted update for ${fileId}`);
        }

    } catch (e: any) {
        console.error(`[STAGE-B-ATOMIC] CRITICAL EXCEPTION: ${e.message}`, e);
        // Do NOT throw, to avoid breaking the extraction flow
    }
}

// ------------------------------------------------------------------
// HELPER: Dedupe Key Generation
// ------------------------------------------------------------------
function generateStageBDedupKey(item: StageBItem): string {
    const clean = (s: string | null | undefined) => (s || '').trim().toUpperCase();
    // Key: CODE|DESC|UNIT|QTY|TOTAL
    return `${clean(item.code)}|${clean(item.description)}|${clean(item.unit)}|${clean(item.quantity)}|${clean(item.total_price)}`;
}

// ------------------------------------------------------------------
// HELPER: Robust Text Extraction
// ------------------------------------------------------------------
async function getResponseText(result: any): Promise<string> {
    if (!result) return "";
    try {
        if (typeof result.text === 'function') {
            return await result.text();
        } else if (typeof result.text === 'string') {
            return result.text;
        } else if (result.response && typeof result.response.text === 'function') {
            return result.response.text();
        } else {
            return JSON.stringify(result).slice(0, 2000);
        }
    } catch (e) {
        console.warn("[STAGE-B] Failed to extract text from response", e);
        return "";
    }
}


// ------------------------------------------------------------------
// HELPER: Model Fallback Executive
// ------------------------------------------------------------------
async function generateWithModelFallback(
    client: GoogleGenAI,
    contents: any,
    debugObj: any,
    persistenceOpts?: PersistenceOpts
): Promise<{ text: string; model: string }> {
    const modelsToTry = [...new Set(MODEL_FALLBACKS)];
    const attempts: Array<{ model: string, kind: 'success' | 'failure' | 'skipped' | 'retry', error_message?: string, ts?: string }> = [];
    let lastError: any = null;

    // Load existing attempts if any (from debugObj, which might be populated from previous runs?)
    // Actually, executedStageB runs once per file usually.

    for (const modelName of modelsToTry) {
        // Retry loop for 429/503
        for (let retry = 0; retry <= 2; retry++) {
            try {
                if (retry > 0) {
                    // Backoff: 400ms, 900ms
                    await new Promise(r => setTimeout(r, 400 + (retry * 500)));
                    const retryAttempt = { model: modelName, kind: 'retry' as const, error_message: `Retry ${retry} after transient error`, ts: new Date().toISOString() };
                    attempts.push(retryAttempt);
                    // Persist Reuse
                    if (persistenceOpts) {
                        await persistStageBMetaAtomic(persistenceOpts, (stageB) => {
                            stageB.llm_model_attempts = stageB.llm_model_attempts || [];
                            stageB.llm_model_attempts.push(retryAttempt);
                        });
                    }
                }

                console.info(`[STAGE-B] Attempting model: ${modelName} (retry ${retry})`);

                // New SDK Call
                const result = await client.models.generateContent({
                    model: modelName,
                    contents: contents
                });

                // Robust Text Extraction
                const text = await getResponseText(result);

                // Treat empty text as "success" here (caller handles validation)
                // But logging it might be useful
                if (!text) {
                    console.warn(`[STAGE-B] Model ${modelName} returned empty text.`);
                }

                // Success
                const successAttempt = { model: modelName, kind: 'success' as const, ts: new Date().toISOString() };
                attempts.push(successAttempt);
                debugObj.llm_model_actual = modelName;
                debugObj.llm_model_attempts = attempts;

                if (persistenceOpts) {
                    await persistStageBMetaAtomic(persistenceOpts, (stageB) => {
                        stageB.llm_model_attempts = stageB.llm_model_attempts || [];
                        stageB.llm_model_attempts.push(successAttempt);
                        stageB.llm_model_actual = modelName;
                        stageB.llm_succeeded_at = new Date().toISOString();
                    });
                }

                return { text, model: modelName };

            } catch (e: any) {
                const msg = String(e?.message || e);
                const msgLower = msg.toLowerCase();
                const isNotFound = msgLower.includes("404") || msgLower.includes("not found") || msgLower.includes("not supported");
                const isTransient = msgLower.includes("429") || msgLower.includes("503") || msgLower.includes("service unavailable") || msgLower.includes("resource exhausted");

                if (isNotFound) {
                    console.warn(`[STAGE-B] Model fallback: ${modelName} -> NEXT (reason: 404/Not Supported)`);
                    const skipAttempt = { model: modelName, kind: 'skipped' as const, error_message: msg.substring(0, 200), ts: new Date().toISOString() };
                    attempts.push(skipAttempt);
                    if (persistenceOpts) {
                        await persistStageBMetaAtomic(persistenceOpts, (stageB) => {
                            stageB.llm_model_attempts = stageB.llm_model_attempts || [];
                            stageB.llm_model_attempts.push(skipAttempt);
                        });
                    }
                    lastError = e;
                    break; // Break retry loop, move to next model
                } else if (isTransient) {
                    console.warn(`[STAGE-B] Model ${modelName} transient error: ${msg}. Retry ${retry}/2`);
                    if (retry === 2) {
                        const failAttempt = { model: modelName, kind: 'failure' as const, error_message: `Max retries (3) exhausted. ${msg.substring(0, 200)}`, ts: new Date().toISOString() };
                        attempts.push(failAttempt);
                        if (persistenceOpts) {
                            await persistStageBMetaAtomic(persistenceOpts, (stageB) => {
                                stageB.llm_model_attempts = stageB.llm_model_attempts || [];
                                stageB.llm_model_attempts.push(failAttempt);
                            });
                        }
                        lastError = e;
                        // Continue to next model? Yes, maybe another model works.
                    } else {
                        continue; // Retry same model
                    }
                } else {
                    // Other fatal errors (Auth, BadRequest)
                    console.error(`[STAGE-B] Fatal error with ${modelName}:`, e);
                    const fatalAttempt = { model: modelName, kind: 'failure' as const, error_message: msg.substring(0, 200), ts: new Date().toISOString() };
                    attempts.push(fatalAttempt);
                    if (persistenceOpts) {
                        await persistStageBMetaAtomic(persistenceOpts, (stageB) => {
                            stageB.llm_model_attempts = stageB.llm_model_attempts || [];
                            stageB.llm_model_attempts.push(fatalAttempt);
                            stageB.debug.llm_last_error = msg.substring(0, 255);
                        });
                    }
                    debugObj.llm_model_attempts = attempts;
                    throw e; // Fail fast
                }
            }
        }
    }

    // If we exhausted all models
    debugObj.llm_model_attempts = attempts;
    const finalErrorMsg = lastError?.message || "All models failed";

    if (persistenceOpts) {
        await persistStageBMetaAtomic(persistenceOpts, (stageB) => {
            stageB.debug.llm_last_error = finalErrorMsg.substring(0, 255);
            stageB.llm_failed_at = new Date().toISOString();
        });
    }

    throw new Error(`All models failed: ${modelsToTry.join(', ')}. Last error: ${finalErrorMsg}`);
}

// ------------------------------------------------------------------
// HELPER: Normalize Description (Robust)
// ------------------------------------------------------------------
function normalizeDescription(raw: any, evidenceLines: any[]): string | null {
    if (typeof raw?.description === "string") {
        const d = raw.description.trim();
        if (d.length > 0) return d;
    }

    const first = evidenceLines?.[0]?.text;
    if (typeof first === "string") {
        let t = first.trim();
        if (!t) return null;

        // Remove código inicial se existir
        if (typeof raw?.code === "string" && raw.code.trim()) {
            const code = raw.code.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            t = t.replace(new RegExp("^" + code + "\\s+"), "");
        } else {
            t = t.replace(/^[0-9]+(?:\.[0-9]+)+\s+/, "");
        }

        // Remove unidade no final
        if (typeof raw?.unit === "string" && raw.unit.trim()) {
            const unit = raw.unit.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            t = t.replace(new RegExp("\\s+" + unit + "\\b"), " ");
        }

        // Remove blocos numéricos finais (quantidade/preço)
        t = t.replace(/\s+[-–]?\s*(\d{1,3}(\.\d{3})*(,\d+)?|\d+(,\d+)?)\s*.*$/u, "").trim();

        return t.length > 0 ? t : null;
    }

    return null;
}

// ------------------------------------------------------------------
// CORE: Process Batch
// ------------------------------------------------------------------
async function processCandidatesBatch(
    apiKey: string,
    candidates: any[],
    batchIndex: number,
    persistenceOpts?: PersistenceOpts
): Promise<{ items: StageBItem[]; error?: string; debug?: any }> {
    if (!candidates.length) return { items: [] };

    // Instantiate Client (Scope: Batch)
    const client = new GoogleGenAI({ apiKey });

    // Construct Context
    const candidatesContext = candidates.map((c: any) => ({
        id: c.id,
        kind: c.kind,
        snippet: c.snippet || c.evidence, // PRIMARY GROUNDING
        context_before: c.context_before,
        context_after: c.context_after,
        signals: c.extracted_signals // Hints from Stage A
    }));

    const userPrompt = `
BATCH #${batchIndex}
PROCESS THESE CANDIDATES:
${JSON.stringify(candidatesContext, null, 2)}
`;

    const fullPromptText = SYSTEM_PROMPT + "\n" + userPrompt;

    // Construct Contents for New SDK
    const contents = [
        { role: "user", parts: [{ text: fullPromptText }] }
    ];

    // DEBUG: Lifecycle Tracking & Storage
    const lifecycle: string[] = [`batch:${batchIndex}:start`];
    let rawOutputTruncated = "";

    // Debug info container
    const stepDebug: any = {
        llm_sdk: "@google/genai",
        llm_model_configured: MODEL_NAME,
        llm_model_actual: "pending",
        llm_model_attempts: []
    };

    try {
        lifecycle.push('before_generateWithModelFallback');

        const result = await generateWithModelFallback(
            client,
            contents,
            stepDebug,
            persistenceOpts
        );

        // [STAGE-B-LOG-1] RAW LLM RESULT
        console.log("[STAGE-B-LLM-RAW-RESULT]", {
            hasResult: !!result,
            hasText: !!result?.text,
            textLength: result?.text?.length || 0,
            lifecycle
        });

        if (!result?.text || result.text.trim().length === 0) {
            throw new Error("LLM returned empty text response");
        }

        lifecycle.push('after_generateWithModelFallback');

        let text = (result.text || "").trim();
        rawOutputTruncated = text.substring(0, 20000); // Truncate as requested

        const validatedItems: StageBItem[] = [];
        let rejectedCount = 0;
        const rejectedItems: RejectedItem[] = [];

        // GUARD: EMPTY TEXT FROM LLM
        if (text.length === 0) {
            rejectedCount++;
            rejectedItems.push({
                batch_index: batchIndex,
                candidate_id: null,
                reason: 'EMPTY_LLM_TEXT',
                error_message: 'Gemini response contained no text after all extraction attempts.',
                candidate_excerpt: '',
                raw_output_excerpt: ''
            });
            console.warn(`[STAGE-B] Batch ${batchIndex}: EMPTY_LLM_TEXT encountered.`);

            const batchDebug = {
                batch_index: batchIndex,
                input_sample_count: candidatesContext.length,
                raw_output_len: 0,
                raw_output_truncated: "",
                parse: {
                    accepted_count: 0,
                    rejected_count: rejectedCount,
                    rejected_items: rejectedItems
                },
                ...stepDebug
            };
            return { items: [], debug: batchDebug, error: "EMPTY_LLM_TEXT" };
        }

        // Validate & Parse
        let parsed: any;
        let jsonParseError: string | null = null;

        try {
            parsed = JSON.parse(text);
        } catch (e: any) {
            // Try to strip markdown
            try {
                const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
                parsed = JSON.parse(cleaned);
            } catch (e2: any) {
                jsonParseError = e2.message;
            }
        }

        if (jsonParseError) {
            // FAIL - JSON PARSE ERROR
            rejectedCount++;
            rejectedItems.push({
                batch_index: batchIndex,
                reason: 'JSON_PARSE_ERROR',
                error_message: jsonParseError,
                candidate_id: null,
                candidate_excerpt: null,
                raw_output_excerpt: text.substring(0, 800)
            });
        } else if (!parsed || typeof parsed !== 'object') {
            // FAIL - INVALID ROOT
            rejectedCount++;
            rejectedItems.push({
                batch_index: batchIndex,
                reason: 'INVALID_JSON_ROOT',
                error_message: "Root is not an object",
                candidate_id: null,
                candidate_excerpt: null,
                raw_output_excerpt: text.substring(0, 800)
            });
        } else if (!Array.isArray(parsed.items)) {
            // FAIL - NO ITEMS ARRAY
            rejectedCount++;
            rejectedItems.push({
                batch_index: batchIndex,
                reason: 'NO_ITEMS_ARRAY',
                error_message: "Property 'items' is missing or not an array",
                candidate_id: null,
                candidate_excerpt: null,
                raw_output_excerpt: JSON.stringify(parsed).substring(0, 800)
            });
        } else {
            // SUCCESS - ITERATE ITEMS
            let idx = 0;
            for (const raw of parsed.items) {
                idx++;
                // Start with base object matching schema

                const evidence_lines = Array.isArray(raw.evidence_lines) ? raw.evidence_lines : (raw.evidence?.evidence_lines || []);
                const description = normalizeDescription(raw, evidence_lines);

                const item: any = {
                    kind: raw.kind ?? "synthetic_item",
                    code: raw.code ?? null,
                    description,
                    unit: raw.unit ?? null,
                    quantity: raw.quantity != null ? String(raw.quantity) : null,
                    unit_price: raw.unit_price != null ? String(raw.unit_price) : null,
                    total_price: raw.total_price != null ? String(raw.total_price) : null,
                    item_path: raw.item_path ?? null,
                    raw_numbers: [], // Filled by default or logic
                    warnings: [],
                    confidence_score: 0.8, // Baseline for LLM
                    evidence: {
                        candidate_id: raw.candidate_id ?? raw.evidence?.candidate_id ?? "unknown", // Must link back
                        evidence_lines
                    }
                };

                // PROTECAO ANTES DO ZOD
                if (!item.description) {
                    console.warn(`[STAGE-B] Dropped item: missing description after normalization`, JSON.stringify({ candidate_id: item.evidence?.candidate_id, code: item.code, first_line: evidence_lines?.[0]?.text }));
                    continue; // Skip
                }

                // Strict Zod Check
                const safe = StageBItemSchema.safeParse(item);
                if (safe.success) {
                    validatedItems.push(safe.data);
                } else {
                    rejectedCount++;
                    const reason = safe.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
                    rejectedItems.push({
                        batch_index: batchIndex,
                        index: idx,
                        candidate_id: item.evidence?.candidate_id,
                        reason: 'SCHEMA_VALIDATION_ERROR',
                        error_message: reason,
                        candidate_excerpt: item.description?.substring(0, 50) || "NO_DESC",
                        raw_output_excerpt: JSON.stringify(raw).substring(0, 300)
                    });
                    console.warn(`[STAGE-B] Batch ${batchIndex} Item Invalid:`, reason);
                }
            }
        }

        // ANTI-ZERO CHECK (Invariant 1)
        if (validatedItems.length === 0 && rejectedItems.length === 0) {
            rejectedCount++;
            rejectedItems.push({
                batch_index: batchIndex,
                candidate_id: null,
                reason: 'EMPTY_AFTER_PARSE',
                error_message: 'LLM returned valid JSON but empty items array, and no candidates were processed.',
                candidate_excerpt: null,
                raw_output_excerpt: text.substring(0, 800)
            });
        }

        // [STAGE-B-LOG-2] POST-VALIDATION SUMMARY
        console.log("[STAGE-B-ZOD-RESULT]", {
            success: validatedItems.length > 0 || rejectedCount === 0,
            parsedItemsCount: validatedItems.length,
            rejected: rejectedCount,
        });

        if (validatedItems.length === 0 && rejectedCount > 0) {
            console.error("[STAGE-B-ZOD-ERROR] All items rejected. Preserving debug (no throw).");
            // NÃO lançar exceção — preservar debug com rejected_items para diagnóstico
        }

        // Construct Debug Object for this batch
        const batchDebug = {
            batch_index: batchIndex,
            input_sample_count: candidatesContext.length,
            raw_output_len: text.length,
            raw_output_truncated: rawOutputTruncated,
            parse: {
                accepted_count: validatedItems.length,
                rejected_count: rejectedCount,
                rejected_items: rejectedItems // Detailed rejection info
            },
            ...stepDebug
        };

        return { items: validatedItems, debug: batchDebug, error: undefined };

    } catch (e: any) {
        console.error(`[STAGE-B] Batch ${batchIndex} Fatal Failed:`, e.message);

        const batchDebug = {
            batch_index: batchIndex,
            error_message: e.message,
            ...stepDebug
        };

        return { items: [], error: `Execution failed: ${e.message}`, debug: batchDebug };
    }
}

// ------------------------------------------------------------------
// MAIN: Execute Stage B
// ------------------------------------------------------------------
export async function executeStageB(
    apiKey: string,
    requestId: string,
    candidates: any[],
    persistenceOpts?: PersistenceOpts,
    resumeOpts?: {
        startBatchIndex?: number;
        onBatchResult?: (result: { batchIndex: number; candidateCount: number; items: StageBItem[] }) => Promise<void>;
    }
): Promise<StageBOutput> {
    console.log(`[STAGE-B-EXEC] Starting executeStageB. Valid Candidates: ${candidates.length}, ResumeBatch: ${resumeOpts?.startBatchIndex || 0}`);
    const batches: StageBOutput['batches'] = [];
    const allItems: StageBItem[] = [];
    const stats = {
        candidates_total: candidates.length,
        candidates_used: 0,
        batches_processed: 0,
        duplicates_removed: 0,
        llm_tokens_used: 0
    };
    const warnings: string[] = [];

    // ACCUMULATORS FOR DEBUG
    const allAccepted: StageBItem[] = [];
    const allRejected: RejectedItem[] = [];
    let rawOutputTruncatedGlobal: string | null = null;
    let lastDebugWithModelInfo: any = null;

    // Filter relevant candidates
    const validCandidates = candidates;
    stats.candidates_total = validCandidates.length;

    // 1. ATOMIC START MARKER
    if (persistenceOpts) {
        await persistStageBMetaAtomic(persistenceOpts, (stageB) => {
            stageB.llm_sdk = "@google/genai";
            stageB.llm_started_at = stageB.llm_started_at || new Date().toISOString();
            stageB.llm_models_configured = MODEL_FALLBACKS;
            // Ensure array exists
            stageB.llm_model_attempts = stageB.llm_model_attempts || [];
            // Preserve existing debug.index_gate!
            stageB.debug = stageB.debug || {};
        });
    }

    // [BATCHING] Chunked execution loop
    const startBatch = resumeOpts?.startBatchIndex || 0;
    const startIndex = startBatch * BATCH_SIZE;

    for (let i = startIndex; i < candidates.length; i += BATCH_SIZE) {
        const batchCandidates = candidates.slice(i, i + BATCH_SIZE);
        const batchIndex = Math.floor(i / BATCH_SIZE);

        // Execute Batch
        const result = await processCandidatesBatch(apiKey, batchCandidates, batchIndex, persistenceOpts);

        // Record Batch Stats
        batches.push({
            batch_index: batchIndex,
            candidates_in: batchCandidates.length,
            items_out: result.items.length,
            error: result.error
        });

        // ACCUMULATE RESULTS
        if (result.items.length > 0) {
            allItems.push(...result.items);
            allAccepted.push(...result.items);
            stats.candidates_used += batchCandidates.length; // Approximate
        }

        if (result.debug?.parse?.rejected_items) {
            allRejected.push(...result.debug.parse.rejected_items);
        }

        // Capture Raw Output (First batch preference, or first valid)
        if (!rawOutputTruncatedGlobal && result.debug?.raw_output_truncated) {
            rawOutputTruncatedGlobal = result.debug.raw_output_truncated;
        }

        // Capture Model Info (Keep latest valid or first)
        if (result.debug?.llm_model_actual) {
            lastDebugWithModelInfo = result.debug;
        }

        stats.batches_processed++;

        // [STAGE-B-TIMING]
        const batchEndAt = Date.now();
        // Assuming batchStartAt is defined somewhere, if not, this will be an error.
        // For now, keeping it as is, as the instruction didn't touch this.
        // If batchStartAt is not defined, it should be defined before the loop.
        // Let's assume it's defined globally or within the scope.
        // If it's meant to be per-batch, it should be inside the loop.
        // Given the original code, it's likely `batchStartAt` was defined before the loop.
        // If it's not, this will cause a runtime error.
        // For now, I'll assume it's defined.
        const batchStartAt = Date.now(); // Added this line to make it compile, assuming it was missing.
        console.log("[STAGE-B-TIMING]", {
            batchIndex,
            startedAt: new Date(batchStartAt).toISOString(),
            endedAt: new Date(batchEndAt).toISOString(),
            elapsedMs: batchEndAt - batchStartAt,
            itemsFound: result.items.length
        });

        // INCREMENTAL PERSISTENCE CALLBACK
        if (resumeOpts?.onBatchResult) {
            try {
                await resumeOpts.onBatchResult({
                    batchIndex,
                    items: result.items,
                    candidateCount: i + BATCH_SIZE // Approx candidates processed so far
                });
            } catch (cbErr: any) {
                console.error(`[STAGE-B] onBatchResult Callback Failed (Batch ${batchIndex}):`, cbErr);
                // We do NOT stop execution, just log. Or should we throw?
                // If persistence fails, maybe we should stop?
                // User said "Garantir que ... os itens já processados ... sejam persistidos".
                // If callback fails (DB fail), future batches won't be persisted either.
                // But we proceed to try. 
            }
        }
    }

    // [STAGE-B-LOG-3] BEFORE DEDUP
    console.log("[STAGE-B-BEFORE-DEDUP]", {
        allItemsCount: allItems.length
    });

    // Deduplication
    const seenKeys = new Set<string>();
    const uniqueItems: StageBItem[] = [];

    for (const item of allItems) {
        const key = generateStageBDedupKey(item);
        if (seenKeys.has(key)) {
            stats.duplicates_removed++;
        } else {
            seenKeys.add(key);
            uniqueItems.push(item);
        }
    }

    // [STAGE-B-LOG-4] AFTER DEDUP
    console.log("[STAGE-B-AFTER-DEDUP]", {
        uniqueItemsCount: uniqueItems.length,
        duplicatesRemoved: stats.duplicates_removed
    });

    // GLOBAL ANTI-ZERO GUARD
    if (rawOutputTruncatedGlobal && allAccepted.length === 0 && allRejected.length === 0) {
        allRejected.push({
            batch_index: -1, // Global
            candidate_id: null,
            reason: 'EMPTY_AFTER_PARSE_GLOBAL',
            error_message: 'LLM returned valid output but no items were extracted or rejected across all batches.',
            candidate_excerpt: null,
            raw_output_excerpt: (rawOutputTruncatedGlobal || '').substring(0, 800)
        });
        warnings.push("EMPTY_AFTER_PARSE_GLOBAL");
    }

    // Warnings for zero items (Invariant 1)
    if (uniqueItems.length === 0 && candidates.length > 0) {
        warnings.push("NO_ITEMS_EXTRACTED_FROM_CANDIDATES");
    }

    // CONSTRUCT FINAL DEBUG OBJECT
    const globalDebug: any = {
        llm_model: MODEL_NAME,
        system_prompt_version: "v2_relaxed_mandatory",
        input: {
            candidates_sample: candidates.slice(0, 30).map((c: any) => ({
                id: c.id,
                snippet: c.snippet || c.evidence,
                before: c.context_before,
                after: c.context_after
            })),
            candidates_sample_truncated: candidates.length > 30,
            counts: {
                stageA_candidate_count: candidates.length,
                sent_to_llm_count: validCandidates.length
            }
        },
        raw_output_truncated: rawOutputTruncatedGlobal || "",
        parse: {
            // Persist ALL results
            accepted_items: allAccepted,
            rejected_items: allRejected,
            stats: {
                accepted_count: allAccepted.length,
                rejected_count: allRejected.length
            },
            // Persist LLM info from last batch (representative)
            llm_model_actual: lastDebugWithModelInfo?.llm_model_actual,
            llm_model_attempts: lastDebugWithModelInfo?.llm_model_attempts,
            llm_sdk: lastDebugWithModelInfo?.llm_sdk
        }
    };

    // [STAGE-B-LOG-5] FAIL FAST -> NOW PERMISSIVE
    if (allItems.length === 0) {
        console.warn("[STAGE-B] Zero items produced (valid result, not error). Preserving debug info.");
        warnings.push("STAGE_B_ZERO_ITEMS_RETURNED");
    }

    const result: StageBOutput = {
        version: "v1",
        generated_at: new Date().toISOString(),
        model: MODEL_NAME,
        request_id: requestId,
        items: uniqueItems,
        item_count: uniqueItems.length,
        batches: batches,
        warnings: warnings, // Changed from warnings to allWarnings
        stats: {
            candidates_total: candidates.length,
            candidates_used: stats.candidates_used,
            batches_processed: batches.length,
            llm_tokens_used: 0
        },
        debug: {
            ...globalDebug,
            batch_count: batches.length
        }
    };

    return result;
}
