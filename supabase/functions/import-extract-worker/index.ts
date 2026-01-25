
import { createClient } from 'jsr:@supabase/supabase-js@2'

// Configuration & Headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

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

// Helpers
function parseBRNumber(value: any): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;

    // Cleanup string " 1.234,56 " -> "1234.56"
    let clean = value.trim();
    if (!clean) return null;

    // Remove symbols
    clean = clean.replace(/[R$\s]/g, '');

    // Handle "1.000,00" format
    if (clean.includes(',') && clean.includes('.')) {
        clean = clean.replace(/\./g, '').replace(',', '.');
    } else if (clean.includes(',')) {
        clean = clean.replace(',', '.');
    }

    const parsed = parseFloat(clean);
    return isNaN(parsed) ? null : parsed;
}

function normalizeItem(item: any, idx: number) {
    return {
        description: (item.description || item.discriminacao || '').trim(), // Flexible keys
        unit: (item.unit || item.unidade || '').trim() || null,
        quantity: parseBRNumber(item.quantity || item.quantidade || item.qtd),
        unit_price: parseBRNumber(item.unit_price || item.valor_unitario || item.preco_unitario),
        total: parseBRNumber(item.total || item.valor_total),
        category: (item.category || item.categoria || '').trim() || null,
        confidence: typeof item.confidence === 'number' ? item.confidence : null,
        idx
    };
}

