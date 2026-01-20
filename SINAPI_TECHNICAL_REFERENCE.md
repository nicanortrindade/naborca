# SINAPI - REFERÊNCIA TÉCNICA COMPLETA

## 📦 1. FUNÇÃO `upsertPriceTable` (TypeScript)

**Localização:** `src/lib/supabase-services/SinapiService.ts` (linha 174)

```typescript
async upsertPriceTable(table: Omit<SinapiPriceTable, 'id' | 'created_at'>): Promise<SinapiPriceTable> {
    // Tenta usar RPC segura primeiro (recomendado)
    const { data: id, error } = await supabase.rpc('ingest_sinapi_price_table', {
        p_uf: table.uf,
        p_competence: table.competence,
        p_regime: table.regime,
        p_is_mock: table.is_mock ?? false
    });

    if (error) {
        console.error('Erro na RPC ingest_sinapi_price_table. Tentando fallback para Tabela...', error);
        // Fallback: Tentativa direta (se RPC não existir) - mas falhará em RLS provavelmente
        const { data: fallbackData, error: fallbackError } = await (supabase
            .from('sinapi_price_tables') as any)
            .upsert({
                source: table.source || 'SINAPI',
                uf: table.uf,
                competence: table.competence,
                regime: table.regime,
                file_urls: table.file_urls,
                is_mock: table.is_mock ?? false,
                source_tag: table.source_tag ?? 'SINAPI'
            }, { onConflict: 'source,uf,competence,regime' })
            .select()
            .single();

        if (fallbackError) throw fallbackError;
        return fallbackData;
    }

    // Recuperar o objeto criado
    const { data: finalData, error: fetchError } = await (supabase
        .from('sinapi_price_tables') as any)
        .select('*')
        .eq('id', id)
        .single();

    if (fetchError) throw fetchError;
    return finalData;
}
```

**Fluxo:**
1. Tenta RPC `ingest_sinapi_price_table` (SECURITY DEFINER)
2. Se falhar, tenta upsert direto (pode falhar em RLS)
3. Retorna o objeto `SinapiPriceTable` criado/atualizado

---

## 🗄️ 2. RPC `ingest_sinapi_price_table` (PostgreSQL)

**Localização:** `sinapi_secure_rpc.sql` (linha 9)

```sql
CREATE OR REPLACE FUNCTION ingest_sinapi_price_table(
    p_uf TEXT,
    p_competence TEXT,
    p_regime TEXT,
    p_is_mock BOOLEAN DEFAULT false
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO sinapi_price_tables (uf, competence, regime, is_mock, source)
    VALUES (p_uf, p_competence, p_regime, p_is_mock, 'SINAPI')
    ON CONFLICT (source, uf, competence, regime) 
    DO UPDATE SET updated_at = NOW()
    RETURNING id INTO v_id;
    
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Características:**
- `SECURITY DEFINER`: Executa com permissões do owner (bypassa RLS)
- `ON CONFLICT`: Atualiza `updated_at` se já existir
- Retorna: `UUID` (id da tabela de preços)

---

## 📊 3. TABELA `sinapi_price_tables`

**Localização:** `supabase_sinapi_tables.sql` (linha 13)

```sql
CREATE TABLE IF NOT EXISTS sinapi_price_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL DEFAULT 'SINAPI',
    uf TEXT NOT NULL,
    competence TEXT NOT NULL, -- YYYY-MM
    regime TEXT NOT NULL CHECK (regime IN ('DESONERADO', 'NAO_DESONERADO')),
    file_urls JSONB, -- URLs dos arquivos originais baixados
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_price_table UNIQUE (source, uf, competence, regime)
);

