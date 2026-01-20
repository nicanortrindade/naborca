# SINAPI IMPORT FIX - RESUMO FINAL DAS CORREÇÕES

**Data:** 2026-01-19  
**Status:** ✅ BUILD OK

---

## 🔧 ALTERAÇÕES REALIZADAS

### 1. `findColumnIndex` - MATCHING POR TOKEN (NÃO SUBSTRING)

**Problema:** Aliases curtos como "um", "item" causavam falsos positivos via `includes()`.

**Solução Implementada:**
```typescript
function findColumnIndex(headers, aliases, mustNotInclude) {
    // PASS 1: Igualdade exata do header inteiro
    for (header of headers) {
        const exactMatch = aliases.find(alias => header === alias);
        if (exactMatch) return { index, match };
    }

    // PASS 2: Match por token (só para aliases > 2 chars)
    for (header of headers) {
        const tokens = header.split(' ');
        for (alias of aliases) {
            if (alias.length <= 2) continue; // Curtos: só exato!
            
            const aliasTokens = alias.split(' ');
            const allMatch = aliasTokens.every(tok => tokens.includes(tok));
            if (allMatch) return { index, match };
        }
    }
}
```

**Regras:**
- Aliases curtos (≤2 chars): Só match por igualdade EXATA
- Aliases longos: Igualdade exata OU todos os tokens presentes
- Prioridade: exato > tokens

---

### 2. `findUfPriceColumn` - PREÇO POR UF (ISD/ICD)

**Problema:** Parser usava aliases genéricos como "preco" que pegavam "origem de preco" em vez da coluna "BA".

**Solução:**
```typescript
function findUfPriceColumn(headers: string[], uf: string): { index: number; match: string } {
    const normalizedUf = uf.toLowerCase().trim();
    const normalized = headers.map(h => normalizeHeader(h));
    
    for (let i = 0; i < normalized.length; i++) {
        if (normalized[i] === normalizedUf) {
            return { index: i, match: uf };
        }
    }
    return { index: -1, match: '' };
}
```

**Uso no `parseInputSheet`:**
```typescript
function parseInputSheet(sheet, sheetName, uf = 'BA') {
    // ...
    const priceCol = findUfPriceColumn(headers, uf);
    // Log: Price=[7|BA] (UF=BA)
}
```

---

### 3. ALIASES CORRIGIDOS

**Antes (problemáticos):**
```typescript
const unitAliases = ['un', 'und', 'unidade', 'unid', 'um']; // "um" → falso positivo!
const codeAliases = ['codigo', 'cod', 'item', 'insumo']; // "item" pegava "tipo item"!
```

**Depois (seguros):**
```typescript
// ISD/ICD
const codeAliases = ['codigo', 'codigo do insumo', 'codigo insumo'];
const descAliases = ['descricao', 'denominacao', 'descricao do insumo'];
const unitAliases = ['unidade']; // Só esse!

// Analítico com Custo (Preços)
const itemCodeAliases = ['codigo do item', 'codigo item', 'codigo do insumo'];
const compCodeAliases = ['codigo da composicao', 'codigo composicao'];
const typeAliases = ['tipo item', 'tipo de item'];
const priceAliases = ['custo unit', 'custo unitario', 'custo total', 'valor unit'];
```

---

### 4. SinapiService - FALLBACKS REMOVIDOS + CONTAGEM CORRIGIDA

**Problema:** 
- RPCs podem retornar `void` (204) em vez de contagem
- Fallbacks tentavam upsert direto e falhavam por RLS

**Solução:**
```typescript
async batchUpsertInputPrices(priceTableId, prices): Promise<number> {
    if (prices.length === 0) return 0;
    
    for (chunk of chunks) {
        const { data, error } = await supabase.rpc('ingest_sinapi_input_prices_batch', {...});

        if (error) {
            console.error('[SINAPI SERVICE] RPC Error:', error);
            throw new Error(`RPC falhou: ${error.message}`);
            // SEM FALLBACK!
        } else {
            // Se retornar número, usar; senão, assumir chunk.length
            const count = typeof data === 'number' ? data : chunk.length;
            successCount += count;
        }
    }
    console.log(`[SINAPI SERVICE] Persistidos ${successCount} de ${prices.length}`);
    return successCount;
}
```

