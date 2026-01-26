
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    // 1. CORS
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error('Missing Authorization header')

        // 2. Initialize Supabase Client
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseKey)

        // 3. Validate User
        const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
        if (authError || !user) throw new Error('Invalid Token');

        // 4. Parse Body
        const { job_id } = await req.json()
        if (!job_id) throw new Error('Missing job_id');

        // 5. Verify Ownership (RLS-like check)
        const { data: job, error: jobError } = await supabase
            .from('import_jobs')
            .select('id, user_id')
            .eq('id', job_id)
            .eq('user_id', user.id)
            .single();

        if (jobError || !job) {
            return new Response(JSON.stringify({ ok: false, message: 'Job not found or access denied' }), {
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // 6. Enqueue Extraction (Update status to processing)
        // This triggers the database watchers or allows the worker to pick it up if running in poll mode
        // But since we want immediate execution, we can also invoke the worker directly asynchronously
        // However, per requirements, we just queue/start it here.

        // Reset status to 'processing' (or extraction_queued if we had that state, but processing is fine)
        await supabase.from('import_jobs').update({
            stage: 'extraction_queued', // Let's use a explicit stage so worker picks it up
            last_error: null,
            extraction_attempts: 0
        }).eq('id', job_id);

        console.log(`[ImportExtract] Updated job ${job_id} status to extraction_queued`);

        // 7. Dispatch Worker via HTTP (Fire & Forget)
        // We use the Service Role key to authenticate the call to the worker
        const workerUrl = `${supabaseUrl}/functions/v1/import-extract-worker`;

        console.log(`[ImportExtract] Dispatching worker at ${workerUrl}`);

        const dispatchPromise = fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'apikey': supabaseKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ job_id })
        }).then(async (res) => {
            if (!res.ok) {
                const txt = await res.text();
                console.error(`[ImportExtract] Worker dispatch FAILED: ${res.status} - ${txt}`);
            } else {
                console.log(`[ImportExtract] dispatched worker for job_id=${job_id} (status: ${res.status})`);
            }
        }).catch(err => {
            console.error(`[ImportExtract] Worker dispatch EXCEPTION:`, err);
        });

        // Use EdgeRuntime.waitUntil to keep the function alive until the dispatch fetch completes
        // This allows us to return 200 to the client immediately without waiting for the worker logic
        if (typeof EdgeRuntime !== 'undefined') {
            (EdgeRuntime as any).waitUntil(dispatchPromise);
        } else {
            // Local dev fallback (might block, but ensures execution)
            console.warn('[ImportExtract] EdgeRuntime not found, awaiting dispatch...');
            await dispatchPromise;
        }

        return new Response(JSON.stringify({ ok: true, job_id, message: 'Extraction started' }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })

    } catch (error: any) {
        return new Response(JSON.stringify({ ok: false, message: error.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }
})
