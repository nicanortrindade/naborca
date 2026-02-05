-- Migration: Fix Import Job Status Consistency
-- Objective: Ensure finalize_import_to_budget sets status = 'done', clears errors, and handles idempotency.
create or replace function finalize_import_to_budget(
        p_job_id uuid,
        p_user_id uuid,
        p_params jsonb,
        p_analytic_data jsonb default '{}'::jsonb
    ) returns jsonb language plpgsql security definer as $$
declare v_job record;
v_budget_id uuid;
v_item record;
v_total_items int := 0;
v_processed_items int := 0;
v_source_item_id uuid;
v_budget_item_id uuid;
begin -- 1. Validate Job
select * into v_job
from import_jobs
where id = p_job_id;
if not found then return jsonb_build_object('ok', false, 'error', 'job_not_found');
end if;
-- 2. Idempotency Check (If already has a budget, just return it)
if v_job.result_budget_id is not null then -- Check if we should update status just in case it was left in 'processing'
if v_job.status <> 'done' then
update import_jobs
set status = 'done',
    last_error = null,
    document_context = document_context - 'user_action'
where id = p_job_id;
end if;
return jsonb_build_object(
    'ok',
    true,
    'budget_id',
    v_job.result_budget_id,
    'message',
    'already_finalized_idempotent'
);
end if;
-- 3. Create Budget (if one doesn't exist for this job)
-- Logic to reuse existing logic if needed, but here we create fresh or link
-- For this specific RPC, we usually create a NEW budget.
insert into budgets (
        user_id,
        name,
        status,
        created_at,
        updated_at,
        settings -- Assuming settings column exists or defaults
    )
values (
        p_user_id,
        'Orçamento Importado ' || to_char(now(), 'DD/MM/YYYY HH24:MI'),
        'draft',
        -- Start as draft
        now(),
        now(),
        p_params -- store params in settings/metadata if needed
    )
returning id into v_budget_id;
-- 4. Hydrate Items (Transfer import_items -> budget_items)
-- Use loop or bulk insert. Loop allows logic per item.
for v_item in
select *
from import_items
where job_id = p_job_id
order by idx asc loop v_total_items := v_total_items + 1;
-- Insert budget item
insert into budget_items (
        budget_id,
        description,
        unit,
        quantity,
        unit_price,
        total,
        source_import_item_id -- traceability
    )
values (
        v_budget_id,
        v_item.description,
        v_item.unit,
        v_item.quantity,
        v_item.unit_price,
        v_item.total,
        v_item.id
    )
returning id into v_budget_item_id;
if v_budget_item_id is not null then v_processed_items := v_processed_items + 1;
end if;
end loop;
-- 5. Update Job (Final Commit)
update import_jobs
set result_budget_id = v_budget_id,
    status = 'done',
    -- CRITICAL FIX: Explicitly set done
    stage = 'finalized',
    progress = 100,
    last_error = null,
    -- Clear any previous errors
    document_context = document_context - 'user_action',
    -- Remove user action required
    updated_at = now()
where id = p_job_id;
return jsonb_build_object(
    'ok',
    true,
    'budget_id',
    v_budget_id,
    'items_processed',
    v_processed_items,
    'total_items',
    v_total_items
);
exception
when others then return jsonb_build_object('ok', false, 'error', SQLERRM);
end;
$$;