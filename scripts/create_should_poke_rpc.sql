
create or replace function public.should_poke_ocr_worker(p_cap int default 2)
returns boolean
language plpgsql
security definer
as $$
declare
    v_processing int;
    v_pending int;
begin
    -- 1. Check Capacity (Active Processing)
    select count(*) into v_processing
    from public.import_ocr_jobs
    where status = 'processing' 
      and lock_expires_at > now();
    
    if v_processing >= p_cap then
        return false; -- Cap reached, do not poke
    end if;

    -- 2. Check Eligible Pending Jobs
    select 1 into v_pending
    from public.import_ocr_jobs
    where status = 'pending'
      and (scheduled_for is null or scheduled_for <= now())
      and retry_count < coalesce(max_retries, 5)
    limit 1;

    return v_pending is not null;
end;
$$;
