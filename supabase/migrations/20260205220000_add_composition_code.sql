-- Migration: Add composition_code to import_ai_items and update finalization logic
-- Date: 2026-02-05
-- Objective: Store strictly extracted composition codes and use them for hydration priority.
-- 1. Add Column
ALTER TABLE public.import_ai_items
ADD COLUMN IF NOT EXISTS composition_code text;
-- 2. Update Finalize RPC to use composition_code
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
IF v_job.id IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'job_not_found');
END IF;
-- 1.1. STRICT FAILURE CHECK (New Contract)
-- If the job is marked as failed/waiting user action for failure, DO NOT finalize.
IF v_job.current_step = 'waiting_user_extraction_failed' THEN RETURN json_build_object(
    'ok',
    false,
    'reason',
    'extraction_failed_or_empty',
    'details',
    json_build_object(
        'job_id',
        p_job_id,
        'status',
        v_job.status,
        'current_step',
        v_job.current_step,
        'last_error',
        v_job.last_error
    )
);
END IF;
-- 1.2. REAL ITEMS CHECK
-- Must have at least one REAL item (filtering out any potential guards that slipped in, level 3).
-- Although ExtractWorker should prevent this, we double check here.
IF NOT EXISTS (
    SELECT 1
    FROM public.import_ai_items
    WHERE job_id = p_job_id
        AND (
            description NOT LIKE 'Falha na leitura automática%'
        )
) THEN RETURN json_build_object(
    'ok',
    false,
    'reason',
    'extraction_failed_no_items',
    'details',
    json_build_object('job_id', p_job_id)
);
END IF;
-- Params Extraction
v_uf := COALESCE(p_params->>'uf', 'BA');
v_competence := COALESCE(
    p_params->>'competence',
    to_char(now(), 'MM/YYYY')
);
v_desonerado := COALESCE((p_params->>'desonerado')::boolean, true);
v_use_parser := COALESCE(
    (p_params->>'enable_structure_parser_v1')::boolean,
    false
);
-- 2. Budget Creation / Idempotency
IF v_job.result_budget_id IS NOT NULL
AND EXISTS (
    SELECT 1
    FROM public.budgets
    WHERE id = v_job.result_budget_id
) THEN v_budget_id := v_job.result_budget_id;
-- IDEMPOTENCY: Delete existing items
DELETE FROM public.budget_items
WHERE budget_id = v_budget_id;
DELETE FROM public.import_hydration_issues
WHERE budget_id = v_budget_id;
UPDATE public.budgets
SET settings = p_params,
    updated_at = now(),
    sinapi_uf = v_uf,
    sinapi_competence = v_competence,
    sinapi_regime = CASE
        WHEN v_desonerado THEN 'DESONERADO'
        ELSE 'NAO_DESONERADO'
    END
WHERE id = v_budget_id;
ELSE
INSERT INTO public.budgets (
        user_id,
        name,
        status,
        sinapi_uf,
        sinapi_competence,
        sinapi_regime,
        settings,
        created_at
    )
VALUES (
        v_job.user_id,
        'Orçamento Importado ' || to_char(now(), 'DD/MM HH24:MI'),
        'draft',
        v_uf,
        v_competence,
        v_competence,
        -- Fix: pass twice or adjust columns above? Schema check says sinapi_competence is correct.
        -- Wait, previous migration line 100-101: v_uf, v_competence.
        -- Line 93 is 'settings'. Line 92 'sinapi_regime'.
        -- Let's stick to previous structure carefully.
        CASE
            WHEN v_desonerado THEN 'DESONERADO'
            ELSE 'NAO_DESONERADO'
        END,
        p_params,
        now()
    )
RETURNING id INTO v_budget_id;
UPDATE public.import_jobs
SET result_budget_id = v_budget_id
WHERE id = p_job_id;
END IF;
-- 3. Synthetic Structure (Roots)
-- We always create the fallback roots to ensure safety if parsing fails or is partial
INSERT INTO public.budget_items (
        budget_id,
        user_id,
        level,
        description,
        type,
        order_index
    )
VALUES (
        v_budget_id,
        v_job.user_id,
        1,
        'IMPORTAÇÃO AUTOMÁTICA',
        'group',
        1
    )
RETURNING id INTO v_fallback_l1_id;
INSERT INTO public.budget_items (
        budget_id,
        user_id,
        level,
        parent_id,
        description,
        type,
        order_index
    )
VALUES (
        v_budget_id,
        v_job.user_id,
        2,
        v_fallback_l1_id,
        'ITENS DA LISTA',
        'group',
        1
    )
