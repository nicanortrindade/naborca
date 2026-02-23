export interface AnalyzedComposition {
    code: string;
    description: string;
    unit: string;
    items: Array<{
        code: string;
        description: string;
        type: 'insumo' | 'composition';
        unit: string;
        coefficient: number;
        price: number;
    }>;
}

/**
 * Known engineering units (longest-first for regex alternation).
 */
const KNOWN_UNITS = [
    'MÊS', 'M2', 'M3', 'ML', 'KG', 'KM', 'UN', 'VB', 'CJ', 'SC', 'HA',
    'M²', 'M³', 'CH', 'CI', 'HP', 'TB', 'PR', 'GL', 'DM', 'JG',
    'H', 'L', 'M', 'T',
] as const;

const UNITS_ALT = KNOWN_UNITS.join('|');

/** Known source/bank keywords */
const BANKS = 'SINAPI|ORSE|SICRO3?|CPU|Próprio|PROP|EMOP|KENE|SBC|SETOP|CDHU|CPOS(?:\\/CDHU)?|COMP';

/** Parse Brazilian-format number: "1.234,56" → 1234.56, "1,3200" → 1.32 */
function parseNum(s: string | undefined): number {
    if (!s) return 0;
    const cleaned = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
}

/**
 * Split glued OCR numbers into coefficient, price, and optional total.
 * 
 * In OCR-extracted engineering documents, numbers are concatenated without separators:
 *   "1,320000024,3732,17" → coef=1.3200000, price=24.37, total=32.17
 * 
 * Key insight: price/total always have 2 decimal digits. 
 * Coefficient has many (typically 7) decimal digits.
 * The first comma belongs to the coefficient. We use heuristic scoring
 * (prefer 7-digit coef decimals) to determine where the coefficient ends
 * and the price integer begins.
 */
function splitGluedNumbers(s: string): { coef: number; price: number } | null {
    const commaPositions: number[] = [];
    for (let i = 0; i < s.length; i++) {
        if (s[i] === ',') commaPositions.push(i);
    }

    if (commaPositions.length < 2) {
        if (commaPositions.length === 1) return { coef: 1, price: parseNum(s) };
        return null;
    }

    if (commaPositions.length === 3) {
        // 3 commas = coef + price + total
        const coefInt = s.substring(0, commaPositions[0]);
        const seg1 = s.substring(commaPositions[0] + 1, commaPositions[1]); // coef_dec + price_int
        const seg2 = s.substring(commaPositions[1] + 1, commaPositions[2]); // price_dec + total_int

        const priceDec = seg2.substring(0, 2);

        // Determine price_int length by trying splits and scoring by coef_dec ≈ 7
        let bestCoefDec = '', bestPriceInt = '';
        let bestScore = Infinity;
        for (const piLen of [1, 2, 3, 4]) {
            if (piLen > seg1.length) continue;
            const priceInt = seg1.substring(seg1.length - piLen);
            const coefDec = seg1.substring(0, seg1.length - piLen);
            if (coefDec.length < 3) continue;
            const score = Math.abs(coefDec.length - 7);
            if (score < bestScore) {
                bestScore = score;
                bestCoefDec = coefDec;
                bestPriceInt = priceInt;
            }
        }

        const coef = parseNum(coefInt + ',' + bestCoefDec);
        const price = parseNum(bestPriceInt + ',' + priceDec);
        return { coef, price };
    } else if (commaPositions.length === 2) {
        // 2 commas = coef + price (no total)
        const coefInt = s.substring(0, commaPositions[0]);
        const seg1 = s.substring(commaPositions[0] + 1, commaPositions[1]);
        const seg2 = s.substring(commaPositions[1] + 1);

        let bestCoefDec = '', bestPriceInt = '';
        let bestScore = Infinity;
        for (const piLen of [1, 2, 3, 4]) {
            if (piLen > seg1.length) continue;
            const priceInt = seg1.substring(seg1.length - piLen);
            const coefDec = seg1.substring(0, seg1.length - piLen);
            if (coefDec.length < 3) continue;
            const score = Math.abs(coefDec.length - 7);
            if (score < bestScore) {
                bestScore = score;
                bestCoefDec = coefDec;
                bestPriceInt = priceInt;
            }
        }

        if (!bestCoefDec) return null;
        const coef = parseNum(coefInt + ',' + bestCoefDec);
        const price = parseNum(bestPriceInt + ',' + seg2);
        return { coef, price };
    }

    return null;
}

