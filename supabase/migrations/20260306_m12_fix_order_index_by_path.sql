-- =============================================================================
-- Migration M12: Fix order_index to use path-based formula instead of
--               v_items_processed counter.
-- Formula:
--   Level 1: part1 * 100
--   Level 2: part1 * 100 + part2 * 10
--   Level 3: part1 * 100 + part2 * 10 + part3
-- This ensures correct ordering even when AI extracts items out of sequence.
-- Fixes: TETO (12.2) appearing after ESQUADRIAS (12.3).
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
    v_budget_settings jsonb;
    v_params jsonb;
    v_uf text;
    v_competence date;
    v_desonerado boolean;
    v_item public.import_ai_items%ROWTYPE;
    v_existing_item record;
    v_total_inserted integer := 0;
    v_total_skipped integer := 0;
    v_total_phantom integer := 0;
    v_n1_id uuid;
    v_n2_id uuid;
    v_n3_id uuid;
    v_path_parts text[];
    v_n1_label text;
    v_n2_label text;
    v_n3_label text;
    v_item_type text;
    v_depth integer;
    v_stopword_n1 uuid := NULL;
    v_stopword_n2 uuid := NULL;
    v_fallback_n1_id uuid := NULL;
    v_fallback_n2_id uuid := NULL;
    v_enable_structure_parser_v1 boolean := true;
    -- M12: path-based order_index
    v_part1 integer;
    v_part2 integer;
    v_part3 integer;
    v_order_n1 integer;
    v_order_n2 integer;
    v_order_n3 integer;