// Main Handler
Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const { job_id } = await req.json();

    if (!job_id) {
        return new Response(JSON.stringify({ status: 'failed', message: 'Missing job_id' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
    }

    // Use a transactional-like steps approach
    try {
        console.log(`[ExtractWorker] START Job: ${job_id}`);

        // CONFIG CHECK
        if (!SUPABASE_SERVICE_ROLE_KEY) {
            throw new Error('Server misconfiguration: missing service role key');
        }

        // 1. FETCH FILE
        const { data: file, error: fileError } = await supabase
            .from('import_files')
            .select('id, extracted_text, extracted_completed_at, extracted_json')
            .eq('job_id', job_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (fileError) throw new Error(`DB Error fetching file: ${fileError.message}`);
        if (!file) throw new Error(`No file found for job ${job_id}`);

        // IDEMPOTENCY CHECK
        // Allow re-run if explicitly requested (usually handled by frontend logic calling again)
        // But if already done recently (< 1 min?), maybe skip? For now, we allow overwrite (re-extraction).
        if (file.extracted_completed_at && file.extracted_json) {
            console.log(`[ExtractWorker] Re-running extraction for File ${file.id}`);
        }

        if (!file.extracted_text || file.extracted_text.length < 50) {
            await supabase.from('import_jobs').update({ stage: 'waiting_user', last_error: 'Text too short' }).eq('id', job_id);
            return new Response(JSON.stringify({ status: 'waiting_user', message: 'Text too short/empty' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // SET RUNNING STATE
        const { error: jobUpdateError } = await supabase.from('import_jobs').update({
            stage: 'gemini_running',
            heartbeat_at: new Date().toISOString(),
            last_error: null
        }).eq('id', job_id);
        if (jobUpdateError) throw new Error(`Failed to update job state: ${jobUpdateError.message}`);

        // 2. CHUNKING
        const text = file.extracted_text;
        const CHUNK_SIZE = 12000;
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += (CHUNK_SIZE - 500)) {
            chunks.push(text.substring(i, i + CHUNK_SIZE));
            if (chunks.length >= 12) break; // Hard limit
        }
        console.log(`[ExtractWorker] Created ${chunks.length} chunks (Text Len: ${text.length})`);

        // 3. GEMINI PROCESSING
        const allRawItems: any[] = [];
        let finalHeader = {};
        let finalTotals = {};
        let consolidatedNotes = "";

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(`[ExtractWorker] Gemini Request Chunk ${i + 1}/${chunks.length}`);

            const prompt = `
          Extract structured data from this construction budget (Orçamento de Obras) text.
          Output strict JSON using this schema:
          {
            "header": { "cliente": string|null, "obra": string|null, "data": string|null, "fornecedor": string|null },
            "totals": { "subtotal": number|null, "total": number|null },
            "items": [
               { "description": string, "unit": string|null, "quantity": number|null, "unit_price": number|null, "total": number|null }
            ],
            "notes": string|null
          }
          Notes:
          - Focus on line items with Description, Unit, Qty, Unit Price, Total.
          - Use null for missing fields. 
          - Convert "1.234,56" to 1234.56.
          - Ignore headers/footers repeated in text.
          ${i === 0 ? "- Prioritize Header/Totals extraction." : "- Prioritize Items."}  

          Text: """${chunk}"""
        `;

            try {
                const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { response_mime_type: "application/json" }
                    })
                });

                if (!resp.ok) {
                    const txt = await resp.text();
                    console.error(`[ExtractWorker] Gemini Fail Chunk ${i}: ${resp.status} - ${txt}`);
                    continue; // Skip chunk but try to continue
                }

                const jsonExp = await resp.json();
                const rawText = jsonExp.candidates?.[0]?.content?.parts?.[0]?.text;

                if (rawText) {
                    const parsed = JSON.parse(rawText);
                    if (parsed.items && Array.isArray(parsed.items)) allRawItems.push(...parsed.items);
                    if (i === 0) {
                        finalHeader = parsed.header || {};
                        finalTotals = parsed.totals || {};
                    } else if (!finalTotals || Object.keys(finalTotals).length === 0) {
                        if (parsed.totals) finalTotals = parsed.totals;
                    }
                    if (parsed.notes) consolidatedNotes += (parsed.notes + "\n");
                }
            } catch (geminiErr) {
                console.error(`[ExtractWorker] Chunk ${i} processing error:`, geminiErr);
            }
        }

        console.log(`[ExtractWorker] Gemini finished. Total raw items found: ${allRawItems.length}`);

        if (allRawItems.length === 0 && (!finalTotals || Object.keys(finalTotals).length === 0)) {
            // Nothing found
            await supabase.from('import_jobs').update({ stage: 'waiting_user', last_error: 'No structure found by AI' }).eq('id', job_id);
            return new Response(JSON.stringify({ status: 'waiting_user', message: 'AI could not find items', items_count: 0 }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // 4. NORMALIZE & DEDUPE
        const normalizedItems = [] as any[];
        const seen = new Set();
        let validCount = 0;

        allRawItems.forEach(raw => {
            if (!raw.description) return; // Skip invalid
            const norm = normalizeItem(raw, 0); // idx set later

            // Basic dedupe key
            const key = `${norm.description.substring(0, 30)}_${norm.total}_${norm.quantity}`;
            if (seen.has(key)) return;
            seen.add(key);

            // Assign clean idx
            norm.idx = ++validCount;
            normalizedItems.push(norm);
        });

        console.log(`[ExtractWorker] Normalized items count: ${normalizedItems.length}`);

        // 5. TRANSACTIONAL PERSISTENCE (Fail Hard)

        // A. Delete Old Items (public.import_ai_items)
        console.log('[ExtractWorker] Deleting old items...');
        const { error: delError } = await supabase.from('import_ai_items').delete().eq('job_id', job_id);
        if (delError) throw new Error(`Delete failed: ${delError.message}`);

        // B. Upsert Summary (public.import_ai_summaries)
        console.log('[ExtractWorker] Upserting summary...');
        const summaryPayload = {
            job_id,
            import_file_id: file.id,
            header: finalHeader,
            totals: finalTotals,
            notes: consolidatedNotes.trim(),
            items_count: normalizedItems.length,
            updated_at: new Date().toISOString()
        };
        const { error: sumError } = await supabase.from('import_ai_summaries').upsert(summaryPayload);
        if (sumError) throw new Error(`Summary upsert failed: ${sumError.message}`);

        // C. Insert Items Batch
        if (normalizedItems.length > 0) {
            console.log(`[ExtractWorker] Inserting ${normalizedItems.length} items...`);

            // Map to DB columns
            const rows = normalizedItems.map(item => ({
                job_id,
                import_file_id: file.id,
                idx: item.idx,
                description: item.description,
                unit: item.unit,
                quantity: item.quantity,
                unit_price: item.unit_price,
                total: item.total,
                category: item.category,
                confidence: item.confidence
            }));

            // Batch 200
            for (let i = 0; i < rows.length; i += 200) {
                const batch = rows.slice(i, i + 200);
                const { error: insError } = await supabase.from('import_ai_items').insert(batch);
                if (insError) throw new Error(`Items insert failed (batch ${i}): ${insError.message} - ${insError.details}`);
            }
        }

        // D. Finalize File & Job
        console.log('[ExtractWorker] Finalizing job status...');

        // Update File
        const { error: fileUpError } = await supabase.from('import_files').update({
            extracted_json: { header: finalHeader, totals: finalTotals, items_count: normalizedItems.length },
            extracted_completed_at: new Date().toISOString()
        }).eq('id', file.id);
        if (fileUpError) throw new Error(`File update failed: ${fileUpError.message}`);

        // Update Job
        const { error: jobFinError } = await supabase.from('import_jobs').update({
            stage: 'success',
            stage_updated_at: new Date().toISOString(),
            last_error: null
        }).eq('id', job_id);
        if (jobFinError) throw new Error(`Job finalize failed: ${jobFinError.message}`);

        // SUCCESS
        console.log('[ExtractWorker] DONE SUCCESS');
        return new Response(JSON.stringify({
            status: 'success',
            items_count: normalizedItems.length,
            message: 'Extraction completed and persisted.'
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } catch (err: any) {
        console.error('[ExtractWorker] FATAL:', err);

        // Best-effort failure record
        await supabase.from('import_jobs').update({
            stage: 'failed',
            last_error: err.message?.substring(0, 500)
        }).eq('id', job_id);

        return new Response(JSON.stringify({
            status: 'failed',
            message: err.message,
            error: err.toString()
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
    }
})
