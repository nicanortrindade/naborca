
-- Tabela de status e colunas de extração (Idempotente)

-- 1) Adicionar colunas de controle no job, se não existirem
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_jobs' AND column_name = 'stage') THEN
        ALTER TABLE public.import_jobs ADD COLUMN stage text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_jobs' AND column_name = 'stage_updated_at') THEN
        ALTER TABLE public.import_jobs ADD COLUMN stage_updated_at timestamptz DEFAULT now();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_jobs' AND column_name = 'last_error') THEN
        ALTER TABLE public.import_jobs ADD COLUMN last_error text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_jobs' AND column_name = 'heartbeat_at') THEN
        ALTER TABLE public.import_jobs ADD COLUMN heartbeat_at timestamptz;
    END IF;
END $$;

-- 2) Adicionar colunas de resultado no arquivo
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_files' AND column_name = 'extracted_json') THEN
        ALTER TABLE public.import_files ADD COLUMN extracted_json jsonb;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_files' AND column_name = 'extracted_json_schema_version') THEN
        ALTER TABLE public.import_files ADD COLUMN extracted_json_schema_version int DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_files' AND column_name = 'extracted_completed_at') THEN
        ALTER TABLE public.import_files ADD COLUMN extracted_completed_at timestamptz;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_files' AND column_name = 'extracted_started_at') THEN
        ALTER TABLE public.import_files ADD COLUMN extracted_started_at timestamptz;
    END IF;
END $$;

-- 3) Tabela de itens extraídos (Normalizada)
CREATE TABLE IF NOT EXISTS public.import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  import_file_id uuid NOT NULL REFERENCES public.import_files(id) ON DELETE CASCADE,

  idx int NOT NULL,
  description text NOT NULL,
  unit text,
  quantity numeric,
  unit_price numeric,
  total numeric,
  category text,
  raw_line text,
  confidence numeric,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_items_job_id_idx ON public.import_items(job_id);
CREATE INDEX IF NOT EXISTS import_items_import_file_id_idx ON public.import_items(import_file_id);

-- 4) Tabela de resumo (Summaries)
CREATE TABLE IF NOT EXISTS public.import_summaries (
  job_id uuid PRIMARY KEY REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  import_file_id uuid NOT NULL REFERENCES public.import_files(id) ON DELETE CASCADE,
  
  header jsonb,
  totals jsonb,
  notes text,
  items_count int,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Permissões básicas (ajuste conforme suas policies RLS e roles)
ALTER TABLE public.import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_summaries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Users can insert their own import items" ON public.import_items;
    CREATE POLICY "Users can insert their own import items" ON public.import_items FOR INSERT WITH CHECK (
        auth.uid() IN (SELECT user_id FROM public.import_jobs WHERE id = job_id)
    );

    DROP POLICY IF EXISTS "Users can view their own import items" ON public.import_items;
    CREATE POLICY "Users can view their own import items" ON public.import_items FOR SELECT USING (
        auth.uid() IN (SELECT user_id FROM public.import_jobs WHERE id = job_id)
    );

    DROP POLICY IF EXISTS "Users can delete their own import items" ON public.import_items;
    CREATE POLICY "Users can delete their own import items" ON public.import_items FOR DELETE USING (
        auth.uid() IN (SELECT user_id FROM public.import_jobs WHERE id = job_id)
    );

    DROP POLICY IF EXISTS "Users can insert their own import summaries" ON public.import_summaries;
    CREATE POLICY "Users can insert their own import summaries" ON public.import_summaries FOR INSERT WITH CHECK (
        auth.uid() IN (SELECT user_id FROM public.import_jobs WHERE id = job_id)
    );

    DROP POLICY IF EXISTS "Users can view their own import summaries" ON public.import_summaries;
    CREATE POLICY "Users can view their own import summaries" ON public.import_summaries FOR SELECT USING (
        auth.uid() IN (SELECT user_id FROM public.import_jobs WHERE id = job_id)
    );

    DROP POLICY IF EXISTS "Users can update their own import summaries" ON public.import_summaries;
    CREATE POLICY "Users can update their own import summaries" ON public.import_summaries FOR UPDATE USING (
        auth.uid() IN (SELECT user_id FROM public.import_jobs WHERE id = job_id)
    );
END $$;
