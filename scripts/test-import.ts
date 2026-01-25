
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

// Carrega variáveis de ambiente (.env e .env.local)
const envLocal = loadEnv(path.resolve(process.cwd(), ".env.local"));
const envRoot = loadEnv(path.resolve(process.cwd(), ".env"));
const env = { ...envRoot, ...envLocal, ...process.env };

const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("❌ ERRO: 'VITE_SUPABASE_URL' ou 'VITE_SUPABASE_ANON_KEY' não definidos.");
    console.error("Verifique seus arquivos .env ou .env.local");
    process.exit(1);
}

// Cliente padrão (Anon Role)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});

async function main() {
    console.log("🚀 INICIANDO TESTE DE IMPORTAÇÃO (MODE: AUTHENTICATED USER)");

    // --------------------------------------------------------------------------
    // 1. LOCALIZAR ARQUIVO LOCAL
    // --------------------------------------------------------------------------
    const downloadsDir = path.join(os.homedir(), "Downloads");
    // O arquivo exato solicitado
    const sourceFilename = "5a4a7ed0da8a47f7a9217822f4dfaa65";
    const sourcePath = path.join(downloadsDir, sourceFilename);
    // Se não achar o exato, tenta com extensão .pdf por garantia
    const sourcePathPdf = sourcePath + ".pdf";

    let finalSourcePath = "";
    if (fs.existsSync(sourcePath)) finalSourcePath = sourcePath;
    else if (fs.existsSync(sourcePathPdf)) finalSourcePath = sourcePathPdf;
    else {
        console.error(`❌ ARQUIVO NÃO ENCONTRADO:\n   Busquei em: ${sourcePath}\n   E em: ${sourcePathPdf}`);
        process.exit(1);
    }

    const fileBuffer = fs.readFileSync(finalSourcePath);
    console.log(`✅ Arquivo carregado: ${finalSourcePath} (${fileBuffer.length} bytes)`);

    // --------------------------------------------------------------------------
    // 2. AUTENTICAR COMO USUÁRIO (ANON -> AUTHENTICATED)
    // --------------------------------------------------------------------------
    // Criamos ou logamos um usuário de teste para ter um userId válido e permissões RLS.
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
        if (signUpData.user) {
            console.log("✅ Usuário criado.");
            authData = { user: signUpData.user, session: signUpData.session };
            // Se auto-confirm não estiver ativo, pode falhar aqui na sequência sem email verificado.
            // Assumindo ambiente dev/test onde funciona ou persistSession lida.
        } else {
            console.error("❌ Usuário não retornado no SignUp (verifique confirmação de email).");
            process.exit(1);
        }
    } else {
        console.log("✅ Login efetuado.");
    }

    const userId = authData.user!.id;
    console.log(`✅ Usando User ID: ${userId}`);

    // --------------------------------------------------------------------------
    // 3. UPLOAD DO ARQUIVO (Bucket 'imports')
    // --------------------------------------------------------------------------
    const targetName = "teste_araci.pdf";
    const storagePath = `${userId}/${targetName}`; // Organização por pasta do usuário

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

    // --------------------------------------------------------------------------
    // 4. CRIAR JOB (import_jobs)
    // --------------------------------------------------------------------------
    const jobId = crypto.randomUUID();
    console.log(`➤ Criando Job ${jobId}...`);

    const { error: jobError } = await supabase.from("import_jobs").insert({
        id: jobId,
        user_id: userId,
        status: "queued",
        doc_role: "synthetic",
        is_desonerado: false, // Default conforme solicitado
        progress: 0,
    });

    if (jobError) {
        console.error("❌ Erro ao criar import_jobs:", jobError);
        process.exit(1);
    }
    console.log("✅ Job criado.");

    // --------------------------------------------------------------------------
    // 5. REGISTRAR ARQUIVO (import_files)
    // --------------------------------------------------------------------------
    console.log("➤ Registrando import_files...");

    const { error: fileError } = await supabase.from("import_files").insert({
        job_id: jobId,
        user_id: userId,
        file_kind: "pdf",
        doc_role: "synthetic",
        storage_bucket: "imports",
        storage_path: storagePath, // Path relativo dentro do bucket
        original_filename: targetName,
        content_type: "application/pdf"
    });

    if (fileError) {
        console.error("❌ Erro ao criar import_files:", fileError);
        process.exit(1);
    }
    console.log("✅ Arquivo registrado.");

    // --------------------------------------------------------------------------
    // 6. INVOCAR EDGE FUNCTION (import-processor)
    // --------------------------------------------------------------------------
    console.log("➤ Invocando Edge Function 'import-processor'...");
    const t0 = performance.now();

    const { data: funcData, error: funcError } = await supabase.functions.invoke("import-processor", {
        body: { job_id: jobId },
    });

    const duration = (performance.now() - t0).toFixed(2);

    if (funcError) {
        console.error("❌ Erro na execução da Edge Function:", funcError);

        if (funcError && typeof funcError === 'object' && 'context' in funcError) {
            const ctx = (funcError as any).context;
            if (ctx && typeof ctx.json === 'function') {
                try {
                    const jsonBody = await ctx.json();
                    console.error("BODY DO ERRO (JSON):", JSON.stringify(jsonBody, null, 2));
                } catch {
                    console.error("BODY DO ERRO (TEXT):", await ctx.text());
                }
            }
        }
    } else {
        console.log(`✅ Edge Function retornou em ${duration}ms.\n`);
        console.log("↓↓↓ JSON OUTPUT ↓↓↓");
        console.log(JSON.stringify(funcData, null, 2));
        console.log("↑↑↑ JSON OUTPUT ↑↑↑");
    }
}

main().catch((err) => {
    console.error("❌ Erro fatal não tratado:", err);
    process.exit(1);
});
