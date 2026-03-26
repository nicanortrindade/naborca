drop function if exists "public"."find_composition_in_bases"(p_code text, p_user_id uuid, p_uf text, p_competence text, p_desonerado boolean, p_bases_selecionadas text[]);

alter table "public"."budget_item_compositions" add column "composition_code" text;

alter table "public"."budget_item_compositions" add column "parent_composition_id" uuid;

CREATE INDEX idx_bic_composition_code ON public.budget_item_compositions USING btree (composition_code) WHERE (composition_code IS NOT NULL);

CREATE INDEX idx_bic_parent ON public.budget_item_compositions USING btree (parent_composition_id) WHERE (parent_composition_id IS NOT NULL);

alter table "public"."budget_item_compositions" add constraint "budget_item_compositions_parent_composition_id_fkey" FOREIGN KEY (parent_composition_id) REFERENCES public.budget_item_compositions(id) ON DELETE CASCADE not valid;

alter table "public"."budget_item_compositions" validate constraint "budget_item_compositions_parent_composition_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.auto_finalize_pending_jobs()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE 
  v_job RECORD; 
  v_result json; 
  v_budget_id uuid;
BEGIN
  SELECT id, user_id, result_budget_id INTO v_job
  FROM public.import_jobs
  WHERE status = 'done'
    AND stage IN ('ocr_queued', 'finalizing')
    AND updated_at > now() - interval '2 hours'
  ORDER BY updated_at DESC
  LIMIT 1 FOR UPDATE SKIP LOCKED;

  IF v_job.id IS NULL THEN RETURN; END IF;

  -- Chamada única à função idempotente
  SELECT public.finalize_import_to_budget(
    v_job.id, v_job.user_id,
    '{"uf":"BA","competence":"2026-02","desonerado":true,"enable_structure_parser_v1":true}'::jsonb,
    '{}'::jsonb
  ) INTO v_result;

  -- Captura o result_budget_id que foi recém-criado, ou usa o anterior
  v_budget_id := COALESCE((v_result->>'budget_id')::uuid, v_job.result_budget_id);

  IF v_budget_id IS NOT NULL THEN
    PERFORM public.recalc_budget(v_budget_id);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[auto_finalize] Error: %', SQLERRM;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_next_ocr_job(p_worker_id text, p_lock_duration_sec integer DEFAULT 900)
 RETURNS SETOF public.import_ocr_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_job_id uuid;