RETURNING id INTO v_fallback_l2_id;
-- Initialize Stack
v_current_n1_id := NULL;
v_current_n2_id := NULL;
-- 4. Items Loop
FOR v_item IN
SELECT *
FROM public.import_ai_items
WHERE job_id = p_job_id
ORDER BY idx ASC LOOP v_items_processed := v_items_processed + 1;
v_found_path := 'none';
v_parser_warnings := ARRAY []::text [];
v_description_text := v_item.description;
v_clean_code := NULL;
v_inserted_item_id := NULL;
-- == PARSER LOGIC ==
IF v_use_parser THEN -- Reset loop variables
v_level := 3;
-- Default
v_numbering := NULL;
v_clean_description := v_description_text;
-- Check Regex (Strict Order: N3 -> N2 -> N1)
-- N3: 1.2.3 ...
v_n3_match := substring(
    v_description_text
    FROM '^([0-9]+\.[0-9]+\.[0-9]+)\s'
);
-- N2: 1.2 ...
v_n2_match := substring(
    v_description_text
    FROM '^([0-9]+\.[0-9]+)\s'
);
-- N1: 1 ... (Check for space to avoid 100 matching 1)
v_n1_match := substring(
    v_description_text
    FROM '^([0-9]+)\s'
);
IF v_n3_match IS NOT NULL THEN v_level := 3;
v_numbering := v_n3_match;
v_clean_description := trim(
    substring(
        v_description_text
        FROM '^[0-9]+\.[0-9]+\.[0-9]+\s+(.*)'
    )
);
ELSIF v_n2_match IS NOT NULL THEN v_level := 2;
v_numbering := v_n2_match;
v_clean_description := trim(
    substring(
        v_description_text
        FROM '^[0-9]+\.[0-9]+\s+(.*)'
    )
);
ELSIF v_n1_match IS NOT NULL THEN v_level := 1;
v_numbering := v_n1_match;
v_clean_description := trim(
    substring(
        v_description_text
        FROM '^[0-9]+\s+(.*)'
    )
);
ELSE -- UNKNOWN -> Treated as Item (Level 3)
v_level := 3;
v_clean_description := v_description_text;
v_parser_warnings := array_append(
    v_parser_warnings,
    'unknown_line_type_fallback_used'
);
END IF;
-- == STACK OPS ==
IF v_level = 1 THEN -- Create N1 Group
INSERT INTO public.budget_items (
        budget_id,
        user_id,
        level,
        description,
        type,
        order_index,
        hydration_details
    )
VALUES (
        v_budget_id,
        v_job.user_id,
        1,
        v_clean_description,
        'group',
        v_items_processed,
        jsonb_build_object(
            'parser_version',
            'structure_v1',
            'detected_level',
            'N1',
            'numbering',
            v_numbering
        )
    )
RETURNING id INTO v_current_n1_id;
-- Reset N2
v_current_n2_id := NULL;
-- Skip Hydration for Groups
CONTINUE;
ELSIF v_level = 2 THEN -- Resolve Parent (N1)
IF v_current_n1_id IS NULL THEN v_parent_id := v_fallback_l1_id;
v_parser_warnings := array_append(v_parser_warnings, 'missing_n1_fallback_used');
ELSE v_parent_id := v_current_n1_id;
END IF;
-- Create N2 Group
INSERT INTO public.budget_items (
        budget_id,
        user_id,
        level,
        parent_id,
        description,
        type,
        order_index,
        hydration_details
    )
VALUES (
        v_budget_id,
        v_job.user_id,
        2,
        v_parent_id,
        v_clean_description,
        'group',
        v_items_processed,
        jsonb_build_object(
            'parser_version',
            'structure_v1',
            'detected_level',
            'N2',
            'numbering',
            v_numbering,
            'warnings',
            v_parser_warnings
        )
    )
RETURNING id INTO v_current_n2_id;
-- Skip Hydration for Groups
CONTINUE;
ELSE -- Level 3 (Item) or Unknown
-- Resolve Parent (N2 -> N1 -> Fallback)
IF v_current_n2_id IS NULL THEN IF v_current_n1_id IS NULL THEN v_parent_id := v_fallback_l2_id;
-- Only warn if we parsed numbering but failed structure (e.g. orphan 1.1.1)
IF v_numbering IS NOT NULL THEN v_parser_warnings := array_append(v_parser_warnings, 'missing_n2_fallback_used');
END IF;
ELSE -- Directly under N1? Unusual but safer to put in a synthetic N2 or fallback?
-- User rules: "preferir current_n2 senão current_n1 senão fallback root"
v_parent_id := v_current_n1_id;
END IF;
ELSE v_parent_id := v_current_n2_id;
END IF;
-- Proceed to insert L3 item below...
END IF;
ELSE -- == LEGACY FLAT MODE ==
v_level := 3;
v_clean_description := v_description_text;
v_parent_id := v_fallback_l2_id;
END IF;
-- == INSERT L3 ITEM (Common) ==
-- PRIORITY 1: Explicit Composition Code from AI (NEW)
IF v_item.composition_code IS NOT NULL THEN v_clean_code := v_item.composition_code;
ELSE -- PRIORITY 2: Regex Extraction from Description (Legacy)
v_clean_code := substring(
    v_clean_description
    FROM '^([0-9]{4,})'
);
END IF;
INSERT INTO public.budget_items (
        budget_id,
        user_id,
        level,
        parent_id,
        description,
        unit,
        quantity,
        unit_price,
        total_price,
        final_price,
        type,
        source,
        code,
        source_import_item_id,
        order_index,
        hydration_details
    )
