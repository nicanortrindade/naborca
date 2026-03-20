UPDATE import_jobs
SET stage = 'failed',
    last_error = 'Manually stopped: ocr-worker incompatible with checkpoint code'
WHERE created_at >= '2026-03-20 10:00:00'
  AND stage NOT IN ('completed', 'failed', 'error', 'finalized');
