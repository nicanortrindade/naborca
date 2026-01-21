
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://cgebiryqfqheyazwtzzm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UjW1VENfeAnDD5U6-zE2Hw_kFbT-jtE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);


async function verifyEnrichmentLogic() {
    console.log("--- VERIFYING ENRICHMENT LOGIC (FIXED CONTEXT) ---");

    // 1. Simulate Search Inputs
    const query = 'cimento';

    // FIX: Using correct context found in step 1522
    // [ID: 7ac8a2af-9bd4-49b8-aef0-53aff9800f85] UF: BA, Comp: 2025-01, Regime: DESONERADO, Source: SINAPI, Mock: false
    const filters = {
        uf: 'BA',
        competence: '2025-01',
        regime: 'DESONERADO',
        sources: ['SINAPI']
    };

    console.log(`Searching for '${query}' with context:`, filters);

    // Step A: Search Items
    const { data: inputs, error } = await (supabase.from('insumos') as any)
        .select('*')
        .or(`description.ilike.%${query}%,code.ilike.%${query}%`)
        //.eq('type', 'INPUT') // Skip strict type check to see if we find anything
        .limit(5);

    if (error) { console.error("Search Error:", error); return; }
    if (!inputs || inputs.length === 0) { console.log("No inputs found."); return; }

    console.log(`Found ${inputs.length} inputs. Fetching prices...`);

    // Step B: Get Price Table ID
    // getPriceTable logic
    let tableQuery = (supabase.from('sinapi_price_tables') as any)
        .select('*')
        .eq('uf', filters.uf)
        .eq('competence', filters.competence)
        .eq('regime', filters.regime) // Correct column name is 'regime' for 2025-01 table?
        // Let's rely on list-price-tables output: "Regime: DESONERADO"
        // And column name in sinapi_price_tables is 'regime'.
        // Step 1522 output confirms "Regime: DESONERADO" so table row has regime='DESONERADO'
        .single();

    const { data: priceTable, error: tableError } = await tableQuery;

    if (!priceTable) {
        console.log("Price Table NOT FOUND.", tableError);
        return;
    }

    console.log("Found Price Table:", priceTable.id);

    // Step C: Enrich
    const codes = inputs.map((i: any) => i.code);
    const { data: prices } = await (supabase.from('sinapi_input_prices') as any)
        .select('input_code, price')
        .eq('price_table_id', priceTable.id) // Corrected to use UUID
        .in('input_code', codes);

    console.log(`Found ${prices?.length} prices.`);

    // Merge and Display
    const priceMap = new Map(prices?.map((p: any) => [p.input_code, p.price]));

    inputs.forEach((item: any) => {
        const enrichedPrice = priceMap.get(item.code) || 0;
        console.log(`> [${item.code}] ${item.description.substring(0, 40)}... | PRICE: R$ ${enrichedPrice.toFixed(2)}`);
    });

}

verifyEnrichmentLogic().catch(console.error);
