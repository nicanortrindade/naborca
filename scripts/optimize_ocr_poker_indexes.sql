-- Otimização para OCR Poker
-- Índices parciais para acesso O(1) em jobs pendentes

BEGIN;

-- 1. Índice para jobs pendentes sem agendamento (prioridade máxima)
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_pending_null_scheduled 
ON public.import_ocr_jobs (id) 
WHERE status = 'pending' AND scheduled_for IS NULL;

-- 2. Índice para jobs pendentes COM agendamento (para comparação temporal <= NOW())
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_pending_scheduled 
ON public.import_ocr_jobs (scheduled_for) 
WHERE status = 'pending' AND scheduled_for IS NOT NULL;

COMMIT;
