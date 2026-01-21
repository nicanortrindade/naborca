create or replace function reorder_budget_items(items jsonb)
returns void
language plpgsql
security definer
as $$
declare
  item jsonb;
begin
  -- Iterate through the array of items provided in the JSON payload
  for item in select * from jsonb_array_elements(items)
  loop
    update budget_items
    set 
      order_index = (item->>'order')::int,
      parent_id = (item->>'parentId')::uuid,
      item_number = (item->>'itemNumber')
    where id = (item->>'id')::uuid;
  end loop;
end;
$$;
