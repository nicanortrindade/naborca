
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const JOB_ID = "250c3080-f71c-499b-a51d-bf031da1c3ad";

async function main() {
    console.log(`Checking import_jobs for ${JOB_ID}...`);
    const { data: job, error: jobErr } = await supabase
        .from('import_jobs')
        .select('*')
        .eq('id', JOB_ID)
        .single();

    if (jobErr) {
        console.error("Job Error:", jobErr.message);
    } else {
        console.log("Job Data:", JSON.stringify(job, null, 2));
    }

    console.log(`\nChecking import_files for job_id ${JOB_ID}...`);
    const { data: files, error: fileErr } = await supabase
        .from('import_files')
        .select('*')
        .eq('job_id', JOB_ID);

    if (fileErr) {
        console.error("Files Error:", fileErr.message);
    } else {
        files.forEach(f => {
            console.log(`\n--- File ID: ${f.id} ---`);
            console.log("Metadata StageB:", JSON.stringify(f.metadata?.stageB, null, 2));
        });
    }
}

main();
