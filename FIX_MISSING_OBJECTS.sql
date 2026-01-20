-- =====================================================
-- SCRIPT DE CORREÇÃO: Objetos Faltantes no Supabase
-- Execute este script no SQL Editor do Supabase
-- =====================================================

-- 1. ADICIONAR COLUNA item_number SE NÃO EXISTIR
-- =====================================================
DO $$
BEGIN
    -- Verifica se a coluna existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budget_items' AND column_name = 'item_number'
    ) THEN
        ALTER TABLE budget_items ADD COLUMN item_number TEXT;
        RAISE NOTICE 'Coluna item_number adicionada com sucesso!';
    ELSE
        RAISE NOTICE 'Coluna item_number já existe.';
    END IF;
END $$;

-- 2. CRIAR TABELA budget_schedules SE NÃO EXISTIR
-- Esta tabela armazena o percentual de cada item em cada período
-- =====================================================
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

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_budget_schedules_budget_id ON budget_schedules(budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_schedules_item_id ON budget_schedules(item_id);
CREATE INDEX IF NOT EXISTS idx_budget_schedules_user_id ON budget_schedules(user_id);

-- 3. RLS (Row Level Security) POLICIES
-- =====================================================
ALTER TABLE budget_schedules ENABLE ROW LEVEL SECURITY;

-- Policies para budget_schedules
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

-- 4. VERIFICAR ESTRUTURA DAS TABELAS
-- =====================================================
SELECT 'budget_items columns:' as info;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'budget_items' ORDER BY ordinal_position;

SELECT 'budget_schedules columns:' as info;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'budget_schedules' ORDER BY ordinal_position;

-- FIM DO SCRIPT
-- =====================================================

