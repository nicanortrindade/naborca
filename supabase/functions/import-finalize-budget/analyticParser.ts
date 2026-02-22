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

export class AnalyticReportParser {
    /**
     * Tenta extrair composições de um texto bruto de PDF (OCR ou Text Extract).
     * Implementação heurística baseada em padrões comuns de relatórios de engenharia (SINAPI, ORSE, Sicro).
     */
    static parse(text: string): Record<string, AnalyzedComposition> {
        const compositions: Record<string, AnalyzedComposition> = {};

        if (!text) return compositions;

        const lines = text.split('\n');
        let currentComp: AnalyzedComposition | null = null;

        // Regex Patterns (Adaptáveis para vários formatos)

        // Identifica cabeçalho de composição
        // Ex: "93215 COMPOSIÇÃO: ARGAMASSA TRAÇO 1:3..."
        // Ex: "COMPOSIÇÃO 10.203 - CONCRETO ARMADO..."
        const rxCompHeader = /(?:COMPOSI[ÇC][ÃA]O|CÓDIGO)[:\s]+([0-9]{4,}[.\-0-9]*)\s+[-–]?\s*(.+)/i;
        // Fallback: Código no início da linha seguido de texto longo
        const rxCompHeaderSimple = /^([0-9]{4,}[.\-0-9]*)\s+(.+)/;

        // Identifica item/insumo dentro da composição
        // Ex: "SINAPI  88309  PEDREIRO  H  1,500  20,00"
        // Ex: "3421  CIMENTO PORTLAND  KG  5.00  0.80"
        // Grupo 1: Fonte (Opcional), Grupo 2: Código, Grupo 3: Descrição, Grupo 4: Unidade, Grupo 5: Coef, Grupo 6: Preço
        const rxItem = /(?:[A-Z]+\s+)?([0-9]{3,}[.\-0-9]*)\s+(.+?)\s+([A-Z]{1,3}|[a-z]{1,3})\s+([0-9]+[.,]?[0-9]*)\s+([0-9]+[.,]?[0-9]*)?/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.length < 5) continue;

            // 1. Tentar detectar início de nova composição
            let matchHeader = line.match(rxCompHeader);
            if (!matchHeader) {
                // Heurística de contexto: Se a linha começa com número e tem "COMPOSIÇÃO" ou palavras chave no texto
                if (/COMPOSI[ÇC][ÃA]O/i.test(line) || /CPU/i.test(line)) {
                    matchHeader = line.match(rxCompHeaderSimple);
                }
            }

            if (matchHeader) {
                // Salvar a anterior se existir e tiver itens
                if (currentComp && currentComp.items.length > 0) {
                    compositions[currentComp.code] = currentComp;
                }

                // Iniciar nova
                const code = matchHeader[1].replace(/[^0-9.-]/g, '');
                const descMap = matchHeader[2].trim();

                // Tentar extrair unidade do final da descrição (ex: "... M3")
                let unit = 'UN';
                const unitMatch = descMap.match(/\s([A-Z]{1,3})$/);
                if (unitMatch) {
                    unit = unitMatch[1];
                }

                currentComp = {
                    code,
                    description: descMap,
                    unit,
                    items: []
                };
                continue;
            }

            // 2. Se estamos dentro de uma composição, procurar itens
            if (currentComp) {
                // Ignorar linhas de cabeçalho de tabela (ex: "Descricao Unid Coef")
                if (/DESCRI[ÇC]|UNID|COEF|PRE[ÇC]/i.test(line)) continue;

                const matchItem = line.match(rxItem);
                if (matchItem) {
                    const itemCode = matchItem[1].replace(/[^0-9.-]/g, '');
                    const itemDesc = matchItem[2].trim();
                    const itemUnit = matchItem[3];
                    const itemCoef = parseFloat(matchItem[4].replace(',', '.'));
                    const itemPrice = matchItem[5] ? parseFloat(matchItem[5].replace(',', '.')) : 0;

                    // Validar se coeficiente faz sentido (evitar lixo)
                    if (!isNaN(itemCoef) && itemCode.length >= 3) {
                        currentComp.items.push({
                            code: itemCode,
                            description: itemDesc,
                            type: 'insumo', // Default, poderia refinar se tiver palavra "COMPOSIÇÃO" na descrição
                            unit: itemUnit,
                            coefficient: itemCoef,
                            price: itemPrice
                        });
                    }
                }
            }
        }

        // Adicionar a última
        if (currentComp && currentComp.items.length > 0) {
            compositions[currentComp.code] = currentComp;
        }

        // Pós-processamento e Limpeza
        console.log(`[AnalyticParser] Parsed ${Object.keys(compositions).length} compositions.`);
        return compositions;
    }
}
