
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const JOB_ID = "250c3080-f71c-499b-a51d-bf031da1c3ad";

async function main() {
    console.log(`Checking import_ocr_jobs for job_id ${JOB_ID}...`);
    const { data: ocrJobs, error: ocrErr } = await supabase
        .from('import_ocr_jobs')
        .select('*')
        .eq('job_id', JOB_ID);

    if (ocrErr) {
        console.error("OCR Job Error:", ocrErr.message);
    } else {
        console.log("OCR Jobs found:", ocrJobs?.length);
        ocrJobs?.forEach(j => {
            console.log(`\n--- OCR Job ID: ${j.id} ---`);
            console.log("Status:", j.status);
            console.log("Metadata:", JSON.stringify(j.metadata, null, 2));
            console.log("Last Error:", j.last_error);
        });
    }

    console.log(`\nChecking import_files for job_id ${JOB_ID}...`);
    const { data: files, error: fileErr } = await supabase
        .from('import_files')
        .select('*')
        .eq('job_id', JOB_ID);

    if (fileErr) {
        console.error("Files Error:", fileErr.message);
    } else {
        files?.forEach(f => {
            console.log(`\n--- File ID: ${f.id} ---`);
            console.log("Metadata StageB Debug:", JSON.stringify(f.metadata?.stageB?.debug, null, 2));
            if (f.metadata?.stageB?.debug?.parse?.rejected_items) {
                console.log("Rejected Items Count:", f.metadata.stageB.debug.parse.rejected_items.length);
            }
        });
    }
}

main();
