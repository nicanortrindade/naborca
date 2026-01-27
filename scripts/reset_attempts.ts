
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

async function runAttemptsReset() {
    console.log("--- ATTEMPTS RESET SCRIPT ---");

    // 1. Audit
    {
        // We can't use SUM/CASE easily in JS client without RPC or raw SQL (which we can't send via client 'query').
        // We fetch all queued tasks and count in memory.
        const { data: tasks, error } = await supabase
            .from("import_parse_tasks")
            .select("attempts, max_attempts")
            .eq("status", "queued");

        if (error) {
            console.error("Audit Error:", error);
            return;
        }

        if (tasks) {
            const total = tasks.length;
            const blocked = tasks.filter(t => t.attempts >= t.max_attempts).length;
            console.log(`AUDIT: Total Queued = ${total}, Blocked (attempts >= max) = ${blocked}`);
        }
    }

    // 2. Reset Attempts
    // Logic: update tasks set attempts=0 where status='queued' and attempts >= max_attempts
    // Note: Client doesn't support comparing two columns (attempts >= max_attempts).
    // However, we know max_attempts is typically fixed (e.g. 3 or 5).
    // But strictly speaking it's a column.
    // Workaround: We fetch the IDs of blocked tasks first (from step 1), then update by ID list.

    let blockedIds: string[] = [];
    {
        const { data: tasks } = await supabase
            .from("import_parse_tasks")
            .select("id, attempts, max_attempts")
            .eq("status", "queued");

        if (tasks) {
            blockedIds = tasks
                .filter(t => t.attempts >= t.max_attempts)
                .map(t => t.id);
        }
    }

    if (blockedIds.length > 0) {
        console.log(`Resetting attempts for ${blockedIds.length} tasks...`);

        // Batch update (max 1000 per request usually safe)
        const { error, count } = await supabase
            .from("import_parse_tasks")
            .update({ attempts: 0, updated_at: new Date().toISOString() })
            .in("id", blockedIds)
            .select("id", { count: 'exact' });

        if (error) console.error("Reset Error:", error);
        else console.log(`SUCCESS: Reset ${count} tasks.`);

    } else {
        console.log("No blocked tasks found to reset.");
    }

    // 3. Validation
    const { data: tasks, error } = await supabase
        .from("import_parse_tasks")
        .select("status");

    if (tasks) {
        const counts: Record<string, number> = {};
        tasks.forEach(t => {
            counts[t.status] = (counts[t.status] || 0) + 1;
        });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        console.log("\n--- Final Status Distribution ---");
        console.table(sorted.map(([status, qtd]) => ({ status, qtd })));
    }
}

runAttemptsReset();
