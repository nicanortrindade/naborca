-- ============================================================================
-- NABOORÇA • MULTI-BASE PRICE SUPPORT
-- Migration: 20260223000001_multibase_price_support.sql
-- Data: 2026-02-23
-- Objetivo: Suportar bases de preço externas (ORSE, CPU, EMOP, etc.) além do
--           SINAPI já existente, via tabelas e RPC find_composition_in_bases.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------------

-- Tabela de bases de preço externas
CREATE TABLE IF NOT EXISTS public.external_price_bases (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id),
  name        text        NOT NULL,
  slug        text        NOT NULL,
  uf          text,
  competence  text,
  created_at  timestamptz DEFAULT now()
);

-- Itens das bases externas
CREATE TABLE IF NOT EXISTS public.external_price_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id     uuid        NOT NULL REFERENCES public.external_price_bases(id) ON DELETE CASCADE,
  code        text        NOT NULL,
  description text        NOT NULL,
  unit        text,
  unit_price  numeric,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_price_items_base_code
  ON public.external_price_items(base_id, code);

-- Aliases de código (ex: ORSE usa prefixo diferente do SINAPI)
CREATE TABLE IF NOT EXISTS public.price_base_aliases (
  id              uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id         uuid  NOT NULL REFERENCES public.external_price_bases(id) ON DELETE CASCADE,
  alias_code      text  NOT NULL,
  canonical_code  text  NOT NULL
);

-- ---------------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

ALTER TABLE public.external_price_bases  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_price_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_base_aliases    ENABLE ROW LEVEL SECURITY;

-- Policies: cada usuário só acessa suas próprias bases
CREATE POLICY "Users manage own bases"
  ON public.external_price_bases
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own items"
  ON public.external_price_items
  FOR ALL
  USING (
    auth.uid() IN (SELECT user_id FROM public.external_price_bases WHERE id = base_id)
  )
  WITH CHECK (
    auth.uid() IN (SELECT user_id FROM public.external_price_bases WHERE id = base_id)
  );

CREATE POLICY "Users manage own aliases"
  ON public.price_base_aliases
  FOR ALL
  USING (
    auth.uid() IN (SELECT user_id FROM public.external_price_bases WHERE id = base_id)
  )
  WITH CHECK (
    auth.uid() IN (SELECT user_id FROM public.external_price_bases WHERE id = base_id)
  );

-- ---------------------------------------------------------------------------
-- 3. RPC: find_composition_in_bases
--    Consulta SINAPI primeiro (Hydration A path). Se não encontrar, busca nas
--    bases externas do usuário (ORSE, CPU, EMOP, etc.) via p_user_id.
--    source_base é retornado para que o chamador possa registrar a origem.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.find_composition_in_bases(text, uuid, text, text, boolean);

CREATE OR REPLACE FUNCTION public.find_composition_in_bases(
  p_code        text,
  p_user_id     uuid,
  p_uf          text    DEFAULT 'BA',
  p_competence  text    DEFAULT NULL,
  p_desonerado  boolean DEFAULT true
)
RETURNS TABLE (
  item_description  text,
  item_unit         text,
  item_quantity     numeric,
  item_price        numeric,
  item_type         text,
  source_base       text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_competence text := COALESCE(p_competence, to_char(now(), 'YYYY-MM'));
BEGIN
  -- ── PATH A: SINAPI (prioridade máxima) ────────────────────────────────────
  RETURN QUERY
  SELECT
    fic.item_description,
    fic.item_unit,
    fic.item_quantity,
    fic.item_price,
    fic.item_type,
    'SINAPI'::text AS source_base
  FROM public.find_internal_composition(p_code, p_uf, v_competence, p_desonerado) fic;

  IF FOUND THEN
    RETURN;
  END IF;

  -- ── PATH B: Bases externas do usuário ─────────────────────────────────────
  RETURN QUERY
  SELECT
    epi.description                     AS item_description,
    COALESCE(epi.unit, 'UN')            AS item_unit,
    1::numeric                          AS item_quantity,
    COALESCE(epi.unit_price, 0)         AS item_price,
    'insumo'::text                      AS item_type,
    epb.slug                            AS source_base
  FROM public.external_price_items epi
  JOIN public.external_price_bases epb ON epb.id = epi.base_id
  WHERE epb.user_id = p_user_id
    AND (
      epi.code = p_code
      OR EXISTS (
        SELECT 1
        FROM public.price_base_aliases pba
        WHERE pba.base_id = epb.id
          AND pba.alias_code   = p_code
          AND pba.canonical_code = epi.code
      )
    )
  LIMIT 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- Verification queries (run manually after db push):
--   SELECT table_name FROM information_schema.tables
--     WHERE table_schema = 'public'
--       AND table_name IN ('external_price_bases','external_price_items','price_base_aliases');
--
--   SELECT proname, pronargs FROM pg_proc WHERE proname = 'find_composition_in_bases';
-- ---------------------------------------------------------------------------
