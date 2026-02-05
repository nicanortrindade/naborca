# 🚀 GUIA DE DEPLOY MANUAL - import-ocr-fallback

## ⚠️ IMPORTANTE
O Supabase CLI não está disponível no PATH do Windows.
Este guia mostra como fazer deploy manual via Dashboard do Supabase.

---

## OPÇÃO 1: Deploy via Supabase Dashboard (WEB) ✅ RECOMENDADO

### Passo 1: Acessar o Dashboard
1. Abra: https://supabase.com/dashboard/project/cgebiryqfqheyazwtzzm
2. Login com suas credenciais
3. Navegue para: **Edge Functions** (menu lateral)

### Passo 2: Selecionar a Função
1. Encontre a função: `import-ocr-fallback`
2. Clique em **"Edit Function"** ou **"Update"**

### Passo 3: Substituir o Código
1. Abra o arquivo local:
   ```
   c:\Users\nican\OneDrive\Documentos\SITE PLANILHA\supabase\functions\import-ocr-fallback\index.ts
   ```

2. Copie TODO o conteúdo do arquivo (Ctrl+A, Ctrl+C)

3. Cole no editor do Supabase Dashboard (substitua o código antigo)

### Passo 4: Deploy
1. Clique em **"Deploy"** ou **"Save Changes"**
2. Aguarde a mensagem de confirmação
3. Verifique que a versão foi atualizada (timestamp deve ser recente)

### Passo 5: Validar
1. Navegue para: **Logs** → **Functions** → `import-ocr-fallback`
2. Execute um teste (veja seção de testes abaixo)
3. Confirme que não há mais erros "Maximum call stack size exceeded"

---

## OPÇÃO 2: Instalar Supabase CLI (Para Futuros Deploys)

### No PowerShell (Como Administrador):

```powershell
# 1. Permitir execução de scripts (se necessário)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 2. Instalar via Scoop
irm get.scoop.sh | iex
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# OU via npm global
npm install -g supabase
```

### Depois de Instalado:

```bash
cd "c:\Users\nican\OneDrive\Documentos\SITE PLANILHA"

# Login
supabase login

# Deploy
supabase functions deploy import-ocr-fallback --project-ref cgebiryqfqheyazwtzzm
```

---

## 🧪 TESTE APÓS DEPLOY

### Método 1: Via Supabase Dashboard (UI)
1. No Dashboard → **Database** → **Table Editor**
2. Selecione tabela: `import_jobs`
3. Encontre um job com status `waiting_user` ou `extraction_failed`
4. Copie o `id` do job
5. Vá para **Edge Functions** → `import-ocr-fallback` → **Invoke**
6. Envie payload:
   ```json
   {
     "job_id": "COLE_O_ID_AQUI"
   }
   ```
7. Clique em **"Send Request"**
8. Verifique a resposta (deve retornar sem stack overflow!)

### Método 2: Via API (curl)

```bash
# Obter o anon key do projeto
# Dashboard → Settings → API → anon public key

curl -X POST \
  "https://cgebiryqfqheyazwtzzm.supabase.co/functions/v1/import-ocr-fallback" \
  -H "Authorization: Bearer SEU_ANON_KEY_AQUI" \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "SEU_JOB_ID_AQUI"
  }'
```

### Método 3: Via Frontend (App real)
1. Acesse a aplicação NaboOrça
2. Tente fazer um novo import de PDF
3. Monitore os logs no Dashboard → Logs
4. Confirme que o job completa sem erros

---

## 📊 VALIDAÇÃO DE SUCESSO

### ✅ Checklist Pós-Deploy

- [ ] Deploy concluído sem erros
- [ ] Versão da função atualizada (check timestamp)
- [ ] Teste executado com job real
- [ ] Nenhum erro "Maximum call stack size exceeded" nos logs
- [ ] `document_context` salvo com sucesso
- [ ] Tamanho do `document_context` < 50KB
- [ ] PDF-first error → OCR EC2 executado
- [ ] Rate limit continua funcionando (status: `waiting_user_rate_limited`)
- [ ] Airbag funcionando (ao menos 1 item sintético se parser falhar)

### 🔍 Monitorar Logs (24h)

```bash
# No Dashboard:
# Logs → Functions → import-ocr-fallback
# Filtrar por: "OCR-FB-DEBUG"

# Buscar por:
✅ "[OCR-FB-DEBUG] PDF-First: Starting extraction"
✅ "[OCR-FB-DEBUG] PDF-First SUCCESS"
✅ "[OCR-FB-DEBUG] Will continue to OCR EC2 fallback"
✅ "[OCR-FB-DEBUG] OCR_FALLBACK_EC2_OK"
✅ "DB VERIFICATION: Found X items"

# NÃO deve aparecer:
❌ "Maximum call stack size exceeded"
❌ "RangeError"
❌ "TypeError: Converting circular structure to JSON"
```

---

## 🔧 TROUBLESHOOTING

### Erro: "Function already exists"
- **Solução**: Fazer update/replace ao invés de create

### Erro: "Unauthorized"
- **Solução**: Verificar que você é owner/admin do projeto

### Código não atualiza
- **Solução**: 
  1. Clear cache do browser
  2. Force refresh (Ctrl+Shift+R)
  3. Verificar timestamp da versão no Dashboard

### Deploy via CLI falha
- **Solução**: Usar deploy via Dashboard (Opção 1 acima)

---

## 📝 ARQUIVO MODIFICADO

**Path completo**:
```
c:\Users\nican\OneDrive\Documentos\SITE PLANILHA\supabase\functions\import-ocr-fallback\index.ts
```

**Tamanho**: ~48KB  
**Linhas**: ~1063  
**Principais mudanças**:
- Linhas 15-164: `safeStringify` e `createSafeDebugInfo`
- Linhas 424-588: Blindagem PDF-first
- Linhas 636-704: Instrumentação OCR EC2
- Múltiplos pontos: Sanitização de `document_context`

---

## 🎯 PRÓXIMOS PASSOS

1. ✅ **Deploy via Dashboard** (Opção 1 acima)
2. ⏳ **Monitorar logs por 24h**
3. ⏳ **Validar taxa de sucesso > 95%**
4. ⏳ **Confirmar zero jobs travados**
5. ⏳ **Documentar métricas antes/depois**

---

## 📞 SUPORTE

Se encontrar problemas:
1. Check logs no Dashboard → Logs → Functions
2. Verificar o arquivo `.gemini/BUGFIX_STACK_OVERFLOW_SUMMARY.md`
3. Revisar invariantes obrigatórias no README do bugfix

---

**Criado**: 2026-01-30  
**Autor**: Antigravity AI  
**Status**: Aguardando deploy manual via Dashboard
