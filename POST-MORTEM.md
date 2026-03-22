# Post-Mortem: O Mistério do M2 e a Guerra dos Regex

**Data do incidente:** 19-22 Março 2026
**Severidade:** Alta (dados corrompidos em produção)
**Duração:** ~3 dias de investigação e correção
**Responsável:** Nicanor Trindade

---

## O que aconteceu

Durante a importação OCR de orçamentos de obras (PDF → Gemini → Supabase), as
unidades "M2" e "M3" estavam sendo corrompidas. O pipeline extraía corretamente
"M2" do PDF, mas no resultado final apareciam como "M | 2" ou "M" sozinho,
quebrando a integridade dos dados.

## Causa raiz

Duas funções de normalização de texto conflitavam entre si:

1. **`normalizeOcrUnits()`** (stageB_llm.ts) — Convertia "M | 2" → "M2"
   (corrigindo artefatos do OCR)
2. **`normalizeColumnSpacing()`** (index.ts) — Aplicava regex que inseria
   pipes entre letras e números, convertendo "M2" de volta para "M | 2"

A ordem de execução era: normalizeOcrUnits → normalizeColumnSpacing. Ou seja,
a primeira função corrigia o problema, e a segunda desfazia a correção.

### Diagrama do conflito

```
PDF: "M2" → OCR: "M 2" ou "M | 2" → normalizeOcrUnits(): "M2" ✓ (corrigido!) → normalizeColumnSpacing(): "M | 2" ✗ (re-corrompido!) → Gemini recebe: "M | 2" → Extrai unit: "M" (perdeu o "2")
```

## Por que demorou 3 dias

1. **Testávamos em produção** — sem ambiente local, cada teste exigia uma
   importação completa (~15 min), e erros só apareciam no final
2. **Corrigíamos uma função e quebrávamos outra** — ciclo de "fix A breaks B,
   fix B breaks A" sem testes isolados
3. **Não tínhamos baseline documentada** — sem saber o resultado esperado
   (237 itens, R$ 2.800.000), não sabíamos se as mudanças melhoravam ou
   pioravam
4. **Múltiplas camadas de regex** — o texto passava por 5+ transformações
   antes de chegar ao Gemini, e qualquer uma podia re-corromper

## Como foi resolvido

1. Adicionado regex de proteção em `normalizeOcrUnits()` que converte
   "M | 2" → "M2" e "M | 3" → "M3" (commit 7f7646e)
2. Adicionado tratamento em stageB para unidades com pipe (commit e175b5b)
3. Adicionado regex final que impede re-inserção do pipe após M2/M3
   (commit 69ff6e1)
4. Lock duration aumentado de 300s para 900s para evitar timeout em jobs
   grandes

## Lições aprendidas — REGRAS INVIOLÁVEIS

### 1. NUNCA testar em produção
Montar ambiente Docker + Supabase local. Toda correção é testada localmente
antes de ir para produção. Sem exceções.

### 2. NUNCA corrigir regex sem entender o fluxo completo
Antes de mexer em qualquer regex de normalização, mapear TODAS as funções
que transformam o texto, na ordem exata de execução. Documentar o fluxo:

```
PDF → OCR text → normalizeOcrUnits → normalizeColumnSpacing → chunking → Gemini prompt → stageB post-processing → crossSectionSeen dedup → DB insert → finalize_import_to_budget → budget_items
```

### 3. SEMPRE ter uma baseline documentada
Antes de qualquer mudança, registrar: número de itens esperados, valor total,
distribuição de unidades. Comparar após cada mudança.

### 4. SEMPRE commitar incrementalmente
Um fix = um commit = um teste. Se quebrou, revert daquele commit específico.
Nunca acumular 5 mudanças num commit só.

### 5. Branch de desenvolvimento obrigatória
Correções vão em branch separada (ex: fix/pipeline-v7). Master é sagrada.
Só recebe código testado e validado.

### 6. Atenção especial a funções que processam o mesmo texto em sequência
Qualquer pipeline de transformação de texto (regex chains) é terreno minado.
Cada função precisa ter testes unitários que verificam que ela não desfaz
o trabalho da função anterior.

### 7. Na deduplicação, preservar o item mais completo
Quando dois itens são detectados como duplicatas, NÃO assumir que o primeiro
é o correto. Comparar as descriptions e manter o mais completo. Exemplo real:
o barracão 74210/1 do Utinga — o idx 3 (chunk 0) tinha descrição sem referência,
o idx 483 (chunk 12) tinha "(ADAPTADA DA SINAPI 11/2015)" no início. O item
mais completo (483) foi o removido. A lógica de dedup deve comparar comprimento
e conteúdo, não apenas ordem de inserção.

---

## Bugs confirmados pendentes de correção

