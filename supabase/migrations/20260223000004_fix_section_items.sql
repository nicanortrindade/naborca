-- ============================================================================
-- NABOORÇA • FINALIZE: FIX SECTION ITEMS (Pure Titles)
-- Migration: 20260223000004_fix_section_items.sql
-- Data: 2026-02-23
-- Objetivo: Evitar a inserção de itens vazios quando a IA detectar puramente
--           Linhas de Título/Seção, atualizando a descrição do nó pai.
-- ============================================================================

DROP FUNCTION IF EXISTS public.finalize_import_to_budget(uuid, uuid, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.finalize_import_to_budget(
        p_job_id uuid,
        p_user_id uuid,
        p_params jsonb DEFAULT '{}'::jsonb,
        p_analytic_data jsonb DEFAULT '{}'::jsonb
    ) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE -- Context
    v_job record;
    v_budget_id uuid;
    -- Stack / Hierarchy
    v_fallback_l1_id uuid;
    v_fallback_l2_id uuid;
    v_current_n1_id uuid;
    v_current_n2_id uuid;
    v_parent_id uuid;
    -- Item Processing
    v_item record;
    v_inserted_item_id uuid;
    v_items_processed int := 0;
    v_items_hydrated_a int := 0;
    v_items_hydrated_b int := 0;
    v_items_pending int := 0;
    -- Params
    v_uf text;
    v_competence text;
    v_desonerado boolean;
    v_use_parser boolean;
    -- Parser Variables
    v_description_text text;
    v_clean_description text;
    v_clean_code text;
    v_n1_match text;
    v_n2_match text;
    v_n3_match text;
    v_level int;
    v_numbering text;
    v_parser_warnings text [];
    -- Hydration
    v_found_path text;
    v_analytic_comp jsonb;
    v_analytic_item jsonb;
BEGIN -- 1. Setup & Validation
    SELECT * INTO v_job
    FROM public.import_jobs
    WHERE id = p_job_id;

    IF v_job.id IS NULL THEN 
        RETURN json_build_object('ok', false, 'reason', 'job_not_found');
    END IF;

    -- 1.1. STRICT FAILURE CHECK
    IF v_job.current_step = 'waiting_user_extraction_failed' THEN 
        RETURN json_build_object(
            'ok', false,
            'reason', 'extraction_failed_or_empty',
            'details', json_build_object('job_id', p_job_id, 'status', v_job.status, 'current_step', v_job.current_step)
        );
    END IF;

    -- 1.2. REAL ITEMS CHECK
    IF NOT EXISTS (
        SELECT 1
        FROM public.import_ai_items
        WHERE job_id = p_job_id
            AND (description NOT LIKE 'Falha na leitura automática%')
    ) THEN 
        RETURN json_build_object('ok', false, 'reason', 'extraction_failed_no_items');
    END IF;

    -- Params Extraction
    v_uf := COALESCE(p_params->>'uf', 'BA');
    v_competence := COALESCE(p_params->>'competence', to_char(now(), 'YYYY-MM'));
    v_desonerado := COALESCE((p_params->>'desonerado')::boolean, true);
    -- FORCED DEFAULT: enable_structure_parser_v1 is TRUE unless explicitly false in params
    v_use_parser := COALESCE((p_params->>'enable_structure_parser_v1')::boolean, true);

    -- 2. Budget Creation / Idempotency
    IF v_job.result_budget_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.budgets WHERE id = v_job.result_budget_id) THEN
        v_budget_id := v_job.result_budget_id;
        DELETE FROM public.budget_items WHERE budget_id = v_budget_id;
        DELETE FROM public.import_hydration_issues WHERE budget_id = v_budget_id;
        UPDATE public.budgets SET settings = p_params, updated_at = now(), sinapi_uf = v_uf, sinapi_competence = v_competence,
            sinapi_regime = CASE WHEN v_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END
        WHERE id = v_budget_id;
    ELSE
        INSERT INTO public.budgets (user_id, name, status, sinapi_uf, sinapi_competence, sinapi_regime, settings, created_at)
        VALUES (v_job.user_id, 'Orçamento Importado ' || to_char(now(), 'DD/MM HH24:MI'), 'draft', v_uf, v_competence,
            CASE WHEN v_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END, p_params, now())
        RETURNING id INTO v_budget_id;

        UPDATE public.import_jobs SET result_budget_id = v_budget_id WHERE id = p_job_id;
    END IF;

    -- 3. Synthetic Structure (Roots)
    INSERT INTO public.budget_items (budget_id, user_id, level, description, type, order_index)
    VALUES (v_budget_id, v_job.user_id, 1, 'IMPORTAÇÃO AUTOMÁTICA', 'group', 1)
    RETURNING id INTO v_fallback_l1_id;

    INSERT INTO public.budget_items (budget_id, user_id, level, parent_id, description, type, order_index)
    VALUES (v_budget_id, v_job.user_id, 2, v_fallback_l2_id, 'ITENS DA LISTA', 'group', 1)
    RETURNING id INTO v_fallback_l2_id;

    v_current_n1_id := NULL;
    v_current_n2_id := NULL;

    -- 4. Items Loop
    FOR v_item IN SELECT * FROM public.import_ai_items WHERE job_id = p_job_id ORDER BY idx ASC LOOP 
        v_items_processed := v_items_processed + 1;
        v_found_path := 'none';
        v_parser_warnings := ARRAY []::text [];
        v_description_text := v_item.description;
        v_clean_code := NULL;
        v_inserted_item_id := NULL;

        -- == PARSER LOGIC ==
        IF v_use_parser THEN
            v_level := 3;
            v_numbering := NULL;
            v_clean_description := v_description_text;
            v_parent_id := v_fallback_l2_id;

            IF v_item.item_path IS NOT NULL AND v_item.item_path ~ '^\d+(\.\d+){1,6}$' THEN
                DECLARE
                    v_path_parts  text[];
                    v_path_depth  int;
                    v_n1_key      text;
                    v_n2_key      text;
                    v_n3_key      text;
                    v_n1_id       uuid;
                    v_n2_id       uuid;
                    v_n3_id       uuid;
                BEGIN
                    v_path_parts := string_to_array(v_item.item_path, '.');
                    v_path_depth := array_length(v_path_parts, 1);
                    v_numbering  := v_item.item_path;

                    v_n1_key := v_path_parts[1];
                    v_n2_key := v_path_parts[1] || '.' || v_path_parts[2];
                    v_n3_key := CASE WHEN v_path_depth >= 3
                        THEN v_path_parts[1] || '.' || v_path_parts[2] || '.' || v_path_parts[3]
                        ELSE NULL END;

                    -- Busca ou cria N1
                    SELECT id INTO v_n1_id FROM public.budget_items
                    WHERE budget_id = v_budget_id
                      AND level = 1
                      AND hydration_details->>'path_key' = v_n1_key;

                    IF v_n1_id IS NULL THEN
                        INSERT INTO public.budget_items
                            (budget_id, user_id, level, description, type, order_index, hydration_details)
                        VALUES (v_budget_id, v_job.user_id, 1,
                            'SEÇÃO ' || v_n1_key, 'group', v_items_processed,
                            jsonb_build_object('parser', 'v1', 'path_key', v_n1_key))
                        RETURNING id INTO v_n1_id;
                    END IF;

                    -- Busca ou cria N2
                    SELECT id INTO v_n2_id FROM public.budget_items
                    WHERE budget_id = v_budget_id
                      AND level = 2
                      AND hydration_details->>'path_key' = v_n2_key;

                    IF v_n2_id IS NULL THEN
                        INSERT INTO public.budget_items
                            (budget_id, user_id, level, parent_id, description, type, order_index, hydration_details)
                        VALUES (v_budget_id, v_job.user_id, 2, v_n1_id,
                            'GRUPO ' || v_n2_key, 'group', v_items_processed,
                            jsonb_build_object('parser', 'v1', 'path_key', v_n2_key))
                        RETURNING id INTO v_n2_id;
                    END IF;

                    -- Busca ou cria N3 (se path tem 4+ segmentos)
                    IF v_path_depth >= 4 AND v_n3_key IS NOT NULL THEN
                        SELECT id INTO v_n3_id FROM public.budget_items
                        WHERE budget_id = v_budget_id
                          AND level = 3
                          AND hydration_details->>'path_key' = v_n3_key;

                        IF v_n3_id IS NULL THEN
                            INSERT INTO public.budget_items
                                (budget_id, user_id, level, parent_id, description, type, order_index, hydration_details)
                            VALUES (v_budget_id, v_job.user_id, 3, v_n2_id,
                                'SUBGRUPO ' || v_n3_key, 'group', v_items_processed,
                                jsonb_build_object('parser', 'v1', 'path_key', v_n3_key))
                            RETURNING id INTO v_n3_id;
                        END IF;
                        v_parent_id := v_n3_id;
                        v_level := 4;
                    ELSE
                        v_parent_id := v_n2_id;
                        v_level := 3;
                    END IF;
                END;

            ELSE
                -- Fallback: parser por regex na descrição (itens sem item_path)
                v_n3_match := substring(v_description_text FROM '^([0-9]+\.[0-9]+\.[0-9]+)\s');
                v_n2_match := substring(v_description_text FROM '^([0-9]+\.[0-9]+)\s');
                v_n1_match := substring(v_description_text FROM '^([0-9]+)\s');

                IF v_n3_match IS NOT NULL THEN
                    v_level := 3; v_numbering := v_n3_match;
                    v_clean_description := trim(substring(v_description_text FROM '^[0-9]+\.[0-9]+\.[0-9]+\s+(.*)'));
                ELSIF v_n2_match IS NOT NULL THEN
                    v_level := 2; v_numbering := v_n2_match;
                    v_clean_description := trim(substring(v_description_text FROM '^[0-9]+\.[0-9]+\s+(.*)'));
                ELSIF v_n1_match IS NOT NULL THEN
                    v_level := 1; v_numbering := v_n1_match;
                    v_clean_description := trim(substring(v_description_text FROM '^[0-9]+\s+(.*)'));
                ELSE
                    v_level := 3; v_clean_description := v_description_text;
                END IF;

                IF v_level = 1 THEN
                    INSERT INTO public.budget_items
                        (budget_id, user_id, level, description, type, order_index, hydration_details)
                    VALUES (v_budget_id, v_job.user_id, 1, v_clean_description, 'group', v_items_processed,
                        jsonb_build_object('parser', 'v1_regex', 'num', v_numbering))
                    RETURNING id INTO v_current_n1_id;
                    v_current_n2_id := NULL; CONTINUE;
                ELSIF v_level = 2 THEN
                    v_parent_id := COALESCE(v_current_n1_id, v_fallback_l1_id);
                    INSERT INTO public.budget_items
                        (budget_id, user_id, level, parent_id, description, type, order_index, hydration_details)
                    VALUES (v_budget_id, v_job.user_id, 2, v_parent_id, v_clean_description, 'group', v_items_processed,
                        jsonb_build_object('parser', 'v1_regex', 'num', v_numbering))
                    RETURNING id INTO v_current_n2_id; CONTINUE;
                ELSE
                    v_parent_id := COALESCE(v_current_n2_id, v_current_n1_id, v_fallback_l2_id);
                END IF;
            END IF;
        ELSE
            v_level := 3; v_clean_description := v_description_text; v_parent_id := v_fallback_l2_id;
        END IF;

        -- == INSERT L3 ITEM ==
        v_clean_code := COALESCE(v_item.composition_code, substring(v_clean_description FROM '^([0-9]{4,})'), '0');
        
        -- Skip pure section items (kind=composition, no code, no price)
        IF v_clean_code = '0' AND COALESCE(v_item.unit_price, 0) = 0 AND COALESCE(v_item.quantity, 0) = 0 THEN
            -- Try to update the section/group name if it was created with generic name
            IF v_level <= 2 OR (v_numbering IS NOT NULL AND v_parent_id IS NOT NULL) THEN
                UPDATE public.budget_items 
                SET description = v_clean_description
                WHERE id = v_parent_id 
                AND (description LIKE 'SEÇÃO %' OR description LIKE 'GRUPO %' OR description LIKE 'SUBGRUPO %');
            END IF;
            CONTINUE; -- Skip inserting this as a real item
        END IF;

        -- Skip multiline duplicate (same item_path, same price/qty as previous item, no code OR no values)
        IF v_item.composition_code IS NULL
           AND v_item.item_path IS NOT NULL
           AND (
               -- Case 1: no values at all
               (COALESCE(v_item.unit_price, 0) = 0 AND COALESCE(v_item.quantity, 0) = 0)
               OR
               -- Case 2: same values as a previous item with code on same path
               EXISTS (
                   SELECT 1 FROM public.import_ai_items
                   WHERE job_id = p_job_id
                     AND item_path = v_item.item_path
                     AND composition_code IS NOT NULL
                     AND idx < v_item.idx
                     AND ABS(COALESCE(unit_price, 0) - COALESCE(v_item.unit_price, 0)) < 0.01
                     AND ABS(COALESCE(quantity, 0) - COALESCE(v_item.quantity, 0)) < 0.01
               )
           ) THEN
            CONTINUE;
        END IF;

        -- Check 3: Skip coded multiline duplicate (same item_path, same code, same values, higher idx)
        IF v_item.composition_code IS NOT NULL
           AND v_item.item_path IS NOT NULL
           AND (
               (COALESCE(v_item.unit_price, 0) = 0 AND COALESCE(v_item.quantity, 0) = 0)
               OR
               EXISTS (
                   SELECT 1 FROM public.import_ai_items
                   WHERE job_id = p_job_id
                     AND item_path = v_item.item_path
                     AND composition_code = v_item.composition_code
                     AND idx < v_item.idx
                     AND ABS(COALESCE(unit_price, 0) - COALESCE(v_item.unit_price, 0)) < 0.01
                     AND ABS(COALESCE(quantity, 0) - COALESCE(v_item.quantity, 0)) < 0.01
               )
           ) THEN
            CONTINUE;
        END IF;

        INSERT INTO public.budget_items (budget_id, user_id, level, parent_id, description, unit, quantity, unit_price, 
            total_price, final_price, type, source, code, source_import_item_id, order_index, hydration_details)
        VALUES (v_budget_id, v_job.user_id, 3, v_parent_id, v_clean_description, COALESCE(v_item.unit, 'UN'), 
            COALESCE(v_item.quantity, 1), COALESCE(v_item.unit_price, 0), 
            (COALESCE(v_item.quantity, 1) * COALESCE(v_item.unit_price, 0)),
            (COALESCE(v_item.quantity, 1) * COALESCE(v_item.unit_price, 0)),
            'insumo',
            CASE WHEN v_item.composition_code IS NOT NULL THEN 'AI_EXTRACTED_CODE' ELSE 'IMPORTADO' END,
            v_clean_code, v_item.id, v_items_processed,
            jsonb_build_object('parser', CASE WHEN v_use_parser THEN 'v1' ELSE 'flat' END, 'num', v_numbering))
        RETURNING id INTO v_inserted_item_id;

        -- == HYDRATION ==
        IF v_clean_code != '0' THEN
            -- ── Hydration A (SINAPI + Bases Externas) ────────────────────────────
            -- Substituído find_internal_composition por find_composition_in_bases
            -- para incluir ORSE, CPU, EMOP e outras bases carregadas pelo usuário.
            -- source_base é propagado para metadata em vez do literal 'internal_db'.
            IF EXISTS (SELECT 1 FROM public.find_composition_in_bases(v_clean_code, v_job.user_id, v_uf, v_competence, v_desonerado)) THEN
                INSERT INTO public.budget_item_compositions (budget_item_id, user_id, description, unit, quantity, unit_price, total_price, metadata)
                SELECT v_inserted_item_id, v_job.user_id, item_description, item_unit, item_quantity, item_price, (item_quantity * item_price),
                    jsonb_build_object('source', source_base, 'code', v_clean_code)
                FROM public.find_composition_in_bases(v_clean_code, v_job.user_id, v_uf, v_competence, v_desonerado);
                v_found_path := 'internal_db'; v_items_hydrated_a := v_items_hydrated_a + 1;
            
            -- ── Hydration B (Analytic) — inalterado ──────────────────────────────
            ELSIF p_analytic_data ? v_clean_code THEN
                v_analytic_comp := p_analytic_data->v_clean_code;
                FOR v_analytic_item IN SELECT * FROM jsonb_array_elements(v_analytic_comp->'items') LOOP
                    INSERT INTO public.budget_item_compositions (budget_item_id, user_id, description, unit, quantity, unit_price, total_price, metadata)
                    VALUES (v_inserted_item_id, v_job.user_id, v_analytic_item->>'description', v_analytic_item->>'unit', 
                        (v_analytic_item->>'coefficient')::numeric, (v_analytic_item->>'price')::numeric,
                        ((v_analytic_item->>'coefficient')::numeric * (v_analytic_item->>'price')::numeric),
                        jsonb_build_object('source', 'analytic_file', 'code', v_clean_code));
                END LOOP;
                v_found_path := 'analytic_file'; v_items_hydrated_b := v_items_hydrated_b + 1;
            END IF;
        END IF;

        -- Status
        IF v_found_path = 'none' THEN 
            v_items_pending := v_items_pending + 1;
            UPDATE public.budget_items SET hydration_status = 'pending_review' WHERE id = v_inserted_item_id;
            INSERT INTO public.import_hydration_issues (job_id, budget_id, budget_item_id, issue_type, original_code, original_description)
            VALUES (p_job_id, v_budget_id, v_inserted_item_id, 'missing_composition', v_clean_code, v_item.description);
        ELSE
            UPDATE public.budget_items SET hydration_status = v_found_path WHERE id = v_inserted_item_id;
        END IF;
    END LOOP;

    UPDATE public.import_jobs SET stage = 'finalized', finalized_at = now() WHERE id = p_job_id;
    RETURN json_build_object('ok', true, 'budget_id', v_budget_id, 'stats', json_build_object('total', v_items_processed, 'internal', v_items_hydrated_a, 'analytic', v_items_hydrated_b));
EXCEPTION WHEN OTHERS THEN 
    RAISE WARNING 'Finalize Error: %', SQLERRM;
    RETURN json_build_object('ok', false, 'reason', SQLERRM);
END;
$$;
