
import * as XLSX from 'xlsx';
import type { ParsedItem } from '../../types';

// Helper: Normalize PT-BR numbers (1.234,56 -> 1234.56)
const parseNumber = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    if (typeof val === 'string') {
        // Remove spaces, dots, replace comma with dot
        const clean = val.trim().replace(/\./g, '').replace(',', '.').replace('%', '');
        const num = parseFloat(clean);
        return isNaN(num) ? 0 : num;
    }
    return 0;
};

const getLevel = (itemNumber: string): number => {
    if (!itemNumber) return 1;
    return itemNumber.split('.').length;
};

export const parseExcelFile = async (file: File): Promise<ParsedItem[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Convert to array of arrays
                const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                if (rows.length === 0) {
                    resolve([]);
                    return;
                }

                // 1. Detect Header Row
                let headerRowIndex = -1;
                const colMap: Record<string, number> = {};

                const keywords = {
                    itemNumber: ['item', 'item.'],
                    code: ['código', 'codigo', 'ref'],
                    bank: ['banco', 'fonte', 'base'],
                    description: ['descrição', 'descricao', 'discriminação'],
                    unit: ['unid', 'und', 'unidade'],
                    quantity: ['qtd', 'quant', 'quantidade'],
                    unitPrice: ['unitário', 'v.unit', 'valor unit'],
                    totalPrice: ['total', 'valor total', 'v.total'],
                    peso: ['peso', '%']
                };

                for (let i = 0; i < Math.min(rows.length, 20); i++) {
                    const row = rows[i].map(c => String(c).toLowerCase().trim());
                    // Heuristic: row must have at least "item" or "código" or "descrição" AND "total" or "unit"
                    const hasMain = row.some(c => keywords.itemNumber.some(k => c.includes(k)) || keywords.code.some(k => c.includes(k)));
                    const hasValue = row.some(c => keywords.totalPrice.some(k => c.includes(k)) || keywords.unitPrice.some(k => c.includes(k)));

                    if (hasMain && hasValue) {
                        headerRowIndex = i;
                        // Build Map
                        row.forEach((cell, cellIdx) => {
                            if (keywords.itemNumber.some(k => cell.includes(k))) colMap.itemNumber = cellIdx;
                            else if (keywords.code.some(k => cell.includes(k))) colMap.code = cellIdx;
                            else if (keywords.bank.some(k => cell.includes(k))) colMap.bank = cellIdx;
                            else if (keywords.description.some(k => cell.includes(k))) colMap.description = cellIdx;
                            else if (keywords.unit.some(k => cell.includes(k))) colMap.unit = cellIdx;
                            else if (keywords.quantity.some(k => cell.includes(k))) colMap.quantity = cellIdx;
                            else if (keywords.unitPrice.some(k => cell.includes(k)) && !cell.includes('total')) colMap.unitPrice = cellIdx;
                            else if (keywords.totalPrice.some(k => cell.includes(k))) colMap.totalPrice = cellIdx;
                            else if (keywords.peso.some(k => cell.includes(k))) colMap.peso = cellIdx;
                        });
                        break;
                    }
                }

                if (headerRowIndex === -1) {
                    throw new Error("Não foi possível detectar o cabeçalho da planilha. Verifique se há colunas ITEM, DESCRIÇÃO e VALOR.");
                }

                const parsedItems: ParsedItem[] = [];

                // Iterate Data Rows
                for (let i = headerRowIndex + 1; i < rows.length; i++) {
                    const row = rows[i];

                    // Skip empty rows (must have description)
                    const desc = row[colMap.description] ? String(row[colMap.description]).trim() : '';
                    if (!desc) continue;

                    const itemNumber = colMap.itemNumber !== undefined ? String(row[colMap.itemNumber] || '').trim() : '';
                    const code = colMap.code !== undefined ? String(row[colMap.code] || '').trim() : '';
                    const bank = colMap.bank !== undefined ? String(row[colMap.bank] || '').trim().toUpperCase() : undefined;

                    const unit = colMap.unit !== undefined ? String(row[colMap.unit] || '').trim() : '';
                    const quantity = colMap.quantity !== undefined ? parseNumber(row[colMap.quantity]) : 0;
                    const unitPrice = colMap.unitPrice !== undefined ? parseNumber(row[colMap.unitPrice]) : 0;
                    const totalPrice = colMap.totalPrice !== undefined ? parseNumber(row[colMap.totalPrice]) : 0;

                    // Determine Level / Group
                    // If code is empty and quantity/unit empty => Group (Header)
                    // Or check itemNumber dots
                    let level = 1;
                    if (itemNumber) {
                        level = getLevel(itemNumber);
                    } else {
                        // Infer by indentation or context? 
                        // For now default to 1.
                    }

                    // Heuristic: Group if code is empty AND total > 0 (subtotal) 
                    // OR if unit/quantity is 0/empty.
                    const isLikelyGroup = !code && !unit && !quantity;

                    // Add to list
                    parsedItems.push({
                        originalIndex: i,
                        itemNumber,
                        level,
                        code: isLikelyGroup ? '' : code,
                        description: desc,
                        unit: isLikelyGroup ? '' : unit,
                        quantity: isLikelyGroup ? 0 : quantity,
                        unitPrice: isLikelyGroup ? 0 : unitPrice,
                        totalPrice: totalPrice, // Group may have total
                        detectedSource: bank
                    });
                }

                resolve(parsedItems);

            } catch (err) {
                reject(err);
            }
        };

        reader.onerror = (err) => reject(err);
        reader.readAsArrayBuffer(file);
    });
};
