-- ============================================================================
-- NABOORÇA • FIX PHASE 3 STOPWORDS & DEDUP (V3 - Based on 20260301 v8)
-- Migration: 20260302_fix_phase3_stopwords_dedup.sql
-- ============================================================================

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
    v_inferred_name text;
BEGIN
    -- 0. Timeout local
    SET LOCAL statement_timeout = '300s'; -- 5min para segurança

    -- 1. Setup & Validation (SERIALIZE ACCESS TO THE JOB)
    SELECT * INTO v_job
    FROM public.import_jobs
    WHERE id = p_job_id
    FOR UPDATE; -- <--- LOCK THE ROW TO PREVENT RACE CONDITIONS

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

    -- Params Extraction
    v_uf := COALESCE(p_params->>'uf', 'BA');
    v_competence := COALESCE(p_params->>'competence', to_char(now(), 'YYYY-MM'));
    v_desonerado := COALESCE((p_params->>'desonerado')::boolean, true);
    v_use_parser := COALESCE((p_params->>'enable_structure_parser_v1')::boolean, true);

    -- 2. Budget Creation / Idempotency Guard
    IF v_job.result_budget_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.budgets WHERE id = v_job.result_budget_id) THEN
        -- CRITICAL GUARD: Se o job já avançou além da inserção, RETORNE IMEDIATAMENTE sem limpar itens!
        IF v_job.stage IN ('pending_hydration', 'finalized') THEN
            RAISE NOTICE 'Job % already processed (stage: %). Returning existing budget %.', p_job_id, v_job.stage, v_job.result_budget_id;
            RETURN json_build_object(
                'ok', true,
                'budget_id', v_job.result_budget_id,
                'stage', v_job.stage,
                'already_finalized', true
            );
        END IF;

        -- Reuso de budget existente mas em estágio inicial: limpa e reinicia
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

    -- 1.2. REAL ITEMS CHECK
    IF NOT EXISTS (
        SELECT 1
        FROM public.import_ai_items
        WHERE job_id = p_job_id
            AND (description NOT LIKE 'Falha na leitura automática%')
    ) THEN
        RETURN json_build_object('ok', false, 'reason', 'extraction_failed_no_items');
    END IF;

    -- Salvar analytic_data no settings do budget para o worker usar depois
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
                        -- Inferir nome N1: primeiro tenta filhos, depois o próprio path
                        SELECT description INTO v_inferred_name
                        FROM public.import_ai_items
                        WHERE job_id = p_job_id
                          AND (
                              item_path LIKE v_n1_key || '.%'
                              OR item_path = v_n1_key
                          )
                          AND composition_code IS NULL
                          AND COALESCE(unit_price, 0) = 0
                          AND COALESCE(quantity, 0) = 0
                          AND length(trim(description)) >= 5
                        ORDER BY 
                          CASE WHEN item_path = v_n1_key THEN 0 ELSE 1 END,
                          idx ASC
                        LIMIT 1;

                        INSERT INTO public.budget_items
                            (budget_id, user_id, level, description, type, order_index, hydration_details)
                        VALUES (v_budget_id, v_job.user_id, 1,
                            COALESCE(v_inferred_name, 'SEÇÃO ' || v_n1_key), 'group', v_items_processed,
                            jsonb_build_object('parser', 'v1', 'path_key', v_n1_key))
                        RETURNING id INTO v_n1_id;

                        -- Desambiguação: se nome N1 já existe neste budget, adicionar sufixo
                        IF v_inferred_name IS NOT NULL AND EXISTS (
                            SELECT 1 FROM public.budget_items
                            WHERE budget_id = v_budget_id
                              AND level = 1
                              AND description = v_inferred_name
                              AND id != v_n1_id
                        ) THEN
                            UPDATE public.budget_items
                            SET description = v_inferred_name || ' (Seção ' || v_n1_key || ')'
                            WHERE id = v_n1_id;
                        END IF;
                    END IF;

                    -- Quando path tem exatamente 2 segmentos (ex: "1.1" ou "2.1")
                    IF v_path_depth = 2 THEN
                        -- É um título de grupo N2 (sem código e sem preço): cria/renomeia grupo e faz skip
                        IF v_item.composition_code IS NULL
                           AND COALESCE(v_item.unit_price, 0) = 0
                           AND COALESCE(v_item.quantity, 0) = 0 THEN
                            
                            -- Stop-word guard: pula linhas de total/subtotal sem criar grupo
                            IF v_clean_description ~* '^\s*TOTAL\s*(SEM|COM)\s*BDI'
                               OR v_clean_description ~* '^\s*TOTAL\s*GERAL'
                               OR v_clean_description ~* '^\s*SUBTOTAL'
                               OR trim(v_clean_description) ~* '^TOTAL$' THEN
                                CONTINUE;
                            END IF;

                            SELECT id INTO v_n2_id FROM public.budget_items
                            WHERE budget_id = v_budget_id
                              AND level = 2
                              AND hydration_details->>'path_key' = v_n2_key;
                            IF v_n2_id IS NULL THEN
                                -- Inferir nome N2: primeiro tenta filhos, depois o próprio path
                                SELECT description INTO v_inferred_name
                                FROM public.import_ai_items
                                WHERE job_id = p_job_id
                                  AND (
                                      item_path LIKE v_n2_key || '.%'
                                      OR item_path = v_n2_key
                                  )
                                  AND composition_code IS NULL
                                  AND COALESCE(unit_price, 0) = 0
                                  AND COALESCE(quantity, 0) = 0
                                  AND length(trim(description)) >= 5
                                ORDER BY 
                                  CASE WHEN item_path = v_n2_key THEN 0 ELSE 1 END,
                                  idx ASC
                                LIMIT 1;
                                INSERT INTO public.budget_items
                                    (budget_id, user_id, level, parent_id, description, type, order_index, hydration_details)
                                VALUES (v_budget_id, v_job.user_id, 2, v_n1_id,
                                    COALESCE(v_inferred_name, 'GRUPO ' || v_n2_key), 'group', v_items_processed,
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
                            -- É um item real filho direto do N1 (seção sem subdivisão, ex: 2.1, 2.2)
                            v_parent_id := v_n1_id;
                            v_level := 3;
                        END IF;

                    -- Quando path tem 3+ segmentos (ex: "1.1.1")
                    ELSIF v_path_depth = 3 THEN
                        
                        -- Stop-word guard: pula linhas de total/subtotal sem criar grupo
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
                              AND (item_path LIKE v_n2_key || '.%' OR item_path = v_n2_key)
                              AND composition_code IS NULL
                              AND COALESCE(unit_price, 0) = 0
                              AND COALESCE(quantity, 0) = 0
                              AND length(trim(description)) >= 5
                            ORDER BY 
                              CASE WHEN item_path = v_n2_key THEN 0 ELSE 1 END,
                              idx ASC
                            LIMIT 1;
                            INSERT INTO public.budget_items
                                (budget_id, user_id, level, parent_id, description, type, order_index, hydration_details)
                            VALUES (v_budget_id, v_job.user_id, 2, v_n1_id,
                                COALESCE(v_inferred_name, 'GRUPO ' || v_n2_key), 'group', v_items_processed,
                                jsonb_build_object('parser', 'v1', 'path_key', v_n2_key))
                            RETURNING id INTO v_n2_id;
                        END IF;
                        v_parent_id := v_n2_id;
                        v_level := 3;

                    ELSIF v_path_depth >= 4 THEN
                        
                        -- Stop-word guard: pula linhas de total/subtotal sem criar grupo
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
                              AND (item_path LIKE v_n2_key || '.%' OR item_path = v_n2_key)
                              AND composition_code IS NULL
                              AND COALESCE(unit_price, 0) = 0
                              AND COALESCE(quantity, 0) = 0
                              AND length(trim(description)) >= 5
                            ORDER BY 
                              CASE WHEN item_path = v_n2_key THEN 0 ELSE 1 END,
                              idx ASC
                            LIMIT 1;
                            INSERT INTO public.budget_items
                                (budget_id, user_id, level, parent_id, description, type, order_index, hydration_details)
                            VALUES (v_budget_id, v_job.user_id, 2, v_n1_id,
                                COALESCE(v_inferred_name, 'GRUPO ' || v_n2_key), 'group', v_items_processed,
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
                              AND (item_path LIKE v_n3_key || '.%' OR item_path = v_n3_key)
                              AND composition_code IS NULL
                              AND COALESCE(unit_price, 0) = 0
                              AND COALESCE(quantity, 0) = 0
                              AND length(trim(description)) >= 5
                            ORDER BY 
                              CASE WHEN item_path = v_n3_key THEN 0 ELSE 1 END,
                              idx ASC
                            LIMIT 1;
                            INSERT INTO public.budget_items
                                (budget_id, user_id, level, parent_id, description, type, order_index, hydration_details)
                            VALUES (v_budget_id, v_job.user_id, 3, v_n2_id,
                                COALESCE(v_inferred_name, 'GRUPO ' || v_n3_key), 'group', v_items_processed,
                                jsonb_build_object('parser', 'v1', 'path_key', v_n3_key))
                            RETURNING id INTO v_n3_id;
                        END IF;
                        v_parent_id := v_n3_id;
                        v_level := 4;
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

        -- Skip phantom item: INSTALAÇÕES HIDROSSANITÁRIAS sem código
        IF v_clean_description ILIKE '%INSTALAÇÕES HIDROSSANITÁRIAS%' AND v_item.composition_code IS NULL THEN
            CONTINUE;
        END IF;

        -- Skip phantom item: descrição idêntica ao nome de grupo/seção 
        -- já existente no budget (evita duplicatas de títulos como L3)
        IF (v_item.composition_code IS NULL OR trim(v_clean_code) = '0')
           AND EXISTS (
               SELECT 1 FROM public.budget_items
               WHERE budget_id = v_budget_id
                 AND level IN (1, 2)
                 AND type = 'group'
                 AND upper(trim(description)) = upper(trim(v_clean_description))
           ) THEN
            CONTINUE;
        END IF;

        -- Skip: continuação de descrição longa (sem código, mesma qty/price de item já existente no mesmo path)
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

        -- Skip: item sem quantidade quando já existe versão válida no mesmo path+código
        IF v_item.composition_code IS NOT NULL
           AND v_item.item_path IS NOT NULL
           AND COALESCE(v_item.quantity, 0) = 0
           AND EXISTS (
               SELECT 1 FROM public.import_ai_items
               WHERE job_id = p_job_id
                 AND item_path = v_item.item_path
                 AND composition_code = v_item.composition_code
                 AND quantity IS NOT NULL
                 AND quantity > 0
                 AND idx != v_item.idx
           ) THEN
            CONTINUE;
        END IF;

        -- Skip: duplicata de batch — já passou registro válido com mesma chave antes
        IF v_item.composition_code IS NOT NULL
           AND v_item.item_path IS NOT NULL
           AND COALESCE(v_item.quantity, 0) > 0
           AND EXISTS (
               SELECT 1 FROM public.import_ai_items
               WHERE job_id = p_job_id
                 AND item_path = v_item.item_path
                 AND composition_code = v_item.composition_code
                 AND quantity IS NOT NULL
                 AND quantity > 0
                 AND idx < v_item.idx
           ) THEN
            CONTINUE;
        END IF;

        -- Skip: Stop-words de totais de seção do PDF
        IF v_clean_description ~* '^\s*TOTAL\s*(SEM|COM)\s*BDI'
           OR v_clean_description ~* '^\s*TOTAL\s*GERAL'
           OR v_clean_description ~* '^\s*SUBTOTAL'
           OR trim(v_clean_description) ~* '^TOTAL$' THEN
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
            COALESCE(v_item.quantity, 0), COALESCE(v_item.unit_price, 0),
            (COALESCE(v_item.quantity, 0) * COALESCE(v_item.unit_price, 0)),
            (COALESCE(v_item.quantity, 0) * COALESCE(v_item.unit_price, 0)),
            'insumo',
            COALESCE(v_item.price_source, CASE WHEN v_item.composition_code IS NOT NULL THEN 'AI_EXTRACTED_CODE' ELSE 'IMPORTADO' END),
            v_clean_code, v_item.id, v_items_processed,
            jsonb_build_object('parser', CASE WHEN v_use_parser THEN 'v1' ELSE 'flat' END, 'path_key', v_numbering),
            CASE
                WHEN COALESCE(v_item.quantity, 0) = 0 OR COALESCE(v_item.unit_price, 0) = 0
                THEN 'pending_hydration'
                ELSE 'pending_review'
            END)
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
    -- Reverte o stage para não travar o job
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
