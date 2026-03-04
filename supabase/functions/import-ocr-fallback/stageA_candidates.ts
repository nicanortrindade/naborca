
// ------------------------------------------------------------------
// STAGE A: Deterministic Candidate Generation (Heuristics)
// ------------------------------------------------------------------
// Goal: Produce "grounding" candidates from raw OCR text to prevent
// empty LLM results. NO LLM usage here. Pure Regex/Heuristics.
// ------------------------------------------------------------------

export interface StageACaps {
    max_lines_scanned: number;
    max_candidates: number;
    max_evidence_chars: number;
}

export interface StageAStats {
    lines_total: number;
    lines_scanned: number;
    candidates_found: number;
    blocks_found: number;
    synthetic_heads_found: number;
    heuristics_hit: Record<string, number>;
}

export interface StageACandidate {
    id: string; // short uuid or hash
    kind: 'synthetic_line' | 'analytic_block';
    source: 'ocr_heuristic_v1';
    confidence: number;
    line_no?: number;
    line_range?: [number, number]; // [start, end] inclusive
    evidence: string; // literal text snippet
    snippet: string; // The specific line text
    context_before?: string; // 1-2 lines before
    context_after?: string; // 1-2 lines after
    extracted_signals: {
        item_path?: string;
        code?: string;
        description_fragment?: string;
        unit?: string;
        quantity_candidate?: number;
        unit_price_candidate?: number;
        total_candidate?: number;
    };
    evidence_lines?: Array<{ text: string }>; // Structured evidence lines for Stage B
    raw_numbers: Array<{ value: number; text: string; lineNo: number; context?: string }>;
    warnings: string[];
    debug_heuristic: string[];
}

export interface StageAResult {
    version: string;
    generated_at: string;
    doc_type_hints: {
        is_analytic_likely: boolean;
        is_synthetic_likely: boolean;
        confidence: number;
        reasons: string[];
    };
    caps: StageACaps;
    stats: StageAStats;
    candidates: StageACandidate[];
    warnings: string[];
}

const DEFAULT_CAPS: StageACaps = {
    max_lines_scanned: 6000,
    max_candidates: 800,
    max_evidence_chars: 1200
};

// ------------------------------------------------------------------
// 1. Text Normalization & Utils
// ------------------------------------------------------------------

function normalizeTextLines(text: string): { lines: string[], mapOriginalLineNo: number[] } {
    if (!text) return { lines: [], mapOriginalLineNo: [] };

    // Split by newline, handle \r
    const rawLines = text.split(/\r?\n/);
    const normalized: string[] = [];
    const map: number[] = [];

    rawLines.forEach((line, idx) => {
        // Truncate insane lines (e.g. minified JS or garbage)
        let clean = line;
        if (clean.length > 2000) {
            clean = clean.substring(0, 2000) + " [TRUNCATED]";
        }

        // Collapse spaces
        clean = clean.replace(/\s+/g, ' ').trim();

        normalized.push(clean);
        map.push(idx + 1); // 1-based original line number
    });

    return { lines: normalized, mapOriginalLineNo: map };
}

function generateShortId(): string {
    return Math.random().toString(36).substring(2, 10);
}

// ------------------------------------------------------------------
// 2. Document Type Hints
// ------------------------------------------------------------------

export function detectDocTypeHints(text: string, fileMeta?: any): StageAResult['doc_type_hints'] {
    const hints = {
        is_analytic_likely: false,
        is_synthetic_likely: false,
        confidence: 0,
        reasons: [] as string[]
    };

    if (!text) return hints;
    const lower = text.toLowerCase().slice(0, 5000); // Check header mostly

    // Simple keyword checks
    if (lower.includes('analítico') || lower.includes('analitico') || lower.includes('composição') || lower.includes('composicao')) {
        hints.is_analytic_likely = true;
        hints.reasons.push('keyword_analytic');
        hints.confidence += 0.3;
    }

    if (lower.includes('sintético') || lower.includes('sintetico') || lower.includes('resumo')) {
        hints.is_synthetic_likely = true;
        hints.reasons.push('keyword_synthetic');
        hints.confidence += 0.3;
    }

    // Role hint from metadata (strongest)
    if (fileMeta?.role === 'analytic') {
        hints.is_analytic_likely = true;
        hints.confidence = 0.9;
        hints.reasons.push('meta_role_analytic');
    } else if (fileMeta?.role === 'synthetic') {
        hints.is_synthetic_likely = true;
        hints.confidence = 0.9;
        hints.reasons.push('meta_role_synthetic');
    }

    return hints;
}


// ------------------------------------------------------------------
// 3. Heuristics IMPLEMENTATION
// ------------------------------------------------------------------

