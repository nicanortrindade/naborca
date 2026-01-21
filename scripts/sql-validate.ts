
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cgebiryqfqheyazwtzzm.supabase.co';
const supabaseKey = 'sb_publishable_UjW1VENfeAnDD5U6-zE2Hw_kFbT-jtE';
const budgetId = '3d037e1c-f633-4964-b917-01fe101a4185';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    try {
        // 1) Confirm Hierarchy
        const { data: items, error: err1 } = await supabase
            .from('budget_items')
            .select('item_number, level, total_price')
            .eq('budget_id', budgetId)
            .order('item_number')
            .limit(50);

        if (err1) {
            const { data: items2, error: err2 } = await supabase
                .from('budget_items')
                .select('item_number, level, total')
                .eq('budget_id', budgetId)
                .order('item_number')
                .limit(50);

            if (err2) {
                console.log(`FAIL: Could not read budget_items columns. Errors: ${err1.message}, ${err2.message}`);
                return;
            }
            console.log("Fetched items (first 50):", items2?.map(i => ({ n: i.item_number, l: i.level })));
            processItems(items2, 'total');
        } else {
            console.log("Fetched items (first 50):", items?.map(i => ({ n: i.item_number, l: i.level })));
            processItems(items, 'total_price');
        }
    } catch (e) {
        console.log("FAIL: Exception", e);
    }
}

async function processItems(items: any[], totalCol: string) {
    const hasHierarchyLine = items.some(i => i.item_number && i.item_number.includes('.'));
    const maxLevel = Math.max(...items.map(i => i.level || 1));

    if (!hasHierarchyLine || maxLevel <= 1) {
        console.log("FAIL: Hierarchy criteria not met (points or level > 1)");
        return;
    }

    // 2) Choose group root
    const groupRoot = items.find(i => i.item_number.includes('.'))?.item_number.split('.')[0];

    if (!groupRoot) {
        console.log("FAIL: Group root not found");
        return;
    }

    // 3) Subtotal Grupo
    const { data: subtotalRows } = await supabase
        .from('budget_items')
        .select(totalCol)
        .eq('budget_id', budgetId)
        .filter('item_number', 'ilike', `${groupRoot}.%`);

    const subtotalGrupo = subtotalRows?.reduce((acc: number, curr: any) => acc + (Number(curr[totalCol]) || 0), 0) || 0;

    // 4) Total Geral
    const { data: allItems } = await supabase
        .from('budget_items')
        .select(totalCol)
        .eq('budget_id', budgetId);

    const totalGeral = allItems?.reduce((acc: number, curr: any) => acc + (Number(curr[totalCol]) || 0), 0) || 0;

    // 5) Peso calculations
    const randomRow = items[Math.floor(Math.random() * items.length)];
    const peso = totalGeral > 0 ? (Number(randomRow[totalCol]) || 0) / totalGeral : 0;

    // Output results as requested
    console.log(`* group_root: ${groupRoot}`);
    console.log(`* subtotal_grupo: ${subtotalGrupo.toFixed(2)}`);
    console.log(`* total_geral: ${totalGeral.toFixed(2)}`);
    console.log(`* item_number: ${randomRow.item_number} | peso: ${peso.toFixed(4)}`);

    if (groupRoot && subtotalGrupo > 0 && totalGeral > 0 && peso >= 0) {
        console.log("PASS");
    } else {
        console.log("FAIL: Unexpected zero or null values");
    }
}

run();
