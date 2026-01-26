-- Migration: Phase 3 Logic Implementation
-- Includes: RPC for Finalization with Waterfall Hydration
-- Depends on: 20260126180000_phase3_schema.sql

-- Helper: Get Composition from Internal DB (Path A)
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
    item_price numeric,
    item_quantity numeric,
    item_type text -- 'insumo' | 'composition'
) AS $$
DECLARE
    v_table_id uuid;
    v_regime text := CASE WHEN p_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END;
BEGIN
    -- 1. Find Price Table
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

    -- 2. Return Items
    RETURN QUERY
    SELECT 
        child.item_code,
        COALESCE(i.description, c.description, 'Item sem descrição'),
        COALESCE(i.unit, c.unit, 'UN'),
        COALESCE(ip.price, cp.price, 0),
        child.coefficient,
        CASE WHEN child.item_type = 'INSUMO' THEN 'insumo' ELSE 'composition' END
    FROM public.sinapi_composition_items child
    LEFT JOIN public.insumos i ON child.item_type = 'INSUMO' AND i.code = child.item_code
    LEFT JOIN public.sinapi_input_prices ip ON ip.input_code = child.item_code AND ip.price_table_id = v_table_id
    LEFT JOIN public.sinapi_compositions c ON child.item_type = 'COMPOSICAO' AND c.code = child.item_code
    LEFT JOIN public.sinapi_composition_prices cp ON cp.composition_code = child.item_code AND cp.price_table_id = v_table_id
    WHERE child.price_table_id = v_table_id
      AND child.composition_code = p_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Helper: Get Composition from Analytic File (Path B)
-- Currently a stub or basic matching if Phase 2 stores structure in extracted_json
CREATE OR REPLACE FUNCTION public.find_analytic_file_composition(
    p_job_id uuid,
    p_code text
)
RETURNS TABLE (
    item_code text,
    item_description text,
    item_unit text,
    item_price numeric,
    item_quantity numeric,
    item_type text
) AS $$
BEGIN
    -- NOTE: In a real implementation this would query the JSON tree of the Analytic File
    -- For now, we return empty to force Path C (Pending) or Path A (Internal)
    -- Requires complex JSONB parsing depending on Phase 2 output format
    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Main RPC: Finalize Budget
