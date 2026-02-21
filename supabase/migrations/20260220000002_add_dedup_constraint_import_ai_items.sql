-- Migration: add_dedup_constraint_import_ai_items
-- Created: 2026-02-20
-- Objective: Criar constraint UNIQUE real em (job_id, import_file_id, dedup_key)
--            para suportar upsert idempotente via onConflict no Stage B.

-- 1. Adicionar coluna dedup_key se ainda não existir
ALTER TABLE public.import_ai_items
  ADD COLUMN IF NOT EXISTS dedup_key TEXT NULL;

-- 2. Remover índice parcial anterior (se existir)
DROP INDEX IF EXISTS public.idx_uq_job_composition_code;

-- 3. Remover constraints anteriores conflitantes (se existirem)
ALTER TABLE public.import_ai_items
  DROP CONSTRAINT IF EXISTS uq_job_composition_code;

ALTER TABLE public.import_ai_items
  DROP CONSTRAINT IF EXISTS uq_job_file_dedup_key;

-- 4. Limpar duplicatas existentes antes de criar a constraint
--    Mantém o registro com menor id (mais antigo) por (job_id, import_file_id, dedup_key)
DELETE FROM public.import_ai_items a
USING public.import_ai_items b
WHERE a.job_id = b.job_id
  AND a.import_file_id = b.import_file_id
  AND a.dedup_key IS NOT NULL
  AND a.dedup_key = b.dedup_key
  AND a.id > b.id;

-- 5. Criar constraint UNIQUE real (não índice parcial)
--    Apenas para linhas onde dedup_key não é NULL (usando WHERE em índice único)
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_file_dedup_key
  ON public.import_ai_items (job_id, import_file_id, dedup_key)
  WHERE dedup_key IS NOT NULL;
