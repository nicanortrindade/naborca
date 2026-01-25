-- Trigger function to automatically enqueue PDF tasks and update job status
-- Justification: The UI creates import_files records directly (PostgREST), bypassing Edge Functions.
-- This DB-level trigger ensures PDFs are always sent to the background queue, preventing watchdog timeouts.

CREATE OR REPLACE FUNCTION public.enqueue_pdf_parse_task_on_import_files()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  is_pdf boolean;
BEGIN
  -- Detect PDF
  is_pdf :=
    (NEW.content_type is not null and lower(NEW.content_type) = 'application/pdf')
    OR (NEW.original_filename is not null and lower(NEW.original_filename) like '%.pdf')
    OR (NEW.storage_path is not null and lower(NEW.storage_path) like '%.pdf')
    OR (NEW.file_kind is not null and lower(NEW.file_kind::text) = 'pdf');

  IF NOT is_pdf THEN
    RETURN NEW;
  END IF;

  -- 1. Enqueue Task (Idempotent: prevent duplicates for same job+file)
  IF NOT EXISTS (
    SELECT 1
    FROM public.import_parse_tasks t
    WHERE t.job_id = NEW.job_id AND t.file_id = NEW.id
  ) THEN
    INSERT INTO public.import_parse_tasks (job_id, file_id, status, created_at, updated_at)
    VALUES (NEW.job_id, NEW.id, 'queued', now(), now());
  END IF;

  -- 2. Update Job (force valid state for processing)
  UPDATE public.import_jobs
  SET
    status = CASE WHEN (status IS NULL OR status = 'queued') THEN 'processing' ELSE status END,
    progress = CASE WHEN COALESCE(progress, 0) < 1 THEN 1 ELSE progress END,
    current_step = 'queued_for_parse_worker',
    updated_at = now()
  WHERE id = NEW.job_id;

  RETURN NEW;
END;
$$;

-- Create Trigger
DROP TRIGGER IF EXISTS trg_enqueue_pdf_parse_task ON public.import_files;

CREATE TRIGGER trg_enqueue_pdf_parse_task
AFTER INSERT ON public.import_files
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_pdf_parse_task_on_import_files();
