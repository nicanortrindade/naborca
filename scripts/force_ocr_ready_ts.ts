
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

async function main() {
    console.log("--- Forcing OCR Jobs to Pending/Ready ---");

    // Find pending/processing jobs
    const { data: jobs } = await supabase
        .from("import_ocr_jobs")
        .select("id")
        .in("status", ["pending", "processing"]);

    if (!jobs || jobs.length === 0) {
        console.log("No jobs to update.");
        return;
    }

    const ids = jobs.map(j => j.id);
    console.log(`Updating ${ids.length} jobs...`);

    // Update them
    const { error } = await supabase
        .from("import_ocr_jobs")
        .update({
            status: "pending",
            locked_by: null,
            started_at: null,
            // Force scheduled_for to past
            scheduled_for: new Date(Date.now() - 60000).toISOString()
        })
        .in("id", ids);

    if (error) {
        console.error("Update failed:", error);
    } else {
        console.log("Success! Jobs reset.");
    }
}

main();
