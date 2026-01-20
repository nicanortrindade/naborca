-- ==========================================
-- SUPABASE COMPLETE SETUP - NABOORÇA
-- ==========================================
-- Este script cria as tabelas e configura as políticas de segurança (RLS).
-- Copie e cole no SQL Editor do Supabase.

-- 0. Extensões e Helpers
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Função para atualizar o timestamp de 'updated_at'
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 1. COMPANIES
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL DEFAULT auth.uid(),
    name TEXT NOT NULL,
    cnpj TEXT,
    address TEXT,
    email TEXT,
    phone TEXT,
    logo_url TEXT,
    responsible_name TEXT,
    responsible_cpf TEXT,
    responsible_crea TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own company" ON companies FOR ALL USING (auth.uid() = user_id);

-- 2. PRICE BASES
CREATE TABLE price_bases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL DEFAULT auth.uid(),
    name TEXT NOT NULL,
    region TEXT,
    reference_date DATE,
    is_official BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE price_bases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own price bases" ON price_bases FOR ALL USING (auth.uid() = user_id);

-- 3. INSUMOS
CREATE TABLE insumos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL DEFAULT auth.uid(),
    base_id UUID REFERENCES price_bases(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT,
    price DECIMAL(15, 4) DEFAULT 0,
    type TEXT, -- material, mao_de_obra, equipamento
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE insumos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own insumos" ON insumos FOR ALL USING (auth.uid() = user_id);

-- 4. COMPOSITIONS
CREATE TABLE compositions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL DEFAULT auth.uid(),
    base_id UUID REFERENCES price_bases(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT,
    total_cost DECIMAL(15, 4) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE compositions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own compositions" ON compositions FOR ALL USING (auth.uid() = user_id);

-- 5. COMPOSITION_INPUTS (Junction for CPU)
CREATE TABLE composition_inputs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL DEFAULT auth.uid(),
    parent_composition_id UUID REFERENCES compositions(id) ON DELETE CASCADE,
    insumo_id UUID REFERENCES insumos(id),
    sub_composition_id UUID REFERENCES compositions(id),
    coefficient DECIMAL(15, 6) NOT NULL,
    unit_price_at_addition DECIMAL(15, 4),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE composition_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own composition items" ON composition_inputs FOR ALL USING (auth.uid() = user_id);

-- 6. BUDGETS
CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL DEFAULT auth.uid(),
    company_id UUID REFERENCES companies(id),
    name TEXT NOT NULL,
    client_name TEXT,
    date DATE DEFAULT CURRENT_DATE,
    status TEXT DEFAULT 'draft',
    total_value DECIMAL(15, 2) DEFAULT 0,
    bdi_percentage DECIMAL(5, 2) DEFAULT 0,
    encargos_percentage DECIMAL(5, 2) DEFAULT 0,
    obra_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own budgets" ON budgets FOR ALL USING (auth.uid() = user_id);

-- 7. BUDGET_ITEMS
CREATE TABLE budget_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL DEFAULT auth.uid(),
    budget_id UUID REFERENCES budgets(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES budget_items(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL,
    level INTEGER DEFAULT 0,
    item_number TEXT,
    code TEXT,
    description TEXT NOT NULL,
    unit TEXT,
    quantity DECIMAL(15, 4) DEFAULT 0,
    unit_price DECIMAL(15, 4) DEFAULT 0,
    total_price DECIMAL(15, 2) DEFAULT 0,
    type TEXT,
    source TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own budget items" ON budget_items FOR ALL USING (auth.uid() = user_id);

-- 8. BDI
CREATE TABLE bdi (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL DEFAULT auth.uid(),
    name TEXT NOT NULL,
    ac_rate DECIMAL(5, 2) DEFAULT 0,
    sg_rate DECIMAL(5, 2) DEFAULT 0,
    r_rate DECIMAL(5, 2) DEFAULT 0,
    df_rate DECIMAL(5, 2) DEFAULT 0,
    l_rate DECIMAL(5, 2) DEFAULT 0,
    taxes_rate DECIMAL(5, 2) DEFAULT 0,
    final_bdi DECIMAL(5, 2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE bdi ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own BDI presets" ON bdi FOR ALL USING (auth.uid() = user_id);

-- 9. ENCARGOS (Social Charges)
CREATE TABLE encargos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL DEFAULT auth.uid(),
    name TEXT NOT NULL,
    type TEXT, -- horista ou mensalista
    percentage DECIMAL(5, 2) NOT NULL,
    base_json JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE encargos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own social charges" ON encargos FOR ALL USING (auth.uid() = user_id);

-- 10. AUDIT_LOGS
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL DEFAULT auth.uid(),
    action TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own audit logs" ON audit_logs FOR SELECT USING (auth.uid() = user_id);

-- TRIGGERS PARA UPDATED_AT
CREATE TRIGGER tr_companies_upd BEFORE UPDATE ON companies FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();
CREATE TRIGGER tr_price_bases_upd BEFORE UPDATE ON price_bases FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();
CREATE TRIGGER tr_insumos_upd BEFORE UPDATE ON insumos FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();
CREATE TRIGGER tr_compositions_upd BEFORE UPDATE ON compositions FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();
CREATE TRIGGER tr_budgets_upd BEFORE UPDATE ON budgets FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();
CREATE TRIGGER tr_budget_items_upd BEFORE UPDATE ON budget_items FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();
CREATE TRIGGER tr_bdi_upd BEFORE UPDATE ON bdi FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();
CREATE TRIGGER tr_encargos_upd BEFORE UPDATE ON encargos FOR EACH ROW EXECUTE PROCEDURE handle_updated_at();
