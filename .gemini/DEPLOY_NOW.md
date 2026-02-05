## DEPLOY MANUAL - PASSO A PASSO

**VOCÊ PRECISA FAZER ISSO MANUALMENTE AGORA:**

### OPÇÃO 1: Via Dashboard (5 minutos)
1. Abra navegador e vá para:
   ```
   https://supabase.com/dashboard/project/cgebiryqfqheyazwtzzm/functions
   ```

2. Localize a função: `import-ocr-fallback`

3. Clique nela

4. Procure botão "Edit" ou ícone de edição (geralmente um lápis)

5. Copie TODO o conteúdo de:
   ```
   c:\Users\nican\OneDrive\Documentos\SITE PLANILHA\supabase\functions\import-ocr-fallback\index.ts
   ```

6. Cole no editor web (substitua tudo)

7. Clique em "Deploy" ou "Save"

8. Aguarde mensagem de sucesso

### OPÇÃO 2: Via PowerShell (se CLI instalado)

Execute em PowerShell COMO ADMINISTRADOR:

```powershell
cd "c:\Users\nican\OneDrive\Documentos\SITE PLANILHA"

# Se tiver Supabase CLI instalado:
supabase functions deploy import-ocr-fallback --project-ref cgebiryqfqheyazwtzzm

# OU via npx (permitir execução se necessário):
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
npx supabase@latest functions deploy import-ocr-fallback --project-ref cgebiryqfqheyazwtzzm
```

---

## VALIDAÇÃO IMEDIATA (APÓS DEPLOY)

1. **Abra os logs**:
   ```
   https://supabase.com/dashboard/project/cgebiryqfqheyazwtzzm/logs/edge-functions
   ```

2. **Filtre por**: `import-ocr-fallback`

3. **Vá para Database → Table Editor → import_jobs**

4. **Encontre um job com**:
   - status = `waiting_user` 
   - OU `extraction_failed`
   - OU qualquer job problemático

5. **Copie o `id` do job**

6. **Invoque a função** (via Dashboard Functions → Invoke):
   ```json
   {
     "job_id": "COLE_O_ID_AQUI"
   }
   ```

7. **MONITORE OS LOGS EM TEMPO REAL**

---

## O QUE PROCURAR NOS LOGS

### ✅ SUCESSO (deve aparecer):
```
[OCR-FB-DEBUG] PDF-First: Starting extraction
[OCR-FB-DEBUG] PDF-First SUCCESS
OU
[OCR-FB-DEBUG] PDF-First Failed... Will continue to OCR EC2 fallback
[OCR-FB-DEBUG] Sending to EC2
[OCR-FB-DEBUG] OCR_FALLBACK_EC2_OK
[REQ xxxxx] DB VERIFICATION: Found X items
```

### ❌ FALHA (NÃO deve aparecer):
```
Maximum call stack size exceeded
RangeError
Converting circular structure to JSON
```

---

## APÓS EXECUTAR O TESTE

**COPIE E ME ENVIE**:
1. O `job_id` que você testou
2. O `document_context` desse job (query SQL):
   ```sql
   SELECT id, status, document_context 
   FROM import_jobs 
   WHERE id = 'SEU_JOB_ID';
   ```
3. Printscreen dos logs mostrando sucesso/erro

---

**STATUS ATUAL**: Aguardando você fazer deploy manual via Dashboard.

**TEMPO ESTIMADO**: 5-10 minutos

Após deploy + teste, me envie os resultados que eu valido se o bugfix funcionou.
