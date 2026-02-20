
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

async function main() {
    console.log("--- Checking Pending OCR Jobs ---");
    const { data: jobs, error } = await supabase
        .from("import_ocr_jobs")
        .select("*")
        .or("status.eq.pending,status.eq.processing")
        .order("updated_at", { ascending: false })
        .limit(5);

    if (error) console.error(error);
    else console.table(jobs?.map(j => ({ id: j.id, status: j.status, locked_by: j.locked_by, retry: j.retry_count })));
}

main();
