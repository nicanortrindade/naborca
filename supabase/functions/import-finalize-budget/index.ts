
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AnalyticReportParser } from './analyticParser.ts';

// Type shim for EdgeRuntime fire-and-forget
declare const EdgeRuntime: any;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    // Options handler...
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

        // Auth handling...
        // Auth & Client Setup
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return new Response(JSON.stringify({ ok: false, reason: 'missing_auth' }), { status: 401, headers: corsHeaders });

        const adminClient = createClient(supabaseUrl, supabaseServiceKey);
        let targetUserId: string | null = null;

        // Check for Service Role Bypass
        const token = authHeader.replace(/^Bearer\s+/, '');
        const isServiceRole = token === supabaseServiceKey || req.headers.get('x-internal-call') === 'true';

        if (isServiceRole) {
            console.log("FINALIZE_BUDGET_AUTH=service_role");
        } else {
            // Standard User Auth
            const authClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
            const { data: { user }, error: authError } = await authClient.auth.getUser();

            if (authError || !user) {
                return new Response(JSON.stringify({ ok: false, reason: 'unauthorized', details: authError?.message }), { status: 403, headers: corsHeaders });
            }
            targetUserId = user.id;
        }

        const body = await req.json();
        const {
            job_id, uf, competence, desonerado, bdi_mode, social_charges,
            enable_structure_parser_v1, bdi_equipamentos, obra_nome,
            municipio, bases_selecionadas, bdi_rates, bdi_especial
        } = body;
        console.log('[FINALIZE] body received:', JSON.stringify({
            bdi_mode: body.bdi_mode,
            bdi_rates: body.bdi_rates,
            bdi_equipamentos: body.bdi_equipamentos,
            bdi_especial: body.bdi_especial,
            social_charges: body.social_charges
        }));
        const force_rehydrate = body?.force_rehydrate === true;

        // Resolve User ID if Service Mode (Bypass)
        if (!targetUserId) {
            const { data: jobInfo, error: jobError } = await adminClient
                .from('import_jobs')
                .select('user_id')
                .eq('id', job_id)
                .single();

            if (jobError || !jobInfo) {
                console.error(`[FinalizeBudget] Failed to resolve user for job ${job_id}:`, jobError);
                return new Response(JSON.stringify({ ok: false, reason: 'job_user_resolution_failed' }), { status: 403, headers: corsHeaders });
            }
            targetUserId = jobInfo.user_id;
        }

        // Early return: job já foi finalizado anteriormente
        const { data: jobCheck } = await adminClient
            .from('import_jobs')
            .select('result_budget_id, stage')
            .eq('id', job_id)
            .single();

        if (jobCheck?.result_budget_id) {
            if (!force_rehydrate) {
                if (jobCheck.stage === 'pending_hydration') {
                    console.log('[FINALIZE] Reprocessando budget existente com novos params');
                } else if (jobCheck.stage === 'finalized') {
                    console.log(`[FinalizeBudget] Job já finalizado (${jobCheck.result_budget_id}, stage=${jobCheck.stage}), retornando existente sem reprocessar.`);
                    return new Response(JSON.stringify({
                        ok: true,
                        budget_id: jobCheck.result_budget_id,
                        already_finalized: true
                    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
                } else {
                    console.log(`[FinalizeBudget] Job já tem budget (${jobCheck.result_budget_id}, stage=${jobCheck.stage}), retornando existente.`);
                    return new Response(JSON.stringify({
                        ok: true,
                        budget_id: jobCheck.result_budget_id,
                        already_finalized: true
                    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
                }
            } else {
                console.log(`[FinalizeBudget] force_rehydrate=true, reconstruindo budget: ${jobCheck.result_budget_id}`);
            }
        }

        // GUARD: só finaliza se todos os batches foram processados
        const { data: batchGuardData } = await adminClient
            .from('import_files')
            .select('metadata')
            .eq('job_id', job_id)
            .eq('doc_role', 'synthetic')
            .single();

        const stageB = batchGuardData?.metadata?.stageB;
        const totalBatches = stageB?.total_batches ?? 0;
        const lastBatch = stageB?.last_persisted_batch_index ?? -1;
        // PRIORITY GUARD: Se já existem itens extraídos, ignoramos o check de batches
        const { count: itemsCount } = await adminClient
            .from('import_ai_items')
            .select('*', { count: 'exact', head: true })
            .eq('job_id', job_id);

        const allBatchesDone = (itemsCount && itemsCount > 0) || (totalBatches > 0 && lastBatch >= totalBatches - 1);

        if (!allBatchesDone) {
            console.warn(`[FinalizeBudget] GUARD BLOCKED: lastBatch=${lastBatch}, totalBatches=${totalBatches}, job=${job_id}`);
            return new Response(JSON.stringify({
                ok: false,
                reason: 'batches_not_complete',
                details: { lastBatch, totalBatches }
            }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        console.log(`[FinalizeBudget] GUARD PASSED: itemsCount=${itemsCount}, lastBatch=${lastBatch}, totalBatches=${totalBatches}`);


        console.log(`[FinalizeBudget] Job: ${job_id} | Settings: ${uf}/${competence} | StructureV1: ${enable_structure_parser_v1}`);

        // Admin Client available (adminClient)

        // Problem 2 Fix: TS is for Parsing Only. Logic is in SQL.
        let analyticData: Record<string, unknown> = {};

        // Fetch Analytic File content
        const { data: analyticFiles } = await adminClient
            .from('import_files')
            .select('extracted_text')
            .eq('job_id', job_id)
            .eq('doc_role', 'analytical')   // valor correto no banco de dados
            .limit(1);

        if (analyticFiles?.[0]?.extracted_text) {
            try {
                analyticData = AnalyticReportParser.parse(analyticFiles[0].extracted_text);
                console.log(`[FinalizeBudget] Parsed ${Object.keys(analyticData).length} compositions for SQL consumption.`);
            } catch (parseErr) {
                console.warn(`[FinalizeBudget] AnalyticReportParser failed, continuing without analytic data:`, parseErr);
                analyticData = {};
            }
        }

        // Call RPC
        const params = {
            uf: uf || 'BA',
            competence: competence,
            desonerado: desonerado === true,
            bdi_mode: bdi_mode,
            social_charges: social_charges,
            enable_structure_parser_v1: enable_structure_parser_v1 === true,
            bdi_equipamentos,
            bdi_rates,
            bdi_especial,
            obra_nome,
            municipio,
            bases_selecionadas
        };
        console.log('[FINALIZE] params to SQL:', JSON.stringify({
            bdi_mode: params.bdi_mode,
            bdi_rates: params.bdi_rates,
            bdi_equipamentos: params.bdi_equipamentos,
            bdi_especial: params.bdi_especial
        }));

        // Dispara RPC de forma assíncrona (fire-and-forget) para evitar timeout da Edge Function
        EdgeRuntime.waitUntil(
            (async () => {
                try {
                    // PRE-RPC GUARD: verify no budget was created between the initial check and now
                    const { data: preCheck } = await adminClient
                        .from('import_jobs')
                        .select('result_budget_id, stage')
                        .eq('id', job_id)
                        .single();
                    if (preCheck?.result_budget_id && preCheck.stage !== 'pending_hydration' && !force_rehydrate) {
                        console.log(`[FinalizeBudget] Budget already exists (${preCheck.result_budget_id}, stage=${preCheck.stage}), skipping RPC.`);
                        return;
                    }

                    const rpcResult = await adminClient.rpc('finalize_import_to_budget', {
                        p_job_id: job_id,
                        p_user_id: targetUserId,
                        p_params: params,
                        p_analytic_data: analyticData
                    });

                    const rpcData = rpcResult.data;
                    const rpcError = rpcResult.error;

                    if (rpcError) {
                        console.error(`[FinalizeBudget] RPC error:`, rpcError.message);
                        return;
                    }

                    if (!rpcData || rpcData.ok === false) {
                        console.error(`[FinalizeBudget] RPC returned false:`, rpcData?.reason);
                        return;
                    }

                    console.log(`[FinalizeBudget] RPC concluído: budget_id=${rpcData.budget_id}, stage=${rpcData.stage}`);

                    // Disparar hydration-worker após RPC concluir
                    if (rpcData.budget_id) {
                        const hydrationPayload = {
                            budget_id: rpcData.budget_id,
                            job_id: job_id,
                            user_id: targetUserId,
                            uf: params.uf,
                            competence: params.competence,
                            desonerado: params.desonerado
                        };

                        console.log(`[FinalizeBudget] Dispatching hydration-worker for budget ${rpcData.budget_id}`);

                        await fetch(`${supabaseUrl}/functions/v1/hydration-worker`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${supabaseServiceKey}`,
                                'Content-Type': 'application/json',
                                'x-internal-call': 'true'
                            },
                            body: JSON.stringify(hydrationPayload)
                        }).catch((err: any) => {
                            console.error('[FinalizeBudget] Failed to dispatch hydration-worker:', err?.message);
                        });
                    }
                } catch (err: any) {
                    console.error('[FinalizeBudget] Async RPC failed:', err?.message);
                }
            })()
        );

        // Retorna imediatamente sem esperar o RPC
        return new Response(JSON.stringify({ ok: true, status: 'processing', job_id: job_id }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });


    } catch (error: any) {
        console.error(`[FinalizeBudget] Error:`, error);
        return new Response(JSON.stringify({ ok: false, reason: 'internal_error', details: error.message }), { status: 500, headers: corsHeaders });
    }
})
