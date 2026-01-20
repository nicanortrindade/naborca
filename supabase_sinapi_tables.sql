-- =====================================================
-- SINAPI DATA MODEL - TABELAS PARA BASE DE REFERÊNCIA
-- =====================================================
-- Execute este script no SQL Editor do Supabase
-- Estas tabelas armazenam a base SINAPI oficial (CAIXA)
-- Os dados são PÚBLICOS (leitura para todos os usuários autenticados)
-- =====================================================

-- =====================================================
-- A) SINAPI_PRICE_TABLES (Tabelas de Preço por Competência)
-- =====================================================

CREATE TABLE IF NOT EXISTS sinapi_price_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL DEFAULT 'SINAPI',
    uf TEXT NOT NULL,
    competence TEXT NOT NULL, -- YYYY-MM
    regime TEXT NOT NULL CHECK (regime IN ('DESONERADO', 'NAO_DESONERADO')),
    file_urls JSONB, -- URLs dos arquivos originais baixados
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_price_table UNIQUE (source, uf, competence, regime)
);

CREATE INDEX IF NOT EXISTS idx_sinapi_price_tables_uf ON sinapi_price_tables(uf);
CREATE INDEX IF NOT EXISTS idx_sinapi_price_tables_competence ON sinapi_price_tables(competence);
CREATE INDEX IF NOT EXISTS idx_sinapi_price_tables_regime ON sinapi_price_tables(regime);

-- =====================================================
-- B) SINAPI_INPUTS (Insumos Base - Cadastro Único)
-- =====================================================

CREATE TABLE IF NOT EXISTS sinapi_inputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL DEFAULT 'SINAPI',
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT,
    category TEXT,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_sinapi_input UNIQUE (source, code)
);

CREATE INDEX IF NOT EXISTS idx_sinapi_inputs_code ON sinapi_inputs(code);
CREATE INDEX IF NOT EXISTS idx_sinapi_inputs_description ON sinapi_inputs USING gin(to_tsvector('portuguese', description));

-- =====================================================
-- C) SINAPI_INPUT_PRICES (Preço do Insumo por Tabela)
-- =====================================================

CREATE TABLE IF NOT EXISTS sinapi_input_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_table_id UUID NOT NULL REFERENCES sinapi_price_tables(id) ON DELETE CASCADE,
    input_code TEXT NOT NULL,
    price DECIMAL(15, 4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_input_price UNIQUE (price_table_id, input_code)
);

CREATE INDEX IF NOT EXISTS idx_sinapi_input_prices_table ON sinapi_input_prices(price_table_id);
CREATE INDEX IF NOT EXISTS idx_sinapi_input_prices_code ON sinapi_input_prices(input_code);

-- =====================================================
-- D) SINAPI_COMPOSITIONS (Composições/CPU Base)
-- =====================================================

CREATE TABLE IF NOT EXISTS sinapi_compositions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL DEFAULT 'SINAPI',
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT,
    composition_type TEXT, -- 'SERVICO', 'AUXILIAR', etc
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_sinapi_composition UNIQUE (source, code)
);

CREATE INDEX IF NOT EXISTS idx_sinapi_compositions_code ON sinapi_compositions(code);
CREATE INDEX IF NOT EXISTS idx_sinapi_compositions_description ON sinapi_compositions USING gin(to_tsvector('portuguese', description));

-- =====================================================
-- E) SINAPI_COMPOSITION_PRICES (Preço da Composição por Tabela)
-- =====================================================

CREATE TABLE IF NOT EXISTS sinapi_composition_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_table_id UUID NOT NULL REFERENCES sinapi_price_tables(id) ON DELETE CASCADE,
    composition_code TEXT NOT NULL,
    price DECIMAL(15, 4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_composition_price UNIQUE (price_table_id, composition_code)
);

CREATE INDEX IF NOT EXISTS idx_sinapi_composition_prices_table ON sinapi_composition_prices(price_table_id);
CREATE INDEX IF NOT EXISTS idx_sinapi_composition_prices_code ON sinapi_composition_prices(composition_code);

-- =====================================================
-- F) SINAPI_COMPOSITION_ITEMS (Itens da Composição)
-- =====================================================

CREATE TABLE IF NOT EXISTS sinapi_composition_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_table_id UUID NOT NULL REFERENCES sinapi_price_tables(id) ON DELETE CASCADE,
    composition_code TEXT NOT NULL,
    item_type TEXT NOT NULL CHECK (item_type IN ('INSUMO', 'COMPOSICAO')),
    item_code TEXT NOT NULL,
    coefficient DECIMAL(15, 8) NOT NULL,
    unit TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_composition_item UNIQUE (price_table_id, composition_code, item_type, item_code)
);

CREATE INDEX IF NOT EXISTS idx_sinapi_composition_items_table ON sinapi_composition_items(price_table_id);
CREATE INDEX IF NOT EXISTS idx_sinapi_composition_items_comp ON sinapi_composition_items(composition_code);
CREATE INDEX IF NOT EXISTS idx_sinapi_composition_items_item ON sinapi_composition_items(item_code);

