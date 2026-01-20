-- =====================================================
-- CLEANUP MOCK SINAPI - SCRIPT DE LIMPEZA
-- =====================================================
-- ⚠️ ATENÇÃO: EXECUTE SOMENTE APÓS VALIDAR BASE BA/2025
-- Este script remove permanentemente todas as bases marcadas como MOCK
-- =====================================================

-- PRIMEIRO: Verificar o que será deletado (SEMPRE rodar antes do DELETE)
SELECT 
    spt.id,
    spt.source,
    spt.uf,
    spt.competence,
    spt.regime,
    spt.is_mock,
    spt.source_tag,
    (SELECT COUNT(*) FROM sinapi_input_prices WHERE price_table_id = spt.id) as input_prices_count,
    (SELECT COUNT(*) FROM sinapi_composition_prices WHERE price_table_id = spt.id) as comp_prices_count,
    (SELECT COUNT(*) FROM sinapi_composition_items WHERE price_table_id = spt.id) as comp_items_count
FROM sinapi_price_tables spt
WHERE spt.is_mock = TRUE OR spt.source_tag = 'MOCK' OR spt.source_tag = 'LEGACY';

-- =====================================================
-- DELETAR DADOS MOCK (CASCADED)
-- =====================================================
-- DESCOMENTE AS LINHAS ABAIXO QUANDO ESTIVER PRONTO PARA LIMPAR

/*
-- 1. Deletar preços de insumos vinculados a tabelas mock
DELETE FROM sinapi_input_prices 
WHERE price_table_id IN (
    SELECT id FROM sinapi_price_tables 
    WHERE is_mock = TRUE OR source_tag IN ('MOCK', 'LEGACY')
);

-- 2. Deletar preços de composições vinculados a tabelas mock
DELETE FROM sinapi_composition_prices 
WHERE price_table_id IN (
    SELECT id FROM sinapi_price_tables 
    WHERE is_mock = TRUE OR source_tag IN ('MOCK', 'LEGACY')
);

-- 3. Deletar itens de composições vinculados a tabelas mock
DELETE FROM sinapi_composition_items 
WHERE price_table_id IN (
    SELECT id FROM sinapi_price_tables 
    WHERE is_mock = TRUE OR source_tag IN ('MOCK', 'LEGACY')
);

-- 4. Deletar as tabelas de preço mock
DELETE FROM sinapi_price_tables 
WHERE is_mock = TRUE OR source_tag IN ('MOCK', 'LEGACY');

-- 5. (OPCIONAL) Remover insumos e composições órfãos
-- Insumos que não têm mais preço em nenhuma tabela
DELETE FROM sinapi_inputs si
WHERE NOT EXISTS (
    SELECT 1 FROM sinapi_input_prices sip WHERE sip.input_code = si.code
);

-- Composições que não têm mais preço em nenhuma tabela
DELETE FROM sinapi_compositions sc
WHERE NOT EXISTS (
    SELECT 1 FROM sinapi_composition_prices scp WHERE scp.composition_code = sc.code
);
*/

-- =====================================================
-- VERIFICAÇÃO PÓS-LIMPEZA
-- =====================================================

SELECT 
    'sinapi_price_tables' as tabela, 
    COUNT(*) as total,
    SUM(CASE WHEN is_mock = TRUE THEN 1 ELSE 0 END) as mocks
FROM sinapi_price_tables

UNION ALL

SELECT 'sinapi_inputs', COUNT(*), 0 FROM sinapi_inputs

UNION ALL

SELECT 'sinapi_compositions', COUNT(*), 0 FROM sinapi_compositions;
