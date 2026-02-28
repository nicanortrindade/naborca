import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const supabaseUrl = "https://cgebiryqfqheyazwtzzm.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkExternalBases() {
    console.log("--- External Price Bases ---");
    const { data: bases, error: errorBases } = await supabase
        .from("external_price_bases")
        .select("*");

    if (errorBases) console.error("Error fetching bases:", errorBases);
    else console.log(JSON.stringify(bases, null, 2));

    console.log("\n--- External Price Items (First 5) ---");
    const { data: items, error: errorItems } = await supabase
        .from("external_price_items")
        .select("*")
        .limit(5);

    if (errorItems) console.error("Error fetching items:", errorItems);
    else console.log(JSON.stringify(items, null, 2));

    const { count, error: errorCount } = await supabase
        .from("external_price_items")
        .select("*", { count: 'exact', head: true });

    if (errorCount) console.error("Error counting items:", errorCount);
    else console.log(`\nTotal items: ${count}`);
}

checkExternalBases();
