select
  id,
  job_id,
  status,
  last_error,
  started_at,
  completed_at,
  locked_by,
  lock_expires_at,
  retry_count,
  updated_at
from public.import_ocr_jobs
where updated_at > now() - interval '2 hours'
order by updated_at desc
limit 50;
