
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cgebiryqfqheyazwtzzm.supabase.co';
const supabaseKey = 'sb_publishable_UjW1VENfeAnDD5U6-zE2Hw_kFbT-jtE';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data: budgets, error } = await supabase.from('budgets').select('id, name').limit(10);
    console.log("Budgets found:", budgets);
    if (error) console.log("Error:", error);
}

check();
