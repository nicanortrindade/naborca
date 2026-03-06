
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";


const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const JOB_ID = "eecca1b2-d632-4895-a16d-3c80cf3f9889";
const USER_ID = "6c3c24cd-5392-4238-9374-2f439c462e87";

async function executeFinalize() {
    console.log(`🚀 Executing finalize_import_to_budget...`);
    console.log(`Job ID: ${JOB_ID}`);
    console.log(`User ID: ${USER_ID}`);

    const { data, error } = await supabase.rpc('finalize_import_to_budget', {
        p_job_id: JOB_ID,
        p_user_id: USER_ID,
        p_params: {},
        p_analytic_data: {}
    });

    if (error) {
        console.error("❌ Error executing function:", error);
    } else {
        console.log("✅ Function executed successfully!");
        fs.writeFileSync('c:\\Users\\nican\\OneDrive\\Documentos\\SITE PLANILHA\\scripts\\execute_finalize_result.json', JSON.stringify(data, null, 2), 'utf8');
    }
}

executeFinalize().catch(console.error);
