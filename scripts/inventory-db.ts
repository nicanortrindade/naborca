
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cgebiryqfqheyazwtzzm.supabase.co';
const supabaseKey = 'sb_publishable_UjW1VENfeAnDD5U6-zE2Hw_kFbT-jtE';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const tables = ['budgets', 'budget_items', 'insumos', 'compositions'];
    for (const t of tables) {
        const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
        console.log(`Table ${t}: ${count} (Error: ${error?.message})`);
    }
}

check();
