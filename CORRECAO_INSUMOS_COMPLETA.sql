-- ============================================================
-- CORREÇÃO COMPLETA DA TABELA INSUMOS
-- Execute este script no SQL Editor do Supabase
-- ============================================================

-- 1. Adicionar colunas que faltam na tabela insumos
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS fonte TEXT DEFAULT '';
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS data_referencia TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS is_oficial BOOLEAN DEFAULT true;
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS is_editavel BOOLEAN DEFAULT false;
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS observacoes TEXT;

-- 2. Remover índice antigo se existir
DROP INDEX IF EXISTS idx_insumos_upsert_conflict;
DROP INDEX IF EXISTS idx_insumos_unique;

-- 3. Criar índice único para upsert funcionar
CREATE UNIQUE INDEX idx_insumos_upsert_conflict 
ON insumos (user_id, code, fonte);

-- 4. Verificar se tudo está OK (opcional - pode comentar)
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'insumos';

-- ============================================================
-- RESULTADO ESPERADO: Success. No rows returned.
-- ============================================================
