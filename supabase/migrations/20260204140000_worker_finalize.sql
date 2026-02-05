-- Migration: Worker Finalize RPC (Robust/Dynamic Version)
-- Objective: Guarantee job finalization and lock release without hardcoding ENUM names.

create or replace function public.finalize_ocr_job(
  p_id uuid,
  p_status text,
  p_last_error text default null,
  p_retry_count int default null
) 
returns void
language plpgsql
security definer
as $$
declare
  v_enum_type text;
begin
  -- 1. Discover the actual type of the 'status' column dynamically
  select pg_typeof(status)::text into v_enum_type
  from public.import_ocr_jobs
  limit 1;

  -- Fallback if table is empty (unlikely during worker execution but for safety)
  if v_enum_type is null or v_enum_type = 'unknown' then
     v_enum_type := 'public.import_job_status'; -- Default fallback
  end if;

  -- 2. Execute dynamic update with safe casting
  execute format(
    'update public.import_ocr_jobs
     set status = %L::%s,
         locked_by = null,
         lock_expires_at = null,
         updated_at = now(),
         started_at = case when %L = ''pending'' then null else started_at end,
         completed_at = case when %L in (''completed'',''failed'') then now() else completed_at end,
         last_error = case when %L is not null then %L else last_error end,
         retry_count = case when %s is not null then %s else retry_count end
     where id = $1',
    p_status, v_enum_type,
    p_status,
    p_status,
    p_last_error, p_last_error,
    coalesce(p_retry_count::text, 'null'), coalesce(p_retry_count::text, 'null')
  ) using p_id;

end;
$$;