BEGIN
    -- -------------------------------------------------------------------------
    -- 1. Lock & validate job
    -- -------------------------------------------------------------------------
    SELECT * INTO v_job
    FROM public.import_jobs
    WHERE id = p_job_id
      AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'reason', 'job_not_found');
    END IF;

    IF v_job.stage NOT IN ('extraction_complete', 'finalizing', 'pending_hydration') THEN
        RETURN json_build_object('ok', false, 'reason', 'invalid_stage', 'stage', v_job.stage);
    END IF;

    UPDATE public.import_jobs SET stage = 'finalizing' WHERE id = p_job_id;

    -- -------------------------------------------------------------------------
    -- 2. Extract parameters
    -- -------------------------------------------------------------------------
    v_params := COALESCE(v_job.params, p_params, '{}'::jsonb);
    v_uf := COALESCE(v_params->>'uf', 'SP');
    v_competence := COALESCE((v_params->>'competence')::date, CURRENT_DATE);
    v_desonerado := COALESCE((v_params->>'desonerado')::boolean, false);

    -- -------------------------------------------------------------------------
    -- 3. already_finalized guard
    -- -------------------------------------------------------------------------
    IF v_job.result_budget_id IS NOT NULL THEN
        RETURN json_build_object(
            'ok', true,
            'budget_id', v_job.result_budget_id,
            'stage', 'finalized',
            'already_finalized', true
        );
    END IF;

    -- -------------------------------------------------------------------------
    -- 4. Budget creation / re-use
    -- -------------------------------------------------------------------------
    v_budget_settings := jsonb_build_object(
        'uf', v_uf,
        'competence', v_competence,
        'desonerado', v_desonerado
    );

    INSERT INTO public.budgets (user_id, name, settings, status)
    VALUES (
        p_user_id,
        COALESCE(v_job.original_filename, 'Orçamento Importado'),
        v_budget_settings,
        'draft'
    )
    RETURNING id INTO v_budget_id;

    -- clean previous items (idempotent)
    DELETE FROM public.budget_items WHERE budget_id = v_budget_id;

    -- -------------------------------------------------------------------------
    -- 5. Update budget settings
    -- -------------------------------------------------------------------------
    UPDATE public.budgets
    SET settings = v_budget_settings
    WHERE id = v_budget_id;

    -- =========================================================================
    -- 6. Main loop — insert items
    -- =========================================================================
    FOR v_item IN
        SELECT * FROM public.import_ai_items
        WHERE job_id = p_job_id
        ORDER BY idx
    LOOP

        -- -------------------------------------------------------------------
        -- 6.1 Validate item_path
        -- -------------------------------------------------------------------
        v_path_parts := string_to_array(v_item.item_path, '.');
        v_depth := array_length(v_path_parts, 1);

        IF v_depth IS NULL OR v_depth < 1 OR v_depth > 4 THEN
            v_total_skipped := v_total_skipped + 1;
            CONTINUE;
        END IF;

        -- -------------------------------------------------------------------
        -- M12: Calculate path-based order indexes
        -- -------------------------------------------------------------------
        v_part1 := COALESCE(NULLIF(v_path_parts[1], '')::integer, 0);
        v_part2 := CASE WHEN v_depth >= 2 THEN COALESCE(NULLIF(v_path_parts[2], '')::integer, 0) ELSE 0 END;
        v_part3 := CASE WHEN v_depth >= 3 THEN COALESCE(NULLIF(v_path_parts[3], '')::integer, 0) ELSE 0 END;

        v_order_n1 := v_part1 * 100;
        v_order_n2 := v_part1 * 100 + v_part2 * 10;
        v_order_n3 := v_part1 * 100 + v_part2 * 10 + v_part3;

        -- -------------------------------------------------------------------
        -- 6.2 Skip totals / subtotals
        -- -------------------------------------------------------------------
        IF lower(trim(v_item.description)) IN (
            'total', 'subtotal', 'total geral', 'total da etapa',
            'total da seção', 'total da secao', 'total do grupo',
            'total parcial', 'sub-total', 'sub total'
        ) THEN
            v_total_skipped := v_total_skipped + 1;
            CONTINUE;
        END IF;

        -- -------------------------------------------------------------------
        -- 6.3 Clean description
        -- -------------------------------------------------------------------
        DECLARE
            v_clean_description text;
        BEGIN
            v_clean_description := trim(v_item.description);

            -- =================================================================
            -- PARSER V1: depth-based hierarchy
            -- =================================================================
            IF v_enable_structure_parser_v1 THEN

                -- -------------------------------------------------------------
                -- DEPTH 1 — Section (N1)
                -- -------------------------------------------------------------
                IF v_depth = 1 THEN

                    -- M11: use current item description directly for section title
                    v_n1_label := v_clean_description;

                    -- Upsert N1
                    SELECT id INTO v_n1_id
                    FROM public.budget_items
                    WHERE budget_id = v_budget_id
                      AND level = 1
                      AND hydration_details->>'path_key' = v_item.item_path;

                    IF v_n1_id IS NULL THEN
                        INSERT INTO public.budget_items (
                            budget_id, user_id, description, level,
                            parent_id, order_index, type,
                            hydration_status, hydration_details
                        ) VALUES (
                            v_budget_id, p_user_id, v_n1_label, 1,
                            NULL, v_order_n1, 'group',
                            'hydrated', jsonb_build_object('path_key', v_item.item_path)
                        )
                        RETURNING id INTO v_n1_id;
                    ELSE
                        UPDATE public.budget_items
                        SET description = v_n1_label,
                            order_index = v_order_n1
                        WHERE id = v_n1_id;
                    END IF;

                    v_total_inserted := v_total_inserted + 1;
                    CONTINUE;
                END IF;

                -- -------------------------------------------------------------
                -- DEPTH 2 — Group (N2)
                -- -------------------------------------------------------------
                IF v_depth = 2 THEN

                    -- Ensure N1 exists
                    SELECT id INTO v_n1_id
                    FROM public.budget_items
                    WHERE budget_id = v_budget_id
                      AND level = 1
                      AND hydration_details->>'path_key' = v_path_parts[1];

                    IF v_n1_id IS NULL THEN
                        -- Fallback: create N1
                        INSERT INTO public.budget_items (
                            budget_id, user_id, description, level,
                            parent_id, order_index, type,
                            hydration_status, hydration_details
                        ) VALUES (
                            v_budget_id, p_user_id,
                            'SEÇÃO ' || v_path_parts[1], 1,
                            NULL, v_order_n1, 'group',
                            'hydrated', jsonb_build_object('path_key', v_path_parts[1])
                        )
                        RETURNING id INTO v_n1_id;
                    END IF;

                    -- M11: if this item is a title (no composition_code, no price, no qty),
                    --       use its own description directly
                    IF v_item.composition_code IS NULL
                       AND v_item.unit_price IS NULL
                       AND v_item.quantity IS NULL THEN
                        v_n2_label := v_clean_description;
                    ELSE
                        -- Try to find a title row for this group
                        SELECT trim(description) INTO v_n2_label
                        FROM public.import_ai_items
                        WHERE job_id = p_job_id
                          AND item_path = v_item.item_path
                          AND composition_code IS NULL
                          AND length(trim(description)) >= 5
                        LIMIT 1;

                        IF v_n2_label IS NULL THEN
                            v_n2_label := 'GRUPO ' || v_item.item_path;
                        END IF;
                    END IF;

                    -- Upsert N2
                    SELECT id INTO v_n2_id
                    FROM public.budget_items
                    WHERE budget_id = v_budget_id
                      AND level = 2
                      AND hydration_details->>'path_key' = v_item.item_path;

                    IF v_n2_id IS NULL THEN
                        INSERT INTO public.budget_items (
                            budget_id, user_id, description, level,
                            parent_id, order_index, type,
                            hydration_status, hydration_details
                        ) VALUES (
                            v_budget_id, p_user_id, v_n2_label, 2,
                            v_n1_id, v_order_n2, 'group',
                            'hydrated', jsonb_build_object('path_key', v_item.item_path)
                        )
                        RETURNING id INTO v_n2_id;
                    ELSE
                        UPDATE public.budget_items
                        SET description = v_n2_label,
                            order_index = v_order_n2
                        WHERE id = v_n2_id;
                    END IF;

                    v_total_inserted := v_total_inserted + 1;
                    CONTINUE;
                END IF;

                -- -------------------------------------------------------------
                -- DEPTH 3 — Item (N3)
                -- -------------------------------------------------------------
                IF v_depth = 3 THEN

                    -- Skip title rows at depth 3 (no composition_code)
                    IF v_item.composition_code IS NULL
                       AND v_item.unit_price IS NULL
                       AND v_item.quantity IS NULL THEN
                        v_total_skipped := v_total_skipped + 1;
                        CONTINUE;
                    END IF;

                    -- Ensure N1 exists
                    SELECT id INTO v_n1_id
                    FROM public.budget_items
                    WHERE budget_id = v_budget_id
                      AND level = 1
                      AND hydration_details->>'path_key' = v_path_parts[1];

                    IF v_n1_id IS NULL THEN
                        INSERT INTO public.budget_items (
                            budget_id, user_id, description, level,
                            parent_id, order_index, type,
                            hydration_status, hydration_details
                        ) VALUES (
                            v_budget_id, p_user_id,
                            'SEÇÃO ' || v_path_parts[1], 1,
                            NULL, v_order_n1, 'group',
                            'hydrated', jsonb_build_object('path_key', v_path_parts[1])
                        )
                        RETURNING id INTO v_n1_id;
                    END IF;

                    -- Ensure N2 exists
                    SELECT id INTO v_n2_id
                    FROM public.budget_items
                    WHERE budget_id = v_budget_id
                      AND level = 2
                      AND hydration_details->>'path_key' = (v_path_parts[1] || '.' || v_path_parts[2]);

                    IF v_n2_id IS NULL THEN
                        -- Try to find title for this group
                        SELECT trim(description) INTO v_n2_label
                        FROM public.import_ai_items
                        WHERE job_id = p_job_id
                          AND item_path = v_path_parts[1] || '.' || v_path_parts[2]
                          AND composition_code IS NULL
                          AND length(trim(description)) >= 5
                        LIMIT 1;

                        IF v_n2_label IS NULL THEN
                            v_n2_label := 'GRUPO ' || v_path_parts[1] || '.' || v_path_parts[2];
                        END IF;

                        INSERT INTO public.budget_items (
                            budget_id, user_id, description, level,
                            parent_id, order_index, type,
                            hydration_status, hydration_details
                        ) VALUES (
                            v_budget_id, p_user_id, v_n2_label, 2,
                            v_n1_id, v_order_n2, 'group',
                            'hydrated',
                            jsonb_build_object('path_key', v_path_parts[1] || '.' || v_path_parts[2])
                        )
                        RETURNING id INTO v_n2_id;
                    END IF;

                    -- Insert N3 item
                    v_item_type := CASE
                        WHEN v_item.composition_code ILIKE 'CPU%' THEN 'insumo'
                        WHEN v_item.composition_code ~ '^\d+$' THEN 'insumo'
                        ELSE 'insumo'
                    END;

                    INSERT INTO public.budget_items (
                        budget_id, user_id, description, level,
                        parent_id, order_index, type,
                        quantity, unit_price, total_price,
                        code, unit,
                        hydration_status, hydration_details
                    ) VALUES (
                        v_budget_id, p_user_id, v_clean_description, 3,
                        v_n2_id, v_order_n3, v_item_type,
                        COALESCE(v_item.quantity, 0),
                        COALESCE(v_item.unit_price, 0),
                        COALESCE(v_item.quantity, 0) * COALESCE(v_item.unit_price, 0),
                        v_item.composition_code,
                        v_item.unit,
                        'pending_hydration',
                        jsonb_build_object(
                            'path_key', v_item.item_path,
                            'source_job_id', p_job_id
                        )
                    );

                    v_total_inserted := v_total_inserted + 1;
                    CONTINUE;
                END IF;

                -- DEPTH 4 — skip (too deep)
                IF v_depth = 4 THEN
                    v_total_skipped := v_total_skipped + 1;
                    CONTINUE;
                END IF;

            END IF; -- v_enable_structure_parser_v1

        END; -- inner DECLARE block
    END LOOP;

    -- =========================================================================
    -- 7. Finalize job
    -- =========================================================================
    UPDATE public.import_jobs
    SET stage = 'pending_hydration',
        result_budget_id = v_budget_id
    WHERE id = p_job_id;

    UPDATE public.budgets
    SET status = 'draft'
    WHERE id = v_budget_id;

    RETURN json_build_object(
        'ok', true,
        'budget_id', v_budget_id,
        'stage', 'pending_hydration',
        'stats', json_build_object(
            'total_inserted', v_total_inserted,
            'total_skipped', v_total_skipped,
            'total_phantom', v_total_phantom
        )
    );

EXCEPTION WHEN OTHERS THEN
    UPDATE public.import_jobs
    SET stage = 'error',
        error_message = SQLERRM
    WHERE id = p_job_id;

    RETURN json_build_object(
        'ok', false,
        'reason', 'exception',
        'error', SQLERRM
    );
END;

$$;
