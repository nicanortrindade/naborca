-- Migration: Robust OCR Pipeline — Orphan Cleanup + Safe Claim
-- Fixes:
--   1. claim_next_ocr_job now skips orphaned OCR jobs (parent already failed/done)
--   2. cleanup_stale_ocr_jobs now auto-fails orphaned OCR jobs in addition to stale timeouts
--   3. Both functions are idempotent and safe for any queue size (1 to 1M jobs)

-- ============================================================
-- 1. CLAIM: Skip orphans, only claim jobs with active parents
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_next_ocr_job(
    p_worker_id text,
    p_lock_duration_sec int default 60
)
RETURNS setof public.import_ocr_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_job_id uuid;
BEGIN
    -- Step 1: Auto-fail any orphaned pending jobs (parent already done/failed)
    -- This runs BEFORE claiming to keep the queue clean at all times.
    UPDATE public.import_ocr_jobs ocr
    SET
        status = 'failed',
        last_error = 'Orphaned: parent job status=' || j.status || ', stage=' || j.stage,
        completed_at = now(),
        updated_at = now(),
        locked_by = NULL,
        lock_expires_at = NULL
    FROM public.import_jobs j
    WHERE ocr.job_id = j.id
      AND ocr.status IN ('pending', 'processing')
      AND (
          j.status IN ('failed', 'done')
          OR (j.status = 'done' AND j.stage IN ('extraction_complete', 'pending_hydration', 'hydration_failed', 'failed'))
      );

    -- Step 2: Claim the next valid pending job
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
            started_at = coalesce(started_at, now()),
            updated_at = now()
        WHERE id = v_job_id
        RETURNING *;
    END IF;
END;
$$;


-- ============================================================
-- 2. WATCHDOG: Stale timeout + Orphan cleanup
-- ============================================================
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
    v_orphaned int;
BEGIN
    -- 0. ORPHAN CLEANUP: Fail any OCR jobs whose parent is already done/failed
    -- This catches jobs that were abandoned mid-flight (user closed, internet dropped, etc.)
    WITH orphaned AS (
        UPDATE public.import_ocr_jobs ocr
        SET
            status = 'failed',
            locked_by = NULL,
            lock_expires_at = NULL,
            last_error = 'Orphaned: parent job finished/failed. Auto-cleaned by watchdog.',
            completed_at = now(),
            updated_at = now()
        FROM public.import_jobs j
        WHERE ocr.job_id = j.id
          AND ocr.status IN ('pending', 'processing')
          AND (
              j.status IN ('failed', 'done')
              OR (j.status = 'done' AND j.stage IN ('extraction_complete', 'pending_hydration', 'hydration_failed', 'failed'))
          )
        RETURNING ocr.id
    )
    SELECT count(*) INTO v_orphaned FROM orphaned;

    IF v_orphaned > 0 THEN
        RAISE NOTICE '[WATCHDOG] Cleaned % orphaned OCR jobs', v_orphaned;
    END IF;

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

    -- Include orphaned in failed count for reporting
    v_failed := v_failed + v_orphaned;

    RETURN QUERY SELECT v_requeued, v_failed;
END;
$$;