**Funções corrigidas:**
- `batchUpsertInputs`
- `batchUpsertInputPrices`
- `batchUpsertCompositions`
- `batchUpsertCompositionPrices`

---

## 📋 LOGS ESPERADOS APÓS FIX

### ISD (Insumos Sem Desoneração):
```
[SINAPI PARSER] aba=ISD totalRows=15000 uf=BA
[SINAPI PARSER] aba=ISD headerRow=3
[SINAPI PARSER] aba=ISD headers=["codigo","descricao","unidade","origem de preco","ac","al","am","ap","ba",...]
[SINAPI PARSER] aba=ISD Mapeamento: Code=[0|codigo] Desc=[1|descricao] Unit=[2|unidade] Price=[8|BA] (UF=BA)
```

### Analítico com Custo (Preços):
```
[PRICE] aba=Analítico com Custo totalRows=150000
[PRICE] headerRowIndex=4
[PRICE] headers(normalized)=["tipo item","codigo da composicao","descricao da composicao","unidade","codigo do item","descricao do item","unidade","coeficiente","custo unit","custo total"]
[PRICE] mappedCols: item_code=[4,codigo do item] comp_code=[1,codigo da composicao] type=[0,tipo item] price=[8,custo unit]
[PRICE] Results: 4836 input prices, 9669 composition prices, 0 discarded
[PRICE] Sample input: {code: "00000001", price: 15.50}
```

### SinapiService:
```
[SINAPI SERVICE] upsertPriceTable: source=SINAPI uf=BA competencia=2025-01 regime=DESONERADO is_mock=false
[SINAPI SERVICE] Price table criada/atualizada: id=abc-123
[SINAPI SERVICE] batchUpsertInputPrices: 4836 de 4836 preços persistidos
[SINAPI SERVICE] batchUpsertCompositionPrices: 9669 de 9669 preços persistidos
```

---

## ✅ RESULTADO ESPERADO

Após importação:
```sql
SELECT COUNT(*) FROM sinapi_inputs;              -- ~4836
SELECT COUNT(*) FROM sinapi_compositions;        -- ~9669
SELECT COUNT(*) FROM sinapi_composition_items;   -- ~137000
SELECT COUNT(*) FROM sinapi_input_prices;        -- ~9672 (2 regimes)
SELECT COUNT(*) FROM sinapi_composition_prices;  -- ~19338 (2 regimes)
```

---

## 📌 ARQUIVOS MODIFICADOS

1. **`src/utils/sinapiIngestion.ts`**
   - `findColumnIndex` → Token-based matching
   - `findUfPriceColumn` → Nova função para UF
   - `parseInputSheet` → Usa UF para preço
   - `parsePricesSheet` → Aliases corrigidos

2. **`src/lib/supabase-services/SinapiService.ts`**
   - `upsertPriceTable` → p_competencia, p_source
   - Todas as funções `batchUpsert*` → Fallback removido + contagem corrigida

3. **`sinapi_secure_rpc.sql`**
   - `ingest_sinapi_price_table` → p_source, p_competencia

---

## 🚀 PRÓXIMO PASSO

1. **Executar SQL atualizado no Supabase:**
   ```sql
   -- Cole o conteúdo de sinapi_secure_rpc.sql no SQL Editor
   ```

2. **Rodar importação e verificar logs:**
   - Procurar por `[SINAPI PARSER]` e `[PRICE]`
   - Confirmar mapeamento correto
   - Verificar contagens no banco

**Build:** ✅ OK  
**Status:** PRONTO PARA TESTE 🎯
