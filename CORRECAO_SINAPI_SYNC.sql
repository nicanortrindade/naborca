-- ============================================================
-- CORREÇÃO COMPLETA PARA SINCRONIZAÇÃO DE INSUMOS
-- Execute este script no SQL Editor do Supabase
-- ============================================================

-- 1. Primeiro, verificar se existe constraint ou índice duplicado e remover
DROP INDEX IF EXISTS idx_insumos_upsert_conflict;
DROP INDEX IF EXISTS idx_insumos_unique;

-- 2. Remover constraint única antiga se existir
ALTER TABLE insumos DROP CONSTRAINT IF EXISTS insumos_user_code_fonte_key;

-- 3. Criar novo índice único para suportar UPSERT com ON CONFLICT
-- O Supabase/PostgREST precisa de um UNIQUE INDEX (não constraint) para ON CONFLICT funcionar
CREATE UNIQUE INDEX idx_insumos_upsert_conflict 
ON insumos (user_id, code, fonte);

-- 4. Verificar estrutura da tabela (para diagnóstico)
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns 
-- WHERE table_name = 'insumos';

-- 5. Resultado esperado: Success. No rows returned.
-- Após executar, a sincronização deve funcionar.

-- ============================================================
-- IMPORTANTE: Após rodar este script, faça um novo deploy 
-- (npm run build) e suba a nova pasta dist para o Netlify.
-- ============================================================
