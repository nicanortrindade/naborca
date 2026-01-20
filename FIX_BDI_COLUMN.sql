-- ============================================================================
-- SCRIPT: Adicionar coluna custom_bdi em budget_items
-- Execute este script no SQL Editor do Supabase
-- ============================================================================

-- Adicionar coluna custom_bdi se não existir
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budget_items' AND column_name = 'custom_bdi'
    ) THEN
        ALTER TABLE budget_items ADD COLUMN custom_bdi NUMERIC(5,2) DEFAULT NULL;
        RAISE NOTICE 'Coluna custom_bdi adicionada em budget_items';
    ELSE
        RAISE NOTICE 'Coluna custom_bdi já existe em budget_items';
    END IF;
END $$;

-- Adicionar outras colunas faltantes conforme o schema TypeScript
DO $$
BEGIN
    -- item_type
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budget_items' AND column_name = 'item_type'
    ) THEN
        ALTER TABLE budget_items ADD COLUMN item_type TEXT;
        RAISE NOTICE 'Coluna item_type adicionada';
    END IF;

    -- composition_id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budget_items' AND column_name = 'composition_id'
    ) THEN
        ALTER TABLE budget_items ADD COLUMN composition_id UUID REFERENCES compositions(id) ON DELETE SET NULL;
        RAISE NOTICE 'Coluna composition_id adicionada';
    END IF;

    -- insumo_id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budget_items' AND column_name = 'insumo_id'
    ) THEN
        ALTER TABLE budget_items ADD COLUMN insumo_id UUID REFERENCES insumos(id) ON DELETE SET NULL;
        RAISE NOTICE 'Coluna insumo_id adicionada';
    END IF;

    -- calculation_memory
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budget_items' AND column_name = 'calculation_memory'
    ) THEN
        ALTER TABLE budget_items ADD COLUMN calculation_memory TEXT;
        RAISE NOTICE 'Coluna calculation_memory adicionada';
    END IF;

    -- calculation_steps
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budget_items' AND column_name = 'calculation_steps'
    ) THEN
        ALTER TABLE budget_items ADD COLUMN calculation_steps TEXT[];
        RAISE NOTICE 'Coluna calculation_steps adicionada';
    END IF;

    -- cost_center
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budget_items' AND column_name = 'cost_center'
    ) THEN
        ALTER TABLE budget_items ADD COLUMN cost_center TEXT;
        RAISE NOTICE 'Coluna cost_center adicionada';
    END IF;

    -- is_locked
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budget_items' AND column_name = 'is_locked'
    ) THEN
        ALTER TABLE budget_items ADD COLUMN is_locked BOOLEAN DEFAULT FALSE;
        RAISE NOTICE 'Coluna is_locked adicionada';
    END IF;

    -- notes
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budget_items' AND column_name = 'notes'
    ) THEN
        ALTER TABLE budget_items ADD COLUMN notes TEXT;
        RAISE NOTICE 'Coluna notes adicionada';
    END IF;

    -- is_desonerated
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budget_items' AND column_name = 'is_desonerated'
    ) THEN
        ALTER TABLE budget_items ADD COLUMN is_desonerated BOOLEAN DEFAULT FALSE;
        RAISE NOTICE 'Coluna is_desonerated adicionada';
    END IF;
END $$;

-- Adicionar colunas faltantes em budgets
DO $$
BEGIN
    -- proposal_cover
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'proposal_cover'
    ) THEN
        ALTER TABLE budgets ADD COLUMN proposal_cover TEXT;
        RAISE NOTICE 'Coluna proposal_cover adicionada em budgets';
    END IF;

    -- proposal_terms
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'proposal_terms'
    ) THEN
        ALTER TABLE budgets ADD COLUMN proposal_terms TEXT;
        RAISE NOTICE 'Coluna proposal_terms adicionada em budgets';
    END IF;

    -- schedule_interval
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'schedule_interval'
    ) THEN
        ALTER TABLE budgets ADD COLUMN schedule_interval INTEGER;
        RAISE NOTICE 'Coluna schedule_interval adicionada em budgets';
    END IF;

    -- period_labels
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'period_labels'
    ) THEN
        ALTER TABLE budgets ADD COLUMN period_labels TEXT[];
        RAISE NOTICE 'Coluna period_labels adicionada em budgets';
    END IF;

    -- cost_centers
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'cost_centers'
    ) THEN
        ALTER TABLE budgets ADD COLUMN cost_centers TEXT[];
        RAISE NOTICE 'Coluna cost_centers adicionada em budgets';
    END IF;

    -- is_template
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'is_template'
    ) THEN
        ALTER TABLE budgets ADD COLUMN is_template BOOLEAN DEFAULT FALSE;
        RAISE NOTICE 'Coluna is_template adicionada em budgets';
    END IF;

    -- desoneracao
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'desoneracao'
    ) THEN
        ALTER TABLE budgets ADD COLUMN desoneracao NUMERIC(5,2);
        RAISE NOTICE 'Coluna desoneracao adicionada em budgets';
    END IF;

    -- version
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'version'
    ) THEN
        ALTER TABLE budgets ADD COLUMN version TEXT;
        RAISE NOTICE 'Coluna version adicionada em budgets';
    END IF;

    -- revision
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'revision'
    ) THEN
        ALTER TABLE budgets ADD COLUMN revision INTEGER;
        RAISE NOTICE 'Coluna revision adicionada em budgets';
    END IF;

    -- revision_notes
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'revision_notes'
    ) THEN
        ALTER TABLE budgets ADD COLUMN revision_notes TEXT;
        RAISE NOTICE 'Coluna revision_notes adicionada em budgets';
    END IF;

    -- is_frozen
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'is_frozen'
    ) THEN
        ALTER TABLE budgets ADD COLUMN is_frozen BOOLEAN DEFAULT FALSE;
        RAISE NOTICE 'Coluna is_frozen adicionada em budgets';
    END IF;

    -- frozen_at
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'frozen_at'
    ) THEN
        ALTER TABLE budgets ADD COLUMN frozen_at TIMESTAMPTZ;
        RAISE NOTICE 'Coluna frozen_at adicionada em budgets';
    END IF;

    -- frozen_by
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'frozen_by'
    ) THEN
        ALTER TABLE budgets ADD COLUMN frozen_by TEXT;
        RAISE NOTICE 'Coluna frozen_by adicionada em budgets';
    END IF;

    -- parent_budget_id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'parent_budget_id'
    ) THEN
        ALTER TABLE budgets ADD COLUMN parent_budget_id UUID REFERENCES budgets(id) ON DELETE SET NULL;
        RAISE NOTICE 'Coluna parent_budget_id adicionada em budgets';
    END IF;

    -- is_scenario
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'is_scenario'
    ) THEN
        ALTER TABLE budgets ADD COLUMN is_scenario BOOLEAN DEFAULT FALSE;
        RAISE NOTICE 'Coluna is_scenario adicionada em budgets';
    END IF;

    -- scenario_name
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'budgets' AND column_name = 'scenario_name'
    ) THEN
        ALTER TABLE budgets ADD COLUMN scenario_name TEXT;
        RAISE NOTICE 'Coluna scenario_name adicionada em budgets';
    END IF;
