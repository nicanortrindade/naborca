
import { createClient } from 'jsr:@supabase/supabase-js@2'

// Configuration & Headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

// Feature Flags (Env Vars)
const USE_BATCH_INSERT_ENV = Deno.env.get('USE_BATCH_INSERT');
const BATCH_SIZE_ENV = Deno.env.get('BATCH_SIZE');
const CHUNK_CONCURRENCY_ENV = Deno.env.get('CHUNK_CONCURRENCY');
const ENABLE_FAILED_CHUNK_REPROCESS_ENV = Deno.env.get('ENABLE_FAILED_CHUNK_REPROCESS');
const CHUNK_BOUNDARY_BY_NEWLINE_ENV = Deno.env.get('CHUNK_BOUNDARY_BY_NEWLINE');

const USE_BATCH_INSERT = (USE_BATCH_INSERT_ENV === 'true' || USE_BATCH_INSERT_ENV === '1' || USE_BATCH_INSERT_ENV === 'yes');
const RAW_BATCH_SIZE = BATCH_SIZE_ENV ? parseInt(BATCH_SIZE_ENV) : 1000;
const BATCH_SIZE = Math.max(100, Math.min(5000, isNaN(RAW_BATCH_SIZE) ? 1000 : RAW_BATCH_SIZE));

// Parallelism
// Parallelism
const RAW_CHUNK_CONCURRENCY = CHUNK_CONCURRENCY_ENV ? parseInt(CHUNK_CONCURRENCY_ENV) : 1;
const CHUNK_CONCURRENCY = 1; // FORCED TO 1 to avoid Quota Errors
const PARALLEL_ENABLED = false;

// Reprocess Logic
const ENABLE_FAILED_CHUNK_REPROCESS = (ENABLE_FAILED_CHUNK_REPROCESS_ENV === 'true' || ENABLE_FAILED_CHUNK_REPROCESS_ENV === '1');
const CHUNK_BOUNDARY_BY_NEWLINE = CHUNK_BOUNDARY_BY_NEWLINE_ENV !== 'false'; // Default true

// Critical Config Validation
if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`[ExtractWorker] Critical Config Missing: 
        GEMINI=${!!GEMINI_API_KEY}, 
        URL=${!!SUPABASE_URL}, 
        KEY=${!!SUPABASE_SERVICE_ROLE_KEY}`
    );
}

// Admin Client (Bypass RLS)
const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)

const MAX_EXTRACTION_ATTEMPTS = 6;

// --- TYPES ---
interface ModelAttempt {
    model: string;
    phase: 'probe' | 'chunk' | 'repair' | 'reprocess';
    ok: boolean;
    status?: number;
    error?: string;
    ts: string;
}

interface ChunkResult {
    index: number;
    text: string;
    success: boolean;
    items: any[];
    summary: string | null;
    model_used: string;
    gemini_time_ms: number;
    // Phase 2.2D
    status: 'ok' | 'empty' | 'failed';
    error_type?: string;
    error_msg?: string;
}

// --- HELPER FUNCTIONS ---

function getRetryBackoffMinutes(attempt: number): number {
    if (attempt <= 1) return 2;
    if (attempt === 2) return 5;
    if (attempt === 3) return 15;
    return 60; // 4+ attempts cap at 1 hour
}

async function safeUpdateImportFile(job_id: string, patch: any) {
    try {
        const { error } = await supabase
            .from('import_files')
            .update(patch)
            .eq('job_id', job_id);

        if (error) {
            console.warn(`[ExtractWorker] safeUpdateImportFile warning: ${error.message}`, patch);
        }
    } catch (e: any) {
        console.warn(`[ExtractWorker] safeUpdateImportFile exception: ${e.message}`);
    }
}

function parseBRNumber(value: any): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;

    // Cleanup string " 1.234,56 " -> "1234.56"
    let clean = value.trim();
    if (!clean) return null;

    // Remove symbols (R$, spaces)
    clean = clean.replace(/[R$\s]/g, '');

    // Handle "1.000,00" format vs "1,000.00" vs "1000.00"
    if (clean.includes(',') && clean.includes('.')) {
        clean = clean.replace(/\./g, '').replace(',', '.');
    } else if (clean.includes(',')) {
        clean = clean.replace(',', '.');
    }

    const parsed = parseFloat(clean);
    return isNaN(parsed) ? null : parsed;
}

