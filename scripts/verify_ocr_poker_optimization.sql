-- Validação da Otimização do OCR Poker

-- 1. EXPLAIN das queries de existência (Verifique se usam 'Index Only Scan' ou 'Bitmap Heap Scan' nos índices novos)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM public.import_ocr_jobs 
WHERE status = 'pending' AND scheduled_for IS NULL 
LIMIT 1;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM public.import_ocr_jobs 
WHERE status = 'pending' AND scheduled_for <= NOW() 
LIMIT 1;

-- 2. Sanity Check (Deve retornar 1 linha se houver trabalho, bem rápido)
SELECT 'Found Null Scheduled' as source, id 
FROM public.import_ocr_jobs 
WHERE status = 'pending' AND scheduled_for IS NULL 
LIMIT 1
UNION ALL
SELECT 'Found Scheduled' as source, id 
FROM public.import_ocr_jobs 
WHERE status = 'pending' AND scheduled_for <= NOW() 
LIMIT 1;

-- 3. Regressão (Não deve retornar nada se scheduled_for > NOW)
SELECT id, scheduled_for, status 
FROM public.import_ocr_jobs 
WHERE status = 'pending' 
AND scheduled_for > NOW();