export class AnalyticReportParser {
    /**
     * Extrai composições de texto bruto OCR de relatórios analíticos.
     *
     * Lida com formatos onde campos ficam "grudados" sem espaços (OCR típico):
     *   Header:  "CPU2526 PróprioLOCAÇÃO DE CONTAINER..."
     *   Glued:   "88316,00SINAPISERVENTE COM ENCARGOS COMPLEMENTARESH1,320000024,3732,17"
     *   Alpha:   "A.12.000.021099 CPOS/CDHUCONTAINER DEPÓSITO...869,79"
     *   Spaced:  "3421 SINAPI CIMENTO PORTLAND KG 5,000 0,80"
     */
    static parse(text: string): Record<string, AnalyzedComposition> {
        const compositions: Record<string, AnalyzedComposition> = {};
        if (!text) return compositions;

        const lines = text.split('\n');
        let currentComp: AnalyzedComposition | null = null;

        // ── Section markers ──────────────────────────────────────────────
        const rxSectionComposicao = /^Composi[çc][ãa]o\s*Auxiliar/i;
        const rxSectionInsumo = /^Insumo$/i;
        let currentSection: 'insumo' | 'composition' = 'insumo';

        // ── Header patterns ─────────────────────────────────────────────
        // H1: "CPU2526 PróprioLOCAÇÃO..." — bank prefix + code + space + description
        // Captures the FULL prefix+code as group 1, then description as group 2
        const rxHeaderPrefixed = /^((?:CPU|ORSE|SINAPI|SICRO3?|PROP|Próprio|EMOP|KENE|SBC|SETOP|CDHU|CPOS|COMP)\s*[A-Z0-9][\w.\-]*)\s+(.+)/i;

        // H2: "COMPOSIÇÃO 93215 - CONCRETO ARMADO..."
        const rxHeaderComposicao = /(?:COMPOSI[ÇC][ÃA]O|CÓDIGO)[:\s]+([0-9]{4,}[.\-0-9]*)\s+[-–]?\s*(.+)/i;

        // H3: "93215 SINAPI ARGAMASSA TRAÇO 1:3 M3" — numeric code + bank + description
        const rxHeaderNumericWithSource = new RegExp(
            `^([0-9]{4,}[.\\-0-9]*)\\s+(?:${BANKS})\\b\\s*(.+)`, 'i'
        );

        // ── Item patterns ───────────────────────────────────────────────

        // ITEM-GLUED: Fields concatenated without spaces (OCR artifact).
        // "88316,00SINAPISERVENTE COM ENCARGOS COMPLEMENTARESH1,320000024,3732,17"
        // After matching code+bank, we split desc+unit+numbers using the unit anchor
        // and the splitGluedNumbers function for the numeric tail.
        const rxItemGluedStart = new RegExp(
            `^(\\d{3,})` +                                          // code
            `[,.]?(\\d{2})?` +                                      // optional decimal part
            `(${BANKS})` +                                           // bank
            `(.+)$`,                                                 // rest (desc + unit + numbers)
            'i'
        );

        // Split the "rest" part: description + UNIT + glued_numbers
        const rxGluedDescUnitNums = new RegExp(
            `^(.+?)(${UNITS_ALT})((?:\\d+[,.]\\d+)+)\\s*$`, 'i'
        );

        // ITEM-SPACED: Clean spaced format
        const rxItemSpaced = new RegExp(
            `^(?:(?:${BANKS})\\s+)?(\\d{3,}[.\\-\\d]*)\\s+` +     // optional bank prefix + code
            `(.+?)\\s+` +                                            // description
            `(${UNITS_ALT})\\s+` +                                   // unit
            `(\\d+[,.]\\d+)\\s+` +                                   // coefficient
            `(\\d+[,.]\\d+)` +                                       // price
            `(?:\\s+(\\d+[,.]\\d+))?` +                               // total (optional)
            `\\s*$`,
            'i'
        );

        // ITEM-ALPHA: Alphanumeric code with dots (CPOS/CDHU style)
        const rxItemAlpha = new RegExp(
            `^([A-Z][\\d.]+[\\d])\\s*(?:${BANKS})\\s*(.+?)\\s*(\\d+[,.]\\d+)\\s*$`, 'i'
        );

        // ── Ignore patterns ─────────────────────────────────────────────
        const rxIgnore = /^(?:DESCRI[ÇC]|COEFICIENTE|PRE[ÇC]O\s*UNIT|CUSTO\s*TOTAL|[-=]{3,})/i;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.length < 3) continue;

