
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://cgebiryqfqheyazwtzzm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UjW1VENfeAnDD5U6-zE2Hw_kFbT-jtE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkPriceTables() {
    console.log("--- LISTING PRICE TABLES ---");
    const { data: tables, error } = await (supabase.from('sinapi_price_tables') as any)
        .select('*')
        .order('competence', { ascending: false })
        .limit(10);

    if (error) {
        console.error("Error:", error);
        return;
    }

    if (!tables || tables.length === 0) {
        console.log("No tables found.");
        return;
    }

    console.log(`Found ${tables.length} tables. Samples:`);
    tables.forEach((t: any) => {
        console.log(`[ID: ${t.id}] UF: ${t.uf}, Comp: ${t.competence}, Regime: ${t.regime}, Source: ${t.source}, Mock: ${t.is_mock}`);
    });
}

checkPriceTables().catch(console.error);
