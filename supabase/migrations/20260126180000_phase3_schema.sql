-- Migration: Phase 3 Schema (Finalization & Hydration)
-- Priority: High (Structural Changes)

-- 1. Support for Multiple Files/Roles (Synthetic vs Analytic)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_files' AND column_name = 'role') THEN
        ALTER TABLE public.import_files 
        ADD COLUMN role text NOT NULL DEFAULT 'synthetic' 
        CHECK (role IN ('synthetic', 'analytic'));
    END IF;
END $$;

-- 2. Job Result Linking (One Budget per Job)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_jobs' AND column_name = 'result_budget_id') THEN
        ALTER TABLE public.import_jobs 
        ADD COLUMN result_budget_id uuid REFERENCES public.budgets(id) ON DELETE SET NULL;
        
        -- Optional: Ensure one job doesn't hold multiple active budget refs (business logic usually handles this, simpler index here)
        CREATE INDEX IF NOT EXISTS idx_import_jobs_result_budget ON public.import_jobs(result_budget_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_jobs' AND column_name = 'finalized_at') THEN
        ALTER TABLE public.import_jobs ADD COLUMN finalized_at timestamptz;
    END IF;
END $$;

-- 3. Budget Item Enrichment (Hydration Metadata)
-- Link back to source import item and track how it was hydrated (Internal DB vs Analytic File)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'budget_items' AND column_name = 'source_import_item_id') THEN
        ALTER TABLE public.budget_items 
        ADD COLUMN source_import_item_id uuid REFERENCES public.import_items(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'budget_items' AND column_name = 'hydration_status') THEN
        ALTER TABLE public.budget_items 
        ADD COLUMN hydration_status text DEFAULT 'none'
        CHECK (hydration_status IN ('none', 'internal_db', 'analytic_file', 'pending_review', 'manual'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'budget_items' AND column_name = 'hydration_details') THEN
        ALTER TABLE public.budget_items 
        ADD COLUMN hydration_details jsonb DEFAULT '{}'::jsonb;
    END IF;
END $$;

-- 4. Hydration Queue / Issues Log
-- Stores items that failed auto-hydration or have low confidence, for user review.
CREATE TABLE IF NOT EXISTS public.import_hydration_issues (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Context
    job_id uuid NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
    budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
    budget_item_id uuid NOT NULL REFERENCES public.budget_items(id) ON DELETE CASCADE,
    
    -- Issue Details
    issue_type text NOT NULL CHECK (issue_type IN ('missing_composition', 'low_confidence', 'conflict', 'orphan_item')),
    severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'error')),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
    
    -- Snapshot of Data at Failure Time
    original_code text,
    original_description text,
    
    -- AI/System Suggestions
    suggestions jsonb DEFAULT '[]'::jsonb, -- Array of { source, code, score, reason }
    
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Indexes for Dashboard Filtering
CREATE INDEX IF NOT EXISTS idx_hydration_issues_budget ON public.import_hydration_issues(budget_id);
CREATE INDEX IF NOT EXISTS idx_hydration_issues_job ON public.import_hydration_issues(job_id);
CREATE INDEX IF NOT EXISTS idx_hydration_issues_status ON public.import_hydration_issues(status);

-- 5. Updated Finalization Log (Idempotency Control)
-- Ensures we can track exactly when/who finalized the job
CREATE TABLE IF NOT EXISTS public.import_finalization_runs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
    budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id),
    
    -- Run Parameters
    params_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, -- { uf, competence, bdi_mode, etc }
    
    -- Summary Stats
    total_items int DEFAULT 0,
    hydrated_internal int DEFAULT 0,
    hydrated_analytic int DEFAULT 0,
    pending_items int DEFAULT 0,
    
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_finalization_runs_job ON public.import_finalization_runs(job_id);

-- 6. Trigger to Update Timestamps on Issues
CREATE OR REPLACE FUNCTION update_hydration_issue_timestamp()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now(); 
   RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS tr_hydration_issue_updated ON public.import_hydration_issues;
CREATE TRIGGER tr_hydration_issue_updated
    BEFORE UPDATE ON public.import_hydration_issues
    FOR EACH ROW
    EXECUTE PROCEDURE update_hydration_issue_timestamp();
