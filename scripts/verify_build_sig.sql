-- Verificação do Build Sig e Status
-- Executar após reprocessar o job ou subir novo arquivo

SELECT 
    id, 
    job_id,
    metadata->'stageB'->>'build_sig' as build_sig,
    extraction_status,
    extracted_completed_at,
    extraction_last_error,
    coalesce(extraction_items_inserted, 0) as items_generated
FROM import_files
ORDER BY updated_at DESC
LIMIT 5;

-- Verificar se items foram gerados recentemente
SELECT count(*) as recent_items 
FROM import_ai_items 
WHERE created_at > (now() - interval '10 minutes');
