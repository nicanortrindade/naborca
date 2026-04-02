-- Função que expande recursivamente composições em budget_item_compositions
-- Para cada item com type='composition', busca sub-itens no SINAPI e insere como filhos
-- Usa find_internal_composition para buscar na base SINAPI local
-- FALLBACK: se a competência informada não existir, usa a mais recente disponível

CREATE OR REPLACE FUNCTION public.expand_composition_hierarchy(
    p_budget_id UUID,
    p_user_id UUID,
    p_uf TEXT DEFAULT 'BA',
    p_competence TEXT DEFAULT NULL,
    p_desonerado BOOLEAN DEFAULT TRUE,
    p_max_depth INT DEFAULT 4
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_comp RECORD;
    v_sub RECORD;
    v_total_inserted INT := 0;
    v_depth INT := 0;
    v_found_new BOOLEAN := TRUE;
    v_competence TEXT;
    v_regime TEXT;
    v_budget_item_ids UUID[];
    v_table_exists BOOLEAN;
BEGIN
    v_competence := COALESCE(p_competence, to_char(now(), 'YYYY-MM'));
    v_regime := CASE WHEN p_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END;

    -- Verificar se a tabela SINAPI existe para a competência informada
    SELECT EXISTS(
        SELECT 1 FROM public.sinapi_price_tables
        WHERE uf = p_uf AND competence = v_competence
          AND regime = v_regime AND is_mock = false
    ) INTO v_table_exists;

    -- Fallback: usar a competência mais recente disponível para este UF/regime
    IF NOT v_table_exists THEN
        SELECT competence INTO v_competence
        FROM public.sinapi_price_tables
        WHERE uf = p_uf AND regime = v_regime AND is_mock = false
        ORDER BY competence DESC
        LIMIT 1;

        IF v_competence IS NULL THEN
            RAISE WARNING '[expand_composition_hierarchy] Nenhuma tabela SINAPI encontrada para UF=% regime=%', p_uf, v_regime;
            RETURN 0;
        END IF;

        RAISE NOTICE '[expand_composition_hierarchy] Competência % não encontrada, usando fallback: %', p_competence, v_competence;
    END IF;

    -- Coletar todos os budget_item_ids deste budget
    SELECT array_agg(id) INTO v_budget_item_ids
    FROM budget_items
    WHERE budget_id = p_budget_id;

    IF v_budget_item_ids IS NULL THEN
        RETURN 0;
    END IF;

    -- Iterar até não encontrar mais composições para expandir (ou atingir max_depth)
    WHILE v_found_new AND v_depth < p_max_depth LOOP
        v_found_new := FALSE;
        v_depth := v_depth + 1;

        FOR v_comp IN
            SELECT bic.id, bic.metadata->>'code' AS comp_code, bic.budget_item_id
            FROM budget_item_compositions bic
            WHERE bic.budget_item_id = ANY(v_budget_item_ids)
              AND bic.metadata->>'type' = 'composition'
              AND NOT EXISTS (
                  SELECT 1 FROM budget_item_compositions child
                  WHERE child.parent_composition_id = bic.id
              )
              AND bic.metadata->>'code' IS NOT NULL
              AND bic.metadata->>'code' != ''
        LOOP
            FOR v_sub IN
                SELECT * FROM find_internal_composition(
                    v_comp.comp_code, p_uf, v_competence, p_desonerado
                )
            LOOP
                INSERT INTO budget_item_compositions (
                    budget_item_id, user_id, description, unit, quantity,
                    unit_price, total_price,
                    parent_composition_id, composition_code, metadata
                ) VALUES (
                    v_comp.budget_item_id,
                    p_user_id,
                    v_sub.item_description,
                    v_sub.item_unit,
                    v_sub.item_quantity,
                    v_sub.item_price,
                    ROUND(v_sub.item_quantity * v_sub.item_price, 2),
                    v_comp.id,
                    v_sub.item_code,
                    jsonb_build_object(
                        'code', v_sub.item_code,
                        'type', v_sub.item_type,
                        'source', 'SINAPI',
                        'depth', v_depth,
                        'competence', v_competence
                    )
                );

                v_total_inserted := v_total_inserted + 1;
                v_found_new := TRUE;
            END LOOP;
        END LOOP;
    END LOOP;

    RETURN v_total_inserted;
END;
$$;
