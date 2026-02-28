
const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";
const jobId = "3b5326ed-972a-47f5-b7d6-20678cd9c5e7";

console.log(`Triggering finalize for job: ${jobId}`);

const resp = await fetch(`${SUPABASE_URL}/functions/v1/import-finalize-budget`, {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'x-internal-call': 'true'
    },
    body: JSON.stringify({ job_id: jobId, force_rehydrate: true })
});

const status = resp.status;
const text = await resp.text();

console.log(`Status: ${status}`);
console.log(`Response: ${text}`);
