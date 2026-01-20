-- =====================================================
-- SINAPI SECURE INGESTION RPC
-- =====================================================
-- Funções de ingestão segura (SECURITY DEFINER) para contornar RLS
-- Permitem que administradores importem dados sem expor as tabelas para escrita pública
-- =====================================================

-- 1. Ingestão de Referência (Preço da Planilha)
-- ATUALIZADO: p_source e p_competencia para match com TypeScript
CREATE OR REPLACE FUNCTION ingest_sinapi_price_table(
    p_source TEXT,
    p_uf TEXT,
    p_competencia TEXT,
    p_regime TEXT,
    p_is_mock BOOLEAN DEFAULT false
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO sinapi_price_tables (source, uf, competence, regime, is_mock)
    VALUES (p_source, p_uf, p_competencia, p_regime, p_is_mock)
    ON CONFLICT (source, uf, competence, regime) 
    DO UPDATE SET updated_at = NOW()
    RETURNING id INTO v_id;
    
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Ingestão de Lote de Insumos
CREATE OR REPLACE FUNCTION ingest_sinapi_inputs_batch(
    p_inputs JSONB
) RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    -- Inserir insumos (Ignora se já existir)
    WITH data AS (
        SELECT 
            (value->>'code') as code,
            (value->>'description') as description,
            (value->>'unit') as unit
        FROM jsonb_array_elements(p_inputs)
    )
    INSERT INTO sinapi_inputs (code, description, unit, source)
    SELECT code, description, unit, 'SINAPI'
    FROM data
    ON CONFLICT (source, code) 
    DO UPDATE SET 
        description = EXCLUDED.description,
        unit = EXCLUDED.unit,
        updated_at = NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Ingestão de Preços de Insumos
CREATE OR REPLACE FUNCTION ingest_sinapi_input_prices_batch(
    p_price_table_id UUID,
    p_prices JSONB
) RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    WITH data AS (
        SELECT 
            (value->>'code') as code,
            (value->>'price')::numeric as price
        FROM jsonb_array_elements(p_prices)
    )
    INSERT INTO sinapi_input_prices (price_table_id, input_code, price)
    SELECT p_price_table_id, code, price
    FROM data
    ON CONFLICT (price_table_id, input_code) 
    DO UPDATE SET price = EXCLUDED.price;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Ingestão de Composições
CREATE OR REPLACE FUNCTION ingest_sinapi_compositions_batch(
    p_compositions JSONB
) RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    WITH data AS (
        SELECT 
            (value->>'code') as code,
            (value->>'description') as description,
            (value->>'unit') as unit,
            (value->>'type') as composition_type
        FROM jsonb_array_elements(p_compositions)
    )
    INSERT INTO sinapi_compositions (code, description, unit, composition_type, source)
    SELECT code, description, unit, composition_type, 'SINAPI'
    FROM data
    ON CONFLICT (source, code) 
    DO UPDATE SET 
        description = EXCLUDED.description,
        unit = EXCLUDED.unit,
        composition_type = EXCLUDED.composition_type,
        updated_at = NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Ingestão de Preços de Composições
CREATE OR REPLACE FUNCTION ingest_sinapi_composition_prices_batch(
    p_price_table_id UUID,
    p_prices JSONB
) RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    WITH data AS (
        SELECT 
            (value->>'code') as code,
            (value->>'price')::numeric as price
        FROM jsonb_array_elements(p_prices)
    )
    INSERT INTO sinapi_composition_prices (price_table_id, composition_code, price)
    SELECT p_price_table_id, code, price
    FROM data
    ON CONFLICT (price_table_id, composition_code) 
    DO UPDATE SET price = EXCLUDED.price;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Ingestão de Itens de Composição
CREATE OR REPLACE FUNCTION ingest_sinapi_composition_items_batch(
    p_price_table_id UUID,
    p_items JSONB
) RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    -- Nota: Itens de composição às vezes dependem da tabela de preço (se o arquivo variar)
    -- Mas geralmente a estrutura analítica é estável. 
    -- Se a tabela analítica for única por referência, podemos ignorar price_table_id na constraint?
    -- No modelo atual: sinapi_composition_items tem price_table_id. Então é específico da tabela (referência).
    
    WITH data AS (
        SELECT 
            (value->>'composition_code') as comp_code,
            (value->>'item_type') as item_type,
            (value->>'item_code') as item_code,
            (value->>'coefficient')::numeric as coef,
            (value->>'unit') as unit
        FROM jsonb_array_elements(p_items)
    )
    INSERT INTO sinapi_composition_items (price_table_id, composition_code, item_type, item_code, coefficient, unit)
    SELECT p_price_table_id, comp_code, item_type, item_code, coef, unit
    FROM data
    ON CONFLICT (price_table_id, composition_code, item_type, item_code) 
    DO UPDATE SET 
        coefficient = EXCLUDED.coefficient,
        unit = EXCLUDED.unit;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permissões para autenticados executarem as funções
GRANT EXECUTE ON FUNCTION ingest_sinapi_price_table TO authenticated;
GRANT EXECUTE ON FUNCTION ingest_sinapi_inputs_batch TO authenticated;
GRANT EXECUTE ON FUNCTION ingest_sinapi_input_prices_batch TO authenticated;
GRANT EXECUTE ON FUNCTION ingest_sinapi_compositions_batch TO authenticated;
GRANT EXECUTE ON FUNCTION ingest_sinapi_composition_prices_batch TO authenticated;
GRANT EXECUTE ON FUNCTION ingest_sinapi_composition_items_batch TO authenticated;
