-- Validação: Worker Finalization
-- Objetivo: Garantir que não existem jobs "presos" em processing e que locks são liberados.

-- 1. Jobs Stuck in Processing (Processing > 5 min without lock update)
SELECT count(*) as stuck_jobs
FROM public.import_ocr_jobs
WHERE 
    status = 'processing' 
    AND (
        locked_by IS NOT NULL 
        AND lock_expires_at < NOW()
    );

-- 2. Lock Status Check (Should be empty for completed/failed jobs)
SELECT count(*) as dirty_locks
FROM public.import_ocr_jobs
WHERE 
    status IN ('completed', 'failed')
    AND (locked_by IS NOT NULL OR lock_expires_at IS NOT NULL);

-- 3. Status Distribution (Last hour)
SELECT 
    status, 
    count(*) 
FROM public.import_ocr_jobs
WHERE updated_at > NOW() - INTERVAL '1 hour'
GROUP BY status;

-- 4. Check specific stuck job (referência data real)
SELECT * FROM public.import_ocr_jobs 
WHERE id = '15e70afd-d463-4d0b-a08d-09bba22c2fe3';
