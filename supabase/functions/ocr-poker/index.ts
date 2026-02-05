import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Declare EdgeRuntime for waitUntil
declare const EdgeRuntime: any;

serve(async (req) => {
    const requestId = crypto.randomUUID().split('-')[0];
    console.log(`[OCR-POKER] [${requestId}] Poker invoked.`);

    try {
        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            console.error(`[OCR-POKER] CRITICAL: Missing SUPABASE_URL or SERVICE_ROLE_KEY.`);
            return new Response(JSON.stringify({ error: "Missing configuration" }), { status: 500 });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Use simplified ISO string for consistent logging/debugging, though PostgREST handles ISO well.
        const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

        // OPTIMIZATION: Avoid "count: exact" and "OR" specific performance traps.
        // Instead of count(*), we just want to know if AT LEAST ONE job exists (O(1) with index).
        // We run two parallel checks to avoid the OR operator complexity in some PG versions/indexes.

        const check1 = supabase
            .from('import_ocr_jobs')
            .select('id')
            .eq('status', 'pending')
            .is('scheduled_for', null)
            .limit(1);

        const check2 = supabase
            .from('import_ocr_jobs')
            .select('id')
            .eq('status', 'pending')
            .filter('scheduled_for', 'lte', 'now()')
            .limit(1);

        const [res1, res2] = await Promise.all([check1, check2]);

        if (res1.error || res2.error) {
            const err = res1.error || res2.error;
            console.error(`[OCR-POKER] Database Check Error:`, res1.error, res2.error);
            return new Response(JSON.stringify({ error: "Database check failed", details: err }), { status: 500 });
        }

        const foundJob = (res1.data && res1.data.length > 0) || (res2.data && res2.data.length > 0);

        if (!foundJob) {
            console.log(`[OCR-POKER] No eligible pending jobs found (checked at ${nowIso}). NOOP.`);
            return new Response(JSON.stringify({ status: 'noop', checked_at: nowIso, note: "existence_check_only" }), {
                headers: { "Content-Type": "application/json" }
            });
        }

        console.log(`[OCR-POKER] Eligible job found. Triggering Worker.`);

        // 2. Trigger ocr-worker
        const workerUrl = `${SUPABASE_URL}/functions/v1/ocr-worker`;

        // Fire-and-forget
        const triggerWorker = fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': SUPABASE_SERVICE_ROLE_KEY,
                'Content-Type': 'application/json',
                'x-internal-call': '1'
            },
            body: JSON.stringify({
                reason: 'cron_poke',
                triggered_at: nowIso,
                trigger_type: 'existence_check'
            })
        }).then(res => {
            console.log(`[OCR-POKER] Worker triggered. Status: ${res.status}`);
            // drain body to avoid connection issues? usually fine.
            return res.text().then(t => console.log(`[OCR-POKER] Worker Response: ${t.slice(0, 100)}`));
        }).catch(err => {
            console.error(`[OCR-POKER] Failed to trigger worker:`, err);
        });

        if (typeof EdgeRuntime !== 'undefined') {
            EdgeRuntime.waitUntil(triggerWorker);
        } else {
            await triggerWorker;
        }

        return new Response(JSON.stringify({ status: 'poked', triggered_at: nowIso }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err: any) {
        console.error(`[OCR-POKER] Critical Error: ${err.message}`);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
});