            // Check section markers
            if (rxSectionComposicao.test(line)) {
                currentSection = 'composition';
                continue;
            }
            if (rxSectionInsumo.test(line)) {
                currentSection = 'insumo';
                continue;
            }

            // Skip table headers
            if (rxIgnore.test(line)) continue;

            // ── Strategy: If inside a composition, try item patterns FIRST ──
            if (currentComp) {
                let matched = false;

                // Try ITEM-GLUED
                const mGlued = line.match(rxItemGluedStart);
                if (mGlued) {
                    const restPart = mGlued[4];
                    const mDescUnit = restPart.match(rxGluedDescUnitNums);
                    if (mDescUnit) {
                        const nums = splitGluedNumbers(mDescUnit[3]);
                        if (nums) {
                            currentComp.items.push({
                                code: mGlued[1],
                                description: mDescUnit[1].trim(),
                                type: currentSection,
                                unit: mDescUnit[2].toUpperCase(),
                                coefficient: nums.coef,
                                price: nums.price
                            });
                            matched = true;
                        }
                    }
                }

                // Try ITEM-SPACED
                if (!matched) {
                    const mSpaced = line.match(rxItemSpaced);
                    if (mSpaced) {
                        // Clean description: remove leading bank name if present
                        const spacedDesc = mSpaced[2].trim().replace(
                            /^(?:SINAPI|ORSE|SICRO3?|CPU|Próprio|PROP|EMOP|KENE|SBC|SETOP|CDHU|CPOS|COMP)\s+/i, ''
                        );
                        currentComp.items.push({
                            code: mSpaced[1],
                            description: spacedDesc,
                            type: currentSection,
                            unit: mSpaced[3].toUpperCase(),
                            coefficient: parseNum(mSpaced[4]),
                            price: parseNum(mSpaced[5])
                        });
                        matched = true;
                    }
                }

                // Try ITEM-ALPHA (CPOS/CDHU style)
                if (!matched) {
                    const mAlpha = line.match(rxItemAlpha);
                    if (mAlpha) {
                        currentComp.items.push({
                            code: mAlpha[1],
                            description: mAlpha[2].trim(),
                            type: currentSection,
                            unit: 'UN',
                            coefficient: 1,
                            price: parseNum(mAlpha[3])
                        });
                        matched = true;
                    }
                }

                if (matched) continue;
                // If no item matched, fall through to header detection below.
            }

            // ── Try to detect composition header ─────────────────────────
            let headerCode = '';
            let headerDesc = '';
            let headerFound = false;

            // H2: "COMPOSIÇÃO 93215 - ..."
            const mH2 = line.match(rxHeaderComposicao);
            if (mH2) {
                headerCode = mH2[1];
                headerDesc = mH2[2];
                headerFound = true;
            }

