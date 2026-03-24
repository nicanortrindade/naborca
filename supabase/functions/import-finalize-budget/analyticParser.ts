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
    // Remove pontos de milhar (ponto seguido de 3 dígitos antes de vírgula ou fim)
    // Ex: 708.162,14 → 708162,14 → 708162.14
    const cleaned = s
        .replace(/\.(?=\d{3}(,|\s|$))/g, '')  // Remove pontos de milhar
        .replace(',', '.');                      // Troca vírgula decimal por ponto
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

function validateAndFixNumbers(coef: number, price: number, total: number, rawNumString: string): { coef: number; price: number; total: number } {
    // Se coef * price já bate com total (tolerância 5%), retorna como está
    if (total > 0 && Math.abs(coef * price - total) / total < 0.05) {
        return { coef, price, total };
    }
    
    // Tentar re-parsear a string bruta com diferentes pontos de corte
    // Procurar padrão: coeficiente (5-9 decimais) + preço (com ou sem milhar) + total
    const rawClean = rawNumString.trim();
    const parts = rawClean.split(/\s+/);
    
    if (parts.length === 3) {
        // Já separados por espaço — tentar variações
        const p0 = parseNum(parts[0]);
        const p1 = parseNum(parts[1]);
        const p2 = parseNum(parts[2]);
        
        // Variação: mover último dígito do coef para início do price
        const s0 = parts[0];
        const s1 = parts[1];
        if (s0.length > 3) {
            const altCoefStr = s0.substring(0, s0.length - 1);
            const altPriceStr = s0.charAt(s0.length - 1) + s1;
            const altCoef = parseNum(altCoefStr);
            const altPrice = parseNum(altPriceStr);
            if (p2 > 0 && Math.abs(altCoef * altPrice - p2) / p2 < 0.05) {
                return { coef: altCoef, price: altPrice, total: p2 };
            }
        }
        
        // Variação: mover primeiro dígito do price para final do coef
        if (s1.length > 1) {
            const altCoefStr = s0 + s1.charAt(0);
            const altPriceStr = s1.substring(1);
            const altCoef = parseNum(altCoefStr);
            const altPrice = parseNum(altPriceStr);
            if (p2 > 0 && Math.abs(altCoef * altPrice - p2) / p2 < 0.05) {
                return { coef: altCoef, price: altPrice, total: p2 };
            }
        }
    }
    
    return { coef, price, total };
}

