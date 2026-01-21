
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://cgebiryqfqheyazwtzzm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UjW1VENfeAnDD5U6-zE2Hw_kFbT-jtE';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
    console.log("--- DEBUG SEARCH PRICES (FULL ITEM) ---");
    const queries = ['cimento'];

    for (const q of queries) {
        console.log(`\nSearching for: ${q}...`);

        const { data, error } = await (supabase.from('insumos') as any)
            .select('*')
            .or(`description.ilike.%${q}%,code.ilike.%${q}%`)
            .limit(1);

        if (error) {
            console.error("Error:", error);
            continue;
        }

        if (data && data.length > 0) {
            console.log("Item keys:", Object.keys(data[0]));
            console.log("Full Item:", JSON.stringify(data[0], null, 2));
        } else {
            console.log("   No results found.");
        }
    }
}

main().catch(console.error);
