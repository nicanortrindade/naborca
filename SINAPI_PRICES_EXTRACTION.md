# SINAPI PRICES EXTRACTION - IMPLEMENTADO

**Data:** 2026-01-19  
**Status:** ✅ IMPLEMENTADO & BUILD OK

## 📊 CONTEXTO

Estrutura SINAPI foi completamente ingerida com sucesso:
```
✅ sinapi_inputs              = 4,836
✅ sinapi_compositions        = 9,669
✅ sinapi_composition_items   = 137,061
```

Porém os **PREÇOS** estavam zerados:
```
❌ sinapi_input_prices        = 0
❌ sinapi_composition_prices  = 0
```

## 🔍 CAUSA RAIZ

A aba **"Analítico com Custo"** (que contém os preços) estava sendo **IGNORADA** pelo parser:
- Linha 82: `IGNORED_SHEETS = [..., 'Analítico com Custo']`
- Linha 92: `if (n.includes('analitico') && n.includes('custo')) return null;`

Resultado: Parser nunca processava a aba de preços!

## ✅ SOLUÇÃO IMPLEMENTADA

### 1. **Novo Tipo de Aba: 'prices'**
```typescript
type SheetType = 'inputs' | 'compositions' | 'analytic' | 'prices';
```

- Removido "Analítico com Custo" de `IGNORED_SHEETS`
- Adicionado detecção específica em `identifySheetType`:
  ```typescript
  if (n.includes('analitico') && n.includes('custo')) {
      return { type: 'prices', regime: null };
  }
  ```

### 2. **Parser Dedicado: `parsePricesSheet()`**

Extrai preços de insumos E composições da mesma aba:

**Aliases de Colunas:**
```typescript
codigo: ['codigo', 'cod', 'item', 'insumo', 'composicao']
tipo: ['tipo', 'tipo item', 'tipo de item']
preco: ['preco', 'valor', 'custo', 'custo unitario', 'valor unitario', 'custo total']
```

**Lógica de Classificação:**
- Se `tipo.includes('COMP')` OU `code.length <= 7` → Composição
- Caso contrário → Insumo

**Validação:**
- Código deve ter >= 3 caracteres
- Preço deve ser > 0

### 3. **Processamento no Fluxo de Ingestão**

Adicionado bloco no `ingestSinapiFromFile`:

```typescript
else if (mapping.type === 'prices') {
    const { inputPrices, compositionPrices } = parsePricesSheet(sheet, sheetName);
    
    // Processar para AMBOS os regimes
    for (const regime of ['DESONERADO', 'NAO_DESONERADO']) {
        // Dedupe + Persist Input Prices
        const dedupedInputPrices = deduplicatePrices(..., 'input_code');
        await SinapiService.batchUpsertInputPrices(priceTableId, dedupedInputPrices);
        
        // Dedupe + Persist Composition Prices
        const dedupedCompPrices = deduplicatePrices(..., 'composition_code');
        await SinapiService.batchUpsertCompositionPrices(priceTableId, dedupedCompPrices);
    }
}
```

### 4. **Deduplicação de Preços**

```typescript
function deduplicatePrices<T>(prices: T[], keyField: string): T[] {
    const map = new Map<string, T>();
    for (const price of prices) {
        const key = String(price[keyField]);
        map.set(key, price); // Mantém último
    }
    return Array.from(map.values());
}
```

**Chaves de Deduplicação:**
- Input Prices: `price_table_id + input_code`
- Composition Prices: `price_table_id + composition_code`

### 5. **Persistência via RPC**

```typescript
// SinapiService.batchUpsertInputPrices
await supabase.rpc('ingest_sinapi_input_prices_batch', {
    p_price_table_id: priceTableId,
    p_prices: dedupedPrices
});

// SinapiService.batchUpsertCompositionPrices
await supabase.rpc('ingest_sinapi_composition_prices_batch', {
    p_price_table_id: priceTableId,
    p_prices: dedupedPrices
});
```

## 📝 LOGS ADICIONADOS

```
[SINAPI PARSER PRICES] aba=Analítico com Custo totalRows=XXXX
[SINAPI PARSER PRICES] aba=Analítico com Custo headerRow=X
[SINAPI PARSER PRICES] aba=Analítico com Custo headers=[...]
[SINAPI PARSER PRICES] Mapeamento: Code=[X|cod] Type=[Y|tipo] Price=[Z|valor]
[SINAPI PARSER PRICES] Results: 4836 input prices, 9669 composition prices, XX discarded

aba=Analítico com Custo Extraídos: 4836 preços de insumos, 9669 preços de composições.
aba=Analítico com Custo regime=DESONERADO: Input prices (before dedupe: 4836, after: 4836)
aba=Analítico com Custo regime=DESONERADO: Persistidos 4836 preços de insumos.
aba=Analítico com Custo regime=DESONERADO: Composition prices (before dedupe: 9669, after: 9669)
aba=Analítico com Custo regime=DESONERADO: Persistidos 9669 preços de composições.
aba=Analítico com Custo regime=NAO_DESONERADO: ... (mesma lógica)
```

## 📊 RESULTADO ESPERADO

Após re-importação:

```sql
-- Deve haver preços agora!
SELECT COUNT(*) FROM sinapi_input_prices;
-- Esperado: ~9672 (4836 x 2 regimes)

SELECT COUNT(*) FROM sinapi_composition_prices;
-- Esperado: ~19338 (9669 x 2 regimes)

-- Verificar preços reais
SELECT ip.*, i.description 
FROM sinapi_input_prices ip
JOIN sinapi_inputs i ON i.code = ip.input_code
LIMIT 10;

SELECT cp.*, c.description 
FROM sinapi_composition_prices cp
JOIN sinapi_compositions c ON c.code = cp.composition_code
LIMIT 10;
```

## 📋 ARQUIVOS MODIFICADOS

- ✅ `src/utils/sinapiIngestion.ts`:
  - Removido "Analítico com Custo" de `IGNORED_SHEETS`
  - Atualizado `identifySheetType` para reconhecer `type: 'prices'`
  - Adicionado `parsePricesSheet()` 
  - Adicionado `deduplicatePrices()`
  - Adicionado bloco de processamento de preços no fluxo

## 🧪 VALIDAÇÃO

1. **Rode a importão completa** (4 arquivos SINAPI)
2. **Verifique os logs** no console:
   - Procure por `[SINAPI PARSER PRICES]`
   - Confirme que a aba "Analítico com Custo" foi processada
   - Veja as contagens de preços extraídos
3. **Confirme no banco**:
   ```sql
   SELECT COUNT(*) FROM sinapi_input_prices;        -- > 0
   SELECT COUNT(*) FROM sinapi_composition_prices;  -- > 0
   ```

## 🚀 READY FOR TESTING

Build OK! Execute a importação e confirme que os preços foram populados! 🎉