/**
 * Explicit Ranking of Models:
 * 1. gemini-2.0-flash-001
 * 2. gemini-2.0-flash
 * 3. gemini-flash-latest
 * 4. other 2.0 flashes
 * 5. gemini-2.5-flash (LAST RESORT)
 */
async function getModelCandidates(apiKey: string): Promise<string[]> {
    const fallbackList = ['gemini-2.0-flash-001', 'gemini-2.0-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];
    let models: any[] = [];

    try {
        console.log("[ExtractWorker] Discovering models...");
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!res.ok) {
            console.warn(`[ExtractWorker] Discovery failed (${res.status}), using fallbacks.`);
            return fallbackList;
        }

        const data = await res.json();
        models = data.models || [];
    } catch (err) {
        console.error("[ExtractWorker] Discovery error:", err);
        return fallbackList;
    }

    // Filter valid extractors
    const availableNames = models.filter((m: any) => {
        const name = m.name?.toLowerCase() || "";
        const methods = m.supportedGenerationMethods || [];

        if (!methods.includes("generateContent")) return false;
        if (name.includes('deprecated')) return false;
        if (!name.includes('flash')) return false;
        if (name.includes('pro') || name.includes('ultra') || name.includes('thinking')) return false;
        return true;
    }).map((m: any) => m.name.replace('models/', ''));

    // Apply strict ranking
    const ranked: string[] = [];

    // Priority 1 & 2 & 3
    if (availableNames.includes('gemini-2.0-flash-001')) ranked.push('gemini-2.0-flash-001');
    if (availableNames.includes('gemini-2.0-flash')) ranked.push('gemini-2.0-flash');
    if (availableNames.includes('gemini-flash-latest')) ranked.push('gemini-flash-latest');

    // Priority 4: Other 2.0s
    availableNames.forEach((n: string) => {
        if (n.includes('2.0') && !ranked.includes(n)) ranked.push(n);
    });

    // Priority 5: 2.5 as last resort
    if (availableNames.includes('gemini-2.5-flash')) ranked.push('gemini-2.5-flash');

    const unique = [...new Set(ranked)];
    if (unique.length === 0) return fallbackList;

    console.log(`[ExtractWorker] Candidates: ${JSON.stringify(unique)}`);
    return unique;
}

async function callGemini(modelName: string, prompt: string, apiKey: string): Promise<any> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            response_mime_type: "application/json"
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const txt = await res.text();
        const err = new Error(`Gemini Error ${res.status}: ${txt}`);
        (err as any).status = res.status;
        throw err;
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("Empty response from Gemini");

    return JSON.parse(rawText);
}

// --- MAIN WORKER ---

