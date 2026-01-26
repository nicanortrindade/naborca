-- RPC: Resolve Hydration Issue (Manual or Assisted)
-- Purpose: Allows frontend to resolve "pending_review" items by applying a specific composition.
-- Ensures parity with "finalize_import_to_budget" logic.

CREATE OR REPLACE FUNCTION public.resolve_import_hydration_issue(
    p_issue_id uuid,
    p_selected_composition jsonb 
    -- Excepected payload: 
    -- { 
    --   "source_type": "internal_db" | "manual", 
    --   "code": "1234" (if internal),
    --   "items": [ {description, unit, coefficient, price, type}, ... ] (if manual) 
    -- }
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
    v_new_unit_price numeric := 0;
    
    -- Internal DB lookup vars
    v_budget_settings jsonb;
    v_uf text;
    v_competence text;
    v_desonerado boolean;
BEGIN
    -- 1. Validate Access & Issue State
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

    -- 2. Prepare for Re-Hydration
    -- Remove old compositions (if any existed partially)
    DELETE FROM public.budget_item_compositions 
    WHERE budget_item_id = v_budget_item_id;

    -- 3. Hydrate based on Selection
    IF (p_selected_composition->>'source_type') = 'internal_db' THEN
        -- Case A: Apply Internal DB Composition (Strict Parity with Path A)
        
        -- Get Context from Budget Settings
        v_uf := COALESCE(v_budget_settings->>'uf', 'BA');
        v_competence := COALESCE(v_budget_settings->>'competence', to_char(now(), 'MM/YYYY'));
        v_desonerado := COALESCE((v_budget_settings->>'desonerado')::boolean, true);
        
        -- Insert from Helper
        INSERT INTO public.budget_item_compositions (
            budget_item_id, description, unit, quantity, unit_price, total_price, type
        )
        SELECT 
            v_budget_item_id, item_description, item_unit, item_quantity, item_price, (item_quantity * item_price), item_type::public.budget_item_type
        FROM public.find_internal_composition(
            p_selected_composition->>'code', 
            v_uf, v_competence, v_desonerado
        );
        
        -- Calculate new Unit Price for the Parent Item
        SELECT COALESCE(SUM(total_price), 0) INTO v_new_unit_price 
        FROM public.budget_item_compositions 
        WHERE budget_item_id = v_budget_item_id;

        -- Update Item Status
        UPDATE public.budget_items 
        SET hydration_status = 'internal_db',
            -- Update prices to reflect the composition sum
            unit_price = v_new_unit_price,
            total_price = quantity * v_new_unit_price,
            final_price = quantity * v_new_unit_price, -- Assuming BDI applied later or keeping base
            hydration_details = jsonb_build_object(
                'match_source', 'internal_db_manual_resolution',
                'resolved_at', now(),
                'original_issue_id', p_issue_id
            ),
            updated_at = now()
        WHERE id = v_budget_item_id;

    ELSE
        -- Case B: Apply Manual List (or Analytic fallback passed from UI)
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
               ((v_comp_item->>'coefficient')::numeric * (v_comp_item->>'price')::numeric),
               CASE WHEN (v_comp_item->>'type') = 'insumo' THEN 'insumo'::public.budget_item_type ELSE 'composition'::public.budget_item_type END,
               jsonb_build_object('source', 'manual_resolution')
            );
        END LOOP;

        -- Calculate new Unit Price
        SELECT COALESCE(SUM(total_price), 0) INTO v_new_unit_price 
        FROM public.budget_item_compositions 
        WHERE budget_item_id = v_budget_item_id;

        -- Update Item Status
        UPDATE public.budget_items 
        SET hydration_status = 'manual',
            unit_price = v_new_unit_price,
            total_price = quantity * v_new_unit_price,
            final_price = quantity * v_new_unit_price,
            hydration_details = jsonb_build_object(
                'match_source', 'manual_resolution',
                'resolved_at', now(),
                'original_issue_id', p_issue_id
            ),
            updated_at = now()
        WHERE id = v_budget_item_id;
    END IF;

    -- 4. Mark Issue Resolved
    UPDATE public.import_hydration_issues 
    SET status = 'resolved',
        updated_at = now()
    WHERE id = p_issue_id;

    -- 5. Decrease Pending Count on Job (Optional but nice for UX consistency)
    -- Trigger or simple update? Let's do simple update if feasible, but stat might verify strictly from issues table.
    -- For now, we trust the stat queries will join 'open' issues.

    RETURN json_build_object(
        'ok', true,
        'new_unit_price', v_new_unit_price,
        'hydration_status', 'resolved'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('ok', false, 'reason', SQLERRM);
END;
$$;
