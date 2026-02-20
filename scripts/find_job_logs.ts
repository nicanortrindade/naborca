
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

async function main() {
    console.log("--- Fetching all Processing/Pending jobs to find match ---");
    const { data: processingJobs, error } = await supabase
        .from("import_ocr_jobs")
        .select("*")
        .or("status.eq.processing,status.eq.pending");

    if (error) {
        console.error("Error:", error);
    } else {
        const found = processingJobs?.filter(j =>
            j.id.startsWith("562437ab") ||
            (j.job_id && j.job_id.startsWith("562437ab"))
        );

        if (found && found.length > 0) {
            console.log(JSON.stringify(found, null, 2));
        } else {
            console.log("No job found with that prefix in Processing/Pending.");
            console.log("Latest Processing jobs:");
            console.table(processingJobs?.filter(j => j.status === 'processing').map(j => ({ id: j.id, job_id: j.job_id, status: j.status, updated_at: j.updated_at })));
        }
    }
}

main();
