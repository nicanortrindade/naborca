# SINAPI PARSER UPDATE V2 (PREÇOS & ALIASES)

**Data:** 2026-01-19
**Status:** ✅ Parser Refatorado para Robustez de Colunas

## 🛠 O QUE MUDOU

O sistema agora é muito mais inteligente para encontrar as colunas certas no Excel, mesmo que a CAIXA mude os nomes dos cabeçalhos.

### 1. Colunas Flexíveis (Aliases)
O parser agora procura por múltiplos nomes possíveis para cada dado vital.

**Para Insumos:**
- **Código**: Procura por "codigo", "código", "code", "insumo".
- **Preço**: Procura por "preco", "preço", "custo", "valor", "total".

**Para Composições (Aba Sintética):**
- **Código**: Procura por "codigo da composicao", "cod. composicao", "codigo", "código".
- **Preço**: Procura por "custo total", "valor total", "total", "preço", "valor".

**Para Analítico:**
- Melhora na detecção de colunas de itens e coeficientes.

### 2. Diagnóstico Detalhado no Console
Agora, ao importar, você verá logs exatos sobre quais colunas foram escolhidas:

Exemplo de log esperado:
```
[SINAPI PARSER] aba=CSD Mapeamento: Code=[0|codigo da composicao] Desc=[1|descricao] Unit=[2|unidade] Price=[4|custo total]
```
Se o índice for `-1`, o log dirá explicitamente "Coluna X não encontrada".

## 🔎 COMO VALIDAR

1.  Rode a importação novamente.
2.  Abra o console (F12).
3.  Verifique se o log mostra `Price=[X|...]` onde X é um número maior que -1.
4.  Se aparecer `Price=[-1|]`, significa que o nome da coluna no Excel é algo que ainda não previmos (ex: "Montante" em vez de "Valor"). Nesse caso, me avise qual o nome real da coluna para adicionarmos.

### Resultado Esperado
- As tabelas de preços (`sinapi_input_prices` e `sinapi_composition_prices`) devem agora ser preenchidas corretamente no banco de dados.
- O erro "Nenhum dado válido" deve desaparecer se as colunas forem encontradas.