// Regex Patterns
// Captura: " 1.2.2 90776..." (com espaço) E " 1.2.290776..." (sem espaço entre path e código)
const REGEX_ITEM_PATH = /^\s*(\d{1,3}(?:\.\d{1,3}){1,6})\s*(.{5,})$/;
// Captura: "1SERVIÇOS PRELIMINARES E INDIRETOS185.303,28" ou "1 SERVIÇOS..."
// Remove o total financeiro colado no final (ex: 185.303,28)
const REGEX_SECTION_TITLE = /^\s*(\d{1,3})\s*([A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÇ][A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÇ\s,\/\-().°"']{3,})(?:[\s\d.,]+%?\s*)*$/;
const REGEX_CODE_START = /^(\d{4,10}|[A-Z]{2,5}\d{3,10})\s+(.{5,})$/; // "94321 Description" or "CPU123 Desc" or "2451 Desc"
const REGEX_UNIT = /\b(UN|und|m²|m2|m³|m3|kg|h|vb|m)\b/i;
const REGEX_MONEY_OR_QTY = /\b\d{1,3}(?:\.\d{3})*(?:,\d{1,4})?\b|\b\d{1,6}(?:\.\d{1,4})?\b/g; // 1.234,56 or 1234.56
// Guard: detecta linhas que são títulos de seção e NÃO devem ser consumidas pelo S0
const REGEX_IS_SECTION_TITLE = /^(\d{1,2}(?:\.\d{1,2}){0,2})\s*([AÀÁÂÃBCDEÉÊFGHIÍJKLMNOÓÔÕPQRSTUÚVWXYZ][A-ZÀÁÂÃÉÊÍÓÔÕÚÇ ]{4,})|^([A-Z]{1,3})\s*[-–]\s*([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÇ ]{4,})$/;
const REGEX_BANKS_HEADER = /(SINAPI|ORSE|SICRO|SBC|EMOP|SETOP|SEINFRA|IOPES|CPU|CDHU|AGESUL|AGETOP|Próprio|SICRO3|GOINFRA)(?:\s*[-–]\s*(?:SINAPI|ORSE|SICRO|SBC|EMOP|SETOP|SEINFRA|IOPES|CPU|CDHU|AGESUL|AGETOP|Próprio|SICRO3|GOINFRA)){2,}/i;

// Guard: detecta cabeçalho de projeto com data DD/MM/YYYY + percentuais colados
// Ex: "Centro de Atenção Psicossocial - Portes 1 e 2 - Área Construída: 564,56m²25,00%71,46%07/10/2025"
const REGEX_PROJECT_TITLE_WITH_DATE_PCT = /\d{2}\/\d{2}\/\d{4}.*%|%.*\d{2}\/\d{2}\/\d{4}/;

// Guard: detecta totais de seção — dígito(s) colado(s) em texto maiúsculo seguido de número sem separador de item_path
// Ex: "1SERVIÇOS PRELIMINARES E INDIRETOS185.303,28"
// Padrão: começa com 1-2 dígitos (sem ponto), seguidos de texto maiúsculo (5+ chars), terminando com números colados
const REGEX_SECTION_TOTAL = /^\d{1,2}[A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ ]{4,}\d/;

const DEBUG_P1 = false; // flag de debug desativada em produção
const STOP_WORDS_RE = /^(TOTAL\s*(SEM|COM)\s*BDI|TOTAL\s*GERAL|SUBTOTAL|^TOTAL$)/i;

function extractNumbers(text: string): number[] {
    const matches = text.match(REGEX_MONEY_OR_QTY) || [];
    return matches.map(m => {
        // naive parsing: if comma exists, it's decimal separator (PT-BR), otherwise dot loop
        // actually OCR can be messy. Let's assume standard PT-BR "1.000,00" mostly
        let clean = m.replace(/\./g, '').replace(',', '.');
        const val = parseFloat(clean);
        return isNaN(val) ? -1 : val;
    }).filter(v => v >= 0);
}


export function generateCandidatesStageA(text: string, options: {
    fileMeta?: any,
    caps?: Partial<StageACaps>
} = {}): StageAResult {

    const caps = { ...DEFAULT_CAPS, ...options.caps };
    const { lines, mapOriginalLineNo } = normalizeTextLines(text);
    const docHints = detectDocTypeHints(text, options.fileMeta);

    // If doc hints are ambiguous, run BOTH. If explicit, prioritize one set of heuristics but allow fallback?
    // Let's run both S and A heuristics if confidence < 0.8, otherwise focus.
    // Actually, safest is to run Synthetic detection on lines FIRST, and if Analytic patterns appear, grab blocks.

    const runSynthetic = true; // Always check for line items
    const runAnalytic = docHints.is_analytic_likely || !docHints.is_synthetic_likely;

    const stats: StageAStats = {
        lines_total: lines.length,
        lines_scanned: 0,
        candidates_found: 0,
        blocks_found: 0,
        synthetic_heads_found: 0,
        heuristics_hit: {}
    };

    const candidates: StageACandidate[] = [];
    const _originalPush = candidates.push.bind(candidates);
    candidates.push = function (...items: StageACandidate[]) {
        for (const item of items) {
            const desc = item.extracted_signals?.description_fragment || '';
            const snippet = item.snippet || '';
            // Última linha de defesa: descarta candidato se ele casar com o padrão de cabeçalho de múltiplos bancos
            if (REGEX_BANKS_HEADER.test(desc) || REGEX_BANKS_HEADER.test(snippet)) {
                continue;
            }
            // Guard: descarta cabeçalhos de projeto com data+percentual colados
            if (REGEX_PROJECT_TITLE_WITH_DATE_PCT.test(snippet) || REGEX_PROJECT_TITLE_WITH_DATE_PCT.test(desc)) {
                continue;
            }
            // Guard: descarta totais de seção (dígito colado em texto maiúsculo + número)
            if (REGEX_SECTION_TOTAL.test(snippet) && !item.warnings?.includes('section_title_candidate')) {
                if (DEBUG_P1) console.log('[P1-TOTAL-SKIP]', JSON.stringify({ line: snippet.substring(0, 80) }));
                continue;
            }
            if (STOP_WORDS_RE.test(desc.trim()) || STOP_WORDS_RE.test(snippet.trim())) {
                if (DEBUG_P1) console.log('[P1-STOPWORD-SKIP]', JSON.stringify({ line: snippet.substring(0, 80) }));
                continue;
            }
            _originalPush(item);
        }
        return this.length;
    };
    const warnings: string[] = [];

    const limit = Math.min(lines.length, caps.max_lines_scanned);
    stats.lines_scanned = limit;

    // --- SYNTHETIC SCAN LOOP ---
    if (runSynthetic) {
        // ── PRÉ-VARREDURA: mapeia índice → item_path para todos os cabeçalhos S1 ──
        const sectionMap = new Map<number, string>();
        for (let si = 0; si < limit; si++) {
            const m = lines[si].match(REGEX_ITEM_PATH);
            if (m) sectionMap.set(si, m[1]);
        }

        // Array ordenado de [lineIdx, item_path] para varredura linear
        const sectionEntries = Array.from(sectionMap.entries()).sort((a, b) => a[0] - b[0]);

        // Retorna o item_path mais próximo: prefere o cabeçalho imediatamente anterior;
        // se não existir anterior, usa o próximo.
        function resolveNearestSection(lineIdx: number): string | undefined {
            let before: string | undefined = undefined;
            let after: string | undefined = undefined;
            for (const [sIdx, path] of sectionEntries) {
                if (sIdx <= lineIdx) { before = path; }
                else if (after === undefined) { after = path; break; }
            }
            return before ?? after;
        }

        // ── PRÉ-VARREDURA S0: Código Isolado + Descrição Multiline (Formato B fragmentado) ──
        // Detecta: linha com [item_path+BANCO+código] sem descrição, seguida de fragmentos de
        // descrição sem valores, depois unidade e números. Gera UM candidato S0_multiline_merge
        // em vez de múltiplos S4 órfãos.
        //
        // Ampliado 2026-02-23 (Kennedy fix):
        //   • Adiciona Composição/Composicao ao grupo de bancos
        //   • Permite espaço opcional entre banco e código numérico (ORSE 20, ORSE 2511)
        const REGEX_ISOLATED_CODE = /^(\d{1,3}(?:\.\d{1,3}){1,6})\.(SINAPI|ORSE|SICRO3?|CPU|Próprio|PROP|Composi[çc][aã]o?)\s*(\w+(?:[-_]\w*)?)?\s*$/i;

        // S0b: linha FULL collapse — item_path + banco + código + descrição + unidade na mesma linha.
        // Ex: "1.3.0.0.2.ORSE 2511 Carga manual de material de 3ª categoriaM3"
        // Ex: "1.7.0.0.1.Composição KENE001 BANCO DE ALVENARIA COM PINTURA ACRILICAM"
        // Ex: "1.2.0.0.1.ComposiçãoKENNE011Administração local da obraMÊS"
        const REGEX_S0B_FULL = /^(\d{1,3}(?:\.\d{1,3}){1,6})\.(SINAPI|ORSE|SICRO3?|CPU|Próprio|PROP|Composi[çc][aã]o?)\s*(\w+(?:[-_]\w*)?)?\s+(.+?)\s*(M2|M3|UN|ML|KG|MÊS|KM|VB|CJ|SC|T|HA|H|L|M|m²|m³)\s*$/i;

        const consumedLines = new Set<number>();

        for (let si = 0; si < limit - 2; si++) {
            if (candidates.length >= caps.max_candidates) break;
            const sLine = lines[si].trim();
            if (REGEX_BANKS_HEADER.test(sLine)) continue;

            // ── S0b: FULL collapse — todos os campos numa única linha ──────────────
            const mFull = sLine.match(REGEX_S0B_FULL);
            if (mFull) {
                const [, pathPart, bankPart, codePart = '', descPart, unitPart] = mFull;
                const rawCode = codePart
                    .replace(/\s*-\s*ADAPT\.?\s*$/i, '')
                    .replace(/[-_]ADP[-_]?\d*/i, '')
                    .trim();

                // Coletar valores numéricos nas próximas linhas (quantidade, preço)
                const valueLookahead: string[] = [];
                for (let w = si + 1; w < Math.min(si + 7, limit); w++) {
                    const nxt = lines[w].trim();
                    if (REGEX_ITEM_PATH.test(nxt) || REGEX_CODE_START.test(nxt)) break;
                    if (/\d/.test(nxt)) valueLookahead.push(nxt);
                }

                stats.heuristics_hit['S0b_full_collapse'] = (stats.heuristics_hit['S0b_full_collapse'] || 0) + 1;
                stats.synthetic_heads_found++;

                candidates.push({
                    id: generateShortId(),
                    kind: 'synthetic_line',
                    source: 'ocr_heuristic_v1',
                    confidence: 0.78,
                    line_no: mapOriginalLineNo[si],
                    line_range: [mapOriginalLineNo[si], mapOriginalLineNo[Math.min(si + 6, limit - 1)]],
                    evidence: sLine + (valueLookahead.length > 0 ? ' || ' + valueLookahead.join(' || ') : ''),
                    snippet: `${pathPart}.${bankPart}${rawCode ? ' ' + rawCode : ''} ${descPart.trim()}`,
                    context_before: lines.slice(Math.max(0, si - 2), si).join('\n'),
                    context_after: [unitPart, ...valueLookahead].join('\n'),
                    extracted_signals: {
                        item_path: pathPart,
                        code: rawCode || undefined,
                        description_fragment: descPart.trim().substring(0, 400),
                        unit: unitPart.trim()
                    },
                    raw_numbers: [],
                    warnings: ['s0b_full_collapse'],
                    debug_heuristic: ['S0b_full_collapse']
                });

                consumedLines.add(si);
                continue; // linha consumida — não processar em S0/S1/S3/S4
            }

            // ── S0 original: código isolado + descrição nas linhas seguintes ──────
            const mCode = sLine.match(REGEX_ISOLATED_CODE);
            if (!mCode) continue;

            const [, pathPart, bankPart, codePart = ''] = mCode;
            // Limpar sufixos ADP do código
            const rawCode = codePart
                .replace(/\s*-\s*ADAPT\.?\s*$/i, '')
                .replace(/[-_]ADP[-_]?\d*/i, '')
                .trim();

            // Coletar fragmentos de descrição (sem valores, sem nova âncora)
            const descFragments: string[] = [];
            let j = si + 1;
            let foundHeader = false;
            for (; j < Math.min(si + 5, limit); j++) {
                const nxt = lines[j].trim();
                if (!nxt || nxt.length < 3) break;
                if (REGEX_BANKS_HEADER.test(nxt)) { foundHeader = true; break; }
                if (REGEX_ITEM_PATH.test(nxt) || REGEX_CODE_START.test(nxt)) break;
                if (/^\s*[\d.,\s%]+\s*$/.test(nxt)) break;
                if (REGEX_UNIT.test(nxt) && nxt.length < 15) break;
                // Não consumir linhas que são títulos de seção
                if (REGEX_IS_SECTION_TITLE.test(nxt)) break;
                descFragments.push(nxt);
            }
            if (foundHeader || descFragments.length === 0) continue;

            const mergedDesc = `${pathPart}.${bankPart}${codePart} ${descFragments.join(' ')}`;

            // Coletar unidade + valores numéricos nas próximas 6 linhas
            const valueLookahead: string[] = [];
            let foundNum2 = false;
            for (let w = j; w < Math.min(j + 6, limit); w++) {
                const nxt2 = lines[w].trim();
                if (REGEX_ITEM_PATH.test(nxt2) || REGEX_CODE_START.test(nxt2)) break;
                if ((REGEX_UNIT.test(nxt2) && nxt2.length < 15) || /\d/.test(nxt2)) {
                    if (/\d/.test(nxt2)) foundNum2 = true;
                    valueLookahead.push(nxt2);
                }
            }
            if (!foundNum2) continue;

            stats.heuristics_hit['S0_multiline_merge'] = (stats.heuristics_hit['S0_multiline_merge'] || 0) + 1;
            stats.synthetic_heads_found++;

            candidates.push({
                id: generateShortId(),
                kind: 'synthetic_line',
                source: 'ocr_heuristic_v1',
                confidence: 0.72,
                line_no: mapOriginalLineNo[si],
                line_range: [mapOriginalLineNo[si], mapOriginalLineNo[Math.min(j + 5, limit - 1)]],
                evidence: mergedDesc + (valueLookahead.length > 0 ? ' || ' + valueLookahead.join(' || ') : ''),
                snippet: mergedDesc,
                context_before: lines.slice(Math.max(0, si - 2), si).join('\n'),
                context_after: valueLookahead.join('\n'),
                extracted_signals: {
                    item_path: pathPart,
                    code: `${bankPart}${rawCode}`,
                    description_fragment: descFragments.join(' ').substring(0, 400)
                },
                raw_numbers: [],
                warnings: ['multiline_desc_merge'],
                debug_heuristic: ['S0_multiline_merge']
            });

            // Marcar linhas consumidas (código isolado + fragmentos de descrição)
            consumedLines.add(si);
            for (let k = si + 1; k < j; k++) consumedLines.add(k);
            si = j - 1;
        }

        const pathCounters = new Map<string, number>();
        function deduplicatePath(path: string): string {
            const count = (pathCounters.get(path) || 0) + 1;
            pathCounters.set(path, count);
            if (count === 1) return path;
            // incrementa o último segmento: "1.2.2" → "1.2.3"
            const parts = path.split('.');
            const last = parseInt(parts[parts.length - 1]) + (count - 1);
            parts[parts.length - 1] = String(last);
            return parts.join('.');
        }

        for (let i = 0; i < limit; i++) {
            if (candidates.length >= caps.max_candidates) break;

            let line = lines[i].replace(/\r/g, '');
            const originalLineNo = mapOriginalLineNo[i];

            // ETAPA 0: Sempre testa título N1 PRIMEIRO, antes de qualquer outra verificação
            const matchSection = line.match(REGEX_SECTION_TITLE);
            if (matchSection) {
                candidates.push({
                    id: generateShortId(),
                    kind: 'synthetic_line',
                    source: 'ocr_heuristic_v1',
                    confidence: 0.8,
                    line_no: originalLineNo,
                    evidence: line,
                    snippet: line,
                    context_before: lines.slice(Math.max(0, i - 1), i).join('\n'),
                    context_after: lines.slice(i + 1, Math.min(limit, i + 2)).join('\n'),
                    extracted_signals: {
                        item_path: matchSection[1],
                        description_fragment: matchSection[2].trim(),
                    },
                    raw_numbers: [],
                    warnings: ['section_title_candidate'],
                    debug_heuristic: ['S_TITLE']
                } as any);
                continue;
            }

            // ETAPA 1: Só agora verifica linhas muito curtas, paginação, etc.
            if (line.length < 5) continue;
            if (/^(pag|pág|data|hora|emitido)/i.test(line)) continue;
            if (/^[_\-=.]{3,}$/.test(line)) continue;
            if (REGEX_BANKS_HEADER.test(line)) continue;

            // GARBAGE FILTER: PDF page headers masquerading as items
            if (/PLANILHA DE ORÇAMENTO SINT[ÉE]TICO/i.test(line) ||
                /ItemC[óo]digoBancoDescri[çc][ãa]o/i.test(line) ||
                /Secretaria de Aten[çc][ãa]o Especializada/i.test(line) ||
                /Encargo Social Mensalista/i.test(line)) {
                continue;
            }

            // FILTER: Project title headers with date+percentage glued
            // Ex: "Centro de Atenção Psicossocial...564,56m²25,00%71,46%07/10/2025"
            if (REGEX_PROJECT_TITLE_WITH_DATE_PCT.test(line)) continue;

            // FILTER: Bank header lines (e.g. "SINAPI (07/2025) - CPOS/CDHU (06/2025) - ...")
            // These are reference metadata, not budget items. Must be filtered on raw line.
            if (/SINAPI\s*\(\d{2}\/\d{4}\)|CPOS\/CDHU|ORSE\s*\(\d{2}\/\d{4}\)|IOPES|EMOP|SETOP|SEINFRA|AGETOP|AGESUL/i.test(line) &&
                (line.match(/\(\d{2}\/\d{4}\)/g) || []).length >= 2) {
                continue;
            }

            // ETAPA 2: Resolve a seção ativa
            const lastSectionPath = resolveNearestSection(i);

            // ETAPA 3: Pular linhas já consumidas pelo S0_multiline_merge
            if (consumedLines.has(i)) continue;

            let hitS1 = false;
            let hitS2 = false;
            let hitS3 = false;
            let hitS4 = false;

            // ST-EMBEDDED: detecta título N1/N2 embutido na mesma linha/célula que um item
            // Ex: "FUNDAÇÃO\n LOCAÇÃO CONVENCIONAL DE OBRA..." ou "9.1 REVESTIMENTO\n PISO..."
            const embeddedTitleMatch = line.match(/^([A-Z0-9ÀÁÂÃÉÊÍÓÔÕÚÇ][A-Z0-9ÀÁÂÃÉÊÍÓÔÕÚÇ\s.]{3,})\n\s*(.+)$/);
            // LOG TEMPORÁRIO
            if (/^\s*\d{1,3}[A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÇ]/.test(line) && line.length < 120) {
                console.log('[ST-EMBEDDED-TEST]', JSON.stringify({
                    line: line.substring(0, 60),
                    embeddedMatch: !!embeddedTitleMatch
                }));
            }
            if (embeddedTitleMatch) {
                const titlePart = embeddedTitleMatch[1].trim();
                const itemPart = embeddedTitleMatch[2].trim();
                // Só processa se o título tiver tamanho mínimo
                if (titlePart.length >= 4) {
                    // Candidato 1: título de seção
                    candidates.push({
                        id: generateShortId(),
                        kind: 'synthetic_line',
                        source: 'ocr_heuristic_v1',
                        confidence: 0.75,
                        line_no: originalLineNo,
                        evidence: titlePart,
                        snippet: titlePart,
                        context_before: lines.slice(Math.max(0, i - 1), i).join('\n'),
                        context_after: itemPart,
                        extracted_signals: {
                            description_fragment: titlePart
                        },
                        raw_numbers: [],
                        warnings: ['section_title_candidate', 'embedded_title'],
                        debug_heuristic: ['ST_EMBEDDED_TITLE']
                    });

                    // Candidato 2: o item que estava colado
                    candidates.push({
                        id: generateShortId(),
                        kind: 'synthetic_line',
                        source: 'ocr_heuristic_v1',
                        confidence: 0.65,
                        line_no: originalLineNo,
                        evidence: itemPart,
                        snippet: itemPart,
                        context_before: titlePart,
                        context_after: lines.slice(i + 1, Math.min(limit, i + 3)).join('\n'),
                        extracted_signals: {
                            description_fragment: itemPart
                        },
                        raw_numbers: extractNumbers(itemPart).map(v => ({ value: v, text: String(v), lineNo: originalLineNo })),
                        warnings: [],
                        debug_heuristic: ['ST_EMBEDDED_ITEM']
                    });
                    continue;
                }
            }

            // P4: Item_path isolado seguido de código/descrição na próxima linha
            const REGEX_ISO_PATH = /^\s*(\d{1,3}(?:\.\d{1,3}){1,6})\s*$/;
            if (REGEX_ISO_PATH.test(line)) {
                let nextIdx = i + 1;
                while (nextIdx < limit && lines[nextIdx].trim() === '') nextIdx++;
                if (nextIdx < limit) {
                    const nextLine = lines[nextIdx].replace(/\r/g, '').trim();
                    const REGEX_CODE_PREFIX_PEEK = /^(\d{4,10}|CPU\d{3,10}|[A-Z]{2,5}\d{3,10})\s*(SINAPI|ORSE|Próprio|SBC|IOPES|EMOP|SETOP|SEINFRA|AGETOP|AGESUL|CPOS)?/i;
                    if (REGEX_CODE_PREFIX_PEEK.test(nextLine)) {
                        line = line.trim() + ' ' + nextLine;
                        for (let k = i + 1; k <= nextIdx; k++) consumedLines.add(k);
                    }
                }
            }

            // S1: Item Path
            const matchPath = line.match(REGEX_ITEM_PATH);
            if (matchPath) {
                hitS1 = true;
                stats.synthetic_heads_found++;
                stats.heuristics_hit['S1'] = (stats.heuristics_hit['S1'] || 0) + 1;

                let extracted_code: string | undefined = undefined;
                let extracted_description = matchPath[2];

                // Separa código colado no início do texto: "90776SINAPI..." ou "CPU2527Próprio..."
                const REGEX_CODE_PREFIX = /^(\d{4,10}|CPU\d{3,10}|[A-Z]{2,5}\d{3,10})\s*(SINAPI|ORSE|Próprio|SBC|IOPES|EMOP|SETOP|SEINFRA|AGETOP|AGESUL|CPOS)?\s*(.+)$/;
                const textoPart = matchPath[2]; // texto após o item_path
                const codeMatch = textoPart.match(REGEX_CODE_PREFIX);
                if (codeMatch) {
                    // código estava colado ao item_path
                    extracted_code = codeMatch[1];
                    extracted_description = codeMatch[3];
                }

                // Detectar valores numéricos colados no final da descrição (mín. 4 tokens = qty + price + total + weight)
                const REGEX_TRAILING_NUMBERS = /^(.{15,}?)\s{1,3}(\d{1,3}(?:[.,]\d{1,3})*(?:\s+\d{1,3}(?:[.,]\d{1,4})*){3,}(?:\s*%?))\s*$/;
                const trailingMatch = extracted_description.match(REGEX_TRAILING_NUMBERS);
                if (trailingMatch) {
                    extracted_description = trailingMatch[1].trim();
                }

                // B2: Smart context_after — stop at the next item boundary
                const REGEX_CODE_PREFIX_B2 = /^(\d{4,10}|CPU\d{3,10}|[A-Z]{2,5}\d{3,10})\s*(SINAPI|ORSE|Próprio|SBC|IOPES|EMOP|SETOP|SEINFRA|AGETOP|AGESUL|CPOS)/;
                const _contextAfterLines: string[] = [];
                for (let _j = i + 1; _j < Math.min(limit, i + 6); _j++) {
                    const _nextLine = lines[_j].replace(/\r/g, '').trim();
                    // Skip boundary check for the first line (i+1): it may be the code/description of the current item
                    if (_j > i + 1 && (REGEX_ITEM_PATH.test(_nextLine) || REGEX_CODE_PREFIX_B2.test(_nextLine))) break;
                    _contextAfterLines.push(lines[_j]);
                }
                const _contextAfter = (trailingMatch ? trailingMatch[2] + '\n' : '') + _contextAfterLines.join('\n');

                const cand: StageACandidate = {
                    id: generateShortId(),
                    kind: 'synthetic_line',
                    source: 'ocr_heuristic_v1',
                    confidence: 0.65,
                    line_no: originalLineNo,
                    evidence: line,
                    snippet: line,
                    context_before: lines.slice(Math.max(0, i - 2), i).join('\n'),
                    context_after: _contextAfter,
                    extracted_signals: {
                        item_path: matchPath[1],
                        code: extracted_code,
                        description_fragment: extracted_description
                    },
                    raw_numbers: extractNumbers(line).map(v => ({ value: v, text: String(v), lineNo: originalLineNo })),
                    warnings: [],
                    debug_heuristic: ['S1_item_path']
                };
                if (cand.extracted_signals && cand.extracted_signals.item_path) {
                    cand.extracted_signals.item_path = deduplicatePath(cand.extracted_signals.item_path);
                }

                // FILTER S1: rejeita fragmentos de descrição multiline que chegaram como falsos candidatos
                // Critérios: tem item_path, sem código, e description é claramente um fragmento de continuação
                const _s1desc = (cand.extracted_signals?.description_fragment || '').trim();
                const _s1snippet = (cand.snippet || '').trim();
                const _s1hasCode =
                    !!cand.extracted_signals?.code ||
                    /\d{4,6}(?:SINAPI|ORSE|SBC|IOPES|EMOP|SEAP)/i.test(_s1snippet) ||
                    /CPU\d{3,10}/i.test(_s1snippet) ||
                    /(?:SINAPI|ORSE|SBC|IOPES|EMOP|SEAP)\s*\d{4,6}/i.test(_s1snippet);
                const _s1hasNumbers = /\d/.test(_s1desc);
                const REGEX_N2_PREFIX = /^\d+\.\d+\s/;
                const _s1isFragment =
                    !_s1hasCode &&
                    (
                        // a) termina com sufixo de norma SINAPI: AF_06/2022
                        /AF_\d{2}\/\d{4}\s*$/.test(_s1desc) ||
                        // b) começa com palavra de continuação típica de descrição partida
                        /^(MONTAGEM|INSTALAÇÃO|FORNECIMENTO|RESINADA|DESMONTAGEM|ASSENTAMENTO|APLICAÇÃO|EXECUÇÃO|LANÇAMENTO|ADENSAMENTO|ACABAMENTO|INCLUSIVE|INCLUINDO)\b/i.test(_s1desc) ||
                        // c) fragmento muito curto (< 15 chars) sem nenhum número, EXCETO se for título com prefixo N2 numérico
                        (_s1desc.length < 15 && !_s1hasNumbers && !REGEX_N2_PREFIX.test(_s1snippet))
                    );
                if (_s1isFragment) {
                    if (DEBUG_P1) console.log('[S1-FRAGMENT-SKIP]', JSON.stringify({ desc: _s1desc.substring(0, 60), item_path: cand.extracted_signals?.item_path }));
                    continue; // descarta — não adicionar ao array de candidatos
                }

                // P3: Nomes genéricos de seções (recuperados de S1)
                const REGEX_ST_NUMERIC = /^(\d{1,2}(?:\.\d{1,2}){0,2})\s+([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÇ ]{4,})$/;
                if (REGEX_SECTION_TITLE.test(line) || REGEX_ST_NUMERIC.test(line)) {
                    if (!_s1hasCode && !_s1hasNumbers) {
                        (cand as any).kind = 'section_title';
                        cand.extracted_signals!.description_fragment = _s1desc;
                        cand.warnings.push('section_title_candidate');
                        cand.debug_heuristic = ['S_TITLE_FROM_S1'];
                    }
                }

                // C1: Rejeita fragmento de continuação sem item_path próprio
                // Cobre tanto extracted_code (código extraído da linha) quanto código herdado via S3
                const _c1Code = extracted_code ?? (cand.extracted_signals?.code as string | undefined);
                if (_c1Code) {
                    const _rawLineStart = line.trim();
                    const _lineHasOwnPath = REGEX_ITEM_PATH.test(_rawLineStart);
                    const _codeAlreadySeen = candidates.some(
                        c => c.extracted_signals?.code === _c1Code
                    );
                    if (!_lineHasOwnPath && _codeAlreadySeen) {
                        console.warn('[StageA] Rejecting continuation fragment: code=' + _c1Code + ', inherited path=' + (cand.extracted_signals?.item_path ?? 'null'));
                        continue;
                    }
                }

                candidates.push(cand);

                continue; // Winner takes line
            }

            // DIAGNÓSTICO TEMPORÁRIO — remover após debug
            if (/^\s*\d{1,3}[A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÇ]/.test(line) && line.length < 120) {
                console.log('[SECTION_DEBUG]', JSON.stringify({
                    line: line,
                    length: line.length,
                    regexTest: REGEX_SECTION_TITLE.test(line),
                    matchResult: line.match(REGEX_SECTION_TITLE),
                    charCodes: [...line.slice(0, 5)].map(c => c.charCodeAt(0))
                }));
            }



            // 2. Só depois filtra como "section total" (linha que não é título)
            if (REGEX_SECTION_TOTAL.test(line)) {
                if (DEBUG_P1) console.log('[P1-TOTAL-SKIP]', JSON.stringify({ line: line.substring(0, 80) }));
                continue;
            }
            if (STOP_WORDS_RE.test(line.trim())) {
                if (DEBUG_P1) console.log('[P1-STOPWORD-SKIP]', JSON.stringify({ line: line.substring(0, 80) }));
                continue;
            }

            // ST: Section Title — prefixo numérico/alfabético/romano sem código nem valores
            // Exemplos: "3 PAVIMENTAÇÃO", "1.4 DRENAGEM", "A - SERVIÇOS INICIAIS", "II - FUNDAÇÕES"
            // Nota: captura títulos independentemente de hitS1 (uma linha pode ser título E item simultâneo)
            {
                const REGEX_ST_NUMERIC = /^(\d{1,2}(?:\.\d{1,2}){0,2})\s+([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÁÉÍÓÚÀÃÕÂÊÎÔÛÇ ]{4,})$/;
                const REGEX_ST_ALPHA = /^([A-Z]{1,3})\s*[-–]\s*([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÇ ]{4,})$/;
                const REGEX_ST_ROMAN = /^(I{1,3}V?|VI{0,3}|IX|IV|X)\s*[-–]\s*([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÇ ]{4,})$/;
                const matchTitle =
                    line.match(REGEX_ST_NUMERIC) ||
                    line.match(REGEX_ST_ALPHA) ||
                    line.match(REGEX_ST_ROMAN);

                if (matchTitle) {
                    stats.heuristics_hit['ST_section_title'] = (stats.heuristics_hit['ST_section_title'] || 0) + 1;
                    const prefix = matchTitle[1];
                    const titleText = matchTitle[2].trim();
                    const derivedPath = /^\d/.test(prefix) ? prefix : undefined;

                    const ST_BLOCKLIST = [
                        'PLANILHA', 'ORÇAMENTÁRIA', 'LOCALIDADE', 'MUNICÍPIO',
                        'DATA BASE', 'GRAU DE SIGILO', 'PROPOSTA', 'CONTRATO',
                        'RECURSO', 'OPERAÇÃO', 'TOMADOR', 'PROPONENTE'
                    ];
                    const titleUpper = titleText.toUpperCase();
                    const isBlocklisted = ST_BLOCKLIST.some(term => titleUpper.includes(term));
                    if (!isBlocklisted) {
                        candidates.push({
                            id: generateShortId(),
                            kind: 'synthetic_line',
                            source: 'ocr_heuristic_v1',
                            confidence: 0.70,
                            line_no: originalLineNo,
                            evidence: line,
                            snippet: line,
                            context_before: lines.slice(Math.max(0, i - 1), i).join('\n'),
                            context_after: lines.slice(i + 1, Math.min(limit, i + 2)).join('\n'),
                            extracted_signals: {
                                item_path: derivedPath,
                                description_fragment: titleText
                            },
                            evidence_lines: [{ text: line }],
                            raw_numbers: [],
                            warnings: ['section_title_candidate'],
                            debug_heuristic: ['ST_section_title']
                        });
                        // Se hitS1 já foi marcado, NÃO damos continue — o item já foi emitido pelo S1
                        if (!hitS1) continue;
                    } else if (!hitS1) {
                        continue; // descartar blocklisted apenas se não houver S1
                    }
                }
            }

            // S2: Code + Desc
            const matchCode = line.match(REGEX_CODE_START);
            if (matchCode && !hitS1) {
                hitS2 = true;
                stats.synthetic_heads_found++;
                stats.heuristics_hit['S2'] = (stats.heuristics_hit['S2'] || 0) + 1;

                const cand: StageACandidate = {
                    id: generateShortId(),
                    kind: 'synthetic_line',
                    source: 'ocr_heuristic_v1',
                    confidence: 0.55,
                    line_no: originalLineNo,
                    evidence: line,
                    snippet: line,
                    context_before: lines.slice(Math.max(0, i - 2), i).join('\n'),
                    context_after: lines.slice(i + 1, Math.min(limit, i + 3)).join('\n'),
                    extracted_signals: {
                        code: matchCode[1],
                        description_fragment: matchCode[2],
                        item_path: lastSectionPath
                    },
                    raw_numbers: extractNumbers(line).map(v => ({ value: v, text: String(v), lineNo: originalLineNo })),
                    warnings: [],
                    debug_heuristic: ['S2_code_start']
                };
                candidates.push(cand);
                continue;
            }

            // S3: Neighborhood (Look ahead for UN/Qty if current line looks like desc)
            // Implementation detail: Use this to boost S1/S2 or create new candidate?
            // "Heurística S3 — Unidade + quantidade (zip heurístico por vizinhança)"
            // Let's treat this as: if line has NO strong signal, but MIGHT be a description, peek ahead.
            // Simplified: If line has text > 10 chars, check i+1, i+2, i+3 for Unit+Number.
            if (!hitS1 && !hitS2 && line.length > 20) {
                // DESCRIPTION CONTINUATION MERGE
                // Concatenate following lines that are description fragments
                // (no item path, no bank code, no isolated unit, no pure number line)
                let mergedDescription = line;
                let mergeOffset = 0;

                let foundHeaderS3 = false;
                for (let m = 1; m <= 3; m++) {
                    if (i + m >= limit) break;
                    const nextL = lines[i + m].trim();
                    if (nextL.length < 5) break; // empty or near-empty line = separator
                    if (REGEX_BANKS_HEADER.test(nextL)) { foundHeaderS3 = true; break; }

                    const isNewItem = REGEX_ITEM_PATH.test(nextL) || REGEX_CODE_START.test(nextL);
                    const isIsolatedUnit = REGEX_UNIT.test(nextL) && nextL.length < 15;
                    const isPureNumber = /^\s*[\d.,\s%]+\s*$/.test(nextL);

                    if (isNewItem || isIsolatedUnit || isPureNumber) break;

                    // Line looks like a description continuation
                    mergedDescription += ' ' + nextL;
                    mergeOffset = m;
                }

                if (foundHeaderS3) continue;

                // Scan window W=4 from end of merged description
                let foundUnit = false;
                let foundNum = false;
                const lookaheadEvidence: string[] = [];
                const scanStart = i + mergeOffset + 1;

                for (let w = 0; w <= 3; w++) {
                    if (scanStart + w >= limit) break;
                    const nextL = lines[scanStart + w].trim();
                    // S3-GUARD: não consumir linha que é título de seção N1
                    if (REGEX_IS_SECTION_TITLE.test(nextL) || REGEX_SECTION_TITLE.test(nextL)) break;
                    if (REGEX_UNIT.test(nextL)) foundUnit = true;
                    if (extractNumbers(nextL).length > 0) foundNum = true;
                    if (foundUnit || foundNum) lookaheadEvidence.push(nextL);
                }

                if (foundUnit && foundNum) {
                    hitS3 = true;
                    stats.synthetic_heads_found++;
                    stats.heuristics_hit['S3'] = (stats.heuristics_hit['S3'] || 0) + 1;

                    candidates.push({
                        id: generateShortId(),
                        kind: 'synthetic_line',
                        source: 'ocr_heuristic_v1',
                        confidence: 0.55,
                        line_no: originalLineNo,
                        evidence: mergedDescription + " || " + lookaheadEvidence.join(" || "),
                        snippet: mergedDescription,  // full merged description
                        context_before: lines.slice(Math.max(0, i - 2), i).join('\n'),
                        context_after: lines.slice(scanStart, Math.min(limit, scanStart + 3)).join('\n'),
                        extracted_signals: {
                            description_fragment: mergedDescription.substring(0, 400),
                            item_path: lastSectionPath
                        },
                        raw_numbers: [],
                        warnings: mergeOffset > 0 ? ['description_merge', 'neighborhood_inference'] : ['neighborhood_inference'],
                        debug_heuristic: mergeOffset > 0 ? ['S3_merge', 'S3_neighborhood'] : ['S3_neighborhood']
                    });

                    // Skip merged lines to avoid duplicate candidates
                    i += mergeOffset;
                    continue;
                }
            }

            // S4: Fallback Synthetic
            // Line with > 10 letters and > 1 number
            const nums = extractNumbers(line);
            const letters = line.replace(/[^a-zA-Z]/g, '').length;

            // GUARD: Skip S4 for orphan continuation fragments.
            // If the previous line was already consumed (S0/S1/S2/S3) and this line
            // has no item_path and no code, it's likely a broken description fragment.
            const prevConsumed = i > 0 && (consumedLines.has(i - 1) ||
                candidates.some(c => c.line_no === mapOriginalLineNo[i - 1]));
            const hasOwnAnchor = REGEX_ITEM_PATH.test(line) || REGEX_CODE_START.test(line);

            if (!hitS1 && !hitS2 && !hitS3 && nums.length > 0 && letters > 10 && !(prevConsumed && !hasOwnAnchor)) {
                hitS4 = true;
                stats.heuristics_hit['S4'] = (stats.heuristics_hit['S4'] || 0) + 1;

                candidates.push({
                    id: generateShortId(),
                    kind: 'synthetic_line',
                    source: 'ocr_heuristic_v1',
                    confidence: 0.35,
                    line_no: originalLineNo,
                    evidence: line,
                    snippet: line,
                    context_before: lines.slice(Math.max(0, i - 2), i).join('\n'),
                    context_after: lines.slice(i + 1, Math.min(limit, i + 3)).join('\n'),
                    extracted_signals: {
                        description_fragment: line.substring(0, 400) + "...",
                        item_path: lastSectionPath
                    },
                    raw_numbers: nums.map(v => ({ value: v, text: String(v), lineNo: originalLineNo })),
                    warnings: ['fallback_line_candidate'],
                    debug_heuristic: ['S4_fallback']
                });
            }
        }

        // --- POST-SYNTHETIC MERGE PASS ---
        // Se dois candidatos consecutivos têm o mesmo composition_code, 
        // mescla a descrição do segundo no primeiro e descarta o segundo.
        for (let m = 0; m < candidates.length - 1; m++) {
            const curr = candidates[m];
            const nxt = candidates[m + 1];

            const codeC = curr.extracted_signals?.code;
            const codeN = nxt.extracted_signals?.code;

            if (codeC && codeN && codeC === codeN) {
                // Merge nxt into curr
                curr.snippet += " " + nxt.snippet;
                curr.evidence += " || " + nxt.evidence;
                if (nxt.extracted_signals?.description_fragment) {
                    if (!curr.extracted_signals) curr.extracted_signals = {};
                    curr.extracted_signals.description_fragment = (curr.extracted_signals.description_fragment || "") + " " + nxt.extracted_signals.description_fragment;
                }
                if (curr.line_range && nxt.line_range) {
                    curr.line_range[1] = Math.max(curr.line_range[1], nxt.line_range[1]);
                }
                candidates.splice(m + 1, 1);
                m--; // Re-checar o item atual com o novo sucessor
            }
        }

        // --- SYNTHETIC GROUP GENERATION (P-NOM) ---
        // Generate synthetic group candidates ONLY for N1 keys that have NO direct
        // section_title candidate AND whose children all have composition_code set.
        // This avoids creating ghost groups for real item groups like 15.1, 15.2, etc.

        const _existingTitlePaths = new Set(
            candidates
                .filter(c => !c.extracted_signals?.code && c.extracted_signals?.item_path)
                .map(c => c.extracted_signals!.item_path as string)
        );

        // Collect only N1 keys (single segment like "2", "3", "16")
        const _allN1Keys = new Set<string>();
        for (const c of candidates) {
            const p = c.extracted_signals?.item_path;
            if (!p) continue;
            const parts = p.split('.');
            if (parts.length >= 2) _allN1Keys.add(parts[0]);
        }

        const _syntheticGroups: StageACandidate[] = [];
        for (const key of _allN1Keys) {
            // Skip if already has a section_title candidate for this N1 key
            if (_existingTitlePaths.has(key)) continue;

            // Skip if any direct child at N2 level (key.X) has NO composition_code
            // — meaning it's already a real group title, not a missing title
            const _n2Children = candidates.filter(c => {
                const p = c.extracted_signals?.item_path || '';
                const parts = p.split('.');
                return parts.length === 2 && parts[0] === key && !c.extracted_signals?.code;
            });
            if (_n2Children.length > 0) continue;

            // Only generate synthetic group if ALL item children have composition_code
            const _itemChildren = candidates.filter(c => {
                const p = c.extracted_signals?.item_path || '';
                return p.startsWith(key + '.') && !!c.extracted_signals?.code;
            });
            if (_itemChildren.length === 0) continue;

            const _childDescs = _itemChildren
                .slice(0, 5)
                .map(c => {
                    const desc = (c.extracted_signals?.description_fragment as string | undefined)
                        ?? c.snippet
                        ?? '';
                    // Strip item_path prefix and code prefix from snippet if description unavailable
                    return desc.replace(/^\s*\d+(\.\d+)*\s+/, '').replace(/^[A-Z0-9]{3,10}\s*(SINAPI|ORSE|Próprio|SBC|IOPES|EMOP)?\s*/i, '').trim();
                })
                .filter(t => t.length > 10);

            _syntheticGroups.push({
                id: generateShortId(),
                kind: 'section_title' as any,
                source: 'ocr_heuristic_v1',
                confidence: 0.7,
                evidence: `SYNTHETIC_GROUP ${key}`,
                snippet: `SYNTHETIC_GROUP ${key}`,
                context_before: '',
                context_after: _childDescs.join('\n'),
                extracted_signals: {
                    item_path: key,
                    code: undefined
                },
                raw_numbers: [],
                warnings: ['section_title_candidate', 'synthetic_group_inferred'],
                debug_heuristic: ['ST_SYNTHETIC_GROUP']
            });
        }

        candidates.unshift(..._syntheticGroups);
    }

    // --- ANALYTIC SCAN LOOP (Blocks) ---
    // Separate pass to find blocks. Can overlap with lines.
    if (runAnalytic) {
        let inBlock = false;
        let blockStartLine = 0;
        let blockLines: string[] = [];
        const A_HEADER_REGEX = /(composi|descri|und|quant|valor|total)/i;
        const A_COMP_REGEX = /\bcomposi(ç|c)ão\s*:?\s*(\d{4,10}|[A-Z]{2,5}\d{3,10})/i;

        for (let i = 0; i < limit; i++) {
            if (candidates.length >= (caps.max_candidates + 100)) break; // Soft limit
            const line = lines[i];
            const originalLineNo = mapOriginalLineNo[i];

            // A2: Explicit Composition Start
            const matchA2 = line.match(A_COMP_REGEX);
            if (matchA2) {
                // Close previous if open
                if (inBlock) {
                    finalizeBlock(candidates, blockStartLine, blockLines, 'A2_composition_explicit', stats);
                }
                // Start new
                inBlock = true;
                blockStartLine = originalLineNo;
                blockLines = [line];
                stats.heuristics_hit['A2'] = (stats.heuristics_hit['A2'] || 0) + 1;
                continue;
            }

            // A1: Header Detection (Weak start)
            // simplified: count tokens
            const tokens = line.toLowerCase().match(new RegExp(A_HEADER_REGEX, 'g'));
            if (tokens && tokens.length >= 2 && !inBlock) {
                inBlock = true;
                blockStartLine = originalLineNo;
                blockLines = [line];
                stats.heuristics_hit['A1'] = (stats.heuristics_hit['A1'] || 0) + 1;
                continue;
            }

            if (inBlock) {
                blockLines.push(line);
                // Stop conditions
                if (blockLines.length > 80) { // Max lines per block
                    finalizeBlock(candidates, blockStartLine, blockLines, 'A_limit_reached', stats);
                    inBlock = false;
                    blockLines = [];
                }
                // Detect End keywords
                if (/(subtotal|encargos|bdi| total|resumo)/i.test(line) && blockLines.length > 5) {
                    finalizeBlock(candidates, blockStartLine, blockLines, 'A_end_keyword', stats);
                    inBlock = false;
                    blockLines = [];
                }
            }
        }
        // Finalize last
        if (inBlock) finalizeBlock(candidates, blockStartLine, blockLines, 'A_EOF', stats);
    }

    // --- FINAL CHECK: Zero Item Prevention ---
    if (candidates.length === 0 && lines.length > 5 && text.length > 1000) {
        // Fallback A3/S4 extreme: just grab chunk of lines
        warnings.push("zero_candidates_fallback_triggered");
        const fallbackSnippet = text.substring(0, 1000);
        candidates.push({
            id: generateShortId(),
            kind: 'synthetic_line', // mask as line to force processing
            source: 'ocr_heuristic_v1',
            confidence: 0.1,
            evidence: fallbackSnippet, // First 1k chars
            snippet: fallbackSnippet,
            context_before: '',
            context_after: '',
            extracted_signals: { description_fragment: "FALLBACK DUMP" },
            raw_numbers: [],
            warnings: ['emergency_fallback_zero_candidates'],
            debug_heuristic: ['S_Zero_Prevention']
        });
    }

    stats.candidates_found = candidates.length;
    stats.blocks_found = candidates.filter(c => c.kind === 'analytic_block').length;

    // LOG TEMPORÁRIO
    const sTitleCandidates = candidates.filter(c => c.warnings?.includes('section_title_candidate'));
    console.log('[STAGE-A-STITLE]', JSON.stringify({
        total: candidates.length,
        s_title_count: sTitleCandidates.length,
        s_titles: sTitleCandidates.map(c => ({
            id: c.id,
            warnings: c.warnings,
            item_path: c.extracted_signals?.item_path,
            desc: c.extracted_signals?.description_fragment
        }))
    }));

    return {
        version: "v1",
        generated_at: new Date().toISOString(),
        doc_type_hints: docHints,
        caps: caps as StageACaps,
        stats: stats,
        candidates: candidates,
        warnings: warnings
    };
}

function finalizeBlock(list: StageACandidate[], startLine: number, lines: string[], reason: string, stats: StageAStats) {
    if (lines.length < 3) return; // Too short
    stats.blocks_found++;
    list.push({
        id: generateShortId(),
        kind: 'analytic_block',
        source: 'ocr_heuristic_v1',
        confidence: 0.75,
        line_no: startLine,
        line_range: [startLine, startLine + lines.length],
        evidence: lines.join('\n').substring(0, 1200),
        snippet: lines.join('\n').substring(0, 1200),
        context_before: '', // Blocks generally self-contained or would need access to global lines here
        context_after: '',
        extracted_signals: {},
        raw_numbers: [],
        warnings: [],
        debug_heuristic: [reason]
    });
}
