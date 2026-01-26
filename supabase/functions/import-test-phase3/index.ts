
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const adminClient = createClient(supabaseUrl, supabaseKey);

        const report: any[] = [];
        const log = (step: string, data: any) => report.push({ step, data });

        log('INIT', 'Starting Phase 3 Test via Edge Function');

        // --- STEP A: Find Job Candidate ---
        const { data: jobs, error: errA } = await adminClient
            .from('import_ai_items')
            .select('job_id')
            .limit(50)
            .order('created_at', { ascending: false });

        if (errA) throw new Error(`Step A failed: ${errA.message}`);

        // Get unique job_ids to check ownership
        const jobIds = [...new Set(jobs?.map(j => j.job_id))];
        let candidateJobId = null;
        let candidateUserId = null;
        let itemCount = 0;

        for (const jid of jobIds) {
            const { data: jobInfo } = await adminClient.from('import_jobs').select('user_id').eq('id', jid).single();
            if (jobInfo && jobInfo.user_id) {
                const { count } = await adminClient.from('import_ai_items').select('*', { count: 'exact', head: true }).eq('job_id', jid);
                if (count && count > 0) {
                    candidateJobId = jid;
                    candidateUserId = jobInfo.user_id;
                    itemCount = count;
                    break;
                }
            }
        }

        if (!candidateJobId) throw new Error("No candidate job found with items and valid user.");

        log('STEP_A', { candidateJobId, candidateUserId, itemCount });

        // --- STEP B: Happy Path RPC ---
        // The RPC expects p_user_id. The check inside RPC verifies ownership.
        // If we call as admin, we just pass the user_id we found.
        const { data: rpcRes, error: rpcErr } = await adminClient.rpc('finalize_import_to_budget', {
            p_job_id: candidateJobId,
            p_user_id: candidateUserId
        });

        if (rpcErr) throw new Error(`Step B RPC failed: ${rpcErr.message}`);
        log('STEP_B', rpcRes);

        const budgetId = rpcRes.budget_id;
        if (!budgetId) throw new Error("RPC returned success but no budget_id");

        // --- STEP C: Verification ---
        // C1: Budget
        const { data: budget } = await adminClient.from('budgets').select('*').eq('id', budgetId).single();
        log('STEP_C1_BUDGET', budget);

        // C2: Items
        const { data: items } = await adminClient.from('budget_items')
            .select('level, description, source, type')
            .eq('budget_id', budgetId)
            .eq('source', 'IMPORTADO')
            .limit(5);
        log('STEP_C2_ITEMS_SAMPLE', items);

        // C3: Finalization Record
        const { data: finals } = await adminClient.from('import_budget_finalizations')
            .select('*')
            .eq('job_id', candidateJobId)
            .order('created_at', { ascending: false })
            .limit(1);
        log('STEP_C3_FINALIZATION', finals);

        // --- STEP D: No Items Test ---
        // Find job without items
        // Since traversing all empty jobs is hard, let's create a fake empty job for this user if possible, or search efficiently.
        // Searching: jobs NOT IN import_ai_items
        const { data: allUserJobs } = await adminClient.from('import_jobs')
            .select('id')
            .eq('user_id', candidateUserId)
            .limit(20);

        let emptyJobId = null;
        if (allUserJobs) {
            for (const j of allUserJobs) {
                const { count } = await adminClient.from('import_ai_items').select('*', { count: 'exact', head: true }).eq('job_id', j.id);
                if (count === 0) {
                    emptyJobId = j.id;
                    break;
                }
            }
        }

        if (!emptyJobId) {
            log('STEP_D', 'Skipping - No empty job found for user.');
        } else {
            const { data: rpcEmpty, error: rpcErrEmpty } = await adminClient.rpc('finalize_import_to_budget', {
                p_job_id: emptyJobId,
                p_user_id: candidateUserId
            });
            log('STEP_D_RESULT', { rpcEmpty, error: rpcErrEmpty }); // Expected ok: false, reason: 'no_items_found'
        }

        return new Response(JSON.stringify({ ok: true, report }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (err: any) {
        return new Response(JSON.stringify({ ok: false, error: err.message, stack: err.stack }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
})
