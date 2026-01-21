
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cgebiryqfqheyazwtzzm.supabase.co';
const supabaseKey = 'sb_publishable_UjW1VENfeAnDD5U6-zE2Hw_kFbT-jtE';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase.from('budgets').select('id, name').limit(10);
    console.log("Budgets found:", data);
    if (error) console.error("Error fetching budgets:", error);
}

check();
