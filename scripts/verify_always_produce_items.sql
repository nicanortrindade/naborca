-- Validação: ALWAYS PRODUCE ITEMS
-- Objetivo: Provar que falhas de OCR não matam o job e que itens (mesmo placeholders) são gerados.

-- 1. Jobs com falha no OCR mas que CONTINUARAM (devem ter itens ou sucesso parcial)
SELECT 
    j.id as job_id, 
    j.status as job_status, 
    count(aii.id) as items_count,
    f.metadata->'ocr'->>'status' as ocr_status,
    j.last_error
FROM public.import_jobs j
JOIN public.import_files f ON f.import_job_id = j.id
LEFT JOIN public.import_ai_items aii ON aii.job_id = j.id
WHERE 
    j.updated_at > NOW() - INTERVAL '1 hour'
    AND f.metadata->'ocr'->>'status' IN ('error', 'config_error', 'empty_text')
GROUP BY j.id, f.id
ORDER BY j.updated_at DESC;

-- 2. Itens Placeholder (Airbag)
-- Devem aparecer quando a extração falha totalmente
SELECT * 
FROM public.import_ai_items 
WHERE description LIKE '%Falha na leitura%' OR confidence = 0.0
ORDER BY created_at DESC
LIMIT 10;

-- 3. Invariante: Nenhum Job 'Failed' por OCR recentemente
SELECT count(*) as jobs_failed_by_ocr
FROM public.import_jobs
WHERE 
    updated_at > NOW() - INTERVAL '1 hour'
    AND status = 'failed'
    AND last_error ILIKE '%ocr%'; -- Ajustar conforme mensagem de erro antiga se necessário