CREATE OR REPLACE FUNCTION public.finalize_import_to_budget(
    p_job_id uuid,
    p_user_id uuid,
    p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_job record;
    v_budget_id uuid;
    v_synthetic_file_id uuid;
    v_analytic_file_id uuid;
    v_l1_id uuid;
    v_l2_id uuid;
    v_item record;
    v_comp_item record;
    v_found_path text; 
    v_items_processed int := 0;
    v_items_hydrated_a int := 0;
    v_items_hydrated_b int := 0;
    v_items_pending int := 0;
    
    -- Params
    v_uf text;
    v_competence text;
    v_desonerado boolean;
BEGIN
    -- 1. Validation & Setup
    SELECT * INTO v_job FROM public.import_jobs WHERE id = p_job_id;
    
    IF v_job.id IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'job_not_found');
    END IF;
    
    IF v_job.user_id != p_user_id THEN
        RETURN json_build_object('ok', false, 'reason', 'forbidden');
    END IF;

    -- Extract Params
    v_uf := COALESCE(p_params->>'uf', 'BA'); -- Default fallback
    v_competence := COALESCE(p_params->>'competence', to_char(now(), 'MM/YYYY'));
    v_desonerado := COALESCE((p_params->>'desonerado')::boolean, true);

    -- 2. Identify Files
    SELECT id INTO v_synthetic_file_id FROM public.import_files WHERE job_id = p_job_id AND role = 'synthetic' LIMIT 1;
    SELECT id INTO v_analytic_file_id FROM public.import_files WHERE job_id = p_job_id AND role = 'analytic' LIMIT 1;

    IF v_synthetic_file_id IS NULL THEN
         -- Fallback: try taking the first file if role not set (retro-compatibility)
         SELECT id INTO v_synthetic_file_id FROM public.import_files WHERE job_id = p_job_id LIMIT 1;
    END IF;

    -- 3. Idempotency Strategy: Reset or Create
    IF v_job.result_budget_id IS NOT NULL THEN
        -- Check if budget still exists
        IF EXISTS (SELECT 1 FROM public.budgets WHERE id = v_job.result_budget_id) THEN
            v_budget_id := v_job.result_budget_id;
            
            -- RESET: Delete existing items to re-hydrate with new params
            DELETE FROM public.budget_items WHERE budget_id = v_budget_id;
            DELETE FROM public.import_hydration_issues WHERE budget_id = v_budget_id;
            
            -- Update Header
            UPDATE public.budgets 
            SET settings = p_params, 
                updated_at = now(),
                sinapi_uf = v_uf,
                sinapi_competence = v_competence,
                sinapi_regime = CASE WHEN v_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END
            WHERE id = v_budget_id;
        ELSE
            -- Reference matches ghost budget, create new
            INSERT INTO public.budgets (user_id, name, status, sinapi_uf, sinapi_competence, sinapi_regime, settings)
            VALUES (p_user_id, 'Orçamento Importado ' || to_char(now(), 'DD/MM HH24:MI'), 'draft', v_uf, v_competence, CASE WHEN v_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END, p_params)
            RETURNING id INTO v_budget_id;
        END IF;
    ELSE
        -- Create New Budget
        INSERT INTO public.budgets (user_id, name, status, sinapi_uf, sinapi_competence, sinapi_regime, settings)
        VALUES (p_user_id, 'Orçamento Importado ' || to_char(now(), 'DD/MM HH24:MI'), 'draft', v_uf, v_competence, CASE WHEN v_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END, p_params)
        RETURNING id INTO v_budget_id;
        
        -- Link Job
        UPDATE public.import_jobs SET result_budget_id = v_budget_id WHERE id = p_job_id;
    END IF;

    -- 4. Create Synthetic Structure
    -- Level 1 (Root)
    INSERT INTO public.budget_items (budget_id, user_id, level, description, type, order_index)
    VALUES (v_budget_id, p_user_id, 1, 'IMPORTAÇÃO ' || v_competence, 'group', 1)
    RETURNING id INTO v_l1_id;

    -- Level 2 (List)
    INSERT INTO public.budget_items (budget_id, user_id, level, parent_id, description, type, order_index)
    VALUES (v_budget_id, p_user_id, 2, v_l1_id, 'LISTAGEM SINTÉTICA', 'group', 1)
    RETURNING id INTO v_l2_id;

    -- Level 3 (Items Loop)
    -- We assume import_items (synthetic) has the list
    FOR v_item IN 
        SELECT * FROM public.import_items 
        WHERE import_file_id = v_synthetic_file_id
        ORDER BY idx ASC
    LOOP
        v_items_processed := v_items_processed + 1;
        
        -- Insert L3 Item
        WITH new_item AS (
            INSERT INTO public.budget_items (
                budget_id, user_id, level, parent_id,
                description, unit, quantity, 
                unit_price, total_price, final_price,
                type, source, code,
                source_import_item_id,
                order_index
            ) VALUES (
                v_budget_id, p_user_id, 3, v_l2_id,
                v_item.description, v_item.unit, v_item.quantity,
                v_item.unit_price, (v_item.quantity * v_item.unit_price), (v_item.quantity * v_item.unit_price),
                'insumo', 'IMPORTADO', COALESCE(v_item.category, '0'), -- Attempt to use category as code? Or find code in description?
                v_item.id,
                v_item.idx
            ) RETURNING id
        )
        SELECT id INTO v_item.budget_item_id FROM new_item;

        -- 5. Hydration Waterfall
        v_found_path := 'none';
        
        -- Identify Code from Description if missing (Simple Regex for standard formats "9321 - Description" or "Description (9321)")
        -- NOTE: Assuming Phase 2 extracted code into 'category' or we parse it here.
        -- Let's assume v_item.category holds the code, or we skip if null.
        
        IF v_item.category IS NOT NULL AND length(v_item.category) > 0 THEN
            
            -- PATH A: Internal DB
            IF EXISTS (SELECT 1 FROM public.find_internal_composition(v_item.category, v_uf, v_competence, v_desonerado)) THEN
                INSERT INTO public.budget_item_compositions (
                    budget_item_id, description, unit, quantity, unit_price, total_price, type
                )
                SELECT 
                    v_item.budget_item_id, item_description, item_unit, item_quantity, item_price, (item_quantity * item_price), item_type
                FROM public.find_internal_composition(v_item.category, v_uf, v_competence, v_desonerado);
                
                v_found_path := 'internal_db';
                v_items_hydrated_a := v_items_hydrated_a + 1;
            
            -- PATH B: Analytic File
            ELSIF v_analytic_file_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.find_analytic_file_composition(p_job_id, v_item.category)) THEN
                -- Insert from Analytic
                INSERT INTO public.budget_item_compositions (
                   budget_item_id, description, unit, quantity, unit_price, total_price, type
                )
                SELECT 
                   v_item.budget_item_id, item_description, item_unit, item_quantity, item_price, (item_quantity * item_price), item_type
                FROM public.find_analytic_file_composition(p_job_id, v_item.category);
                
                v_found_path := 'analytic_file';
                v_items_hydrated_b := v_items_hydrated_b + 1;
            END IF;
        END IF;

        -- Update Status
        IF v_found_path = 'none' THEN
            UPDATE public.budget_items SET hydration_status = 'pending_review' WHERE id = v_item.budget_item_id;
            
            -- Log Issue (Path C)
            INSERT INTO public.import_hydration_issues (
                job_id, budget_id, budget_item_id, issue_type, original_code, original_description
            ) VALUES (
                p_job_id, v_budget_id, v_item.budget_item_id, 'missing_composition', v_item.category, v_item.description
            );
            v_items_pending := v_items_pending + 1;
        ELSE
            UPDATE public.budget_items SET hydration_status = v_found_path WHERE id = v_item.budget_item_id;
        END IF;

    END LOOP;

    -- 6. Log Run
    INSERT INTO public.import_finalization_runs (
        job_id, budget_id, user_id, params_snapshot,
        total_items, hydrated_internal, hydrated_analytic, pending_items
    ) VALUES (
        p_job_id, v_budget_id, p_user_id, p_params,
        v_items_processed, v_items_hydrated_a, v_items_hydrated_b, v_items_pending
    );
    
    -- Update Job to Finalized
    UPDATE public.import_jobs 
    SET stage = 'finalized', 
        finalized_at = now() 
    WHERE id = p_job_id;

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
    RETURN json_build_object('ok', false, 'reason', SQLERRM);
END;
$$;
