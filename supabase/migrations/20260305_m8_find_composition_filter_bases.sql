-- ============================================================================
-- NABORÇA • MULTI-BASE PRICE SUPPORT (UPDATE M7)
-- Migration: 20260305_m8_find_composition_filter_bases.sql
-- Data: 2026-03-05
-- Objetivo: Atualizar find_composition_in_bases para suportar filtragem por
--           bases selecionadas (p_bases_selecionadas).
-- ============================================================================

DROP FUNCTION IF EXISTS public.find_composition_in_bases(text, uuid, text, text, boolean, text[]);

CREATE OR REPLACE FUNCTION public.find_composition_in_bases(
  p_code               text,
  p_user_id            uuid,
  p_uf                 text    DEFAULT 'BA',
  p_competence         text    DEFAULT NULL,
  p_desonerado         boolean DEFAULT true,
  p_bases_selecionadas text[]  DEFAULT NULL
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
  v_filter_bases boolean := p_bases_selecionadas IS NOT NULL AND array_length(p_bases_selecionadas, 1) > 0;
BEGIN
  -- ── PATH A: SINAPI ────────────────────────────────────
  IF NOT v_filter_bases OR 'SINAPI' = ANY(p_bases_selecionadas) THEN
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
    AND (NOT v_filter_bases OR epb.slug = ANY(p_bases_selecionadas))
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
