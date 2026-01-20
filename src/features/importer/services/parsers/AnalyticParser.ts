
import * as XLSX from 'xlsx';

export interface AnalyticInputItem {
    parentCode: string;
    code: string;
    description: string;
    unit: string;
    coefficient: number;
    price: number;
    type: 'INSUMO' | 'COMPOSICAO';
}

export const parseAnalyticFile = async (file: File): Promise<AnalyticInputItem[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                if (rows.length === 0) {
                    resolve([]);
                    return;
                }

                // 1. Detect Header
                let headerRowIndex = -1;
                const colMap: Record<string, number> = {};

                const keywords = {
                    parentCode: ['código composição', 'cod. comp', 'pai'],
                    code: ['código', 'codigo', 'cod. insumo'], // Need to distinguish parent vs child code
                    description: ['descrição', 'insumo'],
                    unit: ['und', 'unidade'],
                    coefficient: ['coef', 'qtd', 'quantidade'],
                    price: ['preço', 'valor', 'custo'],
                    type: ['tipo']
                };

                // Search for header
                for (let i = 0; i < Math.min(rows.length, 20); i++) {
                    const row = rows[i].map(c => String(c).toLowerCase().trim());
                    // Heuristic: Must have "comp" and ("insumo" or "coef")
                    const hasComp = row.some(c => c.includes('comp') || c.includes('pai'));
                    const hasCoeff = row.some(c => c.includes('coef') || c.includes('qtd') || c.includes('quant'));

                    if (hasComp && hasCoeff) {
                        headerRowIndex = i;
                        row.forEach((cell, cellIdx) => {
                            if (cell.includes('comp') && cell.includes('cod')) colMap.parentCode = cellIdx;
                            else if (cell.includes('insumo') && cell.includes('cod')) colMap.code = cellIdx;
                            else if (keywords.code.some(k => cell === k)) colMap.code = cellIdx; // Fallback exact match
                            else if (keywords.description.some(k => cell.includes(k))) colMap.description = cellIdx;
                            else if (keywords.unit.some(k => cell.includes(k))) colMap.unit = cellIdx;
                            else if (keywords.coefficient.some(k => cell.includes(k))) colMap.coefficient = cellIdx;
                            else if (keywords.price.some(k => cell.includes(k))) colMap.price = cellIdx;
                            else if (keywords.type.some(k => cell.includes(k))) colMap.type = cellIdx;
                        });
                        break;
                    }
                }

                if (headerRowIndex === -1) {
                    // Fallback: Assume tabular structure without explicit parent column if only 1 composition?
                    // For now, require explicit structure or try to infer.
                    // Let's support a simple format: 
                    // Col A: Parent Code, Col B: Input Code, Col C: Desc, Col D: Unit, Col E: Coeff
                    colMap.parentCode = 0;
                    colMap.code = 1;
                    colMap.description = 2;
                    colMap.unit = 3;
                    colMap.coefficient = 4;
                    colMap.price = 5;
                    headerRowIndex = 0; // Assume first row is header or data starts immediately? 
                    // Safer to fail if standard headers not found for now.
                    // But for robustness, let's keep the map empty and check if populated.
                }

                if (Object.keys(colMap).length < 3) {
                    // Try standard indices
                    colMap.parentCode = 0;
                    colMap.code = 1;
                    colMap.description = 2;
                    colMap.unit = 3;
                    colMap.coefficient = 4;
                    colMap.price = 5;
                }

                const parsed: AnalyticInputItem[] = [];
                let currentParent = '';

                for (let i = headerRowIndex + 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row || row.length === 0) continue;

                    // Read Parent Code (might be merged or repeated)
                    let pCode = colMap.parentCode !== undefined ? String(row[colMap.parentCode] || '').trim() : '';

                    // Fill down parent code logic (common in Excel)
                    if (pCode) currentParent = pCode;
                    else if (currentParent) pCode = currentParent;

                    const outputCode = colMap.code !== undefined ? String(row[colMap.code] || '').trim() : '';
                    const desc = colMap.description !== undefined ? String(row[colMap.description] || '').trim() : '';

                    if (!outputCode || !desc) continue;

                    // Parse numbers
                    const parseNum = (v: any) => {
                        if (typeof v === 'number') return v;
                        if (typeof v === 'string') return parseFloat(v.replace(',', '.').trim()) || 0;
                        return 0;
                    };

                    const coeff = colMap.coefficient !== undefined ? parseNum(row[colMap.coefficient]) : 0;
                    const price = colMap.price !== undefined ? parseNum(row[colMap.price]) : 0;
                    const unit = colMap.unit !== undefined ? String(row[colMap.unit] || '').trim() : 'UN';

                    // Determine type
                    let type: 'INSUMO' | 'COMPOSICAO' = 'INSUMO';
                    // Heuristic? For now default INS

                    parsed.push({
                        parentCode: pCode,
                        code: outputCode,
                        description: desc,
                        unit,
                        coefficient: coeff,
                        price,
                        type
                    });
                }
                resolve(parsed);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsArrayBuffer(file);
    });
};
