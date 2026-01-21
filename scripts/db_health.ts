
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Manual ENV parser
const envPath = path.resolve(process.cwd(), '.env.local');
let envs: Record<string, string> = {};
try {
    const file = fs.readFileSync(envPath, 'utf-8');
    file.split('\n').forEach(line => {
        const [key, val] = line.split('=');
        if (key && val) envs[key.trim()] = val.trim();
    });
} catch (e) { console.log("Env read error", e); }

const supabaseUrl = envs['VITE_SUPABASE_URL'] || process.env.VITE_SUPABASE_URL;
const supabaseKey = envs['VITE_SUPABASE_ANON_KEY'] || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function checkHealth() {
    console.log("Checking Database Health...");

    // Insumos
    const { count: insumosCount, error: insErr } = await supabase
        .from('insumos')
        .select('*', { count: 'exact', head: true });
    console.log(`Insumos Count: ${insumosCount} (Error: ${insErr?.message})`);

    // Composições
    const { count: compCount, error: compErr } = await supabase
        .from('compositions')
        .select('*', { count: 'exact', head: true });
    console.log(`Compositions Count: ${compCount} (Error: ${compErr?.message})`);

    // Compositions View (if exists) or unified search source?
    // The app uses 'sinapi_inputs' usually?
    const { count: sinapiCount, error: sinapiErr } = await supabase
        .from('sinapi_inputs_view')
        .select('*', { count: 'exact', head: true }); // Trying a view if standard tables are empty
    console.log(`Sinapi View Count: ${sinapiCount} (Error: ${sinapiErr?.message})`);

    if (insumosCount === 0 && compCount === 0) {
        console.log("CRITICAL: Database seems empty. Imports might be missing.");
    }
}

checkHealth();
