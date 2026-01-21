
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cgebiryqfqheyazwtzzm.supabase.co';
const supabaseKey = 'sb_publishable_UjW1VENfeAnDD5U6-zE2Hw_kFbT-jtE';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data } = await supabase.from('insumos').select('user_id').limit(5);
    console.log("Insumos user_ids:", data);
}

check();
