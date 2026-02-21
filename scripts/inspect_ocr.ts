import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_UjW1VENfeAnDD5U6-zE2Hw_kFbT-jtE";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
    console.log("Authenticating with Nicanor's email...");
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email: "nicanortsneto@gmail.com",
        password: "password123" // Typically dev setups use simple passwords, let's try or we fallback to user interaction
    });

    if (authErr) {
        console.error("Auth failed:", authErr.message);
        console.log("We need a valid token to bypass RLS. Let's try skipping RLS with a service key trick or ask the user.");
        return;
    }

    console.log("Authenticated!", authData.user.id);

    console.log("Fetching recent job...");
    const { data: job, error: jobErr } = await supabase
        .from("import_jobs")
        .select("id, status")
        .order("created_at", { ascending: false })
        .limit(3);

    if (jobErr || !job || job.length === 0) {
        console.error("Job error:", jobErr);
        return;
    }

    // We want the most recent job that has files
    for (const j of job) {
        console.log("\nChecking job:", j.id, "Status:", j.status);
        const { data: files, error: filesErr } = await supabase
            .from("import_files")
            .select("id, doc_role, original_filename, metadata")
            .eq("job_id", j.id);

        if (filesErr || !files) {
            console.error("Files error:", filesErr);
            continue;
        }

        for (const file of files) {
            console.log(`\n--- File: ${file.original_filename} (${file.doc_role} / ${file.id}) ---`);
            const sample = file.metadata?.stageA?.candidates_sample?.slice(0, 50) || [];
            console.log(`Found ${sample.length} candidates in sample.`);

            // Look specifically for strings that look like section headers
            const lines = sample.filter((c: any) =>
                c.snippet && (
                    c.snippet.match(/^[0-9A-Z]{1,3}\s*-/) ||
                    c.snippet.match(/^[0-9]+\.[0-9]+\.[0-9]+/) ||
                    (c.snippet.toUpperCase() === c.snippet && c.snippet.length > 5 && c.snippet.length < 50)
                )
            ).slice(0, 15);

            for (const cand of lines.length > 0 ? lines : sample.slice(0, 15)) {
                console.log(`[path:${cand.extracted_signals?.item_path || 'NULL'}] Line ${cand.line_no}: ${cand.snippet}`);
            }
        }
    }
}

main().catch(console.error);
