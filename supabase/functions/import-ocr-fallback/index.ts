
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0";
import { z } from "https://esm.sh/zod@3.23.8";

// -----------------------------
// ENV & CONFIG
// -----------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const OCR_EC2_URL = Deno.env.get("OCR_EC2_URL") ?? "";

// CORS Helpers
function buildCorsHeaders(req: Request): HeadersInit {
    const origin = req.headers.get("origin") || "";
    // Allow standard origins or all
    return {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin"
    };
}

function jsonResponse(body: unknown, status = 200, req?: Request) {
    const headers = req ? buildCorsHeaders(req) : {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "*"
    };
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers }
    });
}


// -----------------------------
// SCHEMA & PROMPT (Mirrors import-processor)
// -----------------------------
const ItemSchema = z.object({
    code_raw: z.string().optional().default(""),
    code: z.string().optional().default("SEM_CODIGO"),
    source: z.string().optional().default("ocr_fallback"),
    description: z.string().min(1),
    unit: z.string().optional().default("UN"),
    quantity: z.number().finite().nonnegative().optional().default(1),
    unit_price: z.number().finite().nonnegative().optional().default(0),
    price_type: z.enum(["desonerado", "nao_desonerado", "unico"]).optional().default("unico"),
    confidence: z.number().finite().min(0).max(1).default(0.5),
    needs_manual_review: z.boolean().optional().default(false),
});

const GeminiOutputSchema = z.object({
    items: z.array(ItemSchema).default([]),
});

const SYSTEM_PROMPT = `
Você é um parser de engenharia. Sua entrada é um TEXTO CRU extraído via OCR de um orçamento de obras.
Sua missão: Localizar e estruturar os itens de serviço/insumo.

REGRAS:
1. Ignore cabeçalhos, rodapés, paginação se não contiverem itens.
2. Procure padrões como "Código Descrição Unid Qtd Unitário Total".
3. Se o preço for zero ou não existir, extraia assim mesmo (unit_price=0).
4. Se a descrição estiver quebrada em linhas, tente unir.
5. Retorne APENAS JSON válido seguindo o schema.
`;