            // H1: "CPU2526 PróprioLOCAÇÃO..." — captures full prefix+code
            if (!headerFound) {
                const mH1 = line.match(rxHeaderPrefixed);
                if (mH1) {
                    // Extract numeric part from prefix+code (e.g., "CPU2526" → "2526", "KENE001" → "KENE001")
                    const fullCode = mH1[1].replace(/\s+/g, '');
                    // Remove known bank prefix to get clean code
                    const codeOnly = fullCode.replace(/^(?:CPU|ORSE|SINAPI|SICRO3?|PROP|Próprio|EMOP|KENE|SBC|SETOP|CDHU|CPOS|COMP)/i, '');
                    // If removing prefix leaves only digits, use just the digits.
                    // If code is alphanumeric (like KENE001), keep full code.
                    const bankPrefix = fullCode.substring(0, fullCode.length - codeOnly.length);
                    // For banks that are ALSO part of the code (KENE, SBC), keep them
                    const alphaBanks = /^(KENE|SBC|SETOP)/i;
                    headerCode = alphaBanks.test(bankPrefix) ? fullCode : codeOnly;
                    // Clean description: remove leading bank name glued to description
                    // e.g., "PróprioLOCAÇÃO DE CONTAINER..." → "LOCAÇÃO DE CONTAINER..."
                    headerDesc = mH1[2].replace(
                        /^(?:SINAPI|ORSE|SICRO3?|CPU|Próprio|PROP|EMOP|KENE|SBC|SETOP|CDHU|CPOS|COMP)\s*/i, ''
                    );
                    headerFound = true;
                }
            }

            // H3: "93215 SINAPI ARGAMASSA..." — only when NOT inside a composition
            // (inside a composition, spaced items would have been caught above)
            if (!headerFound) {
                const mH3 = line.match(rxHeaderNumericWithSource);
                if (mH3) {
                    // If inside a composition and no item pattern matched, this could be:
                    // a) A new composition header
                    // b) An item with unusual format
                    // Heuristic: if it has UNIT+NUMBERS at end, it's an item (skip).
                    // Otherwise, it's a header.
                    if (currentComp) {
                        const hasItemSuffix = new RegExp(`(${UNITS_ALT})\\s+\\d+[,.]\\d+\\s+\\d+[,.]\\d+`, 'i').test(line);
                        if (!hasItemSuffix) {
                            headerCode = mH3[1];
                            headerDesc = mH3[2];
                            headerFound = true;
                        }
                    } else {
                        headerCode = mH3[1];
                        headerDesc = mH3[2];
                        headerFound = true;
                    }
                }
            }

            if (headerFound && headerCode) {
                // Save previous composition if it has items
                if (currentComp && currentComp.items.length > 0) {
                    compositions[currentComp.code] = currentComp;
                }

                const cleanCode = headerCode.replace(/[^A-Za-z0-9.\-]/g, '');

                // Extract unit from end of description
                let unit = 'UN';
                const unitMatch = headerDesc.match(new RegExp(`\\s(${UNITS_ALT})\\s*$`, 'i'));
                if (unitMatch) {
                    unit = unitMatch[1].toUpperCase();
                }

                currentComp = {
                    code: cleanCode,
                    description: headerDesc.trim(),
                    unit,
                    items: []
                };
                currentSection = 'insumo'; // Reset for new composition
                continue;
            }
        }

        // Save the last composition
        if (currentComp && currentComp.items.length > 0) {
            compositions[currentComp.code] = currentComp;
        }

        // Logging
        const totalItems = Object.values(compositions).reduce((sum, c) => sum + c.items.length, 0);
        console.log(`[AnalyticParser] Parsed ${Object.keys(compositions).length} compositions with ${totalItems} total items.`);

        return compositions;
    }
}
