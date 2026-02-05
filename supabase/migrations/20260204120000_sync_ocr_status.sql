-- Migration: Sync Import Job Status from OCR Pipeline
-- Objective: Ensure import_jobs (Parent) reflects the state of import_ocr_jobs (Children)

create or replace function public.sync_import_job_from_ocr(p_job_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_total int;
    v_pending int;
    v_processing int;
    v_completed int;
    v_failed int;
    v_new_status text;
    v_current_status text;
    v_result jsonb;
begin
    -- 1. Get stats from children (OCR Jobs)
    select 
        count(*),
        count(*) filter (where status = 'pending'),
        count(*) filter (where status = 'processing'),
        count(*) filter (where status = 'completed'),
        count(*) filter (where status = 'failed')
    into v_total, v_pending, v_processing, v_completed, v_failed
    from public.import_ocr_jobs
    where job_id = p_job_id;

    -- 2. Determine Parent Status
    -- Note: We prioritize 'processing' if anything is moving.
    -- If everything is completed, we mark done.
    -- If everything failed (and count > 0), we mark failed.
    
    if v_total = 0 then
        -- No OCR jobs found? Maybe it's a fresh job or not using OCR.
        -- Do not touch status.
        return jsonb_build_object('job_id', p_job_id, 'action', 'none', 'reason', 'no_ocr_jobs');
    end if;

    if v_processing > 0 or v_pending > 0 then
        v_new_status := 'processing';
    elsif v_completed = v_total then
        v_new_status := 'done';
    elsif v_failed = v_total then
        v_new_status := 'failed';
    else
        -- Mixed state (some completed, some failed, none pending/processing)
        -- Treat as done (partial success) or failed? 
        -- Usually we treating as done with errors is safer for UI not to lock indefinitely.
        -- But let's check if AT LEAST ONE completed.
        if v_completed > 0 then
            v_new_status := 'done'; -- Partial success
        else
            v_new_status := 'failed'; -- specific logic?
        end if;
    end if;

    -- 3. Update Parent (if changed)
    select status into v_current_status from public.import_jobs where id = p_job_id;

    if v_current_status is distinct from v_new_status then
        -- Don't overwrite if already 'done' and we think it's 'processing' (race condition safety?)
        -- Actually, sync should be authoritative. But let's be careful about reverting 'done' to 'processing' if that happens.
        -- IF current is done, only reverting if we really found pending items (restart).
        
        update public.import_jobs
        set 
            status = v_new_status::public.import_job_status,
            updated_at = now(),
            -- Clear error if moving to processing? Or keep history? Keep history.
            last_error = case when v_new_status = 'processing' then null else last_error end
        where id = p_job_id;
        
        v_result := jsonb_build_object(
            'job_id', p_job_id, 
            'old_status', v_current_status, 
            'new_status', v_new_status,
            'stats', jsonb_build_object(
                'total', v_total,
                'pending', v_pending, 
                'processing', v_processing,
                'completed', v_completed,
                'failed', v_failed
            )
        );
    else
        v_result := jsonb_build_object('job_id', p_job_id, 'status', v_current_status, 'action', 'unchanged');
    end if;

    return v_result;
end;
$$;
