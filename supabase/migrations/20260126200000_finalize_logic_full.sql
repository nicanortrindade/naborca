-- Migration: Finalize Logic Full Implementation (Phase 3)
-- Replaces previous partial stubs.
-- Includes Path A, Path B, and Path C logic.

-- Helper: Find Internal Composition (Path A) --
DROP FUNCTION IF EXISTS public.find_internal_composition(text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.find_internal_composition(
    p_code text,
    p_uf text,
    p_competence text,
    p_desonerado boolean
)
RETURNS TABLE (
    item_code text,
    item_description text,
    item_unit text,
    item_quantity numeric,
    item_price numeric,
    item_type text
) AS $$
DECLARE
    v_table_id uuid;
    v_regime text := CASE WHEN p_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END;
BEGIN
    SELECT id INTO v_table_id
    FROM public.sinapi_price_tables
    WHERE uf = p_uf 
      AND competence = p_competence 
      AND regime = v_regime
      AND is_mock = false
    LIMIT 1;

    IF v_table_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 
        child.item_code,
        COALESCE(i.description, c.description, 'Item sem descrição'),
        COALESCE(i.unit, c.unit, 'UN'),
        child.coefficient as item_quantity,
        COALESCE(ip.price, cp.price, 0) as item_price,
        CASE WHEN child.item_type = 'INSUMO' THEN 'insumo' ELSE 'composition' END as item_type
    FROM public.sinapi_composition_items child
    LEFT JOIN public.insumos i ON child.item_type = 'INSUMO' AND i.code = child.item_code
    LEFT JOIN public.sinapi_input_prices ip ON ip.input_code = child.item_code AND ip.price_table_id = v_table_id
    LEFT JOIN public.sinapi_compositions c ON child.item_type = 'COMPOSICAO' AND c.code = child.item_code
    LEFT JOIN public.sinapi_composition_prices cp ON cp.composition_code = child.item_code AND cp.price_table_id = v_table_id
    WHERE child.price_table_id = v_table_id
      AND child.composition_code = p_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Main RPC: finalization with Analytic Data Payload --
DROP FUNCTION IF EXISTS public.finalize_import_to_budget(uuid, uuid, jsonb, jsonb);
CREATE OR REPLACE FUNCTION public.finalize_import_to_budget(
    p_job_id uuid,
    p_user_id uuid,
    p_params jsonb DEFAULT '{}'::jsonb,
    p_analytic_data jsonb DEFAULT '{}'::jsonb -- Map<Code, CompositionObject>
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_job record;
    v_budget_id uuid;
    v_synthetic_file_id uuid;
    v_l1_id uuid;
    v_l2_id uuid;
    v_item record;
    v_items_processed int := 0;
    v_items_hydrated_a int := 0;
    v_items_hydrated_b int := 0;
    v_items_pending int := 0;
    v_uf text;
    v_competence text;
    v_desonerado boolean;
    v_found_path text;
    
    -- Variables for Loop
    v_raw_code text;
    v_clean_code text;
    v_analytic_comp jsonb;
    v_analytic_item jsonb;
BEGIN
    -- 1. Setup & Validation
    SELECT * INTO v_job FROM public.import_jobs WHERE id = p_job_id;
    IF v_job.id IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'job_not_found');
    END IF;
    IF v_job.user_id != p_user_id THEN
        RETURN json_build_object('ok', false, 'reason', 'forbidden');
    END IF;

    -- Params Extraction
    v_uf := COALESCE(p_params->>'uf', 'BA');
    v_competence := COALESCE(p_params->>'competence', to_char(now(), 'MM/YYYY'));
    v_desonerado := COALESCE((p_params->>'desonerado')::boolean, true);

    -- 2. Budget Creation / Idempotency
    IF v_job.result_budget_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.budgets WHERE id = v_job.result_budget_id) THEN
        v_budget_id := v_job.result_budget_id;
        DELETE FROM public.budget_items WHERE budget_id = v_budget_id; -- Reset items
        DELETE FROM public.import_hydration_issues WHERE budget_id = v_budget_id;
        
        UPDATE public.budgets 
        SET settings = p_params, 
            updated_at = now(),
            sinapi_uf = v_uf, sinapi_competence = v_competence, 
            sinapi_regime = CASE WHEN v_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END
        WHERE id = v_budget_id;
    ELSE
        INSERT INTO public.budgets (user_id, name, status, sinapi_uf, sinapi_competence, sinapi_regime, settings, created_at)
        VALUES (p_user_id, 'Orçamento Importado ' || to_char(now(), 'DD/MM HH24:MI'), 'draft', v_uf, v_competence, CASE WHEN v_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END, p_params, now())
        RETURNING id INTO v_budget_id;
        
        UPDATE public.import_jobs SET result_budget_id = v_budget_id WHERE id = p_job_id;
    END IF;

    -- 3. Synthetic Structure (Root)
    SELECT id INTO v_synthetic_file_id FROM public.import_files WHERE job_id = p_job_id AND (role = 'synthetic' OR role IS NULL) LIMIT 1;
    
    INSERT INTO public.budget_items (budget_id, user_id, level, description, type, order_index)
    VALUES (v_budget_id, p_user_id, 1, 'IMPORTAÇÃO AUTOMÁTICA', 'group', 1) RETURNING id INTO v_l1_id;
    
    INSERT INTO public.budget_items (budget_id, user_id, level, parent_id, description, type, order_index)
    VALUES (v_budget_id, p_user_id, 2, v_l1_id, 'ITENS DA LISTA', 'group', 1) RETURNING id INTO v_l2_id;

    -- 4. Item Loop
    FOR v_item IN 
        SELECT * FROM public.import_items WHERE import_file_id = v_synthetic_file_id ORDER BY idx ASC
    LOOP
        v_items_processed := v_items_processed + 1;
        v_found_path := 'none';
        
        -- Try to isolate code (e.g. from "92736 - ALVENARIA" -> "92736")
        -- If Phase 2 put it in category, use it. Else regex from description.
        v_clean_code := NULL;
        IF v_item.category ~ '^[0-9.-]+$' THEN
             v_clean_code := v_item.category;
        ELSE
             -- Simple extraction from start of string
             v_clean_code := substring(v_item.description FROM '^([0-9]{4,})');
        END IF;

        -- Create L3 Item
        WITH new_item AS (
            INSERT INTO public.budget_items (
                budget_id, user_id, level, parent_id,
                description, unit, quantity, 
                unit_price, total_price, final_price,
                type, source, code, source_import_item_id, order_index
            ) VALUES (
                v_budget_id, p_user_id, 3, v_l2_id,
                v_item.description, v_item.unit, v_item.quantity,
                v_item.unit_price, (v_item.quantity * v_item.unit_price), (v_item.quantity * v_item.unit_price),
                'insumo', 'IMPORTADO', COALESCE(v_clean_code, '0'), v_item.id, v_item.idx
            ) RETURNING id
        ) SELECT id INTO v_item.budget_item_id FROM new_item;

        -- == HYDRATION CASCADE ==
        
        -- PATH A: INTERNAL DB
        IF v_clean_code IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM public.find_internal_composition(v_clean_code, v_uf, v_competence, v_desonerado)) THEN
                INSERT INTO public.budget_item_compositions (
                    budget_item_id, description, unit, quantity, unit_price, total_price, type
                )
                SELECT 
                    v_item.budget_item_id, item_description, item_unit, item_quantity, item_price, (item_quantity * item_price), item_type
                FROM public.find_internal_composition(v_clean_code, v_uf, v_competence, v_desonerado);
                
                v_found_path := 'internal_db';
                v_items_hydrated_a := v_items_hydrated_a + 1;
            END IF;
        END IF;

        -- PATH B: ANALYTIC FILE (Only if Path A failed)
        IF v_found_path = 'none' AND v_clean_code IS NOT NULL AND p_analytic_data IS NOT NULL THEN
            -- Check JSON Dictionary
            IF p_analytic_data ? v_clean_code THEN
                v_analytic_comp := p_analytic_data -> v_clean_code;
                
                -- Iterate items array in JSON
                FOR v_analytic_item IN SELECT * FROM jsonb_array_elements(v_analytic_comp->'items')
                LOOP
                   INSERT INTO public.budget_item_compositions (
                       budget_item_id, description, unit, quantity, unit_price, total_price, type
                   ) VALUES (
                       v_item.budget_item_id,
                       v_analytic_item->>'description',
                       v_analytic_item->>'unit',
                       (v_analytic_item->>'coefficient')::numeric,
                       (v_analytic_item->>'price')::numeric,
                       ((v_analytic_item->>'coefficient')::numeric * (v_analytic_item->>'price')::numeric),
                       CASE WHEN (v_analytic_item->>'type') = 'insumo' THEN 'insumo'::public.budget_item_type ELSE 'composition'::public.budget_item_type END
                   );
                END LOOP;

                v_found_path := 'analytic_file';
                v_items_hydrated_b := v_items_hydrated_b + 1;
            END IF;
        END IF;

        -- PATH C: PENDING
        IF v_found_path = 'none' THEN
            v_items_pending := v_items_pending + 1;
            UPDATE public.budget_items SET hydration_status = 'pending_review' WHERE id = v_item.budget_item_id;
            
            INSERT INTO public.import_hydration_issues (
                job_id, budget_id, budget_item_id, issue_type, original_code, original_description
            ) VALUES (
                p_job_id, v_budget_id, v_item.budget_item_id, 'missing_composition', v_clean_code, v_item.description
            );
        ELSE
            UPDATE public.budget_items SET hydration_status = v_found_path WHERE id = v_item.budget_item_id;
        END IF;

    END LOOP;

    -- 5. Commit & Return
    UPDATE public.import_jobs SET stage = 'finalized', finalized_at = now() WHERE id = p_job_id;
    
    INSERT INTO public.import_finalization_runs (
        job_id, budget_id, user_id, params_snapshot,
        total_items, hydrated_internal, hydrated_analytic, pending_items
    ) VALUES (
        p_job_id, v_budget_id, p_user_id, p_params,
        v_items_processed, v_items_hydrated_a, v_items_hydrated_b, v_items_pending
    );

    RETURN json_build_object(
        'ok', true,
        'budget_id', v_budget_id,
        'stats', json_build_object(
            'total', v_items_processed,
            'internal', v_items_hydrated_a,
            'analytic', v_items_hydrated_b,
            'pending', v_items_pending
        )
    );

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Finalize Error: %', SQLERRM;
    RETURN json_build_object('ok', false, 'reason', SQLERRM);
END;
$$;
