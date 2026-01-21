
# Diagnóstico de RLS (Row Level Security) - NaboOrça

Use estas queries no Editor SQL do Supabase para diagnosticar problemas de permissão.

## 1. Verificar Policies Existentes
Lista todas as políticas de segurança nas tabelas críticas (`insumos`, `budget_items`, `budgets`).

```sql
SELECT 
    schemaname, 
    tablename, 
    policyname, 
    permissive, 
    roles, 
    cmd, 
    qual, 
    with_check 
FROM pg_policies 
WHERE tablename IN ('insumos', 'budget_items', 'budgets', 'compositions', 'sinapi_inputs_view');
```

## 2. Verificar se RLS está Ativo
Confirma se o RLS está habilitado nas tabelas.

```sql
SELECT relname, relrowsecurity 
FROM pg_class 
JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace 
WHERE nspname = 'public' 
  AND relname IN ('insumos', 'budget_items', 'budgets', 'compositions');
```

## 3. Simular Acesso (Impersonation)
Teste se um usuário autenticado consegue ler a tabela `insumos`.
Substitua `[USER_UUID]` pelo ID do usuário de teste (ex: o ID retornado no script de probe).

```sql
-- Habilita role authenticated (simulação)
SET ROLE authenticated;
SET request.jwt.claim.sub = '8df5b110-fe79-4bbd-a0ee-7af2ab82d20a'; -- ID do usuário teste

-- Tenta ler
SELECT count(*) FROM insumos;

-- Tenta ler composições
SELECT count(*) FROM compositions;

-- Retorna ao postgres
RESET ROLE;
```

## 4. Correção de Emergência (Se necessário)
Se a leitura retornar erro ou 0 indevidamente, aplique esta policy para permitir leitura PARA TODOS OS AUTENTICADOS (Cuidado: expõe todos os insumos).

```sql
-- Para Insumos
CREATE POLICY "Enable read access for authenticated users" ON "public"."insumos"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (true); -- Ou filtra por user_id se for privado: (auth.uid() = user_id)

-- Para Composições
CREATE POLICY "Enable read access for authenticated users" ON "public"."compositions"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (true);
```
