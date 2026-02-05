-- Migration: Stale Processing Watchdog
-- Objective: Recover/Fail jobs that have been 'processing' for too long (10m+)

CREATE OR REPLACE FUNCTION public.cleanup_stale_ocr_jobs()
RETURNS table (
    requeued_count int,
    failed_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
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
