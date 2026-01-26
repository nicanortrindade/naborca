-- Phase 2.1 Observability for Extraction
-- Adding telemetry columns to import_files table

ALTER TABLE import_files ADD COLUMN IF NOT EXISTS extraction_status text;
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS extraction_started_at timestamptz;
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS extraction_reason text;

ALTER TABLE import_files ADD COLUMN IF NOT EXISTS extraction_chunks_total int;
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS extraction_chunks_done int;
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS extraction_items_inserted int;
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS extraction_summary_saved boolean;
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS extraction_duration_ms int;

ALTER TABLE import_files ADD COLUMN IF NOT EXISTS extraction_last_error text;

-- Add index for status if useful for monitoring
CREATE INDEX IF NOT EXISTS idx_import_files_extraction_status ON import_files(extraction_status);
