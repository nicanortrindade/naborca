# SINAPI HEADER DETECTION FIX - IMPLEMENTADO

**Data:** 2026-01-19  
**Status:** ✅ IMPLEMENTADO & BUILD OK

## 🔍 PROBLEMA IDENTIFICADO

O parser estava retornando "0 linhas" para TODAS as abas (ISD, ICD, CSD, CCD, Analítico) porque:
- A lógica de detecção de cabeçalho estava **rígida demais** (procurava apenas nas primeiras 30 linhas com strings fixas).
- Não havia **normalização agressiva** (acentos, pontuação, espaços).
- Os **aliases de colunas eram limitados** e não cobriam todas as variações do SINAPI real.

## ✅ SOLUÇÃO IMPLEMENTADA

### 1. **Header Detection com Scoring**
Implementei `findHeaderRow(data, keyAliases)` que:
- Varre as **primeiras 50 linhas** (não mais 30).
- Normaliza TODAS as células da linha (`normalize('NFD')`, remove acentos, pontuação).
- Pontua cada linha baseado em **quantas colunas-chave** ela contém.
- Escolhe a linha com **maior score** (mínimo 2 colunas-chave).

### 2. **Normalização Robusta**
Função `normalizeHeader(text)` que:
- Remove acentos (`á` → `a`).
- Remove pontuação (`Cód.` → `cod`).
- Lowercase total.
- Colapsa espaços múltiplos.

### 3. **Aliases Expandidos**

**Para Insumos (ISD/ICD):**
```typescript
codigo: ['codigo', 'cod', 'item', 'insumo']
descricao: ['descricao', 'denominacao', 'nome', 'especificacao']
unidade: ['un', 'und', 'unidade', 'unid', 'um']
preco: ['preco', 'valor', 'custo', 'preco unitario', 'valor total']
```

**Para Composições (CSD/CCD):**
```typescript
codigo: ['codigo da composicao', 'cod composicao', 'codigo', 'composicao']
preco: ['custo total', 'custo unitario', 'custo', 'valor total', 'valor', 'total']
```

**Para Analítico:**
```typescript
comp_code: ['codigo da composicao', 'cod composicao']
item_code: ['codigo do item', 'codigo item', 'item', 'insumo']
coeficiente: ['coeficiente', 'coef', 'quantidade', 'qtde']
tipo: ['tipo item', 'tipo de item', 'tipo']
```

### 4. **Diagnóstico Completo**

Agora o console mostra:
```
[SINAPI PARSER] aba=ISD headerRow=5
[SINAPI PARSER] aba=ISD headers=["codigo", "descricao", "unidade", "valor"]
[SINAPI PARSER] aba=ISD Mapeamento: Code=[0|codigo] Desc=[1|descricao] Price=[3|valor]
[SINAPI PARSER] aba=ISD Results: parsed=9608 discarded=42
[SINAPI PARSER] aba=ISD Discard reasons: {codigo_vazio: 30, descricao_vazia: 12}
[SINAPI PARSER] aba=ISD Sample: {code:"1234", description:"...", price:15.50}
```

Se falhar:
```
[SINAPI PARSER] aba=XYZ ERRO: Header não encontrado nas primeiras 50 linhas
[SINAPI PARSER] aba=XYZ Sample (primeiras 5 linhas): [...]
```

## 🧪 COMO VALIDAR

1. Rode a importação SINAPI completa (4 arquivos).
2. Abra o Console do navegador (F12).
3. Procure pelos logs `[SINAPI PARSER]`.
4. Confirme que:
   - `headerRow` aparece com número válido (ex: 3, 4, 5...).
   - `headers` mostra os nomes normalizados.
   - `Mapeamento` mostra índices >= 0 para colunas críticas.
   - `Results: parsed=XXXX` mostra contagem > 0.
   - `Sample` mostra um exemplo real de dado parseado.

5. Confirme as contagens finais no banco:
   - `sinapi_inputs` ≈ 9608
   - `sinapi_compositions` ≈ 9668  
   - `sinapi_composition_items` ≈ 104068
   - `sinapi_input_prices` > 0 (NOVO!)
   - `sinapi_composition_prices` > 0 (NOVO!)

## 📋 ARQUIVOS MODIFICADOS

- `src/utils/sinapiIngestion.ts`
  - Adicionado: `normalizeHeader()`, `findHeaderRow()`
  - Refatorado: `findColumnIndex()` (agora com normalização)
  - Refatorado: `parse InputSheet()`, `parseCompositionSheet()`, `parseAnalyticSheet()`
  
## 🚀 PRÓXIMO PASSO

Execute a importação e compartilhe os logs do console para confirmar que tudo está funcionando!
