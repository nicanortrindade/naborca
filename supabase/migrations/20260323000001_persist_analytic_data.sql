CREATE OR REPLACE FUNCTION persist_analytic_data(
    p_budget_id UUID,
    p_user_id UUID,
    p_analytic_data JSONB
) RETURNS INTEGER AS $$
DECLARE
    v_comp RECORD;
    v_item RECORD;
    v_budget_item_id UUID;
    v_count INTEGER := 0;
    v_comp_code TEXT;
BEGIN
    FOR v_comp IN SELECT key AS comp_key, value AS comp_data FROM jsonb_each(p_analytic_data)
    LOOP
        -- 1ª tentativa: busca por path_key (chave é o item_path ex: '1.1.1')
        SELECT id INTO v_budget_item_id
        FROM budget_items
        WHERE budget_id = p_budget_id
          AND path_key = v_comp.comp_key
        LIMIT 1;

        -- 2ª tentativa (fallback): busca por code (chave é o código ex: '88247')
        IF v_budget_item_id IS NULL THEN
            v_comp_code := v_comp.comp_data->>'code';
            IF v_comp_code IS NOT NULL AND v_comp_code != '' THEN
                SELECT id INTO v_budget_item_id
                FROM budget_items
                WHERE budget_id = p_budget_id
                  AND (
                      code = v_comp_code
                      OR code = REPLACE(v_comp_code, ' ', '')
                  )
                LIMIT 1;
            END IF;
        END IF;

        IF v_budget_item_id IS NULL THEN
            CONTINUE;
        END IF;

        DELETE FROM budget_item_compositions
        WHERE budget_item_id = v_budget_item_id;

        FOR v_item IN SELECT * FROM jsonb_array_elements(v_comp.comp_data->'items')
        LOOP
            INSERT INTO budget_item_compositions (
                budget_item_id, user_id, description, unit, quantity,
                unit_price, total_price, metadata
            ) VALUES (
                v_budget_item_id,
                p_user_id,
                v_item.value->>'description',
                v_item.value->>'unit',
                COALESCE((v_item.value->>'coefficient')::numeric, 0),
                COALESCE((v_item.value->>'price')::numeric, 0),
                ROUND(COALESCE((v_item.value->>'coefficient')::numeric, 0) * COALESCE((v_item.value->>'price')::numeric, 0), 2),
                jsonb_build_object(
                    'code', v_item.value->>'code',
                    'type', v_item.value->>'type',
                    'source', CASE
                        WHEN v_item.value->>'code' ~ '^\d{5,6}$' THEN 'SINAPI'
                        ELSE 'Próprio'
                    END,
                    'original_comp_key', v_comp.comp_key,
                    'original_comp_code', v_comp.comp_data->>'code'
                )
            );
            v_count := v_count + 1;
        END LOOP;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
