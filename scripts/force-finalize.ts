
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ----------------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------------
const SUPABASE_URL = "https://cgebiryqfqheyazwtzzm.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY";
const JOB_ID = "3b5326ed-972a-47f5-b7d6-20678cd9c5e7";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function forceFinalize() {
    console.log(`🚀 Starting Force Finalization for Job: ${JOB_ID}`);

    // 1. Fetch Job Info
    const { data: job, error: jobErr } = await supabase.from("import_jobs").select("*").eq("id", JOB_ID).single();
    if (jobErr || !job) {
        console.error("❌ Job not found:", jobErr);
        return;
    }
    const userId = job.user_id;

    // 2. Create Budget (Idempotency skip for now, create fresh)
    console.log("➤ Creating fresh budget...");
    const { data: budget, error: budgetErr } = await supabase.from("budgets").insert({
        user_id: userId,
        name: `Orçamento Importado (Force) ${new Date().toLocaleString()}`,
        status: 'draft',
        sinapi_uf: 'BA',
        sinapi_competence: '2024-01' // Default or from job?
    }).select().single();

    if (budgetErr || !budget) {
        console.error("❌ Failed to create budget:", budgetErr);
        return;
    }
    const budgetId = budget.id;
    console.log(`✅ Budget Created: ${budgetId}`);

    // 3. Link Job to Budget
    await supabase.from("import_jobs").update({ result_budget_id: budgetId }).eq("id", JOB_ID);

    // 4. Create Roots
    const { data: root1 } = await supabase.from("budget_items").insert({
        budget_id: budgetId, user_id: userId, level: 1, description: 'IMPORTAÇÃO AUTOMÁTICA (FORCE)', type: 'group', order_index: 0
    }).select().single();

    const { data: root2 } = await supabase.from("budget_items").insert({
        budget_id: budgetId, user_id: userId, level: 2, parent_id: root1.id, description: 'ITENS DA LISTA', type: 'group', order_index: 1
    }).select().single();

    const fallbackL2Id = root2.id;

    // 5. Fetch all items
    console.log("➤ Fetching items...");
    const { data: items, error: itemsErr } = await supabase.from("import_ai_items").select("*").eq("job_id", JOB_ID).order("idx", { ascending: true });
    if (itemsErr || !items) {
        console.error("❌ Failed to fetch items:", itemsErr);
        return;
    }

    console.log(`✅ Loaded ${items.length} items. Starting processing loop...`);

    const hierarchy: Record<string, string> = {}; // path_key -> budget_item_id

    for (const item of items) {
        process.stdout.write(`\rProcessing item ${item.idx + 1}/${items.length}... `);

        let parentId = fallbackL2Id;
        const description = item.description;
        const code = item.composition_code || (description.match(/^([0-9]{4,})/) || [])[1] || '0';

        // Simplified hierarchy logic (equivalent to Structure V1)
        if (item.item_path && item.item_path.match(/^\d+(\.\d+){1,6}$/)) {
            const parts = item.item_path.split('.');
            const n1Key = parts[0];
            const n2Key = parts[0] + '.' + parts[1];

            // N1
            if (!hierarchy[n1Key]) {
                const { data: n1 } = await supabase.from("budget_items").insert({
                    budget_id: budgetId, user_id: userId, level: 1, description: `SEÇÃO ${n1Key}`, type: 'group', order_index: item.idx,
                    hydration_details: { path_key: n1Key }
                }).select().single();
                hierarchy[n1Key] = n1.id;
            }

            // N2
            if (!hierarchy[n2Key]) {
                const { data: n2 } = await supabase.from("budget_items").insert({
                    budget_id: budgetId, user_id: userId, level: 2, parent_id: hierarchy[n1Key], description: `GRUPO ${n2Key}`, type: 'group', order_index: item.idx,
                    hydration_details: { path_key: n2Key }
                }).select().single();
                hierarchy[n2Key] = n2.id;
            }
            parentId = hierarchy[n2Key];
        }

        // Skip pure section items logic
        if (code === '0' && (item.unit_price || 0) === 0 && (item.quantity || 0) === 0) {
            // Try to update section name if path_key matches
            if (item.item_path) {
                await supabase.from("budget_items").update({ description }).eq("budget_id", budgetId).eq("hydration_details->path_key", item.item_path);
            }
            continue;
        }

        // Insert Item
        const { data: insertedItem, error: insErr } = await supabase.from("budget_items").insert({
            budget_id: budgetId,
            user_id: userId,
            level: 3,
            parent_id: parentId,
            description,
            unit: item.unit || 'UN',
            quantity: item.quantity || 1,
            unit_price: item.unit_price || 0,
            total_price: (item.quantity || 1) * (item.unit_price || 0),
            final_price: (item.quantity || 1) * (item.unit_price || 0),
            type: 'insumo',
            source: item.composition_code ? 'AI_EXTRACTED_CODE' : 'IMPORTADO',
            code,
            source_import_item_id: item.id,
            order_index: item.idx
        }).select().single();

        if (insErr) {
            console.error(`\n❌ Error inserting item ${item.idx}:`, insErr);
            continue;
        }

        // Hydration via RPC (called individually to avoid timeout)
        if (code !== '0') {
            const { data: hydrated, error: hydErr } = await supabase.rpc('find_composition_in_bases', {
                p_code: code,
                p_user_id: userId,
                p_uf: 'BA',
                p_competence: '2026-02',
                p_desonerado: true
            });

            if (hydrated && Array.isArray(hydrated) && hydrated.length > 0) {
                // Insert compositions
                for (const comp of hydrated) {
                    await supabase.from("budget_item_compositions").insert({
                        budget_item_id: insertedItem.id,
                        user_id: userId,
                        description: comp.item_description,
                        unit: comp.item_unit,
                        quantity: comp.item_quantity,
                        unit_price: comp.item_price,
                        total_price: comp.item_quantity * comp.item_price,
                        metadata: { source: comp.source_base, code }
                    });
                }
                await supabase.from("budget_items").update({ hydration_status: 'internal_db' }).eq("id", insertedItem.id);
            } else {
                await supabase.from("budget_items").update({ hydration_status: 'pending_review' }).eq("id", insertedItem.id);
            }
        }
    }

    console.log("\n\n✅ Finalization Complete!");
    console.log(`Budget ID: ${budgetId}`);

    await supabase.from("import_jobs").update({ stage: 'finalized', finalized_at: new Date().toISOString() }).eq("id", JOB_ID);
}

forceFinalize();