END $$;

-- Adicionar colunas faltantes em companies
DO $$
BEGIN
    -- proposal_cover
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'companies' AND column_name = 'proposal_cover'
    ) THEN
        ALTER TABLE companies ADD COLUMN proposal_cover TEXT;
        RAISE NOTICE 'Coluna proposal_cover adicionada em companies';
    END IF;

    -- proposal_terms
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'companies' AND column_name = 'proposal_terms'
    ) THEN
        ALTER TABLE companies ADD COLUMN proposal_terms TEXT;
        RAISE NOTICE 'Coluna proposal_terms adicionada em companies';
    END IF;
END $$;

-- Adicionar colunas faltantes em insumos
DO $$
BEGIN
    -- fonte
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'insumos' AND column_name = 'fonte'
    ) THEN
        ALTER TABLE insumos ADD COLUMN fonte TEXT;
        RAISE NOTICE 'Coluna fonte adicionada em insumos';
    END IF;

    -- data_referencia
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'insumos' AND column_name = 'data_referencia'
    ) THEN
        ALTER TABLE insumos ADD COLUMN data_referencia DATE;
        RAISE NOTICE 'Coluna data_referencia adicionada em insumos';
    END IF;

    -- is_oficial
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'insumos' AND column_name = 'is_oficial'
    ) THEN
        ALTER TABLE insumos ADD COLUMN is_oficial BOOLEAN DEFAULT FALSE;
        RAISE NOTICE 'Coluna is_oficial adicionada em insumos';
    END IF;

    -- is_editavel
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'insumos' AND column_name = 'is_editavel'
    ) THEN
        ALTER TABLE insumos ADD COLUMN is_editavel BOOLEAN DEFAULT TRUE;
        RAISE NOTICE 'Coluna is_editavel adicionada em insumos';
    END IF;

    -- observacoes
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'insumos' AND column_name = 'observacoes'
    ) THEN
        ALTER TABLE insumos ADD COLUMN observacoes TEXT;
        RAISE NOTICE 'Coluna observacoes adicionada em insumos';
    END IF;
END $$;

-- Adicionar colunas faltantes em compositions
DO $$
BEGIN
    -- fonte
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'compositions' AND column_name = 'fonte'
    ) THEN
        ALTER TABLE compositions ADD COLUMN fonte TEXT;
        RAISE NOTICE 'Coluna fonte adicionada em compositions';
    END IF;

    -- data_referencia
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'compositions' AND column_name = 'data_referencia'
    ) THEN
        ALTER TABLE compositions ADD COLUMN data_referencia DATE;
        RAISE NOTICE 'Coluna data_referencia adicionada em compositions';
    END IF;

    -- is_oficial
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'compositions' AND column_name = 'is_oficial'
    ) THEN
        ALTER TABLE compositions ADD COLUMN is_oficial BOOLEAN DEFAULT FALSE;
        RAISE NOTICE 'Coluna is_oficial adicionada em compositions';
    END IF;

    -- is_customizada
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'compositions' AND column_name = 'is_customizada'
    ) THEN
        ALTER TABLE compositions ADD COLUMN is_customizada BOOLEAN DEFAULT FALSE;
        RAISE NOTICE 'Coluna is_customizada adicionada em compositions';
    END IF;

    -- observacoes
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'compositions' AND column_name = 'observacoes'
    ) THEN
        ALTER TABLE compositions ADD COLUMN observacoes TEXT;
        RAISE NOTICE 'Coluna observacoes adicionada em compositions';
    END IF;
END $$;

-- Verificar estrutura final
SELECT 'VERIFICAÇÃO FINAL - budget_items:' as info;
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'budget_items' 
ORDER BY ordinal_position;

SELECT 'VERIFICAÇÃO FINAL - budgets:' as info;
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'budgets' 
ORDER BY ordinal_position;

-- FIM DO SCRIPT
-- ============================================================================
-- PRÓXIMOS PASSOS:
-- 1. Execute este script no SQL Editor do Supabase
-- 2. Teste o ajuste global novamente
-- 3. Verifique se os erros 400 (Bad Request) foram eliminados
-- ============================================================================
