
-- Migration: Add price_source to import_ai_items
-- Objective: Store the identified bank/source for hydrated items.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_ai_items' AND column_name = 'price_source') THEN
        ALTER TABLE public.import_ai_items ADD COLUMN price_source text;
    END IF;
END $$;
