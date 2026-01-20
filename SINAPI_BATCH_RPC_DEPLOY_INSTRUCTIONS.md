# SINAPI BATCH RPCs - INSTRUÇÕES DE DEPLOY

## 📋 RESUMO DAS CORREÇÕES

### **Problema:**
- RPCs retornavam `void` (204 No Content)
- Frontend assumia `0` quando data era null/undefined
- UI mostrava "0 itens CPU" mesmo com 68k+ registros no banco

### **Solução:**
1. **SQL:** RPCs agora retornam `INTEGER` (contagem real de linhas)
2. **TypeScript:** Funções batch assumem `chunk.length` quando RPC retorna void/null

---

## 🔧 PARTE 1: EXECUTAR SQL NO SUPABASE

### **Arquivo:** `sinapi_batch_rpcs_fixed.sql`

### **Instruções:**

1. Abra o **Supabase Dashboard** → SQL Editor
2. Cole o conteúdo completo de `sinapi_batch_rpcs_fixed.sql`
3. Execute (Run)

### **O que o SQL faz:**

1. **DROP** das funções antigas (evita erro 42P13 "cannot change return type")
2. **CREATE** novas versões retornando `INTEGER`:
   - `ingest_sinapi_inputs_batch` → retorna contagem de inputs inseridos/atualizados
   - `ingest_sinapi_input_prices_batch` → retorna contagem de preços de inputs
   - `ingest_sinapi_compositions_batch` → retorna contagem de composições
   - `ingest_sinapi_composition_prices_batch` → retorna contagem de preços de composições
   - `ingest_sinapi_composition_items_batch` → retorna contagem de items (relacionamentos)

3. **GRANT EXECUTE** para `authenticated` role

### **Verificação (opcional):**

Após executar o SQL, rode:
```sql
SELECT routine_name, data_type 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name LIKE 'ingest_sinapi%batch'
ORDER BY routine_name;
```

**Resultado esperado:**
Todas as funções devem ter `data_type = 'integer'`

---

## 💻 PARTE 2: DEPLOY DO FRONTEND

### **Arquivos Modificados:**

- `src/lib/supabase-services/SinapiService.ts`

### **Alterações:**

#### **1. `batchUpsertInputPrices` e `batchUpsertCompositionPrices`:**
```typescript
// Converte input_code/composition_code para 'code' (formato esperado pela RPC)
const formattedPrices = prices.map(p => ({
    code: p.input_code, // ou p.composition_code
    price: p.price
}));

// Logs detalhados
console.log('[SINAPI SERVICE] batchUpsertInputPrices payload', {
    priceTableId,
    count: formattedPrices.length,
    sample: formattedPrices[0]
});

// Assume chunk.length se RPC retornar void/null
const count = typeof data === 'number' && data !== null ? data : chunk.length;
```

#### **2. `batchUpsertCompositionItems`:**
```typescript
// Removido fallback (que causava duplicação)
// Adicionados logs por chunk
// Assume chunk.length se RPC retornar void/null
```

#### **3. `batchUpsertCompositions`:**
```typescript
// Assume chunk.length se RPC retornar void/null
```

### **Deploy:**

```bash
npm run build
# Deploy para produção (ex: Vercel, Netlify, etc.)
```

---

## 📊 PARTE 3: LOGS ESPERADOS APÓS DEPLOY

### **Durante Importação SINAPI:**

```
[SINAPI SERVICE] upsertPriceTable: source=SINAPI uf=BA competencia=2025-01 regime=DESONERADO is_mock=false
[SINAPI SERVICE] Price table criada/atualizada: id=abc-123-def

[SINAPI SERVICE] batchUpsertInputs: 4834 de 4834 inputs persistidos

[SINAPI SERVICE] batchUpsertInputPrices payload {priceTableId: "abc...", count: 4834, sample: {code: "00001", price: 15.5}}
[SINAPI SERVICE] batchUpsertInputPrices OK {count: 4834}

[SINAPI SERVICE] batchUpsertCompositions OK - Total: 9669

[SINAPI SERVICE] Composition Items - Before dedupe: 137061, After: 68530, Duplicates removed: 68531
[SINAPI SERVICE] batchUpsertCompositionItems chunk 1 {count: 1000, sample: {...}}
[SINAPI SERVICE] Chunk persisted OK, count: 1000
[SINAPI SERVICE] batchUpsertCompositionItems chunk 2 {count: 1000, sample: {...}}
[SINAPI SERVICE] Chunk persisted OK, count: 1000
...
[SINAPI SERVICE] batchUpsertCompositionItems OK - Total: 68530 (from 137061 original, 68530 after dedupe)

[SINAPI SERVICE] batchUpsertCompositionPrices payload {priceTableId: "abc...", count: 9669, sample: {code: "87000", price: 250}}
[SINAPI SERVICE] batchUpsertCompositionPrices OK {count: 9669}
```

### **Na UI:**

Antes:
```
✅ Inputs: 4834
✅ Input Prices: 4834
✅ Composições: 9669
❌ Itens CPU: 0 <-- ERRADO!
✅ Composition Prices: 9669
```

Depois:
```
✅ Inputs: 4834
✅ Input Prices: 4834
✅ Composições: 9669
✅ Itens CPU: 68530 <-- CORRETO!
✅ Composition Prices: 9669
```

---

## ✅ VERIFICAÇÃO NO BANCO

Após importação, verifique:

```sql
-- Deve haver dados
SELECT COUNT(*) FROM sinapi_inputs;              -- ~4834
SELECT COUNT(*) FROM sinapi_input_prices;        -- ~9668 (2 regimes)
SELECT COUNT(*) FROM sinapi_compositions;        -- ~9669
SELECT COUNT(*) FROM sinapi_composition_items;   -- ~68530+
SELECT COUNT(*) FROM sinapi_composition_prices;  -- ~19338 (2 regimes)

-- Verificar contagem por price_table
SELECT 
    spt.uf,
    spt.competence,
    spt.regime,
    COUNT(DISTINCT sci.composition_code) as compositions_count,
    COUNT(*) as items_count
FROM sinapi_price_tables spt
LEFT JOIN sinapi_composition_items sci ON sci.price_table_id = spt.id
WHERE spt.uf = 'BA' AND spt.competence = '2025-01'
GROUP BY spt.id, spt.uf, spt.competence, spt.regime
ORDER BY spt.regime;
```

**Resultado esperado:**
Cada regime deve ter ~68k+ items

---

## 🚨 ERROS QUE DEVEM DESAPARECER

### ❌ Antes:
```
POST /rpc/ingest_sinapi_input_prices_batch → 404/42883
function public.ingest_sinapi_input_prices(uuid, jsonb) does not exist
```

### ✅ Depois:
```
POST /rpc/ingest_sinapi_input_prices_batch → 200 OK
data: 1000 (contagem real)
```

---

## 📝 CHECKLIST FINAL

- [ ] SQL executado no Supabase (todas as funções retornam INTEGER)
- [ ] Frontend deployado com novo build
- [ ] Importação SINAPI rodada com sucesso
- [ ] Logs mostram contagens corretas
- [ ] UI exibe números > 0 para todos os itens
- [ ] Verificação no banco confirma dados persistidos

---

**Status:** ✅ Pronto para deploy!  
**Build TypeScript:** ✅ OK  
**SQL:** ✅ Criado (`sinapi_batch_rpcs_fixed.sql`)
