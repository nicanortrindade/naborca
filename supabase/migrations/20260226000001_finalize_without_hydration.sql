-- ============================================================================
-- NABOORÇA • ASYNC HYDRATION ARCHITECTURE
-- Migration: 20260226000001_finalize_without_hydration.sql
-- Data: 2026-02-26
-- ============================================================================
-- OBJETIVO:
--   1. Reescrever finalize_import_to_budget para inserir itens SEM hydration,
--      marcando stage = 'pending_hydration' ao final.
--   2. Criar process_hydration_batch para processar hydration em lotes
--      assíncronos, marcando stage = 'finalized' ao completar.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 1: finalize_import_to_budget (sem hydration)
-- Mesma assinatura: (uuid, uuid, jsonb, jsonb) → preserva compatibilidade
-- ─────────────────────────────────────────────────────────────────────────────

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
    -- Path Parser
    v_path_parts  text[];
    v_path_depth  int;
    v_n1_key      text;
    v_n2_key      text;
    v_n3_key      text;
    v_n1_id       uuid;
    v_n2_id       uuid;
    v_n3_id       uuid;
BEGIN
    -- 0. Timeout local
    SET LOCAL statement_timeout = '120s'; -- Apenas inserção, sem hydration: 120s suficiente

    -- 1. Setup & Validation
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

    -- Salvar analytic_data no settings do budget para o worker usar depois
    -- (sem precisar repassar via parâmetro na chamada assíncrona)
    UPDATE public.budgets
    SET settings = settings || jsonb_build_object(
        '_hydration_params', jsonb_build_object(
            'uf', v_uf,
            'competence', v_competence,
            'desonerado', v_desonerado,
            'analytic_data', p_analytic_data
        )
    )
    WHERE id = v_budget_id;

    -- 3. Lazy Fallback Roots (criados apenas se necessário)
    v_fallback_l1_id := NULL;
    v_fallback_l2_id := NULL;
    v_current_n1_id := NULL;
    v_current_n2_id := NULL;

    -- 4. Items Loop (APENAS INSERÇÃO — sem hydration)
    FOR v_item IN SELECT * FROM public.import_ai_items WHERE job_id = p_job_id ORDER BY idx ASC LOOP
        v_items_processed := v_items_processed + 1;
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

                    -- Quando path tem exatamente 2 segmentos (ex: "1.1" ou "2.1")
                    IF v_path_depth = 2 THEN
                        -- É um título de grupo N2 (sem código e sem preço): skip para renomear grupo
                        IF v_item.composition_code IS NULL 
                           AND COALESCE(v_item.unit_price, 0) = 0 
                           AND COALESCE(v_item.quantity, 0) = 0 THEN
                            -- Renomeia o grupo N2 genérico se existir
                            UPDATE public.budget_items
                            SET description = v_clean_description
                            WHERE budget_id = v_budget_id
                              AND hydration_details->>'path_key' = v_n2_key
                              AND (description LIKE 'GRUPO %');
                            CONTINUE;
                        ELSE
                            -- É um item real filho direto do N1 (seção sem subdivisão)
                            v_parent_id := v_n1_id;
                            v_level := 3;
                        END IF;
                    -- Quando path tem 3+ segmentos (ex: "1.1.1")
                    ELSIF v_path_depth >= 3 THEN
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
                    -- Cria fallback L1 lazy se necessário
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

        -- == INSERT L3 ITEM ==
        v_clean_code := COALESCE(v_item.composition_code, substring(v_clean_description FROM '^([0-9]{4,})'), '0');

        -- Skip pure section items (kind=composition, no code, no price)
        IF v_clean_code = '0' AND COALESCE(v_item.unit_price, 0) = 0 AND COALESCE(v_item.quantity, 0) = 0 THEN
            IF v_numbering IS NOT NULL THEN
                UPDATE public.budget_items
                SET description = v_clean_description
                WHERE budget_id = v_budget_id
                  AND hydration_details->>'path_key' = v_numbering
                  AND (description LIKE 'SEÇÃO %' OR description LIKE 'GRUPO %' OR description LIKE 'SUBGRUPO %');
            END IF;
            CONTINUE;
        END IF;

        -- Skip multiline duplicate (same item_path, same price/qty as previous item, no code OR no values)
        IF v_item.composition_code IS NULL
           AND v_item.item_path IS NOT NULL
           AND (
               (COALESCE(v_item.unit_price, 0) = 0 AND COALESCE(v_item.quantity, 0) = 0)
               OR
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

        -- Check: Skip coded multiline duplicate
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

        -- Garante fallback L2 lazy se parent_id ainda for NULL
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

        -- Inserir item com hydration_status = 'pending_review' (será hidratado de forma assíncrona)
        INSERT INTO public.budget_items (budget_id, user_id, level, parent_id, description, unit, quantity, unit_price,
            total_price, final_price, type, source, code, source_import_item_id, order_index, hydration_details, hydration_status)
        VALUES (v_budget_id, v_job.user_id, 3, v_parent_id, v_clean_description, COALESCE(v_item.unit, 'UN'),
            COALESCE(v_item.quantity, 1), COALESCE(v_item.unit_price, 0),
            (COALESCE(v_item.quantity, 1) * COALESCE(v_item.unit_price, 0)),
            (COALESCE(v_item.quantity, 1) * COALESCE(v_item.unit_price, 0)),
            'insumo',
            CASE WHEN v_item.composition_code IS NOT NULL THEN 'AI_EXTRACTED_CODE' ELSE 'IMPORTADO' END,
            v_clean_code, v_item.id, v_items_processed,
            jsonb_build_object('parser', CASE WHEN v_use_parser THEN 'v1' ELSE 'flat' END, 'path_key', v_numbering),
            'pending_review')  -- ← todos começam como pending_review
        RETURNING id INTO v_inserted_item_id;

    END LOOP;

    -- 5. Marcar job como pending_hydration (em vez de finalized)
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
    RAISE WARNING 'Finalize Error: %', SQLERRM;
    RETURN json_build_object('ok', false, 'reason', SQLERRM);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 2: process_hydration_batch
-- Processa um lote de budget_items com hydration_status = 'pending_review'
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.process_hydration_batch(uuid, uuid, uuid, text, text, boolean, int);

CREATE OR REPLACE FUNCTION public.process_hydration_batch(
    p_budget_id   uuid,
    p_job_id      uuid,
    p_user_id     uuid,
    p_uf          text    DEFAULT 'BA',
    p_competence  text    DEFAULT NULL,
    p_desonerado  boolean DEFAULT true,
    p_batch_size  int     DEFAULT 20
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_item          record;
    v_clean_code    text;
    v_found_path    text;
    v_hydration_count int;
    v_processed     int := 0;
    v_hydrated_a    int := 0;
    v_hydrated_b    int := 0;
    v_remaining     int;
    v_competence    text;
    -- Analytic
    v_analytic_data jsonb;
    v_analytic_comp jsonb;
    v_analytic_item jsonb;
BEGIN
    -- Resolver competence padrão
    v_competence := COALESCE(p_competence, to_char(now(), 'YYYY-MM'));

    -- Recuperar analytic_data salvo no settings do budget durante o finalize
    SELECT (settings->'_hydration_params'->>'analytic_data')::jsonb
    INTO v_analytic_data
    FROM public.budgets
    WHERE id = p_budget_id;

    v_analytic_data := COALESCE(v_analytic_data, '{}'::jsonb);

    -- Processar lote: pegar os próximos p_batch_size itens pendentes (code != '0')
    FOR v_item IN
        SELECT id, code, source_import_item_id
        FROM public.budget_items
        WHERE budget_id = p_budget_id
          AND hydration_status = 'pending_review'
          AND type = 'insumo'
          AND code IS NOT NULL
          AND code != '0'
        ORDER BY order_index ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED  -- evita concorrência se houver múltiplos workers (segurança)
    LOOP
        v_found_path := 'none';
        v_clean_code := v_item.code;
        v_processed := v_processed + 1;

        -- ── Hydration A: SINAPI + Bases Externas ──────────────────────────
        INSERT INTO public.budget_item_compositions (budget_item_id, user_id, description, unit, quantity, unit_price, total_price, metadata)
        SELECT v_item.id, p_user_id, item_description, item_unit, item_quantity, item_price, (item_quantity * item_price),
            jsonb_build_object('source', source_base, 'code', v_clean_code)
        FROM public.find_composition_in_bases(v_clean_code, p_user_id, p_uf, v_competence, p_desonerado);

        GET DIAGNOSTICS v_hydration_count := ROW_COUNT;

        IF v_hydration_count > 0 THEN
            v_found_path := 'internal_db';
            v_hydrated_a := v_hydrated_a + 1;

        -- ── Hydration B: Arquivo Analítico ────────────────────────────────
        ELSIF v_analytic_data ? v_clean_code THEN
            v_analytic_comp := v_analytic_data->v_clean_code;
            FOR v_analytic_item IN SELECT * FROM jsonb_array_elements(v_analytic_comp->'items') LOOP
                INSERT INTO public.budget_item_compositions (budget_item_id, user_id, description, unit, quantity, unit_price, total_price, metadata)
                VALUES (v_item.id, p_user_id, v_analytic_item->>'description', v_analytic_item->>'unit',
                    (v_analytic_item->>'coefficient')::numeric, (v_analytic_item->>'price')::numeric,
                    ((v_analytic_item->>'coefficient')::numeric * (v_analytic_item->>'price')::numeric),
                    jsonb_build_object('source', 'analytic_file', 'code', v_clean_code));
            END LOOP;
            v_found_path := 'analytic_file';
            v_hydrated_b := v_hydrated_b + 1;
        END IF;

        -- Atualizar status do item
        IF v_found_path = 'none' THEN
            -- Mantém pending_review e cria issue para resolução manual
            INSERT INTO public.import_hydration_issues (job_id, budget_id, budget_item_id, issue_type, original_code, original_description)
            SELECT p_job_id, p_budget_id, v_item.id, 'missing_composition', v_clean_code, bi.description
            FROM public.budget_items bi WHERE bi.id = v_item.id
            ON CONFLICT DO NOTHING;
            -- Status fica pending_review: já está assim, não precisa update
        ELSE
            UPDATE public.budget_items
            SET hydration_status = v_found_path
            WHERE id = v_item.id;
        END IF;
    END LOOP;

    -- Também resolver itens com code = '0' (sem código): marcar direto como 'none' para não ficarem travados
    UPDATE public.budget_items
    SET hydration_status = 'none'
    WHERE budget_id = p_budget_id
      AND hydration_status = 'pending_review'
      AND type = 'insumo'
      AND (code IS NULL OR code = '0');

    -- Calcular quantos ainda estão pendentes
    SELECT COUNT(*) INTO v_remaining
    FROM public.budget_items
    WHERE budget_id = p_budget_id
      AND hydration_status = 'pending_review'
      AND type = 'insumo'
      AND code IS NOT NULL
      AND code != '0';

    -- Se não há mais pendentes: finalizar o job
    IF v_remaining = 0 THEN
        UPDATE public.import_jobs
        SET stage = 'finalized', finalized_at = now(), updated_at = now()
        WHERE id = p_job_id;

        -- Limpar hydration_params do budget settings (dados temporários)
        UPDATE public.budgets
        SET settings = settings - '_hydration_params'
        WHERE id = p_budget_id;
    END IF;

    RETURN json_build_object(
        'processed', v_processed,
        'hydrated_a', v_hydrated_a,
        'hydrated_b', v_hydrated_b,
        'remaining', v_remaining,
        'is_complete', (v_remaining = 0)
    );

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'process_hydration_batch Error: %', SQLERRM;
    RETURN json_build_object('ok', false, 'reason', SQLERRM, 'processed', v_processed);
END;
$$;
