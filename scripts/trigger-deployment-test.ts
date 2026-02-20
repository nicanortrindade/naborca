
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ----------------------------------------------------------------------------
// CONFIGURAÇÃO & LEITURA DE ENV
// ----------------------------------------------------------------------------
function loadEnv(filePath: string) {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, "utf-8");
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
}

const envLocal = loadEnv(path.resolve(process.cwd(), ".env.local"));
const envRoot = loadEnv(path.resolve(process.cwd(), ".env"));
const env = { ...envRoot, ...envLocal, ...process.env };

const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("❌ ERRO: 'VITE_SUPABASE_URL' ou 'VITE_SUPABASE_ANON_KEY' não definidos.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});

async function main() {
    console.log("🚀 TRIGGERING DEPLOYMENT TEST JOB");

    const finalSourcePath = path.resolve(process.cwd(), "analitico_araci.pdf");
    if (!fs.existsSync(finalSourcePath)) {
        console.error(`❌ ARQUIVO NÃO ENCONTRADO: ${finalSourcePath}`);
        process.exit(1);
    }

    const fileBuffer = fs.readFileSync(finalSourcePath);
    console.log(`✅ Arquivo carregado: ${finalSourcePath} (${fileBuffer.length} bytes)`);

    const TEST_EMAIL = "test_script_runner@example.com";
    const TEST_PASSWORD = "password123";

    console.log(`➤ Autenticando usuário de teste (${TEST_EMAIL})...`);
    let { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
    });

    if (authError || !authData.user) {
        console.log(`ℹ️ Login falhou (${authError?.message}). Tentando criar conta...`);
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
        });
        if (signUpError) {
            console.error("❌ Falha crítica no SignUp:", signUpError.message);
            process.exit(1);
        }
        authData = { user: signUpData.user, session: signUpData.session };
    } else {
        console.log("✅ Login efetuado.");
    }

    const userId = authData.user!.id;
    const targetName = `test_deploy_${Date.now()}.pdf`;
    const storagePath = `${userId}/${targetName}`;

    console.log(`➤ Uploading para: imports/${storagePath}...`);
    const { data: uploadData, error: uploadError } = await supabase.storage
        .from("imports")
        .upload(storagePath, fileBuffer, {
            contentType: "application/pdf",
            upsert: true,
        });

    if (uploadError) {
        console.error("❌ Erro no Upload:", uploadError);
        process.exit(1);
    }
    console.log("✅ Upload realizado com sucesso!");

    const jobId = crypto.randomUUID();
    console.log(`➤ Criando Job ${jobId}...`);

    const { error: jobError } = await supabase.from("import_jobs").insert({
        id: jobId,
        user_id: userId,
        status: "queued",
        doc_role: "analytical",
        is_desonerado: false,
        progress: 0,
    });

    if (jobError) {
        console.error("❌ Erro ao criar import_jobs:", jobError);
        process.exit(1);
    }
    console.log("✅ Job criado.");

    console.log("➤ Registrando import_files...");
    const { error: fileError } = await supabase.from("import_files").insert({
        job_id: jobId,
        user_id: userId,
        file_kind: "pdf",
        doc_role: "analytical",
        storage_bucket: "imports",
        storage_path: storagePath,
        original_filename: targetName,
        content_type: "application/pdf"
    });

    if (fileError) {
        console.error("❌ Erro ao criar import_files:", fileError);
        process.exit(1);
    }
    console.log("✅ Arquivo registrado.");

    console.log("➤ Invocando Edge Function 'import-processor'...");
    const { data: funcData, error: funcError } = await supabase.functions.invoke("import-processor", {
        body: { job_id: jobId },
    });

    if (funcError) {
        console.error("❌ Erro na execução da Edge Function:", funcError);
    } else {
        console.log(`✅ Edge Function retornou.\n`);
        console.log("JOB_ID:", jobId);
        console.log(JSON.stringify(funcData, null, 2));
    }
}

main().catch((err) => {
    console.error("❌ Erro fatal não tratado:", err);
    process.exit(1);
});
