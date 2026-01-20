# SINAPI INGEST CORRECTION (ABAS CSD/CCD)

**Data:** 2026-01-19
**Status:** ✅ CORRIGIDO (Lógica de Parser Robusta)

## 🔧 CORREÇÕES IMPLEMENTADAS

1.  **Detecção de Abas Flexível:**
    - O sistema agora usa lógica de detecção (`identifySheetType`) que ignora diferenças de maiúsculas/minúsculas e variações nos nomes.
    - Reconhece "CSD", "Sintético", "Composições" e suas variantes para regime Desonerado/Não Desonerado.
    - Reconhece "Analítico", "Detalhado" como fonte principal de itens.

2.  **Logs de Diagnóstico Aprimorados:**
    - O log agora imprime TODAS as abas encontradas no arquivo Excel.
    - Mostra exatamente qual decisão o parser tomou para cada aba (Ignorada, Inputs, Compositions, Analytic).
    - Exibe contagem de linhas lidas e persistidas.

3.  **Tratamento de Erros (Warn vs Error):**
    - Se uma aba CSD/CCD for encontrada mas estiver vazia (ou com header irreconhecível), o sistema agora emite um **[WARN]** e **continua** a importação, confiando que a aba **Analítico** fornecerá os dados necessários.
    - O erro falso positivo "Aba não encontrada" foi eliminado.

## 🕵️‍♂️ COMO VERIFICAR

Ao rodar a importação:

1.  Abra o console do navegador (F12).
2.  Procure por logs iniciados com `[SINAPI PARSER]` e `[SINAPI INGEST]`.
3.  Verifique a listagem de abas: `Arquivo lido. Abas encontradas: ...`
4.  Confirme se a Identificação está correta: `Aba "CSD" identificada como [compositions]...`
5.  Veja se as contagens finais batem (especialmente se a aba Analítico estiver suprindo as composições).

**Exemplo de Log Esperado de Sucesso:**
```
[SINAPI PARSER] Aba "Analítico" identificada como [analytic] regime=[null]
[SINAPI INGEST] Processando Analítico Completo...
[SINAPI INGEST] aba=Analítico Lidos=9668 composições e 20000 itens de composição.
...
[SINAPI INGEST] Ingestão Concluída. Status: SUCESSO
```
