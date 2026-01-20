-- MIGRATION: Support for Global Adjustment Overrides (Immutable Unit Price)
-- DATE: 2026-01-19
-- OBJECTIVE: Add metadata column for overrides and improve performance with indexes.

-- 1. Add metadata column (jsonb) to budget_item_compositions
-- Defines default as empty JSON object and ensures non-null values.
-- Postgres automatically backfills existing rows with the default value.
ALTER TABLE budget_item_compositions 
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb NOT NULL;

-- 2. Create Index for standard lookups (Performance)
-- frequently used in: BudgetItemCompositionService.getByBudgetItemId
CREATE INDEX IF NOT EXISTS idx_budget_item_compositions_budget_item_id 
ON budget_item_compositions(budget_item_id);

-- 3. Create Partial Index for Active Overrides (Performance)
-- Allows filtering/checking only items that have overrides active.
-- Useful for analytics dashboards or bulk validations.
CREATE INDEX IF NOT EXISTS idx_budget_item_compositions_metadata_overrides 
ON budget_item_compositions USING gin (metadata) 
WHERE (metadata ? 'adjustment_factor') OR (metadata ? 'adjustment_amount');

-- 4. Safety Update (Just in case column existed without constraints previously)
UPDATE budget_item_compositions 
SET metadata = '{}'::jsonb 
WHERE metadata IS NULL;

-- Verification
-- SELECT count(*) FROM budget_item_compositions WHERE metadata IS NULL; -- Should be 0
