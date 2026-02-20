-- Migration: Add item_path and source_candidate_id for grounding and hierarchy
-- Created: 2026-02-20
-- Objective: Support structured path and link back to OCR candidates

ALTER TABLE public.import_ai_items
ADD COLUMN IF NOT EXISTS item_path TEXT NULL,
ADD COLUMN IF NOT EXISTS source_candidate_id TEXT NULL;
