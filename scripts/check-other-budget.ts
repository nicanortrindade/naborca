
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cgebiryqfqheyazwtzzm.supabase.co';
const supabaseKey = 'sb_publishable_UjW1VENfeAnDD5U6-zE2Hw_kFbT-jtE';
const budgetId = 'a65f250a-98ab-47cb-89b5-c1c14e6f4c72';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data } = await supabase.from('budget_items').select('id').eq('budget_id', budgetId);
    console.log("Items for a65f25...:", data?.length);
}

check();
