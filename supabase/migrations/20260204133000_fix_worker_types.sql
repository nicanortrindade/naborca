-- Migration: Fix Worker Type Error 42804
-- Objective: Allow ocr-worker to update statuses safely with implicit casting via RPC

create or replace function public.update_ocr_job_status(
    p_id uuid,
    p_status text,
    p_last_error text,
    p_retry_count int default null
)
returns void
language plpgsql
security definer
as $$
begin
    update public.import_ocr_jobs
    set 
        status = p_status::public.import_job_status, -- Explicit Cast to fix 42804
        last_error = p_last_error,
        retry_count = coalesce(p_retry_count, retry_count),
        updated_at = now(),
        
        -- Always release locks when worker updates via this RPC (failure/requeue paths)
        started_at = null,
        locked_by = null,
        lock_expires_at = null,
        
        -- Handle completed_at for terminal states
        completed_at = case 
            when p_status in ('failed', 'completed') then now() 
            else null 
        end
    where id = p_id;
end;
$$;
