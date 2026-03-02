import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUDGET_ID = "bbdd1669-6fee-45a0-bb06-817d794ffc0b";
// Job a774a69c (prefixo — precisamos do UUID completo)
// Vamos buscar pelo prefixo via import_ai_items

const lines: string[] = [];
function log(msg: string) {
    lines.push(msg);
    process.stdout.write(msg + "\n");
}

async function main() {
    // --- Q1: INFRAESTRUTURA duplicados ---
    log("=== QUERY 1: INFRAESTRUTURA N1 duplicates ===");
    const { data: infra, error: e1 } = await supabase
        .from("budget_items")
        .select("id, description, level, order_index, hydration_details")
        .eq("budget_id", BUDGET_ID)
        .eq("level", 1)
        .ilike("description", "%INFRAESTRUTURA%");
    if (e1) log("Error Q1: " + e1.message);
    else {
        log(`Found ${infra?.length || 0} rows:`);
        for (const row of infra || []) {
            log(JSON.stringify({
                id: row.id,
                description: row.description,
                order_index: row.order_index,
                path_key: (row.hydration_details as any)?.path_key ?? "NULL"
            }));
        }
    }

    // --- Q2: All N1 groups ---
    log("\n=== QUERY 2: All N1 groups (level=1) ordered ===");
    const { data: allN1, error: e2 } = await supabase
        .from("budget_items")
        .select("id, description, level, order_index, hydration_details")
        .eq("budget_id", BUDGET_ID)
        .eq("level", 1)
        .order("order_index", { ascending: true });
    if (e2) log("Error Q2: " + e2.message);
    else {
        log(`Found ${allN1?.length || 0} N1 groups:`);
        for (const row of allN1 || []) {
            log(JSON.stringify({
                order_index: row.order_index,
                description: row.description,
                path_key: (row.hydration_details as any)?.path_key ?? "NULL"
            }));
        }
    }

    // --- Q3: TOTAL SEM BDI (em budget_items) ---
    log("\n=== QUERY 3: 'Total sem BDI' items in budget_items ===");
    const { data: totals, error: e3 } = await supabase
        .from("budget_items")
        .select("id, description, level, order_index, type, quantity, unit_price")
        .eq("budget_id", BUDGET_ID)
        .or("description.ilike.%TOTAL SEM BDI%,description.ilike.%TOTAL COM BDI%,description.ilike.%TOTAL GERAL%");
    if (e3) log("Error Q3: " + e3.message);
    else {
        log(`Found ${totals?.length || 0} 'TOTAL' items:`);
        for (const row of totals || []) {
            log(JSON.stringify({
                description: (row.description as string)?.substring(0, 80),
                level: row.level,
                order_index: row.order_index,
                type: row.type,
                qty: row.quantity,
                price: row.unit_price
            }));
        }
    }

    // --- Q4: CPU2555 ---
    log("\n=== QUERY 4: CPU2555 item details in budget_items ===");
    const { data: cpu2555, error: e4 } = await supabase
        .from("budget_items")
        .select("id, description, code, level, order_index, quantity, unit_price, total_price, unit, hydration_details")
        .eq("budget_id", BUDGET_ID)
        .eq("code", "CPU2555");
    if (e4) log("Error Q4: " + e4.message);
    else {
        log(`Found ${cpu2555?.length || 0} CPU2555 items:`);
        for (const row of cpu2555 || []) {
            log(JSON.stringify({
                description: (row.description as string)?.substring(0, 100),
                code: row.code,
                qty: row.quantity,
                price: row.unit_price,
                total: row.total_price,
                unit: row.unit,
                path_key: (row.hydration_details as any)?.path_key
            }));
        }
    }

    // --- Q5: Section 5 (COBERTURA) context ---
    log("\n=== QUERY 5: Section 5 (COBERTURA/TELHAMENTO) groups ===");
    const { data: allGroups, error: e5 } = await supabase
        .from("budget_items")
        .select("id, description, level, order_index, hydration_details")
        .eq("budget_id", BUDGET_ID)
        .in("level", [1, 2])
        .order("order_index", { ascending: true });
    if (e5) log("Error Q5: " + e5.message);
    else {
        const sec5 = (allGroups || []).filter((r: any) => {
            const pk = (r.hydration_details as any)?.path_key ?? '';
            return pk === '5' || pk.startsWith('5.');
        });
        log(`Found ${sec5.length} items in section 5:`);
        for (const row of sec5) {
            log(JSON.stringify({
                order_index: row.order_index,
                level: row.level,
                description: (row.description as string)?.substring(0, 60),
                path_key: (row.hydration_details as any)?.path_key ?? "NULL"
            }));
        }
    }

    // --- Q6: import_ai_items section titles ---
    log("\n=== QUERY 6: import_ai_items with item_path IN ('2','5','9') ===");
    const { data: sectionTitles, error: e6 } = await supabase
        .from("import_ai_items")
        .select("id, description, composition_code, item_path, quantity, unit_price, idx, job_id")
        .in("item_path", ["2", "5", "9"])
        .order("idx", { ascending: true })
        .limit(30);
    if (e6) log("Error Q6: " + e6.message);
    else {
        log(`Found ${sectionTitles?.length || 0} items:`);
        for (const row of sectionTitles || []) {
            log(JSON.stringify({
                idx: row.idx,
                item_path: row.item_path,
                description: (row.description as string)?.substring(0, 70),
                code: row.composition_code,
                qty: row.quantity,
                price: row.unit_price,
                job_id: (row.job_id as string)?.substring(0, 8)
            }));
        }
    }

    // --- Q7: "Total sem BDI" in import_ai_items ---
    log("\n=== QUERY 7: 'Total sem BDI' in import_ai_items ===");
    const { data: totalAi, error: e7 } = await supabase
        .from("import_ai_items")
        .select("id, description, composition_code, item_path, quantity, unit_price, idx, job_id")
        .ilike("description", "%total sem bdi%")
        .limit(10);
    if (e7) log("Error Q7: " + e7.message);
    else {
        log(`Found ${totalAi?.length || 0} items:`);
        for (const row of totalAi || []) {
            log(JSON.stringify({
                idx: row.idx,
                item_path: row.item_path,
                description: (row.description as string)?.substring(0, 80),
                code: row.composition_code,
                job_id: (row.job_id as string)?.substring(0, 8)
            }));
        }
    }

    // --- Q8: Full job_id lookup (prefix a774a69c) ---
    log("\n=== QUERY 8: Resolve job_id prefix 'a774a69c' ===");
    const { data: jobRow, error: e8 } = await supabase
        .from("import_jobs")
        .select("id, stage, result_budget_id, created_at")
        .ilike("id", "a774a69c%")
        .limit(3);
    if (e8) log("Error Q8: " + e8.message);
    else {
        log(`Found ${jobRow?.length || 0} jobs:`);
        for (const row of jobRow || []) {
            log(JSON.stringify({ id: row.id, stage: row.stage, budget_id: row.result_budget_id, created_at: row.created_at }));
        }
    }

    const outputPath = path.resolve(process.cwd(), "scripts", "phase3_query_results.txt");
    fs.writeFileSync(outputPath, lines.join("\n"), "utf-8");
    log("\nResults also written to: " + outputPath);
}

main().catch(e => { process.stderr.write(String(e)); process.exit(1); });
