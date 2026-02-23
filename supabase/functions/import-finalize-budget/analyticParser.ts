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

const KNOWN_UNITS = [
    'MÊS', 'M2', 'M3', 'ML', 'KG', 'KM', 'UN', 'VB', 'CJ', 'SC', 'HA',
    'M²', 'M³', 'CH', 'CI', 'HP', 'TB', 'PR', 'GL', 'DM', 'JG',
    'H', 'L', 'M', 'T', 'UNXMÊS'
] as const;

const UNITS_ALT = KNOWN_UNITS.join('|');

const BANKS = 'SINAPI|ORSE|SICRO3?|CPU|Próprio|PROP|EMOP|KENE|SBC|SETOP|CDHU|CPOS(?:\\/CDHU)?|COMP';

function parseNum(s: string | undefined): number {
    if (!s) return 0;
    const cleaned = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
}

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
        const coefInt = s.substring(0, commaPositions[0]);
        const seg1 = s.substring(commaPositions[0] + 1, commaPositions[1]);
        const seg2 = s.substring(commaPositions[1] + 1, commaPositions[2]);
        const priceDec = seg2.substring(0, 2);

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
        const price = parseNum(bestPriceInt + ',' + priceDec);
        return { coef, price };
    } else if (commaPositions.length === 2) {
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
    static parse(text: string): Record<string, AnalyzedComposition> {
        const compositions: Record<string, AnalyzedComposition> = {};
        if (!text) return compositions;

        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let currentComp: AnalyzedComposition | null = null;

        let state: 'IDLE' | 'IN_COMPOSITION_HEADER' | 'IN_ITEM_HEADER' | 'IGNORE_UNTIL_MARKER' = 'IDLE';
        let currentSection: 'insumo' | 'composition' = 'insumo';

        let headerBuffer: string[] = [];
        let itemBuffer: string[] = [];

        const categoryRegex = /(CANT|SEDI|REVES|FUND|ESTRU|ACAB|INST|MAT|EQUIP|SERV)\s*-\s*[A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ\s]+$/i;
        const headerUnitNumsRegex = /^(UNXMÊS|M²|M³|M2|M3|ML|KG|UN|VB|H|L)\d/i;

        for (let line of lines) {
            const isComposicao = line.toLowerCase() === 'composição';
            const isComposicaoAux = line.toLowerCase() === 'composição auxiliar' || line.toLowerCase() === 'composição auxiliar ref';
            const isInsumo = line.toLowerCase() === 'insumo';

            if (isComposicao) {
                if (currentComp && currentComp.code) {
                    compositions[currentComp.code] = currentComp;
                }
                state = 'IN_COMPOSITION_HEADER';
                headerBuffer = [];
                currentComp = null;
                continue;
            }

            if (isComposicaoAux) {
                state = 'IN_ITEM_HEADER';
                currentSection = 'composition';
                itemBuffer = [];
                continue;
            }

            if (isInsumo) {
                state = 'IN_ITEM_HEADER';
                currentSection = 'insumo';
                itemBuffer = [];
                continue;
            }

            if (state === 'IGNORE_UNTIL_MARKER') {
                continue;
            }

            if (line.match(/^Observação/i)) {
                state = 'IGNORE_UNTIL_MARKER';
                continue;
            }

            if (categoryRegex.test(line)) {
                line = line.replace(categoryRegex, '').trim();
                if (!line) continue;
            }

            const lowerLine = line.toLowerCase();
            if (lowerLine === 'material' || lowerLine === 'materialunxmês') {
                continue;
            }

            if (lowerLine.startsWith('mo sem ls') || lowerLine.startsWith('valor do bdi')) {
                continue;
            }

            if (state === 'IN_COMPOSITION_HEADER') {
                if (headerUnitNumsRegex.test(line)) {
                    const match = line.match(/^(UNXMÊS|M²|M³|M2|M3|ML|KG|UN|VB|H|L)(\d.*)$/i);
                    let unit = 'UN';
                    if (match) {
                        unit = match[1].toUpperCase();
                    }

                    const fullDesc = headerBuffer.join(' ');
                    let code = 'UNKNOWN';
                    let desc = fullDesc;

                    // Tenta: CODE BANCO descrição (com espaço entre código e banco)
                    const altMatch = fullDesc.match(new RegExp(`^([A-Z0-9.\\-,/]+)\\s+(?:${BANKS})\\s*(.*)$`, 'i'));
                    if (altMatch) {
                        code = altMatch[1];
                        desc = altMatch[2];
                    } else {
                        const spaceIdx = fullDesc.indexOf(' ');
                        if (spaceIdx !== -1) {
                            code = fullDesc.substring(0, spaceIdx);
                            desc = fullDesc.substring(spaceIdx + 1).replace(new RegExp(`^(?:${BANKS})\\s*`, 'i'), '');
                        }
                    }

                    currentComp = {
                        code: code.trim().replace(/,00$/, ''),
                        description: desc.trim(),
                        unit: unit,
                        items: []
                    };
                    state = 'IDLE';
                } else {
                    headerBuffer.push(line);
                }
            } else if (state === 'IN_ITEM_HEADER') {
                const numsMatch = line.match(/^(.*?)(\d+[,]\d+(?:[,.]\d+)*)$/);

                if (numsMatch && /\d+[,]\d+/.test(numsMatch[2]) && (numsMatch[2].match(/,/g) || []).length >= 1) {
                    const prefixString = numsMatch[1];
                    const numString = numsMatch[2];

                    if (prefixString) {
                        itemBuffer.push(prefixString);
                    }

                    const fullText = itemBuffer.join(' ');
                    let code = '';
                    let desc = fullText;

                    // Tenta: CODE BANCO descrição (com espaço entre código e banco)
                    const mCodeBank = fullText.match(new RegExp(`^([A-Z0-9.\\-,/]+)\\s+(?:${BANKS})\\s*(.*)$`, 'i'));
                    if (mCodeBank) {
                        code = mCodeBank[1];
                        desc = mCodeBank[2];
                    } else {
                        // Tenta: CODE colado a BANCO sem espaço (ex: 88316,00SINAPI... já virou 88316 SINAPI após buffer join)
                        const mCodeGlued = fullText.match(new RegExp(`^([A-Z0-9.\\-,/]+?)(?:${BANKS})(.*)$`, 'i'));
                        if (mCodeGlued) {
                            code = mCodeGlued[1];
                            desc = mCodeGlued[2];
                        } else {
                            const spaceIdx = fullText.indexOf(' ');
                            if (spaceIdx !== -1) {
                                code = fullText.substring(0, spaceIdx);
                                desc = fullText.substring(spaceIdx + 1).replace(new RegExp(`^(?:${BANKS})\\s*`, 'i'), '');
                            } else {
                                code = fullText;
                            }
                        }
                    }

                    let unit = 'UN';
                    const unitMatch = desc.match(new RegExp(`(?:Material)?(${UNITS_ALT})$`, 'i'));
                    if (unitMatch) {
                        unit = unitMatch[1].toUpperCase();
                        desc = desc.substring(0, desc.length - unitMatch[0].length).trim();
                    } else if (prefixString) {
                        const preUnitMatch = prefixString.match(new RegExp(`(?:Material)?(${UNITS_ALT})$`, 'i'));
                        if (preUnitMatch) {
                            unit = preUnitMatch[1].toUpperCase();
                        }
                    }

                    const parsedNums = splitGluedNumbers(numString);
                    const coef = parsedNums ? parsedNums.coef : 1;
                    const price = parsedNums ? parsedNums.price : 0;

                    if (currentComp) {
                        currentComp.items.push({
                            code: code.trim().replace(/,00$/, ''),
                            description: desc.trim(),
                            type: currentSection,
                            unit: unit.toUpperCase(),
                            coefficient: coef,
                            price: price
                        });
                    }

                    state = 'IDLE';
                } else {
                    itemBuffer.push(line);
                }
            }
        }

        if (currentComp && currentComp.code) {
            compositions[currentComp.code] = currentComp;
        }

        const totalItems = Object.values(compositions).reduce((sum, c) => sum + c.items.length, 0);
        console.log(`[AnalyticParser] Parsed ${Object.keys(compositions).length} compositions with ${totalItems} total items.`);

        return compositions;
    }
}

