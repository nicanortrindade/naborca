import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

async function runSQL() {
    console.log("Fetching job diagnostic data...");
    const { data, error } = await supabase
        .from('import_files')
        .select(`
            id,
            job_id,
            metadata
        `)
        .eq('job_id', '1ebd26b2-99c3-46c0-8c15-21f0b6e7baa3')
        .eq('doc_role', 'synthetic')
        .limit(1);

    if (error) {
        console.error("Error:", error);
        return;
    }

    if (data && data.length > 0) {
        const item = data[0];
        console.log("Raw Preview:");
        console.log(item.metadata?.rawTextPreview ?? '<null>');
        console.log("Stage A:");
        console.log(JSON.stringify(item.metadata?.stageA ?? null, null, 2));
    } else {
        console.log("No matching job/file found.");
    }
}

runSQL();
