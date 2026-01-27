
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

async function runSnapshotFinal() {
    console.log("--- SNAPSHOT FINAL ---");
    const timeLimit = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    // 1) Status Counts
    {
        const { data: tasks, error } = await supabase
            .from("import_parse_tasks")
            .select("status");

        if (error) {
            console.error("Error Query 1:", error);
        } else if (tasks) {
            const counts: Record<string, number> = {};
            tasks.forEach(t => {
                counts[t.status] = (counts[t.status] || 0) + 1;
            });
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            console.log("--- Q1: Status Distribution ---");
            console.table(sorted.map(([status, qtd]) => ({ status, qtd })));
        }
    }

    // 2) Evolution (Last 10m)
    {
        const { data, error } = await supabase
            .from("import_parse_tasks")
            .select("id, status, attempts, locked_at, locked_by, updated_at")
            .gt("updated_at", timeLimit)
            .order("updated_at", { ascending: false })
            .limit(30);

        if (error) console.error("Error Q2:", error);
        else {
            console.log("\n--- Q2: Recent Tasks (Last 10m) ---");
            console.table(data);
        }
    }

    // 3) Summaries (Last 10m)
    {
        const { data, error } = await supabase
            .from("import_ai_summaries")
            .select("created_at, header")
            .gt("created_at", timeLimit)
            .order("created_at", { ascending: false })
            .limit(30);

        if (error) console.error("Error Q3:", error);
        else {
            console.log("\n--- Q3: Recent Summaries (Last 10m) ---");
            const mapped = data?.map(r => {
                const h = r.header || {};
                return {
                    created_at: r.created_at,
                    kind: h.kind || "N/A",
                    structure_source: h.structure_source || "N/A",
                    reason: h.reason || "N/A"
                };
            });
            console.table(mapped);
        }
    }

    // 4) Items Created (Last 10m)
    {
        const { data, error } = await supabase
            .from("import_ai_items")
            .select("job_id")
            .gt("created_at", timeLimit)
            .limit(2000);

        if (error) {
            console.error("Error Q4:", error);
        } else if (data) {
            const counts: Record<string, number> = {};
            data.forEach(x => {
                const k = x.job_id || "unknown";
                counts[k] = (counts[k] || 0) + 1;
            });
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            console.log("\n--- Q4: Items Created (Last 10m) ---");
            console.table(sorted.map(([job_id, items]) => ({ job_id_proxy, items })));
        }
    }
}

runSnapshotFinal();