if (import.meta.main) {
    const text = `Composição
CPU2526 PróprioLOCAÇÃO DE CONTAINER TIPO DEPÓSITO - ÁREA MÍNIMA DE 13,80 M2CANT - CANTEIRO DE 
OBRAS
UNXMÊS1,0000000969,30
Composição Auxiliar
88316,00SINAPISERVENTE COM ENCARGOS COMPLEMENTARESSEDI - SERVIÇOS 
DIVERSOS
H1,320000024,3732,17
Composição Auxiliar
88247,00SINAPIAUXILIAR DE ELETRICISTA COM ENCARGOS COMPLEMENTARESSEDI - SERVIÇOS 
DIVERSOS
H1,320000025,5633,74
Insumo
A.12.000.021099 CPOS/CDHUCONTAINER DEPÓSITO, MÓDULO METÁLICO EM AÇO GALVANIZADO DE 6,0X2,3X2,5M
Materialunxmês1,0000000869,79869,79
MO sem LS =>LS =>0,00MO com LS =>969,30
Valor do BDI =>0,25Valor com BDI =>1.192,08
Observação
Composição de Referência: 02.02.150 CPOS/CDHU`;

    const res = AnalyticReportParser.parse(text);
    console.log(JSON.stringify(res, null, 2));
}
