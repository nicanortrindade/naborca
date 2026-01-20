-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Isolamento Total de Dados por Usuário
-- =====================================================
-- 
-- Este script implementa políticas de segurança em nível de linha
-- para garantir que cada usuário acesse apenas seus próprios dados.
--
-- IMPORTANTE: Execute este script no SQL Editor do Supabase
-- =====================================================

-- =====================================================
-- 1. BUDGETS
-- =====================================================

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;

-- Política de SELECT: usuário só vê seus próprios orçamentos
CREATE POLICY "Users can view own budgets"
ON budgets FOR SELECT
USING (auth.uid() = user_id);

-- Política de INSERT: usuário só cria orçamentos com seu próprio user_id
CREATE POLICY "Users can insert own budgets"
ON budgets FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Política de UPDATE: usuário só atualiza seus próprios orçamentos
CREATE POLICY "Users can update own budgets"
ON budgets FOR UPDATE
USING (auth.uid() = user_id);

-- Política de DELETE: usuário só deleta seus próprios orçamentos
CREATE POLICY "Users can delete own budgets"
ON budgets FOR DELETE
USING (auth.uid() = user_id);

-- =====================================================
-- 2. BUDGET_ITEMS
-- =====================================================

ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own budget_items"
ON budget_items FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own budget_items"
ON budget_items FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own budget_items"
ON budget_items FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own budget_items"
ON budget_items FOR DELETE
USING (auth.uid() = user_id);

-- =====================================================
-- 3. INSUMOS
-- =====================================================

ALTER TABLE insumos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own insumos"
ON insumos FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own insumos"
ON insumos FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own insumos"
ON insumos FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own insumos"
ON insumos FOR DELETE
USING (auth.uid() = user_id);

-- =====================================================
-- 4. COMPOSITIONS
-- =====================================================

ALTER TABLE compositions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own compositions"
ON compositions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own compositions"
ON compositions FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own compositions"
ON compositions FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own compositions"
ON compositions FOR DELETE
USING (auth.uid() = user_id);

-- =====================================================
-- 5. COMPOSITION_ITEMS
-- =====================================================

ALTER TABLE composition_items ENABLE ROW LEVEL SECURITY;

-- Composition items pertencem ao mesmo usuário da composition pai
CREATE POLICY "Users can view own composition_items"
ON composition_items FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM compositions
        WHERE compositions.id = composition_items.composition_id
        AND compositions.user_id = auth.uid()
    )
);

CREATE POLICY "Users can insert own composition_items"
ON composition_items FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM compositions
        WHERE compositions.id = composition_items.composition_id
        AND compositions.user_id = auth.uid()
    )
);

CREATE POLICY "Users can update own composition_items"
ON composition_items FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM compositions
        WHERE compositions.id = composition_items.composition_id
        AND compositions.user_id = auth.uid()
    )
);

CREATE POLICY "Users can delete own composition_items"
ON composition_items FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM compositions
        WHERE compositions.id = composition_items.composition_id
        AND compositions.user_id = auth.uid()
    )
);

-- =====================================================
-- 6. CLIENTS
-- =====================================================

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own clients"
ON clients FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own clients"
ON clients FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own clients"
ON clients FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own clients"
ON clients FOR DELETE
USING (auth.uid() = user_id);

-- =====================================================
-- 7. PROPOSALS
-- =====================================================

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own proposals"
ON proposals FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own proposals"
ON proposals FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own proposals"
ON proposals FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own proposals"
ON proposals FOR DELETE
USING (auth.uid() = user_id);

-- =====================================================
-- 8. CHANGE_LOGS
-- =====================================================

ALTER TABLE change_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own change_logs"
ON change_logs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own change_logs"
ON change_logs FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own change_logs"
ON change_logs FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own change_logs"
ON change_logs FOR DELETE
USING (auth.uid() = user_id);

-- =====================================================
-- 9. BUDGET_SCHEDULES
-- =====================================================

ALTER TABLE budget_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own budget_schedules"
ON budget_schedules FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own budget_schedules"
ON budget_schedules FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own budget_schedules"
ON budget_schedules FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own budget_schedules"
ON budget_schedules FOR DELETE
USING (auth.uid() = user_id);

-- =====================================================
-- 10. COMPANIES
-- =====================================================

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own companies"
ON companies FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own companies"
ON companies FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own companies"
ON companies FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own companies"
ON companies FOR DELETE
USING (auth.uid() = user_id);

-- =====================================================
-- VERIFICAÇÃO
-- =====================================================
-- Execute esta query para verificar se todas as políticas foram criadas:
/*
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
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
*/

-- =====================================================
-- NOTAS IMPORTANTES
-- =====================================================
-- 
-- 1. TESTE ANTES DE APLICAR EM PRODUÇÃO
--    - Crie um ambiente de teste
--    - Verifique que usuários não conseguem acessar dados de outros
--    - Teste todas as operações CRUD
--
-- 2. ÍNDICES
--    - Certifique-se de que existe índice em user_id para performance
--    - Execute: CREATE INDEX IF NOT EXISTS idx_[table]_user_id ON [table](user_id);
--
-- 3. MIGRATION DE DADOS EXISTENTES
--    - Se houver dados sem user_id, eles ficarão inacessíveis
--    - Popule user_id antes de ativar RLS
--
-- 4. COMPOSITION_ITEMS
--    - Usa política baseada em JOIN com compositions
--    - Pode ter impacto de performance em grandes volumes
--    - Considere adicionar user_id diretamente se necessário
--
-- 5. DESABILITAR RLS (EMERGÊNCIA)
--    - ALTER TABLE [table] DISABLE ROW LEVEL SECURITY;
--    - Use apenas em caso de emergência
--
-- =====================================================
