
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AnalyticReportParser } from './analyticParser.ts';

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
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return new Response(JSON.stringify({ ok: false, reason: 'missing_auth' }), { status: 401, headers: corsHeaders });

        const authClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (authError || !user) return new Response(JSON.stringify({ ok: false, reason: 'unauthorized' }), { status: 403, headers: corsHeaders });

        const body = await req.json();
        const { job_id, uf, competence, desonerado, bdi_mode, social_charges } = body;

        console.log(`[FinalizeBudget] Job: ${job_id} | Settings: ${uf}/${competence}`);

        // Admin Client
        const adminClient = createClient(supabaseUrl, supabaseServiceKey);

        // Problem 2 Fix: TS is for Parsing Only. Logic is in SQL.
        let analyticData = {};

        // Fetch Analytic File content
        const { data: analyticFiles } = await adminClient
            .from('import_files')
            .select('extracted_text')
            .eq('job_id', job_id)
            .eq('role', 'analytic')
            .limit(1);

        if (analyticFiles?.[0]?.extracted_text) {
            // Problem 3 Fix: Parser returns strictly typed Contract
            analyticData = AnalyticReportParser.parse(analyticFiles[0].extracted_text);
            console.log(`[FinalizeBudget] Parsed ${Object.keys(analyticData).length} compositions for SQL consumption.`);
        }

        // Call RPC
        const params = {
            uf: uf || 'BA',
            competence: competence,
            desonerado: desonerado === true,
            bdi_mode: bdi_mode,
            social_charges: social_charges
        };

        const { data: rpcData, error: rpcError } = await adminClient.rpc('finalize_import_to_budget', {
            p_job_id: job_id,
            p_user_id: user.id,
            p_params: params,
            p_analytic_data: analyticData
        });

        if (rpcError) throw rpcError;

        return new Response(JSON.stringify(rpcData), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error(`[FinalizeBudget] Error:`, error);
        return new Response(JSON.stringify({ ok: false, reason: 'internal_error', details: error.message }), { status: 500, headers: corsHeaders });
    }
})
