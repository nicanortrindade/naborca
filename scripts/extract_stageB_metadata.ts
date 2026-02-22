
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const JOB_ID = "250c3080-f71c-499b-a51d-bf031da1c3ad";

async function main() {
    const { data: files, error } = await supabase
        .from('import_files')
        .select('id, metadata')
        .eq('job_id', JOB_ID);

    if (error) {
        console.error("Error:", error.message);
        return;
    }

    files.forEach(f => {
        console.log(`\n\n--- FILE ${f.id} ---`);
        console.log(JSON.stringify(f.metadata?.stageB, null, 2));
    });
}

main();
