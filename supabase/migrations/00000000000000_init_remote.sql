


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."import_doc_role" AS ENUM (
    'synthetic',
    'analytical',
    'unknown'
);


ALTER TYPE "public"."import_doc_role" OWNER TO "postgres";


CREATE TYPE "public"."import_file_kind" AS ENUM (
    'pdf',
    'excel',
    'other'
);


ALTER TYPE "public"."import_file_kind" OWNER TO "postgres";


CREATE TYPE "public"."import_job_status" AS ENUM (
    'queued',
    'processing',
    'waiting_user',
    'applying',
    'done',
    'failed',
    'waiting_user_extraction_failed'
);


ALTER TYPE "public"."import_job_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."__touch_postgrest_cache"() RETURNS "text"
    LANGUAGE "sql"
    AS $$ select 'ok'; $$;


ALTER FUNCTION "public"."__touch_postgrest_cache"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_app_secret"("secret_name" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'private', 'public'
    AS $$
declare
  v text;
begin
  select value into v
  from private.app_secrets
  where name = secret_name;

  if v is null then
    raise exception 'Missing secret in private.app_secrets: %', secret_name;
  end if;

  return v;
end;
$$;


ALTER FUNCTION "public"."_app_secret"("secret_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_get_service_role_key"() RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'SUPABASE_SERVICE_ROLE_KEY'
  limit 1
$$;


ALTER FUNCTION "public"."_get_service_role_key"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_confirm_import_job"("p_job_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_count int;
begin
  -- garante que o job existe e está no estado correto
  select count(*) into v_count
  from import_jobs
  where id = p_job_id
    and status = 'waiting_user';

  if v_count = 0 then
    return json_build_object(
      'ok', false,
      'error', 'JOB_NOT_IN_WAITING_USER'
    );
  end if;

  -- marca como applying (transição explícita)
  update import_jobs
  set status = 'applying',
      updated_at = now()
  where id = p_job_id;

  -- AQUI entraria a lógica futura de aplicar no orçamento real
  -- (por enquanto apenas finaliza)

  update import_jobs
  set status = 'done',
      updated_at = now()
  where id = p_job_id;

  return json_build_object(
    'ok', true,
    'job_id', p_job_id,
    'status', 'done'
  );
exception
  when others then
    update import_jobs
    set status = 'failed',
        error_message = left(sqlerrm, 800),
        updated_at = now()
    where id = p_job_id;

    return json_build_object(
      'ok', false,
      'error', sqlerrm
    );
end;
$$;


ALTER FUNCTION "public"."admin_confirm_import_job"("p_job_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."import_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "public"."import_job_status" DEFAULT 'queued'::"public"."import_job_status" NOT NULL,
    "doc_role" "public"."import_doc_role" DEFAULT 'unknown'::"public"."import_doc_role" NOT NULL,
    "document_context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_desonerado" boolean,
    "progress" integer DEFAULT 0 NOT NULL,
    "current_step" "text",
    "error_message" "text",
    "artifacts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "stage" "text",
    "stage_updated_at" timestamp with time zone DEFAULT "now"(),
    "last_error" "text",
    "heartbeat_at" timestamp with time zone,
    "extraction_attempts" integer DEFAULT 0 NOT NULL,
    "extraction_retryable" boolean DEFAULT false NOT NULL,
    "extraction_next_retry_at" timestamp with time zone,
    "extraction_last_reason" "text",
    "result_budget_id" "uuid",
    "finalized_at" timestamp with time zone,
    "finalization_cursor" integer DEFAULT 0,
    CONSTRAINT "import_jobs_progress_check" CHECK ((("progress" >= 0) AND ("progress" <= 100)))
);


ALTER TABLE "public"."import_jobs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_start_import_job"("job_id" "uuid") RETURNS "public"."import_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_job public.import_jobs;
begin
  select *
    into v_job
  from public.import_jobs
  where id = job_id
  for update;

  if not found then
    raise exception 'import_job not found: %', job_id
      using errcode = 'P0002';
  end if;

  if v_job.current_step in (
      'queued_for_parse_worker',
      'processing',
      'waiting_user',
      'done',
      'failed'
  ) then
    return v_job;
  end if;

  update public.import_jobs
     set current_step = coalesce(v_job.current_step, 'queued'),
         updated_at = now()
   where id = job_id
   returning * into v_job;

  return v_job;
end;
$$;


ALTER FUNCTION "public"."admin_start_import_job"("job_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atomic_merge_stageb_metadata"("file_id" "uuid", "stageb_data" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE import_files
  SET metadata = COALESCE(metadata, '{}'::jsonb) || 
                 jsonb_build_object('stageB', 
                   COALESCE(metadata->'stageB', '{}'::jsonb) || stageb_data
                 )
  WHERE id = file_id;
END;
$$;


ALTER FUNCTION "public"."atomic_merge_stageb_metadata"("file_id" "uuid", "stageb_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_finalize_pending_jobs"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."auto_finalize_pending_jobs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."block_worker_placeholder_ai_items"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- Bloqueia apenas se raw_line for explicitamente um placeholder "puro"
  -- (evita falso-positivo em itens reais que por algum motivo carreguem esse trecho)
  if new.raw_line is not null then
    if btrim(lower(new.raw_line)) in (
      'placeholder gerado pelo worker',
      '[placeholder gerado pelo worker]',
      '(placeholder gerado pelo worker)'
    ) then
      raise exception 'blocked_placeholder_ai_item';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."block_worker_placeholder_ai_items"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calc_budget_item_total"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.total_price :=
    COALESCE(NEW.quantity, 0) * COALESCE(NEW.unit_price, 0);

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."calc_budget_item_total"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_import_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  job_count integer;
begin
  select count(*) into job_count
  from public.import_jobs
  where user_id = new.user_id
    and created_at > now() - interval '1 hour';

  -- LIMITE: 50 jobs/hora por usuário (ajuste conforme necessidade)
  -- Bloqueia quando atingir/exceder o limite.
  if job_count >= 50 then
    raise exception 'Limite de segurança: Muitas importações em pouco tempo. Aguarde.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."check_import_rate_limit"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_ocr_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "import_file_id" "uuid" NOT NULL,
    "total_chunks" integer,
    "next_chunk_index" integer DEFAULT 0 NOT NULL,
    "chunks_processed" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" integer DEFAULT 0,
    "scheduled_for" timestamp with time zone DEFAULT "now"(),
    "locked_by" "text",
    "lock_expires_at" timestamp with time zone,
    "retry_count" integer DEFAULT 0,
    "max_retries" integer DEFAULT 5,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    CONSTRAINT "import_ocr_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."import_ocr_jobs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_ocr_job"("p_worker_id" "text", "p_lock_duration_sec" integer DEFAULT 900) RETURNS SETOF "public"."import_ocr_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."claim_next_ocr_job"("p_worker_id" "text", "p_lock_duration_sec" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_stale_ocr_jobs"() RETURNS TABLE("requeued_count" integer, "failed_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."cleanup_stale_ocr_jobs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."debug_finalize_timing"("p_job_id" "uuid", "p_user_id" "uuid", "p_budget_id" "uuid", "p_price_table_id" "uuid") RETURNS TABLE("etapa" "text", "ms" integer, "rows_affected" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "statement_timeout" TO '600s'
    AS $_$
DECLARE
    v_start timestamptz;
    v_count int;
    v_fallback_root_id uuid;
    v_fallback_leaf_id uuid;
BEGIN
    -- ETAPA 1: Limpeza
    v_start := clock_timestamp();
    DELETE FROM public.budget_item_compositions
    WHERE budget_item_id IN (SELECT id FROM public.budget_items WHERE budget_id = p_budget_id);
    DELETE FROM public.import_hydration_issues WHERE budget_id = p_budget_id;
    DELETE FROM public.budget_items WHERE budget_id = p_budget_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    etapa := 'limpeza'; ms := EXTRACT(EPOCH FROM clock_timestamp() - v_start)::numeric * 1000; rows_affected := v_count; RETURN NEXT;

    -- ETAPA 2: Fallback
    v_start := clock_timestamp();
    INSERT INTO public.budget_items (budget_id, user_id, description, level, parent_id, type, order_index, hydration_status)
    VALUES (p_budget_id, p_user_id, 'IMPORTAÇÃO AUTOMÁTICA', 1, NULL, 'group', 0, 'none')
    RETURNING id INTO v_fallback_root_id;
    INSERT INTO public.budget_items (budget_id, user_id, description, level, parent_id, type, order_index, hydration_status)
    VALUES (p_budget_id, p_user_id, 'ITENS DA LISTA', 2, v_fallback_root_id, 'group', 1, 'none')
    RETURNING id INTO v_fallback_leaf_id;
    etapa := 'fallback'; ms := EXTRACT(EPOCH FROM clock_timestamp() - v_start)::numeric * 1000; rows_affected := 2; RETURN NEXT;

    -- ETAPA 3: PRE-PASS INSERT nós intermediários
    v_start := clock_timestamp();
    WITH
    all_paths AS (
        SELECT DISTINCT item_path, array_length(string_to_array(item_path, '.'), 1) AS depth
        FROM public.import_ai_items WHERE job_id = p_job_id AND item_path IS NOT NULL
    ),
    ancestors AS (
        SELECT generate_series(1, depth - 1) AS seg_depth, string_to_array(item_path, '.') AS parts
        FROM all_paths
    ),
    intermediate_paths AS (
        SELECT DISTINCT array_to_string(parts[1:seg_depth], '.') AS node_path, seg_depth AS node_level
        FROM ancestors
        UNION
        SELECT item_path, depth FROM all_paths ap
        WHERE EXISTS (
            SELECT 1 FROM public.import_ai_items iai
            WHERE iai.job_id = p_job_id AND iai.item_path = ap.item_path
              AND (iai.composition_code IS NULL OR iai.composition_code = '')
              AND (iai.unit_price IS NULL OR iai.unit_price = 0)
              AND (iai.quantity IS NULL OR iai.quantity = 0)
        )
    ),
    titled AS (
        SELECT DISTINCT ON (item_path) item_path, description
        FROM public.import_ai_items
        WHERE job_id = p_job_id
          AND (composition_code IS NULL OR composition_code = '')
          AND (unit_price IS NULL OR unit_price = 0)
          AND (quantity IS NULL OR quantity = 0)
        ORDER BY item_path, idx
    )
    INSERT INTO public.budget_items (budget_id, user_id, description, level, parent_id, type, order_index, hydration_status, hydration_details)
    SELECT p_budget_id, p_user_id,
        COALESCE(NULLIF(trim(t.description), ''), 'GRUPO ' || ip.node_path),
        ip.node_level, NULL, 'group',
        ((string_to_array(ip.node_path, '.'))[1]::bigint * 100 +
         COALESCE(NULLIF((string_to_array(ip.node_path, '.'))[2], '')::bigint, 0))::int,
        'none', jsonb_build_object('path_key', ip.node_path)
    FROM intermediate_paths ip
    LEFT JOIN titled t ON t.item_path = ip.node_path
    ORDER BY ip.node_level, ip.node_path;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    etapa := 'prepass_insert'; ms := EXTRACT(EPOCH FROM clock_timestamp() - v_start)::numeric * 1000; rows_affected := v_count; RETURN NEXT;

    -- ETAPA 4: UPDATE parent_id
    v_start := clock_timestamp();
    UPDATE public.budget_items child
    SET parent_id = parent.id
    FROM public.budget_items parent
    WHERE child.budget_id = p_budget_id AND parent.budget_id = p_budget_id
      AND child.type = 'group' AND parent.type = 'group'
      AND child.parent_id IS NULL AND child.id <> v_fallback_root_id
      AND child.hydration_details->>'path_key' IS NOT NULL
      AND parent.hydration_details->>'path_key' = regexp_replace(
          child.hydration_details->>'path_key', '\.[^.]+$', ''
      );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    etapa := 'update_parent_id'; ms := EXTRACT(EPOCH FROM clock_timestamp() - v_start)::numeric * 1000; rows_affected := v_count; RETURN NEXT;

    -- ETAPA 5: INSERT itens folha
    v_start := clock_timestamp();
    WITH deduped AS (
        SELECT DISTINCT ON (item_path, COALESCE(composition_code, description))
            id, item_path, description, composition_code, unit, quantity, unit_price
        FROM public.import_ai_items
        WHERE job_id = p_job_id AND item_path IS NOT NULL AND item_path ~ '^[0-9]'
          AND ((composition_code IS NOT NULL AND composition_code <> '')
               OR (unit_price IS NOT NULL AND unit_price > 0)
               OR (quantity IS NOT NULL AND quantity > 0))
        ORDER BY item_path, COALESCE(composition_code, description),
                 (unit_price IS NOT NULL AND unit_price > 0) DESC, idx DESC
    ),
    with_parent AS (
        SELECT d.*, array_length(string_to_array(d.item_path, '.'), 1) AS depth,
            COALESCE(pn.id, v_fallback_leaf_id) AS resolved_parent_id
        FROM deduped d
        LEFT JOIN public.budget_items pn
            ON pn.budget_id = p_budget_id AND pn.type = 'group'
            AND pn.hydration_details->>'path_key' = CASE
                WHEN array_length(string_to_array(d.item_path, '.'), 1) = 1 THEN NULL
                ELSE regexp_replace(d.item_path, '\.[^.]+$', '')
            END
    )
    INSERT INTO public.budget_items (
        budget_id, user_id, description, level, parent_id,
        code, unit, quantity, unit_price, total_price,
        type, order_index, hydration_status, hydration_details, source_import_item_id
    )
    SELECT p_budget_id, p_user_id,
        COALESCE(NULLIF(trim(wp.description), ''), 'Item sem descrição'),
        wp.depth, wp.resolved_parent_id,
        NULLIF(trim(COALESCE(wp.composition_code, '')), ''),
        COALESCE(NULLIF(trim(COALESCE(wp.unit, '')), ''), 'UN'),
        COALESCE(wp.quantity, 0), COALESCE(wp.unit_price, 0),
        ROUND(COALESCE(wp.quantity, 0) * COALESCE(wp.unit_price, 0), 2),
        'insumo',
        ((string_to_array(wp.item_path, '.'))[1]::bigint * 10000 +
         COALESCE(NULLIF((string_to_array(wp.item_path, '.'))[2], '')::bigint, 0) * 100 +
         ROW_NUMBER() OVER (ORDER BY wp.item_path))::int,
        'pending_review',
        jsonb_build_object('parser', 'v1', 'path_key', wp.item_path),
        wp.id
    FROM with_parent wp;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    etapa := 'insert_itens'; ms := EXTRACT(EPOCH FROM clock_timestamp() - v_start)::numeric * 1000; rows_affected := v_count; RETURN NEXT;

    -- ETAPA 6a: Hidratação SINAPI composições
    v_start := clock_timestamp();
    UPDATE public.budget_items bi
    SET unit_price = scp.price,
        total_price = ROUND(bi.quantity * scp.price, 2),
        hydration_status = 'internal_db'
    FROM public.sinapi_composition_prices scp
    WHERE bi.budget_id = p_budget_id AND bi.hydration_status = 'pending_review'
      AND bi.code = scp.composition_code
      AND scp.price_table_id = p_price_table_id AND scp.price > 0;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    etapa := 'sinapi_composicoes'; ms := EXTRACT(EPOCH FROM clock_timestamp() - v_start)::numeric * 1000; rows_affected := v_count; RETURN NEXT;

    -- ETAPA 6b: Hidratação SINAPI insumos
    v_start := clock_timestamp();
    UPDATE public.budget_items bi
    SET unit_price = sip.price,
        total_price = ROUND(bi.quantity * sip.price, 2),
        hydration_status = 'internal_db'
    FROM public.sinapi_input_prices sip
    WHERE bi.budget_id = p_budget_id AND bi.hydration_status = 'pending_review'
      AND bi.code = sip.input_code
      AND sip.price_table_id = p_price_table_id AND sip.price > 0;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    etapa := 'sinapi_insumos'; ms := EXTRACT(EPOCH FROM clock_timestamp() - v_start)::numeric * 1000; rows_affected := v_count; RETURN NEXT;

    -- ETAPA 7: Issues
    v_start := clock_timestamp();
    INSERT INTO public.import_hydration_issues (
        job_id, budget_id, budget_item_id,
        issue_type, severity, status, original_code, original_description
    )
    SELECT p_job_id, p_budget_id, bi.id,
        'missing_composition', 'warning', 'open', bi.code, bi.description
    FROM public.budget_items bi
    WHERE bi.budget_id = p_budget_id
      AND bi.hydration_status = 'pending_review'
      AND bi.code IS NOT NULL AND bi.code <> '0'
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    etapa := 'issues'; ms := EXTRACT(EPOCH FROM clock_timestamp() - v_start)::numeric * 1000; rows_affected := v_count; RETURN NEXT;

END;

$_$;


ALTER FUNCTION "public"."debug_finalize_timing"("p_job_id" "uuid", "p_user_id" "uuid", "p_budget_id" "uuid", "p_price_table_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dispatch_parse_task"("max_tasks" integer DEFAULT 1) RETURNS TABLE("task_id" "uuid", "job_id" "uuid", "file_id" "uuid", "dispatch_status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_task RECORD;
    v_edge_function_url TEXT := public._app_secret('SUPABASE_URL');
    v_service_role_key TEXT := public._app_secret('SUPABASE_SERVICE_ROLE_KEY');
    v_request_id BIGINT;
    v_dispatched_count INT := 0;
BEGIN
    -- Loop para processar tasks
    FOR v_task IN
        SELECT t.id, t.job_id, t.file_id, t.attempts
        FROM public.import_parse_tasks t
        WHERE t.status = 'queued'
          AND t.attempts < t.max_attempts
        ORDER BY t.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT max_tasks
    LOOP
        -- Incrementa tentativas e marca como dispatched
        UPDATE public.import_parse_tasks
        SET 
            status = 'dispatched',
            attempts = attempts + 1,
            locked_at = NOW(),
            locked_by = 'pg_cron_dispatcher',
            updated_at = NOW()
        WHERE id = v_task.id;
        
        -- Atualiza o job para indicar que está na fila de processamento
        UPDATE public.import_jobs
        SET 
            current_step = 'dispatched_to_worker',
            updated_at = NOW()
        WHERE id = v_task.job_id;
        
        -- Tenta disparar via pg_net
        BEGIN
            -- Verifica se pg_net está disponível
            IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
                -- Dispara HTTP POST para Edge Function
                SELECT net.http_post(
                    url := v_edge_function_url || '/functions/v1/import-parse-worker',
                    headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'Authorization', 'Bearer ' || v_service_role_key
                    ),
                    body := jsonb_build_object(
                        'task_id', v_task.id::TEXT,
                        'job_id', v_task.job_id::TEXT,
                        'file_id', v_task.file_id::TEXT
                    )
                ) INTO v_request_id;
                
                task_id := v_task.id;
                job_id := v_task.job_id;
                file_id := v_task.file_id;
                dispatch_status := 'dispatched_via_pg_net';
                RETURN NEXT;
                
                v_dispatched_count := v_dispatched_count + 1;
            ELSE
                -- pg_net não disponível: marca como falha temporária
                UPDATE public.import_parse_tasks
                SET 
                    status = 'failed',
                    last_error = 'pg_net extension not available. Enable it in Supabase Dashboard.',
                    updated_at = NOW()
                WHERE id = v_task.id;
                
                task_id := v_task.id;
                job_id := v_task.job_id;
                file_id := v_task.file_id;
                dispatch_status := 'failed_no_pg_net';
                RETURN NEXT;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            -- Erro ao disparar: marca como failed
            UPDATE public.import_parse_tasks
            SET 
                status = 'failed',
                last_error = 'Dispatch error: ' || SQLERRM,
                updated_at = NOW()
            WHERE id = v_task.id;
            
            task_id := v_task.id;
            job_id := v_task.job_id;
            file_id := v_task.file_id;
            dispatch_status := 'dispatch_error: ' || SQLERRM;
            RETURN NEXT;
        END;
    END LOOP;
    
    RETURN;
END;
$$;


ALTER FUNCTION "public"."dispatch_parse_task"("max_tasks" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."dispatch_parse_task"("max_tasks" integer) IS 'Dispatcher que envia tasks para a Edge Function de parsing via pg_net.';



CREATE OR REPLACE FUNCTION "public"."ensure_sinapi_price_table"("_row" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Tenta inserir
  INSERT INTO public.sinapi_price_tables
  SELECT *
  FROM jsonb_populate_record(NULL::public.sinapi_price_tables, _row)
  ON CONFLICT ON CONSTRAINT unique_price_table
  DO UPDATE SET updated_at = now()  -- se não existir updated_at, troque por "DO NOTHING"
  RETURNING id INTO v_id;

  -- Se foi conflito e não retornou id, busca o existente
  IF v_id IS NULL THEN
    SELECT pt.id INTO v_id
    FROM public.sinapi_price_tables pt
    WHERE (pt.*) IS NOT NULL
    LIMIT 1;
    -- ↑ Isso é fallback genérico. O ideal é filtrar pela chave única real.
  END IF;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."ensure_sinapi_price_table"("_row" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_sinapi_price_table"("_source" "text", "_uf" "text", "_competence" "text", "_regime" "text", "_is_mock" boolean DEFAULT false, "_source_tag" "text" DEFAULT NULL::"text", "_file_urls" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id uuid;
begin
  begin
    insert into public.sinapi_price_tables (
      source, uf, competence, regime, is_mock, source_tag, file_urls
    )
    values (
      _source, _uf, _competence, _regime, coalesce(_is_mock, false), _source_tag, _file_urls
    )
    on conflict on constraint unique_price_table
    do update set
      file_urls = coalesce(excluded.file_urls, public.sinapi_price_tables.file_urls)
    returning id into v_id;

    if v_id is null then
      select id into v_id
      from public.sinapi_price_tables
      where source = _source
        and uf = _uf
        and competence = _competence
        and regime = _regime
        and coalesce(is_mock, false) = coalesce(_is_mock, false)
        and coalesce(source_tag, '') = coalesce(_source_tag, '')
      limit 1;
    end if;

    return v_id;

  exception when others then
    raise exception 'ensure_sinapi_price_table failed: %', sqlerrm;
  end;
end;
$$;


ALTER FUNCTION "public"."ensure_sinapi_price_table"("_source" "text", "_uf" "text", "_competence" "text", "_regime" "text", "_is_mock" boolean, "_source_tag" "text", "_file_urls" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_stuck_import_jobs"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer := 0;
begin
  update public.import_jobs j
  set
    status = 'failed',
    progress = 100,
    current_step = 'failed',
    error_message = 'watchdog_timeout_processing',
    updated_at = now()
  where
    j.status = 'processing'
    and j.updated_at < now() - interval '30 minutes'
    and not exists (
      select 1 from public.import_ai_items i where i.job_id = j.id
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."fail_stuck_import_jobs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_import_job"("p_job_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_budget_id uuid;
  v_user_id uuid;
  v_has_items boolean;
  v_total_batches int;
  v_last_batch int;
  v_all_batches_done boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('finalize_import_job:' || p_job_id::text));

  SELECT user_id, result_budget_id
    INTO v_user_id, v_budget_id
  FROM public.import_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'import_job % não encontrado ou sem user_id', p_job_id;
  END IF;

  IF v_budget_id IS NOT NULL THEN
    UPDATE public.import_jobs
    SET status = 'done', error_message = null, updated_at = now()
    WHERE id = p_job_id;
    RETURN v_budget_id;
  END IF;

  -- GUARD: verificar se todos os batches foram processados
  SELECT
    COALESCE((metadata->'stageB'->>'total_batches')::int, 0),
    COALESCE((metadata->'stageB'->>'last_persisted_batch_index')::int, -1)
  INTO v_total_batches, v_last_batch
  FROM public.import_files
  WHERE job_id = p_job_id
    AND doc_role = 'synthetic'
  LIMIT 1;

  v_all_batches_done := v_total_batches > 0 AND v_last_batch >= v_total_batches - 1;

  IF NOT v_all_batches_done THEN
    RAISE EXCEPTION 'import_job % batches incompletos (last=%, total=%) — finalização bloqueada', p_job_id, v_last_batch, v_total_batches;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.import_ai_items WHERE job_id = p_job_id LIMIT 1
  ) INTO v_has_items;

  IF NOT v_has_items THEN
    RAISE EXCEPTION 'import_job % sem itens em import_ai_items (não finaliza)', p_job_id;
  END IF;

  INSERT INTO public.budgets (user_id, name, status, total_value, created_at, updated_at, settings)
  VALUES (v_user_id, 'Importação IA - ' || p_job_id::text, 'draft', 0, now(), now(), '{}'::jsonb)
  RETURNING id INTO v_budget_id;

  WITH base AS (
    SELECT
      v_budget_id AS budget_id,
      v_user_id AS user_id,
      COALESCE((SELECT MAX(order_index) FROM public.budget_items bi WHERE bi.budget_id = v_budget_id), -1) AS last_idx
  ),
  to_insert AS (
    SELECT
      base.user_id,
      base.budget_id,
      (base.last_idx + ROW_NUMBER() OVER (ORDER BY i.created_at, i.idx))::integer AS order_index,
      COALESCE(i.level, 1) AS level,
      NULLIF(i.category,'') AS code,
      COALESCE(NULLIF(i.description,''), 'ITEM SEM DESCRIÇÃO') AS description,
      COALESCE(NULLIF(i.unit,''), 'UN') AS unit,
      COALESCE(i.quantity, 1) AS quantity,
      COALESCE(i.unit_price, 0) AS unit_price,
      COALESCE(i.total, COALESCE(i.quantity,1) * COALESCE(i.unit_price,0)) AS total_price
    FROM public.import_ai_items i
    CROSS JOIN base
    WHERE i.job_id = p_job_id
  )
  INSERT INTO public.budget_items (
    id, user_id, budget_id, order_index, level, code, description,
    unit, quantity, unit_price, total_price, source, created_at, updated_at
  )
  SELECT
    gen_random_uuid(), user_id, budget_id, order_index, level, code, description,
    unit, quantity, unit_price, total_price, 'ai_extraction', now(), now()
  FROM to_insert;

  UPDATE public.budgets
  SET total_value = COALESCE((
    SELECT SUM(COALESCE(total_price, COALESCE(quantity,1) * COALESCE(unit_price,0)))
    FROM public.budget_items WHERE budget_id = v_budget_id
  ), 0), updated_at = now()
  WHERE id = v_budget_id;

  UPDATE public.import_jobs
  SET status = 'done', result_budget_id = v_budget_id, error_message = null, updated_at = now()
  WHERE id = p_job_id;

  RETURN v_budget_id;
END;

$$;


ALTER FUNCTION "public"."finalize_import_job"("p_job_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_import_to_budget"("p_job_id" "uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid", "p_params" "jsonb" DEFAULT '{}'::"jsonb", "p_analytic_data" "jsonb" DEFAULT '{}'::"jsonb") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
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
$_$;


ALTER FUNCTION "public"."finalize_import_to_budget"("p_job_id" "uuid", "p_user_id" "uuid", "p_params" "jsonb", "p_analytic_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_ocr_job"("p_id" "uuid", "p_status" "text", "p_last_error" "text" DEFAULT NULL::"text", "p_retry_count" integer DEFAULT NULL::integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE public.import_ocr_jobs
    SET
        status          = p_status,
        locked_by       = NULL,
        lock_expires_at = NULL,
        updated_at      = now(),
        started_at      = CASE WHEN p_status = 'pending'                THEN NULL         ELSE started_at    END,
        scheduled_for   = CASE WHEN p_status = 'pending'                THEN now()        ELSE scheduled_for END,
        completed_at    = CASE WHEN p_status IN ('completed', 'failed') THEN now()        ELSE completed_at  END,
        last_error      = CASE WHEN p_last_error  IS NOT NULL           THEN p_last_error  ELSE last_error    END,
        retry_count     = CASE WHEN p_retry_count IS NOT NULL           THEN p_retry_count ELSE retry_count   END
    WHERE id = p_id;
END;
$$;


ALTER FUNCTION "public"."finalize_ocr_job"("p_id" "uuid", "p_status" "text", "p_last_error" "text", "p_retry_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_ready_import_jobs"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select j.id
    from public.import_jobs j
    where j.status = 'processing'
      and j.result_budget_id is null
      and exists (select 1 from public.import_ai_items a where a.job_id = j.id)
    order by j.created_at asc
  loop
    begin
      perform public.finalize_import_job(r.id);
      v_count := v_count + 1;
    exception when others then
      -- não trava a fila: marca erro e segue
      update public.import_jobs
      set
        error_message = left(sqlerrm, 500),
        updated_at = now()
      where id = r.id;
    end;
  end loop;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."finalize_ready_import_jobs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_ready_import_jobs"("p_limit" integer DEFAULT 10) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."finalize_ready_import_jobs"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_analytic_file_composition"("p_job_id" "uuid", "p_code" "text") RETURNS TABLE("item_code" "text", "item_description" "text", "item_unit" "text", "item_price" numeric, "item_quantity" numeric, "item_type" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- NOTE: In a real implementation this would query the JSON tree of the Analytic File
    -- For now, we return empty to force Path C (Pending) or Path A (Internal)
    -- Requires complex JSONB parsing depending on Phase 2 output format
    RETURN;
END;
$$;


ALTER FUNCTION "public"."find_analytic_file_composition"("p_job_id" "uuid", "p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_composition_in_bases"("p_code" "text", "p_user_id" "uuid", "p_uf" "text" DEFAULT 'BA'::"text", "p_competence" "text" DEFAULT NULL::"text", "p_desonerado" boolean DEFAULT true) RETURNS TABLE("item_description" "text", "item_unit" "text", "item_quantity" numeric, "item_price" numeric, "item_type" "text", "source_base" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_competence text := COALESCE(p_competence, to_char(now(), 'YYYY-MM'));
BEGIN
  -- ── PATH A: SINAPI (Fastest) ────────────────────────────────────
  RETURN QUERY
  SELECT
    fic.item_description,
    fic.item_unit,
    fic.item_quantity,
    fic.item_price,
    fic.item_type,
    'SINAPI'::text AS source_base
  FROM public.find_internal_composition(p_code, p_uf, v_competence, p_desonerado) fic;

  IF FOUND THEN
    RETURN;
  END IF;

  -- ── PATH B: Direct match in external bases ──────────────────────────────
  RETURN QUERY
  SELECT
    epi.description                     AS item_description,
    COALESCE(epi.unit, 'UN')            AS item_unit,
    1::numeric                          AS item_quantity,
    COALESCE(epi.unit_price, 0)         AS item_price,
    'insumo'::text                      AS item_type,
    epb.slug                            AS source_base
  FROM public.external_price_items epi
  JOIN public.external_price_bases epb ON epb.id = epi.base_id
  WHERE epb.user_id = p_user_id
    AND epi.code = p_code
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  -- ── PATH C: Alias match (slowest, only if needed) ───────────────────────
  RETURN QUERY
  SELECT
    epi.description                     AS item_description,
    COALESCE(epi.unit, 'UN')            AS item_unit,
    1::numeric                          AS item_quantity,
    COALESCE(epi.unit_price, 0)         AS item_price,
    'insumo'::text                      AS item_type,
    epb.slug                            AS source_base
  FROM public.price_base_aliases pba
  JOIN public.external_price_bases epb ON epb.id = pba.base_id
  JOIN public.external_price_items epi ON epi.base_id = epb.id AND epi.code = pba.canonical_code
  WHERE epb.user_id = p_user_id
    AND pba.alias_code = p_code
  LIMIT 1;
END;
$$;


ALTER FUNCTION "public"."find_composition_in_bases"("p_code" "text", "p_user_id" "uuid", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_composition_in_bases"("p_code" "text", "p_user_id" "uuid", "p_uf" "text" DEFAULT 'BA'::"text", "p_competence" "text" DEFAULT NULL::"text", "p_desonerado" boolean DEFAULT true, "p_bases_selecionadas" "text"[] DEFAULT NULL::"text"[]) RETURNS TABLE("item_description" "text", "item_unit" "text", "item_quantity" numeric, "item_price" numeric, "item_type" "text", "source_base" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_competence text := COALESCE(p_competence, to_char(now(), 'YYYY-MM'));
  v_filter_bases boolean := p_bases_selecionadas IS NOT NULL AND array_length(p_bases_selecionadas, 1) > 0;
BEGIN
  -- ── PATH A: SINAPI ────────────────────────────────────
  IF NOT v_filter_bases OR 'SINAPI' = ANY(p_bases_selecionadas) THEN
    RETURN QUERY
    SELECT
      fic.item_description,
      fic.item_unit,
      fic.item_quantity,
      fic.item_price,
      fic.item_type,
      'SINAPI'::text AS source_base
    FROM public.find_internal_composition(p_code, p_uf, v_competence, p_desonerado) fic;

    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  -- ── PATH B: Bases externas do usuário ─────────────────────────────────────
  RETURN QUERY
  SELECT
    epi.description                     AS item_description,
    COALESCE(epi.unit, 'UN')            AS item_unit,
    1::numeric                          AS item_quantity,
    COALESCE(epi.unit_price, 0)         AS item_price,
    'insumo'::text                      AS item_type,
    epb.slug                            AS source_base
  FROM public.external_price_items epi
  JOIN public.external_price_bases epb ON epb.id = epi.base_id
  WHERE epb.user_id = p_user_id
    AND (NOT v_filter_bases OR epb.slug = ANY(p_bases_selecionadas))
    AND (
      epi.code = p_code
      OR EXISTS (
        SELECT 1
        FROM public.price_base_aliases pba
        WHERE pba.base_id = epb.id
          AND pba.alias_code   = p_code
          AND pba.canonical_code = epi.code
      )
    )
  LIMIT 1;
END;
$$;


ALTER FUNCTION "public"."find_composition_in_bases"("p_code" "text", "p_user_id" "uuid", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean, "p_bases_selecionadas" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_internal_composition"("p_code" "text", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean) RETURNS TABLE("item_code" "text", "item_description" "text", "item_unit" "text", "item_quantity" numeric, "item_price" numeric, "item_type" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."find_internal_composition"("p_code" "text", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fix_import_parse_worker_cron_headers"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'cron'
    AS $_$
begin
  -- jobid 7: import-parse-worker-00
  perform cron.alter_job(
    job_id := 7,
    command := $cmd$
      select pg_sleep(30);

      with got_lock as (
        select pg_try_advisory_lock(hashtext('import-parse-worker-cron')) as ok
      )
      select
        case
          when (select ok from got_lock) is true then (
            select net.http_post(
              url := 'https://cgebiryqfqheyazwtzzm.supabase.co/functions/v1/import-parse-worker',
              headers := jsonb_build_object(
                'Content-Type','application/json',
                'Authorization','Bearer ' || coalesce(public._get_service_role_key(), 'MISSING_VAULT_SERVICE_ROLE_KEY'),
                'apikey', coalesce(public._get_service_role_key(), 'MISSING_VAULT_SERVICE_ROLE_KEY')
              ),
              body := '{}'::jsonb
            )
          )
          else null
        end as request_id;

      select case when (select ok from got_lock) is true
                  then pg_advisory_unlock(hashtext('import-parse-worker-cron'))
                  else null end;
    $cmd$
  );

  -- jobid 8: import-parse-worker-30
  perform cron.alter_job(
    job_id := 8,
    command := $cmd$
      select pg_sleep(30);

      with got_lock as (
        select pg_try_advisory_lock(hashtext('import-parse-worker-cron')) as ok
      )
      select
        case
          when (select ok from got_lock) is true then (
            select net.http_post(
              url := 'https://cgebiryqfqheyazwtzzm.supabase.co/functions/v1/import-parse-worker',
              headers := jsonb_build_object(
                'Content-Type','application/json',
                'Authorization','Bearer ' || coalesce(public._get_service_role_key(), 'MISSING_VAULT_SERVICE_ROLE_KEY'),
                'apikey', coalesce(public._get_service_role_key(), 'MISSING_VAULT_SERVICE_ROLE_KEY')
              ),
              body := '{}'::jsonb
            )
          )
          else null
        end as request_id;

      select case when (select ok from got_lock) is true
                  then pg_advisory_unlock(hashtext('import-parse-worker-cron'))
                  else null end;
    $cmd$
  );
end;
$_$;


ALTER FUNCTION "public"."fix_import_parse_worker_cron_headers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fix_prices_on_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_bdi numeric;
BEGIN
  IF NEW.type != 'insumo' THEN
    RETURN NEW;
  END IF;

  SELECT bdi_percent INTO v_bdi
  FROM budgets
  WHERE id = NEW.budget_id;

  NEW.total_price := ROUND(COALESCE(NEW.quantity, 0) * COALESCE(NEW.unit_price, 0), 2);
  NEW.final_price := ROUND(NEW.total_price * (1 + COALESCE(v_bdi, 0) / 100), 2);

  RETURN NEW;
END;

$$;


ALTER FUNCTION "public"."fix_prices_on_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_db_fingerprint"() RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'db', current_database(),
    'db_user', current_user,
    'server_addr', inet_server_addr(),
    'pg_version', version()
  );
$$;


ALTER FUNCTION "public"."get_db_fingerprint"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_extraction_retries_pending"("p_limit" integer DEFAULT 10) RETURNS TABLE("job_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT id
    FROM public.import_jobs
    WHERE extraction_retryable = true
      AND extraction_next_retry_at <= now()
      AND status != 'failed'
    ORDER BY extraction_next_retry_at ASC
    LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."get_extraction_retries_pending"("p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_extraction_retries_pending"("p_limit" integer) IS 'Retorna job_ids prontos para retry: extraction_retryable=true e extraction_next_retry_at <= now().';



CREATE OR REPLACE FUNCTION "public"."guard_import_job_waiting_user_requires_items"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_item_count bigint;
begin
  if new.status = 'waiting_user' and (old.status is distinct from new.status) then
    select count(*)
      into v_item_count
    from public.import_items
    where job_id = new.id;

    if v_item_count = 0 then
      new.status := 'failed';
      new.error_message := 'NO_ITEMS_EXTRACTED: Nenhum item foi extraído ou inserido com sucesso. Verifique o arquivo.';
      new.updated_at := now();
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."guard_import_job_waiting_user_requires_items"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_extraction_watchdog"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
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

$$;


ALTER FUNCTION "public"."import_extraction_watchdog"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."import_extraction_watchdog"() IS 'Monitor de jobs de extração travados. Implementa backoff exponencial para retentativas automáticas.';



CREATE OR REPLACE FUNCTION "public"."import_job_set_checkpoint"("p_job_id" "uuid", "p_checkpoint" "text", "p_checkpoint_ts" timestamp with time zone DEFAULT "now"()) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  update public.import_jobs
  set
    document_context =
      jsonb_set(
        jsonb_set(
          coalesce(document_context, '{}'::jsonb),
          '{debug_info,last_checkpoint}',
          to_jsonb(p_checkpoint),
          true
        ),
        '{debug_info,last_checkpoint_ts}',
        to_jsonb(p_checkpoint_ts),
        true
      ),
    current_step = p_checkpoint,
    updated_at = now()
  where id = p_job_id;
end;
$$;


ALTER FUNCTION "public"."import_job_set_checkpoint"("p_job_id" "uuid", "p_checkpoint" "text", "p_checkpoint_ts" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_jobs_watchdog"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  update public.import_jobs j
  set
    status = 'failed',
    error_message = 'watchdog_timeout_processing',
    updated_at = now()
  where
    j.status in ('processing','failed')
    and j.result_budget_id is null
    and public.should_watchdog_fail(j) = true
    and j.updated_at < now() - interval '15 minutes';
end;
$$;


ALTER FUNCTION "public"."import_jobs_watchdog"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_sinapi_composition_items"("_rows" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  begin
    with r as (
      select
        coalesce((x->>'id')::uuid, gen_random_uuid()) as id,
        (x->>'price_table_id')::uuid as price_table_id,
        x->>'composition_code' as composition_code,
        x->>'item_type' as item_type,
        x->>'item_code' as item_code,
        (x->>'coefficient')::numeric as coefficient,
        x->>'unit' as unit,
        now() as created_at
      from jsonb_array_elements(_rows) x
      where x ? 'price_table_id'
        and x ? 'composition_code'
        and x ? 'item_type'
        and x ? 'item_code'
        and x ? 'coefficient'
    ),
    dedup as (
      select distinct on (price_table_id, composition_code, item_type, item_code) *
      from r
      order by price_table_id, composition_code, item_type, item_code, created_at desc
    )
    insert into public.sinapi_composition_items (
      id, price_table_id, composition_code, item_type, item_code, coefficient, unit, created_at
    )
    select
      id, price_table_id, composition_code, item_type, item_code, coefficient, unit, created_at
    from dedup
    on conflict on constraint unique_composition_item
    do update set
      coefficient = excluded.coefficient,
      unit        = excluded.unit;
  exception when others then
    raise exception 'ingest_sinapi_composition_items failed: %', sqlerrm;
  end;
end;
$$;


ALTER FUNCTION "public"."ingest_sinapi_composition_items"("_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_sinapi_composition_items_batch"("p_items" "jsonb", "p_price_table_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_count integer;
BEGIN
    INSERT INTO public.sinapi_composition_items (
        price_table_id,
        composition_code,
        item_code,
        item_type,
        unit,
        coefficient
    )
    SELECT
        p_price_table_id,
        r.composition_code,
        r.item_code,
        r.item_type,
        r.unit,
        r.coefficient
    FROM jsonb_to_recordset(p_items) AS r(
        composition_code text,
        item_code text,
        item_type text,
        unit text,
        coefficient numeric
    )
    ON CONFLICT (price_table_id, composition_code, item_code, item_type)
    DO UPDATE SET
        unit = EXCLUDED.unit,
        coefficient = EXCLUDED.coefficient;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."ingest_sinapi_composition_items_batch"("p_items" "jsonb", "p_price_table_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_sinapi_composition_prices"("_rows" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  begin
    with r as (
      select
        coalesce((x->>'id')::uuid, gen_random_uuid()) as id,
        (x->>'price_table_id')::uuid as price_table_id,
        x->>'composition_code' as composition_code,
        (x->>'price')::numeric as price,
        now() as created_at
      from jsonb_array_elements(_rows) x
      where x ? 'price_table_id' and x ? 'composition_code' and x ? 'price'
    ),
    dedup as (
      select distinct on (price_table_id, composition_code) *
      from r
      order by price_table_id, composition_code, created_at desc
    )
    insert into public.sinapi_composition_prices (id, price_table_id, composition_code, price, created_at)
    select id, price_table_id, composition_code, price, created_at
    from dedup
    on conflict on constraint unique_composition_price
    do update set
      price = excluded.price;
  exception when others then
    raise exception 'ingest_sinapi_composition_prices failed: %', sqlerrm;
  end;
end;
$$;


ALTER FUNCTION "public"."ingest_sinapi_composition_prices"("_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_sinapi_composition_prices_batch"("p_price_table_id" "uuid", "p_prices" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_count integer := 0;
begin
  with payload as (
    select
      nullif(trim(coalesce(
        x->>'composition_code',
        x->>'comp_code',
        x->>'code'
      )), '') as composition_code,
      nullif(trim(coalesce(
        x->>'price',
        x->>'custo',
        x->>'custo_unit',
        x->>'custo_r'
      )), '')::numeric as price
    from jsonb_array_elements(coalesce(p_prices, '[]'::jsonb)) x
  ),
  cleaned as (
    select *
    from payload
    where composition_code is not null
      and price is not null
  ),
  upserted as (
    insert into public.sinapi_composition_prices (
      price_table_id,
      composition_code,
      price
    )
    select
      p_price_table_id,
      c.composition_code,
      c.price
    from cleaned c
    on conflict (price_table_id, composition_code)
    do update set
      price = excluded.price
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."ingest_sinapi_composition_prices_batch"("p_price_table_id" "uuid", "p_prices" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_sinapi_compositions"("_rows" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  begin
    with r as (
      select
        coalesce((x->>'id')::uuid, gen_random_uuid()) as id,
        x->>'source' as source,
        x->>'code' as code,
        x->>'description' as description,
        x->>'unit' as unit,
        x->>'composition_type' as composition_type,
        coalesce((x->>'active')::boolean, true) as active,
        now() as created_at,
        now() as updated_at
      from jsonb_array_elements(_rows) x
      where x ? 'source' and x ? 'code'
    ),
    dedup as (
      select distinct on (source, code) *
      from r
      order by source, code, updated_at desc
    )
    insert into public.sinapi_compositions (
      id, source, code, description, unit, composition_type, active, created_at, updated_at
    )
    select
      id, source, code, description, unit, composition_type, active, created_at, updated_at
    from dedup
    on conflict on constraint unique_sinapi_composition
    do update set
      description      = excluded.description,
      unit             = excluded.unit,
      composition_type = excluded.composition_type,
      active           = excluded.active,
      updated_at       = now();
  exception when others then
    raise exception 'ingest_sinapi_compositions failed: %', sqlerrm;
  end;
end;
$$;


ALTER FUNCTION "public"."ingest_sinapi_compositions"("_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_sinapi_compositions_batch"("p_compositions" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer := 0;
begin
  /*
    Espera: [{ source, code, description, unit, composition_type }]
    - Se composition_type não vier, fica NULL (ok)
  */

  insert into public.sinapi_compositions (source, code, description, unit, composition_type, active)
  select
    coalesce(x->>'source','SINAPI') as source,
    x->>'code' as code,
    x->>'description' as description,
    x->>'unit' as unit,
    nullif(x->>'composition_type','') as composition_type,
    true as active
  from jsonb_array_elements(p_compositions) as x
  where coalesce(x->>'code','') <> ''
  on conflict (source, code) do update
  set
    description       = excluded.description,
    unit              = excluded.unit,
    composition_type  = excluded.composition_type,
    active            = true,
    updated_at        = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."ingest_sinapi_compositions_batch"("p_compositions" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_sinapi_input_prices"("_rows" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  begin
    with r as (
      select
        coalesce((x->>'id')::uuid, gen_random_uuid()) as id,
        (x->>'price_table_id')::uuid as price_table_id,
        x->>'input_code' as input_code,
        (x->>'price')::numeric as price,
        now() as created_at
      from jsonb_array_elements(_rows) x
      where x ? 'price_table_id' and x ? 'input_code' and x ? 'price'
    ),
    dedup as (
      select distinct on (price_table_id, input_code) *
      from r
      order by price_table_id, input_code, created_at desc
    )
    insert into public.sinapi_input_prices (id, price_table_id, input_code, price, created_at)
    select id, price_table_id, input_code, price, created_at
    from dedup
    on conflict on constraint unique_input_price
    do update set
      price = excluded.price;
  exception when others then
    raise exception 'ingest_sinapi_input_prices failed: %', sqlerrm;
  end;
end;
$$;


ALTER FUNCTION "public"."ingest_sinapi_input_prices"("_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_sinapi_input_prices_batch"("p_price_table_id" "uuid", "p_prices" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_count integer := 0;
begin
  with payload as (
    select
      nullif(trim(coalesce(x->>'input_code', x->>'code')), '') as input_code,
      nullif(trim(coalesce(x->>'price', x->>'valor', x->>'custo', x->>'custo_unit')), '')::numeric as price
    from jsonb_array_elements(coalesce(p_prices, '[]'::jsonb)) x
  ),
  cleaned as (
    select *
    from payload
    where input_code is not null
      and price is not null
  ),
  upserted as (
    insert into public.sinapi_input_prices (
      price_table_id,
      input_code,
      price
    )
    select
      p_price_table_id,
      c.input_code,
      c.price
    from cleaned c
    on conflict (price_table_id, input_code)
    do update set
      price = excluded.price
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."ingest_sinapi_input_prices_batch"("p_price_table_id" "uuid", "p_prices" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_sinapi_inputs"("_rows" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  begin
    with r as (
      select
        coalesce((x->>'id')::uuid, gen_random_uuid()) as id,
        x->>'source' as source,
        x->>'code' as code,
        x->>'description' as description,
        x->>'unit' as unit,
        x->>'category' as category,
        coalesce((x->>'active')::boolean, true) as active,
        now() as created_at,
        now() as updated_at
      from jsonb_array_elements(_rows) x
      where x ? 'source' and x ? 'code'
    ),
    dedup as (
      select distinct on (source, code) *
      from r
      order by source, code, updated_at desc
    )
    insert into public.sinapi_inputs (
      id, source, code, description, unit, category, active, created_at, updated_at
    )
    select
      id, source, code, description, unit, category, active, created_at, updated_at
    from dedup
    on conflict on constraint unique_sinapi_input
    do update set
      description = excluded.description,
      unit        = excluded.unit,
      category    = excluded.category,
      active      = excluded.active,
      updated_at  = now();
  exception when others then
    raise exception 'ingest_sinapi_inputs failed: %', sqlerrm;
  end;
end;
$$;


ALTER FUNCTION "public"."ingest_sinapi_inputs"("_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_sinapi_inputs_batch"("p_inputs" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_count integer := 0;
BEGIN
    INSERT INTO sinapi_inputs (
        source,
        code,
        description,
        unit,
        category,
        active
    )
    SELECT
        COALESCE(i->>'source', 'SINAPI'),
        i->>'code',
        i->>'description',
        i->>'unit',
        i->>'category',
        true
    FROM jsonb_array_elements(p_inputs) i
    ON CONFLICT (source, code) DO UPDATE
    SET
        description = EXCLUDED.description,
        unit = EXCLUDED.unit,
        category = EXCLUDED.category,
        active = true,
        updated_at = now();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."ingest_sinapi_inputs_batch"("p_inputs" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_sinapi_price_table"("p_source" "text", "p_uf" "text", "p_competencia" "text", "p_regime" "text", "p_is_mock" boolean) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_id uuid;
begin
  insert into public.sinapi_price_tables ("source", uf, competence, regime, is_mock)
  values (p_source, p_uf, p_competencia, p_regime, p_is_mock)
  on conflict ("source", uf, competence, regime)
  do update set is_mock = excluded.is_mock
  returning id into v_id;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."ingest_sinapi_price_table"("p_source" "text", "p_uf" "text", "p_competencia" "text", "p_regime" "text", "p_is_mock" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_parse_tasks_ready"("max_tasks" integer DEFAULT 1) RETURNS SETOF "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_task_id UUID;
BEGIN
    FOR v_task_id IN
        UPDATE public.import_parse_tasks
        SET 
            status = 'dispatched',
            attempts = attempts + 1,
            locked_at = NOW(),
            locked_by = 'pg_cron_marker',
            updated_at = NOW()
        WHERE id IN (
            SELECT id FROM public.import_parse_tasks
            WHERE status = 'queued'
              AND attempts < max_attempts
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT max_tasks
        )
        RETURNING id
    LOOP
        RETURN NEXT v_task_id;
    END LOOP;
    
    RETURN;
END;
$$;


ALTER FUNCTION "public"."mark_parse_tasks_ready"("max_tasks" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mark_parse_tasks_ready"("max_tasks" integer) IS 'Alternativa ao dispatcher: marca tasks como prontas para polling por Edge Function.';



CREATE OR REPLACE FUNCTION "public"."process_hydration_batch"("p_budget_id" "uuid", "p_job_id" "uuid", "p_user_id" "uuid", "p_uf" "text" DEFAULT 'BA'::"text", "p_competence" "text" DEFAULT NULL::"text", "p_desonerado" boolean DEFAULT true, "p_batch_size" integer DEFAULT 20) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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


ALTER FUNCTION "public"."process_hydration_batch"("p_budget_id" "uuid", "p_job_id" "uuid", "p_user_id" "uuid", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean, "p_batch_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalc_budget"("bid" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    PERFORM set_config('app.recalc_running', 'true', true);

    UPDATE public.budget_items bi
    SET 
      total_price = ROUND(COALESCE(quantity, 0) * COALESCE(unit_price, 0), 2),
      final_price = ROUND(COALESCE(quantity, 0) * COALESCE(unit_price, 0) * (
        1 + COALESCE((SELECT bdi_percent FROM budgets WHERE id = bid), 0) / 100
      ), 2)
    WHERE bi.budget_id = bid
      AND NOT EXISTS (
          SELECT 1 FROM public.budget_items child
          WHERE child.parent_id = bi.id
      );

    FOR i IN 1..8 LOOP
        UPDATE public.budget_items parent
        SET total_price = COALESCE((
            SELECT SUM(child.total_price)
            FROM public.budget_items child
            WHERE child.parent_id = parent.id
        ), 0)
        WHERE parent.budget_id = bid
          AND EXISTS (
              SELECT 1 FROM public.budget_items child
              WHERE child.parent_id = parent.id
          );
    END LOOP;

    PERFORM set_config('app.recalc_running', 'false', true);
END;

$$;


ALTER FUNCTION "public"."recalc_budget"("bid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalc_budget_hierarchy"("p_budget_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Itens folha
    UPDATE public.budget_items bi
    SET total_price = quantity * final_price
    WHERE bi.budget_id = p_budget_id
      AND NOT EXISTS (
          SELECT 1 FROM public.budget_items child
          WHERE child.parent_id = bi.id
      );

    -- Nós intermediários — bottom-up recursivo
    FOR i IN 1..8 LOOP
        UPDATE public.budget_items parent
        SET total_price = COALESCE((
            SELECT SUM(child.total_price)
            FROM public.budget_items child
            WHERE child.parent_id = parent.id
        ), 0)
        WHERE parent.budget_id = p_budget_id
          AND EXISTS (
              SELECT 1 FROM public.budget_items child
              WHERE child.parent_id = parent.id
          );
    END LOOP;

    -- Peso (%) baseado na soma total das folhas
    UPDATE public.budget_items
    SET peso = CASE
        WHEN (
            SELECT SUM(total_price) FROM public.budget_items
            WHERE budget_id = p_budget_id
              AND NOT EXISTS (
                  SELECT 1 FROM public.budget_items c
                  WHERE c.parent_id = public.budget_items.id
              )
        ) = 0 THEN 0
        ELSE ROUND(
            total_price / NULLIF((
                SELECT SUM(total_price) FROM public.budget_items
                WHERE budget_id = p_budget_id
                  AND NOT EXISTS (
                      SELECT 1 FROM public.budget_items c
                      WHERE c.parent_id = public.budget_items.id
                  )
            ), 0) * 100, 2
        )
    END
    WHERE budget_id = p_budget_id;
END;

$$;


ALTER FUNCTION "public"."recalc_budget_hierarchy"("p_budget_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalc_budget_items"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.quantity IS NOT DISTINCT FROM OLD.quantity
       AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price THEN
      RETURN NEW;
    END IF;
  END IF;

  NEW.total_price :=
    COALESCE(NEW.quantity, 0) * COALESCE(NEW.unit_price, 0);

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."recalc_budget_items"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalc_sinapi_composition_prices"("p_price_table_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_round integer := 0;
  v_now   integer := 0;
  v_final integer := 0;
begin
  loop
    v_round := v_round + 1;

    with
    direct_cost as (
      select
        ci.composition_code,
        sum(ci.coefficient * ip.price) as price
      from public.sinapi_composition_items ci
      join public.sinapi_input_prices ip
        on ip.price_table_id = p_price_table_id
       and ip.input_code = ci.item_code
      where ci.item_code not in ('INSUMO','COMPOSICAO')
      group by ci.composition_code
    ),
    sub_cost as (
      select
        ci.composition_code,
        sum(ci.coefficient * cp.price) as price
      from public.sinapi_composition_items ci
      join public.sinapi_composition_prices cp
        on cp.price_table_id = p_price_table_id
       and cp.composition_code = ci.item_code
      where ci.item_code not in ('INSUMO','COMPOSICAO')
      group by ci.composition_code
    ),
    total_cost as (
      select
        p_price_table_id as price_table_id,
        c.code as composition_code,
        coalesce(d.price, 0) + coalesce(s.price, 0) as price
      from public.sinapi_compositions c
      left join direct_cost d on d.composition_code = c.code
      left join sub_cost    s on s.composition_code = c.code
      where coalesce(d.price, 0) + coalesce(s.price, 0) > 0
    ),
    upserted as (
      insert into public.sinapi_composition_prices (
        price_table_id,
        composition_code,
        price
      )
      select
        t.price_table_id,
        t.composition_code,
        t.price
      from total_cost t
      on conflict (price_table_id, composition_code)
      do update set
        price = excluded.price
      where public.sinapi_composition_prices.price is distinct from excluded.price
      returning 1
    )
    select count(*) into v_now from upserted;

    exit when v_now = 0 or v_round >= 20;
  end loop;

  select count(*) into v_final
  from public.sinapi_composition_prices
  where price_table_id = p_price_table_id;

  return v_final;
end;
$$;


ALTER FUNCTION "public"."recalc_sinapi_composition_prices"("p_price_table_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recover_stale_ocr_locks"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
    v_count int;
begin
    -- Fail jobs that exceeded retries or just reset them?
    -- Logic: If retry < max, reset to pending. Else fail.
    
    with released as (
        update public.import_ocr_jobs
        set
            status = case when retry_count < max_retries then 'pending' else 'failed' end,
            retry_count = retry_count + 1,
            last_error = case when retry_count < max_retries then 'Timeout (Lock Expired)' else 'Failed: Max Retries (Lock Expired)' end,
            locked_by = null,
            lock_expires_at = null,
            scheduled_for = now() + interval '10 seconds' * (retry_count + 1) -- Backoff
        where status = 'processing' 
          and lock_expires_at < now()
        returning id
    )
    select count(*) into v_count from released;

    return v_count;
end;
$$;


ALTER FUNCTION "public"."recover_stale_ocr_locks"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recover_stuck_parse_tasks"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_recovered INT;
BEGIN
    WITH stuck AS (
        SELECT id
        FROM public.import_parse_tasks
        WHERE status IN ('dispatched', 'running')
          AND updated_at < NOW() - INTERVAL '5 minutes'
          AND attempts < max_attempts
    )
    UPDATE public.import_parse_tasks t
    SET 
        status = 'queued',
        locked_at = NULL,
        locked_by = NULL,
        last_error = COALESCE(last_error, '') || ' [recovered from stuck at ' || NOW()::TEXT || ']',
        updated_at = NOW()
    FROM stuck
    WHERE t.id = stuck.id;
    
    GET DIAGNOSTICS v_recovered = ROW_COUNT;
    
    RETURN v_recovered;
END;
$$;


ALTER FUNCTION "public"."recover_stuck_parse_tasks"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."recover_stuck_parse_tasks"() IS 'Recupera tasks que ficaram presas por muito tempo sem atualização.';



CREATE OR REPLACE FUNCTION "public"."reorder_budget_items"("items" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "row_security" TO 'off'
    SET "search_path" TO 'public'
    AS $$
DECLARE
  item jsonb;
  affected int;
  parent_uuid uuid;
BEGIN
  FOR item IN
    SELECT * FROM jsonb_array_elements(items)
  LOOP
    -- Normalização defensiva do parentId (evita crash de cast)
    parent_uuid :=
      CASE
        WHEN item ? 'parentId'
         AND item->>'parentId' IS NOT NULL
         AND btrim(item->>'parentId') <> ''
         AND lower(btrim(item->>'parentId')) <> 'null'
         AND lower(btrim(item->>'parentId')) <> 'undefined'
        THEN (item->>'parentId')::uuid
        ELSE NULL
      END;

    UPDATE budget_items
    SET
      order_index = (item->>'order')::int,
      parent_id = parent_uuid,
      item_number = item->>'itemNumber'
    WHERE id = (item->>'id')::uuid
      AND user_id = auth.uid();

    GET DIAGNOSTICS affected = ROW_COUNT;

    IF affected = 0 THEN
      RAISE EXCEPTION
        'RPC reorder_budget_items: sem permissão ou item inexistente (id=%)',
        item->>'id';
    END IF;
  END LOOP;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."reorder_budget_items"("items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reprocess_extraction"("p_job_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_job RECORD;
BEGIN
    -- 1. Verificar existência do job
    SELECT * INTO v_job FROM public.import_jobs WHERE id = p_job_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'job_not_found');
    END IF;

    -- 2. Validar limite de tentativas
    IF v_job.extraction_attempts >= 6 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'max_attempts_reached');
    END IF;

    -- 3. Resetar estado do job
    UPDATE public.import_jobs
    SET 
        status = 'processing',
        stage = 'ready_to_extract',
        current_step = 'dispatched_to_worker',
        error_message = NULL,
        last_error = NULL,
        extraction_attempts = extraction_attempts + 1,
        extraction_retryable = false,
        extraction_next_retry_at = NULL,
        extraction_last_reason = 'retry_orchestration',
        heartbeat_at = now(),
        updated_at = now()
    WHERE id = p_job_id;

    RETURN jsonb_build_object('ok', true);
END;
$$;


ALTER FUNCTION "public"."reprocess_extraction"("p_job_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reprocess_extraction"("p_job_id" "uuid") IS 'Reseta um job de extração IA para nova tentativa manual, respeitando o limite de 6 tentativas.';



CREATE OR REPLACE FUNCTION "public"."resolve_import_hydration_issue"("p_issue_id" "uuid", "p_selected_composition" "jsonb") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_issue record;
    v_budget_item_id uuid;
    v_budget_id uuid;
    v_user_id uuid;
    v_comp_item jsonb;

    v_budget_settings jsonb;

    v_source_type text;
    v_code text;

    v_canonical_comp_id uuid;
BEGIN
    SELECT * INTO v_issue FROM public.import_hydration_issues WHERE id = p_issue_id;

    IF v_issue.id IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'issue_not_found');
    END IF;

    IF v_issue.status = 'resolved' THEN
        RETURN json_build_object('ok', false, 'reason', 'issue_already_resolved');
    END IF;

    v_budget_item_id := v_issue.budget_item_id;
    v_budget_id := v_issue.budget_id;

    SELECT user_id, settings INTO v_user_id, v_budget_settings
    FROM public.budgets WHERE id = v_budget_id;

    IF v_user_id != auth.uid() THEN
        RETURN json_build_object('ok', false, 'reason', 'forbidden');
    END IF;

    v_source_type := COALESCE(p_selected_composition->>'source_type', '');
    v_code := NULLIF(p_selected_composition->>'code', '');

    -- Se usuário escolheu SINAPI, exigir composição canônica existir em compositions
    IF COALESCE(p_selected_composition->>'source','') = 'SINAPI' AND v_code IS NOT NULL THEN
        SELECT id INTO v_canonical_comp_id
        FROM public.compositions
        WHERE code = v_code
        LIMIT 1;

        IF v_canonical_comp_id IS NULL THEN
            RETURN json_build_object(
              'ok', false,
              'reason', 'composition_catalog_missing',
              'details', jsonb_build_object('source','SINAPI','code',v_code)
            );
        END IF;
    END IF;

    -- Limpa e insere estrutura (mantido igual)
    DELETE FROM public.budget_item_compositions WHERE budget_item_id = v_budget_item_id;

    FOR v_comp_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_selected_composition->'items','[]'::jsonb))
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

    -- Atualiza item de forma consistente (agora com composition_id garantido quando SINAPI)
    UPDATE public.budget_items
    SET
      hydration_status = 'manual',
      source = COALESCE(NULLIF(p_selected_composition->>'source',''), source),
      code = v_code,
      composition_id = v_canonical_comp_id,
      hydration_details = jsonb_build_object(
        'match_source', 'manual_resolution',
        'resolved_at', now(),
        'original_issue_id', p_issue_id,
        'pending_calc', true
      ),
      updated_at = now()
    WHERE id = v_budget_item_id;

    UPDATE public.import_hydration_issues
    SET status = 'resolved', updated_at = now()
    WHERE id = p_issue_id;

    RETURN json_build_object('ok', true, 'status', 'resolved_waiting_frontend_calc');
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('ok', false, 'reason', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."resolve_import_hydration_issue"("p_issue_id" "uuid", "p_selected_composition" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_finalize_import_jobs"("p_limit" integer DEFAULT 20) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  got boolean;
  n integer := 0;
begin
  select pg_try_advisory_lock(hashtext('finalize-import-jobs-cron')) into got;

  if not got then
    return 0;
  end if;

  begin
    n := public.finalize_ready_import_jobs(p_limit);
  exception when others then
    -- se der erro aqui, pelo menos a função não trava o lock
    perform pg_advisory_unlock(hashtext('finalize-import-jobs-cron'));
    raise;
  end;

  perform pg_advisory_unlock(hashtext('finalize-import-jobs-cron'));
  return n;
end;
$$;


ALTER FUNCTION "public"."run_finalize_import_jobs"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_chunk_progress"("p_ocr_job_id" "uuid", "p_chunk_index" integer, "p_total_chunks" integer, "p_is_final" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
    update public.import_ocr_jobs
    set
        next_chunk_index = greatest(next_chunk_index, p_chunk_index + 1),
        chunks_processed = greatest(chunks_processed, p_chunk_index + 1),
        total_chunks = coalesce(total_chunks, p_total_chunks),
        status = case when p_is_final then 'completed' else 'processing' end,
        completed_at = case when p_is_final then now() else completed_at end,
        lock_expires_at = now() + interval '60 seconds', -- Extend lock while active
        updated_at = now()
    where id = p_ocr_job_id;
end;
$$;


ALTER FUNCTION "public"."save_chunk_progress"("p_ocr_job_id" "uuid", "p_chunk_index" integer, "p_total_chunks" integer, "p_is_final" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_items"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("item_type" "text", "code" "text", "description" "text", "unit" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    item_type,
    code,
    description,
    unit
  from public.sinapi_items_search
  where
    code ilike '%' || p_query || '%'
    or description ilike '%' || p_query || '%'
  order by item_type, code
  limit greatest(1, least(p_limit, 200));
$$;


ALTER FUNCTION "public"."search_items"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_sinapi_any_item"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("item_type" "text", "code" "text", "description" "text", "unit" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select *
  from (
    select 'COMPOSITION'::text as item_type, c.code, c.description, c.unit
    from public.sinapi_compositions c
    where c.code ilike '%' || p_query || '%'
       or c.description ilike '%' || p_query || '%'

    union all

    select 'INPUT'::text as item_type, i.code, i.description, i.unit
    from public.sinapi_inputs i
    where i.code ilike '%' || p_query || '%'
       or i.description ilike '%' || p_query || '%'
  ) t
  order by t.item_type, t.code
  limit greatest(1, least(p_limit, 200));
$$;


ALTER FUNCTION "public"."search_sinapi_any_item"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_sinapi_compositions"("p_q" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50) RETURNS TABLE("code" "text", "description" "text", "unit" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select c.code, c.description, c.unit
  from public.sinapi_compositions c
  where p_q is null
     or c.code ilike '%' || p_q || '%'
     or c.description ilike '%' || p_q || '%'
  order by c.code
  limit greatest(1, least(p_limit, 200));
$$;


ALTER FUNCTION "public"."search_sinapi_compositions"("p_q" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_sinapi_inputs"("p_query" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("item_type" "text", "code" "text", "description" "text", "unit" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select *
  from (
    select 'COMPOSITION'::text as item_type, c.code, c.description, c.unit
    from public.sinapi_compositions c
    where c.code ilike '%' || p_query || '%'
       or c.description ilike '%' || p_query || '%'

    union all

    select 'INPUT'::text as item_type, i.code, i.description, i.unit
    from public.sinapi_inputs i
    where i.code ilike '%' || p_query || '%'
       or i.description ilike '%' || p_query || '%'
  ) t
  order by t.item_type, t.code
  limit greatest(1, least(p_limit, 200));
$$;


ALTER FUNCTION "public"."search_sinapi_inputs"("p_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."should_poke_ocr_worker"("p_cap" integer DEFAULT 2) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_processing int;
  v_has_pending boolean;
begin
  -- 1) Se já tem "cap" jobs processando com lock válido, não pokear
  select count(*) into v_processing
  from public.import_ocr_jobs
  where status = 'processing'
    and lock_expires_at > now();

  if v_processing >= p_cap then
    return false;
  end if;

  -- 2) Se não há candidatos elegíveis, não pokear
  select exists (
    select 1
    from public.import_ocr_jobs
    where status = 'pending'
      and (scheduled_for is null or scheduled_for <= now())
      and retry_count < coalesce(max_retries, 5)
    limit 1
  ) into v_has_pending;

  return v_has_pending;
end;
$$;


ALTER FUNCTION "public"."should_poke_ocr_worker"("p_cap" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."should_watchdog_fail"("j" "public"."import_jobs") RETURNS boolean
    LANGUAGE "sql"
    AS $$
  select NOT (
    -- Job é válido e deve continuar
    exists (
      select 1
      from public.import_ai_items ai
      where ai.job_id = j.id
    )
    AND NOT exists (
      select 1
      from public.import_parse_tasks t
      where t.job_id = j.id
        and t.status in ('queued','dispatched','running')
    )
  );
$$;


ALTER FUNCTION "public"."should_watchdog_fail"("j" "public"."import_jobs") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sinapi_import_summary"("p_price_table_id" "uuid") RETURNS TABLE("price_table_id" "uuid", "priced" integer, "missing" integer, "total" integer)
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  with totals as (
    select count(*)::int as total
    from public.sinapi_compositions
  ),
  priced as (
    select count(*)::int as priced
    from public.sinapi_composition_prices
    where price_table_id = p_price_table_id
  )
  select
    p_price_table_id as price_table_id,
    p.priced,
    (t.total - p.priced) as missing,
    t.total
  from totals t
  cross join priced p;
$$;


ALTER FUNCTION "public"."sinapi_import_summary"("p_price_table_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_import_job"("p_job_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_status text;
  v_edge_url text;
  v_headers jsonb;
  v_body jsonb;
  v_req_id bigint;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select status
  into v_status
  from import_jobs
  where id = p_job_id
    and user_id = v_user_id;

  if not found then
    raise exception 'job not found or not owned by user';
  end if;

  if v_status not in ('queued', 'failed') then
    raise exception 'job status % not startable', v_status;
  end if;

  -- marca como processing (SSOT)
  update import_jobs
  set
    status = 'processing',
    error_message = null,
    updated_at = now()
  where id = p_job_id
    and user_id = v_user_id;

  -- buscar URL da Edge Function via tabela (SSOT)
  select value
  into v_edge_url
  from app_settings
  where key = 'import_processor_url';

  if v_edge_url is null then
    raise exception 'missing app_settings.import_processor_url';
  end if;

  v_headers := jsonb_build_object(
    'Content-Type','application/json'
  );

  v_body := jsonb_build_object(
    'jobId', p_job_id::text
  );

  -- disparo async da Edge Function
  select net.http_post(
    url := v_edge_url,
    headers := v_headers,
    body := v_body
  ) into v_req_id;

  return jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'request_id', v_req_id
  );

exception when others then
  update import_jobs
  set
    status = 'failed',
    error_message = left(sqlerrm, 800),
    updated_at = now()
  where id = p_job_id
    and user_id = v_user_id;

  return jsonb_build_object(
    'ok', false,
    'job_id', p_job_id,
    'error', left(sqlerrm, 800)
  );
end;
$$;


ALTER FUNCTION "public"."start_import_job"("p_job_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_import_job_from_ocr"("p_job_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
    v_total int;
    v_new_status text;
    v_current_status text;
    v_pending int; v_processing int; v_completed int; v_failed int;
    v_result jsonb;
begin
    -- 1. Get stats from children
    select count(*),
           count(*) filter (where status = 'pending'),
           count(*) filter (where status = 'processing'),
           count(*) filter (where status = 'completed'),
           count(*) filter (where status = 'failed')
    into v_total, v_pending, v_processing, v_completed, v_failed
    from public.import_ocr_jobs
    where job_id = p_job_id;

    if v_total = 0 then
        return jsonb_build_object('job_id', p_job_id, 'action', 'none');
    end if;

    -- 2. Determine Status
    if v_processing > 0 or v_pending > 0 then
        v_new_status := 'processing';
    elsif v_completed = v_total then
        v_new_status := 'done';
    elsif v_failed = v_total then
        v_new_status := 'failed';
    else
        if v_completed > 0 then
            v_new_status := 'done';
        else
            v_new_status := 'failed';
        end if;
    end if;

    -- 3. Update Parent with Explicit Cast (FIX)
    select status into v_current_status
    from public.import_jobs
    where id = p_job_id;

    if v_current_status is distinct from v_new_status then
        update public.import_jobs
        set 
            status = v_new_status::public.import_job_status,
            updated_at = now(),
            last_error = case when v_new_status = 'processing' then null else last_error end
        where id = p_job_id;

        v_result := jsonb_build_object(
            'job_id', p_job_id,
            'new_status', v_new_status,
            'status', 'updated'
        );
    else
        v_result := jsonb_build_object(
            'job_id', p_job_id,
            'status', 'unchanged'
        );
    end if;

    return v_result;
end;
$$;


ALTER FUNCTION "public"."sync_import_job_from_ocr"("p_job_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recalc_after_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  PERFORM recalc_budget(NEW.budget_id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_recalc_after_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recalc_after_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Evita loop: não dispara se já estamos dentro de um recalc
  IF current_setting('app.recalc_running', true) = 'true' THEN
    RETURN NEW;
  END IF;
  
  PERFORM set_config('app.recalc_running', 'true', true);
  PERFORM recalc_budget(NEW.budget_id);
  PERFORM set_config('app.recalc_running', 'false', true);
  
  RETURN NEW;
END;

$$;


ALTER FUNCTION "public"."trg_recalc_after_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_finalize_import_async"("p_job_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_edge_url TEXT := public._app_secret('SUPABASE_URL');
    v_service_key TEXT := public._app_secret('SUPABASE_SERVICE_ROLE_KEY');
    v_request_id BIGINT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
        RAISE EXCEPTION 'pg_net não disponível';
    END IF;

    SELECT net.http_post(
        url := v_edge_url || '/functions/v1/import-finalize-budget',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_service_key,
            'x-internal-call', 'true'
        ),
        body := jsonb_build_object(
            'job_id', p_job_id::text,
            'uf', 'BA',
            'competence', '2025-01',
            'desonerado', true,
            'enable_structure_parser_v1', true
        )
    ) INTO v_request_id;

    RAISE LOG '[trigger_finalize_import_async] job=% request_id=%', p_job_id, v_request_id;
END;

$$;


ALTER FUNCTION "public"."trigger_finalize_import_async"("p_job_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_recalc_budget"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  PERFORM recalc_budget_hierarchy(NEW.budget_id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_recalc_budget"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."try_finalize_import_job_after_ai"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_job_id uuid;
  v_has_budget boolean;
  v_has_running_parse boolean;
  v_total_batches int;
  v_last_batch int;
  v_all_batches_done boolean;
begin
  v_job_id := new.job_id;

  select (j.result_budget_id is not null)
  into v_has_budget
  from public.import_jobs j
  where j.id = v_job_id;

  if v_has_budget then
    return new;
  end if;

  -- GUARD: verificar se todos os batches foram processados
  select 
    coalesce((metadata->'stageB'->>'total_batches')::int, 0),
    coalesce((metadata->'stageB'->>'last_persisted_batch_index')::int, -1)
  into v_total_batches, v_last_batch
  from public.import_files
  where job_id = v_job_id
    and doc_role = 'synthetic'
  limit 1;

  v_all_batches_done := v_total_batches > 0 and v_last_batch >= v_total_batches - 1;

  if not v_all_batches_done then
    return new;
  end if;

  select exists(
    select 1
    from public.import_parse_tasks t
    where t.job_id = v_job_id
      and t.status in ('queued','dispatched','running')
  )
  into v_has_running_parse;

  if not v_has_running_parse then
    begin
      perform public.finalize_import_job(v_job_id);
    exception when others then
      update public.import_jobs
      set status = 'failed',
          last_error = left('try_finalize_import_job_after_ai: ' || sqlerrm, 500),
          updated_at = now()
      where id = v_job_id;
    end;
  end if;

  return new;
end;

$$;


ALTER FUNCTION "public"."try_finalize_import_job_after_ai"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_budget_total"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_budget_id UUID;
    v_total_items NUMERIC(15, 2);
    v_bdi_percent NUMERIC(15, 2);
BEGIN
    IF (TG_OP = 'DELETE') THEN
        v_budget_id := OLD.budget_id;
    ELSE
        v_budget_id := NEW.budget_id;
    END IF;

    -- Soma os itens
    SELECT COALESCE(SUM(total_price), 0) 
    INTO v_total_items 
    FROM budget_items 
    WHERE budget_id = v_budget_id;

    -- BUSCA O BDI (Troque 'budgets' pelo nome da sua tabela principal)
    SELECT COALESCE(bdi, 0) INTO v_bdi_percent 
    FROM budgets -- <--- AJUSTE O NOME AQUI (Ex: orcamento, projetos)
    WHERE id = v_budget_id;

    -- ATUALIZA O TOTAL (Troque 'budgets' aqui também)
    UPDATE budgets 
    SET 
        total_value = v_total_items * (1 + v_bdi_percent / 100),
        updated_at = now()
    WHERE id = v_budget_id;

    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_budget_total"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_hydration_issue_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
   NEW.updated_at = now(); 
   RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_hydration_issue_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_ocr_job_status"("p_id" "uuid", "p_status" "text", "p_last_error" "text", "p_retry_count" integer DEFAULT NULL::integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE public.import_ocr_jobs
    SET
        status          = p_status,
        last_error      = p_last_error,
        retry_count     = COALESCE(p_retry_count, retry_count),
        updated_at      = now(),
        started_at      = NULL,
        locked_by       = NULL,
        lock_expires_at = NULL,
        scheduled_for   = CASE WHEN p_status = 'pending' THEN now() ELSE scheduled_for END,
        completed_at    = CASE WHEN p_status IN ('failed','completed') THEN now() ELSE NULL END
    WHERE id = p_id;
END;
$$;


ALTER FUNCTION "public"."update_ocr_job_status"("p_id" "uuid", "p_status" "text", "p_last_error" "text", "p_retry_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."app_secrets" (
    "name" "text" NOT NULL,
    "value" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "private"."app_secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_functions" (
    "name" "text",
    "oid" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "definition" "text"
);


ALTER TABLE "public"."_backup_functions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "action" "text" NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "uuid" NOT NULL,
    "old_data" "jsonb",
    "new_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bdi" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "ac_rate" numeric(5,2) DEFAULT 0,
    "sg_rate" numeric(5,2) DEFAULT 0,
    "r_rate" numeric(5,2) DEFAULT 0,
    "df_rate" numeric(5,2) DEFAULT 0,
    "l_rate" numeric(5,2) DEFAULT 0,
    "taxes_rate" numeric(5,2) DEFAULT 0,
    "final_bdi" numeric(5,2) DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."bdi" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."budget_item_compositions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "budget_item_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "unit" "text",
    "quantity" numeric(15,4) DEFAULT 0,
    "unit_price" numeric(15,4) DEFAULT 0,
    "total_price" numeric(15,4) DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."budget_item_compositions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."budget_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "budget_id" "uuid",
    "parent_id" "uuid",
    "order_index" integer NOT NULL,
    "level" integer DEFAULT 0,
    "item_number" "text",
    "code" "text",
    "description" "text" NOT NULL,
    "unit" "text",
    "quantity" numeric(15,4) DEFAULT 0,
    "unit_price" numeric(15,4) DEFAULT 0,
    "total_price" numeric(15,2) DEFAULT 0,
    "type" "text",
    "source" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "bdi" numeric DEFAULT 0,
    "custom_bdi" numeric(5,2) DEFAULT NULL::numeric,
    "item_type" "text",
    "composition_id" "uuid",
    "insumo_id" "uuid",
    "calculation_memory" "text",
    "calculation_steps" "text"[],
    "cost_center" "text",
    "is_locked" boolean DEFAULT false,
    "notes" "text",
    "is_desonerated" boolean DEFAULT false,
    "final_price" numeric DEFAULT 0,
    "peso" numeric(10,2) DEFAULT 0,
    "source_import_item_id" "uuid",
    "hydration_status" "text" DEFAULT 'none'::"text",
    "hydration_details" "jsonb" DEFAULT '{}'::"jsonb",
    "path_key" "text",
    CONSTRAINT "budget_items_hydration_status_check" CHECK (("hydration_status" = ANY (ARRAY['none'::"text", 'internal_db'::"text", 'analytic_file'::"text", 'pending_review'::"text", 'manual'::"text", 'pending_hydration'::"text", 'needs_review'::"text"]))),
    CONSTRAINT "chk_level_valido" CHECK ((("level" >= 1) AND ("level" <= 10)))
);


ALTER TABLE "public"."budget_items" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."budget_items_with_weight" WITH ("security_invoker"='true') AS
 SELECT "id",
    "user_id",
    "budget_id",
    "parent_id",
    "order_index",
    "level",
    "item_number",
    "code",
    "description",
    "unit",
    "quantity",
    "unit_price",
    "total_price",
    "type",
    "source",
    "created_at",
    "updated_at",
    "bdi",
    "custom_bdi",
    "item_type",
    "composition_id",
    "insumo_id",
    "calculation_memory",
    "calculation_steps",
    "cost_center",
    "is_locked",
    "notes",
    "is_desonerated",
    "final_price",
    (("total_price" / NULLIF("sum"("total_price") OVER (PARTITION BY "budget_id"), (0)::numeric)) * (100)::numeric) AS "peso"
   FROM "public"."budget_items";


ALTER VIEW "public"."budget_items_with_weight" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."budget_schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "budget_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "period" integer NOT NULL,
    "percentage" numeric(5,2) DEFAULT 0,
    "value" numeric(15,2) DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."budget_schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."budgets" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "company_id" "uuid",
    "name" "text" NOT NULL,
    "client_name" "text",
    "date" "date" DEFAULT CURRENT_DATE,
    "status" "text" DEFAULT 'draft'::"text",
    "total_value" numeric(15,2) DEFAULT 0,
    "bdi_percentage" numeric(5,2) DEFAULT 0,
    "encargos_percentage" numeric(5,2) DEFAULT 0,
    "obra_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "proposal_cover" "text",
    "proposal_terms" "text",
    "schedule_interval" integer,
    "period_labels" "text"[],
    "cost_centers" "text"[],
    "is_template" boolean DEFAULT false,
    "desoneracao" numeric(5,2),
    "version" "text",
    "revision" integer,
    "revision_notes" "text",
    "is_frozen" boolean DEFAULT false,
    "frozen_at" timestamp with time zone,
    "frozen_by" "text",
    "parent_budget_id" "uuid",
    "is_scenario" boolean DEFAULT false,
    "scenario_name" "text",
    "bdi" numeric DEFAULT 0,
    "bdi_percent" numeric DEFAULT 0,
    "sinapi_uf" "text" DEFAULT 'BA'::"text",
    "sinapi_competence" "text" DEFAULT '2025-01'::"text",
    "sinapi_regime" "text" DEFAULT 'NAO_DESONERADO'::"text",
    "sinapi_contract_type" "text" DEFAULT 'HORISTA'::"text",
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "budgets_sinapi_contract_type_check" CHECK (("sinapi_contract_type" = ANY (ARRAY['HORISTA'::"text", 'MENSALISTA'::"text"]))),
    CONSTRAINT "budgets_sinapi_regime_check" CHECK (("sinapi_regime" = ANY (ARRAY['DESONERADO'::"text", 'NAO_DESONERADO'::"text"])))
);


ALTER TABLE "public"."budgets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "documento" "text",
    "tipo_documento" "text",
    "tipo_cliente" "text",
    "orgao" "text",
    "endereco" "text",
    "cidade" "text",
    "uf" "text",
    "responsavel" "text",
    "telefone" "text",
    "email" "text",
    "obra_predominante" "text",
    "is_ativo" boolean DEFAULT true,
    "observacoes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "cnpj" "text",
    "address" "text",
    "email" "text",
    "phone" "text",
    "logo_url" "text",
    "responsible_name" "text",
    "responsible_cpf" "text",
    "responsible_crea" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "proposal_cover" "text",
    "proposal_terms" "text"
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."composition_inputs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "parent_composition_id" "uuid",
    "insumo_id" "uuid",
    "sub_composition_id" "uuid",
    "coefficient" numeric(15,6) NOT NULL,
    "unit_price_at_addition" numeric(15,4),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."composition_inputs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compositions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "base_id" "uuid",
    "code" "text" NOT NULL,
    "description" "text" NOT NULL,
    "unit" "text",
    "total_cost" numeric(15,4) DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "fonte" "text",
    "data_referencia" "date",
    "is_oficial" boolean DEFAULT false,
    "is_customizada" boolean DEFAULT false,
    "observacoes" "text"
);


ALTER TABLE "public"."compositions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."cronograma_base" WITH ("security_invoker"='true') AS
 SELECT "id",
    "user_id",
    "budget_id",
    "parent_id",
    "order_index",
    "level",
    "item_number",
    "code",
    "description",
    "unit",
    "quantity",
    "unit_price",
    "total_price",
    "type",
    "source",
    "created_at",
    "updated_at",
    "bdi",
    "custom_bdi",
    "item_type",
    "composition_id",
    "insumo_id",
    "calculation_memory",
    "calculation_steps",
    "cost_center",
    "is_locked",
    "notes",
    "is_desonerated",
    "final_price"
   FROM "public"."budget_items"
  WHERE ("type" <> 'group'::"text");


ALTER VIEW "public"."cronograma_base" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_ai_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "import_file_id" "uuid" NOT NULL,
    "idx" integer NOT NULL,
    "description" "text" NOT NULL,
    "unit" "text",
    "quantity" numeric,
    "unit_price" numeric,
    "total" numeric,
    "category" "text",
    "raw_line" "text",
    "confidence" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "level" integer DEFAULT 3,
    "chunk_index" integer,
    "dedup_key" "text",
    "composition_code" "text",
    "item_path" "text",
    "source_candidate_id" "text",
    "price_source" "text",
    "warnings" "jsonb" DEFAULT '[]'::"jsonb",
    "bdi_percent" numeric
);


ALTER TABLE "public"."import_ai_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."import_ai_items"."composition_code" IS 'Código da composição canônica (ex.: SINAPI 93215) extraído explicitamente pela IA. SSOT para finalize_import_to_budget.';



COMMENT ON COLUMN "public"."import_ai_items"."price_source" IS 'Base de preços de origem do item (SINAPI, ORSE, CPU, EMOP, CDHU, etc.). Null quando não identificável ou em registros anteriores a 2026-02-23.';



CREATE TABLE IF NOT EXISTS "public"."import_parse_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "file_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 3 NOT NULL,
    "locked_at" timestamp with time zone,
    "locked_by" "text",
    "last_error" "text",
    "result" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "import_parse_tasks_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'dispatched'::"text", 'running'::"text", 'done'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."import_parse_tasks" OWNER TO "postgres";


COMMENT ON TABLE "public"."import_parse_tasks" IS 'Fila de tarefas de parsing pesado de PDFs. Processada pelo worker import-parse-worker.';



CREATE OR REPLACE VIEW "public"."debug_worker_status" AS
 SELECT ( SELECT "count"(*) AS "count"
           FROM "public"."import_parse_tasks"
          WHERE ("import_parse_tasks"."status" = 'queued'::"text")) AS "queued_tasks",
    ( SELECT "count"(*) AS "count"
           FROM "public"."import_parse_tasks"
          WHERE ("import_parse_tasks"."status" = 'dispatched'::"text")) AS "dispatched_tasks",
    ( SELECT "count"(*) AS "count"
           FROM "public"."import_parse_tasks"
          WHERE ("import_parse_tasks"."status" = 'running'::"text")) AS "running_tasks",
    ( SELECT "count"(*) AS "count"
           FROM "public"."import_parse_tasks"
          WHERE ("import_parse_tasks"."status" = 'done'::"text")) AS "done_tasks",
    ( SELECT "count"(*) AS "count"
           FROM "public"."import_parse_tasks"
          WHERE ("import_parse_tasks"."status" = 'failed'::"text")) AS "failed_tasks",
    ( SELECT "count"(*) AS "count"
           FROM "public"."import_ai_items") AS "ai_items_total",
    ( SELECT "count"(*) AS "count"
           FROM "public"."import_ai_items"
          WHERE ("import_ai_items"."created_at" > ("now"() - '00:10:00'::interval))) AS "ai_items_last_10min",
    ( SELECT "count"(*) AS "count"
           FROM "cron"."job_run_details"
          WHERE (("job_run_details"."status" = 'failed'::"text") AND ("job_run_details"."start_time" > ("now"() - '01:00:00'::interval)))) AS "cron_failures_last_hour";


ALTER VIEW "public"."debug_worker_status" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."encargos" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "type" "text",
    "percentage" numeric(5,2) NOT NULL,
    "base_json" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."encargos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."external_price_bases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "uf" "text",
    "competence" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."external_price_bases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."external_price_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "base_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "description" "text" NOT NULL,
    "unit" "text",
    "unit_price" numeric,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."external_price_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_ai_summaries" (
    "job_id" "uuid" NOT NULL,
    "import_file_id" "uuid" NOT NULL,
    "header" "jsonb",
    "totals" "jsonb",
    "notes" "text",
    "items_count" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."import_ai_summaries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_budget_finalizations" (
    "id" bigint NOT NULL,
    "job_id" "uuid" NOT NULL,
    "budget_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."import_budget_finalizations" OWNER TO "postgres";


ALTER TABLE "public"."import_budget_finalizations" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."import_budget_finalizations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."import_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "job_id" "uuid" NOT NULL,
    "file_kind" "public"."import_file_kind" DEFAULT 'other'::"public"."import_file_kind" NOT NULL,
    "doc_role" "public"."import_doc_role" DEFAULT 'unknown'::"public"."import_doc_role" NOT NULL,
    "original_filename" "text",
    "content_type" "text",
    "storage_bucket" "text" DEFAULT 'imports'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "storage_url" "text",
    "sha256" "text",
    "file_size_bytes" bigint,
    "page_count" integer,
    "extraction_method" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "extracted_text" "text",
    "extracted_json" "jsonb",
    "extracted_json_schema_version" integer DEFAULT 1,
    "extracted_completed_at" timestamp with time zone,
    "extracted_started_at" timestamp with time zone,
    "extraction_status" "text",
    "extraction_started_at" timestamp with time zone,
    "extraction_completed_at" timestamp with time zone,
    "extraction_reason" "text",
    "extraction_chunks_total" integer,
    "extraction_chunks_done" integer,
    "extraction_items_inserted" integer,
    "extraction_summary_saved" boolean,
    "extraction_duration_ms" integer,
    "extraction_last_error" "text",
    "role" "text" DEFAULT 'synthetic'::"text" NOT NULL,
    CONSTRAINT "import_files_role_check" CHECK (("role" = ANY (ARRAY['synthetic'::"text", 'analytic'::"text"])))
);


ALTER TABLE "public"."import_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_finalization_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "budget_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "params_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "total_items" integer DEFAULT 0,
    "hydrated_internal" integer DEFAULT 0,
    "hydrated_analytic" integer DEFAULT 0,
    "pending_items" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."import_finalization_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_hydration_issues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "budget_id" "uuid" NOT NULL,
    "budget_item_id" "uuid" NOT NULL,
    "issue_type" "text" NOT NULL,
    "severity" "text" DEFAULT 'warning'::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "original_code" "text",
    "original_description" "text",
    "suggestions" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "import_hydration_issues_issue_type_check" CHECK (("issue_type" = ANY (ARRAY['missing_composition'::"text", 'low_confidence'::"text", 'conflict'::"text", 'orphan_item'::"text"]))),
    CONSTRAINT "import_hydration_issues_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'warning'::"text", 'error'::"text"]))),
    CONSTRAINT "import_hydration_issues_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'resolved'::"text", 'ignored'::"text"])))
);


ALTER TABLE "public"."import_hydration_issues" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "job_id" "uuid" NOT NULL,
    "file_id" "uuid",
    "external_id" "text",
    "raw_ai_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "normalized_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "code_raw" "text",
    "code" "text",
    "description_normalized" "text",
    "unit" "text",
    "quantity" numeric,
    "detected_base" "text",
    "reference_base_id" "uuid",
    "is_proprio" boolean DEFAULT false NOT NULL,
    "is_desonerado" boolean,
    "price_desonerado" numeric,
    "price_nao_desonerado" numeric,
    "price_selected" numeric,
    "validation_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "confidence_score" numeric DEFAULT 0 NOT NULL,
    "issues" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "source_refs" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "import_file_id" "uuid",
    "idx" integer,
    "description" "text",
    "total_price" numeric DEFAULT 0 NOT NULL,
    "unit_price" numeric DEFAULT 0 NOT NULL,
    CONSTRAINT "import_items_confidence_score_check" CHECK ((("confidence_score" >= (0)::numeric) AND ("confidence_score" <= (1)::numeric)))
);


ALTER TABLE "public"."import_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_summaries" (
    "job_id" "uuid" NOT NULL,
    "import_file_id" "uuid" NOT NULL,
    "header" "jsonb",
    "totals" "jsonb",
    "notes" "text",
    "items_count" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."import_summaries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."insumos_base" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "base_id" "uuid",
    "code" "text" NOT NULL,
    "description" "text" NOT NULL,
    "unit" "text",
    "price" numeric(15,4) DEFAULT 0,
    "type" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "fonte" "text",
    "data_referencia" "text",
    "is_oficial" boolean DEFAULT false,
    "is_editavel" boolean DEFAULT true,
    "observacoes" "text"
);


ALTER TABLE "public"."insumos_base" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sinapi_compositions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source" "text" DEFAULT 'SINAPI'::"text" NOT NULL,
    "code" "text" NOT NULL,
    "description" "text" NOT NULL,
    "unit" "text",
    "composition_type" "text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "has_price" boolean
);


ALTER TABLE "public"."sinapi_compositions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."insumos" AS
 SELECT "auth"."uid"() AS "user_id",
    COALESCE(NULLIF("regexp_replace"(TRIM(BOTH FROM "ib"."code"), '^0+'::"text", ''::"text"), ''::"text"), TRIM(BOTH FROM "ib"."code")) AS "code",
    "ib"."description",
    "ib"."unit",
    NULL::"text" AS "category",
    'INPUT'::"text" AS "type",
    'SINAPI'::"text" AS "fonte"
   FROM "public"."insumos_base" "ib"
UNION ALL
 SELECT "auth"."uid"() AS "user_id",
    COALESCE(NULLIF("regexp_replace"(TRIM(BOTH FROM "sc"."code"), '^0+'::"text", ''::"text"), ''::"text"), TRIM(BOTH FROM "sc"."code")) AS "code",
    "sc"."description",
    "sc"."unit",
    NULL::"text" AS "category",
    'COMPOSITION'::"text" AS "type",
    'SINAPI'::"text" AS "fonte"
   FROM "public"."sinapi_compositions" "sc";


ALTER VIEW "public"."insumos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."price_base_aliases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "base_id" "uuid" NOT NULL,
    "alias_code" "text" NOT NULL,
    "canonical_code" "text" NOT NULL
);


ALTER TABLE "public"."price_base_aliases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."price_bases" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "region" "text",
    "reference_date" "date",
    "is_official" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."price_bases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proposals" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "budget_id" "uuid",
    "budget_name" "text",
    "client_id" "uuid",
    "client_name" "text",
    "valor_total" numeric(15,2),
    "status" "text" DEFAULT 'rascunho'::"text",
    "tipo_orcamento" "text" DEFAULT 'sintetico'::"text",
    "empresa_nome" "text",
    "empresa_cnpj" "text",
    "responsavel_nome" "text",
    "responsavel_crea" "text",
    "logo_base64" "text",
    "inclui_curva_abc" boolean DEFAULT false,
    "inclui_memorial_calculo" boolean DEFAULT false,
    "inclui_cronograma" boolean DEFAULT false,
    "termos_ressalvas" "text",
    "gerada_em" timestamp with time zone,
    "revisada_em" timestamp with time zone,
    "aprovada_em" timestamp with time zone,
    "emitida_em" timestamp with time zone,
    "observacoes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."proposals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reference_bases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "created_by" "text" DEFAULT 'auto_detected'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."reference_bases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sinapi_composition_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "price_table_id" "uuid" NOT NULL,
    "composition_code" "text" NOT NULL,
    "item_type" "text" NOT NULL,
    "item_code" "text" NOT NULL,
    "coefficient" numeric(15,8) NOT NULL,
    "unit" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sinapi_composition_items_item_type_check" CHECK (("item_type" = ANY (ARRAY['INSUMO'::"text", 'COMPOSICAO'::"text"])))
);


ALTER TABLE "public"."sinapi_composition_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sinapi_composition_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "price_table_id" "uuid" NOT NULL,
    "composition_code" "text" NOT NULL,
    "price" numeric(15,4) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sinapi_composition_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sinapi_price_tables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source" "text" DEFAULT 'SINAPI'::"text" NOT NULL,
    "uf" "text" NOT NULL,
    "competence" "text" NOT NULL,
    "regime" "text" NOT NULL,
    "file_urls" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_mock" boolean DEFAULT false,
    "source_tag" "text" DEFAULT 'SINAPI'::"text",
    "competencia" "text",
    CONSTRAINT "sinapi_price_tables_regime_check" CHECK (("regime" = ANY (ARRAY['DESONERADO'::"text", 'NAO_DESONERADO'::"text"])))
);


ALTER TABLE "public"."sinapi_price_tables" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."sinapi_compositions_with_prices" AS
 SELECT "sc"."id",
    "sc"."source",
    "sc"."code",
    "sc"."description",
    "sc"."unit",
    "sc"."composition_type",
    "scp"."price",
    "spt"."uf",
    "spt"."competence",
    "spt"."regime",
    ( SELECT "count"(*) AS "count"
           FROM "public"."sinapi_composition_items" "sci"
          WHERE (("sci"."composition_code" = "sc"."code") AND ("sci"."price_table_id" = "spt"."id"))) AS "items_count"
   FROM (("public"."sinapi_compositions" "sc"
     LEFT JOIN "public"."sinapi_composition_prices" "scp" ON (("sc"."code" = "scp"."composition_code")))
     LEFT JOIN "public"."sinapi_price_tables" "spt" ON (("scp"."price_table_id" = "spt"."id")))
  WHERE ("sc"."active" = true);


ALTER VIEW "public"."sinapi_compositions_with_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sinapi_import_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "uf" "text" NOT NULL,
    "year" integer NOT NULL,
    "months" integer[],
    "regimes" "text"[],
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "logs" "text",
    "counts" "jsonb",
    "error_message" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    CONSTRAINT "sinapi_import_runs_status_check" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'RUNNING'::"text", 'SUCCESS'::"text", 'PARTIAL'::"text", 'ERROR'::"text"])))
);


ALTER TABLE "public"."sinapi_import_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sinapi_input_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "price_table_id" "uuid" NOT NULL,
    "input_code" "text" NOT NULL,
    "price" numeric(15,4) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sinapi_input_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sinapi_inputs_base" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source" "text" DEFAULT 'SINAPI'::"text" NOT NULL,
    "code" "text" NOT NULL,
    "description" "text" NOT NULL,
    "unit" "text",
    "category" "text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sinapi_inputs_base" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."sinapi_inputs_with_prices" AS
 SELECT "si"."id",
    "si"."source",
    "si"."code",
    "si"."description",
    "si"."unit",
    "si"."category",
    "sip"."price",
    "spt"."uf",
    "spt"."competence",
    "spt"."regime"
   FROM (("public"."sinapi_inputs_base" "si"
     LEFT JOIN "public"."sinapi_input_prices" "sip" ON (("si"."code" = "sip"."input_code")))
     LEFT JOIN "public"."sinapi_price_tables" "spt" ON (("sip"."price_table_id" = "spt"."id")))
  WHERE ("si"."active" = true);


ALTER VIEW "public"."sinapi_inputs_with_prices" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."sinapi_items_search" AS
 SELECT 'INPUT'::"text" AS "item_type",
    "i"."code",
    "i"."description",
    "i"."unit"
   FROM "public"."sinapi_inputs_base" "i"
  WHERE ("i"."active" = true)
UNION ALL
 SELECT 'COMPOSITION'::"text" AS "item_type",
    "c"."code",
    "c"."description",
    "c"."unit"
   FROM "public"."sinapi_compositions" "c"
  WHERE ("c"."active" = true);


ALTER VIEW "public"."sinapi_items_search" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_learning_memory" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "from_text" "text" NOT NULL,
    "from_base" "text",
    "to_code" "text" NOT NULL,
    "to_base" "text" NOT NULL,
    "confidence_score" numeric DEFAULT 1 NOT NULL,
    "usage_count" integer DEFAULT 0 NOT NULL,
    "last_used_at" timestamp with time zone,
    CONSTRAINT "user_learning_memory_confidence_score_check" CHECK ((("confidence_score" >= (0)::numeric) AND ("confidence_score" <= (1)::numeric)))
);


ALTER TABLE "public"."user_learning_memory" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_jobs_ready_for_extraction_retry" AS
 SELECT "id",
    "extraction_attempts",
    "extraction_next_retry_at",
    "extraction_last_reason"
   FROM "public"."import_jobs"
  WHERE (("extraction_retryable" = true) AND ("extraction_next_retry_at" <= "now"()) AND ("status" <> 'failed'::"public"."import_job_status"));


ALTER VIEW "public"."view_jobs_ready_for_extraction_retry" OWNER TO "postgres";


ALTER TABLE ONLY "private"."app_secrets"
    ADD CONSTRAINT "app_secrets_pkey" PRIMARY KEY ("name");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bdi"
    ADD CONSTRAINT "bdi_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."budget_item_compositions"
    ADD CONSTRAINT "budget_item_compositions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."budget_items"
    ADD CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."budget_schedules"
    ADD CONSTRAINT "budget_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."budgets"
    ADD CONSTRAINT "budgets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."composition_inputs"
    ADD CONSTRAINT "composition_inputs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compositions"
    ADD CONSTRAINT "compositions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."encargos"
    ADD CONSTRAINT "encargos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."external_price_bases"
    ADD CONSTRAINT "external_price_bases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."external_price_items"
    ADD CONSTRAINT "external_price_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_ai_items"
    ADD CONSTRAINT "import_ai_items_job_file_dedup_uniq" UNIQUE ("job_id", "import_file_id", "dedup_key");



ALTER TABLE ONLY "public"."import_ai_items"
    ADD CONSTRAINT "import_ai_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_ai_summaries"
    ADD CONSTRAINT "import_ai_summaries_pkey" PRIMARY KEY ("job_id");



ALTER TABLE ONLY "public"."import_budget_finalizations"
    ADD CONSTRAINT "import_budget_finalizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_files"
    ADD CONSTRAINT "import_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_finalization_runs"
    ADD CONSTRAINT "import_finalization_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_hydration_issues"
    ADD CONSTRAINT "import_hydration_issues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_items"
    ADD CONSTRAINT "import_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_ocr_jobs"
    ADD CONSTRAINT "import_ocr_jobs_job_id_import_file_id_key" UNIQUE ("job_id", "import_file_id");



ALTER TABLE ONLY "public"."import_ocr_jobs"
    ADD CONSTRAINT "import_ocr_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_parse_tasks"
    ADD CONSTRAINT "import_parse_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_summaries"
    ADD CONSTRAINT "import_summaries_pkey" PRIMARY KEY ("job_id");



ALTER TABLE ONLY "public"."insumos_base"
    ADD CONSTRAINT "insumos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."price_base_aliases"
    ADD CONSTRAINT "price_base_aliases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."price_bases"
    ADD CONSTRAINT "price_bases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reference_bases"
    ADD CONSTRAINT "reference_bases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sinapi_composition_items"
    ADD CONSTRAINT "sinapi_composition_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sinapi_composition_prices"
    ADD CONSTRAINT "sinapi_composition_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sinapi_compositions"
    ADD CONSTRAINT "sinapi_compositions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sinapi_import_runs"
    ADD CONSTRAINT "sinapi_import_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sinapi_input_prices"
    ADD CONSTRAINT "sinapi_input_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sinapi_inputs_base"
    ADD CONSTRAINT "sinapi_inputs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sinapi_price_tables"
    ADD CONSTRAINT "sinapi_price_tables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sinapi_composition_items"
    ADD CONSTRAINT "unique_composition_item" UNIQUE ("price_table_id", "composition_code", "item_type", "item_code");



ALTER TABLE ONLY "public"."sinapi_composition_prices"
    ADD CONSTRAINT "unique_composition_price" UNIQUE ("price_table_id", "composition_code");



ALTER TABLE ONLY "public"."sinapi_input_prices"
    ADD CONSTRAINT "unique_input_price" UNIQUE ("price_table_id", "input_code");



ALTER TABLE ONLY "public"."import_parse_tasks"
    ADD CONSTRAINT "unique_parse_task_per_job_file" UNIQUE ("job_id", "file_id");



ALTER TABLE ONLY "public"."sinapi_price_tables"
    ADD CONSTRAINT "unique_price_table" UNIQUE ("source", "uf", "competence", "regime");



ALTER TABLE ONLY "public"."budget_schedules"
    ADD CONSTRAINT "unique_schedule_item_period" UNIQUE ("item_id", "period");



ALTER TABLE ONLY "public"."sinapi_compositions"
    ADD CONSTRAINT "unique_sinapi_composition" UNIQUE ("source", "code");



ALTER TABLE ONLY "public"."sinapi_inputs_base"
    ADD CONSTRAINT "unique_sinapi_input" UNIQUE ("source", "code");



ALTER TABLE ONLY "public"."user_learning_memory"
    ADD CONSTRAINT "user_learning_memory_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "idx_ai_items_unique_chunk" ON "public"."import_ai_items" USING "btree" ("job_id", "import_file_id", "chunk_index", "idx") WHERE (("import_file_id" IS NOT NULL) AND ("chunk_index" IS NOT NULL));



CREATE INDEX "idx_budget_item_compositions_budget_item_id" ON "public"."budget_item_compositions" USING "btree" ("budget_item_id");



CREATE INDEX "idx_budget_item_compositions_metadata_overrides" ON "public"."budget_item_compositions" USING "gin" ("metadata") WHERE (("metadata" ? 'adjustment_factor'::"text") OR ("metadata" ? 'adjustment_amount'::"text"));



CREATE INDEX "idx_budget_item_compositions_user_id" ON "public"."budget_item_compositions" USING "btree" ("user_id");



CREATE INDEX "idx_budget_items_budget_id" ON "public"."budget_items" USING "btree" ("budget_id");



CREATE INDEX "idx_budget_items_item_number" ON "public"."budget_items" USING "btree" ("item_number");



CREATE INDEX "idx_budget_schedules_budget_id" ON "public"."budget_schedules" USING "btree" ("budget_id");



CREATE INDEX "idx_budget_schedules_item_id" ON "public"."budget_schedules" USING "btree" ("item_id");



CREATE INDEX "idx_budget_schedules_user_id" ON "public"."budget_schedules" USING "btree" ("user_id");



CREATE INDEX "idx_budgets_sinapi_competence" ON "public"."budgets" USING "btree" ("sinapi_competence");



CREATE INDEX "idx_budgets_sinapi_regime" ON "public"."budgets" USING "btree" ("sinapi_regime");



CREATE INDEX "idx_external_price_items_base_code" ON "public"."external_price_items" USING "btree" ("base_id", "code");



CREATE INDEX "idx_hydration_issues_budget" ON "public"."import_hydration_issues" USING "btree" ("budget_id");



CREATE INDEX "idx_hydration_issues_job" ON "public"."import_hydration_issues" USING "btree" ("job_id");



CREATE INDEX "idx_hydration_issues_status" ON "public"."import_hydration_issues" USING "btree" ("status");



CREATE INDEX "idx_import_ai_items_dedup" ON "public"."import_ai_items" USING "btree" ("job_id", "dedup_key");



CREATE INDEX "idx_import_ai_items_job_path_code" ON "public"."import_ai_items" USING "btree" ("job_id", "item_path", "composition_code", "idx");



CREATE INDEX "idx_import_ai_items_price_source" ON "public"."import_ai_items" USING "btree" ("job_id", "price_source") WHERE ("price_source" IS NOT NULL);



CREATE INDEX "idx_import_budget_finalizations_job_user" ON "public"."import_budget_finalizations" USING "btree" ("job_id", "user_id");



CREATE INDEX "idx_import_files_extraction_status" ON "public"."import_files" USING "btree" ("extraction_status");



CREATE INDEX "idx_import_finalization_runs_job" ON "public"."import_finalization_runs" USING "btree" ("job_id");



CREATE INDEX "idx_import_hydration_issues_budget_item_id" ON "public"."import_hydration_issues" USING "btree" ("budget_item_id");



CREATE INDEX "idx_import_jobs_extraction_retry" ON "public"."import_jobs" USING "btree" ("extraction_retryable", "extraction_next_retry_at") WHERE ("extraction_retryable" = true);



CREATE INDEX "idx_import_jobs_result_budget" ON "public"."import_jobs" USING "btree" ("result_budget_id");



CREATE INDEX "idx_import_jobs_retryable_next" ON "public"."import_jobs" USING "btree" ("extraction_retryable", "extraction_next_retry_at");



CREATE INDEX "idx_import_jobs_status_stage" ON "public"."import_jobs" USING "btree" ("status", "stage");



CREATE INDEX "idx_import_ocr_jobs_pending_null_sched" ON "public"."import_ocr_jobs" USING "btree" ("id") WHERE (("status" = 'pending'::"text") AND ("scheduled_for" IS NULL));



CREATE INDEX "idx_import_ocr_jobs_pending_sched" ON "public"."import_ocr_jobs" USING "btree" ("scheduled_for") WHERE (("status" = 'pending'::"text") AND ("scheduled_for" IS NOT NULL));



CREATE INDEX "idx_import_parse_tasks_file" ON "public"."import_parse_tasks" USING "btree" ("file_id");



CREATE INDEX "idx_import_parse_tasks_file_id" ON "public"."import_parse_tasks" USING "btree" ("file_id");



CREATE INDEX "idx_import_parse_tasks_job" ON "public"."import_parse_tasks" USING "btree" ("job_id");



CREATE INDEX "idx_import_parse_tasks_status_created" ON "public"."import_parse_tasks" USING "btree" ("status", "created_at");



CREATE UNIQUE INDEX "idx_insumos_upsert_conflict" ON "public"."insumos_base" USING "btree" ("user_id", "code", "fonte");



CREATE INDEX "idx_ocr_jobs_claimable" ON "public"."import_ocr_jobs" USING "btree" ("status", "scheduled_for", "priority" DESC, "created_at");



CREATE INDEX "idx_sinapi_composition_items_comp" ON "public"."sinapi_composition_items" USING "btree" ("composition_code");



CREATE INDEX "idx_sinapi_composition_items_item" ON "public"."sinapi_composition_items" USING "btree" ("item_code");



CREATE INDEX "idx_sinapi_composition_items_table" ON "public"."sinapi_composition_items" USING "btree" ("price_table_id");



CREATE INDEX "idx_sinapi_composition_prices_code" ON "public"."sinapi_composition_prices" USING "btree" ("composition_code");



CREATE INDEX "idx_sinapi_composition_prices_table" ON "public"."sinapi_composition_prices" USING "btree" ("price_table_id");



CREATE INDEX "idx_sinapi_compositions_code" ON "public"."sinapi_compositions" USING "btree" ("code");



CREATE INDEX "idx_sinapi_compositions_description" ON "public"."sinapi_compositions" USING "gin" ("to_tsvector"('"portuguese"'::"regconfig", "description"));



CREATE INDEX "idx_sinapi_compositions_has_price" ON "public"."sinapi_compositions" USING "btree" ("has_price");



CREATE INDEX "idx_sinapi_import_runs_status" ON "public"."sinapi_import_runs" USING "btree" ("status");



CREATE INDEX "idx_sinapi_import_runs_uf" ON "public"."sinapi_import_runs" USING "btree" ("uf");



CREATE INDEX "idx_sinapi_input_prices_code" ON "public"."sinapi_input_prices" USING "btree" ("input_code");



CREATE INDEX "idx_sinapi_input_prices_table" ON "public"."sinapi_input_prices" USING "btree" ("price_table_id");



CREATE INDEX "idx_sinapi_inputs_code" ON "public"."sinapi_inputs_base" USING "btree" ("code");



CREATE INDEX "idx_sinapi_inputs_description" ON "public"."sinapi_inputs_base" USING "gin" ("to_tsvector"('"portuguese"'::"regconfig", "description"));



CREATE INDEX "idx_sinapi_price_tables_competence" ON "public"."sinapi_price_tables" USING "btree" ("competence");



CREATE INDEX "idx_sinapi_price_tables_mock" ON "public"."sinapi_price_tables" USING "btree" ("is_mock");



CREATE INDEX "idx_sinapi_price_tables_regime" ON "public"."sinapi_price_tables" USING "btree" ("regime");



CREATE INDEX "idx_sinapi_price_tables_source_tag" ON "public"."sinapi_price_tables" USING "btree" ("source_tag");



CREATE INDEX "idx_sinapi_price_tables_uf" ON "public"."sinapi_price_tables" USING "btree" ("uf");



CREATE INDEX "import_ai_items_import_file_id_idx" ON "public"."import_ai_items" USING "btree" ("import_file_id");



CREATE INDEX "import_ai_items_job_id_idx" ON "public"."import_ai_items" USING "btree" ("job_id");



CREATE INDEX "import_budget_finalizations_budget_id_idx" ON "public"."import_budget_finalizations" USING "btree" ("budget_id");



CREATE UNIQUE INDEX "import_budget_finalizations_job_budget_uniq" ON "public"."import_budget_finalizations" USING "btree" ("job_id", "budget_id");



CREATE INDEX "import_budget_finalizations_job_id_idx" ON "public"."import_budget_finalizations" USING "btree" ("job_id");



CREATE INDEX "import_budget_finalizations_user_id_idx" ON "public"."import_budget_finalizations" USING "btree" ("user_id");



CREATE INDEX "import_files_job_id_created_at_idx" ON "public"."import_files" USING "btree" ("job_id", "created_at" DESC);



CREATE INDEX "import_files_job_id_idx" ON "public"."import_files" USING "btree" ("job_id");



CREATE INDEX "import_files_sha256_idx" ON "public"."import_files" USING "btree" ("sha256");



CREATE INDEX "import_files_user_id_idx" ON "public"."import_files" USING "btree" ("user_id");



CREATE INDEX "import_items_code_idx" ON "public"."import_items" USING "btree" ("code");



CREATE INDEX "import_items_detected_base_idx" ON "public"."import_items" USING "btree" ("detected_base");



CREATE INDEX "import_items_import_file_id_idx" ON "public"."import_items" USING "btree" ("import_file_id");



CREATE INDEX "import_items_job_id_idx" ON "public"."import_items" USING "btree" ("job_id");



CREATE INDEX "import_items_reference_base_id_idx" ON "public"."import_items" USING "btree" ("reference_base_id");



CREATE INDEX "import_items_user_id_idx" ON "public"."import_items" USING "btree" ("user_id");



CREATE INDEX "import_items_validation_status_idx" ON "public"."import_items" USING "btree" ("validation_status");



CREATE INDEX "import_jobs_doc_role_idx" ON "public"."import_jobs" USING "btree" ("doc_role");



CREATE INDEX "import_jobs_status_idx" ON "public"."import_jobs" USING "btree" ("status");



CREATE INDEX "import_jobs_updated_at_idx" ON "public"."import_jobs" USING "btree" ("updated_at");



CREATE INDEX "import_jobs_user_id_idx" ON "public"."import_jobs" USING "btree" ("user_id");



CREATE INDEX "reference_bases_user_id_idx" ON "public"."reference_bases" USING "btree" ("user_id");



CREATE UNIQUE INDEX "reference_bases_user_slug_ux" ON "public"."reference_bases" USING "btree" ("user_id", "slug");



CREATE UNIQUE INDEX "sinapi_input_prices_uq" ON "public"."sinapi_input_prices" USING "btree" ("price_table_id", "input_code");



CREATE INDEX "sinapi_price_tables_competencia_idx" ON "public"."sinapi_price_tables" USING "btree" ("competencia");



CREATE UNIQUE INDEX "uq_job_file_dedup_key" ON "public"."import_ai_items" USING "btree" ("job_id", "import_file_id", "dedup_key") WHERE ("dedup_key" IS NOT NULL);



CREATE INDEX "user_learning_memory_from_text_idx" ON "public"."user_learning_memory" USING "btree" ("from_text");



CREATE INDEX "user_learning_memory_user_id_idx" ON "public"."user_learning_memory" USING "btree" ("user_id");



CREATE UNIQUE INDEX "user_learning_memory_ux" ON "public"."user_learning_memory" USING "btree" ("user_id", "from_text", COALESCE("from_base", ''::"text"), "to_code", "to_base");



CREATE OR REPLACE TRIGGER "budget_items_recalc_insert" AFTER INSERT ON "public"."budget_items" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recalc_after_insert"();

ALTER TABLE "public"."budget_items" DISABLE TRIGGER "budget_items_recalc_insert";



CREATE OR REPLACE TRIGGER "budget_items_recalc_update" AFTER UPDATE OF "quantity", "unit_price", "final_price" ON "public"."budget_items" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recalc_after_update"();

ALTER TABLE "public"."budget_items" DISABLE TRIGGER "budget_items_recalc_update";



CREATE OR REPLACE TRIGGER "tr_bdi_upd" BEFORE UPDATE ON "public"."bdi" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "tr_budgets_upd" BEFORE UPDATE ON "public"."budgets" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "tr_companies_upd" BEFORE UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "tr_compositions_upd" BEFORE UPDATE ON "public"."compositions" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "tr_encargos_upd" BEFORE UPDATE ON "public"."encargos" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "tr_hydration_issue_updated" BEFORE UPDATE ON "public"."import_hydration_issues" FOR EACH ROW EXECUTE FUNCTION "public"."update_hydration_issue_timestamp"();



CREATE OR REPLACE TRIGGER "tr_insumos_upd" BEFORE UPDATE ON "public"."insumos_base" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "tr_price_bases_upd" BEFORE UPDATE ON "public"."price_bases" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "trg_block_worker_placeholder_ai_items" BEFORE INSERT ON "public"."import_ai_items" FOR EACH ROW EXECUTE FUNCTION "public"."block_worker_placeholder_ai_items"();



CREATE OR REPLACE TRIGGER "trg_check_rate_limit" BEFORE INSERT ON "public"."import_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."check_import_rate_limit"();



CREATE OR REPLACE TRIGGER "trg_fix_prices" BEFORE INSERT ON "public"."budget_items" FOR EACH ROW EXECUTE FUNCTION "public"."fix_prices_on_insert"();

ALTER TABLE "public"."budget_items" DISABLE TRIGGER "trg_fix_prices";



CREATE OR REPLACE TRIGGER "trg_guard_import_job_waiting_user_requires_items" BEFORE UPDATE OF "status" ON "public"."import_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."guard_import_job_waiting_user_requires_items"();



CREATE OR REPLACE TRIGGER "trg_import_items_set_updated_at" BEFORE UPDATE ON "public"."import_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_import_jobs_set_updated_at" BEFORE UPDATE ON "public"."import_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_try_finalize_import_job_after_ai" AFTER INSERT ON "public"."import_ai_items" FOR EACH ROW EXECUTE FUNCTION "public"."try_finalize_import_job_after_ai"();



CREATE OR REPLACE TRIGGER "trg_user_learning_memory_set_updated_at" BEFORE UPDATE ON "public"."user_learning_memory" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "update_clients_modtime" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_proposals_modtime" BEFORE UPDATE ON "public"."proposals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_sinapi_compositions_updated_at" BEFORE UPDATE ON "public"."sinapi_compositions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_sinapi_inputs_updated_at" BEFORE UPDATE ON "public"."sinapi_inputs_base" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bdi"
    ADD CONSTRAINT "bdi_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."budget_item_compositions"
    ADD CONSTRAINT "budget_item_compositions_budget_item_id_fkey" FOREIGN KEY ("budget_item_id") REFERENCES "public"."budget_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budget_item_compositions"
    ADD CONSTRAINT "budget_item_compositions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budget_items"
    ADD CONSTRAINT "budget_items_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budget_items"
    ADD CONSTRAINT "budget_items_composition_id_fkey" FOREIGN KEY ("composition_id") REFERENCES "public"."compositions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."budget_items"
    ADD CONSTRAINT "budget_items_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "public"."insumos_base"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."budget_items"
    ADD CONSTRAINT "budget_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."budget_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budget_items"
    ADD CONSTRAINT "budget_items_source_import_item_id_fkey" FOREIGN KEY ("source_import_item_id") REFERENCES "public"."import_ai_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."budget_items"
    ADD CONSTRAINT "budget_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."budget_schedules"
    ADD CONSTRAINT "budget_schedules_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budget_schedules"
    ADD CONSTRAINT "budget_schedules_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."budget_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budget_schedules"
    ADD CONSTRAINT "budget_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budgets"
    ADD CONSTRAINT "budgets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."budgets"
    ADD CONSTRAINT "budgets_parent_budget_id_fkey" FOREIGN KEY ("parent_budget_id") REFERENCES "public"."budgets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."budgets"
    ADD CONSTRAINT "budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."composition_inputs"
    ADD CONSTRAINT "composition_inputs_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "public"."insumos_base"("id");



ALTER TABLE ONLY "public"."composition_inputs"
    ADD CONSTRAINT "composition_inputs_parent_composition_id_fkey" FOREIGN KEY ("parent_composition_id") REFERENCES "public"."compositions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."composition_inputs"
    ADD CONSTRAINT "composition_inputs_sub_composition_id_fkey" FOREIGN KEY ("sub_composition_id") REFERENCES "public"."compositions"("id");



ALTER TABLE ONLY "public"."composition_inputs"
    ADD CONSTRAINT "composition_inputs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."compositions"
    ADD CONSTRAINT "compositions_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "public"."price_bases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compositions"
    ADD CONSTRAINT "compositions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."encargos"
    ADD CONSTRAINT "encargos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."external_price_bases"
    ADD CONSTRAINT "external_price_bases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."external_price_items"
    ADD CONSTRAINT "external_price_items_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "public"."external_price_bases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_ai_items"
    ADD CONSTRAINT "import_ai_items_import_file_id_fkey" FOREIGN KEY ("import_file_id") REFERENCES "public"."import_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_ai_items"
    ADD CONSTRAINT "import_ai_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_ai_summaries"
    ADD CONSTRAINT "import_ai_summaries_import_file_id_fkey" FOREIGN KEY ("import_file_id") REFERENCES "public"."import_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_ai_summaries"
    ADD CONSTRAINT "import_ai_summaries_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_files"
    ADD CONSTRAINT "import_files_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_files"
    ADD CONSTRAINT "import_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_finalization_runs"
    ADD CONSTRAINT "import_finalization_runs_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_finalization_runs"
    ADD CONSTRAINT "import_finalization_runs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_finalization_runs"
    ADD CONSTRAINT "import_finalization_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."import_hydration_issues"
    ADD CONSTRAINT "import_hydration_issues_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_hydration_issues"
    ADD CONSTRAINT "import_hydration_issues_budget_item_id_fkey" FOREIGN KEY ("budget_item_id") REFERENCES "public"."budget_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_hydration_issues"
    ADD CONSTRAINT "import_hydration_issues_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_items"
    ADD CONSTRAINT "import_items_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."import_files"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_items"
    ADD CONSTRAINT "import_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_items"
    ADD CONSTRAINT "import_items_reference_base_id_fkey" FOREIGN KEY ("reference_base_id") REFERENCES "public"."reference_bases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_items"
    ADD CONSTRAINT "import_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_result_budget_id_fkey" FOREIGN KEY ("result_budget_id") REFERENCES "public"."budgets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_ocr_jobs"
    ADD CONSTRAINT "import_ocr_jobs_import_file_id_fkey" FOREIGN KEY ("import_file_id") REFERENCES "public"."import_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_ocr_jobs"
    ADD CONSTRAINT "import_ocr_jobs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_parse_tasks"
    ADD CONSTRAINT "import_parse_tasks_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."import_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_parse_tasks"
    ADD CONSTRAINT "import_parse_tasks_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_summaries"
    ADD CONSTRAINT "import_summaries_import_file_id_fkey" FOREIGN KEY ("import_file_id") REFERENCES "public"."import_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_summaries"
    ADD CONSTRAINT "import_summaries_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."insumos_base"
    ADD CONSTRAINT "insumos_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "public"."price_bases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."insumos_base"
    ADD CONSTRAINT "insumos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."price_base_aliases"
    ADD CONSTRAINT "price_base_aliases_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "public"."external_price_bases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."price_bases"
    ADD CONSTRAINT "price_bases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."reference_bases"
    ADD CONSTRAINT "reference_bases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sinapi_composition_items"
    ADD CONSTRAINT "sinapi_composition_items_price_table_id_fkey" FOREIGN KEY ("price_table_id") REFERENCES "public"."sinapi_price_tables"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sinapi_composition_prices"
    ADD CONSTRAINT "sinapi_composition_prices_price_table_id_fkey" FOREIGN KEY ("price_table_id") REFERENCES "public"."sinapi_price_tables"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sinapi_import_runs"
    ADD CONSTRAINT "sinapi_import_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sinapi_input_prices"
    ADD CONSTRAINT "sinapi_input_prices_price_table_id_fkey" FOREIGN KEY ("price_table_id") REFERENCES "public"."sinapi_price_tables"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_learning_memory"
    ADD CONSTRAINT "user_learning_memory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Allow all for authenticated users" ON "public"."budget_items" TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can insert import_runs" ON "public"."sinapi_import_runs" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users can update own import_runs" ON "public"."sinapi_import_runs" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Authenticated users can view sinapi_composition_items" ON "public"."sinapi_composition_items" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view sinapi_composition_prices" ON "public"."sinapi_composition_prices" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view sinapi_compositions" ON "public"."sinapi_compositions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view sinapi_import_runs" ON "public"."sinapi_import_runs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view sinapi_input_prices" ON "public"."sinapi_input_prices" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view sinapi_inputs" ON "public"."sinapi_inputs_base" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view sinapi_price_tables" ON "public"."sinapi_price_tables" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Service role can manage sinapi_composition_items" ON "public"."sinapi_composition_items" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage sinapi_composition_prices" ON "public"."sinapi_composition_prices" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage sinapi_compositions" ON "public"."sinapi_compositions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage sinapi_import_runs" ON "public"."sinapi_import_runs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage sinapi_input_prices" ON "public"."sinapi_input_prices" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage sinapi_inputs" ON "public"."sinapi_inputs_base" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage sinapi_price_tables" ON "public"."sinapi_price_tables" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access on parse tasks" ON "public"."import_parse_tasks" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Users can delete own clients" ON "public"."clients" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own compositions" ON "public"."budget_item_compositions" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own proposals" ON "public"."proposals" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own schedules" ON "public"."budget_schedules" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own ai items" ON "public"."import_ai_items" FOR DELETE USING (("auth"."uid"() IN ( SELECT "import_jobs"."user_id"
   FROM "public"."import_jobs"
  WHERE ("import_jobs"."id" = "import_ai_items"."job_id"))));



CREATE POLICY "Users can delete their own import items" ON "public"."import_items" FOR DELETE USING (("auth"."uid"() IN ( SELECT "import_jobs"."user_id"
   FROM "public"."import_jobs"
  WHERE ("import_jobs"."id" = "import_items"."job_id"))));



CREATE POLICY "Users can insert own clients" ON "public"."clients" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own compositions" ON "public"."budget_item_compositions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own proposals" ON "public"."proposals" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own schedules" ON "public"."budget_schedules" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own ai items" ON "public"."import_ai_items" FOR INSERT WITH CHECK (("auth"."uid"() IN ( SELECT "import_jobs"."user_id"
   FROM "public"."import_jobs"
  WHERE ("import_jobs"."id" = "import_ai_items"."job_id"))));



CREATE POLICY "Users can insert their own ai summaries" ON "public"."import_ai_summaries" FOR INSERT WITH CHECK (("auth"."uid"() IN ( SELECT "import_jobs"."user_id"
   FROM "public"."import_jobs"
  WHERE ("import_jobs"."id" = "import_ai_summaries"."job_id"))));



CREATE POLICY "Users can insert their own import items" ON "public"."import_items" FOR INSERT WITH CHECK (("auth"."uid"() IN ( SELECT "import_jobs"."user_id"
   FROM "public"."import_jobs"
  WHERE ("import_jobs"."id" = "import_items"."job_id"))));



CREATE POLICY "Users can insert their own import summaries" ON "public"."import_summaries" FOR INSERT WITH CHECK (("auth"."uid"() IN ( SELECT "import_jobs"."user_id"
   FROM "public"."import_jobs"
  WHERE ("import_jobs"."id" = "import_summaries"."job_id"))));



CREATE POLICY "Users can manage their own BDI presets" ON "public"."bdi" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own budget items" ON "public"."budget_items" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own budgets" ON "public"."budgets" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own company" ON "public"."companies" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own composition items" ON "public"."composition_inputs" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own compositions" ON "public"."compositions" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own insumos" ON "public"."insumos_base" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own price bases" ON "public"."price_bases" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own social charges" ON "public"."encargos" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own clients" ON "public"."clients" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own company_fix" ON "public"."companies" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own compositions" ON "public"."budget_item_compositions" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own proposals" ON "public"."proposals" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own schedules" ON "public"."budget_schedules" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own ai summaries" ON "public"."import_ai_summaries" FOR UPDATE USING (("auth"."uid"() IN ( SELECT "import_jobs"."user_id"
   FROM "public"."import_jobs"
  WHERE ("import_jobs"."id" = "import_ai_summaries"."job_id"))));



CREATE POLICY "Users can update their own import summaries" ON "public"."import_summaries" FOR UPDATE USING (("auth"."uid"() IN ( SELECT "import_jobs"."user_id"
   FROM "public"."import_jobs"
  WHERE ("import_jobs"."id" = "import_summaries"."job_id"))));



CREATE POLICY "Users can view own clients" ON "public"."clients" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own compositions" ON "public"."budget_item_compositions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own parse tasks" ON "public"."import_parse_tasks" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."import_jobs"
  WHERE (("import_jobs"."id" = "import_parse_tasks"."job_id") AND ("import_jobs"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view own proposals" ON "public"."proposals" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own schedules" ON "public"."budget_schedules" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own ai items" ON "public"."import_ai_items" FOR SELECT USING (("auth"."uid"() IN ( SELECT "import_jobs"."user_id"
   FROM "public"."import_jobs"
  WHERE ("import_jobs"."id" = "import_ai_items"."job_id"))));



CREATE POLICY "Users can view their own ai summaries" ON "public"."import_ai_summaries" FOR SELECT USING (("auth"."uid"() IN ( SELECT "import_jobs"."user_id"
   FROM "public"."import_jobs"
  WHERE ("import_jobs"."id" = "import_ai_summaries"."job_id"))));



CREATE POLICY "Users can view their own audit logs" ON "public"."audit_logs" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own import items" ON "public"."import_items" FOR SELECT USING (("auth"."uid"() IN ( SELECT "import_jobs"."user_id"
   FROM "public"."import_jobs"
  WHERE ("import_jobs"."id" = "import_items"."job_id"))));



CREATE POLICY "Users can view their own import summaries" ON "public"."import_summaries" FOR SELECT USING (("auth"."uid"() IN ( SELECT "import_jobs"."user_id"
   FROM "public"."import_jobs"
  WHERE ("import_jobs"."id" = "import_summaries"."job_id"))));



CREATE POLICY "Users can view their own ocr jobs" ON "public"."import_ocr_jobs" FOR SELECT USING (("auth"."uid"() IN ( SELECT "import_jobs"."user_id"
   FROM "public"."import_jobs"
  WHERE ("import_jobs"."id" = "import_ocr_jobs"."job_id"))));



CREATE POLICY "Users manage own aliases" ON "public"."price_base_aliases" USING (("auth"."uid"() IN ( SELECT "external_price_bases"."user_id"
   FROM "public"."external_price_bases"
  WHERE ("external_price_bases"."id" = "price_base_aliases"."base_id")))) WITH CHECK (("auth"."uid"() IN ( SELECT "external_price_bases"."user_id"
   FROM "public"."external_price_bases"
  WHERE ("external_price_bases"."id" = "price_base_aliases"."base_id"))));



CREATE POLICY "Users manage own bases" ON "public"."external_price_bases" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own items" ON "public"."external_price_items" USING (("auth"."uid"() IN ( SELECT "external_price_bases"."user_id"
   FROM "public"."external_price_bases"
  WHERE ("external_price_bases"."id" = "external_price_items"."base_id")))) WITH CHECK (("auth"."uid"() IN ( SELECT "external_price_bases"."user_id"
   FROM "public"."external_price_bases"
  WHERE ("external_price_bases"."id" = "external_price_items"."base_id"))));



CREATE POLICY "allow_insert_import_items_own_job" ON "public"."import_items" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "allow_select_import_items_via_job" ON "public"."import_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."import_jobs" "j"
  WHERE (("j"."id" = "import_items"."job_id") AND ("j"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bdi" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."budget_item_compositions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."budget_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "budget_items_update_own" ON "public"."budget_items" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."budget_schedules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."budgets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."composition_inputs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."compositions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."encargos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."external_price_bases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."external_price_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_ai_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_ai_summaries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_ocr_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_parse_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_summaries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."insumos_base" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own_files_delete" ON "public"."import_files" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "own_files_insert" ON "public"."import_files" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "own_files_select" ON "public"."import_files" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "own_files_update" ON "public"."import_files" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "own_items_delete" ON "public"."import_items" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "own_items_insert" ON "public"."import_items" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "own_items_select" ON "public"."import_items" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "own_items_update" ON "public"."import_items" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "own_jobs_delete" ON "public"."import_jobs" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "own_jobs_insert" ON "public"."import_jobs" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "own_jobs_select" ON "public"."import_jobs" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "own_jobs_update" ON "public"."import_jobs" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "own_memory_delete" ON "public"."user_learning_memory" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "own_memory_insert" ON "public"."user_learning_memory" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "own_memory_select" ON "public"."user_learning_memory" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "own_memory_update" ON "public"."user_learning_memory" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "own_ref_bases_delete" ON "public"."reference_bases" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "own_ref_bases_insert" ON "public"."reference_bases" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "own_ref_bases_select" ON "public"."reference_bases" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "own_ref_bases_update" ON "public"."reference_bases" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."price_base_aliases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."price_bases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."proposals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read_sinapi_composition_items" ON "public"."sinapi_composition_items" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "read_sinapi_composition_prices" ON "public"."sinapi_composition_prices" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "read_sinapi_compositions" ON "public"."sinapi_compositions" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "read_sinapi_input_prices" ON "public"."sinapi_input_prices" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "read_sinapi_inputs" ON "public"."sinapi_inputs_base" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "read_sinapi_price_tables" ON "public"."sinapi_price_tables" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."reference_bases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "select_import_ai_items_by_job_owner" ON "public"."import_ai_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."import_jobs" "j"
  WHERE (("j"."id" = "import_ai_items"."job_id") AND ("j"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."sinapi_composition_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sinapi_composition_prices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sinapi_compositions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sinapi_import_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sinapi_input_prices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sinapi_inputs_base" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sinapi_price_tables" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tmp_allow_authenticated_insert_price_tables" ON "public"."sinapi_price_tables" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "tmp_allow_authenticated_insert_sinapi_composition_items" ON "public"."sinapi_composition_items" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "tmp_allow_authenticated_insert_sinapi_composition_prices" ON "public"."sinapi_composition_prices" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "tmp_allow_authenticated_insert_sinapi_compositions" ON "public"."sinapi_compositions" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "tmp_allow_authenticated_insert_sinapi_input_prices" ON "public"."sinapi_input_prices" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "tmp_allow_authenticated_insert_sinapi_inputs" ON "public"."sinapi_inputs_base" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "tmp_allow_authenticated_select_price_tables" ON "public"."sinapi_price_tables" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "tmp_allow_authenticated_select_sinapi_composition_items" ON "public"."sinapi_composition_items" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "tmp_allow_authenticated_select_sinapi_composition_prices" ON "public"."sinapi_composition_prices" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "tmp_allow_authenticated_select_sinapi_compositions" ON "public"."sinapi_compositions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "tmp_allow_authenticated_select_sinapi_input_prices" ON "public"."sinapi_input_prices" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "tmp_allow_authenticated_select_sinapi_inputs" ON "public"."sinapi_inputs_base" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "tmp_allow_authenticated_update_price_tables" ON "public"."sinapi_price_tables" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "tmp_allow_authenticated_update_sinapi_composition_items" ON "public"."sinapi_composition_items" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "tmp_allow_authenticated_update_sinapi_composition_prices" ON "public"."sinapi_composition_prices" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "tmp_allow_authenticated_update_sinapi_compositions" ON "public"."sinapi_compositions" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "tmp_allow_authenticated_update_sinapi_input_prices" ON "public"."sinapi_input_prices" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "tmp_allow_authenticated_update_sinapi_inputs" ON "public"."sinapi_inputs_base" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."user_learning_memory" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

















































































































































































GRANT ALL ON FUNCTION "public"."__touch_postgrest_cache"() TO "anon";
GRANT ALL ON FUNCTION "public"."__touch_postgrest_cache"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."__touch_postgrest_cache"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."_app_secret"("secret_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_app_secret"("secret_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_app_secret"("secret_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_app_secret"("secret_name" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."_app_secret"("secret_name" "text") TO "supabase_admin";



GRANT ALL ON FUNCTION "public"."_get_service_role_key"() TO "anon";
GRANT ALL ON FUNCTION "public"."_get_service_role_key"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_service_role_key"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_confirm_import_job"("p_job_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_confirm_import_job"("p_job_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_confirm_import_job"("p_job_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."import_jobs" TO "anon";
GRANT ALL ON TABLE "public"."import_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."import_jobs" TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_start_import_job"("job_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_start_import_job"("job_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_start_import_job"("job_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_start_import_job"("job_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."atomic_merge_stageb_metadata"("file_id" "uuid", "stageb_data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."atomic_merge_stageb_metadata"("file_id" "uuid", "stageb_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."atomic_merge_stageb_metadata"("file_id" "uuid", "stageb_data" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_finalize_pending_jobs"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_finalize_pending_jobs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_finalize_pending_jobs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."block_worker_placeholder_ai_items"() TO "anon";
GRANT ALL ON FUNCTION "public"."block_worker_placeholder_ai_items"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."block_worker_placeholder_ai_items"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calc_budget_item_total"() TO "anon";
GRANT ALL ON FUNCTION "public"."calc_budget_item_total"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calc_budget_item_total"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_import_rate_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_import_rate_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_import_rate_limit"() TO "service_role";



GRANT ALL ON TABLE "public"."import_ocr_jobs" TO "anon";
GRANT ALL ON TABLE "public"."import_ocr_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."import_ocr_jobs" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_next_ocr_job"("p_worker_id" "text", "p_lock_duration_sec" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_next_ocr_job"("p_worker_id" "text", "p_lock_duration_sec" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_next_ocr_job"("p_worker_id" "text", "p_lock_duration_sec" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_stale_ocr_jobs"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_stale_ocr_jobs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_stale_ocr_jobs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."debug_finalize_timing"("p_job_id" "uuid", "p_user_id" "uuid", "p_budget_id" "uuid", "p_price_table_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."debug_finalize_timing"("p_job_id" "uuid", "p_user_id" "uuid", "p_budget_id" "uuid", "p_price_table_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."debug_finalize_timing"("p_job_id" "uuid", "p_user_id" "uuid", "p_budget_id" "uuid", "p_price_table_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."dispatch_parse_task"("max_tasks" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."dispatch_parse_task"("max_tasks" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dispatch_parse_task"("max_tasks" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_sinapi_price_table"("_row" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_sinapi_price_table"("_row" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_sinapi_price_table"("_row" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_sinapi_price_table"("_row" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_sinapi_price_table"("_source" "text", "_uf" "text", "_competence" "text", "_regime" "text", "_is_mock" boolean, "_source_tag" "text", "_file_urls" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_sinapi_price_table"("_source" "text", "_uf" "text", "_competence" "text", "_regime" "text", "_is_mock" boolean, "_source_tag" "text", "_file_urls" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_sinapi_price_table"("_source" "text", "_uf" "text", "_competence" "text", "_regime" "text", "_is_mock" boolean, "_source_tag" "text", "_file_urls" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_sinapi_price_table"("_source" "text", "_uf" "text", "_competence" "text", "_regime" "text", "_is_mock" boolean, "_source_tag" "text", "_file_urls" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."fail_stuck_import_jobs"() TO "anon";
GRANT ALL ON FUNCTION "public"."fail_stuck_import_jobs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fail_stuck_import_jobs"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_import_job"("p_job_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_import_job"("p_job_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."finalize_import_job"("p_job_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_import_job"("p_job_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."finalize_import_to_budget"("p_job_id" "uuid", "p_user_id" "uuid", "p_params" "jsonb", "p_analytic_data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."finalize_import_to_budget"("p_job_id" "uuid", "p_user_id" "uuid", "p_params" "jsonb", "p_analytic_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_import_to_budget"("p_job_id" "uuid", "p_user_id" "uuid", "p_params" "jsonb", "p_analytic_data" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."finalize_ocr_job"("p_id" "uuid", "p_status" "text", "p_last_error" "text", "p_retry_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."finalize_ocr_job"("p_id" "uuid", "p_status" "text", "p_last_error" "text", "p_retry_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_ocr_job"("p_id" "uuid", "p_status" "text", "p_last_error" "text", "p_retry_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."finalize_ready_import_jobs"() TO "anon";
GRANT ALL ON FUNCTION "public"."finalize_ready_import_jobs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_ready_import_jobs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."finalize_ready_import_jobs"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."finalize_ready_import_jobs"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_ready_import_jobs"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."find_analytic_file_composition"("p_job_id" "uuid", "p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."find_analytic_file_composition"("p_job_id" "uuid", "p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_analytic_file_composition"("p_job_id" "uuid", "p_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."find_composition_in_bases"("p_code" "text", "p_user_id" "uuid", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."find_composition_in_bases"("p_code" "text", "p_user_id" "uuid", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_composition_in_bases"("p_code" "text", "p_user_id" "uuid", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."find_composition_in_bases"("p_code" "text", "p_user_id" "uuid", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean, "p_bases_selecionadas" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."find_composition_in_bases"("p_code" "text", "p_user_id" "uuid", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean, "p_bases_selecionadas" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_composition_in_bases"("p_code" "text", "p_user_id" "uuid", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean, "p_bases_selecionadas" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."find_internal_composition"("p_code" "text", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."find_internal_composition"("p_code" "text", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_internal_composition"("p_code" "text", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fix_import_parse_worker_cron_headers"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fix_import_parse_worker_cron_headers"() TO "anon";
GRANT ALL ON FUNCTION "public"."fix_import_parse_worker_cron_headers"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fix_import_parse_worker_cron_headers"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fix_prices_on_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."fix_prices_on_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fix_prices_on_insert"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_db_fingerprint"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_db_fingerprint"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_db_fingerprint"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_db_fingerprint"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_extraction_retries_pending"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_extraction_retries_pending"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_extraction_retries_pending"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_import_job_waiting_user_requires_items"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_import_job_waiting_user_requires_items"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_import_job_waiting_user_requires_items"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."import_extraction_watchdog"() TO "anon";
GRANT ALL ON FUNCTION "public"."import_extraction_watchdog"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."import_extraction_watchdog"() TO "service_role";



GRANT ALL ON FUNCTION "public"."import_job_set_checkpoint"("p_job_id" "uuid", "p_checkpoint" "text", "p_checkpoint_ts" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."import_job_set_checkpoint"("p_job_id" "uuid", "p_checkpoint" "text", "p_checkpoint_ts" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."import_job_set_checkpoint"("p_job_id" "uuid", "p_checkpoint" "text", "p_checkpoint_ts" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."import_jobs_watchdog"() TO "anon";
GRANT ALL ON FUNCTION "public"."import_jobs_watchdog"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."import_jobs_watchdog"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_sinapi_composition_items"("_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_sinapi_composition_items"("_rows" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_composition_items"("_rows" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_composition_items"("_rows" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."ingest_sinapi_composition_items_batch"("p_items" "jsonb", "p_price_table_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_composition_items_batch"("p_items" "jsonb", "p_price_table_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_composition_items_batch"("p_items" "jsonb", "p_price_table_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_sinapi_composition_prices"("_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_sinapi_composition_prices"("_rows" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_composition_prices"("_rows" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_composition_prices"("_rows" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."ingest_sinapi_composition_prices_batch"("p_price_table_id" "uuid", "p_prices" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_composition_prices_batch"("p_price_table_id" "uuid", "p_prices" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_composition_prices_batch"("p_price_table_id" "uuid", "p_prices" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_sinapi_compositions"("_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_sinapi_compositions"("_rows" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_compositions"("_rows" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_compositions"("_rows" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."ingest_sinapi_compositions_batch"("p_compositions" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_compositions_batch"("p_compositions" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_compositions_batch"("p_compositions" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_sinapi_input_prices"("_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_sinapi_input_prices"("_rows" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_input_prices"("_rows" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_input_prices"("_rows" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."ingest_sinapi_input_prices_batch"("p_price_table_id" "uuid", "p_prices" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_input_prices_batch"("p_price_table_id" "uuid", "p_prices" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_input_prices_batch"("p_price_table_id" "uuid", "p_prices" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_sinapi_inputs"("_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_sinapi_inputs"("_rows" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_inputs"("_rows" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_inputs"("_rows" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."ingest_sinapi_inputs_batch"("p_inputs" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_inputs_batch"("p_inputs" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_inputs_batch"("p_inputs" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."ingest_sinapi_price_table"("p_source" "text", "p_uf" "text", "p_competencia" "text", "p_regime" "text", "p_is_mock" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_price_table"("p_source" "text", "p_uf" "text", "p_competencia" "text", "p_regime" "text", "p_is_mock" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ingest_sinapi_price_table"("p_source" "text", "p_uf" "text", "p_competencia" "text", "p_regime" "text", "p_is_mock" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_parse_tasks_ready"("max_tasks" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."mark_parse_tasks_ready"("max_tasks" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_parse_tasks_ready"("max_tasks" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."process_hydration_batch"("p_budget_id" "uuid", "p_job_id" "uuid", "p_user_id" "uuid", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean, "p_batch_size" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."process_hydration_batch"("p_budget_id" "uuid", "p_job_id" "uuid", "p_user_id" "uuid", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean, "p_batch_size" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_hydration_batch"("p_budget_id" "uuid", "p_job_id" "uuid", "p_user_id" "uuid", "p_uf" "text", "p_competence" "text", "p_desonerado" boolean, "p_batch_size" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."recalc_budget"("bid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalc_budget"("bid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalc_budget"("bid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."recalc_budget_hierarchy"("p_budget_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalc_budget_hierarchy"("p_budget_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalc_budget_hierarchy"("p_budget_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."recalc_budget_items"() TO "anon";
GRANT ALL ON FUNCTION "public"."recalc_budget_items"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalc_budget_items"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recalc_sinapi_composition_prices"("p_price_table_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalc_sinapi_composition_prices"("p_price_table_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalc_sinapi_composition_prices"("p_price_table_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."recover_stale_ocr_locks"() TO "anon";
GRANT ALL ON FUNCTION "public"."recover_stale_ocr_locks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."recover_stale_ocr_locks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recover_stuck_parse_tasks"() TO "anon";
GRANT ALL ON FUNCTION "public"."recover_stuck_parse_tasks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."recover_stuck_parse_tasks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reorder_budget_items"("items" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."reorder_budget_items"("items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_budget_items"("items" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."reprocess_extraction"("p_job_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reprocess_extraction"("p_job_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reprocess_extraction"("p_job_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_import_hydration_issue"("p_issue_id" "uuid", "p_selected_composition" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_import_hydration_issue"("p_issue_id" "uuid", "p_selected_composition" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_import_hydration_issue"("p_issue_id" "uuid", "p_selected_composition" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."run_finalize_import_jobs"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."run_finalize_import_jobs"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."run_finalize_import_jobs"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_finalize_import_jobs"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."save_chunk_progress"("p_ocr_job_id" "uuid", "p_chunk_index" integer, "p_total_chunks" integer, "p_is_final" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."save_chunk_progress"("p_ocr_job_id" "uuid", "p_chunk_index" integer, "p_total_chunks" integer, "p_is_final" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_chunk_progress"("p_ocr_job_id" "uuid", "p_chunk_index" integer, "p_total_chunks" integer, "p_is_final" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_items"("p_query" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_items"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_items"("p_query" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_sinapi_any_item"("p_query" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_sinapi_any_item"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_sinapi_any_item"("p_query" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_sinapi_compositions"("p_q" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_sinapi_compositions"("p_q" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_sinapi_compositions"("p_q" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_sinapi_inputs"("p_query" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_sinapi_inputs"("p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_sinapi_inputs"("p_query" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."should_poke_ocr_worker"("p_cap" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."should_poke_ocr_worker"("p_cap" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."should_poke_ocr_worker"("p_cap" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."should_watchdog_fail"("j" "public"."import_jobs") TO "anon";
GRANT ALL ON FUNCTION "public"."should_watchdog_fail"("j" "public"."import_jobs") TO "authenticated";
GRANT ALL ON FUNCTION "public"."should_watchdog_fail"("j" "public"."import_jobs") TO "service_role";



GRANT ALL ON FUNCTION "public"."sinapi_import_summary"("p_price_table_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sinapi_import_summary"("p_price_table_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sinapi_import_summary"("p_price_table_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."start_import_job"("p_job_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."start_import_job"("p_job_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_import_job"("p_job_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_import_job_from_ocr"("p_job_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_import_job_from_ocr"("p_job_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_import_job_from_ocr"("p_job_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_recalc_after_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_recalc_after_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recalc_after_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_recalc_after_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_recalc_after_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recalc_after_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_finalize_import_async"("p_job_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_finalize_import_async"("p_job_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_finalize_import_async"("p_job_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_recalc_budget"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_recalc_budget"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_recalc_budget"() TO "service_role";



GRANT ALL ON FUNCTION "public"."try_finalize_import_job_after_ai"() TO "anon";
GRANT ALL ON FUNCTION "public"."try_finalize_import_job_after_ai"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."try_finalize_import_job_after_ai"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_budget_total"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_budget_total"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_budget_total"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_hydration_issue_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_hydration_issue_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_hydration_issue_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_ocr_job_status"("p_id" "uuid", "p_status" "text", "p_last_error" "text", "p_retry_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."update_ocr_job_status"("p_id" "uuid", "p_status" "text", "p_last_error" "text", "p_retry_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_ocr_job_status"("p_id" "uuid", "p_status" "text", "p_last_error" "text", "p_retry_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";
























GRANT ALL ON TABLE "public"."_backup_functions" TO "anon";
GRANT ALL ON TABLE "public"."_backup_functions" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_functions" TO "service_role";



GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."bdi" TO "anon";
GRANT ALL ON TABLE "public"."bdi" TO "authenticated";
GRANT ALL ON TABLE "public"."bdi" TO "service_role";



GRANT ALL ON TABLE "public"."budget_item_compositions" TO "anon";
GRANT ALL ON TABLE "public"."budget_item_compositions" TO "authenticated";
GRANT ALL ON TABLE "public"."budget_item_compositions" TO "service_role";



GRANT ALL ON TABLE "public"."budget_items" TO "anon";
GRANT ALL ON TABLE "public"."budget_items" TO "authenticated";
GRANT ALL ON TABLE "public"."budget_items" TO "service_role";



GRANT ALL ON TABLE "public"."budget_items_with_weight" TO "anon";
GRANT ALL ON TABLE "public"."budget_items_with_weight" TO "authenticated";
GRANT ALL ON TABLE "public"."budget_items_with_weight" TO "service_role";



GRANT ALL ON TABLE "public"."budget_schedules" TO "anon";
GRANT ALL ON TABLE "public"."budget_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."budget_schedules" TO "service_role";



GRANT ALL ON TABLE "public"."budgets" TO "anon";
GRANT ALL ON TABLE "public"."budgets" TO "authenticated";
GRANT ALL ON TABLE "public"."budgets" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT ALL ON TABLE "public"."composition_inputs" TO "anon";
GRANT ALL ON TABLE "public"."composition_inputs" TO "authenticated";
GRANT ALL ON TABLE "public"."composition_inputs" TO "service_role";



GRANT ALL ON TABLE "public"."compositions" TO "anon";
GRANT ALL ON TABLE "public"."compositions" TO "authenticated";
GRANT ALL ON TABLE "public"."compositions" TO "service_role";



GRANT ALL ON TABLE "public"."cronograma_base" TO "anon";
GRANT ALL ON TABLE "public"."cronograma_base" TO "authenticated";
GRANT ALL ON TABLE "public"."cronograma_base" TO "service_role";



GRANT ALL ON TABLE "public"."import_ai_items" TO "anon";
GRANT ALL ON TABLE "public"."import_ai_items" TO "authenticated";
GRANT ALL ON TABLE "public"."import_ai_items" TO "service_role";



GRANT ALL ON TABLE "public"."import_parse_tasks" TO "anon";
GRANT ALL ON TABLE "public"."import_parse_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."import_parse_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."debug_worker_status" TO "anon";
GRANT ALL ON TABLE "public"."debug_worker_status" TO "authenticated";
GRANT ALL ON TABLE "public"."debug_worker_status" TO "service_role";



GRANT ALL ON TABLE "public"."encargos" TO "anon";
GRANT ALL ON TABLE "public"."encargos" TO "authenticated";
GRANT ALL ON TABLE "public"."encargos" TO "service_role";



GRANT ALL ON TABLE "public"."external_price_bases" TO "anon";
GRANT ALL ON TABLE "public"."external_price_bases" TO "authenticated";
GRANT ALL ON TABLE "public"."external_price_bases" TO "service_role";



GRANT ALL ON TABLE "public"."external_price_items" TO "anon";
GRANT ALL ON TABLE "public"."external_price_items" TO "authenticated";
GRANT ALL ON TABLE "public"."external_price_items" TO "service_role";



GRANT ALL ON TABLE "public"."import_ai_summaries" TO "anon";
GRANT ALL ON TABLE "public"."import_ai_summaries" TO "authenticated";
GRANT ALL ON TABLE "public"."import_ai_summaries" TO "service_role";



GRANT ALL ON TABLE "public"."import_budget_finalizations" TO "anon";
GRANT ALL ON TABLE "public"."import_budget_finalizations" TO "authenticated";
GRANT ALL ON TABLE "public"."import_budget_finalizations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."import_budget_finalizations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."import_budget_finalizations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."import_budget_finalizations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."import_files" TO "anon";
GRANT ALL ON TABLE "public"."import_files" TO "authenticated";
GRANT ALL ON TABLE "public"."import_files" TO "service_role";



GRANT ALL ON TABLE "public"."import_finalization_runs" TO "anon";
GRANT ALL ON TABLE "public"."import_finalization_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."import_finalization_runs" TO "service_role";



GRANT ALL ON TABLE "public"."import_hydration_issues" TO "anon";
GRANT ALL ON TABLE "public"."import_hydration_issues" TO "authenticated";
GRANT ALL ON TABLE "public"."import_hydration_issues" TO "service_role";



GRANT ALL ON TABLE "public"."import_items" TO "anon";
GRANT ALL ON TABLE "public"."import_items" TO "authenticated";
GRANT ALL ON TABLE "public"."import_items" TO "service_role";



GRANT ALL ON TABLE "public"."import_summaries" TO "anon";
GRANT ALL ON TABLE "public"."import_summaries" TO "authenticated";
GRANT ALL ON TABLE "public"."import_summaries" TO "service_role";



GRANT ALL ON TABLE "public"."insumos_base" TO "anon";
GRANT ALL ON TABLE "public"."insumos_base" TO "authenticated";
GRANT ALL ON TABLE "public"."insumos_base" TO "service_role";



GRANT ALL ON TABLE "public"."sinapi_compositions" TO "anon";
GRANT ALL ON TABLE "public"."sinapi_compositions" TO "authenticated";
GRANT ALL ON TABLE "public"."sinapi_compositions" TO "service_role";



GRANT ALL ON TABLE "public"."insumos" TO "anon";
GRANT ALL ON TABLE "public"."insumos" TO "authenticated";
GRANT ALL ON TABLE "public"."insumos" TO "service_role";



GRANT ALL ON TABLE "public"."price_base_aliases" TO "anon";
GRANT ALL ON TABLE "public"."price_base_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."price_base_aliases" TO "service_role";



GRANT ALL ON TABLE "public"."price_bases" TO "anon";
GRANT ALL ON TABLE "public"."price_bases" TO "authenticated";
GRANT ALL ON TABLE "public"."price_bases" TO "service_role";



GRANT ALL ON TABLE "public"."proposals" TO "anon";
GRANT ALL ON TABLE "public"."proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."proposals" TO "service_role";



GRANT ALL ON TABLE "public"."reference_bases" TO "anon";
GRANT ALL ON TABLE "public"."reference_bases" TO "authenticated";
GRANT ALL ON TABLE "public"."reference_bases" TO "service_role";



GRANT ALL ON TABLE "public"."sinapi_composition_items" TO "anon";
GRANT ALL ON TABLE "public"."sinapi_composition_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sinapi_composition_items" TO "service_role";



GRANT ALL ON TABLE "public"."sinapi_composition_prices" TO "anon";
GRANT ALL ON TABLE "public"."sinapi_composition_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."sinapi_composition_prices" TO "service_role";



GRANT ALL ON TABLE "public"."sinapi_price_tables" TO "anon";
GRANT ALL ON TABLE "public"."sinapi_price_tables" TO "authenticated";
GRANT ALL ON TABLE "public"."sinapi_price_tables" TO "service_role";



GRANT ALL ON TABLE "public"."sinapi_compositions_with_prices" TO "anon";
GRANT ALL ON TABLE "public"."sinapi_compositions_with_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."sinapi_compositions_with_prices" TO "service_role";



GRANT ALL ON TABLE "public"."sinapi_import_runs" TO "anon";
GRANT ALL ON TABLE "public"."sinapi_import_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."sinapi_import_runs" TO "service_role";



GRANT ALL ON TABLE "public"."sinapi_input_prices" TO "anon";
GRANT ALL ON TABLE "public"."sinapi_input_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."sinapi_input_prices" TO "service_role";



GRANT ALL ON TABLE "public"."sinapi_inputs_base" TO "anon";
GRANT ALL ON TABLE "public"."sinapi_inputs_base" TO "authenticated";
GRANT ALL ON TABLE "public"."sinapi_inputs_base" TO "service_role";



GRANT ALL ON TABLE "public"."sinapi_inputs_with_prices" TO "anon";
GRANT ALL ON TABLE "public"."sinapi_inputs_with_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."sinapi_inputs_with_prices" TO "service_role";



GRANT ALL ON TABLE "public"."sinapi_items_search" TO "anon";
GRANT ALL ON TABLE "public"."sinapi_items_search" TO "authenticated";
GRANT ALL ON TABLE "public"."sinapi_items_search" TO "service_role";



GRANT ALL ON TABLE "public"."user_learning_memory" TO "anon";
GRANT ALL ON TABLE "public"."user_learning_memory" TO "authenticated";
GRANT ALL ON TABLE "public"."user_learning_memory" TO "service_role";



GRANT ALL ON TABLE "public"."view_jobs_ready_for_extraction_retry" TO "anon";
GRANT ALL ON TABLE "public"."view_jobs_ready_for_extraction_retry" TO "authenticated";
GRANT ALL ON TABLE "public"."view_jobs_ready_for_extraction_retry" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































