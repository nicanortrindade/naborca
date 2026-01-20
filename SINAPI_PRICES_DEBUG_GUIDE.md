# SINAPI PRICES - NEXT STEPS (DEBUGGING REQUIRED)

**Status:** ✅ Build OK, pero preços ainda em 0  
**Data:** 2026-01-19

## 🔍 SITUAÇÃO ATUAL

**Estrutura SINAPI:**
```
✅ sinapi_inputs              = 4,836
✅ sinapi_compositions        = 9,669
✅ sinapi_composition_items   = 137,061
```

**Preços:**
```
❌ sinapi_input_prices        = 0
❌ sinapi_composition_prices  = 0
```

## 📦 O QUE FOI IMPLEMENTADO

1. **Detecção da aba de preços** ✅
   - Aba "Analítico com Custo" agora é reconhecida como `type: 'prices'`
   - Não é mais ignorada

2. **Parser `parsePricesSheet`** ✅
   - Extrai códigos de insumos e composições
   - Extrai preços unitários
   - Classifica items por tipo

3. **Integração no fluxo** ✅
   - Bloco `else if (mapping.type === 'prices')` no `ingestSinapiFromFile`
   - Deduplicação antes de persistir
   - Persistência via RPC

4. **Build** ✅ OK

## 🐛 PRÓXIMO PASSO: DEBUGGING

O parser está integrado mas precisa de ajustes. **Rode a importação e compartilhe os logs do console:**

### Logs Esperados

```
[PRICE] Using sheet: "Analítico com Custo"
[PRICE] totalRows=XXXX
[PRICE] headerRowIndex=X
[PRICE] headers(normalized)=[...]
[PRICE] mappedCols: comp_code=[X,xxx] item_code=[Y,yyy] item_type=[Z,zzz] price=[W,www]
[PRICE] Results: X input prices, Y composition prices, Z discarded
```

###Logs de Diagnóstico (se falhar)

Se `price=[- 1,]` (não encontrou coluna):
```
[PRICE] Could not locate price column!
[PRICE] First 20 columns: [...]
[PRICE] Sample rows: [...]
```

Se `Results: 0 input prices, 0 composition prices`:
- Parser encontrou header mas não conseguiu extrair dados
- Problema na lógica de classificação ou validação

## 🔧 AJUSTES POSSÍVEIS (BASEADOS NOS LOGS)

Dependendo do output:

### Cenário 1: Coluna de preço não encontrada
**Log**: `price=[-1,]`

**Ação**: 
- Ver o header real nos logs `First 20 columns`
- Adicionar alias correspondente em `priceAliases`

### Cenário 2: Dados não extraídos (Results =  0)
**Log**: `Results: 0 input prices, 0 composition prices, XXXX discarded`

**Possíveis causas:**
- `price <= 0` para todas as linhas → verificar se `parseNumber` está funcionando
- `code.length < 3` → validação muito restritiva
- Lógica de classificação errada → `itemType` não bate

**Ação**:
- Adicionar log intermediário mostrando samples de linhas descartadas
- Relaxar validação temporariamente para debug

### Cenário 3: Aba não processada
**Log**: Não aparece `[PRICE]` nos logs

**Ação**:
- Verificar se `identifySheetType` está retornando `type: 'prices'` para a aba
- Confirmar que a aba existe no arquivo

## 📝 COMO PROCEDER

1. **Rode a importação** SINAPI completa
2. **Abra F12** (Developer Tools → Console)
3. **Procure por `[PRICE]`** nos logs
4. **Copie TODOS os logs** que começam com `[PRICE]`
5. **Compartilhe aqui** para análise

## 🎯 OBJETIVO

Após ajustes baseados nos logs:
```sql
SELECT COUNT(*) FROM sinapi_input_prices;        -- > 0
SELECT COUNT(*) FROM sinapi_composition_prices;  -- > 0
```

---

**Aguardando logs do console para próximo passo!** 🚀
