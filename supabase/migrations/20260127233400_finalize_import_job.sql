create or replace function public.finalize_import_job(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
set row_security to off
as $function$
declare
  v_budget_id uuid;
  v_user_id uuid;
  v_has_items boolean;
begin
  perform pg_advisory_xact_lock(hashtext('finalize_import_job:' || p_job_id::text));

  select user_id, result_budget_id
    into v_user_id, v_budget_id
  from public.import_jobs
  where id = p_job_id
  for update;

  if v_user_id is null then
    raise exception 'import_job % não encontrado ou sem user_id', p_job_id;
  end if;

  if v_budget_id is not null then
    update public.import_jobs
    set status = 'done',
        updated_at = now()
    where id = p_job_id;
    return v_budget_id;
  end if;

  select exists (
    select 1
    from public.import_ai_items
    where job_id = p_job_id
    limit 1
  ) into v_has_items;

  if not v_has_items then
    raise exception 'import_job % sem itens em import_ai_items (não finaliza)', p_job_id;
  end if;

  insert into public.budgets (user_id, name, created_at, updated_at)
  values (v_user_id, 'Importação IA - ' || p_job_id::text, now(), now())
  returning id into v_budget_id;

  with base as (
    select
      v_budget_id as budget_id,
      v_user_id as user_id,
      coalesce(
        (select max(order_index) from public.budget_items bi where bi.budget_id = v_budget_id),
        -1
      ) as last_idx
  ),
  to_insert as (
    select
      base.user_id,
      base.budget_id,
      (base.last_idx + row_number() over (order by i.created_at, i.idx))::integer as order_index,
      1 as level,
      i.description,
      i.unit,
      i.quantity,
      i.unit_price,
      i.total as total_price
    from public.import_ai_items i
    cross join base
    where i.job_id = p_job_id
  )
  insert into public.budget_items (
    user_id,
    budget_id,
    order_index,
    level,
    description,
    unit,
    quantity,
    unit_price,
    total_price,
    created_at,
    updated_at
  )
  select
    user_id,
    budget_id,
    order_index,
    level,
    description,
    unit,
    quantity,
    unit_price,
    total_price,
    now(),
    now()
  from to_insert;

  update public.import_jobs
  set
    status = 'done',
    result_budget_id = v_budget_id,
    last_error = null,
    updated_at = now()
  where id = p_job_id;

  return v_budget_id;
end;
$function$;
