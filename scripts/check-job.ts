
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function loadEnv(filePath: string) {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, "utf-8");
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
            result[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        }
    }
    return result;
}

const envLocal = loadEnv(path.resolve(process.cwd(), ".env.local"));
const mergedEnv = { ...envLocal, ...process.env };
const SUPABASE_URL = mergedEnv.VITE_SUPABASE_URL;
const SUPABASE_KEY = mergedEnv.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);

const JOB_ID = "d7cd7133-6cf9-4b5a-ae91-32d15837f9d1"; // From previous run

async function main() {
    const { data, error } = await supabase.from("import_jobs").select("*").eq("id", JOB_ID).single();
    console.log(JSON.stringify(data, null, 2));
}

main();
