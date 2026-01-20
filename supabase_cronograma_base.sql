-- ==========================================
-- VIEW: cronograma_base
-- ==========================================
-- View para o cronograma físico-financeiro
-- Usa total_price (sem BDI) como valor base
-- Filtra por budget_id automaticamente via RLS

CREATE OR REPLACE VIEW cronograma_base AS
SELECT 
    bi.id,
    bi.budget_id,
    bi.parent_id,
    bi.order_index,
    bi.level,
    bi.item_number,
    bi.code,
    bi.description,
    bi.unit,
    bi.quantity,
    bi.unit_price,
    bi.total_price,
    bi.type,
    bi.source,
    bi.user_id,
    -- Hierarquia para ordenação
    COALESCE(
        (SELECT item_number FROM budget_items p1 WHERE p1.id = bi.parent_id),
        bi.item_number
    ) AS etapa_number,
    -- Peso relativo dentro do orçamento (sem BDI)
    CASE 
        WHEN b.total_value > 0 THEN 
            ROUND((COALESCE(bi.total_price, 0) / b.total_value) * 100, 4)
        ELSE 0
    END AS peso
FROM budget_items bi
LEFT JOIN budgets b ON b.id = bi.budget_id
WHERE bi.total_price IS NOT NULL AND bi.total_price > 0
ORDER BY bi.level, bi.order_index;

-- Grant access
GRANT SELECT ON cronograma_base TO authenticated;
