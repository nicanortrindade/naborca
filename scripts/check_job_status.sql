
-- (a) Estado dos arquivos
SELECT
    id,
    job_id,
    extraction_status,
    extracted_started_at,
    extracted_completed_at,
    extraction_last_error,
    extraction_reason,
    coalesce(extraction_items_inserted, 0) AS extraction_items_inserted
FROM public.import_files
WHERE job_id = '884b6902-3b97-48a1-a0a0-b46acf528902'
ORDER BY created_at ASC;

-- (b) Contagem de itens
SELECT
    count(*) AS ai_items_count
FROM public.import_ai_items
WHERE job_id = '884b6902-3b97-48a1-a0a0-b46acf528902';

-- (c) Últimas parse tasks
SELECT
    id AS task_id,
    file_id,
    status,
    attempts,
    max_attempts,
    locked_by,
    locked_at,
    last_error,
    left(coalesce(result::text,''), 800) AS result_preview,
    updated_at,
    created_at
FROM public.import_parse_tasks
WHERE job_id = '884b6902-3b97-48a1-a0a0-b46acf528902'
ORDER BY updated_at DESC
LIMIT 20;
