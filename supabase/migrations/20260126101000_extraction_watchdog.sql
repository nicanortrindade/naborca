
-- Migration: Extraction Watchdog and Retry Logic
-- Project: NaboOrça

-- 1) Watchdog: Mark stuck jobs as retryable
CREATE OR REPLACE FUNCTION public.import_extraction_watchdog(p_timeout_interval interval DEFAULT interval '6 minutes')
RETURNS TABLE (job_id uuid, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_max_attempts int := 6;
BEGIN
    RETURN QUERY
    WITH stuck_jobs AS (
        SELECT j.id, j.extraction_attempts
        FROM public.import_jobs j
        WHERE (j.status = 'processing' OR j.stage = 'gemini_running')
          AND COALESCE(j.heartbeat_at, j.updated_at) < (now() - p_timeout_interval)
          AND j.status != 'failed'
    )
    UPDATE public.import_jobs j
    SET 
        extraction_retryable = (s.extraction_attempts < v_max_attempts),
        extraction_next_retry_at = CASE 
            WHEN s.extraction_attempts < v_max_attempts THEN now() + interval '2 minutes'
            ELSE NULL 
        END,
        stage = CASE 
            WHEN s.extraction_attempts < v_max_attempts THEN 'watchdog_timeout'
            ELSE 'failed' 
        END,
        status = CASE 
            WHEN s.extraction_attempts < v_max_attempts THEN j.status -- keep processing to allow worker polling if it resumes, but worker should check retryable
            ELSE 'failed' 
        END,
        last_error = CASE 
            WHEN s.extraction_attempts < v_max_attempts THEN 'watchdog_timeout_processing (retryable)'
            ELSE 'watchdog_timeout_processing (exhausted_retries)' 
        END,
        extraction_last_reason = CASE 
            WHEN s.extraction_attempts < v_max_attempts THEN 'watchdog_timeout_processing'
            ELSE 'exhausted_retries' 
        END,
        updated_at = now()
    FROM stuck_jobs s
    WHERE j.id = s.id
    RETURNING j.id, j.extraction_last_reason;
END;
$$;

-- 2) Helper to get jobs for retry
CREATE OR REPLACE FUNCTION public.get_extraction_retries_pending(p_limit int DEFAULT 3)
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

-- 3) Schedule the watchdog (if cron enabled)
-- Note: This is idempotent.
DO $$
BEGIN
    -- Only if pg_cron is available
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'import_extraction_watchdog_job',
            '*/5 * * * *', -- Every 5 minutes
            'SELECT public.import_extraction_watchdog();'
        );
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not schedule cron job: %', SQLERRM;
END $$;
