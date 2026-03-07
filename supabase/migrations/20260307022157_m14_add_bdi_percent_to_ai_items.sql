-- M14: Add bdi_percent to import_ai_items
-- Required by the new OCR Fallback logic to persist deterministic BDI rates

ALTER TABLE public.import_ai_items 
ADD COLUMN IF NOT EXISTS bdi_percent numeric;
