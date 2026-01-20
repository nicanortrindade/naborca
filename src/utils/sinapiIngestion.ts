/**
 * SINAPI Ingestion Engine v2.0
 * 
 * NOVA ESTRATÉGIA (2025):
 * - Arquivo único: SINAPI_Referência_2025_01.xlsx
 * - Múltiplas abas internas com dados de diferentes regimes
 * - Mapeamento automático de regime baseado na aba
 * - Menu, Busca, ISE, CSE, Analítico com Custo
 */

import * as XLSX from 'xlsx';
import { SinapiService } from '../lib/supabase-services/SinapiService';

// Re-export multi-file ingestion
export { ingestSinapiMultipleFiles } from './sinapiMultiFileIngestion';

// =====================================================
// TYPES
// =====================================================

export interface SinapiFileUrls {
    referenciaUrl: string;  // URL do arquivo SINAPI_Referência_2025_01.xlsx
}

export interface ParsedInput {
    code: string;
    description: string;
    unit: string;
    price: number;
    category?: string;
}

export interface ParsedComposition {
    code: string;
    description: string;
    unit: string;
    price?: number;
    composition_type?: string;
}

export interface ParsedCompositionItem {
    composition_code: string;
    item_type: 'INSUMO' | 'COMPOSICAO';
    item_code: string;
    coefficient: number;
    unit: string;
}

export interface IngestionProgress {
    step: string;
    message: string;
    current: number;
    total: number;
}

export interface IngestionResult {
    success: boolean;
    counts: {
        inputs: number;
        compositions: number;
        input_prices: number;
        composition_prices: number;
        composition_items: number;
    };
    errors: string[];
    logs: string[];
}

// =====================================================
// SHEET MAPPING (ADAPTER FOR LEGACY CODE)
// =====================================================

const SHEET_MAPPING = {
    ISD: { type: 'inputs' as const, regime: 'NAO_DESONERADO' as const },
    ICD: { type: 'inputs' as const, regime: 'DESONERADO' as const },
    CSD: { type: 'compositions' as const, regime: 'NAO_DESONERADO' as const },
    CCD: { type: 'compositions' as const, regime: 'DESONERADO' as const },
    Analítico: { type: 'analytic' as const, regime: null },
    'Analitico': { type: 'analytic' as const, regime: null },
};

const IGNORED_SHEETS = ['Menu', 'Busca', 'ISE', 'CSE'];

// =====================================================
// SHEET DETECTION LOGIC
// =====================================================

function identifySheetType(sheetName: string): { type: 'inputs' | 'compositions' | 'analytic' | 'prices'; regime: 'DESONERADO' | 'NAO_DESONERADO' | null } | null {
    const n = normalizeFilename(sheetName);

    // Ignorados explícitos
    if (n.includes('menu') || n.includes('busca') || n.includes('ise') || n.includes('cse')) {
        return null;
    }

    // Analítico com Custo (PREÇOS!)
    if (n.includes('analitico') && n.includes('custo')) {
        return { type: 'prices', regime: null };
    }

    // Analítico (структура)
    if (n.includes('analitico')) return { type: 'analytic', regime: null };

    // Insumos (ISD = Sem Desoneração, ICD = Com Desoneração)
    if (n.includes('isd')) return { type: 'inputs', regime: 'NAO_DESONERADO' };
    if (n.includes('icd')) return { type: 'inputs', regime: 'DESONERADO' };

    // Composições (CSD = Sem Desoneração, CCD = Com Desoneração)
    if (n.includes('csd')) return { type: 'compositions', regime: 'NAO_DESONERADO' };
    if (n.includes('ccd')) return { type: 'compositions', regime: 'DESONERADO' };

    // Tentativas por nome extenso (caso mude a sigla)
    if (n.includes('insumo')) {
        if (n.includes('nao_desonerado')) return { type: 'inputs', regime: 'NAO_DESONERADO' };
        if (n.includes('desonerado')) return { type: 'inputs', regime: 'DESONERADO' };
    }
    if (n.includes('composic')) { // composicao, composições
        if (n.includes('nao_desonerado') || n.includes('sintetico')) return { type: 'compositions', regime: n.includes('desonerado') && !n.includes('nao') ? 'DESONERADO' : 'NAO_DESONERADO' }; // fallback padrao
    }

    return null;
}

// =====================================================
// FILE TYPE DETECTION & VALIDATION
// =====================================================

export type SinapiFileType =
    | 'REFERENCIA'
    | 'FAMILIAS'
    | 'MAO_DE_OBRA'
    | 'MANUTENCOES';

export const SINAPI_IMPORT_ORDER: SinapiFileType[] = [
    'REFERENCIA',
    'FAMILIAS',
    'MAO_DE_OBRA',
    'MANUTENCOES'
];

/**
 * Normaliza o nome do arquivo para garantir detecção robusta
 * Remove acentos, converte para minusculo, troca espaços/hífens por underline
 */