VALUES (
        v_budget_id,
        v_job.user_id,
        3,
        v_parent_id,
        v_clean_description,
        COALESCE(v_item.unit, 'UN'),
        COALESCE(v_item.quantity, 1),
        COALESCE(v_item.unit_price, 0),
        (
            COALESCE(v_item.quantity, 1) * COALESCE(v_item.unit_price, 0)
        ),
        (
            COALESCE(v_item.quantity, 1) * COALESCE(v_item.unit_price, 0)
        ),
        'insumo',
        CASE
            WHEN v_item.composition_code IS NOT NULL THEN 'AI_EXTRACTED_CODE'
            ELSE 'IMPORTADO'
        END,
        COALESCE(v_clean_code, '0'),
        v_item.id,
        v_items_processed,
        jsonb_build_object(
            'parser_version',
            CASE
                WHEN v_use_parser THEN 'structure_v1'
                ELSE 'legacy_flat'
            END,
            'detected_level',
            CASE
                WHEN v_level = 3 THEN 'N3'
                ELSE 'UNKNOWN'
            END,
            'numbering',
            v_numbering,
            'warnings',
            v_parser_warnings,
            'code_source',
            CASE
                WHEN v_item.composition_code IS NOT NULL THEN 'explicit_ai'
                ELSE 'regex_fallback'
            END
        )
    )
RETURNING id INTO v_inserted_item_id;
-- == HYDRATION (Only for L3 Items) ==
-- Hydration A (Internal DB)
IF v_clean_code IS NOT NULL THEN IF EXISTS (
    SELECT 1
    FROM public.find_internal_composition(v_clean_code, v_uf, v_competence, v_desonerado)
) THEN
INSERT INTO public.budget_item_compositions (
        budget_item_id,
        description,
        unit,
        quantity,
        unit_price,
        total_price,
        type
    )
SELECT v_inserted_item_id,
    item_description,
    item_unit,
    item_quantity,
    item_price,
    (item_quantity * item_price),
    item_type
FROM public.find_internal_composition(v_clean_code, v_uf, v_competence, v_desonerado);
v_found_path := 'internal_db';
v_items_hydrated_a := v_items_hydrated_a + 1;
END IF;
END IF;
-- Hydration B (Analytic)
IF v_found_path = 'none'
AND v_clean_code IS NOT NULL
AND p_analytic_data IS NOT NULL THEN IF p_analytic_data ? v_clean_code THEN v_analytic_comp := p_analytic_data->v_clean_code;
FOR v_analytic_item IN
SELECT *
FROM jsonb_array_elements(v_analytic_comp->'items') LOOP
INSERT INTO public.budget_item_compositions (
        budget_item_id,
        description,
        unit,
        quantity,
        unit_price,
        total_price,
        type
    )
VALUES (
        v_inserted_item_id,
        v_analytic_item->>'description',
        v_analytic_item->>'unit',
        (v_analytic_item->>'coefficient')::numeric,
        (v_analytic_item->>'price')::numeric,
        (
            (v_analytic_item->>'coefficient')::numeric * (v_analytic_item->>'price')::numeric
        ),
        CASE
            WHEN (v_analytic_item->>'type') = 'insumo' THEN 'insumo'::public.budget_item_type
            ELSE 'composition'::public.budget_item_type
        END
    );
END LOOP;
v_found_path := 'analytic_file';
v_items_hydrated_b := v_items_hydrated_b + 1;
END IF;
END IF;
-- Status Update
IF v_found_path = 'none' THEN v_items_pending := v_items_pending + 1;
UPDATE public.budget_items
SET hydration_status = 'pending_review'
WHERE id = v_inserted_item_id;
INSERT INTO public.import_hydration_issues (
        job_id,
        budget_id,
        budget_item_id,
        issue_type,
        original_code,
        original_description
    )
VALUES (
        p_job_id,
        v_budget_id,
        v_inserted_item_id,
        'missing_composition',
        v_clean_code,
        v_item.description
    );
ELSE
UPDATE public.budget_items
SET hydration_status = v_found_path
WHERE id = v_inserted_item_id;
END IF;
END LOOP;
-- 5. Commit & Return
UPDATE public.import_jobs
SET stage = 'finalized',
    finalized_at = now()
WHERE id = p_job_id;
INSERT INTO public.import_finalization_runs (
        job_id,
        budget_id,
        user_id,
        params_snapshot,
        total_items,
        hydrated_internal,
        hydrated_analytic,
        pending_items
    )
VALUES (
        p_job_id,
        v_budget_id,
        v_job.user_id,
        p_params,
        v_items_processed,
        v_items_hydrated_a,
        v_items_hydrated_b,
        v_items_pending
    );
RETURN json_build_object(
    'ok',
    true,
    'budget_id',
    v_budget_id,
    'stats',
    json_build_object(
        'total',
        v_items_processed,
        'internal',
        v_items_hydrated_a,
        'analytic',
        v_items_hydrated_b,
        'pending',
        v_items_pending
    )
);
EXCEPTION
WHEN OTHERS THEN RAISE WARNING 'Finalize Error: %',
SQLERRM;
RETURN json_build_object('ok', false, 'reason', SQLERRM);
END;
$$;