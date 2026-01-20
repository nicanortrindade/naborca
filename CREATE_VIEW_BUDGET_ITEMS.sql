-- View hierárquica para itens de orçamento
-- Garante a ordem correta (Etapa -> Subetapa -> Item) e define row_type
-- ordenação via Recursive Common Table Expression (CTE)

CREATE OR REPLACE VIEW budget_items_view AS
WITH RECURSIVE hierarchy AS (
    -- Nível 1: Etapas (raízes)
    SELECT 
        bi.*,
        'etapa' as row_type,
        -- Cria um caminho de ordenação: 0001 (assumindo order_index numérico)
        LPAD(bi.order_index::text, 5, '0') as sort_path
    FROM budget_items bi
    WHERE bi.level = 1 
    -- Assumindo que Nível 1 não tem parent_id (ou ignoramos se tiver, pois é raiz visual)
    -- Se level 1 tiver parent, ajustar conforme regra de negócio. O user disse "parent_id (null para nível 1)"

    UNION ALL

    -- Níveis inferiores (Filhos)
    SELECT 
        child.*,
        CASE 
            WHEN child.level = 2 THEN 'subetapa'
            ELSE 'item'
        END as row_type,
        -- Concatena o caminho do pai com o indice do filho: 0001.0002
        parent.sort_path || '.' || LPAD(child.order_index::text, 5, '0') as sort_path
    FROM budget_items child
    INNER JOIN hierarchy parent ON child.parent_id = parent.id
)
SELECT 
    id,
    user_id,
    budget_id,
    parent_id,
    order_index,
    level,
    item_number,
    code,
    description,
    unit,
    quantity,
    unit_price,
    final_price,
    total_price,
    type,
    source,
    item_type,
    composition_id,
    insumo_id,
    calculation_memory,
    calculation_steps,
    custom_bdi,
    cost_center,
    is_locked,
    notes,
    is_desonerated,
    created_at,
    updated_at,
    row_type,
    sort_path -- Útil para debug, usado no ORDER BY
FROM hierarchy
ORDER BY sort_path;
