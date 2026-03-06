
import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const BUDGET_ID = "c6afdfbe-b37e-4e5c-ac9c-79b4a15392a4";

async function run() {
    // Fetch ALL items
    let allItems: any[] = [];
    let offset = 0;
    while (true) {
        const { data } = await supabase.from("budget_items")
            .select("id, item_number, description, level, quantity, unit_price, total_price, code, parent_id, order_index, hydration_status, source, type, bdi")
            .eq("budget_id", BUDGET_ID).order("order_index").range(offset, offset + 999);
        if (!data || data.length === 0) break;
        allItems = allItems.concat(data);
        if (data.length < 1000) break;
        offset += 1000;
    }
    console.log(`Total items: ${allItems.length}`);

    // Count by level
    const cbl: Record<number, number> = {};
    allItems.forEach(d => { cbl[d.level] = (cbl[d.level] || 0) + 1; });
    console.log("Counts:", JSON.stringify(cbl));

    // First 60 items
    console.log("\n=== ALL ITEMS (first 60) ===");
    allItems.slice(0, 60).forEach(d => {
        console.log(`${d.item_number || '?'}\tL${d.level}\t${d.code || '-'}\tqty=${d.quantity}\tup=${d.unit_price}\ttotal=${d.total_price}\tsrc=${d.source || '-'}\t${(d.description || "").substring(0, 40)}`);
    });

    // Leaf items (qty > 0 and unit_price > 0 -- these are the "work" items)
    const leaves = allItems.filter(d => d.quantity > 0 && d.unit_price > 0);
    console.log(`\nLeaf items: ${leaves.length}`);

    // Mismatches
    const mm = leaves.filter(d => Math.abs(d.quantity * d.unit_price - d.total_price) > 0.5);
    console.log(`Mismatches total!=qty*up: ${mm.length}`);
    mm.forEach(d => {
        const exp = Math.round(d.quantity * d.unit_price * 100) / 100;
        console.log(`  ${d.item_number}\t${d.code}\tqty=${d.quantity}\tup=${d.unit_price}\ttotal=${d.total_price}\texp=${exp}`);
    });

    // Duplicates
    const nc: Record<string, number> = {};
    allItems.forEach(d => { if (d.item_number) nc[d.item_number] = (nc[d.item_number] || 0) + 1; });
    const dupes = Object.entries(nc).filter(([, c]) => c > 1);
    console.log(`\nDuplicates: ${dupes.length}`);
    dupes.forEach(([n, c]) => console.log(`  ${n} => ${c}x`));

    // Orphans
    const orphans = allItems.filter(d => d.level > 1 && !d.parent_id);
    console.log(`\nOrphans: ${orphans.length}`);

    // Items with code 92772 (item 3.3.5 in PDF)
    console.log("\n=== CODE 92772 ===");
    allItems.filter(d => d.code === '92772').forEach(d => {
        console.log(`${d.item_number}\tqty=${d.quantity}\tup=${d.unit_price}\ttotal=${d.total_price}\t${(d.description || "").substring(0, 50)}`);
    });

    // Sum of leaves
    const sumLeaves = leaves.reduce((a, d) => a + d.total_price, 0);
    console.log(`\nSum leaves: ${sumLeaves.toFixed(2)}`);

    // Sum L1
    const sumL1 = allItems.filter(d => d.level === 1).reduce((a, d) => a + (d.total_price || 0), 0);
    console.log(`Sum L1: ${sumL1.toFixed(2)}`);

    // BDI from budget
    const { data: b } = await supabase.from("budgets").select("bdi_percentage, bdi_percent, bdi, total_value").eq("id", BUDGET_ID).single();
    console.log("\nBudget BDI:", JSON.stringify(b));
}
run();
