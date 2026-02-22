
-- ============================================================================
-- NABOORÇA • FIX: WATCHDOG STAGE CRITERIA
-- Migration: 20260222000000_fix_watchdog_stage_criteria.sql
-- Data: 2026-02-22
-- Motivo: O watchdog anterior só observava stage='ocr_done', deixando jobs
--         com stage='processing' ou stage='ready_to_extract' travados sem retry.
--         Esta migration amplia o critério para cobrir os três estados.
-- ============================================================================

-- Drop versão anterior (sem argumento) antes de recriar
DROP FUNCTION IF EXISTS public.import_extraction_watchdog();

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
    -- Loop pelos jobs que parecem travados.
    -- Critério ampliado (2026-02-22): captura três estágios:
    --   • 'ocr_done'         — job aguardando primeira execução do Stage B
    --   • 'processing'       — job interrompido durante Stage B (timeout Edge Function)
    --   • 'ready_to_extract' — job resetado por retry anterior mas não executado ainda
    -- Heartbeat sem sinal há mais de 6 minutos.
    FOR v_job IN
        SELECT id, extraction_attempts
        FROM public.import_jobs
        WHERE status = 'processing'
          AND stage IN ('ocr_done', 'processing', 'ready_to_extract')
          AND COALESCE(heartbeat_at, updated_at) < (now() - interval '6 minutes')
          AND (extraction_retryable = false OR extraction_retryable IS NULL)
          AND status != 'failed'
    LOOP
        v_current_attempts := v_job.extraction_attempts + 1;

        IF v_job.extraction_attempts < 6 THEN
            -- Calcular intervalo de backoff exponencial
            v_next_retry_interval := CASE
                WHEN v_current_attempts = 1 THEN interval '2 minutes'
                WHEN v_current_attempts = 2 THEN interval '5 minutes'
                WHEN v_current_attempts = 3 THEN interval '15 minutes'
                ELSE interval '60 minutes'
            END;

            -- Marcar para retry (UX amigável: não falha o job)
            UPDATE public.import_jobs
            SET
                extraction_retryable = true,
                extraction_last_reason = 'watchdog_timeout_processing',
                extraction_next_retry_at = now() + v_next_retry_interval,
                updated_at = now()
            WHERE id = v_job.id;
        ELSE
            -- Limite de tentativas esgotado: falha definitiva
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

-- Atualizar comentário de documentação
COMMENT ON FUNCTION public.import_extraction_watchdog() IS
    'Monitor de jobs de extração travados (fix 2026-02-22). '
    'Agora observa stage IN (''ocr_done'', ''processing'', ''ready_to_extract''). '
    'Implementa backoff exponencial: 2min, 5min, 15min, 60min. Máximo 6 tentativas.';

-- ============================================================================
-- VERIFICAÇÃO (executar manualmente para confirmar)
-- ============================================================================
-- SELECT proname, prosrc FROM pg_proc WHERE proname = 'import_extraction_watchdog';
-- SELECT public.import_extraction_watchdog(); -- Teste: deve retornar 0 se não há jobs travados
