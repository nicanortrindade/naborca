"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const supabase_js_1 = require("@supabase/supabase-js");
const supabaseUrl = 'https://cgebiryqfqheyazwtzzm.supabase.co';
const supabaseKey = 'sb_publishable_UjW1VENfeAnDD5U6-zE2Hw_kFbT-jtE';
const budgetId = '3d037e1c-f633-4964-b917-01fe101a4185';
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
async function check() {
    const { data, error } = await supabase
        .from('budget_items_view')
        .select('*')
        .eq('budget_id', budgetId)
        .limit(1);
    console.log("View Result:", data);
    if (error)
        console.log("Error:", error);
}
check();
