
-- ============================================================================
-- NABOORÇA • FASE 2: EXTRAÇÃO IA - SISTEMA DE RETRY E WATCHDOG
-- Descrição: Implementação das funções de recuperação de jobs travados
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FUNÇÃO 1: reprocess_extraction
-- Objetivo: Resetar manualmente um job para nova tentativa de extração
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reprocess_extraction(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- ----------------------------------------------------------------------------
-- FUNÇÃO 2: import_extraction_watchdog
-- Objetivo: Identificar jobs travados e marcar para retentativa automática
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_extraction_watchdog()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count int := 0;
    v_job RECORD;
    v_next_retry_interval interval;
    v_current_attempts int;
BEGIN
    -- Loop pelos jobs que parecem travados
    -- Critério: status='processing', stage='ocr_done' (onde a extração começa), 
    -- e sem sinal de vida (heartbeat) há mais de 6 minutos.
    FOR v_job IN
        SELECT id, extraction_attempts
        FROM public.import_jobs
        WHERE status = 'processing'
          AND stage = 'ocr_done'
          AND COALESCE(heartbeat_at, updated_at) < (now() - interval '6 minutes')
          AND (extraction_retryable = false OR extraction_retryable IS NULL) -- Evita reprocessar o que já está em wait
    LOOP
        v_current_attempts := v_job.extraction_attempts + 1;
        
        IF v_job.extraction_attempts < 6 THEN
            -- Calcular intervalo de backoff
            v_next_retry_interval := CASE 
                WHEN v_current_attempts = 1 THEN interval '2 minutes'
                WHEN v_current_attempts = 2 THEN interval '5 minutes'
                WHEN v_current_attempts = 3 THEN interval '15 minutes'
                ELSE interval '60 minutes'
            END;

            -- Marcar para retry sem falhar o job (UX amigável)
            UPDATE public.import_jobs
            SET 
                extraction_retryable = true,
                extraction_last_reason = 'watchdog_timeout_processing',
                extraction_next_retry_at = now() + v_next_retry_interval,
                updated_at = now()
            WHERE id = v_job.id;
        ELSE
            -- Limite atingido: Marcar como falha real
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

-- ----------------------------------------------------------------------------
-- CRON: Agendamento Automático (Opcional)
-- Objetivo: Rodar o watchdog a cada 5 minutos usando pg_cron
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    -- Verifica se a extensão pg_cron está disponível no banco
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Remove agendamento anterior se existir (Idempotência)
        PERFORM cron.unschedule('import_extraction_watchdog_cron');
        
        -- Cria novo agendamento
        PERFORM cron.schedule(
            'import_extraction_watchdog_cron',
            '*/5 * * * *', -- A cada 5 minutos
            'SELECT public.import_extraction_watchdog();'
        );
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Silenciar se houver falta de permissão no schema cron
    RAISE NOTICE 'Não foi possível agendar o cron: %', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- COMENTÁRIOS DE DOCUMENTAÇÃO
-- ----------------------------------------------------------------------------
COMMENT ON FUNCTION public.reprocess_extraction IS 'Reseta um job de extração IA para nova tentativa manual, respeitando o limite de 6 tentativas.';
COMMENT ON FUNCTION public.import_extraction_watchdog IS 'Monitor de jobs de extração travados. Implementa backoff exponencial para retentativas automáticas.';

-- ----------------------------------------------------------------------------
-- FUNÇÃO 3: get_extraction_retries_pending
-- Objetivo: Listar jobs que o sweep deve redispatchar
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_extraction_retries_pending(p_limit int DEFAULT 10)
RETURNS TABLE (job_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
