
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
});

async function verifyDeployment() {
    console.log("--- VERIFYING RECENT JOBS (Last 24h) ---");
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: jobs, error: jobsErr } = await supabase
        .from("import_jobs")
        .select("id, status, stage, current_step, created_at")
        .gt("created_at", oneDayAgo)
        .order("created_at", { ascending: false })
        .limit(10);

    if (jobsErr) {
        console.error("Error fetching jobs:", jobsErr);
        return;
    }

    if (!jobs || jobs.length === 0) {
        console.log("No jobs found in the last 24h.");
        return;
    }

    const results = [];

    for (const job of jobs) {
        // Fetch Tasks
        const { data: tasks } = await supabase
            .from("import_parse_tasks")
            .select("id, status, result")
            .eq("job_id", job.id)
            .order("created_at", { ascending: false })
            .limit(1);

        const task = tasks?.[0];
        const taskStatus = task?.status || 'N/A';
        const workerAction = task?.result?.action || 'NULL';

        // Fetch Files
        const { data: files } = await supabase
            .from("import_files")
            .select("id, extraction_status, extracted_started_at, extracted_completed_at")
            .eq("job_id", job.id);

        const extractionStatus = files?.map(f => f.extraction_status).join(',') || 'N/A';
        const extractedStartedAt = files?.map(f => f.extracted_started_at).join(',') || 'N/A';

        // Count Items
        const { count } = await supabase
            .from("import_ai_items")
            .select("*", { count: "exact", head: true })
            .eq("job_id", job.id);

        results.push({
            created_at: new Date(job.created_at).toLocaleString('pt-BR'),
            job_id: job.id,
            status: job.status,
            stage: job.stage,
            task_status: taskStatus,
            worker_action: workerAction,
            extraction_status: extractionStatus,
            items_count: count || 0
        });
    }

    // Sort by created_at desc
    results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    console.table(results);
}

verifyDeployment();
