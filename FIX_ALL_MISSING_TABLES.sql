-- ============================================================================
-- SCRIPT COMPLETO: Criar TODAS as tabelas faltantes
-- Execute este script no SQL Editor do Supabase
-- ============================================================================

-- 1. ADICIONAR COLUNA item_number SE NÃO EXISTIR
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budget_items' AND column_name = 'item_number'
    ) THEN
        ALTER TABLE budget_items ADD COLUMN item_number TEXT;
        RAISE NOTICE 'Coluna item_number adicionada em budget_items';
    ELSE
        RAISE NOTICE 'Coluna item_number já existe em budget_items';
    END IF;
END $$;

-- 2. CRIAR TABELA budget_item_compositions (404 ERROR)
-- ============================================================================
CREATE TABLE IF NOT EXISTS budget_item_compositions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_item_id UUID NOT NULL REFERENCES budget_items(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    unit TEXT,
    quantity NUMERIC(15,4) DEFAULT 0,
    unit_price NUMERIC(15,4) DEFAULT 0,
    total_price NUMERIC(15,4) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_budget_item_compositions_budget_item_id 
    ON budget_item_compositions(budget_item_id);
CREATE INDEX IF NOT EXISTS idx_budget_item_compositions_user_id 
    ON budget_item_compositions(user_id);

-- RLS para budget_item_compositions
ALTER TABLE budget_item_compositions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own compositions" ON budget_item_compositions;
CREATE POLICY "Users can view own compositions" ON budget_item_compositions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own compositions" ON budget_item_compositions;
CREATE POLICY "Users can insert own compositions" ON budget_item_compositions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own compositions" ON budget_item_compositions;
CREATE POLICY "Users can update own compositions" ON budget_item_compositions
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own compositions" ON budget_item_compositions;
CREATE POLICY "Users can delete own compositions" ON budget_item_compositions
    FOR DELETE USING (auth.uid() = user_id);

-- 3. CRIAR TABELA budget_schedules (404 ERROR)
-- ============================================================================
CREATE TABLE IF NOT EXISTS budget_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES budget_items(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    period INTEGER NOT NULL,
    percentage NUMERIC(5,2) DEFAULT 0,
    value NUMERIC(15,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_schedule_item_period UNIQUE (item_id, period)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_budget_schedules_budget_id ON budget_schedules(budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_schedules_item_id ON budget_schedules(item_id);
CREATE INDEX IF NOT EXISTS idx_budget_schedules_user_id ON budget_schedules(user_id);

-- RLS para budget_schedules
ALTER TABLE budget_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own schedules" ON budget_schedules;
CREATE POLICY "Users can view own schedules" ON budget_schedules
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own schedules" ON budget_schedules;
CREATE POLICY "Users can insert own schedules" ON budget_schedules
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own schedules" ON budget_schedules;
CREATE POLICY "Users can update own schedules" ON budget_schedules
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own schedules" ON budget_schedules;
CREATE POLICY "Users can delete own schedules" ON budget_schedules
    FOR DELETE USING (auth.uid() = user_id);

-- 4. VERIFICAR ESTRUTURA DAS TABELAS CRÍTICAS
-- ============================================================================
SELECT 'VERIFICAÇÃO DE TABELAS:' as info;

SELECT 'budget_items' as tabela, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'budget_items' 
ORDER BY ordinal_position;

SELECT 'budget_item_compositions' as tabela, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'budget_item_compositions' 
ORDER BY ordinal_position;

SELECT 'budget_schedules' as tabela, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'budget_schedules' 
ORDER BY ordinal_position;

-- FIM DO SCRIPT
-- ============================================================================
-- Após executar este script, faça deploy da aplicação e teste novamente:
-- 1. Ajuste global de valores (por % e valor fixo)
-- 2. Renumerar itens
-- 3. Gerar PDF sintético e analítico
-- 4. Acessar cronograma
-- ============================================================================
