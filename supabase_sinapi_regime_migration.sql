-- =====================================================
-- SINAPI REGIME & MOCK CONTROL - MIGRATION
-- =====================================================
-- Execute este script no SQL Editor do Supabase
-- Adiciona campos para controle de regime SINAPI e isolamento de bases mock
-- =====================================================

-- =====================================================
-- PARTE A: Campos SINAPI no Budget
-- =====================================================

-- Adicionar campos de configuração SINAPI ao budget
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS sinapi_uf TEXT DEFAULT 'BA';
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS sinapi_competence TEXT DEFAULT '2025-01';
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS sinapi_regime TEXT DEFAULT 'NAO_DESONERADO' CHECK (sinapi_regime IN ('DESONERADO', 'NAO_DESONERADO'));
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS sinapi_contract_type TEXT DEFAULT 'HORISTA' CHECK (sinapi_contract_type IN ('HORISTA', 'MENSALISTA'));

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_budgets_sinapi_regime ON budgets(sinapi_regime);
CREATE INDEX IF NOT EXISTS idx_budgets_sinapi_competence ON budgets(sinapi_competence);

-- =====================================================
-- PARTE B: Campos is_mock nas tabelas SINAPI
-- =====================================================

-- Adicionar identificador de base mock/legado
ALTER TABLE sinapi_price_tables ADD COLUMN IF NOT EXISTS is_mock BOOLEAN DEFAULT FALSE;
ALTER TABLE sinapi_price_tables ADD COLUMN IF NOT EXISTS source_tag TEXT DEFAULT 'SINAPI';

-- Índice para filtrar mocks
CREATE INDEX IF NOT EXISTS idx_sinapi_price_tables_mock ON sinapi_price_tables(is_mock);
CREATE INDEX IF NOT EXISTS idx_sinapi_price_tables_source_tag ON sinapi_price_tables(source_tag);

-- =====================================================
-- VERIFICAÇÃO
-- =====================================================

SELECT 
    column_name, 
    data_type, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'budgets' 
AND column_name LIKE 'sinapi%'
ORDER BY column_name;

SELECT 
    column_name, 
    data_type, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'sinapi_price_tables' 
AND column_name IN ('is_mock', 'source_tag')
ORDER BY column_name;

-- =====================================================
-- SUCESSO!
-- =====================================================
