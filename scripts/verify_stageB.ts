
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import * as fs from "node:fs";
import * as path from "node:path";

// ----------------------------------------------------------------------------
// CONFIGURAÇÃO & LEITURA DE ENV
// ----------------------------------------------------------------------------
function loadEnv(filePath: string) {
    console.log(`Trying to load env from: ${filePath}`);
    try {
        const content = Deno.readTextFileSync(filePath);
        console.log(`✅ Loaded ${filePath} (${content.length} bytes)`);
        const result: Record<string, string> = {};
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx > 0) {
                const key = trimmed.slice(0, eqIdx).trim();
                let val = trimmed.slice(eqIdx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                result[key] = val;
            }
        }
        return result;
    } catch (e) {
        console.log(`⚠️ Failed to load ${filePath}: ${e.message}`);
        return {};
    }
}

const envLocalPath = path.resolve(Deno.cwd(), ".env.local");
const envRootPath = path.resolve(Deno.cwd(), ".env");

const envLocal = loadEnv(envLocalPath);
const envRoot = loadEnv(envRootPath);
const env = { ...envRoot, ...envLocal, ...Deno.env.toObject() };

console.log("Keys loaded:", Object.keys(env));

const SUPABASE_URL = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? env.VITE_SUPABASE_ANON_KEY;
// Note: Using ANON key if SERVICE key is missing, might fail RLS but worth a try for verification if allow.
// Actually, for verification of metadata, anon key might work if RLS allows read on import_files for the user, 
// but this script doesn't sign in as user.
// Let's hope SERVICE_ROLE_KEY is in .env.local or process env.

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    Deno.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const JOB_ID = "dad085a0-be68-455d-b0c1-32bda9b58d6f";
const TEST_EMAIL = "test_script_runner@example.com";
const TEST_PASSWORD = "password123";

async function verify() {
    console.log(`🔐 Authenticating as ${TEST_EMAIL}...`);
    const { error: authError } = await supabase.auth.signInWithPassword({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
    });

    if (authError) {
        console.error("❌ Authentication failed:", authError.message);
        // Fallback: try to continue if we are lucky and using service key (which we are not, but logic is fine)
    } else {
        console.log("✅ Authenticated.");
    }

    console.log(`🔍 Verifying Stage B metadata for Job: ${JOB_ID}`);

    const { data: files, error } = await supabase
        .from('import_files')
        .select('id, metadata')
        .eq('job_id', JOB_ID);

    if (error) {
        console.error("❌ Error fetching files:", error);
        Deno.exit(1);
    }

    if (!files || files.length === 0) {
        console.error("❌ No files found for this job.");
        Deno.exit(1);
    }

    for (const file of files) {
        console.log(`\n📄 File ID: ${file.id}`);
        const stageB = file.metadata?.stageB;

        if (!stageB) {
            console.error("   ❌ metadata.stageB is MISSING");
            continue;
        }

        console.log("   ✅ metadata.stageB exists");

        // 1. Check LLM SDK
        if (stageB.llm_sdk === "@google/genai") {
            console.log("   ✅ llm_sdk is correct (@google/genai)");
        } else {
            console.error(`   ❌ llm_sdk is INVALID: ${stageB.llm_sdk}`);
        }

        // 2. Check Model Attempts
        if (Array.isArray(stageB.llm_model_attempts) && stageB.llm_model_attempts.length > 0) {
            console.log(`   ✅ llm_model_attempts has ${stageB.llm_model_attempts.length} entries`);
            console.log("      Attempts:", JSON.stringify(stageB.llm_model_attempts, null, 2));
        } else {
            // If skipped, it might be valid if Stage A was empty
            if (stageB.skipped) {
                console.log("   ⚠️ Stage B was skipped (expected if no candidates)");
            } else {
                console.error("   ❌ llm_model_attempts is EMPTY or MISSING");
            }
        }

        // 3. Check Index Gate
        if (stageB.debug?.index_gate) {
            console.log("   ✅ debug.index_gate is PRESERVED");
            // console.log("      Gate:", JSON.stringify(stageB.debug.index_gate, null, 2));
        } else {
            console.error("   ❌ debug.index_gate is MISSING");
        }

        // 4. Check Atomic Build Sig
        if (stageB.build_sig === "stageb-atomic-v1") {
            console.log("   ✅ build_sig is correct (stageb-atomic-v1)");
        } else {
            console.warn(`   ⚠️ build_sig mismatch: ${stageB.build_sig}`);
        }
    }
}

verify();
