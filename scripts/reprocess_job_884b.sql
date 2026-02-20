
UPDATE import_files 
SET extraction_status = 'queued',
    extracted_started_at = NULL,
    extracted_completed_at = NULL,
    extraction_last_error = NULL,
    extraction_reason = NULL,
    metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{retry_count}', '0'::jsonb)
WHERE job_id = '884b6902-3b97-48a1-a0a0-b46acf528902';

-- Clear tasks too to allow fresh start
DELETE FROM import_parse_tasks 
WHERE job_id = '884b6902-3b97-48a1-a0a0-b46acf528902';
