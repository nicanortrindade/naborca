-- =================================================================
-- SCRIPT DE CORREÇÃO DE PERMISSÕES (RLS) - NABOORÇA
-- =================================================================
-- Instruções:
-- 1. Acesse o Painel do Supabase: https://app.supabase.com
-- 2. Vá em "SQL Editor" (ícone de Terminal na barra lateral esquerda).
-- 3. Clique em "New Query".
-- 4. Cole este conteúdo inteiro e clique em "RUN".
-- =================================================================

-- Habilita RLS em todas as tabelas críticas para forçar a segurança correta
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE compositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE composition_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bdi ENABLE ROW LEVEL SECURITY;
ALTER TABLE encargos ENABLE ROW LEVEL SECURITY;

-- Recria as políticas para garantir que o usuário autenticado pode ver E editar seus próprios dados

-- 1. COMPANIES
DROP POLICY IF EXISTS "Users can manage their own company" ON companies;
CREATE POLICY "Users can manage their own company" ON companies FOR ALL USING (auth.uid() = user_id);

-- 2. BUDGETS
DROP POLICY IF EXISTS "Users can manage their own budgets" ON budgets;
CREATE POLICY "Users can manage their own budgets" ON budgets FOR ALL USING (auth.uid() = user_id);

-- 3. BUDGET_ITEMS
DROP POLICY IF EXISTS "Users can manage their own budget items" ON budget_items;
CREATE POLICY "Users can manage their own budget items" ON budget_items FOR ALL USING (auth.uid() = user_id);

-- 4. PRICE BASES
DROP POLICY IF EXISTS "Users can manage their own price bases" ON price_bases;
CREATE POLICY "Users can manage their own price bases" ON price_bases FOR ALL USING (auth.uid() = user_id);

-- 5. INSUMOS
DROP POLICY IF EXISTS "Users can manage their own insumos" ON insumos;
CREATE POLICY "Users can manage their own insumos" ON insumos FOR ALL USING (auth.uid() = user_id);

-- 6. COMPOSITIONS
DROP POLICY IF EXISTS "Users can manage their own compositions" ON compositions;
CREATE POLICY "Users can manage their own compositions" ON compositions FOR ALL USING (auth.uid() = user_id);

-- 7. COMPOSITION_INPUTS
DROP POLICY IF EXISTS "Users can manage their own composition items" ON composition_inputs;
CREATE POLICY "Users can manage their own composition items" ON composition_inputs FOR ALL USING (auth.uid() = user_id);

-- 8. BDI
DROP POLICY IF EXISTS "Users can manage their own BDI presets" ON bdi;
CREATE POLICY "Users can manage their own BDI presets" ON bdi FOR ALL USING (auth.uid() = user_id);

-- 9. ENCARGOS
DROP POLICY IF EXISTS "Users can manage their own social charges" ON encargos;
CREATE POLICY "Users can manage their own social charges" ON encargos FOR ALL USING (auth.uid() = user_id);

-- 10. Grant public access to sequences if necessary (fixes ID generation errors)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;

-- Confirmação
SELECT 'Permissoes Corrigidas com Sucesso' as status;
