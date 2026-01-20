# SINAPI INGESTÃO ARQUIVO ÚNICO - IMPLEMENTAÇÃO COMPLETA

**Data:** 2026-01-19  
**Status:** ✅ BUILD OK - Pronto para uso

---

## 🎯 MUDANÇA PRINCIPAL

Migração de **múltiplos arquivos separados** para **arquivo único com múltiplas abas** (formato SINAPI 2025 oficial).

### ❌ ANTES (Formato Antigo):
- 3 arquivos diferentes:
  - `SINAPI_ref_Insumos_BA_01_2025.xlsx`
  - `SINAPI_Custo_Ref_Composicoes_Sintetico_BA_01_2025.xlsx`
  - `SINAPI_Custo_Ref_Composicoes_Analitico_BA_01_2025.xlsx`
- Regime indefinido na planilha
- Admin precisa colar 3 URLs

### ✅ DEPOIS (Formato 2025):
- **1 arquivo único**: `SINAPI_Referência_2025_01.xlsx`
- **Abas internas** com regime embutido:
  - **ISD** → Insumos Sem Desoneração → `NAO_DESONERADO`
  - **ICD** → Insumos Com Desoneração → `DESONERADO`
  - **CSD** → Composições Sem Desoneração → `NAO_DESONERADO`
  - **CCD** → Composições Com Desoneração → `DESONERADO`
  - **Analítico** → Estrutura das composições (neutro, vai para ambos)
- Admin cola **apenas 1 URL**
- Sistema detecta regime automaticamente

---

## 📁 ARQUIVOS MODIFICADOS

### 1. `src/utils/sinapiIngestion.ts` ✨ **REESCRITO COMPLETAMENTE**

#### Novo mapeamento de abas:
```typescript
const SHEET_MAPPING = {
    ISD: { type: 'inputs', regime: 'NAO_DESONERADO' },
    ICD: { type: 'inputs', regime: 'DESONERADO' },
    CSD: { type: 'compositions', regime: 'NAO_DESONERADO' },
    CCD: { type: 'compositions', regime: 'DESONERADO' },
    Analítico: { type: 'analytic', regime: null }, // Ambos regimes
};
```

#### Função principal:
```typescript
ingestSinapiReferencia(
    fileUrl: string,
    uf: string = 'BA',
    competence: string = '2025-01',
    onProgress?: (progress) => void
)
```

#### Logs obrigatórios implementados:
```javascript
console.log(`[SINAPI INGEST] aba=${aba} regime=${regime} uf=${uf} competencia=${comp} rows=${count}`);
```

#### Fluxo de processamento:
1. Download do arquivo único
2. Lê todas as abas do workbook
3. Para cada aba mapeada:
   - Detecta regime automaticamente
   - Parse dados (insumos ou composições)
   - Cria `sinapi_price_tables` para o regime específico
   - Upsert dados nas tabelas corretas
4. Aba "Analítico":
   - Salva itens para **AMBOS** os regimes (DESONERADO + NAO_DESONERADO)

---

### 2. `src/pages/SinapiImporter.tsx` ✨ **UI SIMPLIFICADA**

#### Mudanças no formulário:

**REMOVIDO:**
- Campo "URL Insumos"
- Campo "URL Composições Sintéticas"  
- Campo "URL Composições Analíticas"
- Checkboxes de regimes (não é mais necessário, detecta da aba)

**ADICIONADO:**
- 1 campo único: **URL do Arquivo SINAPI_Referência_2025_01.xlsx**
- Box informativo explicando a estrutura das abas
- Aviso visual "⚠️ NOVO FORMATO 2025"

#### Novo estado:
```typescript
const [referenciaUrl, setReferenciaUrl] = useState('');
```

#### Nova chamada de importação:
```typescript
ingestSinapiMonth(
    'BA',
    '2025-01',
    'DESONERADO', // Ignorado, detecta da aba
    { referenciaUrl } as any,
    onProgress
)
```

---

## 🔍 REGRAS IMPLEMENTADAS

### ✅ Detecção Automática de Regime
- Sistema lê nome da aba
- Mapeia para regime correto
- **NUNCA** usa fallback silencioso
- Cria tabelas separadas para cada regime

### ✅ Isolamento de Dados Mock
- Continua funcionando (`is_mock`, `source_tag`)
- Mantém controle mock no admin UI
- Filtragem padrão `is_mock = false`

### ✅ Link com Encargos Sociais
- Modal de encargos define `sinapiRegime` no budget
- Queries usam `budget.sinapiRegime` para filtrar dados
- **PROIBIDO** cruzar regimes

### ✅ Validação Obrigatória
```typescript
const validation = await SinapiService.validateBaseForBudget(uf, competence, regime);
if (!validation.valid) {
    alert(validation.message); // "Base SINAPI não encontrada para BA/2025-01/Desonerado"
}
```

---

## 📊 EXEMPLO DE USO

### Passo 1: Baixar arquivo oficial
```
Site CAIXA → Downloads → SINAPI_Referência_2025_01.xlsx
```

### Passo 2: Hospedar em URL pública
```
Google Drive / Dropbox / Servidor próprio
Obter link direto: https://exemplo.com/SINAPI_Referência_2025_01.xlsx
```

### Passo 3: Importar no sistema
1. Acessar `/sinapi` no app
2. Cole a URL no campo único
3. Clique em "Iniciar Importação"

