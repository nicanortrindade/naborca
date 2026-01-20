-- =====================================================
-- SINAPI BATCH RPCs - VERSÃO CORRIGIDA
-- Retornam INTEGER em vez de VOID para corrigir contagem
-- =====================================================

-- 1. DROP das funções existentes (evitar erro 42P13)
DROP FUNCTION IF EXISTS public.ingest_sinapi_input_prices_batch(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ingest_sinapi_composition_prices_batch(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ingest_sinapi_compositions_batch(jsonb);
DROP FUNCTION IF EXISTS public.ingest_sinapi_composition_items_batch(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ingest_sinapi_inputs_batch(jsonb);

-- 2. Input Prices Batch - RETORNA INTEGER
CREATE OR REPLACE FUNCTION public.ingest_sinapi_input_prices_batch(
    p_price_table_id uuid,
    p_prices jsonb
) RETURNS integer AS $$
DECLARE
    v_count integer := 0;
BEGIN
    -- Parse JSONB array e inserir/atualizar
    WITH data AS (
        SELECT 
            (value->>'code')::text as input_code,
            (value->>'price')::numeric as price
        FROM jsonb_array_elements(p_prices)
    )
    INSERT INTO public.sinapi_input_prices (price_table_id, input_code, price)
    SELECT p_price_table_id, input_code, price
    FROM data
    WHERE input_code IS NOT NULL AND price IS NOT NULL
    ON CONFLICT (price_table_id, input_code) 
    DO UPDATE SET 
        price = EXCLUDED.price,
        updated_at = NOW();
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. Composition Prices Batch - RETORNA INTEGER
CREATE OR REPLACE FUNCTION public.ingest_sinapi_composition_prices_batch(
    p_price_table_id uuid,
    p_prices jsonb
) RETURNS integer AS $$
DECLARE
    v_count integer := 0;
BEGIN
    WITH data AS (
        SELECT 
            (value->>'code')::text as composition_code,
            (value->>'price')::numeric as price
        FROM jsonb_array_elements(p_prices)
    )
    INSERT INTO public.sinapi_composition_prices (price_table_id, composition_code, price)
    SELECT p_price_table_id, composition_code, price
    FROM data
    WHERE composition_code IS NOT NULL AND price IS NOT NULL
    ON CONFLICT (price_table_id, composition_code) 
    DO UPDATE SET 
        price = EXCLUDED.price,
        updated_at = NOW();
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. Compositions Batch - RETORNA INTEGER
CREATE OR REPLACE FUNCTION public.ingest_sinapi_compositions_batch(
    p_compositions jsonb
) RETURNS integer AS $$
DECLARE
    v_count integer := 0;
BEGIN
    WITH data AS (
        SELECT 
            (value->>'code')::text as code,
            (value->>'description')::text as description,
            (value->>'unit')::text as unit,
            COALESCE((value->>'composition_type')::text, 'CPU') as composition_type
        FROM jsonb_array_elements(p_compositions)
    )
    INSERT INTO public.sinapi_compositions (source, code, description, unit, composition_type, active)
    SELECT 'SINAPI', code, description, unit, composition_type, true
    FROM data
    WHERE code IS NOT NULL
    ON CONFLICT (source, code) 
    DO UPDATE SET 
        description = EXCLUDED.description,
        unit = EXCLUDED.unit,
        composition_type = EXCLUDED.composition_type,
        updated_at = NOW();
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Composition Items Batch - RETORNA INTEGER
CREATE OR REPLACE FUNCTION public.ingest_sinapi_composition_items_batch(
    p_price_table_id uuid,
    p_items jsonb
) RETURNS integer AS $$
DECLARE
    v_count integer := 0;
BEGIN
    WITH data AS (
        SELECT 
            (value->>'composition_code')::text as composition_code,
            (value->>'item_type')::text as item_type,
            (value->>'item_code')::text as item_code,
            (value->>'coefficient')::numeric as coefficient,
            (value->>'unit')::text as unit
        FROM jsonb_array_elements(p_items)
    )
    INSERT INTO public.sinapi_composition_items (
        price_table_id, 
        composition_code, 
        item_type, 
        item_code, 
        coefficient, 
        unit
    )
    SELECT 
        p_price_table_id, 
        composition_code, 
        item_type, 
        item_code, 
        coefficient, 
        unit
    FROM data
    WHERE composition_code IS NOT NULL 
      AND item_code IS NOT NULL 
      AND coefficient IS NOT NULL
    ON CONFLICT (price_table_id, composition_code, item_type, item_code) 
    DO UPDATE SET 
        coefficient = EXCLUDED.coefficient,
        unit = EXCLUDED.unit,
        updated_at = NOW();
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6. Inputs Batch - RETORNA INTEGER
CREATE OR REPLACE FUNCTION public.ingest_sinapi_inputs_batch(
    p_inputs jsonb
) RETURNS integer AS $$
DECLARE
    v_count integer := 0;
BEGIN
    WITH data AS (
        SELECT 
            (value->>'code')::text as code,
            (value->>'description')::text as description,
            (value->>'unit')::text as unit,
            (value->>'category')::text as category
        FROM jsonb_array_elements(p_inputs)
    )
    INSERT INTO public.sinapi_inputs (source, code, description, unit, category, active)
    SELECT 'SINAPI', code, description, unit, category, true
    FROM data
    WHERE code IS NOT NULL
    ON CONFLICT (source, code) 
    DO UPDATE SET 
        description = EXCLUDED.description,
        unit = EXCLUDED.unit,
        category = EXCLUDED.category,
        updated_at = NOW();
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 7. GRANT permissions
GRANT EXECUTE ON FUNCTION public.ingest_sinapi_input_prices_batch TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_sinapi_composition_prices_batch TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_sinapi_compositions_batch TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_sinapi_composition_items_batch TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_sinapi_inputs_batch TO authenticated;

-- Opcional: GRANT para anon (se necessário durante testes)
-- GRANT EXECUTE ON FUNCTION public.ingest_sinapi_input_prices_batch TO anon;
-- GRANT EXECUTE ON FUNCTION public.ingest_sinapi_composition_prices_batch TO anon;
-- GRANT EXECUTE ON FUNCTION public.ingest_sinapi_compositions_batch TO anon;
-- GRANT EXECUTE ON FUNCTION public.ingest_sinapi_composition_items_batch TO anon;
-- GRANT EXECUTE ON FUNCTION public.ingest_sinapi_inputs_batch TO anon;

-- =====================================================
-- VERIFICAÇÃO (opcional - rode para confirmar)
-- =====================================================
-- SELECT routine_name, data_type 
-- FROM information_schema.routines 
-- WHERE routine_schema = 'public' 
--   AND routine_name LIKE 'ingest_sinapi%'
-- ORDER BY routine_name;
