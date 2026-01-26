-- RPC: Resolve Hydration Issue (Logic Correction: NO PRICE CALC IN BACKEND)
-- "Cálculos são responsabilidade do frontend"
-- "Backend só persiste estrutura e dados brutos"

CREATE OR REPLACE FUNCTION public.resolve_import_hydration_issue(
    p_issue_id uuid,
    p_selected_composition jsonb 
    -- Payload: { "source_type": "internal_db" | "manual", "code": "...", "items": [...] }
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_issue record;
    v_budget_item_id uuid;
    v_budget_id uuid;
    v_user_id uuid;
    v_comp_item jsonb;
    
    -- Lookup vars
    v_budget_settings jsonb;
    v_uf text;
    v_competence text;
    v_desonerado boolean;
BEGIN
    -- 1. Validate Access
    SELECT * INTO v_issue FROM public.import_hydration_issues WHERE id = p_issue_id;
    
    IF v_issue.id IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'issue_not_found');
    END IF;
    
    IF v_issue.status = 'resolved' THEN
        RETURN json_build_object('ok', false, 'reason', 'issue_already_resolved');
    END IF;

    v_budget_item_id := v_issue.budget_item_id;
    v_budget_id := v_issue.budget_id;
    
    -- Verify Budget Ownership
    SELECT user_id, settings INTO v_user_id, v_budget_settings 
    FROM public.budgets WHERE id = v_budget_id;
    
    IF v_user_id != auth.uid() THEN
        RETURN json_build_object('ok', false, 'reason', 'forbidden');
    END IF;

    -- 2. Clear Old Compositions (Reset State)
    DELETE FROM public.budget_item_compositions 
    WHERE budget_item_id = v_budget_item_id;

    -- 3. Insert New Structure (No Price Summation)
    IF (p_selected_composition->>'source_type') = 'internal_db' THEN
        -- Case A: Copy Internal Structure Only
        v_uf := COALESCE(v_budget_settings->>'uf', 'BA');
        v_competence := COALESCE(v_budget_settings->>'competence', to_char(now(), 'MM/YYYY'));
        v_desonerado := COALESCE((v_budget_settings->>'desonerado')::boolean, true);
        
        -- Insert items raw (prices are just reference from DB, total is ref)
        INSERT INTO public.budget_item_compositions (
            budget_item_id, description, unit, quantity, unit_price, total_price, type
        )
        SELECT 
            v_budget_item_id, item_description, item_unit, item_quantity, item_price, (item_quantity * item_price), item_type::public.budget_item_type
        FROM public.find_internal_composition(
            p_selected_composition->>'code', 
            v_uf, v_competence, v_desonerado
        );

        -- Update Item Status ONLY (Prices remain untouched until Frontend Recalc)
        UPDATE public.budget_items 
        SET hydration_status = 'internal_db',
            hydration_details = jsonb_build_object(
                'match_source', 'internal_db_manual_resolution',
                'resolved_at', now(),
                'original_issue_id', p_issue_id,
                'pending_calc', true -- Flag nice-to-have for debug
            ),
            updated_at = now()
        WHERE id = v_budget_item_id;

    ELSE
        -- Case B: Manual Structure
        FOR v_comp_item IN SELECT * FROM jsonb_array_elements(p_selected_composition->'items')
        LOOP
            INSERT INTO public.budget_item_compositions (
               budget_item_id, description, unit, quantity, unit_price, total_price, type, metadata
            ) VALUES (
               v_budget_item_id,
               v_comp_item->>'description',
               v_comp_item->>'unit',
               (v_comp_item->>'coefficient')::numeric,
               (v_comp_item->>'price')::numeric,
               ((v_comp_item->>'coefficient')::numeric * (v_comp_item->>'price')::numeric), -- Saved just as snapshot
               CASE WHEN (v_comp_item->>'type') = 'insumo' THEN 'insumo'::public.budget_item_type ELSE 'composition'::public.budget_item_type END,
               jsonb_build_object('source', 'manual_resolution')
            );
        END LOOP;

        UPDATE public.budget_items 
        SET hydration_status = 'manual',
            hydration_details = jsonb_build_object(
                'match_source', 'manual_resolution',
                'resolved_at', now(),
                'original_issue_id', p_issue_id,
                'pending_calc', true
            ),
            updated_at = now()
        WHERE id = v_budget_item_id;
    END IF;

    -- 4. Mark Issue Resolved & Return
    UPDATE public.import_hydration_issues SET status = 'resolved', updated_at = now() WHERE id = p_issue_id;

    RETURN json_build_object('ok', true, 'status', 'resolved_waiting_frontend_calc');

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('ok', false, 'reason', SQLERRM);
END;
$$;