-- =====================================================
-- G) SINAPI_IMPORT_RUNS (Auditoria de Importações)
-- =====================================================

CREATE TABLE IF NOT EXISTS sinapi_import_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    uf TEXT NOT NULL,
    year INTEGER NOT NULL,
    months INTEGER[], -- Array de meses processados
    regimes TEXT[], -- Array de regimes processados
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL', 'ERROR')),
    logs TEXT,
    counts JSONB, -- {inputs, compositions, prices, items, skipped}
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sinapi_import_runs_status ON sinapi_import_runs(status);
CREATE INDEX IF NOT EXISTS idx_sinapi_import_runs_uf ON sinapi_import_runs(uf);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- SINAPI é base pública - todos autenticados podem ler
ALTER TABLE sinapi_price_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE sinapi_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sinapi_input_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sinapi_compositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sinapi_composition_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sinapi_composition_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sinapi_import_runs ENABLE ROW LEVEL SECURITY;

-- Políticas de LEITURA PÚBLICA (para usuários autenticados)
CREATE POLICY "Authenticated users can view sinapi_price_tables" 
    ON sinapi_price_tables FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "Authenticated users can view sinapi_inputs" 
    ON sinapi_inputs FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "Authenticated users can view sinapi_input_prices" 
    ON sinapi_input_prices FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "Authenticated users can view sinapi_compositions" 
    ON sinapi_compositions FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "Authenticated users can view sinapi_composition_prices" 
    ON sinapi_composition_prices FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "Authenticated users can view sinapi_composition_items" 
    ON sinapi_composition_items FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "Authenticated users can view sinapi_import_runs" 
    ON sinapi_import_runs FOR SELECT 
    TO authenticated 
    USING (true);

-- Políticas de ESCRITA (apenas service_role ou admin - via API)
-- Para escrita, usamos service_role key no backend
CREATE POLICY "Service role can manage sinapi_price_tables" 
    ON sinapi_price_tables FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);

CREATE POLICY "Service role can manage sinapi_inputs" 
    ON sinapi_inputs FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);

CREATE POLICY "Service role can manage sinapi_input_prices" 
    ON sinapi_input_prices FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);

CREATE POLICY "Service role can manage sinapi_compositions" 
    ON sinapi_compositions FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);

CREATE POLICY "Service role can manage sinapi_composition_prices" 
    ON sinapi_composition_prices FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);

CREATE POLICY "Service role can manage sinapi_composition_items" 
    ON sinapi_composition_items FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);

CREATE POLICY "Service role can manage sinapi_import_runs" 
    ON sinapi_import_runs FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);

-- Usuários autenticados também podem inserir/atualizar import_runs (para o admin UI)
CREATE POLICY "Authenticated users can insert import_runs" 
    ON sinapi_import_runs FOR INSERT 
    TO authenticated 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can update own import_runs" 
    ON sinapi_import_runs FOR UPDATE 
    TO authenticated 
    USING (auth.uid() = user_id);

-- =====================================================
-- TRIGGERS PARA UPDATED_AT
-- =====================================================

CREATE TRIGGER update_sinapi_inputs_updated_at 
    BEFORE UPDATE ON sinapi_inputs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sinapi_compositions_updated_at 
    BEFORE UPDATE ON sinapi_compositions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- VIEWS ÚTEIS
-- =====================================================

-- View para buscar insumo com preço por competência
CREATE OR REPLACE VIEW sinapi_inputs_with_prices AS
SELECT 
    si.id,
    si.source,
    si.code,
    si.description,
    si.unit,
    si.category,
    sip.price,
    spt.uf,
    spt.competence,
    spt.regime
FROM sinapi_inputs si
LEFT JOIN sinapi_input_prices sip ON si.code = sip.input_code
LEFT JOIN sinapi_price_tables spt ON sip.price_table_id = spt.id
WHERE si.active = true;

-- View para buscar composição com preço e contagem de itens
CREATE OR REPLACE VIEW sinapi_compositions_with_prices AS
SELECT 
    sc.id,
    sc.source,
    sc.code,
    sc.description,
    sc.unit,
    sc.composition_type,
    scp.price,
    spt.uf,
    spt.competence,
    spt.regime,
    (SELECT COUNT(*) FROM sinapi_composition_items sci WHERE sci.composition_code = sc.code AND sci.price_table_id = spt.id) as items_count
FROM sinapi_compositions sc
LEFT JOIN sinapi_composition_prices scp ON sc.code = scp.composition_code
LEFT JOIN sinapi_price_tables spt ON scp.price_table_id = spt.id
WHERE sc.active = true;

-- =====================================================
-- VERIFICAÇÃO
-- =====================================================

SELECT 
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
  AND table_name LIKE 'sinapi%'
ORDER BY table_name;

-- =====================================================
-- SUCESSO!
-- =====================================================
