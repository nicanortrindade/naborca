
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateExcelSyntheticBuffer, ExportData, ExportItem } from '../src/utils/budgetExport';

// Polyfill required for Node.js execution
if (typeof window === 'undefined') {
    (global as any).window = global;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

async function main() {
    console.log("Starting Test: Excel Export Synthetic (Node.js)");

    // ---------------------------------------------------------
    // DATA RETRIEVAL (MOCK OR LIVE)
    // ---------------------------------------------------------
    let exportData: ExportData | null = null;
    let selectedBudget: any = null;

    const REQUIRE_REAL_BUDGET = process.env.REQUIRE_REAL_BUDGET === '1';

    // Prioritize Service Role Key for stronger access (Bypass RLS)
    const activeKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    const activeUrl = process.env.SUPABASE_URL;

    if (!activeUrl || !activeKey) {
        if (REQUIRE_REAL_BUDGET) {
            console.error("FAIL: Strict Mode (REQUIRE_REAL_BUDGET=1) requires valid credentials.");
            process.exit(1);
        }
        console.warn("WARN: Missing SUPABASE credentials. Using MOCK data.");
        // Mock Logic
        selectedBudget = { id: 'mock', name: 'Mock Budget', client_name: 'Client Mock', bdi: 20, encargos: 85 };
        const mockItems = [
            { itemNumber: '1', description: 'Group 1', type: 'group' },
            { itemNumber: '1.1', description: 'Item 1.1', unit: 'm2', quantity: 10, unitPrice: 100, type: 'insumo', code: 'C1' },
            { itemNumber: '1.2', description: 'Item 1.2', unit: 'm3', quantity: 5, unitPrice: 200, type: 'insumo', code: 'C2' },
            { itemNumber: '2', description: 'Group 2', type: 'group' },
            { itemNumber: '2.1', description: 'Item 2.1', unit: 'kg', quantity: 50, unitPrice: 10, type: 'insumo', code: 'C3' }
        ];

        const processedMockItems = mockItems.map(i => {
            const qty = i.quantity || 0;
            const unitVal = i.unitPrice || 0;
            const total = qty * unitVal;
            return {
                id: i.itemNumber, itemNumber: i.itemNumber, description: i.description, type: i.type,
                code: i.code || '', unit: i.unit || '', quantity: qty, unitPrice: unitVal,
                unitPriceWithBDI: unitVal, totalPrice: total, finalPrice: total,
                source: 'SINAPI', level: (i.itemNumber.match(/\./g) || []).length + 1
            } as ExportItem;
        });
        processedMockItems.forEach(i => { if (i.type === 'group') { i.totalPrice = 0; i.finalPrice = 0; } });

        exportData = {
            budgetName: selectedBudget.name, clientName: selectedBudget.client_name, date: new Date(),
            bdi: selectedBudget.bdi, encargos: selectedBudget.encargos, items: processedMockItems,
            companySettings: {
                name: 'Mock Co',
                responsibleName: 'Mock Eng',
                phone: '(11) 99999-9999',
                email: 'mock@example.com'
            },
            banksUsed: { sinapi: { mes: '01/2025', estado: 'SP' } }
        };

    } else {
        const supabase = createClient(activeUrl, activeKey);

        console.log(`Connecting to Supabase (Strict Mode: ${REQUIRE_REAL_BUDGET})...`);

        // 1. Fetch Budgets (Deep Search)
        // Fetch simplified list first
        const { data: budgets, error: budgetError } = await supabase
            .from('budgets')
            .select('*') // Select all to be safe on column names
            .order('created_at', { ascending: false })
            .limit(100); // Look at last 100

        if (budgetError && REQUIRE_REAL_BUDGET) {
            console.error("FAIL: Strict Mode - Could not fetch budgets.", budgetError);
            process.exit(1);
        }

        let items: any[] = [];
        selectedBudget = null;

        // Strategy 1: Real Budgets - Efficient Search
        if (budgets && budgets.length > 0) {
            console.log(`Scanning ${budgets.length} budgets for one with > 20 items...`);

            for (const b of budgets) {
                // Check count first (lightweight)
                const { count, error: countErr } = await supabase
                    .from('budget_items')
                    .select('*', { count: 'exact', head: true })
                    .eq('budget_id', b.id);

                if (countErr) continue;

                if (count !== null && count >= 20) {
                    // Promising budget, fetch actual items
                    const { data: bItems, error: itemsErr } = await supabase
                        .from('budget_items')
                        .select('*')
                        .eq('budget_id', b.id);

                    if (itemsErr || !bItems) continue;

                    // Check hierarchy
                    const hasHierarchy = bItems.some((i: any) => i.item_number && i.item_number.includes('.'));

                    if (hasHierarchy) {
                        selectedBudget = b;
                        items = bItems;
                        console.log(`Match found: ${b.name} (${count} items)`);
                        break;
                    }
                }
            }
        }

        if (!selectedBudget && REQUIRE_REAL_BUDGET) {
            console.error("FAIL: Strict Mode - No suitable REAL budget found (checked 100 budgets).");
            process.exit(1);
        }

        // Strategy 2: Simulated (Only if NON-STRICT)
        if (!selectedBudget) {
            console.log("WARN: Could not find suitable 'budgets'. Using Simulated Real Data (Insumos)...");

            const { data: insumos, error: insError } = await supabase
                .from('insumos')
                .select('*')
                .limit(40);

            if (insError || !insumos || insumos.length === 0) {
                console.error("FAIL: Could not fetch 'insumos' fallback.", insError);
                process.exit(1);
            }

            selectedBudget = { id: 'simulated-real-data', name: 'Simulated Budget', client_name: 'Supabase Data', bdi: 20, encargos: 0 };
            items = insumos.map((ins, idx) => ({
                id: ins.id, item_number: idx === 0 ? '1' : `1.${idx}`,
                code: ins.code, description: idx === 0 ? "GRUPO (SIM)" : ins.description,
                unit: ins.unit, quantity: idx === 0 ? 0 : 10, unit_price: idx === 0 ? 0 : (ins.price || 100),
                type: idx === 0 ? 'group' : 'insumo', source: ins.source || 'SINAPI'
            }));
        }

        console.log(`Selected Budget: ${selectedBudget.name} (${selectedBudget.id}) with ${items.length} items`);

        // Map to ExportItem
        const exportItems: ExportItem[] = items.map((i: any) => ({
            id: i.id,
            itemNumber: i.item_number,
            code: i.code || '',
            description: i.description || '',
            unit: i.unit || '',
            quantity: Number(i.quantity) || 0,
            unitPrice: Number(i.unit_price) || 0,
            totalPrice: (Number(i.quantity) || 0) * (Number(i.unit_price) || 0),
            // Use simple logic or real DB fields if populated (final_price usually calc on FE)
            // Ideally we should replicate FE logic or trust inputs. 
            // For synthetic export test, layout is key.
            finalPrice: (Number(i.quantity) || 0) * (Number(i.unit_price) || 0) * (1 + (Number(selectedBudget.bdi) || 0) / 100),
            unitPriceWithBDI: Number(i.unit_price) * (1 + (Number(selectedBudget.bdi) || 0) / 100),
            type: i.type || 'service',
            source: i.source || 'SINAPI',
            level: (i.item_number.match(/\./g) || []).length + 1
        }));

        // Sort items by itemNumber (Essential for Group Logic)
        exportItems.sort((a, b) => a.itemNumber.localeCompare(b.itemNumber, undefined, { numeric: true }));

        exportData = {
            budgetName: selectedBudget.name,
            clientName: selectedBudget.client_name || 'Test Client',
            date: new Date(),
            bdi: Number(selectedBudget.bdi) || 0,
            encargos: Number(selectedBudget.encargos) || 0,
            items: exportItems,
            companySettings: { name: 'Test Company', responsibleName: 'Test Engineer', responsibleCrea: '123' },
            banksUsed: { sinapi: { mes: '01/2024', estado: 'SP' } }
        };
    }

    // 3. Generate Excel
    console.log("Generating Excel buffer...");
    let buffer: ArrayBuffer;
    try {
        buffer = await generateExcelSyntheticBuffer(exportData);
    } catch (e) {
        console.error("FAIL: Exception during excel generation.", e);
        process.exit(1);
    }

    // 4. Write to File
    const tmpDir = path.resolve('tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
    const filePath = path.join(tmpDir, 'sintetico-gerado.xlsx');
    fs.writeFileSync(filePath, Buffer.from(buffer));
    console.log(`File written to ${filePath}`);

    // 5. Validation using ExcelJS
    console.log("Validating generated Excel...");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.getWorksheet('Sintético');

    if (!ws) {
        console.error("FAIL: Worksheet 'Sintético' not found.");
        process.exit(1);
    }

    // V1: Find Header Row dynamically (standard header takes more rows)
    let headerRowNum = -1;
    for (let r = 1; r <= 30; r++) {
        const row = ws.getRow(r);
        if (row.getCell(1).value === 'Item') {
            headerRowNum = r;
            break;
        }
    }

    if (headerRowNum === -1) {
        console.error("FAIL: Table Header ('Item') not found in first 30 rows.");
        process.exit(1);
    }

    const headerRow = ws.getRow(headerRowNum).values as any[];
    const expectedHeaders = [
        null, 'Item', 'Código', 'Banco', 'Descrição', 'Und', 'Quant.', 'Valor Unit', 'Valor Unit com BDI', 'Total', 'Peso (%)'
    ];

    const headersMatch = expectedHeaders.every((val, idx) => {
        if (idx === 0) return true;
        return headerRow[idx] === val;
    });

    if (!headersMatch) {
        console.log("Found Headers:", headerRow);
        console.error(`FAIL: Header row mismatch at row ${headerRowNum}.`);
        process.exit(1);
    }

    // V2: Top Content
    let topValues = "";
    for (let r = 1; r < headerRowNum; r++) {
        topValues += " " + ws.getRow(r).values.toString();
    }
    const requiredStrings = [
        "OBRA",
        "BASES",
        "BDI",
        "ENCARGOS SOCIAIS",
        "CNPJ",
        "RESPONSÁVEL TÉCNICO",
        "CREA/CAU",
        "CPF",
        "CONTATO"
    ];
    const missingStrings = requiredStrings.filter(s => !topValues.toUpperCase().includes(s));

    if (missingStrings.length > 0) {
        console.error("FAIL: Missing top strings:", missingStrings);
        process.exit(1);
    }

    // V3: Group Logic & Totals
    let foundGroup = false;
    let grandTotal = 0;

    ws.eachRow((row, rowNumber) => {
        const descCell = row.getCell(6).value?.toString() || '';
        if (descCell.toUpperCase().includes('TOTAL GERAL')) {
            grandTotal = Number(row.getCell(8).value);
        }
    });

    if (!grandTotal || grandTotal <= 0) {
        console.error("FAIL: Total Geral found is zero or missing.");
        process.exit(1);
    }

    ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 4) return;

        const quant = Number(row.getCell(6).value);
        const total = Number(row.getCell(9).value);
        const weight = Number(row.getCell(10).value);

        if (quant === 1 && total > 0 && weight > 0) {
            foundGroup = true;
        }
    });

    if (!foundGroup) {
        console.error("FAIL: No Group-like row found (Quant=1, Total>0, Weight>0). Make sure calculations worked.");
        process.exit(1);
    }

    // V4: Final Totals Labels
    let foundSemBDI = false;
    let foundDoBDI = false;
    let foundGeral = false;

    ws.eachRow((row, rowNumber) => {
        const label = row.getCell(6).value?.toString() || '';
        if (label === 'Total sem BDI') foundSemBDI = true;
        if (label === 'Total do BDI') foundDoBDI = true;
        if (label === 'Total Geral') foundGeral = true;
    });

    if (!foundSemBDI || !foundDoBDI || !foundGeral) {
        console.error(`FAIL: Missing Final Totals. Found: SemBDI=${foundSemBDI}, DoBDI=${foundDoBDI}, Geral=${foundGeral}`);
        process.exit(1);
    }

    console.log("PASS");
    console.log(`Budget Used: ${selectedBudget.id}`);
}

main().catch(err => {
    console.error("FATAL:", err);
    process.exit(1);
});
