
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

async function runManualDispatch() {
    console.log("--- MANUAL DISPATCH CHECK ---");

    // 1. Initial State
    const { count: queuedBefore } = await supabase
        .from("import_parse_tasks")
        .select("*", { count: 'exact', head: true })
        .eq("status", "queued");

    const { count: dispatchedBefore } = await supabase
        .from("import_parse_tasks")
        .select("*", { count: 'exact', head: true })
        .eq("status", "dispatched");

    console.log(`BEFORE: Queued=${queuedBefore}, Dispatched=${dispatchedBefore}`);

    // 2. Execute RPC
    console.log("Executing RPC 'dispatch_parse_task' (max_tasks: 10)...");

    const { data: rpcData, error: rpcError } = await supabase
        .rpc("dispatch_parse_task", { max_tasks: 10 });

    if (rpcError) {
        console.error("RPC FAILED:", rpcError);
    } else {
        console.log("RPC SUCCESS. Result:", rpcData);
    }

    // 3. Final State
    const { count: queuedAfter } = await supabase
        .from("import_parse_tasks")
        .select("*", { count: 'exact', head: true })
        .eq("status", "queued");

    const { count: dispatchedAfter } = await supabase
        .from("import_parse_tasks")
        .select("*", { count: 'exact', head: true })
        .eq("status", "dispatched");

    console.log(`AFTER:  Queued=${queuedAfter}, Dispatched=${dispatchedAfter}`);

    if (queuedBefore !== null && queuedAfter !== null) {
        console.log(`DELTA: Queued change = ${queuedAfter - queuedBefore} (Expected -10 if full batch processed)`);
    }
}

runManualDispatch();
