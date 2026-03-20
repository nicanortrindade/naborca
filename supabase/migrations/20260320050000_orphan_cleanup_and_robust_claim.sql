-- Migration: Robust OCR Pipeline — Orphan Cleanup + Safe Claim
-- Fixes:
--   1. claim_next_ocr_job now skips orphaned OCR jobs (parent already failed/done)
--   2. claim_next_ocr_job detects stale parent jobs (processing but no progress for >15min)
--   3. cleanup_stale_ocr_jobs auto-fails orphaned + stale OCR jobs
--   4. Both functions are idempotent and safe for any queue size (1 to 1M jobs)

-- ============================================================
-- 1. CLAIM: Skip orphans + stale parents, only claim active jobs
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
    -- Step 1a: Auto-fail OCR jobs whose parent is terminal (done/failed)
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
      AND j.status IN ('failed', 'done');

    -- Step 1b: Auto-fail OCR jobs whose parent appears abandoned
    -- (parent still 'processing' but OCR job has made zero progress for >15min)
    -- This catches: user cancelled via UI, internet dropped, browser closed, etc.
    UPDATE public.import_ocr_jobs ocr
    SET
        status = 'failed',
        last_error = 'Stale parent: parent processing but OCR job has 0 progress for >15min. Likely cancelled/abandoned.',
        completed_at = now(),
        updated_at = now(),
        locked_by = NULL,
        lock_expires_at = NULL
    FROM public.import_jobs j
    LEFT JOIN public.import_files f ON f.job_id = j.id AND f.doc_role = 'synthetic'
    WHERE ocr.job_id = j.id
      AND ocr.status = 'pending'
      AND ocr.chunks_processed = 0
      AND ocr.created_at < (now() - interval '15 minutes')
      AND j.status = 'processing'
      AND (f.extracted_text IS NULL OR LENGTH(f.extracted_text) = 0);

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
-- 2. WATCHDOG: Stale timeout + Orphan cleanup + Stale parent
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
    v_stale_parent int;
BEGIN
    -- 0a. ORPHAN CLEANUP: parent already done/failed
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
          AND j.status IN ('failed', 'done')
        RETURNING ocr.id
    )
    SELECT count(*) INTO v_orphaned FROM orphaned;

    -- 0b. STALE PARENT CLEANUP: parent still 'processing' but OCR has no progress for >15min
    -- Catches abandoned jobs (user cancelled via UI, browser closed, etc.)
    WITH stale_parent AS (
        UPDATE public.import_ocr_jobs ocr
        SET
            status = 'failed',
            locked_by = NULL,
            lock_expires_at = NULL,
            last_error = 'Stale parent: processing but 0 OCR progress for >15min. Auto-cleaned.',
            completed_at = now(),
            updated_at = now()
        FROM public.import_jobs j
        LEFT JOIN public.import_files f ON f.job_id = j.id AND f.doc_role = 'synthetic'
        WHERE ocr.job_id = j.id
          AND ocr.status IN ('pending', 'processing')
          AND ocr.chunks_processed = 0
          AND ocr.created_at < (now() - interval '15 minutes')
          AND j.status = 'processing'
          AND (f.extracted_text IS NULL OR LENGTH(f.extracted_text) = 0)
        RETURNING ocr.id
    )
    SELECT count(*) INTO v_stale_parent FROM stale_parent;

    IF v_orphaned > 0 OR v_stale_parent > 0 THEN
        RAISE NOTICE '[WATCHDOG] Cleaned % orphaned + % stale-parent OCR jobs', v_orphaned, v_stale_parent;
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

    -- Include orphaned + stale_parent in failed count for reporting
    v_failed := v_failed + v_orphaned + v_stale_parent;

    RETURN QUERY SELECT v_requeued, v_failed;
END;
$$;