### Passo 4: Acompanhar logs
```
[SINAPI INGEST] aba=ISD regime=NAO_DESONERADO uf=BA competencia=2025-01 rows=4523
[SINAPI INGEST] aba=ICD regime=DESONERADO uf=BA competencia=2025-01 rows=4523
[SINAPI INGEST] aba=CSD regime=NAO_DESONERADO uf=BA competencia=2025-01 rows=8342
[SINAPI INGEST] aba=CCD regime=DESONERADO uf=BA competencia=2025-01 rows=8342
[SINAPI INGEST] aba=Analítico regime=null uf=BA competencia=2025-01 rows=125389
```

### Resultado no banco:
```sql
-- Tabelas criadas automaticamente
sinapi_price_tables:
  - id=uuid1, uf=BA, competence=2025-01, regime=NAO_DESONERADO, is_mock=false
  - id=uuid2, uf=BA, competence=2025-01, regime=DESONERADO, is_mock=false

-- Insumos
sinapi_inputs: 4523 registros (compartilhados)
sinapi_input_prices: 4523 para NAO_DESONERADO + 4523 para DESONERADO

-- Composições
sinapi_compositions: 8342 registros (compartilhados)
sinapi_composition_prices: 8342 para NAO_DESONERADO + 8342 para DESONERADO

-- Itens de composição
sinapi_composition_items: 125389 para cada regime (total ~250k)
```

---

## 🔐 QUERIES DE VALIDAÇÃO

### 1. Verificar se base foi importada:
```sql
SELECT * FROM sinapi_price_tables 
WHERE uf = 'BA' 
  AND competence = '2025-01' 
  AND is_mock = false;
-- Deve retornar 2 registros (DESONERADO + NAO_DESONERADO)
```

### 2. Verificar preços de insumo:
```sql
SELECT i.code, i.description, ip.price, pt.regime
FROM sinapi_inputs i
JOIN sinapi_input_prices ip ON i.code = ip.input_code
JOIN sinapi_price_tables pt ON ip.price_table_id = pt.id
WHERE i.code = '88315' -- Exemplo: Cimento CP-II
  AND pt.uf = 'BA'
  AND pt.competence = '2025-01'
  AND pt.is_mock = false;
-- Deve retornar 2 preços (1 por regime)
```

### 3. Verificar composição com itens:
```sql
SELECT 
    c.code,
    c.description,
    cp.price,
    pt.regime,
    COUNT(ci.id) as total_items
FROM sinapi_compositions c
JOIN sinapi_composition_prices cp ON c.code = cp.composition_code
JOIN sinapi_price_tables pt ON cp.price_table_id = pt.id
LEFT JOIN sinapi_composition_items ci ON c.code = ci.composition_code AND ci.price_table_id = pt.id
WHERE c.code = '74209/001' -- Exemplo: Alvenaria
  AND pt.uf = 'BA'
  AND pt.competence = '2025-01'
GROUP BY c.code, c.description, cp.price, pt.regime;
```

---

## ⚠️ ABAS IGNORADAS (Correto)

O sistema **IGNORA** as seguintes abas (não são necessárias):
- Menu
- Busca
- ISE (Insumos com Encargos - calculado internamente)
- CSE (Composições com Encargos - calculado internamente)
- Analítico com Custo (redundante, calculamos a partir do Analítico)

---

## 🚀 STATUS FINAL

- ✅ **Build:** Sucesso (10.56s)
- ✅ **TypeScript:** Sem erros críticos
- ✅ **Lógica:** Implementada conforme especificação
- ✅ **Logs:** Implementados `[SINAPI INGEST]`
- ✅ **UI:** Simplificada (1 campo)
- ✅ **Compatibilidade:** Mantém interface antiga para não quebrar

---

## 📝 PRÓXIMOS PASSOS OPERACIONAIS

1. ✅ Executar migrations SQL (já criadas)
2. ⏳ Baixar `SINAPI_Referência_2025_01.xlsx` do site CAIXA
3. ⏳ Hospedar arquivo em URL acessível
4. ⏳ Importar via UI `/sinapi`
5. ⏳ Validar com queries acima
6. ⏳ Testar orçamento com encargos DESONERADO
7. ⏳ Testar orçamento com encargos NAO_DESONERADO
8. ⏳ Marcar bases antigas como mock (se existirem)

---

## 🎓 APRENDIZADOS TÉCNICOS

### Como o sistema detecta regime?
```typescript
// 1. Lê nome da aba do Excel
const sheetName = 'ICD';  // Exemplo

// 2. Consulta mapeamento
const mapping = SHEET_MAPPING[sheetName];
// mapping = { type: 'inputs', regime: 'DESONERADO' }

// 3. Cria tabela de preço específica
const priceTable = await SinapiService.upsertPriceTable({
    uf: 'BA',
    competence: '2025-01',
    regime: 'DESONERADO',  // ← Definido automaticamente
    ...
});
```

### Como o orçamento usa o regime certo?
```typescript
// 1. Usuário aplica encargos no modal
handleUpdateEncargos(87.25, { desonerado: true, id: 'sinapi-desonerado' });

// 2. Budget é atualizado
budget.sinapiRegime = 'DESONERADO';  // ← Salvo no banco

// 3. Queries filtram automaticamente
const inputs = await SinapiService.searchInputs(query, {
    uf: budget.sinapiUf,            // 'BA'
    competence: budget.sinapiCompetence,  // '2025-01'
    regime: budget.sinapiRegime     // 'DESONERADO' ← Filtro obrigatório
});
```

---

**FIM DO RESUMO**