| # | Bug | Impacto | Arquivo | Prioridade |
|---|-----|---------|---------|------------|
| 1 | crossSectionSeen remove itens legítimos em seções diferentes | R$ 9.232 (Araci) — 1 item perdido | index.ts ~linha 1064 | Alta |
| 2 | Sufixo _ADP-01 truncado nos códigos | Cosmético (13 itens Utinga) | stageB_llm.ts ou index.ts | Média |
| 3 | Barra em código "74210/1" perdida | Cosmético (1 item Utinga) | stageB_llm.ts ou index.ts | Média |
| 4 | Fonte "Composição" → "Próprio" | Cosmético | finalize function ou stageB | Média |
| 5 | Unidade "CM" em vez de "M" (item 16.1.13 Araci) | Cosmético | OCR/Gemini extraction | Baixa |
| 6 | Seção 6 Araci sem nome ("SEÇÃO" genérico) | Cosmético | Gemini chunk 0 extraction | Baixa |
| 7 | Chunk 12 repete itens de chunks anteriores | Performance (tokens desperdiçados) | index.ts chunking logic | Baixa |
| 8 | Dedup preserva item menos completo (descrição truncada) | Qualidade de dados | index.ts dedup logic | Média |

---

## Validação final (22 Março 2026)

| Orçamento | Itens | Valor Original | Valor Importado | Diferença | Acurácia |
|-----------|-------|----------------|-----------------|-----------|----------|
| Utinga (20 casas) | 237 | R$ 2.800.000,00 | R$ 2.800.000,12 | +R$ 0,12 | 99,999996% |
| Araci (Centro Conv.) | 404 | R$ 2.830.351,75 | R$ 2.821.283,38 | -R$ 9.068,37 | 99,68% |

### Detalhamento Utinga
- 0 itens faltando, 0 duplicados, 0 erros de unidade/quantidade/preço
- Todas as ~70 diferenças são de centavos (arredondamento BDI 21,59%)
- 13 códigos com sufixo _ADP-01 truncado (cosmético)
- Hierarquia e nomes de seções 100% corretos

### Detalhamento Araci
- 1 item faltando: CPU2634 (ELETRODUTO GALVANIZADO, 16.2.9) — R$ 9.232
- 1 unidade errada: item 16.1.13 "CM" → deveria ser "M"
- 1 seção sem nome: seção 6 "IMPERMEABILIZAÇÃO"
- BDI original da prefeitura tem erros de cálculo no sem-BDI;
  valor confiável é total com BDI
- BDI de equipamento (13,51%) nunca foi aplicado na planilha original

---

## Fluxo de trabalho obrigatório para próximas correções

### Fase 1 — Estabilizar e documentar
Confirmar baseline (itens, valor, unidades). Criar post-mortem se houve incidente.

### Fase 2 — Congelar produção
Código em produção é intocável. Nenhuma mudança direta na master.

### Fase 3 — Montar ambiente de desenvolvimento local
Docker + `npx supabase start` para Supabase local completo (banco, auth,
storage, edge functions). Cópia isolada onde pode quebrar tudo sem afetar
o site real.

### Fase 4 — Criar branch de desenvolvimento
Branch `fix/pipeline-v7` (ou nome descritivo) a partir do commit atual.
Todas as correções nessa branch, nunca direto na master.

### Fase 5 — Aplicar correções uma por uma com testes
Cada correção = 1 commit isolado. Após cada commit, rodar Utinga no
ambiente local e validar contra a baseline. Se passou, avança. Se quebrou,
`git revert` daquele commit. Ordem sugerida:
1. Fix crossSectionSeen (incluir item_path na chave de dedup)
2. Fix sufixo _ADP-01 no parser
3. Fix barra em códigos (74210/1)
4. Fix mapeamento "Composição" → preservar fonte original
5. Fix dedup: preservar item com descrição mais completa
6. Fix chunking overlap (chunk 12)

### Fase 6 — Teste de regressão cruzada
Utinga E Araci devem passar simultaneamente no ambiente local.
Se um passa e o outro quebra, a correção não está pronta.

### Fase 6.5 — Teste de performance e stress
Rodar um PDF grande (400+ itens, como o Araci) e medir:
- Tempo total de importação (baseline atual: ~12-16 min para 24 lotes)
- Uso de memória da edge function
- Tokens consumidos pelo Gemini por lote e total
- Verificar se o lock de 900s é suficiente para PDFs maiores
- Testar com PDF sintético de 600+ itens se possível
Isso evita surpresas em produção com PDFs reais de clientes.

### Fase 7 — Code review e merge
Revisar diff completo da branch contra master. Confirmar que não há
mudanças inesperadas. Merge na master.

### Fase 8 — Deploy controlado
Deploy em produção com código já testado. Importar Utinga, validar.
Importar Araci, validar. Ambos devem atingir a baseline documentada.
