
-- Migration: OCR Pipeline Checkpoints
-- Objective: Robust, incremental extraction with server-side checkpoints

-- 1. Create table import_ocr_jobs (Queue + Checkpoint)
-- Tracks processing state per file per job to allow resume/retry
create table if not exists public.import_ocr_jobs (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references public.import_jobs(id) on delete cascade,
    import_file_id uuid not null references public.import_files(id) on delete cascade,
    
    total_chunks int,                  -- Known after first analysis
    next_chunk_index int not null default 0,
    chunks_processed int not null default 0,
    
    status text not null default 'pending' check (status in ('pending','processing','completed','failed','cancelled')),
    
    priority int default 0,            -- Higher = processed first
    scheduled_for timestamptz default now(), -- For backoff/delays
    
    locked_by text,                    -- Worker ID
    lock_expires_at timestamptz,       -- Dead Man's Switch
    
    retry_count int default 0,
    max_retries int default 5,
    last_error text,
    
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    started_at timestamptz,
    completed_at timestamptz,
    
    unique(job_id, import_file_id)
);

-- Index for efficient claiming (Skip Locked)
create index if not exists idx_ocr_jobs_claimable 
on public.import_ocr_jobs(priority desc, created_at asc)
where status = 'pending';

-- 2. Idempotency Support in import_ai_items
-- Ensure we can restart a chunk without duplicating items
alter table public.import_ai_items add column if not exists import_file_id uuid references public.import_files(id) on delete cascade; -- Should already exist, ensuring
alter table public.import_ai_items add column if not exists chunk_index int;

-- Partial unique index to prevent duplicate insertions for a specific chunk retry
-- Note: 'idx' is the original sequential tool, but 'chunk_index' helps us nuke a whole chunk if needed
create unique index if not exists idx_ai_items_unique_chunk
on public.import_ai_items(job_id, import_file_id, chunk_index, idx)
where import_file_id is not null and chunk_index is not null;

-- 3. Optimization: RLS & Grants
alter table public.import_ocr_jobs enable row level security;

-- Policies (Service Role has full access bypass, but explicit policies if users scan own)
create policy "Users can view their own ocr jobs"
on public.import_ocr_jobs for select
using ( auth.uid() in (select user_id from public.import_jobs where id = job_id) );

-- 4. RPC Functions for Atomic Queue Operations

-- A. Claim Next Job
create or replace function public.claim_next_ocr_job(
    p_worker_id text,
    p_lock_duration_sec int default 60
)
returns setof public.import_ocr_jobs
language plpgsql
security definer
as $$
declare
    v_job_id uuid;
begin
    -- Find and lock candidate
    select id into v_job_id
    from public.import_ocr_jobs
    where status = 'pending' 
      and (scheduled_for is null or scheduled_for <= now())
    order by priority desc, created_at asc
    limit 1
    for update skip locked;

    if v_job_id is not null then
        return query
        update public.import_ocr_jobs
        set 
            status = 'processing',
            locked_by = p_worker_id,
            lock_expires_at = now() + (p_lock_duration_sec || ' seconds')::interval,
            started_at = coalesce(started_at, now()),
            updated_at = now()
        where id = v_job_id
        returning *;
    end if;
end;
$$;

-- B. Save Chunk & Progress
-- Upserts items and advances checkpointer atomically
create or replace function public.save_chunk_progress(
    p_ocr_job_id uuid,
    p_chunk_index int,
    p_total_chunks int,
    p_is_final boolean
)
returns void
language plpgsql
security definer
as $$
begin
    update public.import_ocr_jobs
    set
        next_chunk_index = greatest(next_chunk_index, p_chunk_index + 1),
        chunks_processed = greatest(chunks_processed, p_chunk_index + 1),
        total_chunks = coalesce(total_chunks, p_total_chunks),
        status = case when p_is_final then 'completed' else 'processing' end,
        completed_at = case when p_is_final then now() else completed_at end,
        lock_expires_at = now() + interval '60 seconds', -- Extend lock while active
        updated_at = now()
    where id = p_ocr_job_id;
end;
$$;

-- C. Recover Stale Locks
create or replace function public.recover_stale_ocr_locks()
returns int
language plpgsql
security definer
as $$
declare
    v_count int;
begin
    -- Fail jobs that exceeded retries or just reset them?
    -- Logic: If retry < max, reset to pending. Else fail.
    
    with released as (
        update public.import_ocr_jobs
        set
            status = case when retry_count < max_retries then 'pending' else 'failed' end,
            retry_count = retry_count + 1,
            last_error = case when retry_count < max_retries then 'Timeout (Lock Expired)' else 'Failed: Max Retries (Lock Expired)' end,
            locked_by = null,
            lock_expires_at = null,
            scheduled_for = now() + interval '10 seconds' * (retry_count + 1) -- Backoff
        where status = 'processing' 
          and lock_expires_at < now()
        returning id
    )
    select count(*) into v_count from released;

    return v_count;
end;
$$;
