-- SUPABASE DATABASE SCHEMA MIGRATION - NABOORÇA
-- Purpose: Relational schema for PostgreSQL (Supabase)
-- Security: Every table has user_id for Row Level Security (RLS)

-- 0. Enable Triggers and Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Helper function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 1. COMPANIES
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL,
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

-- 2. PRICE BASES (SINAPI, ORSE, etc.)
CREATE TABLE price_bases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL, -- Isolated by user or global if needed
    name TEXT NOT NULL, -- e.g. 'SINAPI'
    region TEXT,
    reference_date DATE,
    is_official BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. INSUMOS (Engineering Inputs)
CREATE TABLE insumos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL,
    base_id UUID REFERENCES price_bases(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT,
    price DECIMAL(15, 4) DEFAULT 0,
    type TEXT, -- material, labor, equipment
    is_tax_free BOOLEAN DEFAULT false, -- desonerado
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. COMPOSITIONS (CPU - Composição de Preço Unitário)
CREATE TABLE compositions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL,
    base_id UUID REFERENCES price_bases(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT,
    total_cost DECIMAL(15, 4) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. COMPOSITION ITEMS (Junction for children of a CPU)
CREATE TABLE composition_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL,
    parent_composition_id UUID REFERENCES compositions(id) ON DELETE CASCADE,
    child_insumo_id UUID REFERENCES insumos(id),
    child_composition_id UUID REFERENCES compositions(id), -- Nested compositions
    coefficient DECIMAL(15, 6) NOT NULL,
    unit_price_at_addition DECIMAL(15, 4),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. BUDGETS
CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL,
    company_id UUID REFERENCES companies(id),
    name TEXT NOT NULL,
    client_name TEXT,
    client_document TEXT,
    date DATE DEFAULT CURRENT_DATE,
    status TEXT DEFAULT 'draft', -- draft, pending, approved
    total_value DECIMAL(15, 2) DEFAULT 0,
    bdi_percentage DECIMAL(5, 2) DEFAULT 0,
    social_charges_percentage DECIMAL(5, 2) DEFAULT 0,
    is_template BOOLEAN DEFAULT false,
    obra_type TEXT, -- predial, saneamento, etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. BUDGET ITEMS (Specific items in a budget)
CREATE TABLE budget_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL,
    budget_id UUID REFERENCES budgets(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES budget_items(id) ON DELETE CASCADE, -- Self-reference for hierarchy
    order_index INTEGER NOT NULL,
    level INTEGER DEFAULT 0,
    item_number TEXT, -- "1.1.2"
    code TEXT,
    description TEXT NOT NULL,
    unit TEXT,
    quantity DECIMAL(15, 4) DEFAULT 0,
    unit_price DECIMAL(15, 4) DEFAULT 0,
    total_price DECIMAL(15, 2) DEFAULT 0,
    type TEXT, -- group, service, material, labor
    source TEXT,
    custom_bdi DECIMAL(5, 2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. BDI PRESETS (Calculators)
CREATE TABLE bdi_presets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL,
    name TEXT NOT NULL,
    ac_percentage DECIMAL(5, 2) DEFAULT 0, -- Adm Central
    sg_percentage DECIMAL(5, 2) DEFAULT 0, -- Seguro/Garantia
    r_percentage DECIMAL(5, 2) DEFAULT 0,  -- Risco
    df_percentage DECIMAL(5, 2) DEFAULT 0, -- Despesas Financ.
    l_percentage DECIMAL(5, 2) DEFAULT 0,  -- Lucro
    taxes_total_percentage DECIMAL(5, 2) DEFAULT 0,
    calculated_value DECIMAL(5, 2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. SOCIAL CHARGES (Encargos Sociais)
CREATE TABLE social_charges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL,
    name TEXT NOT NULL,
    type TEXT, -- horista, mensalista
    percentage DECIMAL(5, 2) NOT NULL,
    base_data JSONB, -- Details of the calculation groups
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. AUDIT LOGS
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL,
    action TEXT NOT NULL, -- INSERT, UPDATE, DELETE
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Triggers for updated_at
CREATE TRIGGER update_companies_modtime BEFORE UPDATE ON companies FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_price_bases_modtime BEFORE UPDATE ON price_bases FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_insumos_modtime BEFORE UPDATE ON insumos FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_compositions_modtime BEFORE UPDATE ON compositions FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_budgets_modtime BEFORE UPDATE ON budgets FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_budget_items_modtime BEFORE UPDATE ON budget_items FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_bdi_presets_modtime BEFORE UPDATE ON bdi_presets FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_social_charges_modtime BEFORE UPDATE ON social_charges FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
