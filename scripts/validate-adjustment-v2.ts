
import { createClient } from '@supabase/supabase-js';
import { BudgetService } from '../src/lib/supabase-services/BudgetService';

// We need to bypass the Auth check in BudgetService for the script
// Or just use the supabase client directly for the functional test of the data structure.
// The user wants to see the JSON saved in the DB.

const supabaseUrl = 'https://cgebiryqfqheyazwtzzm.supabase.co';
const supabaseKey = 'sb_publishable_UjW1VENfeAnDD5U6-zE2Hw_kFbT-jtE';
const budgetId = '3d037e1c-f633-4964-b917-01fe101a4185';

const supabase = createClient(supabaseUrl, supabaseKey);

async function validate() {
    console.log("--- STARTING VALIDATION V2 ---");

    // Check if budget exists/visible
    const { data: initialBudget, error: fetchError } = await supabase
        .from('budgets')
        .select('*')
        .eq('id', budgetId)
        .single();

    if (fetchError || !initialBudget) {
        console.error("FAIL: Budget not accessible via Anon Key. Skipping functional DB test.");
        console.error("Error Bruto:", fetchError);
        process.exit(1);
    }

    const originalSettings = initialBudget.settings || {};
    console.log("Original Settings Keys:", Object.keys(originalSettings));

    // TEST A: mode=materials_only, kind=percentage, value=10
    console.log("\n[TEST A] Applying 10% on materials...");
    const payloadA = {
        settings: {
            ...originalSettings,
            global_adjustment_v2: {
                mode: 'materials_only',
                kind: 'percentage',
                value: 10
            }
        }
    };

    const { error: errorA } = await supabase.from('budgets').update(payloadA).eq('id', budgetId);
    if (errorA) {
        console.error("FAIL TEST A:", errorA.message);
        process.exit(1);
    }

    const { data: budgetA } = await supabase.from('budgets').select('settings').eq('id', budgetId).single();
    console.log("settings.global_adjustment_v2 após A:", JSON.stringify(budgetA?.settings?.global_adjustment_v2));

    // TEST B: mode=materials_only, kind=fixed_target_total, value=1000000
    console.log("\n[TEST B] Applying fixed target total 1.000.000 on materials...");
    const payloadB = {
        settings: {
            ...budgetA?.settings,
            global_adjustment_v2: {
                mode: 'materials_only',
                kind: 'fixed_target_total',
                value: 1000000
            }
        }
    };

    const { error: errorB } = await supabase.from('budgets').update(payloadB).eq('id', budgetId);
    if (errorB) {
        console.error("FAIL TEST B:", errorB.message);
        process.exit(1);
    }

    const { data: budgetB } = await supabase.from('budgets').select('settings').eq('id', budgetId).single();
    console.log("settings.global_adjustment_v2 após B:", JSON.stringify(budgetB?.settings?.global_adjustment_v2));

    // Verify other keys weren't lost
    const finalKeys = Object.keys(budgetB?.settings || {});
    if (Object.keys(originalSettings).every(k => finalKeys.includes(k))) {
        console.log("\nPASS: Settings keys preserved.");
    } else {
        console.log("\nFAIL: Keys lost in settings merge.");
    }
}

validate().catch(err => {
    console.error("CRITICAL ERROR:", err);
    process.exit(1);
});
