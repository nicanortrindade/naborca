
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

async function runSQLCleanup() {
    console.log("--- SQL CLEANUP SCRIPT (Client-Side Update) ---");

    // 1) Release Expired Locks
    // SQL: update import_parse_tasks set locked_at=null, locked_by=null, updated_at=now() where locked_at < now() - 10m
    {
        const timeLimit = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { data, error, count } = await supabase
            .from("import_parse_tasks")
            .update({ locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
            .not("locked_at", "is", null) // "is not null"
            .lt("locked_at", timeLimit)
            .select("id", { count: 'exact' });

        if (error) console.error("Error Step 1:", error);
        else console.log(`Step 1 (Release Locks): Released ${data?.length || 0} expired locks.`);
    }

    // 2) Requeue 'dispatched' tasks that are unlocked (or expired/null lock)
    // SQL: update import_parse_tasks set status='queued' where status='dispatched' and (locked_at is null or locked_at < now()-10m)
    // NOTE: Supabase JS client doesn't support sophisticated OR logic easily in one query without RPC.
    // We will do it in two steps for safety:
    //    2a. Requeue dispatched tasks where locked_at IS NULL
    //    2b. Requeue dispatched tasks where locked_at IS EXPIRED (should be covered by Step 1 clearing locks, so just 2a is enough after 1 ran!)

    // Since Step 1 already clears expired locks (sets locked_at = null), 
    // we ONLY need to target 'dispatched' tasks where locked_at is null.

    {
        const { data, error, count } = await supabase
            .from("import_parse_tasks")
            .update({ status: 'queued', updated_at: new Date().toISOString() })
            .eq("status", "dispatched")
            .is("locked_at", null)
            .select("id", { count: 'exact' });

        if (error) console.error("Error Step 2:", error);
        else console.log(`Step 2 (Requeue Stuck): Requeued ${data?.length || 0} tasks stuck in 'dispatched'.`);
    }

    // 3) Final Validation
    {
        const { data: tasks, error } = await supabase
            .from("import_parse_tasks")
            .select("status");

        if (error) {
            console.error("Error Step 3:", error);
        } else if (tasks) {
            const counts: Record<string, number> = {};
            tasks.forEach(t => {
                counts[t.status] = (counts[t.status] || 0) + 1;
            });
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            console.log("\n--- Final Status Counts ---");
            console.table(sorted.map(([status, qtd]) => ({ status, qtd })));
        }
    }

}

runSQLCleanup();
