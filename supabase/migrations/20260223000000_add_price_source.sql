-- ============================================================================
-- NABOORÇA • ADD price_source TO import_ai_items
-- Migration: 20260223000000_add_price_source.sql
-- Data: 2026-02-23
-- Objetivo: Armazenar a base de preços de origem de cada item importado.
-- Valores canônicos: SINAPI, ORSE, SICRO, CPU, EMOP, CDHU, IOPES, SETOP,
--                   SEINFRA, GOINFRA, AGESUL, SBC, TCPO, Próprio.
-- Sem back-fill: registros existentes mantêm price_source = null para não
-- corromper orçamentos já gerados.
-- ============================================================================

ALTER TABLE public.import_ai_items
ADD COLUMN IF NOT EXISTS price_source text;

CREATE INDEX IF NOT EXISTS idx_import_ai_items_price_source
    ON public.import_ai_items (job_id, price_source)
    WHERE price_source IS NOT NULL;

COMMENT ON COLUMN public.import_ai_items.price_source IS
    'Base de preços de origem do item (SINAPI, ORSE, CPU, EMOP, CDHU, etc.). '
    'Null quando não identificável ou em registros anteriores a 2026-02-23.';