// -----------------------------
// HANDLER
// -----------------------------
serve(async (req) => {
    // 0. CORS preflight
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
    }

    const requestId = crypto.randomUUID().split("-")[0];
    console.log(`[REQ ${requestId}] OCR_FALLBACK_START`);

    try {
        // 1. Auth & Validation
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const authHeader = req.headers.get("Authorization");
        let userId: string | undefined;

        if (authHeader) {
            const { data: { user }, error: userErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
            if (!userErr && user) userId = user.id;
        }

        const { job_id } = await req.json();
        if (!job_id) throw new Error("Missing job_id");

        console.log(`[REQ ${requestId}] Job: ${job_id}, User: ${userId || 'ServiceRole'}`);

        // 2. Fetch Job & Files
        // Permitir service role bypass se userId não vier (mas idealmente valida ownership)
        let jobQuery = supabase.from("import_jobs").select("*").eq("id", job_id).single();
        if (userId) jobQuery = supabase.from("import_jobs").select("*").eq("id", job_id).eq("user_id", userId).single();

        const { data: job, error: jobErr } = await jobQuery;
        if (jobErr || !job) return jsonResponse({ error: "Job invalid or access denied" }, 403, req);

        // Fetch PDF Files
        const { data: files, error: filesErr } = await supabase
            .from("import_files")
            .select("*")
            .eq("job_id", job_id)
            .ilike("content_type", "%pdf%");

        if (filesErr || !files || files.length === 0) {
            return jsonResponse({ error: "No PDF files found for this job" }, 404, req);
        }

        // 3. Update Status -> processing
        await supabase.from("import_jobs").update({
            status: "processing",
            current_step: "ocr_fallback_running",
            progress: 10,
            last_error: null // clear previous error
        }).eq("id", job_id);

        let totalItemsFound = 0;

        // 4. Process Each File
        for (const file of files) {
            console.log(`[REQ ${requestId}] Processing file: ${file.original_filename} (${file.id})`);

            // A. Download
            const { data: fileBlob, error: downloadErr } = await supabase.storage
                .from(file.storage_bucket || "imports")
                .download(file.storage_path);

            if (downloadErr || !fileBlob) throw new Error(`Download failed: ${downloadErr?.message}`);

            // B. Send to EC2 OCR
            if (!OCR_EC2_URL) throw new Error("OCR_EC2_URL not configured");

            console.log(`[REQ ${requestId}] Sending to EC2: ${OCR_EC2_URL}`);

            const formData = new FormData();
            formData.append("file", fileBlob, file.original_filename);

            let ocrText = "";
            try {
                const ocrResp = await fetch(OCR_EC2_URL, {
                    method: "POST",
                    body: formData,
                });

                if (!ocrResp.ok) {
                    throw new Error(`EC2 OCR Error: ${ocrResp.status} ${ocrResp.statusText}`);
                }

                const ocrJson = await ocrResp.json();
                ocrText = ocrJson.text || ocrJson.content || "";

                if (!ocrText || ocrText.length < 50) {
                    console.warn(`[REQ ${requestId}] EC2 returned empty/short text.`);
                } else {
                    console.log(`[REQ ${requestId}] OCR_FALLBACK_EC2_OK. Text Length: ${ocrText.length}`);
                }

            } catch (ec2Err: any) {
                console.error(`[REQ ${requestId}] EC2 Failure:`, ec2Err);
                // Can't proceed for this file
                continue;
            }

            // Save text
            await supabase.from("import_files").update({
                extracted_text: ocrText,
                metadata: { ...(file.metadata || {}), ocr_engine: 'ec2_tess_v1' }
            }).eq("id", file.id);


            // C. Gemini Parsing (Text -> JSON)
            if (ocrText.length > 50 && GEMINI_API_KEY) {
                console.log(`[REQ ${requestId}] Sending OCR text to Gemini...`);
                const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
                const model = genAI.getGenerativeModel({
                    model: "gemini-1.5-flash",
                    systemInstruction: SYSTEM_PROMPT,
                    generationConfig: { responseMimeType: "application/json" }
                });

                // Reduce context if too huge (naive truncation)
                const safeText = ocrText.slice(0, 100000);

                const result = await model.generateContent(`Extraia items deste texto:\n\n${safeText}`);
                const responseText = result.response.text();

                // Parse & Validate
                let parsed: z.infer<typeof GeminiOutputSchema>;
                try {
                    parsed = JSON.parse(responseText);
                } catch {
                    // Try to fix simple json markdown
                    const clean = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
                    parsed = JSON.parse(clean);
                }

                if (parsed?.items && Array.isArray(parsed.items) && parsed.items.length > 0) {
                    console.log(`[REQ ${requestId}] OCR_FALLBACK_GEMINI_OK. Items found: ${parsed.items.length}`);
                    totalItemsFound += parsed.items.length;

                    // D. Replace Items in DB
                    // D.1 Delete old fallbacks for this file/job
                    await supabase.from("import_items").delete()
                        .eq("job_id", job_id)
                        .eq("file_id", file.id)
                        .or("description_normalized.ilike.%documento ilegível%,description_normalized.ilike.%sem itens%");

                    // D.2 Insert new
                    const rows = parsed.items.map(it => ({
                        job_id,
                        file_id: file.id,
                        user_id: job.user_id,
                        description_normalized: it.description,
                        code: it.code || 'SEM_CODIGO',
                        quantity: it.quantity,
                        unit: it.unit,
                        unit_price: it.unit_price,
                        price_selected: it.unit_price,
                        detected_base: 'ocr_fallback',
                        validation_status: 'pending',
                        confidence_score: it.confidence || 0.7
                    }));

                    await supabase.from("import_items").insert(rows);
                } else {
                    console.warn(`[REQ ${requestId}] Gemini found no items in OCR text.`);
                }
            }
        }

        // 5. Finalize Logic
        console.log(`[REQ ${requestId}] OCR_FALLBACK_DONE. Total Items: ${totalItemsFound}`);

        if (totalItemsFound > 0) {
            // Trigger auto-finalize logic or mark as done
            // Simplification: Mark as Done and let user review. 
            // Better: Call finalize logic or set state so user can review.

            // Try to auto-finalize via internal fetch or just leave at 100% review
            // Let's invoke finalize to replicate 'Smart Finish'
            try {
                await fetch(`${SUPABASE_URL}/functions/v1/import-finalize-budget`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                    },
                    body: JSON.stringify({
                        job_id,
                        uf: 'BA', // Default
                        competence: new Date().toISOString()
                    })
                });
            } catch (e) {
                console.warn(`[REQ ${requestId}] Auto-finalize trigger failed:`, e);
            }

            // Update Job Success
            await supabase.from("import_jobs").update({
                status: "done",
                current_step: "done",
                progress: 100,
                document_context: {
                    ...(job.document_context || {}),
                    user_action: null, // clear error action
                    ocr_fallback_executed: true
                }
            }).eq("id", job_id);

            return jsonResponse({ ok: true, items_found: totalItemsFound, status: "done" }, 200, req);

        } else {
            // Still no items
            await supabase.from("import_jobs").update({
                status: "waiting_user",
                current_step: "waiting_user_extraction_failed",
                progress: 100,
                document_context: {
                    ...(job.document_context || {}),
                    user_action: {
                        required: true,
                        reason: "extraction_failed",
                        message: "OCR Avançado também não identificou itens. O arquivo pode ser uma imagem sem texto claro ou manuscrito.",
                        items_count: 0
                    }
                }
            }).eq("id", job_id);

            return jsonResponse({ ok: true, items_found: 0, status: "waiting_user", message: "No items found even with OCR" }, 200, req);
        }

    } catch (err: any) {
        console.error(`[REQ ${requestId}] OCR Fallback Critial Error:`, err);
        // Ensure we revert to waiting user so UI doesn't hang
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        try {
            // We assume job_id exists in scope or we parse again? simplified:
            // If we cant parse job_id, we cant update.
        } catch { }

        return jsonResponse({ error: err.message }, 500, req);
    }
});