CREATE INDEX IF NOT EXISTS idx_sinapi_price_tables_uf ON sinapi_price_tables(uf);
CREATE INDEX IF NOT EXISTS idx_sinapi_price_tables_competence ON sinapi_price_tables(competence);
CREATE INDEX IF NOT EXISTS idx_sinapi_price_tables_regime ON sinapi_price_tables(regime);
```

**Constraint Única:**
- `(source, uf, competence, regime)` → Garante 1 tabela por combinação

**Exemplo de Dados:**
```sql
-- BA 2025-01 gera 2 registros:
id: uuid-1, source: 'SINAPI', uf: 'BA', competence: '2025-01', regime: 'DESONERADO'
id: uuid-2, source: 'SINAPI', uf: 'BA', competence: '2025-01', regime: 'NAO_DESONERADO'
```

---

## 🔍 4. FUNÇÃO `parsePricesSheet` (TypeScript)

**Localização:** `src/utils/sinapiIngestion.ts` (linha 653)

```typescript
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
```

**Logs Gerados:**
```
[SINAPI PARSER PRICES] aba=Analítico com Custo totalRows=XXXX
[SINAPI PARSER PRICES] aba=Analítico com Custo headerRow=X
[SINAPI PARSER PRICES] aba=Analítico com Custo headers=[...]
[SINAPI PARSER PRICES] Mapeamento: Code=[X|xxx] Type=[Y|yyy] Price=[Z|zzz]
[SINAPI PARSER PRICES] Results: X input prices, Y composition prices, Z discarded
```

---

## 📋 5. ALIASES DE COLUNAS

### Para Detecção de Header (keyAliases):
```typescript
['codigo', 'preco', 'valor', 'custo', 'tipo']
```

### Para Mapeamento de Colunas:

**Código:**
```typescript
['codigo', 'cod', 'item', 'insumo', 'composicao']
```

**Tipo:**
```typescript
['tipo', 'tipo item', 'tipo de item']
```

**Preço:**
```typescript
['preco', 'valor', 'custo', 'custo unitario', 'valor unitario', 'custo total']
```

---

## 🔄 6. FLUXO COMPLETO DE INGESTÃO DE PREÇOS

```
1. Upload do arquivo SINAPI_Referência_2025_01.xlsx
   ↓
2. Workbook loaded successfully
   ↓
3. identifySheetType("Analítico com Custo") → type: 'prices'
   ↓
4. parsePricesSheet(sheet, "Analítico com Custo")
   ├─ findHeaderRow() → detecta linha de cabeçalho
   ├─ findColumnIndex() → mapeia colunas (code, type, price)
   └─ Extrai inputPrices[] e compositionPrices[]
   ↓
5. Para cada regime (DESONERADO, NAO_DESONERADO):
   ├─ getPriceTable(uf, competence, regime) → busca price_table_id
   ├─ deduplicatePrices(inputPrices, 'input_code')
   ├─ batchUpsertInputPrices(price_table_id, dedupedPrices)
   │   └─ RPC: ingest_sinapi_input_prices_batch
   ├─ deduplicatePrices(compositionPrices, 'composition_code')
   └─ batchUpsertCompositionPrices(price_table_id, dedupedPrices)
       └─ RPC: ingest_sinapi_composition_prices_batch
   ↓
6. Resultado:
   - sinapi_input_prices populado
   - sinapi_composition_prices populado
```

---

## 🎯 DADOS NECESSÁRIOS PARA DEBUG

Para diagnosticar por que `sinapi_input_prices` e `sinapi_composition_prices` estão zerados, precisamos dos seguintes logs do console:

```
[SINAPI PARSER PRICES] aba=Analítico com Custo totalRows=?
[SINAPI PARSER PRICES] aba=Analítico com Custo headerRow=?
[SINAPI PARSER PRICES] aba=Analítico com Custo headers=[...]
[SINAPI PARSER PRICES] Mapeamento: Code=[?|?] Type=[?|?] Price=[?|?]
[SINAPI PARSER PRICES] Results: ? input prices, ? composition prices, ? discarded
```

**Especialmente importante:**
- `headerRow`: Se for `-1`, header não foi encontrado
- `Mapeamento Price`: Se for `[-1|]`, coluna de preço não foi mapeada
- `Results`: Se for `0 input prices, 0 composition prices`, dados não foram extraídos

---

**Aguardando esses logs para continuar o debugging!** 🚀