export class AnalyticReportParser {
    static parse(text: string): Record<string, AnalyzedComposition> {
        const compositions: Record<string, AnalyzedComposition> = {};
        if (!text) return compositions;

        // PRÉ-PROCESSAMENTO
        text = text.replace(/\s*\|\s*/g, '\n');
        text = text.replace(/(Composição Auxiliar)/gi, '\n$1\n');
        text = text.replace(/(?<!Composição\s)(Composição)(?!\s+Auxiliar)/gi, '\n$1\n');
        text = text.replace(/(Insumo)/gi, '\n$1\n');
        text = text.replace(/(\d)([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ]{3,})/g, '$1 $2');
        text = text.replace(/([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ]{3,})(\d)/g, '$1 $2');
        text = text.replace(/(?<=.)(UNXMÊS|M²|M³|M2|M3|ML|KG|UN|VB|H|L)(\s*\d+[,.]?\d*)/gi, '\n$1$2');
        // Separar números colados com preço que tem ponto de milhar (ex: 708.162,14)
        text = text.replace(/(\d+,\d{7})(\d{1,3}\.\d{3},\d{2})(\d+,\d{2})/g, '$1 $2 $3');
        text = text.replace(/(\d+,\d{7})(\d+,\d{2})(\d+,\d{2})/g, '$1 $2 $3');
        text = text.replace(/(\d+,\d{2})(SINAPI|ORSE|Próprio)/gi, '$1 $2');
        text = text.replace(/(SINAPI|ORSE|Próprio)([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ])/gi, '$1 $2');

        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        let currentComp: AnalyzedComposition | null = null;

        let state: 'IDLE' | 'IN_COMPOSITION_HEADER' | 'IN_ITEM_HEADER' | 'IGNORE_UNTIL_MARKER' = 'IDLE';
        let currentSection: 'insumo' | 'composition' = 'insumo';

        let headerBuffer: string[] = [];
        let itemBuffer: string[] = [];

        const categoryRegex = /(CANT|SEDI|REVES|FUND|ESTRU|ACAB|INST|MAT|EQUIP|SERV)\s*-\s*[A-ZÀÁÂÃÉÊÍÓÔÕÚÜÇ\s]+$/i;
        const headerUnitNumsRegex = /^(UNXMÊS|M²|M³|M2|M3|ML|KG|UN|VB|H|L)\s*\d/i;


        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Ignorar marcador de seção auxiliar (não afeta lógica)
            if (line.match(/^Composi[çc][õo]es\s+Auxiliares/i)) {
                continue;
            }
            // Ignorar cabeçalhos de página repetidos do OCR
            if (line.match(/^Secretaria\s+de\s+Aten[çc][ãa]o/i)) {
                continue;
            }
            if (line.match(/^C[óo]digo\s*Banco\s*Descri[çc][ãa]o\s*Tipo\s*Und\s*Quant/i)) {
                continue;
            }

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

            if (line.match(/^Observa[çc][ãa]o/i)) {
                state = 'IGNORE_UNTIL_MARKER';
                continue;
            }

            if (categoryRegex.test(line)) {
                line = line.replace(categoryRegex, '').trim();
                if (!line) continue;
            }

            // Clean up glued garbage at the end of lines
            line = line.replace(/\s*MO sem LS.*$/i, '')
                       .replace(/\s*Valor do BDI.*$/i, '')
                       .replace(/\s*MO com LS.*$/i, '')
                       .replace(/\s*(?:Material|Equipamento|Mão de Obra|Serviços|Taxas|Franquia)\s*$/i, '')
                       .trim();

            if (!line || line.toLowerCase() === 'materialunxmês') {
                continue;
            }

            if (state === 'IN_COMPOSITION_HEADER') {
                // Check 1: unidade + número na mesma linha
                if (headerUnitNumsRegex.test(line)) {
                    const match = line.match(/^(UNXMÊS|M²|M³|M2|M3|ML|KG|UN|VB|H|L)\s*(\d.*)$/i);
                    let unit = 'UN';
                    if (match) {
                        unit = match[1].toUpperCase();
                    }

                    const fullDesc = headerBuffer.join(' ');
                    let code = 'UNKNOWN';
                    let desc = fullDesc;

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
                }
                // Check 2: unidade sozinha na linha (ex: "H", "M³", "UN")
                else if (line.match(/^(UNXMÊS|M²|M³|M2|M3|ML|KG|UN|VB|H|L)$/i)) {
                    // Verificar se a próxima linha começa com número
                    const nextLine = (i + 1 < lines.length) ? lines[i + 1] : '';
                    if (nextLine.match(/^\d/)) {
                        const unit = line.toUpperCase();

                        const fullDesc = headerBuffer.join(' ');
                        let code = 'UNKNOWN';
                        let desc = fullDesc;

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
                        i++; // pular a próxima linha (é o número que já processamos como parte do header)
                    } else {
                        headerBuffer.push(line);
                    }
                }
                else {
                    headerBuffer.push(line);
                }
            } else if (state === 'IN_ITEM_HEADER') {
                // Casar números normais (1,23) e números com ponto de milhar (708.162,14)
                const numTokenRx = '(?:\\d{1,3}(?:\\.\\d{3})+,\\d{2}|\\d+[,.]\\d+)';
                const numsMatch = line.match(new RegExp(`^(.*?)\\s*((?:${numTokenRx}\\s*){1,3})$`));

                if (numsMatch && /\d+[,.]\d+/.test(numsMatch[2])) {
                    const prefixString = numsMatch[1];
                    const numString = numsMatch[2].trim();

                    if (prefixString) {
                        itemBuffer.push(prefixString);
                    }

                    const fullText = itemBuffer.join(' ');
                    let code = '';
                    let desc = fullText;

                    const mCodeBank = fullText.match(new RegExp(`^([A-Z0-9.\\-,/]+)\\s+(?:${BANKS})\\s*(.*)$`, 'i'));
                    if (mCodeBank) {
                        code = mCodeBank[1];
                        desc = mCodeBank[2];
                    } else {
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
                    const unitMatch = desc.match(new RegExp(`(?:Material|Equipamento|Mão de Obra)?(${UNITS_ALT})$`, 'i'));
                    if (unitMatch) {
                        unit = unitMatch[1].toUpperCase();
                        desc = desc.substring(0, desc.length - unitMatch[0].length).trim();
                    } else if (prefixString) {
                        const preUnitMatch = prefixString.match(new RegExp(`(?:Material|Equipamento|Mão de Obra)?(${UNITS_ALT})$`, 'i'));
                        if (preUnitMatch) {
                            unit = preUnitMatch[1].toUpperCase();
                        }
                    }

                    let coef = 1;
                    let price = 0;
                    if (numString.includes(' ')) {
                        const parts = numString.split(/\s+/);
                        coef = parseNum(parts[0]);
                        price = parts.length > 1 ? parseNum(parts[1]) : 0;
                        const rawTotal = parts.length > 2 ? parseNum(parts[2]) : 0;
                        const fixed = validateAndFixNumbers(coef, price, rawTotal, numString);
                        coef = fixed.coef;
                        price = fixed.price;
                    } else {
                        const parsedNums = splitGluedNumbers(numString);
                        coef = parsedNums ? parsedNums.coef : 1;
                        price = parsedNums ? parsedNums.price : 0;
                    }

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

        // Filter out garbage codes (e.g. "original,", "POR", "de")
        for (const code of Object.keys(compositions)) {
            if (!/\d/.test(code) && !/^CPU/i.test(code) && !/^COMP/i.test(code)) {
                delete compositions[code];
            }
        }

        const totalItems = Object.values(compositions).reduce((sum, c) => sum + c.items.length, 0);
        const mainComps = Object.keys(compositions).filter(k => k.includes('.')).length;
        const auxComps = Object.keys(compositions).filter(k => /^\d{4,6}$/.test(k)).length;
        console.log(`[AnalyticParser] Parsed ${Object.keys(compositions).length} compositions (${mainComps} main, ${auxComps} auxiliary) with ${totalItems} total items.`);

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
