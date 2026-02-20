
UPDATE import_ocr_jobs
SET scheduled_at = now() - interval '1 minute',
    started_at = NULL,
    locked_by = NULL,
    status = 'pending'
WHERE status IN ('pending', 'processing');
