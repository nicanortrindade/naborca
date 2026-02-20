# Relatório de Deploy e Verificação

## Status do Deploy

- **Sucesso**: As funções `import-processor`, `import-ocr-fallback`, `import-watchdog`, e `import-parse-worker` foram deployadas com sucesso (Command ID: 358c9df7-ecae-4df2-bf9e-db4b503b6400).
- **Arquivos Modificados**: Confirmados via `git status` (processor, ocr-fallback, watchdog, parse-worker).

## Instruções de Verificação

Devido a limitações de execução remota de SQL via CLI, execute os seguintes passos manualmente no Supabase Dashboard (SQL Editor):

1. **Reprocessar Job (Reset):**
   - Abra o arquivo `scripts/reprocess_job_884b.sql` ou copie seu conteúdo.
   - Execute no SQL Editor para resetar o status do job `884b...` para `queued`.

2. **Aguardar Processamento:**
   - Espere cerca de 10-15 segundos. A function `import-processor` (ou worker) deve pegar o arquivo, delegar para `ocr-fallback`, processar Stage A/B e finalizar.

3. **Verificar Resultados:**
   - Abra o arquivo `scripts/check_job_status.sql` e execute as queries.
   - **Critérios de Sucesso:**
     - `extraction_status` deve ser `done` (ou `failed` com erro explícito, não `processing` eterno).
     - `ai_items_count` deve ser > 0 (se o PDF contiver dados).
     - `extraction_last_error` se houver falha, deve indicar erro real (ex: timeout interno), não "no worker/no queue".

## Próximos Passos

- Se o teste confirmar a correção, o hotfix pode ser considerado estável.
- Monitore logs de `import-watchdog` para garantir que jobs internos não estão sendo mortos erroneamente.
