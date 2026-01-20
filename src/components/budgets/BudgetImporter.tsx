
import React, { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Check, X, FileSpreadsheet, FileCheck, Info } from 'lucide-react';
import { clsx } from 'clsx';
import { BudgetService } from '../../lib/supabase-services/BudgetService';
import { BudgetItemService } from '../../lib/supabase-services/BudgetItemService';

interface ImporterProps {
    onClose: () => void;
    onSuccess: (budgetId: string) => void;
}

interface ParsedRow {
    itemNumber: string;
    code: string;
    description: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    type: 'etapa' | 'insumo' | 'composicao' | 'material' | 'labor'; // Using internally as 'etapa', 'composicao' (project default), 'insumo'
    level: number;
    source: string;
}

const BudgetImporter: React.FC<ImporterProps> = ({ onClose, onSuccess }) => {
    const [step, setStep] = useState(1);
    const [file, setFile] = useState<File | null>(null);
    // const [previewData, setPreviewData] = useState<any[][]>([]); // Removing unused state
    const [processedPreview, setProcessedPreview] = useState<ParsedRow[]>([]); // Processed hierarchical data

    // Raw headers found in the file
    const [headers, setHeaders] = useState<any[]>([]);
    const [fullData, setFullData] = useState<any[][]>([]); // Keep full data in memory to re-process on map change

    const [loading, setLoading] = useState(false);

    // Extracted Metadata
    const [budgetName, setBudgetName] = useState('');
    const [clientName, setClientName] = useState('');
    const [bdi, setBdi] = useState(0);

    const [isDragging, setIsDragging] = useState(false);

    // Column Mapping
    const [mapping, setMapping] = useState({
        itemNumber: -1,
        code: -1,
        description: -1,
        unit: -1,
        quantity: -1,
        unitPrice: -1,
        totalPrice: -1,
        type: -1,
        source: -1
    });

    const fileInputRef = useRef<HTMLInputElement>(null);

    // -------------------------------------------------------------------------
    // 1. HELPER: Recalculate Range (Fix for "Single Column" Bug)
    // -------------------------------------------------------------------------
    const updateSheetRange = (worksheet: XLSX.WorkSheet) => {
        const range = { s: { c: 10000000, r: 10000000 }, e: { c: 0, r: 0 } };
        const keys = Object.keys(worksheet).filter(x => x.charAt(0) !== '!');
        if (keys.length === 0) return;

        keys.forEach(key => {
            const cell = XLSX.utils.decode_cell(key);
            if (cell.c < range.s.c) range.s.c = cell.c;
            if (cell.r < range.s.r) range.s.r = cell.r;
            if (cell.c > range.e.c) range.e.c = cell.c;
            if (cell.r > range.e.r) range.e.r = cell.r;
        });
        worksheet['!ref'] = XLSX.utils.encode_range(range);
    };

    // -------------------------------------------------------------------------
    // 2. LOGIC: Scan for Metadata (Name, Client, BDI)
    // -------------------------------------------------------------------------
    const scanForMetadata = (data: any[][]) => {
        let extractedName = '';
        let extractedClient = '';
        let extractedBdi = 0;

        // Scan first 20 rows
        for (let i = 0; i < Math.min(20, data.length); i++) {
            const row = data[i];
            if (!Array.isArray(row)) continue;

            const rowStr = row.join(' ').toLowerCase();

            // Budget Name (Project/Obra)
            if (!extractedName && (rowStr.includes('projeto:') || rowStr.includes('obra:') || rowStr.includes('descrição da obra:'))) {
                // Try to get text after colon
                const parts = rowStr.split(':');
                if (parts[1] && parts[1].trim().length > 3) {
                    // Found in same cell or concatenated string
                    // Need to find the original cell to get proper casing
                    const cellIndex = row.findIndex(c => String(c).toLowerCase().includes('projeto:') || String(c).toLowerCase().includes('obra:'));
                    if (cellIndex !== -1) {
                        const cellVal = String(row[cellIndex]);
                        const splitVal = cellVal.split(':');
                        if (splitVal[1] && splitVal[1].trim()) extractedName = splitVal[1].trim();
                        else if (row[cellIndex + 1]) extractedName = String(row[cellIndex + 1]).trim();
                    }
                }
            }
            if (!extractedName && row[0] && String(row[0]).toUpperCase().includes('PLANILHA ORÇAMENTÁRIA')) {
                // Often the specific name is on the next line
                if (data[i + 1] && data[i + 1][0]) extractedName = String(data[i + 1][0]);
            }

            // Client
            if (!extractedClient && (rowStr.includes('cliente:') || rowStr.includes('proprietário:'))) {
                const cellIndex = row.findIndex(c => String(c).toLowerCase().includes('cliente') || String(c).toLowerCase().includes('proprietário'));
                if (cellIndex !== -1) {
                    const cellVal = String(row[cellIndex]);
                    const splitVal = cellVal.split(':');
                    if (splitVal[1] && splitVal[1].trim()) extractedClient = splitVal[1].trim();
                    else if (row[cellIndex + 1]) extractedClient = String(row[cellIndex + 1]).trim();
                }
            }

            // BDI
            if (extractedBdi === 0 && rowStr.includes('bdi:')) {
                const bdiMatch = rowStr.match(/bdi[:\s]*([\d,.]+)/);
                if (bdiMatch && bdiMatch[1]) {
                    extractedBdi = parseFloat(bdiMatch[1].replace(',', '.'));
                }
            }
        }

        if (extractedName) setBudgetName(extractedName);
        if (extractedClient) setClientName(extractedClient);
        if (extractedBdi) setBdi(extractedBdi);
    };

    const findHeaderRow = (data: any[][]) => {
        let bestRow = -1;
        let maxMatches = 0;

        for (let i = 0; i < Math.min(100, data.length); i++) {
            const row = data[i];
            if (!Array.isArray(row)) continue;

            let matches = 0;
            const normalizedRow = row.map(c => String(c || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));

            // Check if row contains critical headers
            if (normalizedRow.some(c => c.includes('item'))) matches++;
            if (normalizedRow.some(c => c.includes('descri'))) matches++;
            if (normalizedRow.some(c => c.includes('unid') || c === 'un')) matches++;
            if (normalizedRow.some(c => c.includes('quant') || c === 'qtd')) matches++;
            if (normalizedRow.some(c => c.includes('preco') || c.includes('valor unit') || c.includes('p.u'))) matches++;

            if (matches > maxMatches) {
                maxMatches = matches;
                bestRow = i;
            }
        }

        // Only accept if at least 3 matches found to avoid false positives in title
        return maxMatches >= 3 ? bestRow : -1;
    };


    // -------------------------------------------------------------------------
    // 4. MAIN PROCESS FILE
    // -------------------------------------------------------------------------
    const processFile = useCallback((uploadedFile: File) => {
        setFile(uploadedFile);
        if (!budgetName) setBudgetName(uploadedFile.name.replace(/\.[^/.]+$/, ""));
        setLoading(true);

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = evt.target?.result;
                const wb = XLSX.read(data, { type: 'array' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];

                // 1. Recalculate Range
                updateSheetRange(ws);

                // 2. Get Raw Data
                const jsonData = XLSX.utils.sheet_to_json(ws, {
                    header: 1,
                    defval: "",
                    blankrows: true
                }) as any[][];

                if (jsonData.length === 0) {
                    alert("Planilha vazia ou formato não reconhecido.");
                    setLoading(false);
                    return;
                }

                setFullData(jsonData);

                // 3. Extract Metadata
                scanForMetadata(jsonData);

                // 4. Find Header
                let headerRowIdx = findHeaderRow(jsonData);
                if (headerRowIdx === -1) {
                    console.warn("Could not auto-detect header row. Defaulting to 0.");
                    headerRowIdx = 0;
                }

                // 5. Setup Columns for Mapping
                let maxCols = 0;
                jsonData.forEach(row => { if (Array.isArray(row) && row.length > maxCols) maxCols = row.length; });

                const rawHeaders = jsonData[headerRowIdx] || [];
                const normalizedHeaders = [];
                for (let i = 0; i < maxCols; i++) {
                    normalizedHeaders.push(
                        rawHeaders[i] !== undefined && String(rawHeaders[i]).trim() !== ""
                            ? String(rawHeaders[i]).trim()
                            : `Coluna ${i + 1}`
                    );
                }
                setHeaders(normalizedHeaders);

                setProcessedPreview([]); // Reset processed preview

                // 7. Auto Map
                autoMapColumns(normalizedHeaders);

                setStep(2);
            } catch (error) {
                console.error("Error reading file", error);
                alert("Erro ao ler arquivo.");
            } finally {
                setLoading(false);
            }
        };
        reader.readAsArrayBuffer(uploadedFile);
    }, [budgetName]);


    // -------------------------------------------------------------------------
    // 5. AUTO MAPPING
    // -------------------------------------------------------------------------
    const autoMapColumns = (hdrs: any[]) => {
        const newMapping = { ...mapping };

        // Reset
        Object.keys(newMapping).forEach(k => (newMapping as any)[k] = -1);

        hdrs.forEach((h, idx) => {
            const header = String(h || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            if (header.includes('item') && !header.includes('descri')) newMapping.itemNumber = idx;
            else if (header.includes('codigo') || header.includes('ref')) newMapping.code = idx;
            else if (header.includes('descri') || header.includes('especificacao')) newMapping.description = idx;
            else if (header.includes('unid') || header === 'un' || header === 'und') newMapping.unit = idx;
            else if (header.includes('quant') || header.includes('qtd')) newMapping.quantity = idx;
            else if (header.includes('preco') || header.includes('unit') || header.includes('p.u')) newMapping.unitPrice = idx;
            else if (header.includes('total') || header.includes('parcial') || header.includes('vl. tot')) newMapping.totalPrice = idx;
            else if (header.includes('banco') || header.includes('fonte') || header.includes('sinapi') || header.includes('origem') || header.includes('base')) newMapping.source = idx;
            else if (header.includes('tipo')) newMapping.type = idx;
        });
        setMapping(newMapping);
    };

    // -------------------------------------------------------------------------
    // 6. PROCESS ROWS (The Core Hierarchy Logic)
    // -------------------------------------------------------------------------
    // -------------------------------------------------------------------------
    // 6. PROCESS ROWS (The Core Hierarchy Logic)
    // -------------------------------------------------------------------------

    // Strict PT-BR Parser: 1.234,56 -> 1234.56
    // TAMBÉM aceita números já parseados pelo XLSX
    const parseBrazilianNumber = (val: any): number => {
        // Se já for número, retornar diretamente
        if (typeof val === 'number') {
            return isNaN(val) || !isFinite(val) ? 0 : val;
        }

        if (!val || val === '') return 0;

        const str = String(val).trim();
        if (!str) return 0;

        // 1. Remove currency symbols, spaces and R$
        let clean = str.replace(/[R$\s]/g, '');

        // 2. Detectar formato: brasileiro (1.234,56) vs americano (1,234.56)
        // Se tem vírgula E ponto, verificar qual vem por último
        const lastComma = clean.lastIndexOf(',');
        const lastDot = clean.lastIndexOf('.');

        if (lastComma > lastDot) {
            // Formato brasileiro: 1.234,56 - vírgula é decimal
            clean = clean.replace(/\./g, ''); // Remove pontos de milhar
            clean = clean.replace(',', '.'); // Vírgula para ponto decimal
        } else if (lastDot > lastComma) {
            // Formato americano: 1,234.56 - ponto é decimal
            clean = clean.replace(/,/g, ''); // Remove vírgulas de milhar
        } else if (lastComma !== -1) {
            // Só vírgula: assume decimal brasileiro
            clean = clean.replace(',', '.');
        }
        // Se só ponto, assume que é decimal (padrão)

        // 3. Remove caracteres não numéricos exceto ponto e sinal
        clean = clean.replace(/[^0-9.\-]/g, '');

        // 4. Parse
        const num = parseFloat(clean);
        return isNaN(num) || !isFinite(num) ? 0 : num;
    };

    // Advanced BDI Detection using Sampling (Median of (Total / (Qty * Unit)) - 1)
    const detectAndSetBDI = (currentMapping: any) => {
        // Only run if we have the necessary columns
        if (currentMapping.unitPrice === -1 || currentMapping.quantity === -1 || currentMapping.totalPrice === -1) {
            return;
        }

        const validSamples: number[] = [];
        const headerRowIdx = findHeaderRow(fullData);
        const startRow = headerRowIdx === -1 ? 0 : headerRowIdx + 1;
        const limit = Math.min(fullData.length, startRow + 200); // Check 200 rows max

        for (let i = startRow; i < limit; i++) {
            const row = fullData[i];
            if (!row) continue;

            const qty = parseBrazilianNumber(row[currentMapping.quantity]);
            const unit = parseBrazilianNumber(row[currentMapping.unitPrice]);
            const total = parseBrazilianNumber(row[currentMapping.totalPrice]);

            if (qty > 0 && unit > 0 && total > 0) {
                const baseTotal = qty * unit;
                const factor = (total / baseTotal);
                // Valid BDI range: 0% to 100% (Factor 1.0 to 2.0)
                if (factor > 1.0001 && factor < 2.5) {
                    validSamples.push(factor - 1);
                }
            }
        }

        if (validSamples.length >= 3) {
            validSamples.sort((a, b) => a - b);
            const mid = Math.floor(validSamples.length / 2);
            const median = validSamples.length % 2 !== 0
                ? validSamples[mid]
                : (validSamples[mid - 1] + validSamples[mid]) / 2;

            const percent = median * 100;
            const rounded = Math.round(percent * 100) / 100;

            if (rounded > 0) {
                console.log(`BDI Detectado por amostragem (${validSamples.length} amostras, mediana): ${rounded}%`);
                setBdi(rounded);
            }
        }
    };

    const processRows = async (executeImport = false) => {
        // Validation: Ensure mandatory engineering fields are mapped (Req 5 & 7)
        const missingFields = [];
        if (mapping.description === -1) missingFields.push("Descrição");
        // if (mapping.itemNumber === -1) missingFields.push("Item (Numeração)"); // Relaxed: Hierarchy inference can handle missing numbers now
        if (mapping.quantity === -1) missingFields.push("Quantidade");
        if (mapping.unitPrice === -1) missingFields.push("Preço Unit.");

        if (missingFields.length > 0) {
            alert(`Para garantir a integridade do orçamento de engenharia, mapeie obrigatoriamente: ${missingFields.join(', ')}.`);
            return;
        }

        const headerRowIdx = findHeaderRow(fullData);
        if (headerRowIdx === -1 && executeImport) {
            alert("Erro crítico: linha de cabeçalho não encontrada para processar dados.");
            return;
        }

        const processedItems: ParsedRow[] = [];
        const startRow = headerRowIdx === -1 ? 0 : headerRowIdx + 1;

        // Check BDI in Unit Price Header
        // REGRA 1: Ignorar qualquer coluna de 'valor com BDI'. Assumir SEMPRE que é PREÇO BASE.
        // Removida lógica reverseBDI para evitar comportamentos inesperados.
        // O usuário DEVE mapear a coluna de Preço Unitário (Sem BDI).

        console.log(`Processando ${fullData.length - startRow} linhas a partir da linha ${startRow}...`);

        for (let i = startRow; i < fullData.length; i++) {
            const row = fullData[i];
            if (!row || row.length === 0) continue;

            const desc = String(row[mapping.description] || '').trim();
            if (!desc) continue;

            // Skip semantic footer rows
            const descUpper = desc.toUpperCase();
            if (descUpper.includes('TOTAL GERAL') || descUpper === 'TOTAL' || descUpper.startsWith('R$')) continue;

            const itemNum = mapping.itemNumber > -1 ? String(row[mapping.itemNumber] || '').trim() : '';
            const code = mapping.code > -1 ? String(row[mapping.code] || '').trim() : '';
            const unit = mapping.unit > -1 ? String(row[mapping.unit] || '').trim() : '';
            const typeRaw = mapping.type > -1 ? String(row[mapping.type] || '').toUpperCase() : '';

            // RAW Strings
            const qtyStr = mapping.quantity > -1 ? String(row[mapping.quantity] || '0') : '0';
            const priceStr = mapping.unitPrice > -1 ? String(row[mapping.unitPrice] || '0') : '0';

            // STRICT PARSING
            const qty = parseBrazilianNumber(qtyStr);
            const unitPrice = parseBrazilianNumber(priceStr);

            // Math Integrity: Total is ALWAYS Qty * Unit
            const totalPrice = qty * unitPrice;

            // Determine Type & Hierarchy
            let finalType: 'etapa' | 'composicao' | 'insumo' | 'material' | 'labor' = 'composicao';
            let level = 1;

            if (itemNum) {
                const dots = (itemNum.match(/\./g) || []).length;
                level = dots + 1;
            }

            if (typeRaw.includes('ETAPA')) finalType = 'etapa';
            else if (typeRaw.includes('MATERIAL')) finalType = 'material';
            else if (typeRaw.includes('MÃO DE OBRA') || typeRaw.includes('MAO DE OBRA')) finalType = 'labor';
            else if (qty === 0 && unitPrice === 0 && unit === '') finalType = 'etapa';

            // Source / Banco Normalization
            let source = 'IMPORT';
            if (mapping.source > -1) {
                const rawSource = String(row[mapping.source] || '').trim();
                if (rawSource) {
                    const upperSource = rawSource.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    if (upperSource === 'SINAPI') source = 'SINAPI';
                    else if (upperSource === 'PROPRIO') source = 'Próprio';
                    else if (upperSource === 'SICRO') source = 'SICRO';
                    else source = rawSource; // Keep original if it's something else
                }
            }

            processedItems.push({
                itemNumber: itemNum,
                code: code || 'IMP',
                description: desc,
                unit: unit || 'UN',
                quantity: qty,
                unitPrice: unitPrice,
                totalPrice: totalPrice, // FORCED CALCULATION
                type: finalType,
                level,
                source: source
            });
        }

        console.log(`Total de ${processedItems.length} itens processados.`);

        if (executeImport) {
            await saveToDatabase(processedItems);
        } else {
            console.log(`Gerando prévia com ${processedItems.length} itens.`);
            setProcessedPreview(processedItems.slice(0, 5000));
        }
    };

    // -------------------------------------------------------------------------
    // 7. SAVE TO DB
    // -------------------------------------------------------------------------
    const saveToDatabase = async (items: ParsedRow[]) => {
        setLoading(true);
        try {
            console.log(`Salvando ${items.length} itens no banco de dados...`);

            // Create Budget
            // Calcula total sem BDI para salvar no orçamento (estimativa inicial)
            const initialTotalValue = items.reduce((acc, i) => acc + (i.type !== 'etapa' ? (i.totalPrice || 0) : 0), 0);

            // Create Budget
            const bdiMultiplier = 1 + (bdi / 100);

            const newBudget = await BudgetService.create({
                name: budgetName || 'Orçamento Importado',
                client: clientName,
                date: new Date(),
                status: 'draft',
                totalValue: initialTotalValue * bdiMultiplier, // Salvar valor COM BDI
                bdi: bdi,
            });

            if (!newBudget) throw new Error("Failed to create budget");
            const budgetId = newBudget.id!;
            console.log(`Orçamento criado com ID: ${budgetId}`);



            // Convert to BudgetItem
            const dbItems = items.map((item, index) => {
                const isGroup = item.type === 'etapa';

                // REGRA 4 e 5: Etapas/Grupos sempre ZERADOS para forçar recálculo dinâmico
                if (isGroup) {
                    return {
                        budgetId: budgetId,
                        order: index + 1,
                        level: item.level,
                        itemNumber: item.itemNumber,
                        code: item.code,
                        description: item.description,
                        unit: item.unit,
                        quantity: 1, // Quantidade 1 para grupos
                        unitPrice: 0,
                        totalPrice: 0,
                        finalPrice: 0,
                        type: 'group' as const,
                        source: item.source,
                    };
                }

                return {
                    budgetId: budgetId,
                    order: index + 1,
                    level: item.level,
                    itemNumber: item.itemNumber,
                    code: item.code,
                    description: item.description,
                    unit: item.unit,
                    quantity: item.quantity || 1,
                    unitPrice: item.unitPrice || 0,
                    totalPrice: 0, // REGRA 1 & 5: Calculado SOMENTE pelo sistema (initBudget)
                    finalPrice: 0, // REGRA 1 & 5: Calculado SOMENTE pelo sistema (initBudget)
                    type: (item.type === 'material' ? 'material' :
                        item.type === 'labor' ? 'labor' : 'service') as any,
                    source: item.source,
                };
            });

            // Batch insert in chunks of 100 to avoid Supabase limits
            const BATCH_SIZE = 100;
            let insertedCount = 0;

            for (let i = 0; i < dbItems.length; i += BATCH_SIZE) {
                const batch = dbItems.slice(i, i + BATCH_SIZE);
                try {
                    await BudgetItemService.batchCreate(batch);
                    insertedCount += batch.length;
                    console.log(`Inseridos ${insertedCount}/${dbItems.length} itens...`);
                } catch (batchError) {
                    console.error(`Erro no lote ${i / BATCH_SIZE + 1}:`, batchError);
                    // Try inserting one by one as fallback
                    for (const item of batch) {
                        try {
                            await BudgetItemService.create(item);
                            insertedCount++;
                        } catch (itemError) {
                            console.error(`Erro ao inserir item ${item.itemNumber}:`, itemError);
                        }
                    }
                }
            }

            console.log(`Total de ${insertedCount} itens inseridos com sucesso.`);

            // Cálculos são feitos no frontend ao carregar o orçamento
            onSuccess(budgetId);
        } catch (error) {
            console.error('Erro ao salvar no banco de dados:', error);
            alert("Erro ao salvar no banco de dados. Verifique o console para detalhes.");
        } finally {
            setLoading(false);
        }
    };

    // Trigger preview update when mapping changes
    React.useEffect(() => {
        if (fullData.length > 0 && step === 2) {
            processRows(false);
            detectAndSetBDI(mapping);
        }
    }, [mapping, fullData, step]);


    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const uploadedFile = e.target.files?.[0];
        if (!uploadedFile) return;
        processFile(uploadedFile);
    };

    const handleDragEnter = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }, []);
    const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }, []);
    const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation(); setIsDragging(false);
        const droppedFiles = e.dataTransfer.files;
        if (droppedFiles.length > 0) {
            const ext = droppedFiles[0].name.split('.').pop()?.toLowerCase();
            if (ext === 'xlsx' || ext === 'xls') processFile(droppedFiles[0]);
            else alert("Por favor, selecione um arquivo Excel (.xlsx ou .xls)");
        }
    }, [processFile]);


    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in duration-200">

                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-blue-600 text-white">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
                            <FileSpreadsheet size={28} />
                        </div>
                        <div>
                            <h3 className="text-2xl font-black">Importador de Engenharia</h3>
                            <p className="text-blue-100 text-xs mt-0.5 uppercase tracking-widest font-bold">
                                {step === 1 ? 'Seleção de Arquivo' : 'Mapeamento e Estrutura'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors"><X size={24} /></button>
                </div>

                <div className="flex-1 overflow-y-auto bg-slate-50/50 p-6">

                    {step === 1 && (
                        <div className="max-w-xl mx-auto space-y-8 py-8">
                            {/* STEP 1: Upload */}
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                onDragEnter={handleDragEnter}
                                onDragLeave={handleDragLeave}
                                onDragOver={handleDragOver}
                                onDrop={handleDrop}
                                className={clsx(
                                    "border-4 border-dashed rounded-3xl p-12 text-center transition-all cursor-pointer group",
                                    isDragging ? "border-blue-500 bg-blue-50 scale-[1.02]" : "border-slate-200 hover:border-blue-500 hover:bg-blue-50",
                                    file && "border-green-500 bg-green-50"
                                )}
                            >
                                {file ? (
                                    <>
                                        <div className="w-20 h-20 bg-green-600 text-white rounded-3xl flex items-center justify-center mx-auto mb-4"><FileCheck size={32} /></div>
                                        <h4 className="text-xl font-black text-green-700">{file.name}</h4>
                                        <p className="text-green-600 mt-2">Arquivo pronto para leitura</p>
                                    </>
                                ) : (
                                    <>
                                        <div className={clsx("w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4 transition-all", isDragging ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400 group-hover:bg-blue-600 group-hover:text-white")}><Upload size={32} /></div>
                                        <h4 className="text-xl font-black text-slate-700">{isDragging ? "Solte Agora!" : "Clique ou Arraste"}</h4>
                                        <p className="text-slate-400 mt-2">Suporte a Planilhas Orçamentárias (.xlsx)</p>
                                    </>
                                )}
                            </div>
                            <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleFileUpload} />

                            {loading && <div className="text-center font-bold text-blue-600 animate-pulse">Lendo estrutura da planilha...</div>}
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6">
                            {/* Metadata Detection */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Orçamento</label>
                                    <input value={budgetName} onChange={e => setBudgetName(e.target.value)} className="w-full font-bold text-slate-700 outline-none mt-1" placeholder="Detectando..." />
                                </div>
                                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cliente</label>
                                    <input value={clientName} onChange={e => setClientName(e.target.value)} className="w-full font-bold text-slate-700 outline-none mt-1" placeholder="Detectando..." />
                                </div>
                                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">BDI Detectado (%)</label>
                                    <input type="number" value={bdi} onChange={e => setBdi(Number(e.target.value))} className="w-full font-bold text-green-600 outline-none mt-1" />
                                </div>
                            </div>

                            {/* Column Mapping */}
                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                                <h4 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                                    <Check size={18} className="text-blue-600" /> Mapeamento de Colunas
                                </h4>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {[
                                        { label: 'Item (1.1, 1.2)', key: 'itemNumber' },
                                        { label: 'Descrição *', key: 'description' },
                                        { label: 'Unidade', key: 'unit' },
                                        { label: 'Quantidade *', key: 'quantity' },
                                        { label: 'Preço Unit. *', key: 'unitPrice' },
                                        { label: 'Total (Detectar BDI)', key: 'totalPrice' },
                                        { label: 'Código (Ref)', key: 'code' },
                                        { label: 'Tipo (Etapa/Insumo)', key: 'type' },
                                    ].map((field) => (
                                        <div key={field.key}>
                                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{field.label}</label>
                                            <select
                                                value={(mapping as any)[field.key]}
                                                onChange={(e) => setMapping(prev => ({ ...prev, [field.key]: Number(e.target.value) }))}
                                                className={clsx(
                                                    "w-full bg-slate-50 border rounded-lg p-2 text-sm font-bold outline-none focus:ring-2 ring-blue-500",
                                                    (mapping as any)[field.key] > -1 ? "border-green-300 text-green-700 bg-green-50" : "border-slate-200 text-slate-500"
                                                )}
                                            >
                                                <option value={-1}>Não Mapeado</option>
                                                {headers.map((h, idx) => (
                                                    <option key={idx} value={idx}>{idx + 1}: {String(h).substring(0, 20)}</option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Hierarchical Preview */}
                            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                                <div className="bg-slate-50 p-3 border-b border-slate-100 flex justify-between items-center">
                                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                                        <Info size={14} /> Pré-visualização da Estrutura (Primeiros 20 itens)
                                    </span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-slate-50 text-slate-400 font-bold uppercase tracking-wider">
                                            <tr>
                                                <th className="p-3 text-left">Item</th>
                                                <th className="p-3 text-left">Descrição</th>
                                                <th className="p-3 text-center">Tipo Detectado</th>
                                                <th className="p-3 text-right">Qtd</th>
                                                <th className="p-3 text-right">Preço</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {processedPreview.map((row, idx) => (
                                                <tr key={idx} className={clsx(
                                                    "border-b border-slate-50 hover:bg-blue-50/50 transition-colors",
                                                    row.type === 'etapa' ? "bg-slate-100 font-bold text-slate-800" : "text-slate-600"
                                                )}>
                                                    <td className="p-3 font-mono">{row.itemNumber}</td>
                                                    <td className="p-3">
                                                        <div style={{ paddingLeft: `${(row.level - 1) * 12}px` }} className="flex items-center gap-2">
                                                            {row.type === 'etapa' && <span className="w-2 h-2 rounded-full bg-slate-400"></span>}
                                                            {row.description}
                                                        </div>
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <span className={clsx(
                                                            "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                                                            row.type === 'etapa' ? "bg-slate-200 text-slate-600" :
                                                                row.type === 'material' ? "bg-amber-100 text-amber-700" :
                                                                    row.type === 'labor' ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
                                                        )}>
                                                            {row.type === 'etapa' ? 'ETAPA' :
                                                                row.type === 'material' ? 'MATERIAL' :
                                                                    row.type === 'labor' ? 'MÃO DE OBRA' : 'ITEM'}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-right font-mono">{row.quantity || '-'}</td>
                                                    <td className="p-3 text-right font-mono">{row.unitPrice ? `R$ ${row.unitPrice.toFixed(2)}` : '-'}</td>
                                                </tr>
                                            ))}
                                            {processedPreview.length === 0 && (
                                                <tr>
                                                    <td colSpan={5} className="p-8 text-center text-slate-400">
                                                        Ajuste o mapeamento acima para visualizar a estrutura.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                    {step === 2 && <button onClick={() => setStep(1)} className="px-6 py-3 font-bold text-slate-500 hover:text-slate-700">Voltar</button>}
                    {step === 2 && (
                        <button
                            onClick={() => processRows(true)}
                            disabled={loading || mapping.description === -1}
                            className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {loading ? "Processando..." : <><Check size={18} /> Confirmar Importação</>}
                        </button>
                    )}
                </div>
            </div>
        </div >
    );
};

export default BudgetImporter;
