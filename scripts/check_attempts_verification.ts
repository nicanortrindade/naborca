
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

async function checkAttempts() {
    console.log("--- CHECK ATTEMPTS ---");
    const { data, error } = await supabase
        .from("import_parse_tasks")
        .select("id, status, attempts, max_attempts, updated_at")
        .eq("status", "queued")
        .order("updated_at", { ascending: false })
        .limit(10);

    if (error) console.error("Error:", error);
    else console.table(data);
}

checkAttempts();
