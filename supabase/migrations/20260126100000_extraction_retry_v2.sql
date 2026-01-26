
-- Migration: Implement retry mechanism for Phase 2 Extraction
-- Project: NaboOrça

-- 1) Add new columns to public.import_jobs for extraction retry logic
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'import_jobs' AND column_name = 'extraction_attempts') THEN
        ALTER TABLE public.import_jobs ADD COLUMN extraction_attempts int NOT NULL DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'import_jobs' AND column_name = 'extraction_retryable') THEN
        ALTER TABLE public.import_jobs ADD COLUMN extraction_retryable boolean NOT NULL DEFAULT false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'import_jobs' AND column_name = 'extraction_next_retry_at') THEN
        ALTER TABLE public.import_jobs ADD COLUMN extraction_next_retry_at timestamptz NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'import_jobs' AND column_name = 'extraction_last_reason') THEN
        ALTER TABLE public.import_jobs ADD COLUMN extraction_last_reason text NULL;
    END IF;
END $$;

-- 2) Create index for scheduler/worker polling
CREATE INDEX IF NOT EXISTS idx_import_jobs_extraction_retry 
ON public.import_jobs (extraction_retryable, extraction_next_retry_at) 
WHERE extraction_retryable = true;

-- 3) RPC for manual/automated reprocess
CREATE OR REPLACE FUNCTION public.reprocess_extraction(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job RECORD;
BEGIN
    SELECT * INTO v_job FROM import_jobs WHERE id = p_job_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'message', 'Job not found');
    END IF;

    -- Reset error flags and increment attempts
    UPDATE public.import_jobs
    SET 
        status = 'processing',
        stage = 'ready_to_extract',
        last_error = NULL,
        extraction_retryable = false,
        extraction_next_retry_at = NULL,
        extraction_attempts = extraction_attempts + 1,
        updated_at = now()
    WHERE id = p_job_id;

    -- Also reset the file status to allow the worker to pick it up cleanly
    UPDATE public.import_files
    SET 
        extraction_status = 'queued',
        extraction_last_error = NULL,
        extraction_reason = 'manual_reprocess'
    WHERE job_id = p_job_id;

    RETURN jsonb_build_object('ok', true, 'job_id', p_job_id, 'new_attempts', v_job.extraction_attempts + 1);
END;
$$;

-- 4) (Optional) Helper view for jobs ready for retry
CREATE OR REPLACE VIEW public.view_jobs_ready_for_extraction_retry AS
SELECT id, extraction_attempts, extraction_next_retry_at, extraction_last_reason
FROM public.import_jobs
WHERE extraction_retryable = true 
  AND extraction_next_retry_at <= now()
  AND status != 'failed';
