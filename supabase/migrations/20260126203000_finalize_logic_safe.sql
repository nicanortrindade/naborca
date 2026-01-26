-- RPC: Finalize Budget with Hydration Safety
-- Ajustes: Idempotência SEGURA (Short-circuit se já existe)
-- Depends on: 20260126180000_phase3_schema.sql

CREATE OR REPLACE FUNCTION public.finalize_import_to_budget(
    p_job_id uuid,
    p_user_id uuid,
    p_params jsonb DEFAULT '{}'::jsonb,
    p_analytic_data jsonb DEFAULT '{}'::jsonb -- Contract: Record<Code, CompositionObject>
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
    
    -- Params
    v_uf text;
    v_competence text;
    v_desonerado boolean;
    
    -- Variables for Loop
    v_found_path text;
    v_clean_code text;
    v_analytic_comp jsonb;
    v_analytic_item jsonb;
    v_item_total numeric;
BEGIN
    -- 1. Setup & Validation
    SELECT * INTO v_job FROM public.import_jobs WHERE id = p_job_id;
    IF v_job.id IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'job_not_found');
    END IF;
    IF v_job.user_id != p_user_id THEN
        RETURN json_build_object('ok', false, 'reason', 'forbidden');
    END IF;

    -- Extract Params
    v_uf := COALESCE(p_params->>'uf', 'BA');
    v_competence := COALESCE(p_params->>'competence', to_char(now(), 'MM/YYYY'));
    v_desonerado := COALESCE((p_params->>'desonerado')::boolean, true);

    -- 2. Idempotência SEGURA (Problem 1 Fix)
    -- Se já existe budget vinculado, NÃO recria itens. Apenas atualiza settings globais.
    IF v_job.result_budget_id IS NOT NULL THEN
        -- Verify existence
        IF EXISTS (SELECT 1 FROM public.budgets WHERE id = v_job.result_budget_id) THEN
            v_budget_id := v_job.result_budget_id;
            
            -- Update Header Only (Problem 4 Safe Update)
            UPDATE public.budgets 
            SET settings = p_params, 
                updated_at = now(),
                sinapi_uf = v_uf, 
                sinapi_competence = v_competence, 
                sinapi_regime = CASE WHEN v_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END
            WHERE id = v_budget_id;

            -- Return Early (No item destruction)
            RETURN json_build_object(
                'ok', true,
                'budget_id', v_budget_id,
                'status', 'updated_params_only', 
                'details', 'Items were implicitly preserved to ensure data safety.'
            );
        END IF;
    END IF;

    -- 3. Create NEW Budget (Only if not returning early)
    INSERT INTO public.budgets (
        user_id, name, status, sinapi_uf, sinapi_competence, sinapi_regime, settings, created_at
    ) VALUES (
        p_user_id, 
        'Orçamento Importado ' || to_char(now(), 'DD/MM HH24:MI'), 
        'draft', 
        v_uf, v_competence, CASE WHEN v_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END, 
        p_params, now()
    )
    RETURNING id INTO v_budget_id;
    
    -- Link Job
    UPDATE public.import_jobs SET result_budget_id = v_budget_id WHERE id = p_job_id;

    -- 4. Synthetic Structure (Root)
    SELECT id INTO v_synthetic_file_id FROM public.import_files WHERE job_id = p_job_id AND (role = 'synthetic' OR role IS NULL) LIMIT 1;
    
    INSERT INTO public.budget_items (budget_id, user_id, level, description, type, order_index)
    VALUES (v_budget_id, p_user_id, 1, 'IMPORTAÇÃO AUTOMÁTICA', 'group', 1) RETURNING id INTO v_l1_id;
    
    INSERT INTO public.budget_items (budget_id, user_id, level, parent_id, description, type, order_index)
    VALUES (v_budget_id, p_user_id, 2, v_l1_id, 'ITENS DA LISTA', 'group', 1) RETURNING id INTO v_l2_id;

    -- 5. Item Loop & Hydration
    -- Source of Truth: SQL Loop performs matching logic
    FOR v_item IN 
        SELECT * FROM public.import_items WHERE import_file_id = v_synthetic_file_id ORDER BY idx ASC
    LOOP
        v_items_processed := v_items_processed + 1;
        v_found_path := 'none';
        
        -- Code Extraction Strategy
        v_clean_code := NULL;
        IF v_item.category ~ '^[0-9.-]+$' THEN
             v_clean_code := regexp_replace(v_item.category, '[^0-9]', '', 'g');
        ELSE
             v_clean_code := substring(v_item.description FROM '^([0-9]{4,})');
        END IF;

        -- Create L3 Item
        WITH new_item AS (
            INSERT INTO public.budget_items (
                budget_id, user_id, level, parent_id,
                description, unit, quantity, 
                unit_price, total_price, final_price,
                type, source, code, source_import_item_id, order_index,
                hydration_status -- Default 'none', updated later
            ) VALUES (
                v_budget_id, p_user_id, 3, v_l2_id,
                v_item.description, v_item.unit, v_item.quantity,
                v_item.unit_price, (v_item.quantity * v_item.unit_price), (v_item.quantity * v_item.unit_price),
                'insumo', 'IMPORTADO', COALESCE(v_clean_code, '0'), v_item.id, v_item.idx,
                'none'
            ) RETURNING id
        ) SELECT id INTO v_item.budget_item_id FROM new_item;

        -- == HYDRATION CASCADE (Problem 2: SQL as Logic Host) ==
        
        -- PATH A: INTERNAL DB (Confidence: High)
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
                
                -- Update Metadata (Problem 5: match_source)
                UPDATE public.budget_items 
                SET hydration_status = 'internal_db',
                    hydration_details = jsonb_build_object(
                        'match_source', 'internal_db',
                        'match_confidence', 'high',
                        'db_table_uf', v_uf
                    )
                WHERE id = v_item.budget_item_id;
            END IF;
        END IF;

        -- PATH B: ANALYTIC FILE (Only if A failed)
        IF v_found_path = 'none' AND v_clean_code IS NOT NULL AND p_analytic_data IS NOT NULL THEN
            -- Check JSON Dictionary from Parser
            IF p_analytic_data ? v_clean_code THEN
                v_analytic_comp := p_analytic_data -> v_clean_code;
                
                -- Iterate items array
                FOR v_analytic_item IN SELECT * FROM jsonb_array_elements(v_analytic_comp->'items')
                LOOP
                   INSERT INTO public.budget_item_compositions (
                       budget_item_id, description, unit, quantity, unit_price, total_price, type, metadata
                   ) VALUES (
                       v_item.budget_item_id,
                       v_analytic_item->>'description',
                       v_analytic_item->>'unit',
                       (v_analytic_item->>'coefficient')::numeric,
                       (v_analytic_item->>'price')::numeric,
                       ((v_analytic_item->>'coefficient')::numeric * (v_analytic_item->>'price')::numeric),
                       CASE WHEN (v_analytic_item->>'type') = 'insumo' THEN 'insumo'::public.budget_item_type ELSE 'composition'::public.budget_item_type END,
                       jsonb_build_object('original_source', 'imported_pdf')
                   );
                END LOOP;

                v_found_path := 'analytic_file';
                v_items_hydrated_b := v_items_hydrated_b + 1;

                -- Update Metadata
                UPDATE public.budget_items 
                SET hydration_status = 'analytic_file',
                    hydration_details = jsonb_build_object(
                        'match_source', 'analytic_file',
                        'match_confidence', 'medium'
                    )
                WHERE id = v_item.budget_item_id;
            END IF;
        END IF;

        -- PATH C: PENDING (Problem 5: Issue Logging)
        IF v_found_path = 'none' THEN
            v_items_pending := v_items_pending + 1;
            
            UPDATE public.budget_items 
            SET hydration_status = 'pending_review',
                hydration_details = jsonb_build_object('match_source', 'none')
            WHERE id = v_item.budget_item_id;
            
            INSERT INTO public.import_hydration_issues (
                job_id, budget_id, budget_item_id, issue_type, original_code, original_description
            ) VALUES (
                p_job_id, v_budget_id, v_item.budget_item_id, 'missing_composition', v_clean_code, v_item.description
            );
        END IF;

    END LOOP;

    -- 6. Commit & Return
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
