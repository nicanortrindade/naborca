
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkJobs() {
    const { data: jobs, error } = await supabase
        .from('import_jobs')
        .select('id, status, current_step, last_error, stage, document_context')
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error("Error fetching jobs:", error);
        return;
    }

    console.log(JSON.stringify(jobs, null, 2));
}

checkJobs();
