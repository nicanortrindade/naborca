// Temporary file to hold new parser function
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

    console.log(`[SINAPI PARSER PRICES] aba=${sheetName} totalRows=${data.length}`);

    // Aliases para headers de aba de preços
    const keyAliases = ['codigo', 'preco', 'valor', 'custo', 'tipo'];

    const headerRow = findHeaderRow(data, keyAliases);

    if (headerRow === -1) {
        console.error(`[SINAPI PARSER PRICES] aba=${sheetName} ERRO: Header não encontrado`);
        console.log(`[SINAPI PARSER PRICES] aba=${sheetName} Sample:`, data.slice(0, 5).map(r => (r as any[]).slice(0, 12)));
        return { inputPrices, compositionPrices };
    }

    const headers = (data[headerRow] as any[]).map(h => cleanText(h));
    const normalizedHeaders = headers.map(h => normalizeHeader(h));

    console.log(`[SINAPI PARSER PRICES] aba=${sheetName} headerRow=${headerRow}`);
    console.log(`[SINAPI PARSER PRICES] aba=${sheetName} headers=${JSON.stringify(normalizedHeaders.slice(0, 12))}`);

    // Aliases para colunas
    const codeAliases = ['codigo', 'cod', 'item', 'insumo', 'composicao'];
    const typeAliases = ['tipo', 'tipo item', 'tipo de item'];
    const priceAliases = ['preco', 'valor', 'custo', 'custo unitario', 'valor unitario', 'custo total'];

    const codeCol = findColumnIndex(headers, codeAliases);
    const typeCol = findColumnIndex(headers, typeAliases);
    const priceCol = findColumnIndex(headers, priceAliases);

    console.log(`[SINAPI PARSER PRICES] Mapeamento: Code=[${codeCol.index}|${codeCol.match}] Type=[${typeCol.index}|${typeCol.match}] Price=[${priceCol.index}|${priceCol.match}]`);

    if (codeCol.index === -1) {
        console.error(`[SINAPI PARSER PRICES] ERRO: Coluna CÓDIGO não encontrada`);
        return { inputPrices, compositionPrices };
    }

    if (priceCol.index === -1) {
        console.error(`[SINAPI PARSER PRICES] ERRO: Coluna PREÇO não encontrada`);
        console.log(`[SINAPI PARSER PRICES] Headers disponíveis:`, normalizedHeaders);
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
        const type = typeCol.index >= 0 ? cleanText(row[typeCol.index]).toUpperCase() : '';

        if (!code || code.length < 3 || price <= 0) {
            discarded++;
            continue;
        }

        // Determinar se é insumo ou composição
        const isComposition = type.includes('COMP') || type.includes('CPU') || code.length <= 7;

        if (isComposition) {
            compositionPrices.push({ code, price });
            compCount++;
        } else {
            inputPrices.push({ code, price });
            inputCount++;
        }
    }

    console.log(`[SINAPI PARSER PRICES] Results: ${inputCount} input prices, ${compCount} composition prices, ${discarded} discarded`);
    return { inputPrices, compositionPrices };
}
