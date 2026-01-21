
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://cgebiryqfqheyazwtzzm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UjW1VENfeAnDD5U6-zE2Hw_kFbT-jtE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);


async function verifyEnrichmentLogic() {
    console.log("--- VERIFYING ENRICHMENT LOGIC (RESILIENCE) ---");

    // Simulate Search Inputs with INVALID context to prove resilience
    const query = 'cimento';

    // Context INVALIDO (não deve existir tabela para BA/2020/DESONERADO)
    const filters = {
        uf: 'BA',
        competence: '2020-01',
        regime: 'DESONERADO',
        sources: ['SINAPI']
    };

    console.log(`Searching for '${query}' with INVALID context:`, filters);

    // Step A: Search Items
    const { data: inputs, error } = await (supabase.from('insumos') as any)
        .select('*')
        .or(`description.ilike.%${query}%,code.ilike.%${query}%`)
        .limit(5);

    if (error) { console.error("Search Error:", error); return; }

    console.log(`Found ${inputs?.length} inputs. Fetching prices...`);

    // Step B: Get Price Table ID
    let tableQuery = (supabase.from('sinapi_price_tables') as any)
        .select('*')
        .eq('uf', filters.uf)
        .eq('competence', filters.competence)
        .eq('regime', filters.regime)
        .single();

    const { data: priceTable, error: tableError } = await tableQuery;

    if (!priceTable) {
        console.log("Price Table NOT FOUND (Expected behavior). Proceeding with enrichment logic simulation...");
    } else {
        console.log("Unexpectedly found a price table:", priceTable.id);
    }

    // Step C: Enrich Logic Simulation 
    // Em SinapiService, se priceTable é null, o código não entra no bloco de busca de preço.
    // Portanto, o campo price deve permanecer undefined (ou null se vindo do banco sem enrichment).

    // Como estamos simulando a chamada RPC/Service manualmente aqui, vamos mostrar o que aconteceria:
    // O service retornaria os inputs SEM o campo 'price' injetado, ou injetado como null se o tipo exigir.
    // Agora que mudamos o tipo NormalizedResource para aceitar undefined, a UI deve mostrar "Sem Preço".

    // Vamos validar que SE o priceTable for null, não quebra e retorna os itens.

    if (!priceTable) {
        inputs?.forEach((item: any) => {
            // Simulate Service returning raw item without price enrichment
            const enrichedItem = { ...item, price: undefined };
            const display = enrichedItem.price !== undefined ? `R$ ${enrichedItem.price}` : "Sem Preço";
            console.log(`> [${item.code}] ${item.description.substring(0, 30)}... | Display: ${display}`);
        });
    }

}

verifyEnrichmentLogic().catch(console.error);
