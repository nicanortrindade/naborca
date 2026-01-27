
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

async function run() {
    console.log("--- QUERY 1: Status Counts ---");
    {
        // Query 1: select status, count(*) as qtd from import_parse_tasks group by status order by qtd desc;
        // Implementation: Fetch status column, aggregate in memory.
        const { data: tasks, error } = await supabase
            .from("import_parse_tasks")
            .select("status"); // Fetch all rows (status only)

        if (error) {
            console.error("Error Query 1:", error);
        } else if (tasks) {
            const counts: Record<string, number> = {};
            tasks.forEach(t => {
                counts[t.status] = (counts[t.status] || 0) + 1;
            });
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            console.table(sorted.map(([status, qtd]) => ({ status, qtd })));
        }
    }

    console.log("\n--- QUERY 2: Latest Updated Tasks ---");
    {
        // Query 2: select id, status, attempts, locked_at, locked_by, updated_at from import_parse_tasks order by updated_at desc limit 30;
        const { data, error } = await supabase
            .from("import_parse_tasks")
            .select("id, status, attempts, locked_at, locked_by, updated_at")
            .order("updated_at", { ascending: false })
            .limit(30);

        if (error) console.error("Error Query 2:", error);
        else console.table(data);
    }

    console.log("\n--- QUERY 3: Recent Summaries (Last 60 mins) ---");
    {
        // List recent summaries
        const timeLimit = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        const { data, error } = await supabase
            .from("import_ai_summaries")
            .select("created_at, header")
            .gt("created_at", timeLimit)
            .order("created_at", { ascending: false })
            .limit(50);

        if (error) console.error("Error Query 3:", error);
        else if (data) {
            const mapped = data.map(r => {
                const h = r.header || {};
                return {
                    created_at: r.created_at,
                    task_id: h.task_id || "N/A",
                    kind: h.kind || "N/A",
                    structure_source: h.structure_source || "N/A"
                };
            });
            console.table(mapped);
        }
    }

    console.log("\n--- QUERY 4: Recent Items Created (Last 60 mins) ---");
    {
        // List recent items count per Job (Proxy for Task)
        const timeLimit = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
            .from("import_ai_items")
            .select("job_id")
            .gt("created_at", timeLimit)
            .limit(1000);

        if (error) {
            console.error("Error Query 4:", error);
        } else if (data) {
            const counts: Record<string, number> = {};
            data.forEach(x => {
                const k = x.job_id || "unknown";
                counts[k] = (counts[k] || 0) + 1;
            });
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            console.table(sorted.map(([job_id, items]) => ({ job_id_proxy_for_task: job_id, items })));
        }
    }
}

run();