Deno.serve(async (req) => {
    // CORS
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    let job_id: string | null = null;
    let attempts: ModelAttempt[] = [];
    let modelCandidates: string[] = [];
    let baseModel = "";
    let reason = "standard_success";
    const startTs = new Date();

    try {
        const body = await req.json();
        job_id = body.job_id;

        if (!job_id) {
            return new Response(JSON.stringify({ ok: false, message: 'Missing job_id' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        console.log(`[ExtractWorker] START Job: ${job_id}`);

        // 1. FETCH JOB & FILE & VALIDATE
        const { data: jobData, error: jobErr } = await supabase
            .from('import_jobs')
            .select('id, status, extraction_attempts, document_context')
            .eq('id', job_id)
            .maybeSingle();

        if (jobErr) throw new Error(`DB Job Error: ${jobErr.message}`);
        if (!jobData) throw new Error(`No job found for id: ${job_id}`);

        const currentAttempts = jobData.extraction_attempts || 0;

        const { data: files, error: fileErr } = await supabase
            .from('import_files')
            .select('id, extracted_text, extracted_completed_at, role')
            .eq('job_id', job_id);

        if (fileErr) throw new Error(`DB File Error: ${fileErr.message}`);
        if (!files || files.length === 0) throw new Error(`No file found for job_id: ${job_id}`);

        // LOGGING CANDIDATES
        const candidates = files.map(f => ({
            id: f.id,
            role: f.role,
            len: f.extracted_text ? f.extracted_text.length : 0
        }));
        console.log(`[ExtractWorker] Candidates: ${JSON.stringify(candidates)}`);

        // SELECTION LOGIC (Fallback Enabled Phase 3.1)
        // Rule: source_for_structure PREFERS synthetic, but falls back to analytic if synthetic empty.

        let structureSource = 'synthetic';
        const synthetic = files.find(f => f.role === 'synthetic');
        const analytic = files.find(f => f.role === 'analytic');

        let file = synthetic;

        // Validation
        if (!synthetic) {
            if (files.length === 1 && (!files[0].role || files[0].role === 'unknown')) {
                file = files[0];
                structureSource = 'single_unknown';
                console.log(`[ExtractWorker] Legacy job (1 file, unknown role), treating as synthetic: ${file.id}`);
            } else {
                throw new Error("Job missing mandatory 'synthetic' file.");
            }
        }

        const hasSyntheticText = file && file.extracted_text && file.extracted_text.length >= 50;

        if (!hasSyntheticText) {
            console.warn("[ExtractWorker] Synthetic file has NO TEXT. Checking Analytic fallback...");

            // Fallback Check
            const hasAnalyticText = analytic && analytic.extracted_text && analytic.extracted_text.length >= 50;

            if (hasAnalyticText) {
                console.warn(`[ExtractWorker] FALLBACK: Using ANALYTIC file ${analytic.id} for structure generation.`);
                file = analytic;
                structureSource = 'analytic_fallback';

                // Mark job metadata for UI/Audit
                await supabase.from('import_jobs').update({
                    document_context: {
                        ...(jobData.document_context || {}),
                        structure_source: 'analytic_fallback',
                        synthetic_missing_text: true,
                        fallback_file_id: analytic.id
                    }
                }).eq('id', job_id);

            } else {
                console.error("[ExtractWorker] FATAL: Neither Synthetic nor Analytic files have OCR text.");
                const msg = "Nenhum arquivo (Sintético ou Analítico) contém texto OCR válido para extração.";

                await safeUpdateImportFile(job_id, {
                    extraction_status: 'failed',
                    extraction_reason: 'all_files_ocr_missing',
                    extraction_last_error: msg,
                    extraction_completed_at: new Date().toISOString()
                });

                return new Response(JSON.stringify({
                    ok: false,
                    code: "OCR_TEXT_MISSING",
                    message: msg,
                    files_debug: candidates
                }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        } else {
            console.log(`[ExtractWorker] Selected SYNTHETIC file logic: ${file.id} (len=${file.extracted_text.length})`);
        }

        const rawText = file.extracted_text;
        const extracted_completed_at = file.extracted_completed_at;
        const extracted_text_len = rawText ? rawText.length : 0;

        // TELEMETRY: INIT
        // Better Chunking Strategy (Phase 2.2C)
        const CHUNK_SIZE = 14000;
        const chunks: string[] = [];

        if (CHUNK_BOUNDARY_BY_NEWLINE) {
            let start = 0;
            while (start < rawText.length) {
                let end = Math.min(start + CHUNK_SIZE, rawText.length);
                if (end < rawText.length) {
                    // Try to find newline to break on
                    const lastNewline = rawText.lastIndexOf('\n', end);
                    // Ensure we don't create a tiny chunk or go back too far (keep at least 50% of chunk size)
                    if (lastNewline > start + (CHUNK_SIZE * 0.5)) {
                        end = lastNewline + 1; // Include the newline
                    }
                }
                chunks.push(rawText.substring(start, end));
                start = end;
                if (chunks.length >= 35) { // Safety break
                    console.warn("[ExtractWorker] Max chunks 35 reached, stopping text split.");
                    break;
                }
            }
        } else {
            // Raw slicing
            for (let i = 0; i < rawText.length; i += CHUNK_SIZE) {
                chunks.push(rawText.substring(i, i + CHUNK_SIZE));
                if (chunks.length >= 35) break;
            }
        }

        console.log(`[ExtractWorker] Text Len: ${rawText.length} -> ${chunks.length} Chunks (BoundaryNewline=${CHUNK_BOUNDARY_BY_NEWLINE})`);

        await safeUpdateImportFile(job_id, {
            extraction_status: 'running',
            extraction_started_at: startTs.toISOString(),
            extraction_chunks_total: chunks.length,
            extraction_chunks_done: 0,
            extraction_items_inserted: 0,
            extraction_summary_saved: false,
            extraction_last_error: null,
            extraction_reason: null
        });

        await supabase.from('import_jobs').update({
            stage: 'gemini_running',
            heartbeat_at: new Date().toISOString(),
            last_error: null,
            extraction_attempts: currentAttempts + 1
        }).eq('id', job_id);

        // 4. MODEL DISCOVERY & PROBE
        modelCandidates = await getModelCandidates(GEMINI_API_KEY!);
        let allProbesFailed = true; // Phase 2.2E

        // Probe logic
        for (const candidate of modelCandidates) {
            const ts = new Date().toISOString();
            console.log(`[ExtractWorker] Probing ${candidate}...`);
            try {
                await callGemini(candidate, "Return {\"ok\":true}", GEMINI_API_KEY!);
                attempts.push({ model: candidate, phase: 'probe', ok: true, ts });
                baseModel = candidate;
                console.log(`[ExtractWorker] Probe Success. Base Model: ${baseModel}`);
                allProbesFailed = false;
                break;
            } catch (err: any) {
                console.warn(`[ExtractWorker] Probe Failed for ${candidate}: ${err.message}`);
                attempts.push({ model: candidate, phase: 'probe', ok: false, error: err.message, ts });
            }
        }

        // --- PHASE 2.2E: HANDLE TOTAL AI UNAVAILABILITY ---
        if (allProbesFailed) {
            console.warn("[ExtractWorker] All model probes failed. Handling as retryable availability error.");

            const msg = "All AI models unavailable during probe check.";
            const endTs = new Date();
            const durationMs = endTs.getTime() - startTs.getTime();

            const nextAttempt = currentAttempts + 1;
            const isRetryable = nextAttempt < MAX_EXTRACTION_ATTEMPTS;
            const backoffMin = getRetryBackoffMinutes(nextAttempt);
            const nextRetryAt = new Date(Date.now() + backoffMin * 60000).toISOString();

            // Log special stage
            console.log(JSON.stringify({
                stage: "model_probe_failed_all",
                attempts: nextAttempt,
                isRetryable,
                nextRetryAt,
                timestamp: endTs.toISOString()
            }));

            // Update File Status
            await safeUpdateImportFile(job_id, {
                extraction_status: isRetryable ? 'retryable' : 'failed',
                extraction_reason: 'ai_temporarily_unavailable',
                extraction_last_error: msg,
                extraction_completed_at: endTs.toISOString(),
                extraction_duration_ms: durationMs
            });

            // Update Job Status
            await supabase.from('import_jobs').update({
                stage: isRetryable ? 'ai_temporarily_unavailable' : 'failed',
                last_error: msg,
                extraction_retryable: isRetryable,
                extraction_next_retry_at: isRetryable ? nextRetryAt : null,
                extraction_last_reason: 'ai_temporarily_unavailable'
            }).eq('id', job_id);

            // Return HTTP 200 with ok:false, retryable:true (UX Improvement)
            return new Response(JSON.stringify({
                ok: false,
                reason: 'ai_temporarily_unavailable',
                retryable: isRetryable,
                next_retry_at: isRetryable ? nextRetryAt : null,
                message: msg
            }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        if (!baseModel) {
            throw new Error("Logic Error: BaseModel not set despite probe passing.");
        }

        // 6. IDEMPOTENCY
        await supabase.from('import_ai_items').delete().eq('job_id', job_id);
        await supabase.from('import_ai_summaries').delete().eq('job_id', job_id);

        // 7. PROCESSING LOOP (POOL or SERIAL)
        const chunkResults: ChunkResult[] = new Array(chunks.length);
        let itemsCountRunning = 0;
        let chunkWallStart = Date.now();
        let geminiMsTotal = 0;
        let parallelFallbackUsed = false;
        let parallelFallbackReason = null;
        let chunkSamples: any[] = [];

        // Helper to process a single chunk
        const processChunk = async (chunk: string, i: number, isReprocess = false): Promise<ChunkResult> => {
            const t0 = Date.now();
            const ts = new Date().toISOString();

            // STRICT PROMPT FOR REPROCESS
            const systemPrompt = isReprocess
                ? "You are a strict data extractor. Return JSON ONLY. No text."
                : "You are an expert construction budget analyzer.";

            const prompt = `
${systemPrompt}
Extract structured line items from the provided text chunk.

Rules:
1. Return APENAS VALID JSON. No Markdown. No comments.
2. Output Schema:
{
  "items": [{ "description": string, "unit": string | null, "quantity": number | null, "unit_price": number | null, "confidence": number }],
  "summary": string | null 
}
3. Ignore header repetitions.
4. Normalize numbers (1.234,50 -> 1234.50).
5. If no items found, return "items": [].

TEXT CHUNK:
"""
${chunk}
"""
            `;

            try {
                // Attempt 1
                let data = await callGemini(baseModel, prompt, GEMINI_API_KEY!);

                if (!data || (!data.items && !data.summary)) {
                    // Internal repair
                    if (!isReprocess) console.warn(`[ExtractWorker] Invalid JSON from ${baseModel}, retrying once...`);
                    data = await callGemini(baseModel, prompt + "\n\nIMPORTANT: Return valid JSON.", GEMINI_API_KEY!);
                }

                const items = data.items || [];
                const dur = Date.now() - t0;
                attempts.push({ model: baseModel, phase: isReprocess ? 'reprocess' : 'chunk', ok: true, ts });

                const status = (items.length === 0) ? 'empty' : 'ok';
                return {
                    index: i,
                    text: chunk,
                    success: true,
                    items: items,
                    summary: data.summary || null,
                    model_used: baseModel,
                    gemini_time_ms: dur,
                    status: status
                };

            } catch (err: any) {
                const dur = Date.now() - t0;
                // Retry if 429
                if (err.status === 429 || (err.message || "").includes('429')) {
                    console.warn(`[ExtractWorker] Rate Limit (429) for chunk ${i}. Backing off...`);
                    await new Promise(r => setTimeout(r, 1000));
                    try {
                        let data = await callGemini(baseModel, prompt, GEMINI_API_KEY!);
                        const items = data.items || [];
                        const dur2 = Date.now() - t0; // cumulative? actually should add
                        // simplificando: dur é usado no return original
                        attempts.push({ model: baseModel, phase: isReprocess ? 'reprocess' : 'chunk', ok: true, ts });
                        const status = (items.length === 0) ? 'empty' : 'ok';
                        return {
                            index: i,
                            text: chunk,
                            success: true,
                            items,
                            summary: data.summary,
                            model_used: baseModel,
                            gemini_time_ms: dur2,
                            status: status
                        };
                    } catch (retryErr: any) {
                        // fail total
                    }
                }

                console.error(`[ExtractWorker] Chunk ${i} failed on ${baseModel}: ${err.message}`);
                attempts.push({ model: baseModel, phase: isReprocess ? 'reprocess' : 'chunk', ok: false, error: err.message, ts });

                return {
                    index: i,
                    text: chunk,
                    success: false,
                    items: [],
                    summary: null,
                    model_used: baseModel,
                    gemini_time_ms: dur,
                    status: 'failed',
                    error_type: (err.status === 429) ? 'rate_limit' : 'unknown',
                    error_msg: err.message
                };
            }
        };

        const telemetryTicker = async () => {
            // Calculate done based on populated entries in results array
            const doneCount = chunkResults.filter(x => x !== undefined).length;
            let currentItems = 0;
            chunkResults.forEach(r => { if (r) currentItems += r.items.length; });

            // Update file progress
            await safeUpdateImportFile(job_id, {
                extraction_chunks_done: doneCount,
                extraction_items_inserted: currentItems
            });

            // Heartbeat for watchdog
            await supabase.from('import_jobs').update({
                heartbeat_at: new Date().toISOString()
            }).eq('id', job_id);
        };

        // Execution Logic
        if (PARALLEL_ENABLED) {
            console.log(`[ExtractWorker] Starting Parallel Pool (Concurrency: ${CHUNK_CONCURRENCY})`);

            let currentIndex = 0;
            const activePromises: Promise<void>[] = [];
            let failureCount = 0;
            let rateLimitCount = 0;

            while (currentIndex < chunks.length) {
                // Check health
                if (rateLimitCount >= 2 || (currentIndex > 3 && failureCount > (currentIndex * 0.5))) {
                    console.warn("[ExtractWorker] Parallel Fallback triggered: Too many failures/rate-limits.");
                    parallelFallbackUsed = true;
                    parallelFallbackReason = rateLimitCount >= 2 ? "rate_limit" : "high_failure_rate";
                    break;
                }

                if (activePromises.length < CHUNK_CONCURRENCY) {
                    const idx = currentIndex++;
                    const p = processChunk(chunks[idx], idx).then(res => {
                        chunkResults[idx] = res;
                        geminiMsTotal += res.gemini_time_ms;
                        if (!res.success) failureCount++;
                        // Rate limit check
                        const att = attempts.filter(a => a.phase === 'chunk' && !a.ok && a.ts > new Date(Date.now() - 10000).toISOString());
                        if (att.some(a => (a.error || "").includes('429'))) rateLimitCount++;

                        telemetryTicker();
                    });

                    const wrapper = p.then(() => {
                        activePromises.splice(activePromises.indexOf(wrapper), 1);
                    });
                    activePromises.push(wrapper);
                } else {
                    await Promise.race(activePromises);
                }
            }
            await Promise.all(activePromises);

            // If we broke out due to fallback, process remaining serially
            if (currentIndex < chunks.length) {
                console.log(`[ExtractWorker] Processing remaining ${chunks.length - currentIndex} chunks serially...`);
                for (let i = currentIndex; i < chunks.length; i++) {
                    const res = await processChunk(chunks[i], i);
                    chunkResults[i] = res;
                    geminiMsTotal += res.gemini_time_ms;
                    await telemetryTicker();
                }
            }

        } else {
            console.log("[ExtractWorker] Serial Processing (Default)...");
            for (let i = 0; i < chunks.length; i++) {
                const res = await processChunk(chunks[i], i);
                chunkResults[i] = res;
                geminiMsTotal += res.gemini_time_ms;

                if (i % 2 === 0 || i === chunks.length - 1) await telemetryTicker();
            }
        }

        // --- PHASE 2.2C: REPROCESS FAILED CHUNKS ---
        let reprocessAttempted = false;
        let reprocessSucceededCount = 0;
        // Phase 2.2D: Filter only TRUE failures (status='failed'), ignoring empty but successful chunks
        let failedChunksInitial = chunkResults.filter(r => r && r.status === 'failed').length;
        const reprocessStart = Date.now();

        if (ENABLE_FAILED_CHUNK_REPROCESS && failedChunksInitial > 0) {
            reprocessAttempted = true;
            console.log(`[ExtractWorker] Re-processing ${failedChunksInitial} failed chunks...`);

            for (let i = 0; i < chunkResults.length; i++) {
                const r = chunkResults[i];
                if (r && r.status === 'failed') {
                    console.log(`[ExtractWorker] Reprocessing Chunk ${i}...`);
                    const res = await processChunk(chunks[i], i, true);

                    if (res.success) {
                        console.log(`[ExtractWorker] Chunk ${i} RECOVERED! Status: ${res.status}`);
                        chunkResults[i] = res; // Replace failed result
                        reprocessSucceededCount++;
                    } else {
                        console.warn(`[ExtractWorker] Chunk ${i} failed again.`);
                    }
                    geminiMsTotal += res.gemini_time_ms;
                }
            }
        }

        const reprocessMs = Date.now() - reprocessStart;
        const failedChunksFinal = chunkResults.filter(r => r && r.status === 'failed').length;
        const emptyChunksCount = chunkResults.filter(r => r && r.status === 'empty').length;
        const chunkWallMs = Date.now() - chunkWallStart;

        // Sampling
        chunkResults.forEach((r, i) => {
            if (r) {
                if (chunks.length <= 10 || i < 5 || i >= chunks.length - 5) {
                    chunkSamples.push({
                        idx: r.index,
                        ok: r.success,
                        status: r.status,
                        gemini_ms: r.gemini_time_ms,
                        items: r.items.length,
                        phase: 'initial', // simplistic logging, overwrite if we could track phases better per chunk, but acceptable
                        error: r.error_msg
                    });
                }
            }
        });

        // 8. ESCALATION CHECK (Review based on NEW results)
        // Escalation only if ALL failed or consistently bad
        const chunksOk = chunkResults.filter(r => r && r.success).length;
        const needsEscalation = (chunksOk === 0) && (chunks.length > 2 || rawText.length > 30000);
        let finalModelUsed = baseModel;

        if (needsEscalation) {
            const model25 = modelCandidates.find(m => m.includes('2.5-flash'));
            if (model25 && model25 !== baseModel) {
                console.warn(`[ExtractWorker] ESCALATING to ${model25} due to quality failure.`);
                reason = "quality_escalation_chunks_failed";

                for (let i = 0; i < chunkResults.length; i++) {
                    const res = chunkResults[i];
                    if (res && !res.success) {
                        const ts2 = new Date().toISOString();
                        const prompt2 = `RETRY / HIGH REASONING MODE \n ${chunks[i]}`;
                        try {
                            const t0 = Date.now();
                            const data = await callGemini(model25, prompt2, GEMINI_API_KEY!);
                            geminiMsTotal += (Date.now() - t0);

                            res.success = true;
                            res.items = data.items || [];
                            res.summary = data.summary || null;
                            res.model_used = model25;
                            finalModelUsed = model25;
                            res.status = (res.items.length === 0) ? 'empty' : 'ok'; // Update status

                            attempts.push({ model: model25, phase: 'repair', ok: true, ts: ts2 });
                        } catch (err2: any) {
                            attempts.push({ model: model25, phase: 'repair', ok: false, error: err2.message, ts: ts2 });
                        }
                    }
                }
            } else {
                reason = "escalation_unavailable";
            }
        }

        // 9. AGGREGATE RESULTS
        const allItems: any[] = [];
        let consolidatedSummary = "";

        for (const r of chunkResults) {
            if (r && r.items && Array.isArray(r.items)) allItems.push(...r.items);
            if (r && r.summary) consolidatedSummary += (r.summary + "\n");
        }

        const endTs = new Date();
        const durationMs = endTs.getTime() - startTs.getTime();

        // 10. EMPTY HANDLING
        if (allItems.length === 0 && !consolidatedSummary) {
            const finalCheckOk = chunkResults.some(r => r && r.success);
            if (!finalCheckOk) {
                const errStr = "all_chunks_failed_technical";
                await safeUpdateImportFile(job_id, {
                    extraction_status: 'failed',
                    extraction_reason: errStr,
                    extraction_last_error: errStr,
                    extraction_completed_at: endTs.toISOString(),
                    extraction_duration_ms: durationMs,
                    extraction_chunks_done: chunks.length
                });
                await supabase.from('import_jobs').update({ stage: 'failed', last_error: errStr }).eq('id', job_id);
                return new Response(JSON.stringify({ ok: false, reason: errStr, job_id }), {
                    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            reason = "no_budget_items_found";
            await safeUpdateImportFile(job_id, {
                extraction_status: 'success_no_items',
                extraction_reason: reason,
                extraction_items_inserted: 0,
                extraction_summary_saved: false,
                extraction_completed_at: endTs.toISOString(),
                extraction_duration_ms: durationMs,
                extraction_chunks_done: chunks.length
            });
            return new Response(JSON.stringify({ ok: true, job_id, items_inserted: 0, summary_saved: false, reason }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // 11. PERSIST PROCESSED ITEMS
        const normalizedRows = allItems.map((item, idx) => ({
            job_id,
            import_file_id: file.id,
            idx: idx + 1,
            description: (item.description || "").trim(),
            unit: (item.unit || "").trim() || null,
            quantity: parseBRNumber(item.quantity) || 0,
            unit_price: parseBRNumber(item.unit_price) || 0,
            confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
            total: (parseBRNumber(item.quantity) || 0) * (parseBRNumber(item.unit_price) || 0)
        })).filter(r => r.description.length > 0);

        console.log(`[ExtractWorker] Persisting ${normalizedRows.length} items...`);

        // --- BATCH INSERT ---
        const dbStart = Date.now();
        let fallbackUsed = false;
        let dbBatches = 0;

        try {
            if (USE_BATCH_INSERT) {
                for (let i = 0; i < normalizedRows.length; i += BATCH_SIZE) {
                    const batch = normalizedRows.slice(i, i + BATCH_SIZE);
                    const { error } = await supabase.from('import_ai_items').insert(batch);
                    if (error) {
                        await new Promise(r => setTimeout(r, 200));
                        const { error: err2 } = await supabase.from('import_ai_items').insert(batch);
                        if (err2) throw new Error(`Batch insert failed: ${err2.message}`);
                    }
                    dbBatches++;
                }
            } else {
                const OLD_BATCH = 200;
                for (let i = 0; i < normalizedRows.length; i += OLD_BATCH) {
                    const batch = normalizedRows.slice(i, i + OLD_BATCH);
                    const { error } = await supabase.from('import_ai_items').insert(batch);
                    if (error) console.error("Batch error", error);
                    dbBatches++;
                }
            }
        } catch (err: any) {
            console.error(`[ExtractWorker] Batch Insert Failed. Enabling Fallback... Error: ${err.message}`);
            fallbackUsed = true;
            dbBatches = 0;
            const OLD_BATCH = 200;
            for (let i = 0; i < normalizedRows.length; i += OLD_BATCH) {
                const batch = normalizedRows.slice(i, i + OLD_BATCH);
                const { error } = await supabase.from('import_ai_items').insert(batch);
                if (error) console.error("Fallback error", error);
                dbBatches++;
            }
        }

        const dbEnd = Date.now();
        const dbInsertMs = dbEnd - dbStart;
        const avgBatchSize = dbBatches > 0 ? Math.round(normalizedRows.length / dbBatches) : 0;

        // 12. SUMMARY & AUDIT & PERF METRICS
        const summaryData = {
            job_id,
            import_file_id: file.id,
            notes: consolidatedSummary.trim(),
            items_count: normalizedRows.length,
            model_used: finalModelUsed,
            header: {
                model_used_final: finalModelUsed,
                model_base: baseModel,
                model_candidates: modelCandidates,
                model_selection_reason: reason,
                model_attempts: attempts,
                extraction_date: endTs.toISOString(),
                performance: {
                    use_batch_insert: USE_BATCH_INSERT,
                    batch_size: USE_BATCH_INSERT ? BATCH_SIZE : 200,
                    db_insert_ms_total: dbInsertMs,
                    db_insert_batches: dbBatches,
                    db_insert_avg_batch_size: avgBatchSize,
                    db_insert_fallback_used: fallbackUsed,
                    chunk_concurrency: CHUNK_CONCURRENCY,
                    parallel_enabled: PARALLEL_ENABLED,
                    parallel_fallback_used: parallelFallbackUsed,
                    parallel_fallback_reason: parallelFallbackReason,
                    chunk_wall_ms_total: chunkWallMs,
                    gemini_ms_total: geminiMsTotal,
                    chunks_ok: chunksOk,
                    chunks_failed: failedChunksFinal,
                    chunks_empty: emptyChunksCount,
                    chunk_samples: chunkSamples,
                    // Phase 2.2C metrics
                    failed_chunks_initial: failedChunksInitial,
                    failed_chunks_after_reprocess: failedChunksFinal,
                    reprocess_attempted: reprocessAttempted,
                    reprocess_succeeded_count: reprocessSucceededCount,
                    reprocess_ms_total: reprocessMs,
                    chunk_boundary_mode: CHUNK_BOUNDARY_BY_NEWLINE ? 'newline' : 'raw'
                }
            }
        };

        let savedSummary = false;
        try {
            const { error: sumErr } = await supabase.from('import_ai_summaries').upsert(summaryData);
            if (!sumErr) savedSummary = true;
            else throw sumErr;
        } catch (dbErr: any) {
            console.warn("[ExtractWorker] Summary upsert warning (fallback):", dbErr.message);
            const { model_used, ...safeData } = summaryData;
            const { error: fErr } = await supabase.from('import_ai_summaries').upsert(safeData);
            if (!fErr) savedSummary = true;
        }

        // Final Telemetry Success
        let finalReason = reason;
        if (failedChunksFinal > 0 && normalizedRows.length > 0) {
            // Partial Success ONLY if there are ACTUAL failures left
            finalReason = 'partial_extraction_chunks_failed';
        }

        await safeUpdateImportFile(job_id, {
            extraction_status: 'success',
            extraction_reason: finalReason,
            extraction_items_inserted: normalizedRows.length,
            extraction_summary_saved: savedSummary,
            extraction_completed_at: endTs.toISOString(),
            extraction_duration_ms: durationMs,
            extraction_chunks_done: chunks.length
        });

        // 13. FINISH
        await supabase.from('import_jobs').update({
            status: 'waiting_user',
            stage: 'success',
            stage_updated_at: endTs.toISOString(),
            extraction_retryable: false,
            extraction_next_retry_at: null,
            extraction_last_reason: 'standard_success'
        }).eq('id', job_id);

        return new Response(JSON.stringify({
            ok: true,
            job_id,
            model_used: finalModelUsed,
            chunks_total: chunks.length,
            items_inserted: normalizedRows.length,
            summary_saved: savedSummary
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (err: any) {
        console.error("[ExtractWorker] FATAL:", err);
        const endTs = new Date();
        const durationMs = endTs.getTime() - startTs.getTime();
        let errorMsg = err.message || "Unknown error";
        if (errorMsg.length > 500) errorMsg = errorMsg.substring(0, 500) + "...";

        if (job_id) {
            await safeUpdateImportFile(job_id, {
                extraction_status: 'failed',
                extraction_last_error: errorMsg,
                extraction_completed_at: endTs.toISOString(),
                extraction_duration_ms: durationMs,
                extraction_reason: 'technical_error'
            });
            await supabase.from('import_jobs').update({ stage: 'failed', last_error: err.message }).eq('id', job_id);
        }
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
})
