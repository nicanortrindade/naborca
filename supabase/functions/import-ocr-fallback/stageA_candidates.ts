
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
    max_lines_scanned: 2500,
    max_candidates: 300,
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
const REGEX_ITEM_PATH = /^\s*(\d{1,3}(\.\d{1,3}){1,6})\s+(.{5,})$/; // "1.2.3 Description"
const REGEX_CODE_START = /^(\d{5,10}|[A-Z]{2,5}\d{3,10})\s+(.{5,})$/; // "94321 Description" or "CPU123 Desc"
const REGEX_UNIT = /\b(UN|und|m²|m2|m³|m3|kg|h|vb|m)\b/i;
const REGEX_MONEY_OR_QTY = /\b\d{1,3}(?:\.\d{3})*(?:,\d{1,4})?\b|\b\d{1,6}(?:\.\d{1,4})?\b/g; // 1.234,56 or 1234.56
// Guard: detecta linhas que são títulos de seção e NÃO devem ser consumidas pelo S0
const REGEX_IS_SECTION_TITLE = /^(\d{1,2}(?:\.\d{1,2}){0,2})\s+([AÀÁÂÃBCDEÉÊFGHIÍJKLMNOÓÔÕPQRSTUÚVWXYZ][A-ZÀÁÂÃÉÊÍÓÔÕÚÇ ]{4,})$|^([A-Z]{1,3})\s*[-–]\s*([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÇ ]{4,})$/;

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
        const REGEX_ISOLATED_CODE = /^(\d{1,3}(?:\.\d{1,3}){1,6})\.(SINAPI|ORSE|SICRO3?|CPU|Próprio|PROP)(\w+(?:[-_]\w*)?)?\s*$/i;
        const consumedLines = new Set<number>();

        for (let si = 0; si < limit - 2; si++) {
            if (candidates.length >= caps.max_candidates) break;
            const sLine = lines[si].trim();
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
            for (; j < Math.min(si + 5, limit); j++) {
                const nxt = lines[j].trim();
                if (!nxt || nxt.length < 3) break;
                if (REGEX_ITEM_PATH.test(nxt) || REGEX_CODE_START.test(nxt)) break;
                if (/^\s*[\d.,\s%]+\s*$/.test(nxt)) break;
                if (REGEX_UNIT.test(nxt) && nxt.length < 15) break;
                // Não consumir linhas que são títulos de seção
                if (REGEX_IS_SECTION_TITLE.test(nxt)) break;
                descFragments.push(nxt);
            }
            if (descFragments.length === 0) continue;

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
                    description_fragment: descFragments.join(' ').substring(0, 120)
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

        for (let i = 0; i < limit; i++) {
            if (candidates.length >= caps.max_candidates) break;

            const line = lines[i];
            const originalLineNo = mapOriginalLineNo[i];

            // Skip garbage
            if (line.length < 5) continue;
            if (/^(pag|pág|data|hora|emitido)/i.test(line)) continue;
            if (/^[_\-=.]{3,}$/.test(line)) continue;

            // Resolve a seção ativa usando o mapa pré-calculado
            const lastSectionPath = resolveNearestSection(i);

            // Pular linhas já consumidas pelo S0_multiline_merge
            if (consumedLines.has(i)) continue;

            let hitS1 = false;
            let hitS2 = false;
            let hitS3 = false;
            let hitS4 = false;

            // S1: Item Path
            const matchPath = line.match(REGEX_ITEM_PATH);
            if (matchPath) {
                hitS1 = true;
                stats.synthetic_heads_found++;
                stats.heuristics_hit['S1'] = (stats.heuristics_hit['S1'] || 0) + 1;

                const cand: StageACandidate = {
                    id: generateShortId(),
                    kind: 'synthetic_line',
                    source: 'ocr_heuristic_v1',
                    confidence: 0.65,
                    line_no: originalLineNo,
                    evidence: line,
                    snippet: line,
                    context_before: lines.slice(Math.max(0, i - 2), i).join('\n'),
                    context_after: lines.slice(i + 1, Math.min(limit, i + 3)).join('\n'),
                    extracted_signals: {
                        item_path: matchPath[1],
                        description_fragment: matchPath[3]
                    },
                    raw_numbers: extractNumbers(line).map(v => ({ value: v, text: String(v), lineNo: originalLineNo })),
                    warnings: [],
                    debug_heuristic: ['S1_item_path']
                };
                candidates.push(cand);
                continue; // Winner takes line
            }

            // ST: Section Title — prefixo numérico/alfabético/romano sem código nem valores
            // Exemplos: "3 PAVIMENTAÇÃO", "1.4 DRENAGEM", "A - SERVIÇOS INICIAIS", "II - FUNDAÇÕES"
            if (!hitS1) {
                const REGEX_ST_NUMERIC = /^(\d{1,2}(?:\.\d{1,2}){0,2})\s+([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÇ ]{4,})$/;
                const REGEX_ST_ALPHA = /^([A-Z]{1,3})\s*[-–]\s*([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÇ ]{4,})$/;
                const REGEX_ST_ROMAN = /^(I{1,3}V?|VI{0,3}|IX|IV|X)\s*[-–]\s*([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ][A-ZÀÁÂÃÉÊÍÓÔÕÚÇ ]{4,})$/;
                const matchTitle =
                    line.match(REGEX_ST_NUMERIC) ||
                    line.match(REGEX_ST_ALPHA) ||
                    line.match(REGEX_ST_ROMAN);

                if (matchTitle && extractNumbers(line).length === 0) {
                    stats.heuristics_hit['ST_section_title'] = (stats.heuristics_hit['ST_section_title'] || 0) + 1;
                    const prefix = matchTitle[1];
                    const titleText = matchTitle[2].trim();
                    const derivedPath = /^\d/.test(prefix) ? prefix : undefined;

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
                    continue;
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

                for (let m = 1; m <= 3; m++) {
                    if (i + m >= limit) break;
                    const nextL = lines[i + m].trim();
                    if (nextL.length < 5) break; // empty or near-empty line = separator

                    const isNewItem = REGEX_ITEM_PATH.test(nextL) || REGEX_CODE_START.test(nextL);
                    const isIsolatedUnit = REGEX_UNIT.test(nextL) && nextL.length < 15;
                    const isPureNumber = /^\s*[\d.,\s%]+\s*$/.test(nextL);

                    if (isNewItem || isIsolatedUnit || isPureNumber) break;

                    // Line looks like a description continuation
                    mergedDescription += ' ' + nextL;
                    mergeOffset = m;
                }

                // Scan window W=4 from end of merged description
                let foundUnit = false;
                let foundNum = false;
                const lookaheadEvidence: string[] = [];
                const scanStart = i + mergeOffset + 1;

                for (let w = 0; w <= 3; w++) {
                    if (scanStart + w >= limit) break;
                    const nextL = lines[scanStart + w];
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
                            description_fragment: mergedDescription.substring(0, 100),
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
            if (!hitS1 && !hitS2 && !hitS3 && nums.length > 0 && letters > 10) {
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
                        description_fragment: line.substring(0, 50) + "...",
                        item_path: lastSectionPath
                    },
                    raw_numbers: nums.map(v => ({ value: v, text: String(v), lineNo: originalLineNo })),
                    warnings: ['fallback_line_candidate'],
                    debug_heuristic: ['S4_fallback']
                });
            }
        }
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
