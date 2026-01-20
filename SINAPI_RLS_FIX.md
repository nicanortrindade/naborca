# SINAPI INGESTÃO SEGURA (RLS FIX)

**Data:** 2026-01-19
**Status:** ✅ IMPLEMENTADO (Backend RPC Logic)

## 🚨 AÇÃO NECESSÁRIA

Para corrigir o erro de **"row-level security policy"**, você precisa executar o script de funções seguras no seu banco de dados Supabase.

### Passo a Passo:

1.  Acesse o **Supabase Dashboard**.
2.  Vá em **SQL Editor**.
3.  Copie o conteúdo do arquivo `sinapi_secure_rpc.sql` (localizado na raiz do projeto).
4.  Cole no editor e clique em **RUN**.

---

## 🛠 O QUE FOI FEITO

### 1. Backend Logic (RPC Functions)
Criamos funções de banco de dados (`SECURITY DEFINER`) que permitem a ingestão de dados SINAPI por usuários autenticados, contornando as restrições de RLS (Row Level Security) padrão que impedem escrita direta nas tabelas públicas.

**Funções criadas:**
- `ingest_sinapi_price_table`
- `ingest_sinapi_inputs_batch`
- `ingest_sinapi_input_prices_batch`
- `ingest_sinapi_compositions_batch`
- `ingest_sinapi_composition_prices_batch`
- `ingest_sinapi_composition_items_batch`

### 2. Frontend Service Update
O serviço `SinapiService` foi atualizado para usar `supabase.rpc()` em vez de `upsert()` direto.
- Se a função RPC existir (script rodado), a importação será rápida e segura.
- Se a função não existir, ele tentará o método antigo (e falhará com aviso claro).

### 3. Edge Function (Setup)
Foi criado o arquivo `supabase/functions/sinapi-ingest/index.ts` contendo a lógica para uma Edge Function futura, caso deseje implantar via Supabase CLI.

---

## ✅ COMO TESTAR

1.  Após rodar o SQL, vá na tela de Importação.
2.  Selecione os 4 arquivos.
3.  Clique em "Iniciar Importação".
4.  O processo deve fluir sem erros de permissão e os dados aparecerão no banco.
