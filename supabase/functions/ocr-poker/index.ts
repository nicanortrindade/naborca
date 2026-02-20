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

        // WATCHDOG: Recover stale locks before checking capacity.
        // This ensures expired locks don't permanently block slots.
        try {
            const { data: recovered } = await supabase.rpc('recover_stale_ocr_locks');
            if (recovered && recovered as number > 0) console.log(`[OCR-POKER] Watchdog: Recovered ${recovered} stale locks.`);

            const { data: watchdog } = await supabase.rpc('cleanup_stale_ocr_jobs');
            if (watchdog && watchdog.length > 0 && (watchdog[0].requeued_count > 0 || watchdog[0].failed_count > 0)) {
                console.log(`[OCR-POKER] Watchdog: Requeued=${watchdog[0].requeued_count}, Failed=${watchdog[0].failed_count}`);
            }
        } catch (watchdogErr: any) {
            console.error(`[OCR-POKER] Watchdog error (non-fatal):`, watchdogErr.message);
        }

        // OPTIMIZATION: Use RPC to check capacity and eligibility in one go.
        const RPC_CAP = 2; // Default Cap
        const { data: shouldPoke, error: rpcError } = await supabase.rpc('should_poke_ocr_worker', { p_cap: RPC_CAP });

        if (rpcError) {
            console.error(`[OCR-POKER] RPC Check Error:`, rpcError);
            return new Response(JSON.stringify({ error: "RPC check failed", details: rpcError }), { status: 500 });
        }

        if (!shouldPoke) {
            console.log(`[OCR-POKER] NOOP (cap reached or no eligible jobs). Checked at ${nowIso}.`);
            return new Response(JSON.stringify({ status: 'noop', checked_at: nowIso, note: "cap_reached_or_empty" }), {
                headers: { "Content-Type": "application/json" }
            });
        }

        console.log(`[OCR-POKER] Eligible job exists and capacity available. Triggering worker...`);

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
                trigger_type: 'should_poke_rpc'
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
