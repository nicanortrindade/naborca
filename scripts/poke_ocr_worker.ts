
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

async function main() {
    console.log("--- 1. Checking Pending OCR Jobs ---");
    const { data: jobs, error } = await supabase
        .from("import_ocr_jobs")
        .select("*")
        .or("status.eq.pending,status.eq.processing")
        .order("updated_at", { ascending: false })
        .limit(5);

    if (error) {
        console.error("Error fetching jobs:", error);
    } else {
        console.log("Pending/Processing Jobs:", jobs?.length);
        if (jobs && jobs.length > 0) {
            console.table(jobs.map(j => ({ id: j.id, status: j.status, locked_by: j.locked_by, retry: j.retry_count })));
        } else {
            console.log("No jobs found. This test might not trigger robust processing if table is empty.");
        }
    }

    console.log("\n--- 2. Invoking ocr-worker (Manual Poke) ---");
    const functionUrl = `${SUPABASE_URL}/functions/v1/ocr-worker`;
    console.log("Invoking:", functionUrl);

    try {
        const res = await fetch(functionUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${SUPABASE_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                reason: 'manual_verification_poke'
            })
        });

        const text = await res.text();
        console.log("Response Status:", res.status);
        console.log("Response Body (Truncated):", text.substring(0, 500));

    } catch (e) {
        console.error("Invoke failed:", e);
    }

    console.log("\n--- 3. Re-checking Job Status ---");
    const { data: jobsAfter } = await supabase
        .from("import_ocr_jobs")
        .select("*")
        .or("status.eq.pending,status.eq.processing")
        .order("updated_at", { ascending: false })
        .limit(5);

    console.table(jobsAfter?.map(j => ({ id: j.id, status: j.status, locked_by: j.locked_by, retry: j.retry_count })));
}

main();