function normalizeFilename(input: string): string {
    return String(input || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")      // remove acentos
        .replace(/[ -]+/g, "_")               // espaço/hífen -> _
        .replace(/[^a-z0-9_\.]/g, "");        // remove caracteres especiais
}

/**
 * Detecta automaticamente o tipo de arquivo SINAPI pelo nome (com normalização)
 */
export function detectSinapiFileType(fileName: string): SinapiFileType | null {
    const original = fileName;
    const normalized = normalizeFilename(fileName);
    let type: SinapiFileType | null = null;

    if (normalized.includes('referencia')) type = 'REFERENCIA';
    else if (normalized.includes('familias') || normalized.includes('coeficientes')) type = 'FAMILIAS';
    else if (normalized.includes('mao_de_obra') || normalized.includes('maodeobra')) type = 'MAO_DE_OBRA';
    else if (normalized.includes('manutencoes') || normalized.includes('manutencao')) type = 'MANUTENCOES';

    console.log(`[SINAPI FILE DETECT] original="${original}" normalized="${normalized}" type="${type || 'null'}"`);
    return type;
}

/**
 * Valida se todos os arquivos obrigatórios foram fornecidos
 */
export function validateSinapiFiles(files: File[]): {
    valid: boolean;
    filesMap: Map<SinapiFileType, File>;
    missing: SinapiFileType[];
    detected: Array<{ type: SinapiFileType; file: File }>;
} {
    const filesMap = new Map<SinapiFileType, File>();
    const detected: Array<{ type: SinapiFileType; file: File }> = [];

    // Mapear arquivos detectados
    files.forEach(file => {
        const type = detectSinapiFileType(file.name);
        if (type) {
            // Regra de Duplicata: Mantém o último (similar a um Map.set)
            // Futuramente pode ser melhorado para escolher o maior ou mais recente
            if (filesMap.has(type)) {
                console.warn(`[SINAPI FILE VALIDATION] Substituindo duplicata para ${type}: ${filesMap.get(type)?.name} -> ${file.name}`);
            }
            filesMap.set(type, file);
        } else {
            console.warn(`[SINAPI FILE WARNING] Arquivo não reconhecido: ${file.name}`);
        }
    });

    // Reconstruir lista de detectados baseada no Map final (sem duplicatas)
    filesMap.forEach((file, type) => {
        detected.push({ type, file });
    });

    // Verificar ausentes
    const missing: SinapiFileType[] = [];
    for (const required of SINAPI_IMPORT_ORDER) {
        if (!filesMap.has(required)) {
            missing.push(required);
        }
    }

    console.log(`[SINAPI FILE VALIDATION] missing=[${missing.join(', ')}] detected={${detected.map(d => `${d.type}:${d.file.name}`).join(', ')}}`);

    return {
        valid: missing.length === 0,
        filesMap,
        missing,
        detected
    };
}

// =====================================================
// HELPERS
// =====================================================

function parseNumber(value: any): number {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return value;
    const str = String(value).replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
}

function cleanText(value: any): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

/**
 * Normaliza texto de header para matching robusto
 * Remove acentos, pontuação, espaços extras, lowercase
 */
function normalizeHeader(text: string): string {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove acentos
        .replace(/[^a-z0-9\s]/g, '') // Remove pontuação
        .replace(/\s+/g, ' ') // Colapsa espaços
        .trim();
}

/**
 * Encontra a melhor linha candidata a header baseado em scoring
 * @param data Array de linhas do Excel
 * @param keyAliases Aliases de colunas-chave para identificar header
 * @param maxRows Máximo de linhas para procurar
 * @returns Índice da linha de header ou -1
 */
function findHeaderRow(data: any[][], keyAliases: string[], maxRows: number = 50): number {
    let bestRow = -1;
    let bestScore = 0;

    for (let i = 0; i < Math.min(data.length, maxRows); i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;

        // Normalizar todos os valores da linha
        const normalized = row.map(cell => normalizeHeader(String(cell || '')));

        // Contar quantos aliases-chave estão presentes
        let score = 0;
        for (const alias of keyAliases) {
            if (normalized.some(h => h.includes(alias))) {
                score++;
            }
        }

        // Se encontrou pelo menos 2 colunas-chave, é candidata
        if (score >= 2 && score > bestScore) {
            bestScore = score;
            bestRow = i;
        }
    }

    return bestRow;
}

/**
 * Encontra índice de coluna baseado em aliases (TOKEN-BASED MATCHING)
 * 
 * REGRAS:
 * 1. Aliases curtos (<=2 chars): só match por igualdade EXATA do header
 * 2. Aliases longos: match por igualdade exata OU token inteiro
 * 3. Prioridade: igualdade exata > token match
 */
function findColumnIndex(headers: string[], aliases: string[], mustNotInclude: string[] = []): { index: number; match: string } {
    const normalized = headers.map(h => normalizeHeader(h));
    const normalizedAliases = aliases.map(a => normalizeHeader(a));

    // PASS 1: Igualdade exata do header inteiro
    for (let i = 0; i < normalized.length; i++) {
        const h = normalized[i];

        // Verificar exclusões
        const excluded = mustNotInclude.some(term => {
            const normTerm = normalizeHeader(term);
            return h === normTerm || h.split(' ').includes(normTerm);
        });
        if (excluded) continue;

        // Match exato
        const exactMatch = normalizedAliases.find(alias => h === alias);
        if (exactMatch) {
            return { index: i, match: aliases[normalizedAliases.indexOf(exactMatch)] };
        }
    }

    // PASS 2: Match por token inteiro (só para aliases > 2 chars)
    for (let i = 0; i < normalized.length; i++) {
        const h = normalized[i];
        const tokens = h.split(' ');

        // Verificar exclusões
        const excluded = mustNotInclude.some(term => {
            const normTerm = normalizeHeader(term);
            return tokens.includes(normTerm);
        });
        if (excluded) continue;

        // Match por token (só aliases longos)
        for (let j = 0; j < normalizedAliases.length; j++) {
            const alias = normalizedAliases[j];

            // Aliases curtos (<=2 chars): NUNCA match por token, só exato
            if (alias.length <= 2) continue;

            // Multi-word alias: todos os tokens do alias devem estar no header
            const aliasTokens = alias.split(' ');
            const allTokensMatch = aliasTokens.every(at => tokens.includes(at));

            if (allTokensMatch) {
                return { index: i, match: aliases[j] };
            }
        }
    }

    return { index: -1, match: '' };
}

/**
 * Encontra coluna de preço pela UF (para ISD/ICD)
 * Headers SINAPI têm colunas como: AC, AL, AM, AP, BA, CE, ...
 */
function findUfPriceColumn(headers: string[], uf: string): { index: number; match: string } {
    const normalizedUf = uf.toLowerCase().trim();
    const normalized = headers.map(h => normalizeHeader(h));

    for (let i = 0; i < normalized.length; i++) {
        if (normalized[i] === normalizedUf) {
            return { index: i, match: uf };
        }
    }

    return { index: -1, match: '' };
}

/**
 * Deduplicação genérica de preços
 * @param prices Array de objetos com preço
 * @param keyField Nome do campo chave (ex: 'input_code', 'composition_code')
 * @returns Array deduplicado (mantém último)
 */
function deduplicatePrices<T extends Record<string, any>>(prices: T[], keyField: string): T[] {
    const map = new Map<string, T>();
    for (const price of prices) {
        const key = String(price[keyField]);
        map.set(key, price); // Mantém último
    }
    return Array.from(map.values());
}

// =====================================================
// PARSERS
// =====================================================

function parseInputSheet(sheet: XLSX.WorkSheet, sheetName: string, uf: string = 'BA'): ParsedInput[] {
    const results: ParsedInput[] = [];

    const data = XLSX.utils.sheet_to_json<any>(sheet, {
        header: 1,
        defval: null,
        blankrows: false
    });

    console.log(`[SINAPI PARSER] aba=${sheetName} totalRows=${data.length} uf=${uf}`);

    // Aliases SINAPI para detecção de header de insumos
    const keyAliases = ['codigo', 'descricao', 'unidade'];

    const headerRow = findHeaderRow(data, keyAliases);

    if (headerRow === -1) {
        console.error(`[SINAPI PARSER] aba=${sheetName} ERRO: Header não encontrado nas primeiras 50 linhas`);
        console.log(`[SINAPI PARSER] aba=${sheetName} Sample (primeiras 5 linhas):`,
            data.slice(0, 5).map(row => (row as any[]).slice(0, 12)));
        return results;
    }

    const headers = (data[headerRow] as any[]).map(h => cleanText(h));
    const normalizedHeaders = headers.map(h => normalizeHeader(h));

    console.log(`[SINAPI PARSER] aba=${sheetName} headerRow=${headerRow}`);
    console.log(`[SINAPI PARSER] aba=${sheetName} headers=${JSON.stringify(normalizedHeaders)}`);

    // Aliases para colunas (CORRIGIDO: sem aliases curtos problemáticos)
    const codeAliases = ['codigo', 'codigo do insumo', 'codigo insumo'];
    const descAliases = ['descricao', 'denominacao', 'descricao do insumo'];
    const unitAliases = ['unidade'];

    const codeCol = findColumnIndex(headers, codeAliases, ['composicao']);
    const descCol = findColumnIndex(headers, descAliases);
    const unitCol = findColumnIndex(headers, unitAliases);

    // PREÇO: Buscar pela coluna da UF (ex: "BA", "SP", etc)
    const priceCol = findUfPriceColumn(headers, uf);

    console.log(`[SINAPI PARSER] aba=${sheetName} Mapeamento: Code=[${codeCol.index}|${codeCol.match}] Desc=[${descCol.index}|${descCol.match}] Unit=[${unitCol.index}|${unitCol.match}] Price=[${priceCol.index}|${priceCol.match}] (UF=${uf})`);

    if (codeCol.index === -1) {
        console.error(`[SINAPI PARSER] aba=${sheetName} ERRO: Coluna CÓDIGO não encontrada`);
        console.log(`[SINAPI PARSER] aba=${sheetName} Headers disponíveis:`, normalizedHeaders);
        return results;
    }

    if (descCol.index === -1) {
        console.warn(`[SINAPI PARSER] aba=${sheetName} WARN: Coluna DESCRIÇÃO não encontrada (usando fallback)`);
    }

    if (priceCol.index === -1) {
        console.error(`[SINAPI PARSER] aba=${sheetName} ERRO: Coluna de preço da UF "${uf}" não encontrada!`);
        console.log(`[SINAPI PARSER] aba=${sheetName} Colunas disponíveis (para encontrar UF):`, normalizedHeaders.filter(h => h.length <= 3));
    }

    let validRows = 0;
    let discardedRows = 0;
    const discardReasons: Record<string, number> = {};
    let sampleParsed: any = null;

    for (let i = headerRow + 1; i < data.length; i++) {
        const row = data[i] as any[];
        if (!row || row.length === 0) continue;

        const code = cleanText(row[codeCol.index]);
        const description = descCol.index >= 0 ? cleanText(row[descCol.index]) : '';
        const price = priceCol.index >= 0 ? parseNumber(row[priceCol.index]) : 0;

        // Validação
        if (!code || code.length < 2) {
            discardedRows++;
            discardReasons['codigo_vazio'] = (discardReasons['codigo_vazio'] || 0) + 1;
            continue;
        }

        if (!description || description.length < 3) {
            discardedRows++;
            discardReasons['descricao_vazia'] = (discardReasons['descricao_vazia'] || 0) + 1;
            continue;
        }

        const input = {
            code,
            description,
            unit: unitCol.index >= 0 ? cleanText(row[unitCol.index]) : '',
            price
        };

        results.push(input);

        if (!sampleParsed) sampleParsed = input;
        validRows++;
    }

    console.log(`[SINAPI PARSER] aba=${sheetName} Results: parsed=${validRows} discarded=${discardedRows}`);
    if (Object.keys(discardReasons).length > 0) {
        console.log(`[SINAPI PARSER] aba=${sheetName} Discard reasons:`, discardReasons);
    }
    if (sampleParsed) {
        console.log(`[SINAPI PARSER] aba=${sheetName} Sample:`, sampleParsed);
    }

    return results;
}

function parseCompositionSheet(sheet: XLSX.WorkSheet, sheetName: string): ParsedComposition[] {
    const results: ParsedComposition[] = [];

    const data = XLSX.utils.sheet_to_json<any>(sheet, {
        header: 1,
        defval: null,
        blankrows: false
    });

    console.log(`[SINAPI PARSER] aba=${sheetName} totalRows=${data.length}`);

    // Aliases para detecção de header de composições
    const keyAliases = ['codigo', 'composicao', 'descricao', 'unidade', 'custo', 'valor'];

    const headerRow = findHeaderRow(data, keyAliases);

    if (headerRow === -1) {
        console.error(`[SINAPI PARSER] aba=${sheetName} ERRO: Header não encontrado nas primeiras 50 linhas`);
        console.log(`[SINAPI PARSER] aba=${sheetName} Sample (primeiras 5 linhas):`,
            data.slice(0, 5).map(row => (row as any[]).slice(0, 12)));
        return results;
    }

    const headers = (data[headerRow] as any[]).map(h => cleanText(h));
    const normalizedHeaders = headers.map(h => normalizeHeader(h));

    console.log(`[SINAPI PARSER] aba=${sheetName} headerRow=${headerRow}`);
    console.log(`[SINAPI PARSER] aba=${sheetName} headers=${JSON.stringify(normalizedHeaders.slice(0, 10))}`);

    // Aliases para colunas de composições
    const codeAliases = ['codigo da composicao', 'cod composicao', 'codigo composicao', 'codigo', 'cod', 'composicao'];
    const descAliases = ['descricao', 'denominacao', 'nome'];
    const unitAliases = ['un', 'und', 'unidade', 'unid', 'um'];
    const priceAliases = ['custo total', 'custo unitario', 'custo', 'valor total', 'valor', 'total', 'preco'];

    const codeCol = findColumnIndex(headers, codeAliases);
    const descCol = findColumnIndex(headers, descAliases);
    const unitCol = findColumnIndex(headers, unitAliases);
    const priceCol = findColumnIndex(headers, priceAliases);

    console.log(`[SINAPI PARSER] aba=${sheetName} Mapeamento: Code=[${codeCol.index}|${codeCol.match}] Desc=[${descCol.index}|${descCol.match}] Unit=[${unitCol.index}|${unitCol.match}] Price=[${priceCol.index}|${priceCol.match}]`);

    if (codeCol.index === -1) {
        console.error(`[SINAPI PARSER] aba=${sheetName} ERRO: Coluna CÓDIGO DA COMPOSIÇÃO não encontrada`);
        console.log(`[SINAPI PARSER] aba=${sheetName} Headers disponíveis:`, normalizedHeaders);
        return results;
    }

    if (priceCol.index === -1) {
        console.warn(`[SINAPI PARSER] aba=${sheetName} WARN: Coluna PREÇO não encontrada! Composições terão preço=0`);
    }

    let validRows = 0;
    let discardedRows = 0;
    const discardReasons: Record<string, number> = {};
    let sampleParsed: any = null;

    for (let i = headerRow + 1; i < data.length; i++) {
        const row = data[i] as any[];
        if (!row || row.length === 0) continue;

        const code = cleanText(row[codeCol.index]);
        const description = descCol.index >= 0 ? cleanText(row[descCol.index]) : 'Sem descrição';
        const price = priceCol.index >= 0 ? parseNumber(row[priceCol.index]) : 0;

        if (!code || code.length < 4) {
            discardedRows++;
            discardReasons['codigo_invalido'] = (discardReasons['codigo_invalido'] || 0) + 1;
            continue;
        }

        const comp = {
            code,
            description,
            unit: unitCol.index >= 0 ? cleanText(row[unitCol.index]) : '',
            price,
            composition_type: 'SINTETICO'
        };

        results.push(comp);
        if (!sampleParsed) sampleParsed = comp;
        validRows++;
    }

    console.log(`[SINAPI PARSER] aba=${sheetName} Results: parsed=${validRows} discarded=${discardedRows}`);
    if (Object.keys(discardReasons).length > 0) {
        console.log(`[SINAPI PARSER] aba=${sheetName} Discard reasons:`, discardReasons);
    }
    if (sampleParsed) {
        console.log(`[SINAPI PARSER] aba=${sheetName} Sample:`, sampleParsed);
    }

    return results;
}

function parseAnalyticSheet(sheet: XLSX.WorkSheet): {
    compositions: ParsedComposition[];
    items: ParsedCompositionItem[];
} {
    const compositions: ParsedComposition[] = [];
    const items: ParsedCompositionItem[] = [];
    const compositionSet = new Set<string>();

    const data = XLSX.utils.sheet_to_json<any>(sheet, {
        header: 1,
        defval: null,
        blankrows: false
    });

    console.log(`[SINAPI PARSER] aba=Analítico totalRows=${data.length}`);

    // Aliases chave para header analítico
    const keyAliases = ['codigo', 'composicao', 'item', 'coeficiente', 'tipo'];

    const headerRow = findHeaderRow(data, keyAliases);

    if (headerRow === -1) {
        console.error('[SINAPI PARSER] aba=Analítico ERRO: Header não encontrado nas primeiras 50 linhas');
        console.log('[SINAPI PARSER] aba=Analítico Sample (primeiras 5 linhas):',
            data.slice(0, 5).map(row => (row as any[]).slice(0, 12)));
        return { compositions, items };
    }

    const headers = (data[headerRow] as any[]).map(h => cleanText(h));
    const normalizedHeaders = headers.map(h => normalizeHeader(h));

    console.log(`[SINAPI PARSER] aba=Analítico headerRow=${headerRow}`);
    console.log(`[SINAPI PARSER] aba=Analítico headers=${JSON.stringify(normalizedHeaders.slice(0, 12))}`);

    // Aliases para colunas do analítico
    const compCodeAliases = ['codigo da composicao', 'cod composicao', 'composicao', 'codigo composicao'];
    const compDescAliases = ['descricao da composicao', 'descricao composicao', 'descricao'];
    const compUnitAliases = ['unidade', 'unid', 'un'];
    const itemCodeAliases = ['codigo do item', 'codigo item', 'item', 'insumo', 'codigo do insumo', 'codigo insumo'];
    const coefAliases = ['coeficiente', 'coef', 'quantidade', 'qtde'];
    const itemTypeAliases = ['tipo item', 'tipo de item', 'tipo'];

    const compCodeCol = findColumnIndex(headers, compCodeAliases);
    const compDescCol = findColumnIndex(headers, compDescAliases);
    const compUnitCol = findColumnIndex(headers, compUnitAliases, ['item', 'insumo']);
    const itemCodeCol = findColumnIndex(headers, itemCodeAliases);
    const coefCol = findColumnIndex(headers, coefAliases);
    const itemTypeCol = findColumnIndex(headers, itemTypeAliases);

    console.log(`[SINAPI PARSER] Analítico Mapeamento: CompCode=[${compCodeCol.index}|${compCodeCol.match}] ItemCode=[${itemCodeCol.index}|${itemCodeCol.match}] Coef=[${coefCol.index}|${coefCol.match}] Type=[${itemTypeCol.index}|${itemTypeCol.match}]`);

    if (compCodeCol.index === -1) {
        console.error('[SINAPI PARSER] Analítico ERRO: Coluna CÓDIGO DA COMPOSIÇÃO não encontrada');
        console.log('[SINAPI PARSER] Analítico Headers disponíveis:', normalizedHeaders);
        return { compositions, items };
    }

    if (itemCodeCol.index === -1) {
        console.error('[SINAPI PARSER] Analítico ERRO: Coluna CÓDIGO DO ITEM não encontrada');
        return { compositions, items };
    }

    if (coefCol.index === -1) {
        console.error('[SINAPI PARSER] Analítico ERRO: Coluna COEFICIENTE não encontrada');
        return { compositions, items };
    }

    let currentCompCode = '';
    let currentCompDesc = '';
    let currentCompUnit = '';
    let validItems = 0;
    let discardedItems = 0;

    for (let i = headerRow + 1; i < data.length; i++) {
        const row = data[i] as any[];
        if (!row || row.length === 0) continue;

        const compCode = cleanText(row[compCodeCol.index]);
        const itemCode = cleanText(row[itemCodeCol.index]);
        const coefficient = parseNumber(row[coefCol.index]);

        // Nova composição detectada
        if (compCode && compCode.length >= 4) {
            currentCompCode = compCode;
            currentCompDesc = compDescCol.index >= 0 ? cleanText(row[compDescCol.index]) : '';
            currentCompUnit = compUnitCol.index >= 0 ? cleanText(row[compUnitCol.index]) : '';

            if (!compositionSet.has(currentCompCode)) {
                compositionSet.add(currentCompCode);
                compositions.push({
                    code: currentCompCode,
                    description: currentCompDesc,
                    unit: currentCompUnit
                });
            }
        }

        // Item da composição        
        if (currentCompCode && itemCode && coefficient > 0) {
            let itemType: 'INSUMO' | 'COMPOSICAO' = 'INSUMO';

            if (itemTypeCol.index >= 0) {
                const t = cleanText(row[itemTypeCol.index]).toUpperCase();
                if (t.includes('COMP') || t.includes('SERVI') || t.includes('CPU')) {
                    itemType = 'COMPOSICAO';
                }
            }

            items.push({
                composition_code: currentCompCode,
                item_type: itemType,
                item_code: itemCode,
                coefficient,
                unit: ''
            });
            validItems++;
        } else if (currentCompCode && itemCode) {
            discardedItems++;
        }
    }

    console.log(`[SINAPI PARSER] Analítico Results: ${compositions.length} compositions, ${validItems} items, ${discardedItems} items discarded`);
    return { compositions, items };
}

function parsePricesSheet(sheet: XLSX.WorkSheet, sheetName: string): {
    inputPrices: Array<{ code: string; price: number }>;
    compositionPrices: Array<{ code: string; price: number }>;
} {
    const inputPrices: Array<{ code: string; price: number }> = [];
    const compositionPrices: Array<{ code: string; price: number }> = [];

    const data = XLSX.utils.sheet_to_json<any>(sheet, {
        header: 1,
        defval: null,
        blankrows: false
    });

    console.log(`[PRICE] aba=${sheetName} totalRows=${data.length}`);

    const keyAliases = ['codigo', 'tipo', 'custo', 'composicao'];
    const headerRow = findHeaderRow(data, keyAliases);

    if (headerRow === -1) {
        console.error(`[PRICE] aba=${sheetName} ERRO: Header não encontrado`);
        console.log(`[PRICE] Sample:`, data.slice(0, 5).map(r => (r as any[]).slice(0, 15)));
        return { inputPrices, compositionPrices };
    }

    const headers = (data[headerRow] as any[]).map(h => cleanText(h));
    const normalizedHeaders = headers.map(h => normalizeHeader(h));

    console.log(`[PRICE] headerRowIndex=${headerRow}`);
    console.log(`[PRICE] headers(normalized)=${JSON.stringify(normalizedHeaders)}`);

    // ALIASES CORRIGIDOS - específicos para "Analítico com Custo"
    const itemCodeAliases = ['codigo do item', 'codigo item', 'codigo do insumo'];
    const compCodeAliases = ['codigo da composicao', 'codigo composicao'];
    const typeAliases = ['tipo item', 'tipo de item'];
    const priceAliases = ['custo unit', 'custo unitario', 'custo total', 'valor unit'];

    const itemCodeCol = findColumnIndex(headers, itemCodeAliases);
    const compCodeCol = findColumnIndex(headers, compCodeAliases);
    const typeCol = findColumnIndex(headers, typeAliases);
    const priceCol = findColumnIndex(headers, priceAliases);

    console.log(`[PRICE] mappedCols: item_code=[${itemCodeCol.index},${itemCodeCol.match}] comp_code=[${compCodeCol.index},${compCodeCol.match}] type=[${typeCol.index},${typeCol.match}] price=[${priceCol.index},${priceCol.match}]`);

    // Determinar qual coluna de código usar
    const codeCol = itemCodeCol.index >= 0 ? itemCodeCol : compCodeCol;

    if (codeCol.index === -1) {
        console.error(`[PRICE] ERRO: Nenhuma coluna de código encontrada`);
        console.log(`[PRICE] Headers disponíveis:`, normalizedHeaders);
        return { inputPrices, compositionPrices };
    }

    if (priceCol.index === -1) {
        console.error(`[PRICE] ERRO: Coluna de preço não encontrada`);
        console.log(`[PRICE] Headers disponíveis:`, normalizedHeaders);
        return { inputPrices, compositionPrices };
    }

    let inputCount = 0;
    let compCount = 0;
    let discarded = 0;

    for (let i = headerRow + 1; i < data.length; i++) {
        const row = data[i] as any[];
        if (!row || row.length === 0) continue;

        const code = cleanText(row[codeCol.index]);
        const price = parseNumber(row[priceCol.index]);
        const itemType = typeCol.index >= 0 ? cleanText(row[typeCol.index]).toUpperCase() : '';

        if (!code || code.length < 3 || price <= 0) {
            discarded++;
            continue;
        }

        // Classificar por tipo (INSUMO vs COMPOSIÇÃO)
        const isComposition = itemType.includes('COMP') || itemType.includes('CPU') || itemType.includes('SERV');

        if (isComposition) {
            compositionPrices.push({ code, price });
            compCount++;
        } else {
            inputPrices.push({ code, price });
            inputCount++;
        }
    }

    console.log(`[PRICE] Results: ${inputCount} input prices, ${compCount} composition prices, ${discarded} discarded`);

    if (inputPrices.length > 0) console.log(`[PRICE] Sample input:`, inputPrices[0]);
    if (compositionPrices.length > 0) console.log(`[PRICE] Sample comp:`, compositionPrices[0]);

    return { inputPrices, compositionPrices };
}

// =====================================================
// FILE-BASED INGESTION (NO FETCH!)
// =====================================================

/**
 * Ingestão SINAPI a partir de arquivo local (upload direto)
 * USO: Evita problemas de CORS com URLs externas (Google Drive, etc)
 */
export async function ingestSinapiFromFile(
    file: File,
    uf: string = 'BA',
    competence: string = '2025-01',
    onProgress?: (progress: IngestionProgress) => void
): Promise<IngestionResult> {
    const result: IngestionResult = {
        success: false,
        counts: {
            inputs: 0,
            compositions: 0,
            input_prices: 0,
            composition_prices: 0,
            composition_items: 0
        },
        errors: [],
        logs: []
    };

    const log = (msg: string) => {
        result.logs.push(`[${new Date().toISOString()}] ${msg}`);
        console.log(`[SINAPI INGEST] ${msg}`);
    };

    return new Promise((resolve) => {
        try {
            log(`Iniciando ingestão: UF=${uf}, Competência=${competence}`);
            log(`Arquivo: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

            // Ler arquivo localmente usando FileReader
            const reader = new FileReader();

            reader.onerror = () => {
                result.errors.push(`Erro ao ler arquivo: ${reader.error?.message}`);
                log(`ERRO ao ler arquivo: ${reader.error?.message}`);
                resolve(result);
            };

            reader.onload = async (e) => {
                try {
                    onProgress?.({ step: 'processing', message: 'Processando arquivo...', current: 1, total: 10 });

                    // Converter para Uint8Array e ler com XLSX
                    const data = new Uint8Array(e.target!.result as ArrayBuffer);
                    const workbook = XLSX.read(data, { type: 'array' });

                    console.log('[SINAPI PARSER] workbook loaded successfully');
                    log(`Arquivo lido. Abas encontradas: ${workbook.SheetNames.map(s => `"${s}"`).join(', ')}`);

                    // 2. Processar cada aba conforme identificação
                    let step = 2;
                    const totalSteps = workbook.SheetNames.length + 2;

                    for (const sheetName of workbook.SheetNames) {
                        const mapping = identifySheetType(sheetName);

                        // Log de decisão de parsing
                        if (!mapping) {
                            console.log(`[SINAPI PARSER] Aba "${sheetName}" ignorada (não corresponde a IS/IC/CS/CC/Analítico).`);
                            continue;
                        }

                        console.log(`[SINAPI PARSER] Aba "${sheetName}" identificada como [${mapping.type}] regime=[${mapping.regime}]`);
                        log(`Processando aba: "${sheetName}" -> ${mapping.type} (${mapping.regime || 'AMBOS'})`);

                        const sheet = workbook.Sheets[sheetName];

                        // INSUMOS (ISD ou ICD)
                        if (mapping.type === 'inputs') {
                            const regime = mapping.regime!;
                            onProgress?.({ step: sheetName, message: `Processando Insumos ${sheetName}...`, current: step++, total: totalSteps });

                            const inputs = parseInputSheet(sheet, sheetName);
                            log(`aba=${sheetName} Lidos=${inputs.length} insumos.`);

                            if (inputs.length === 0) {
                                log(`[WARN] Aba ${sheetName} vazia ou cabeçalho não encontrado. Ignorando.`);
                                // Não marcar como erro fatal, pois pode haver outras abas
                                continue;
                            }

                            // Criar tabela de preço para este regime
                            const priceTable = await SinapiService.upsertPriceTable({
                                source: 'SINAPI',
                                uf,
                                competence,
                                regime,
                                file_urls: { [sheetName]: file.name }
                            });

                            // Upsert insumos
                            const inputCount = await SinapiService.batchUpsertInputs(
                                inputs.map(i => ({
                                    code: i.code,
                                    description: i.description,
                                    unit: i.unit,
                                    category: i.category
                                }))
                            );
                            result.counts.inputs += inputCount;

                            // Upsert preços
                            const priceCount = await SinapiService.batchUpsertInputPrices(
                                priceTable.id,
                                inputs.filter(i => i.price > 0).map(i => ({
                                    input_code: i.code,
                                    price: i.price
                                }))
                            );
                            result.counts.input_prices += priceCount;

                            log(`aba=${sheetName} Persistidos: ${inputCount} insumos, ${priceCount} preços.`);
                        }

                        // COMPOSIÇÕES (CSD ou CCD)
                        else if (mapping.type === 'compositions') {
                            const regime = mapping.regime!;
                            onProgress?.({ step: sheetName, message: `Processando Composições ${sheetName}...`, current: step++, total: totalSteps });

                            const compositions = parseCompositionSheet(sheet, sheetName);
                            log(`aba=${sheetName} Lidos=${compositions.length} composições.`);

                            if (compositions.length === 0) {
                                log(`[WARN] Aba ${sheetName} de composições vazia. Verifique se o formato mudou.`);
                                continue;
                            }

                            // Criar tabela de preço para este regime
                            const priceTable = await SinapiService.upsertPriceTable({
                                source: 'SINAPI',
                                uf,
                                competence,
                                regime,
                                file_urls: { [sheetName]: file.name }
                            });

                            // Upsert composições
                            const compCount = await SinapiService.batchUpsertCompositions(
                                compositions.map(c => ({
                                    code: c.code,
                                    description: c.description,
                                    unit: c.unit,
                                    composition_type: c.composition_type
                                }))
                            );
                            result.counts.compositions += compCount;

                            // Upsert preços
                            const priceCount = await SinapiService.batchUpsertCompositionPrices(
                                priceTable.id,
                                compositions.filter(c => c.price && c.price > 0).map(c => ({
                                    composition_code: c.code,
                                    price: c.price!
                                }))
                            );
                            result.counts.composition_prices += priceCount;

                            log(`aba=${sheetName} Persistidos: ${compCount} composições, ${priceCount} preços.`);
                        }

                        // ANALÍTICO (Fonte Rica: Itens + Composições extras)
                        else if (mapping.type === 'analytic') {
                            onProgress?.({ step: sheetName, message: 'Processando Analítico Completo...', current: step++, total: totalSteps });

                            const { compositions, items } = parseAnalyticSheet(sheet);
                            log(`aba=${sheetName} Lidos=${compositions.length} composições e ${items.length} itens de composição.`);

                            if (items.length === 0) {
                                log(`[WARN] Aba Analítico vazia. Importação de itens falhará.`);
                                continue;
                            }

                            // 1. Salvar composições encontradas no analítico (que podem não estar no sintético)
                            if (compositions.length > 0) {
                                const extraComps = await SinapiService.batchUpsertCompositions(
                                    compositions.map(c => ({
                                        code: c.code,
                                        description: c.description,
                                        unit: c.unit
                                    }))
                                );
                                result.counts.compositions += extraComps;
                            }

                            // 2. Salvar ITENS para AMBOS os regimes (pois Analítico é agnóstico ou base para ambos)
                            // Nota: O ideal seria ter um Analítico por regime, mas geralmente o arquivo SINAPI vem com um Analítico só?
                            // O arquivo "Referência" tem CSD, CCD, ISD, ICD e 1 Analítico.
                            // Assume-se que a estrutura analítica (quais insumos compõem o que) é igual, muda só preço.

                            for (const regime of ['DESONERADO', 'NAO_DESONERADO'] as const) {
                                // Precisamos garantir que a tabela de preço do regime exista
                                let priceTable = await SinapiService.getPriceTable(uf, competence, regime);

                                // Se não existir (ex: não processou CSD/CCD ainda), criamos agora
                                if (!priceTable) {
                                    priceTable = await SinapiService.upsertPriceTable({
                                        source: 'SINAPI',
                                        uf,
                                        competence,
                                        regime,
                                        file_urls: { [sheetName]: file.name }
                                    });
                                }

                                if (priceTable) {
                                    const itemCount = await SinapiService.batchUpsertCompositionItems(
                                        priceTable.id,
                                        items
                                    );
                                    result.counts.composition_items += itemCount;
                                    log(`aba=${sheetName} -> regime=${regime}: ${itemCount} itens vinculados.`);
                                }
                            }
                        }

                        // PREÇOS (Analítico com Custo)
                        else if (mapping.type === 'prices') {
                            onProgress?.({ step: sheetName, message: 'Extraindo Preços...', current: step++, total: totalSteps });

                            const { inputPrices, compositionPrices } = parsePricesSheet(sheet, sheetName);
                            log(`aba=${sheetName} Extraídos: ${inputPrices.length} preços de insumos, ${compositionPrices.length} preços de composições.`);

                            if (inputPrices.length === 0 && compositionPrices.length === 0) {
                                log(`[WARN] Aba de preços vazia. Pulando.`);
                                continue;
                            }

                            // Processar para AMBOS os regimes (pois a aba de preços normalmente contém dados para ambos)
                            for (const regime of ['DESONERADO', 'NAO_DESONERADO'] as const) {
                                const priceTable = await SinapiService.getPriceTable(uf, competence, regime);

                                if (!priceTable) {
                                    log(`[WARN] Price table não encontrada para regime=${regime}. Pulando preços deste regime.`);
                                    continue;
                                }

                                // DEDUPE + Persist Input Prices
                                if (inputPrices.length > 0) {
                                    const dedupedInputPrices = deduplicatePrices(
                                        inputPrices.map(p => ({ input_code: p.code, price: p.price })),
                                        'input_code'
                                    );

                                    log(`aba=${sheetName} regime=${regime}: Input prices (before dedupe: ${inputPrices.length}, after: ${dedupedInputPrices.length})`);

                                    const inputPriceCount = await SinapiService.batchUpsertInputPrices(
                                        priceTable.id,
                                        dedupedInputPrices
                                    );

                                    result.counts.input_prices = (result.counts.input_prices || 0) + inputPriceCount;
                                    log(`aba=${sheetName} regime=${regime}: Persistidos ${inputPriceCount} preços de insumos.`);
                                }

                                // DEDUPE + Persist Composition Prices
                                if (compositionPrices.length > 0) {
                                    const dedupedCompPrices = deduplicatePrices(
                                        compositionPrices.map(p => ({ composition_code: p.code, price: p.price })),
                                        'composition_code'
                                    );

                                    log(`aba=${sheetName} regime=${regime}: Composition prices (before dedupe: ${compositionPrices.length}, after: ${dedupedCompPrices.length})`);

                                    const compPriceCount = await SinapiService.batchUpsertCompositionPrices(
                                        priceTable.id,
                                        dedupedCompPrices
                                    );

                                    result.counts.composition_prices = (result.counts.composition_prices || 0) + compPriceCount;
                                    log(`aba=${sheetName} regime=${regime}: Persistidos ${compPriceCount} preços de composições.`);
                                }
                            }
                        }
                    }

                    onProgress?.({ step: 'done', message: 'Concluído!', current: totalSteps, total: totalSteps });

                    // Sucesso se importou algo relevante
                    const hasData = result.counts.inputs > 0 || result.counts.compositions > 0;
                    result.success = result.errors.length === 0 && hasData;

                    if (!hasData) {
                        result.errors.push("Nenhum dado válido encontrado em nenhuma aba.");
                    }

                    log(`Ingestão Finalizada. Status: ${result.success ? 'SUCESSO' : 'ALERTA/ERRO'}`);
                    log(`Resumo: Insumos=${result.counts.inputs}, Composições=${result.counts.compositions}, Itens=${result.counts.composition_items}`);

                    resolve(result);

                } catch (err: any) {
                    result.errors.push(`Erro fatal no processamento: ${err.message}`);
                    log(`ERRO FATAL: ${err.message}`);
                    resolve(result);
                }
            };

            // Iniciar leitura do arquivo
            reader.readAsArrayBuffer(file);

        } catch (err: any) {
            result.errors.push(`Erro inicialização: ${err.message}`);
            log(`ERRO FATAL: ${err.message}`);
            resolve(result);
        }
    });
}

// =====================================================
// MAIN INGESTION (URL-based - DEPRECATED)
// =====================================================

export async function ingestSinapiReferencia(
    fileUrl: string,
    uf: string = 'BA',
    competence: string = '2025-01',
    onProgress?: (progress: IngestionProgress) => void
): Promise<IngestionResult> {
    const result: IngestionResult = {
        success: false,
        counts: {
            inputs: 0,
            compositions: 0,
            input_prices: 0,
            composition_prices: 0,
            composition_items: 0
        },
        errors: [],
        logs: []
    };

    const log = (msg: string) => {
        result.logs.push(`[${new Date().toISOString()}] ${msg}`);
        console.log(`[SINAPI INGEST] ${msg}`);
    };

    try {
        log(`Iniciando ingestão: UF=${uf}, Competência=${competence}`);
        log(`Arquivo: ${fileUrl.substring(0, 100)}...`);

        // 1. Download do arquivo
        onProgress?.({ step: 'download', message: 'Baixando arquivo...', current: 0, total: 10 });
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const arrayBuffer = await response.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        log(`Arquivo lido. Abas encontradas: ${workbook.SheetNames.join(', ')}`);

        // 2. Processar cada aba conforme mapeamento
        let step = 1;
        const totalSteps = Object.keys(SHEET_MAPPING).filter(name => workbook.SheetNames.includes(name)).length + 1;

        for (const sheetName of workbook.SheetNames) {
            // Ignorar abas desnecessárias
            if (IGNORED_SHEETS.includes(sheetName)) {
                log(`Ignorando aba: ${sheetName}`);
                continue;
            }

            const mapping = SHEET_MAPPING[sheetName as keyof typeof SHEET_MAPPING];
            if (!mapping) {
                log(`Aba desconhecida (ignorada): ${sheetName}`);
                continue;
            }

            const sheet = workbook.Sheets[sheetName];

            // INSUMOS (ISD ou ICD)
            if (mapping.type === 'inputs') {
                const regime = mapping.regime!;
                onProgress?.({ step: sheetName, message: `Processando ${sheetName} (${regime})...`, current: step++, total: totalSteps });

                const inputs = parseInputSheet(sheet, sheetName);
                log(`aba=${sheetName} regime=${regime} uf=${uf} competencia=${competence} rows=${inputs.length}`);

                if (inputs.length === 0) {
                    log(`AVISO: aba=${sheetName} retornou 0 registros (possível erro de parsing)`);
                    result.errors.push(`Aba ${sheetName}: nenhum insumo encontrado`);
                    continue;
                }

                // Criar tabela de preço para este regime
                const priceTable = await SinapiService.upsertPriceTable({
                    source: 'SINAPI',
                    uf,
                    competence,
                    regime,
                    file_urls: { [sheetName]: fileUrl }
                });
                log(`aba=${sheetName} price_table_id=${priceTable.id}`);

                // Upsert insumos
                const inputCount = await SinapiService.batchUpsertInputs(
                    inputs.map(i => ({
                        code: i.code,
                        description: i.description,
                        unit: i.unit,
                        category: i.category
                    }))
                );
                result.counts.inputs += inputCount;

                // Upsert preços
                const priceCount = await SinapiService.batchUpsertInputPrices(
                    priceTable.id,
                    inputs.filter(i => i.price > 0).map(i => ({
                        input_code: i.code,
                        price: i.price
                    }))
                );
                result.counts.input_prices += priceCount;

                log(`aba=${sheetName} SUCESSO: ${inputCount} insumos, ${priceCount} preços salvos`);
            }

            // COMPOSIÇÕES (CSD ou CCD)
            else if (mapping.type === 'compositions') {
                const regime = mapping.regime!;
                onProgress?.({ step: sheetName, message: `Processando ${sheetName} (${regime})...`, current: step++, total: totalSteps });

                const compositions = parseCompositionSheet(sheet, sheetName);
                log(`aba=${sheetName} regime=${regime} uf=${uf} competencia=${competence} rows=${compositions.length}`);

                if (compositions.length === 0) {
                    log(`AVISO: aba=${sheetName} retornou 0 registros (possível erro de parsing)`);
                    result.errors.push(`Aba ${sheetName}: nenhuma composição encontrada`);
                    continue;
                }

                // Criar tabela de preço para este regime
                const priceTable = await SinapiService.upsertPriceTable({
                    source: 'SINAPI',
                    uf,
                    competence,
                    regime,
                    file_urls: { [sheetName]: fileUrl }
                });
                log(`aba=${sheetName} price_table_id=${priceTable.id}`);

                // Upsert composições
                const compCount = await SinapiService.batchUpsertCompositions(
                    compositions.map(c => ({
                        code: c.code,
                        description: c.description,
                        unit: c.unit,
                        composition_type: c.composition_type
                    }))
                );
                result.counts.compositions += compCount;

                // Upsert preços
                const priceCount = await SinapiService.batchUpsertCompositionPrices(
                    priceTable.id,
                    compositions.filter(c => c.price && c.price > 0).map(c => ({
                        composition_code: c.code,
                        price: c.price!
                    }))
                );
                result.counts.composition_prices += priceCount;

                log(`aba=${sheetName} SUCESSO: ${compCount} composições, ${priceCount} preços salvos`);
            }

            // ANALÍTICO (vai para AMBOS os regimes)
            else if (mapping.type === 'analytic') {
                onProgress?.({ step: sheetName, message: 'Processando analítico...', current: step++, total: totalSteps });

                const { compositions, items } = parseAnalyticSheet(sheet);
                log(`aba=${sheetName} uf=${uf} competencia=${competence} rows=${items.length}`);

                if (items.length === 0) {
                    log(`AVISO: aba=${sheetName} retornou 0 itens (possível erro de parsing)`);
                    result.errors.push(`Aba ${sheetName}: nenhum item encontrado`);
                    continue;
                }

                if (compositions.length > 0) {
                    const extraComps = await SinapiService.batchUpsertCompositions(
                        compositions.map(c => ({
                            code: c.code,
                            description: c.description,
                            unit: c.unit
                        }))
                    );
                    result.counts.compositions += extraComps;
                    log(`aba=${sheetName} composições extras salvas: ${extraComps}`);
                }

                // Salvar itens para AMBOS os regimes
                for (const regime of ['DESONERADO', 'NAO_DESONERADO'] as const) {
                    const priceTable = await SinapiService.getPriceTable(uf, competence, regime);
                    if (priceTable) {
                        const itemCount = await SinapiService.batchUpsertCompositionItems(
                            priceTable.id,
                            items
                        );
                        result.counts.composition_items += itemCount;
                        log(`aba=${sheetName} SUCESSO: ${itemCount} itens salvos para regime=${regime}`);
                    } else {
                        log(`ERRO: aba=${sheetName} tabela de preço não encontrada para regime=${regime}`);
                        result.errors.push(`Aba ${sheetName}: tabela de preço não encontrada para ${regime}`);
                    }
                }
            }
        }

        onProgress?.({ step: 'done', message: 'Concluído!', current: totalSteps, total: totalSteps });
        result.success = result.errors.length === 0;
        log(`Ingestão ${result.success ? 'CONCLUÍDA COM SUCESSO' : 'concluída com erros'}`);
        log(`Totais: ${result.counts.inputs} insumos, ${result.counts.compositions} composições, ${result.counts.composition_items} itens`);

    } catch (err: any) {
        result.errors.push(`Erro fatal: ${err.message}`);
        log(`ERRO FATAL: ${err.message}`);
    }

    return result;
}

// Mantendo compatibilidade com interface antiga para não quebrar UI
export async function ingestSinapiMonth(
    uf: string,
    competence: string,
    regime: 'DESONERADO' | 'NAO_DESONERADO',
    fileUrls: { inputsUrl?: string; compositionsUrl?: string; analyticsUrl?: string },
    onProgress?: (progress: IngestionProgress) => void
): Promise<IngestionResult> {
    // Se tiver referenciaUrl, usar novo método
    if ((fileUrls as any).referenciaUrl) {
        return ingestSinapiReferencia((fileUrls as any).referenciaUrl, uf, competence, onProgress);
    }

    // Fallback para método antigo (não implementado completamente)
    return {
        success: false,
        counts: { inputs: 0, compositions: 0, input_prices: 0, composition_prices: 0, composition_items: 0 },
        errors: ['Use o arquivo de referência único (SINAPI_Referência_2025_01.xlsx)'],
        logs: []
    };
}
