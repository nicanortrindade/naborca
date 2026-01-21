DROP FUNCTION IF EXISTS reorder_budget_items(jsonb);

CREATE FUNCTION reorder_budget_items(items jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET row_security = off
SET search_path = public
AS $$
DECLARE
  item jsonb;
  affected int;
BEGIN
  FOR item IN
    SELECT * FROM jsonb_array_elements(items)
  LOOP
    UPDATE budget_items
    SET
      order_index = (item->>'order')::int,
      parent_id = NULLIF(item->>'parentId', '')::uuid,
      item_number = item->>'itemNumber'
    WHERE id = (item->>'id')::uuid
      AND user_id = auth.uid();

    GET DIAGNOSTICS affected = ROW_COUNT;

    IF affected = 0 THEN
      RAISE EXCEPTION
        'RPC reorder_budget_items: sem permissão ou item inexistente (id=%)',
        item->>'id';
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION reorder_budget_items(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION reorder_budget_items(jsonb) TO authenticated;
