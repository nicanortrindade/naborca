# NABOORÇA - FASE 1.5: IMPORT PARSE WORKER

## Resumo

Este documento descreve a implementação da arquitetura de worker para processamento de PDFs pesados.

### Problema Resolvido
A Edge Function `import-processor` morria por timeout do watchdog (~225s) ao processar PDFs tabulares grandes. O parse de PDF é CPU-bound e bloqueia o event loop, impedindo que o heartbeat seja enviado.

### Solução Implementada
1. **`import-processor`** agora apenas **enfileira** o PDF para processamento e retorna rapidamente (< 5s)
2. **`import-parse-worker`** processa o PDF em background, sem pressão de timeout
3. **pg_cron** dispara o worker periodicamente para processar a fila
4. O **watchdog existente** continua protegendo contra jobs stuck

---

## Arquivos Criados/Modificados

### Novos Arquivos

| Arquivo | Descrição |
|---------|-----------|
| `supabase/migrations/20260124_import_parse_worker.sql` | Migração SQL principal (usa pg_net) |
| `supabase/migrations/20260124_import_parse_worker_alt.sql` | Migração alternativa (sem pg_net) |
| `supabase/functions/import-parse-worker/index.ts` | Edge Function worker de parsing |
| `supabase/functions/import-parse-dispatcher/index.ts` | Edge Function dispatcher alternativo |

### Arquivo Modificado

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/import-processor/index.ts` | PDFs agora são enfileirados, não processados inline |

---

## Instruções de Deploy

### Passo 1: Verificar pg_net

Abra o Supabase Dashboard → Database → Extensions e verifique se `pg_net` está habilitado.

- **Se pg_net está habilitado**: Use a migração principal
- **Se pg_net NÃO está habilitado**: Use a migração alternativa + dispatcher

### Passo 2: Aplicar Migração SQL

Acesse o **SQL Editor** no Supabase Dashboard e execute o conteúdo de **UMA** das migrações:

**Opção A (pg_net habilitado):**
```sql
-- Copie e cole o conteúdo de:
-- supabase/migrations/20260124_import_parse_worker.sql
```

**Opção B (pg_net NÃO habilitado):**
```sql
-- Copie e cole o conteúdo de:
-- supabase/migrations/20260124_import_parse_worker_alt.sql
```

### Passo 3: Configurar Variáveis de Ambiente (apenas para pg_net)

Se usando pg_net, configure as variáveis no Supabase:

```sql
ALTER DATABASE postgres SET app.settings.supabase_url = 'https://SEU_PROJETO.supabase.co';
ALTER DATABASE postgres SET app.settings.supabase_service_role_key = 'eyJhbGci...SUA_CHAVE...';
```

### Passo 4: Deploy das Edge Functions

Execute no terminal:

```bash
# Deploy do worker
npx supabase functions deploy import-parse-worker

# Deploy do processor atualizado
npx supabase functions deploy import-processor

# (Apenas se usando alternativa sem pg_net)
npx supabase functions deploy import-parse-dispatcher
```

### Passo 5: Configurar Cron (se usando alternativa)

Se escolheu a opção sem pg_net, você precisa configurar um cron externo para chamar o dispatcher. Opções:

1. **Cloudflare Workers** com cron trigger
2. **GitHub Actions** scheduled workflow
3. **Vercel Cron Jobs**
4. **Easycron.com** ou similar

Exemplo de chamada:
```bash
curl -X POST "https://SEU_PROJETO.supabase.co/functions/v1/import-parse-dispatcher" \
  -H "Authorization: Bearer SUA_SERVICE_ROLE_KEY"
