-- =============================================================================
-- Migration M16: Fix duplicates, phantom items, and unitario groups
-- 
-- Based on M11 (stable) structure + M15 BDI ratio feature.
-- 
-- FIXES:
--   Bug 1 - Duplicates: Added robust deduplication by checking budget_items
--           for existing item with same (parent_id, description, unit_price, qty)
--           Scoped by parent_id to allow legitimate repeats across subsections
--   Bug 2 - Phantom items: Reject items where composition_code IS NULL and
--           derived code = '0' regardless of whether they have a price
--   Bug 3 - Unitary groups: Restored M11 depth-based branching (depth=2
--           creates group ONLY for titles, items go directly under N1)
--   Bug 4 - Subsection order: Use order_index from item idx to preserve
--           original PDF ordering
--
-- PRESERVED from M15: BDI ratio calculation from total/(qty*unit_price)
-- NO CHANGES to: index.ts, stageA, stageB, ImportReviewPage, calculationEngine
-- =============================================================================

CREATE OR REPLACE FUNCTION public.finalize_import_to_budget(
    p_job_id uuid,
    p_user_id uuid,
    p_params jsonb DEFAULT '{}'::jsonb,
    p_analytic_data jsonb DEFAULT '{}'::jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_job record;
    v_budget_id uuid;
    v_fallback_l1_id uuid;
    v_fallback_l2_id uuid;
    v_current_n1_id uuid;
    v_current_n2_id uuid;
    v_parent_id uuid;
    v_item record;
    v_inserted_item_id uuid;
    v_items_processed int := 0;
    v_uf text;
    v_competence text;
    v_desonerado boolean;
    v_use_parser boolean;
    v_description_text text;
    v_clean_description text;
    v_clean_code text;
    v_n1_match text;
    v_n2_match text;
    v_n3_match text;
    v_level int;
    v_numbering text;
    v_parser_warnings text[];
    v_path_parts text[];
    v_path_depth int;
    v_n1_key text;
    v_n2_key text;
    v_n3_key text;
    v_n1_id uuid;
    v_n2_id uuid;
    v_n3_id uuid;
    v_inferred_name text;
    -- M15: BDI calculation variables (preserved)
    v_bdi_calc numeric;
    v_bdi_ratio numeric;
    v_bdi_rate_elem record;
    v_bdi_rate_val numeric;
    v_bdi_expected numeric;
BEGIN
    SET LOCAL statement_timeout = '300s';

    SELECT * INTO v_job
    FROM public.import_jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF v_job.id IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'job_not_found');
    END IF;

    IF v_job.current_step = 'waiting_user_extraction_failed' THEN
        RETURN json_build_object(
            'ok', false,
            'reason', 'extraction_failed_or_empty',
            'details', json_build_object('job_id', p_job_id, 'status', v_job.status, 'current_step', v_job.current_step)
        );
    END IF;

    v_uf        := COALESCE(p_params->>'uf', 'BA');
    v_competence := COALESCE(p_params->>'competence', to_char(now(), 'YYYY-MM'));
    v_desonerado := COALESCE((p_params->>'desonerado')::boolean, true);
    v_use_parser := COALESCE((p_params->>'enable_structure_parser_v1')::boolean, true);

    IF v_job.result_budget_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.budgets WHERE id = v_job.result_budget_id
    ) THEN
        IF v_job.stage IN ('pending_hydration', 'finalized') THEN
            RETURN json_build_object(
                'ok', true,
                'budget_id', v_job.result_budget_id,
                'stage', v_job.stage,
                'already_finalized', true
            );
        END IF;

        v_budget_id := v_job.result_budget_id;
        DELETE FROM public.budget_items WHERE budget_id = v_budget_id;
        DELETE FROM public.import_hydration_issues WHERE budget_id = v_budget_id;
        UPDATE public.budgets
        SET settings = p_params, updated_at = now(), sinapi_uf = v_uf,
            sinapi_competence = v_competence,
            sinapi_regime = CASE WHEN v_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END
        WHERE id = v_budget_id;
    ELSE
        INSERT INTO public.budgets (user_id, name, status, sinapi_uf, sinapi_competence, sinapi_regime, settings, created_at)
        VALUES (v_job.user_id, 'Orçamento Importado ' || to_char(now(), 'DD/MM HH24:MI'), 'draft',
            v_uf, v_competence,
            CASE WHEN v_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END,
            p_params, now())
        RETURNING id INTO v_budget_id;

        UPDATE public.import_jobs SET result_budget_id = v_budget_id WHERE id = p_job_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.import_ai_items
        WHERE job_id = p_job_id
          AND (description NOT LIKE 'Falha na leitura automática%')
    ) THEN
        RETURN json_build_object('ok', false, 'reason', 'extraction_failed_no_items');
    END IF;

    UPDATE public.budgets
    SET settings = settings || jsonb_build_object(
        '_hydration_params', jsonb_build_object(
            'uf', v_uf, 'competence', v_competence,
            'desonerado', v_desonerado, 'analytic_data', p_analytic_data
        )
    )
    WHERE id = v_budget_id;

    v_fallback_l1_id := NULL;
    v_fallback_l2_id := NULL;
    v_current_n1_id  := NULL;
    v_current_n2_id  := NULL;

    FOR v_item IN
        SELECT * FROM public.import_ai_items
        WHERE job_id = p_job_id
        ORDER BY idx ASC
    LOOP
        v_items_processed   := v_items_processed + 1;
        v_parser_warnings   := ARRAY[]::text[];
        v_description_text  := v_item.description;
        v_clean_code        := NULL;
        v_inserted_item_id  := NULL;

        IF v_description_text IS NULL OR trim(v_description_text) = '' THEN
            CONTINUE;
        END IF;

        IF v_use_parser THEN
            v_level             := 3;
            v_numbering         := NULL;
            v_clean_description := v_description_text;
            v_parent_id         := v_fallback_l2_id;

            IF v_item.item_path IS NOT NULL AND v_item.item_path ~ '^\d+(\.\d+){1,6}$' THEN
                BEGIN
                    v_path_parts := string_to_array(v_item.item_path, '.');
                    v_path_depth := array_length(v_path_parts, 1);
                    v_numbering  := v_item.item_path;

                    v_n1_key := v_path_parts[1];
                    v_n2_key := v_path_parts[1] || '.' || v_path_parts[2];
                    v_n3_key := CASE WHEN v_path_depth >= 3
                        THEN v_path_parts[1] || '.' || v_path_parts[2] || '.' || v_path_parts[3]
                        ELSE NULL END;

                    -- N1 (same as M11)
                    SELECT id INTO v_n1_id FROM public.budget_items
                    WHERE budget_id = v_budget_id AND level = 1
                      AND hydration_details->>'path_key' = v_n1_key;

                    IF v_n1_id IS NULL THEN
                        IF v_path_depth = 1 AND v_item.composition_code IS NULL THEN
                            v_inferred_name := v_clean_description;
                        ELSE
                            SELECT description INTO v_inferred_name
                            FROM public.import_ai_items
                            WHERE job_id = p_job_id
                              AND item_path = v_n1_key
                              AND composition_code IS NULL
                              AND length(trim(description)) >= 5
                              AND trim(description) !~* '^\s*(TOTAL|SUBTOTAL|BDI)'
                            ORDER BY idx ASC
                            LIMIT 1;
                        END IF;

                        INSERT INTO public.budget_items
                            (budget_id, user_id, level, description, type, order_index, hydration_details)
                        VALUES (v_budget_id, v_job.user_id, 1,
                            COALESCE(v_inferred_name, 'SEÇÃO ' || v_n1_key),
                            'group', v_items_processed,
                            jsonb_build_object('parser', 'v1', 'path_key', v_n1_key))
                        RETURNING id INTO v_n1_id;

                        IF v_inferred_name IS NOT NULL AND EXISTS (
                            SELECT 1 FROM public.budget_items
                            WHERE budget_id = v_budget_id AND level = 1
                              AND description = v_inferred_name AND id != v_n1_id
                        ) THEN
                            UPDATE public.budget_items
                            SET description = v_inferred_name || ' (Seção ' || v_n1_key || ')'
                            WHERE id = v_n1_id;
                        END IF;
                    END IF;

                    -- =========================================================
                    -- depth = 2: M11 LOGIC RESTORED (Bug 3 fix)
                    -- Title items (no code, no price) → create N2 group + CONTINUE
                    -- Data items (has price/qty) → insert directly under N1
                    -- =========================================================
                    IF v_path_depth = 2 THEN
                        IF v_item.composition_code IS NULL
                           AND COALESCE(v_item.unit_price, 0) = 0
                           AND COALESCE(v_item.quantity, 0) = 0 THEN

                            IF v_clean_description ~* '^\s*TOTAL\s*(SEM|COM)\s*BDI'
                               OR v_clean_description ~* '^\s*TOTAL\s*GERAL'
                               OR v_clean_description ~* '^\s*SUBTOTAL'
                               OR trim(v_clean_description) ~* '^TOTAL$' THEN
                                CONTINUE;
                            END IF;

                            SELECT id INTO v_n2_id FROM public.budget_items
                            WHERE budget_id = v_budget_id AND level = 2
                              AND hydration_details->>'path_key' = v_n2_key;

                            IF v_n2_id IS NULL THEN
                                -- M11 FIX: use current item description as group name
                                INSERT INTO public.budget_items
                                    (budget_id, user_id, level, parent_id, description, type, order_index, hydration_details)
                                VALUES (v_budget_id, v_job.user_id, 2, v_n1_id,
                                    v_clean_description,
                                    'group', v_items_processed,
                                    jsonb_build_object('parser', 'v1', 'path_key', v_n2_key))
                                RETURNING id INTO v_n2_id;
                            ELSE
                                UPDATE public.budget_items
                                SET description = v_clean_description
                                WHERE budget_id = v_budget_id
                                  AND hydration_details->>'path_key' = v_n2_key
                                  AND (description LIKE 'GRUPO %');
                            END IF;
                            CONTINUE;
                        ELSE
                            -- depth=2 item WITH data → insert directly under N1
                            v_parent_id := v_n1_id;
                            v_level     := 3;
                        END IF;

                    -- depth = 3 (same as M11)
                    ELSIF v_path_depth = 3 THEN
                        IF v_clean_description ~* '^\s*TOTAL\s*(SEM|COM)\s*BDI'
                           OR v_clean_description ~* '^\s*TOTAL\s*GERAL'
                           OR v_clean_description ~* '^\s*SUBTOTAL'
                           OR trim(v_clean_description) ~* '^TOTAL$' THEN
                            CONTINUE;
                        END IF;

                        SELECT id INTO v_n2_id FROM public.budget_items
                        WHERE budget_id = v_budget_id AND level = 2
                          AND hydration_details->>'path_key' = v_n2_key;

                        IF v_n2_id IS NULL THEN
                            SELECT description INTO v_inferred_name
                            FROM public.import_ai_items
                            WHERE job_id = p_job_id
                              AND item_path = v_n2_key
                              AND composition_code IS NULL
                              AND length(trim(description)) >= 5
                              AND trim(description) !~* '^\s*(TOTAL|SUBTOTAL|BDI)'
                            ORDER BY idx ASC
                            LIMIT 1;

                            INSERT INTO public.budget_items
                                (budget_id, user_id, level, parent_id, description, type, order_index, hydration_details)
                            VALUES (v_budget_id, v_job.user_id, 2, v_n1_id,
                                COALESCE(v_inferred_name, 'GRUPO ' || v_n2_key),
                                'group', v_items_processed,
                                jsonb_build_object('parser', 'v1', 'path_key', v_n2_key))
                            RETURNING id INTO v_n2_id;
                        END IF;

                        v_parent_id := v_n2_id;
                        v_level     := 3;

                    -- depth >= 4 (same as M11)
                    ELSIF v_path_depth >= 4 THEN
                        IF v_clean_description ~* '^\s*TOTAL\s*(SEM|COM)\s*BDI'
                           OR v_clean_description ~* '^\s*TOTAL\s*GERAL'
                           OR v_clean_description ~* '^\s*SUBTOTAL'
                           OR trim(v_clean_description) ~* '^TOTAL$' THEN
                            CONTINUE;
                        END IF;

                        SELECT id INTO v_n2_id FROM public.budget_items
                        WHERE budget_id = v_budget_id AND level = 2
                          AND hydration_details->>'path_key' = v_n2_key;

                        IF v_n2_id IS NULL THEN
                            SELECT description INTO v_inferred_name
                            FROM public.import_ai_items
                            WHERE job_id = p_job_id
                              AND item_path = v_n2_key
                              AND composition_code IS NULL
                              AND length(trim(description)) >= 5
                              AND trim(description) !~* '^\s*(TOTAL|SUBTOTAL|BDI)'
                            ORDER BY idx ASC
                            LIMIT 1;

                            INSERT INTO public.budget_items
                                (budget_id, user_id, level, parent_id, description, type, order_index, hydration_details)
                            VALUES (v_budget_id, v_job.user_id, 2, v_n1_id,
                                COALESCE(v_inferred_name, 'GRUPO ' || v_n2_key),
                                'group', v_items_processed,
                                jsonb_build_object('parser', 'v1', 'path_key', v_n2_key))
                            RETURNING id INTO v_n2_id;
                        END IF;

                        v_n3_key := v_path_parts[1] || '.' || v_path_parts[2] || '.' || v_path_parts[3];

                        SELECT id INTO v_n3_id FROM public.budget_items
                        WHERE budget_id = v_budget_id AND level = 3
                          AND hydration_details->>'path_key' = v_n3_key
                          AND type = 'group';

                        IF v_n3_id IS NULL THEN
                            SELECT description INTO v_inferred_name
                            FROM public.import_ai_items
                            WHERE job_id = p_job_id
                              AND item_path = v_n3_key
                              AND composition_code IS NULL
                              AND length(trim(description)) >= 5
                              AND trim(description) !~* '^\s*(TOTAL|SUBTOTAL|BDI)'
                            ORDER BY idx ASC
                            LIMIT 1;

                            INSERT INTO public.budget_items
                                (budget_id, user_id, level, parent_id, description, type, order_index, hydration_details)
                            VALUES (v_budget_id, v_job.user_id, 3, v_n2_id,
                                COALESCE(v_inferred_name, 'GRUPO ' || v_n3_key),
                                'group', v_items_processed,
                                jsonb_build_object('parser', 'v1', 'path_key', v_n3_key))
                            RETURNING id INTO v_n3_id;
                        END IF;

                        v_parent_id := v_n3_id;
                        v_level     := 4;
                    END IF;
                END;

            ELSE
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
                    IF v_parent_id IS NULL THEN
                        INSERT INTO public.budget_items
                            (budget_id, user_id, level, description, type, order_index)
                        VALUES (v_budget_id, v_job.user_id, 1, 'IMPORTAÇÃO AUTOMÁTICA', 'group', 0)
                        RETURNING id INTO v_fallback_l1_id;
                        v_parent_id := v_fallback_l1_id;
                    END IF;
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

        -- INSERT item real (L3)
        v_clean_code := COALESCE(
            v_item.composition_code,
            substring(v_clean_description FROM '^([0-9]{4,})'),
            '0'
        );

        -- =================================================================
        -- FILTER: Skip title-only items with no data (same as M11)
        -- =================================================================
        IF v_clean_code = '0'
           AND COALESCE(v_item.unit_price, 0) = 0
           AND COALESCE(v_item.quantity, 0) = 0 THEN
            IF v_numbering IS NOT NULL THEN
                UPDATE public.budget_items
                SET description = v_clean_description
                WHERE budget_id = v_budget_id
                  AND hydration_details->>'path_key' = v_numbering
                  AND (description LIKE 'SEÇÃO %' OR description LIKE 'GRUPO %' OR description LIKE 'SUBGRUPO %');
            END IF;
            CONTINUE;
        END IF;

        -- =================================================================
        -- BUG 2 FIX: Reject phantom items (composition_code IS NULL, code='0')
        -- These are OCR fragments like "INSTALAÇÃO. AF_08/2021" that got
        -- extracted as items with price but no real composition code.
        -- =================================================================
        IF v_item.composition_code IS NULL
           AND v_clean_code = '0'
           AND COALESCE(v_item.unit_price, 0) > 0 THEN
            CONTINUE;
        END IF;

        IF v_clean_description ILIKE '%INSTALAÇÕES HIDROSSANITÁRIAS%'
           AND v_item.composition_code IS NULL THEN
            CONTINUE;
        END IF;

        IF (v_item.composition_code IS NULL OR trim(v_clean_code) = '0')
           AND EXISTS (
               SELECT 1 FROM public.budget_items
               WHERE budget_id = v_budget_id AND level IN (1, 2) AND type = 'group'
                 AND upper(trim(description)) = upper(trim(v_clean_description))
           ) THEN
            CONTINUE;
        END IF;

        -- Existing dedup: same code + same qty + same price already in budget
        -- Scoped by parent_id to preserve legit repeats across subsections
        IF v_item.composition_code IS NOT NULL
           AND trim(v_item.composition_code) <> '0'
           AND v_item.raw_line IS NOT NULL
           AND v_item.raw_line !~ '^\s*\d+\.\d+'
           AND EXISTS (
               SELECT 1 FROM public.budget_items
               WHERE budget_id = v_budget_id
                 AND code = v_item.composition_code
                 AND parent_id = v_parent_id
                 AND quantity = v_item.quantity
                 AND unit_price = v_item.unit_price
           ) THEN
            CONTINUE;
        END IF;

        -- Existing dedup: same path + same values (no code) in import_ai_items
        IF v_item.composition_code IS NULL
           AND v_item.item_path IS NOT NULL
           AND EXISTS (
               SELECT 1 FROM public.import_ai_items
               WHERE job_id = p_job_id
                 AND item_path = v_item.item_path
                 AND ABS(COALESCE(unit_price, 0) - COALESCE(v_item.unit_price, 0)) < 0.01
                 AND ABS(COALESCE(quantity, 0) - COALESCE(v_item.quantity, 0)) < 0.01
                 AND idx < v_item.idx
           ) THEN
            CONTINUE;
        END IF;

        -- Existing dedup: zero-qty duplicate with same code
        IF v_item.composition_code IS NOT NULL
           AND v_item.item_path IS NOT NULL
           AND COALESCE(v_item.quantity, 0) = 0
           AND EXISTS (
               SELECT 1 FROM public.import_ai_items
               WHERE job_id = p_job_id
                 AND item_path = v_item.item_path
                 AND composition_code = v_item.composition_code
                 AND quantity IS NOT NULL AND quantity > 0
                 AND idx != v_item.idx
           ) THEN
            CONTINUE;
        END IF;

        -- Existing dedup: same code + same path, keep first
        IF v_item.composition_code IS NOT NULL
           AND v_item.item_path IS NOT NULL
           AND COALESCE(v_item.quantity, 0) > 0
           AND EXISTS (
               SELECT 1 FROM public.import_ai_items
               WHERE job_id = p_job_id
                 AND item_path = v_item.item_path
                 AND composition_code = v_item.composition_code
                 AND quantity IS NOT NULL AND quantity > 0
                 AND idx < v_item.idx
           ) THEN
            CONTINUE;
        END IF;

        -- =================================================================
        -- BUG 1 FIX: Robust deduplication by (parent, description, price, qty)
        -- Catches duplicates with different item_paths (OCR variation)
        -- or different composition_codes but same actual values.
        -- Scoped by parent_id: same item in different subsections is LEGIT
        -- (e.g. CPU2634 Eletroduto 1¼" in 16.1.74 and 16.2.9)
        -- =================================================================
        IF COALESCE(v_item.unit_price, 0) > 0
           AND COALESCE(v_item.quantity, 0) > 0
           AND EXISTS (
               SELECT 1 FROM public.budget_items
               WHERE budget_id = v_budget_id
                 AND type = 'insumo'
                 AND parent_id = v_parent_id
                 AND ABS(unit_price - COALESCE(v_item.unit_price, 0)) < 0.01
                 AND ABS(quantity - COALESCE(v_item.quantity, 0)) < 0.01
                 AND upper(trim(description)) = upper(trim(v_clean_description))
           ) THEN
            CONTINUE;
        END IF;

        -- Skip TOTAL lines
        IF v_clean_description ~* '^\s*TOTAL\s*(SEM|COM)\s*BDI'
           OR v_clean_description ~* '^\s*TOTAL\s*GERAL'
           OR v_clean_description ~* '^\s*SUBTOTAL'
           OR trim(v_clean_description) ~* '^TOTAL$' THEN
            CONTINUE;
        END IF;

        IF v_parent_id IS NULL THEN
            IF v_fallback_l1_id IS NULL THEN
                INSERT INTO public.budget_items
                    (budget_id, user_id, level, description, type, order_index)
                VALUES (v_budget_id, v_job.user_id, 1, 'IMPORTAÇÃO AUTOMÁTICA', 'group', 0)
                RETURNING id INTO v_fallback_l1_id;
            END IF;
            IF v_fallback_l2_id IS NULL THEN
                INSERT INTO public.budget_items
                    (budget_id, user_id, level, parent_id, description, type, order_index)
                VALUES (v_budget_id, v_job.user_id, 2, v_fallback_l1_id, 'ITENS DA LISTA', 'group', 0)
                RETURNING id INTO v_fallback_l2_id;
            END IF;
            v_parent_id := v_fallback_l2_id;
        END IF;

        -- =====================================================================
        -- M15 PRESERVED: Calculate BDI from total / (qty * unit_price) ratio
        -- Then match against bdi_rates from frontend params
        -- =====================================================================
        v_bdi_calc := NULL;
        IF COALESCE(v_item.quantity, 0) > 0
           AND COALESCE(v_item.unit_price, 0) > 0
           AND COALESCE(v_item.total, 0) > 0
           AND p_params ? 'bdi_rates' THEN
            v_bdi_ratio := v_item.total::numeric / (v_item.quantity::numeric * v_item.unit_price::numeric);

            FOR v_bdi_rate_elem IN SELECT * FROM jsonb_array_elements(p_params->'bdi_rates')
            LOOP
                IF COALESCE((v_bdi_rate_elem.value->>'is_default')::boolean, false) IS NOT TRUE THEN
                    v_bdi_rate_val := (v_bdi_rate_elem.value->>'value')::numeric;
                    v_bdi_expected := 1.0 + v_bdi_rate_val / 100.0;
                    IF ABS(v_bdi_ratio - v_bdi_expected) <= 0.02 THEN
                        v_bdi_calc := v_bdi_rate_val;
                        EXIT;
                    END IF;
                END IF;
            END LOOP;
        END IF;

        INSERT INTO public.budget_items (
            budget_id, user_id, level, parent_id, description, unit,
            quantity, unit_price, total_price, final_price, type,
            source, code, source_import_item_id, order_index,
            hydration_details, hydration_status,
            custom_bdi
        )
        VALUES (
            v_budget_id, v_job.user_id, LEAST(v_level, 3), v_parent_id,
            v_clean_description, COALESCE(v_item.unit, 'UN'),
            COALESCE(v_item.quantity, 0),
            COALESCE(v_item.unit_price, 0),
            (COALESCE(v_item.quantity, 0) * COALESCE(v_item.unit_price, 0)),
            (COALESCE(v_item.quantity, 0) * COALESCE(v_item.unit_price, 0)),
            'insumo',
            COALESCE(v_item.price_source,
                CASE WHEN v_item.composition_code IS NOT NULL THEN 'AI_EXTRACTED_CODE' ELSE 'IMPORTADO' END),
            v_clean_code, v_item.id, v_items_processed,
            jsonb_build_object('parser', CASE WHEN v_use_parser THEN 'v1' ELSE 'flat' END, 'path_key', v_numbering),
            CASE
                WHEN COALESCE(v_item.quantity, 0) = 0 OR COALESCE(v_item.unit_price, 0) = 0
                THEN 'pending_hydration'
                ELSE 'pending_review'
            END,
            v_bdi_calc
        )
        RETURNING id INTO v_inserted_item_id;

    END LOOP;

    UPDATE public.import_jobs
    SET stage = 'pending_hydration', updated_at = now()
    WHERE id = p_job_id;

    RETURN json_build_object(
        'ok', true,
        'budget_id', v_budget_id,
        'stage', 'pending_hydration',
        'stats', json_build_object('total_inserted', v_items_processed)
    );

EXCEPTION WHEN OTHERS THEN
    UPDATE public.import_jobs
    SET stage = CASE
        WHEN result_budget_id IS NOT NULL THEN 'pending_hydration'
        ELSE 'extraction_complete'
    END
    WHERE id = p_job_id AND stage = 'finalizing';

    RAISE WARNING 'Finalize Error: %', SQLERRM;
    RETURN json_build_object('ok', false, 'reason', SQLERRM);
END;

$$;