BEGIN
    SELECT id INTO v_job_id
    FROM public.import_ocr_jobs
    WHERE status = 'pending'
      AND (scheduled_for IS NULL OR scheduled_for <= now())
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_job_id IS NOT NULL THEN
        RETURN QUERY
        UPDATE public.import_ocr_jobs
        SET
            status = 'processing',
            locked_by = p_worker_id,
            lock_expires_at = now() + (p_lock_duration_sec || ' seconds')::interval,
            started_at = COALESCE(started_at, now()),
            updated_at = now()
        WHERE id = v_job_id
        RETURNING *;
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_stale_ocr_jobs()
 RETURNS TABLE(requeued_count integer, failed_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_requeued int;
    v_failed int;
BEGIN
    -- 1. Requeue (Soft Stale): processing > 10m AND retry_count < max
    WITH requeued AS (
        UPDATE public.import_ocr_jobs
        SET
            status = 'pending',
            locked_by = NULL,
            lock_expires_at = NULL,
            started_at = NULL,
            retry_count = retry_count + 1,
            last_error = substring('Stale Processing Timeout (10m). Requeued. ' || coalesce(last_error, '') from 1 for 500),
            updated_at = now(),
            scheduled_for = now() + interval '10 seconds' * (retry_count + 1)
        WHERE
            status = 'processing'
            AND started_at < (now() - interval '10 minutes')
            AND retry_count < max_retries
        RETURNING id
    )
    SELECT count(*) INTO v_requeued FROM requeued;

    -- 2. Fail (Hard Stale): processing > 10m AND retry_count >= max
    WITH failed_jobs AS (
        UPDATE public.import_ocr_jobs
        SET
            status = 'failed',
            locked_by = NULL,
            lock_expires_at = NULL,
            last_error = 'Stale Processing Timeout (10m). Max retries exceeded.',
            completed_at = now(),
            updated_at = now()
        WHERE
            status = 'processing'
            AND started_at < (now() - interval '10 minutes')
            AND retry_count >= max_retries
        RETURNING id
    )
    SELECT count(*) INTO v_failed FROM failed_jobs;

    RETURN QUERY SELECT v_requeued, v_failed;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.finalize_import_to_budget(p_job_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_params jsonb DEFAULT '{}'::jsonb, p_analytic_data jsonb DEFAULT '{}'::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    v_bdi_calc numeric;
    v_bdi_ratio numeric;
    v_bdi_rate_elem record;
    v_bdi_rate_val numeric;
    v_bdi_expected numeric;
    v_search_key text;
    v_found_id uuid;
BEGIN
    SET LOCAL statement_timeout = '300s';

    SELECT * INTO v_job
    FROM public.import_jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF v_job.id IS NULL THEN
    -- Preencher path_key
    UPDATE budget_items bi
    SET path_key = ai.item_path
    FROM import_ai_items ai
    WHERE ai.id = bi.source_import_item_id
      AND bi.budget_id = v_budget_id
      AND bi.path_key IS NULL;

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
        ---------------------------------------------------------------
        -- PATCH: era IN ('pending_hydration', 'finalized')
        -- Agora só bloqueia 'finalized'. pending_hydration continua
        -- para permitir reprocessamento com novos params (BDI editado)
        ---------------------------------------------------------------
        IF v_job.stage = 'finalized' THEN
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
            sinapi_regime = CASE WHEN v_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END,
            bdi = COALESCE((p_params->>'bdi_mode')::numeric, 0)
        WHERE id = v_budget_id;
    ELSE
        INSERT INTO public.budgets (user_id, name, status, sinapi_uf, sinapi_competence, sinapi_regime, settings, bdi, created_at)
        VALUES (v_job.user_id, 'Orçamento Importado ' || to_char(now(), 'DD/MM HH24:MI'), 'draft',
            v_uf, v_competence,
            CASE WHEN v_desonerado THEN 'DESONERADO' ELSE 'NAO_DESONERADO' END,
            p_params, COALESCE((p_params->>'bdi_mode')::numeric, 0), now())
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
        ORDER BY string_to_array(item_path, '.')::int[] ASC NULLS LAST, idx ASC
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
                            v_parent_id := v_n1_id;
                            v_level     := 3;
                        END IF;

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

                        IF v_path_parts[3] = '0' THEN
                            -- Pular grupo fantasma, usar n2 como parent
                            v_parent_id := v_n2_id;
                            v_level := 3;
                        ELSE
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

                            -- BUSCAR PARENT DINAMICAMENTE
                            v_parent_id := v_n3_id;
                            FOR i IN REVERSE (v_path_depth - 1)..4 LOOP
                                v_search_key := array_to_string(v_path_parts[1:i], '.');
                                SELECT id INTO v_found_id FROM public.budget_items
                                WHERE budget_id = v_budget_id AND level = i
                                  AND hydration_details->>'path_key' = v_search_key
                                  AND type = 'group'
                                LIMIT 1;
                                
                                IF v_found_id IS NOT NULL THEN
                                    v_parent_id := v_found_id;
                                    EXIT;
                                END IF;
                            END LOOP;

                            v_level := LEAST(v_path_depth, 5);
                        END IF;

                        -- VERIFICAR SE O ITEM ATUAL É UM GRUPO
                        IF v_item.composition_code IS NULL
                           AND COALESCE(v_item.unit_price, 0) = 0
                           AND COALESCE(v_item.quantity, 0) = 0
                           AND NOT EXISTS (
                               SELECT 1 FROM public.import_ai_items
                               WHERE job_id = p_job_id
                                 AND item_path = v_item.item_path
                                 AND (composition_code IS NOT NULL OR COALESCE(unit_price, 0) > 0)
                           ) THEN
                            
                            INSERT INTO public.budget_items
                                (budget_id, user_id, level, parent_id, description, type, order_index, hydration_details)
                            VALUES (v_budget_id, v_job.user_id, v_level, v_parent_id,
                                COALESCE(v_clean_description, 'GRUPO ' || v_item.item_path),
                                'group', v_items_processed,
                                jsonb_build_object('parser', 'v1', 'path_key', v_item.item_path));
                                
                            CONTINUE;
                        END IF;
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

        v_clean_code := COALESCE(
            v_item.composition_code,
            substring(v_clean_description FROM '^([0-9]{4,})'),
            '0'
        );

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
            v_budget_id, v_job.user_id, LEAST(v_level, 5), v_parent_id,
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
$function$
;

CREATE OR REPLACE FUNCTION public.finalize_ready_import_jobs(p_limit integer DEFAULT 10)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  r RECORD;
  v_count int := 0;
  v_last_batch int;
  v_total_batches int;
  v_result jsonb;
BEGIN
  FOR r IN
    SELECT j.id, j.user_id
    FROM public.import_jobs j
    WHERE j.status = 'done'
      AND j.result_budget_id IS NULL
      AND j.stage != 'finalized'
      AND j.stage != 'ocr_failed'
      AND EXISTS (SELECT 1 FROM public.import_ai_items a WHERE a.job_id = j.id)
    ORDER BY j.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT COALESCE((metadata->'stageB'->>'total_batches')::int, 0),
             COALESCE((metadata->'stageB'->>'last_persisted_batch_index')::int, -1)
      INTO v_total_batches, v_last_batch
      FROM public.import_files
      WHERE job_id = r.id AND doc_role = 'synthetic'
      LIMIT 1;

      IF v_total_batches > 0 AND v_last_batch >= v_total_batches - 1 THEN
        SELECT public.finalize_import_to_budget(
          r.id, r.user_id, '{}'::jsonb, '[]'::jsonb
        ) INTO v_result;
        v_count := v_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.import_jobs
      SET error_message = left(SQLERRM, 500), updated_at = now()
      WHERE id = r.id;
    END;
  END LOOP;
  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.find_internal_composition(p_code text, p_uf text, p_competence text, p_desonerado boolean)
 RETURNS TABLE(item_code text, item_description text, item_unit text, item_quantity numeric, item_price numeric, item_type text)
 LANGUAGE plpgsql
 STABLE
AS $function$
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
    LEFT JOIN public.sinapi_inputs_base i ON child.item_type = 'INSUMO' AND i.code = child.item_code
    LEFT JOIN public.sinapi_input_prices ip ON ip.input_code = child.item_code AND ip.price_table_id = v_table_id
    LEFT JOIN public.sinapi_compositions c ON child.item_type = 'COMPOSICAO' AND c.code = child.item_code
    LEFT JOIN public.sinapi_composition_prices cp ON cp.composition_code = child.item_code AND cp.price_table_id = v_table_id
    WHERE child.price_table_id = v_table_id
      AND child.composition_code = p_code;
END;

$function$
;

CREATE OR REPLACE FUNCTION public.import_extraction_watchdog()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_count int := 0;
    v_job RECORD;
    v_next_retry_interval interval;
    v_current_attempts int;
BEGIN
    FOR v_job IN
        SELECT id, extraction_attempts
        FROM public.import_jobs
        WHERE status = 'processing'
          AND (stage IN ('ocr_done', 'processing', 'ready_to_extract', 'ocr_queued') OR stage IS NULL)
          AND COALESCE(heartbeat_at, updated_at) < (now() - interval '45 minutes')
          AND (extraction_retryable = false OR extraction_retryable IS NULL)
    LOOP
        v_current_attempts := v_job.extraction_attempts + 1;

        IF v_job.extraction_attempts < 6 THEN
            v_next_retry_interval := interval '1 minute';

            UPDATE public.import_jobs
            SET 
                extraction_retryable = true,
                extraction_last_reason = 'watchdog_timeout_processing',
                extraction_next_retry_at = now() + v_next_retry_interval,
                updated_at = now()
            WHERE id = v_job.id;
        ELSE
            UPDATE public.import_jobs
            SET 
                status = 'failed',
                last_error = 'watchdog_timeout_processing (exhausted_retries)',
                extraction_last_reason = 'exhausted_retries',
                extraction_retryable = false,
                updated_at = now()
            WHERE id = v_job.id;
        END IF;

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;

$function$
;

CREATE OR REPLACE FUNCTION public.ingest_sinapi_inputs(_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    WITH r AS (
      SELECT
        coalesce((x->>'id')::uuid, gen_random_uuid()) AS id,
        x->>'source' AS source,
        x->>'code' AS code,
        x->>'description' AS description,
        x->>'unit' AS unit,
        x->>'category' AS category,
        coalesce((x->>'active')::boolean, true) AS active,
        now() AS created_at,
        now() AS updated_at
      FROM jsonb_array_elements(_rows) x
      WHERE x ? 'source' AND x ? 'code'
    ),
    dedup AS (
      SELECT DISTINCT ON (source, code) *
      FROM r ORDER BY source, code, updated_at DESC
    )
    INSERT INTO sinapi_inputs_base (id, source, code, description, unit, category, active, created_at, updated_at)
    SELECT id, source, code, description, unit, category, active, created_at, updated_at
    FROM dedup
    ON CONFLICT ON CONSTRAINT unique_sinapi_input DO UPDATE SET
      description = EXCLUDED.description,
      unit = EXCLUDED.unit,
      category = EXCLUDED.category,
      active = EXCLUDED.active,
      updated_at = now();
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ingest_sinapi_inputs failed: %', sqlerrm;
END;

$function$
;

CREATE OR REPLACE FUNCTION public.ingest_sinapi_inputs_batch(p_inputs jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_count integer := 0;
BEGIN
    INSERT INTO sinapi_inputs_base (source, code, description, unit, category, active)
    SELECT
        COALESCE(i->>'source', 'SINAPI'),
        i->>'code',
        i->>'description',
        i->>'unit',
        i->>'category',
        true
    FROM jsonb_array_elements(p_inputs) i
    ON CONFLICT (source, code) DO UPDATE SET
        description = EXCLUDED.description,
        unit = EXCLUDED.unit,
        category = EXCLUDED.category,
        active = true,
        updated_at = now();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;

$function$
;

CREATE OR REPLACE FUNCTION public.persist_analytic_data(p_budget_id uuid, p_user_id uuid, p_analytic_data jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_comp RECORD;
    v_item RECORD;
    v_budget_item_id UUID;
    v_count INTEGER := 0;
    v_comp_code TEXT;
BEGIN
    FOR v_comp IN SELECT key AS comp_key, value AS comp_data FROM jsonb_each(p_analytic_data)
    LOOP
        -- 1ª tentativa: busca por path_key (chave é o item_path ex: '1.1.1')
        SELECT id INTO v_budget_item_id
        FROM budget_items
        WHERE budget_id = p_budget_id
          AND path_key = v_comp.comp_key
        LIMIT 1;

        -- 2ª tentativa (fallback): busca por code (chave é o código ex: '88247')
        IF v_budget_item_id IS NULL THEN
            v_comp_code := v_comp.comp_data->>'code';
            IF v_comp_code IS NOT NULL AND v_comp_code != '' THEN
                SELECT id INTO v_budget_item_id
                FROM budget_items
                WHERE budget_id = p_budget_id
                  AND (
                      code = v_comp_code
                      OR code = REPLACE(v_comp_code, ' ', '')
                  )
                LIMIT 1;
            END IF;
        END IF;

        IF v_budget_item_id IS NULL THEN
            CONTINUE;
        END IF;

        DELETE FROM budget_item_compositions
        WHERE budget_item_id = v_budget_item_id;

        FOR v_item IN SELECT * FROM jsonb_array_elements(v_comp.comp_data->'items')
        LOOP
            INSERT INTO budget_item_compositions (
                budget_item_id, user_id, description, unit, quantity,
                unit_price, total_price, metadata
            ) VALUES (
                v_budget_item_id,
                p_user_id,
                v_item.value->>'description',
                v_item.value->>'unit',
                COALESCE((v_item.value->>'coefficient')::numeric, 0),
                COALESCE((v_item.value->>'price')::numeric, 0),
                ROUND(COALESCE((v_item.value->>'coefficient')::numeric, 0) * COALESCE((v_item.value->>'price')::numeric, 0), 2),
                jsonb_build_object(
                    'code', v_item.value->>'code',
                    'type', v_item.value->>'type',
                    'source', CASE
                        WHEN v_item.value->>'code' ~ '^\d{5,6}$' THEN 'SINAPI'
                        ELSE 'Próprio'
                    END,
                    'original_comp_key', v_comp.comp_key,
                    'original_comp_code', v_comp.comp_data->>'code'
                )
            );
            v_count := v_count + 1;
        END LOOP;
    END LOOP;

    RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_hydration_batch(p_budget_id uuid, p_job_id uuid, p_user_id uuid, p_uf text DEFAULT 'BA'::text, p_competence text DEFAULT NULL::text, p_desonerado boolean DEFAULT true, p_batch_size integer DEFAULT 20)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_item          record;
    v_clean_code    text;
    v_found_path    text;
    v_hydration_count int;
    v_processed     int := 0;
    v_hydrated_a    int := 0;
    v_hydrated_b    int := 0;
    v_hydrated_c    int := 0;
    v_remaining     int;
    v_competence    text;
    v_analytic_data jsonb;
    v_analytic_comp jsonb;
    v_analytic_item jsonb;
    v_match_key     text;
    v_item_desc     text;
BEGIN
    v_competence := COALESCE(p_competence, to_char(now(), 'YYYY-MM'));

    SELECT (settings->'_hydration_params'->>'analytic_data')::jsonb
    INTO v_analytic_data
    FROM public.budgets WHERE id = p_budget_id;
    v_analytic_data := COALESCE(v_analytic_data, '{}'::jsonb);

    FOR v_item IN
        SELECT id, code, description, source_import_item_id
        FROM public.budget_items
        WHERE budget_id = p_budget_id
          AND hydration_status = 'pending_review'
          AND type = 'insumo'
          AND code IS NOT NULL AND code != '0'
        ORDER BY order_index ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    LOOP
        v_found_path := 'none';
        v_clean_code := v_item.code;
        v_processed := v_processed + 1;
        v_match_key := NULL;

        -- ── Caminho A: SINAPI + Bases Externas ──────────────────────────
        INSERT INTO public.budget_item_compositions (budget_item_id, user_id, description, unit, quantity, unit_price, total_price, metadata)
        SELECT v_item.id, p_user_id, item_description, item_unit, item_quantity, item_price, (item_quantity * item_price),
            jsonb_build_object('source', source_base, 'code', v_clean_code)
        FROM public.find_composition_in_bases(v_clean_code, p_user_id, p_uf, v_competence, p_desonerado);
        GET DIAGNOSTICS v_hydration_count := ROW_COUNT;

        IF v_hydration_count > 0 THEN
            v_found_path := 'internal_db';
            v_hydrated_a := v_hydrated_a + 1;

        -- ── Caminho B: Analítico por código direto ────────────────────────
        ELSIF v_analytic_data ? v_clean_code THEN
            v_match_key := v_clean_code;

        -- ── Caminho C: Analítico por descrição (fallback frankenstein) ────
        ELSE
            v_item_desc := lower(left(v_item.description, 30));
            SELECT j.key INTO v_match_key
            FROM jsonb_each(v_analytic_data) AS j(key, value)
            WHERE lower(left(j.value->>'description', 30)) = v_item_desc
            LIMIT 1;
        END IF;

        -- Processar match analítico (B ou C)
        IF v_found_path = 'none' AND v_match_key IS NOT NULL THEN
            v_analytic_comp := v_analytic_data->v_match_key;
            FOR v_analytic_item IN SELECT * FROM jsonb_array_elements(v_analytic_comp->'items') LOOP
                INSERT INTO public.budget_item_compositions (budget_item_id, user_id, description, unit, quantity, unit_price, total_price, metadata)
                VALUES (v_item.id, p_user_id, v_analytic_item->>'description', v_analytic_item->>'unit',
                    COALESCE((v_analytic_item->>'coefficient')::numeric, 0),
                    COALESCE((v_analytic_item->>'price')::numeric, 0),
                    (COALESCE((v_analytic_item->>'coefficient')::numeric, 0) * COALESCE((v_analytic_item->>'price')::numeric, 0)),
                    jsonb_build_object('source', 'analytic_file', 'code', v_match_key,
                        'match_type', CASE WHEN v_match_key = v_clean_code THEN 'code' ELSE 'description' END));
            END LOOP;
            v_found_path := 'analytic_file';
            IF v_match_key = v_clean_code THEN
                v_hydrated_b := v_hydrated_b + 1;
            ELSE
                v_hydrated_c := v_hydrated_c + 1;
            END IF;
        END IF;

        IF v_found_path = 'none' THEN
            INSERT INTO public.import_hydration_issues (job_id, budget_id, budget_item_id, issue_type, original_code, original_description)
            SELECT p_job_id, p_budget_id, v_item.id, 'missing_composition', v_clean_code, bi.description
            FROM public.budget_items bi WHERE bi.id = v_item.id
            ON CONFLICT DO NOTHING;
        ELSE
            UPDATE public.budget_items
            SET hydration_status = v_found_path
            WHERE id = v_item.id;
        END IF;
    END LOOP;

    UPDATE public.budget_items
    SET hydration_status = 'none'
    WHERE budget_id = p_budget_id
      AND hydration_status = 'pending_review'
      AND type = 'insumo'
      AND (code IS NULL OR code = '0');

    SELECT COUNT(*) INTO v_remaining
    FROM public.budget_items
    WHERE budget_id = p_budget_id
      AND hydration_status = 'pending_review'
      AND type = 'insumo'
      AND code IS NOT NULL AND code != '0';

    IF v_remaining = 0 THEN
        UPDATE public.import_jobs
        SET stage = 'finalized', finalized_at = now(), updated_at = now()
        WHERE id = p_job_id;
        UPDATE public.budgets
        SET settings = settings - '_hydration_params'
        WHERE id = p_budget_id;
    END IF;

    RETURN json_build_object(
        'processed', v_processed,
        'hydrated_a', v_hydrated_a,
        'hydrated_b', v_hydrated_b,
        'hydrated_c', v_hydrated_c,
        'remaining', v_remaining,
        'is_complete', (v_remaining = 0)
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'process_hydration_batch Error: %', SQLERRM;
    RETURN json_build_object('ok', false, 'reason', SQLERRM, 'processed', v_processed);
END;

$function$
;


  create policy "allow_all_imports"
  on "storage"."objects"
  as permissive
  for all
  to authenticated
using ((bucket_id = 'imports'::text))
with check ((bucket_id = 'imports'::text));



