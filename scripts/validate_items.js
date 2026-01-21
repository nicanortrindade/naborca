
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://cgebiryqfqheyazwtzzm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UjW1VENfeAnDD5U6-zE2Hw_kFbT-jtE'; // Anon key from .env.local

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const budgetId = 'a65f250a-98ab-47cb-89b5-c1c14e6f4c72';

async function checkItems() {
    console.log(`Checking items for budget: ${budgetId}`);

    const { data, error } = await supabase
        .from('budget_items')
        .select('*')
        .eq('budget_id', budgetId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching items:', error);
        return;
    }

    console.log(`Found ${data.length} items.`);
    console.table(data);

    // Validation logic
    let hasIns = false;
    let hasCpu = false;

    data.forEach(item => {
        if (item.composition_id) {
            console.log(`[CPU] Item ${item.description.substring(0, 30)}... has COMPOSITION_ID: ${item.composition_id}`);
            hasCpu = true;
        } else {
            console.log(`[INS] Item ${item.description.substring(0, 30)}... (No Composition ID)`);
            hasIns = true;
        }
    });

    if (hasIns && hasCpu) {
        console.log("VALIDATION: PASS - Both INS and CPU types found correctly.");
    } else {
        console.log("VALIDATION: PARTIAL/FAIL - Missing one type.");
    }
}

checkItems();
