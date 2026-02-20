SELECT 
  j.id as job_id, 
  j.status as job_status, 
  j.stage, 
  t.status as task_status, 
  t.result->>'action' as worker_action, 
  f.extraction_status, 
  f.extracted_started_at,
  (SELECT COUNT(*) FROM import_ai_items ai WHERE ai.job_id = j.id) as items
FROM import_jobs j
LEFT JOIN import_parse_tasks t ON t.job_id = j.id
LEFT JOIN import_files f ON f.job_id = j.id
WHERE j.created_at > NOW() - INTERVAL '1 day'
ORDER BY j.created_at DESC
LIMIT 10;