```

---

## Fluxo de Dados

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                               FRONTEND                                        │
│                         (AiImporterModal.tsx)                                 │
│                                                                               │
│   1. Upload arquivo para Storage                                              │
│   2. Cria import_job + import_files                                          │
│   3. Chama RPC admin_start_import_job                                        │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        IMPORT-PROCESSOR                                       │
│                                                                               │
│   • Recebe job_id                                                            │
│   • Detecta PDF → Enfileira task em import_parse_tasks                       │
│   • Atualiza job.current_step = 'queued_for_parse_worker'                    │
│   • RETORNA IMEDIATAMENTE (< 5s)                                             │
│                                                                               │
│   (Para Excel/Imagem: processa inline como antes)                            │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      IMPORT_PARSE_TASKS                                       │
│                          (Fila SQL)                                           │
│                                                                               │
│   ┌─────────────────────────────────────────────────────────────┐            │
│   │ id | job_id | file_id | status  | attempts | locked_at     │            │
│   │────┼────────┼─────────┼─────────┼──────────┼───────────────│            │
│   │ .. │ uuid-1 │ uuid-f1 │ queued  │ 0        │ NULL          │            │
│   └─────────────────────────────────────────────────────────────┘            │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │         PG_CRON (1 min)       │
          │   dispatch_parse_task(2)      │
          │                               │
          │   OU                          │
          │                               │
          │   IMPORT-PARSE-DISPATCHER     │
          │   (Edge Function + cron ext)  │
          └───────────────┬───────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      IMPORT-PARSE-WORKER                                      │
│                                                                               │
│   1. Recebe { task_id, job_id, file_id }                                     │
│   2. Marca task como 'running'                                               │
│   3. Baixa PDF do Storage                                                    │
│   4. Extrai texto com pdfjs-dist                                             │
│   5. Atualiza import_files.page_count + metadata                             │
│   6. Divide texto em chunks                                                  │
│   7. Para cada chunk: chama Gemini, salva import_items                       │
│   8. Heartbeat a cada 15s (updated_at, current_step)                         │
│   9. Finaliza: job.status = 'waiting_user' | 'failed'                        │
│   10. task.status = 'done' | 'failed'                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tabela: import_parse_tasks

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | PK, auto-gerado |
| job_id | UUID | FK → import_jobs.id |
| file_id | UUID | FK → import_files.id |
| status | TEXT | queued → dispatched → running → done/failed |
| attempts | INT | Número de tentativas |
| max_attempts | INT | Máximo de tentativas (default: 3)|
| locked_at | TIMESTAMPTZ | Timestamp do lock |
| locked_by | TEXT | Identificador do worker |
| last_error | TEXT | Último erro, se falhou |
| result | JSONB | Resultado final (items_inserted, etc) |
| created_at | TIMESTAMPTZ | Criação |
| updated_at | TIMESTAMPTZ | Última atualização |

**Constraint**: UNIQUE(job_id) - apenas 1 task por job

---

## Validação

### Teste Manual

1. **Importar PDF grande** via UI
2. Verificar no Dashboard do Supabase:
   - `import_jobs`: deve ter `current_step = 'queued_for_parse_worker'`
   - `import_parse_tasks`: deve ter 1 row com `status = 'queued'`
3. Aguardar 1-2 minutos (pg_cron dispara)
4. Verificar novamente:
   - `import_parse_tasks.status` deve mudar para 'running' → 'done'
   - `import_jobs.status` deve mudar para 'waiting_user'
   - `import_files.page_count` deve estar preenchido
   - `import_items` deve conter os items extraídos

### Query de Diagnóstico

```sql
-- Ver status das tasks
SELECT 
    pt.id,
    pt.status,
    pt.attempts,
    pt.locked_at,
    pt.last_error,
    j.current_step,
    j.status as job_status,
    f.page_count,
    f.original_filename
FROM import_parse_tasks pt
JOIN import_jobs j ON j.id = pt.job_id
JOIN import_files f ON f.id = pt.file_id
ORDER BY pt.created_at DESC
LIMIT 10;
```

### Query de Recovery Manual

```sql
-- Recuperar tasks stuck manualmente
SELECT public.recover_stuck_parse_tasks();
```

---

## Rollback

Para reverter as mudanças:

1. **Restaurar import-processor original** (reverter git):
   ```bash
   git checkout HEAD^ -- supabase/functions/import-processor/index.ts
   npx supabase functions deploy import-processor
   ```

2. **Remover tabela e crons**:
   ```sql
   SELECT cron.unschedule('dispatch_parse_tasks');
   SELECT cron.unschedule('recover_stuck_parse_tasks');
   DROP TABLE IF EXISTS public.import_parse_tasks CASCADE;
   DROP FUNCTION IF EXISTS public.dispatch_parse_task;
   DROP FUNCTION IF EXISTS public.mark_parse_tasks_ready;
   DROP FUNCTION IF EXISTS public.recover_stuck_parse_tasks;
   DROP FUNCTION IF EXISTS public.get_pending_parse_tasks;
   DROP FUNCTION IF EXISTS public.mark_parse_task_done;
   DROP FUNCTION IF EXISTS public.mark_parse_task_failed;
   ```

---

## Monitoramento

### Logs do Worker
No Supabase Dashboard → Edge Functions → import-parse-worker → Logs

Procurar por:
- `[WORKER ...]` - logs do processamento
- `SUCCESS` - job concluído
- `CRITICAL FAILURE` - erro crítico

### Métricas para observar
- Jobs em `queued_for_parse_worker` por mais de 5 minutos → problema no dispatch
- Tasks em `dispatched` ou `running` por mais de 10 minutos → worker travou (recovery automático deve resolver)
- Jobs finalizando com `waiting_user` → sucesso
- Jobs finalizando com `failed` real → verificar error_message

---

## FAQ

**P: E se pg_cron não estiver habilitado?**
R: pg_cron é habilitado por padrão em projetos Supabase. Se não estiver, habilite em Database → Extensions.

**P: E se pg_net não estiver habilitado?**
R: Use a migração alternativa e configure o dispatcher externo.

**P: O worker pode rodar por quanto tempo?**
R: Edge Functions têm limite de ~300s (5 min). Para PDFs muito grandes, o worker divide em chunks e faz heartbeat, evitando timeout.

**P: E se o worker falhar no meio?**
R: A task fica em estado 'running' ou 'dispatched'. O cron `recover_stuck_parse_tasks` a cada 2 minutos detecta tasks stuck e as recoloca na fila.

**P: Os items duplicam se re-processar?**
R: O schema permite duplicação. Considere adicionar dedupe no `insertImportItems` se necessário.
