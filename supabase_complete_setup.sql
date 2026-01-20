-- =====================================================
-- NABOORCA - SCRIPT COMPLETO DE SETUP DO BANCO DE DADOS
-- =====================================================
-- Execute este script no SQL Editor do Supabase
-- Ele criará todas as tabelas, políticas RLS e funções necessárias
-- =====================================================

-- =====================================================
-- 1. TABELA: COMPANIES (Empresas)
-- =====================================================

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    cnpj TEXT,
    address TEXT,
    email TEXT,
    phone TEXT,
    logo_url TEXT,
    responsible_name TEXT,
    responsible_cpf TEXT,
    responsible_crea TEXT,
    proposal_cover TEXT,
    proposal_terms TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companies_user_id ON companies(user_id);

-- =====================================================
-- 2. TABELA: BUDGETS (Orçamentos)
-- =====================================================

CREATE TABLE IF NOT EXISTS budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    client_name TEXT,
    date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'draft',
    total_value DECIMAL(15, 2) DEFAULT 0,
    bdi_percentage DECIMAL(5, 2) DEFAULT 0,
    encargos_percentage DECIMAL(5, 2) DEFAULT 0,
    obra_type TEXT,
    proposal_cover TEXT,
    proposal_terms TEXT,
    schedule_interval INTEGER,
    period_labels TEXT[],
    cost_centers TEXT[],
    is_template BOOLEAN DEFAULT FALSE,
    desoneracao DECIMAL(5, 2),
    version TEXT,
    revision INTEGER DEFAULT 1,
    revision_notes TEXT,
    is_frozen BOOLEAN DEFAULT FALSE,
    frozen_at TIMESTAMPTZ,
    frozen_by TEXT,
    parent_budget_id UUID REFERENCES budgets(id) ON DELETE SET NULL,
    is_scenario BOOLEAN DEFAULT FALSE,
    scenario_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_budgets_company_id ON budgets(company_id);
CREATE INDEX IF NOT EXISTS idx_budgets_status ON budgets(status);

-- =====================================================
-- 3. TABELA: BUDGET_ITEMS (Itens de Orçamento)
-- =====================================================

CREATE TABLE IF NOT EXISTS budget_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL,
    level INTEGER NOT NULL DEFAULT 0,
    item_number TEXT,
    code TEXT,
    description TEXT NOT NULL,
    unit TEXT,
    quantity DECIMAL(15, 4) DEFAULT 0,
    unit_price DECIMAL(15, 2) DEFAULT 0,
    total_price DECIMAL(15, 2) DEFAULT 0,
    type TEXT NOT NULL,
    source TEXT,
    item_type TEXT,
    composition_id UUID,
    insumo_id UUID,
    calculation_memory TEXT,
    calculation_steps JSONB,
    custom_bdi DECIMAL(5, 2),
    cost_center TEXT,
    is_locked BOOLEAN DEFAULT FALSE,
    notes TEXT,
    is_desonerated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budget_items_user_id ON budget_items(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_items_budget_id ON budget_items(budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_items_order ON budget_items(budget_id, order_index);

-- =====================================================
-- 4. TABELA: CLIENTS (Clientes)
-- =====================================================

CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    documento TEXT NOT NULL,
    tipo_documento TEXT NOT NULL CHECK (tipo_documento IN ('cpf', 'cnpj')),
    tipo_cliente TEXT NOT NULL CHECK (tipo_cliente IN ('publico', 'privado')),
    orgao TEXT,
    endereco TEXT,
    cidade TEXT,
    uf TEXT,
    responsavel TEXT,
    telefone TEXT,
    email TEXT,
    obra_predominante TEXT,
    is_ativo BOOLEAN DEFAULT TRUE,
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_documento ON clients(documento);

-- =====================================================
-- 5. TABELA: PROPOSALS (Propostas)
-- =====================================================

CREATE TABLE IF NOT EXISTS proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    budget_name TEXT NOT NULL,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    client_name TEXT NOT NULL,
    valor_total DECIMAL(15, 2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'rascunho',
    tipo_orcamento TEXT NOT NULL,
    empresa_nome TEXT NOT NULL,
    empresa_cnpj TEXT,
    responsavel_nome TEXT,
    responsavel_crea TEXT,
    logo_base64 TEXT,
    inclui_curva_abc BOOLEAN DEFAULT FALSE,
    inclui_memorial_calculo BOOLEAN DEFAULT FALSE,
    inclui_cronograma BOOLEAN DEFAULT FALSE,
    termos_ressalvas TEXT,
    gerada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revisada_em TIMESTAMPTZ,
    aprovada_em TIMESTAMPTZ,
    emitida_em TIMESTAMPTZ,
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposals_user_id ON proposals(user_id);
CREATE INDEX IF NOT EXISTS idx_proposals_budget_id ON proposals(budget_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);

-- =====================================================
-- 6. TABELA: CHANGE_LOGS (Logs de Alteração)
-- =====================================================

CREATE TABLE IF NOT EXISTS change_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    budget_id UUID REFERENCES budgets(id) ON DELETE CASCADE,
    proposal_id UUID REFERENCES proposals(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    description TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_change_logs_user_id ON change_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_change_logs_budget_id ON change_logs(budget_id);
CREATE INDEX IF NOT EXISTS idx_change_logs_proposal_id ON change_logs(proposal_id);

-- =====================================================
-- 7. TABELA: BUDGET_SCHEDULES (Cronogramas)
-- =====================================================

CREATE TABLE IF NOT EXISTS budget_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    budget_item_id UUID NOT NULL REFERENCES budget_items(id) ON DELETE CASCADE,
    period_index INTEGER NOT NULL,
    period_label TEXT NOT NULL,
    percentage DECIMAL(5, 2) NOT NULL DEFAULT 0,
    physical_value DECIMAL(15, 2) DEFAULT 0,
    financial_value DECIMAL(15, 2) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_schedule_item_period UNIQUE (budget_item_id, period_index)
);

CREATE INDEX IF NOT EXISTS idx_budget_schedules_user_id ON budget_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_schedules_budget_id ON budget_schedules(budget_id);

-- =====================================================
-- 8. TABELA: INSUMOS (Insumos/Recursos)
-- =====================================================

CREATE TABLE IF NOT EXISTS insumos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT NOT NULL,
    price DECIMAL(15, 2) NOT NULL,
    type TEXT NOT NULL,
    fonte TEXT,
    data_referencia TIMESTAMPTZ,
    is_oficial BOOLEAN DEFAULT FALSE,
    is_editavel BOOLEAN DEFAULT TRUE,
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insumos_user_id ON insumos(user_id);
CREATE INDEX IF NOT EXISTS idx_insumos_code ON insumos(code);
CREATE INDEX IF NOT EXISTS idx_insumos_description ON insumos(description);

-- =====================================================
-- 9. TABELA: COMPOSITIONS (Composições)
-- =====================================================

CREATE TABLE IF NOT EXISTS compositions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT NOT NULL,
    total_cost DECIMAL(15, 2) NOT NULL DEFAULT 0,
    fonte TEXT,
    data_referencia TIMESTAMPTZ,
    is_oficial BOOLEAN DEFAULT FALSE,
    is_customizada BOOLEAN DEFAULT TRUE,
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compositions_user_id ON compositions(user_id);
CREATE INDEX IF NOT EXISTS idx_compositions_code ON compositions(code);

-- =====================================================
-- 10. TABELA: COMPOSITION_ITEMS (Itens de Composição)
-- =====================================================

CREATE TABLE IF NOT EXISTS composition_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    composition_id UUID NOT NULL REFERENCES compositions(id) ON DELETE CASCADE,
    insumo_id UUID REFERENCES insumos(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT NOT NULL,
    coefficient DECIMAL(15, 6) NOT NULL,
    unit_price DECIMAL(15, 2) NOT NULL,
    total_price DECIMAL(15, 2) NOT NULL,
    type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_composition_items_composition_id ON composition_items(composition_id);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE compositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE composition_items ENABLE ROW LEVEL SECURITY;

-- Políticas para COMPANIES
CREATE POLICY "Users can view own companies" ON companies FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own companies" ON companies FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own companies" ON companies FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own companies" ON companies FOR DELETE USING (auth.uid() = user_id);

-- Políticas para BUDGETS
CREATE POLICY "Users can view own budgets" ON budgets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own budgets" ON budgets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own budgets" ON budgets FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own budgets" ON budgets FOR DELETE USING (auth.uid() = user_id);

-- Políticas para BUDGET_ITEMS
CREATE POLICY "Users can view own budget_items" ON budget_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own budget_items" ON budget_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own budget_items" ON budget_items FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own budget_items" ON budget_items FOR DELETE USING (auth.uid() = user_id);

-- Políticas para CLIENTS
CREATE POLICY "Users can view own clients" ON clients FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own clients" ON clients FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own clients" ON clients FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own clients" ON clients FOR DELETE USING (auth.uid() = user_id);

-- Políticas para PROPOSALS
CREATE POLICY "Users can view own proposals" ON proposals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own proposals" ON proposals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own proposals" ON proposals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own proposals" ON proposals FOR DELETE USING (auth.uid() = user_id);

-- Políticas para CHANGE_LOGS
CREATE POLICY "Users can view own change_logs" ON change_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own change_logs" ON change_logs FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Políticas para BUDGET_SCHEDULES
CREATE POLICY "Users can view own budget_schedules" ON budget_schedules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own budget_schedules" ON budget_schedules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own budget_schedules" ON budget_schedules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own budget_schedules" ON budget_schedules FOR DELETE USING (auth.uid() = user_id);

-- Políticas para INSUMOS
CREATE POLICY "Users can view own insumos" ON insumos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own insumos" ON insumos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own insumos" ON insumos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own insumos" ON insumos FOR DELETE USING (auth.uid() = user_id);

-- Políticas para COMPOSITIONS
CREATE POLICY "Users can view own compositions" ON compositions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own compositions" ON compositions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own compositions" ON compositions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own compositions" ON compositions FOR DELETE USING (auth.uid() = user_id);

-- Políticas para COMPOSITION_ITEMS (baseado na composition pai)
CREATE POLICY "Users can view own composition_items" ON composition_items FOR SELECT
USING (EXISTS (SELECT 1 FROM compositions WHERE compositions.id = composition_items.composition_id AND compositions.user_id = auth.uid()));

CREATE POLICY "Users can insert own composition_items" ON composition_items FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM compositions WHERE compositions.id = composition_items.composition_id AND compositions.user_id = auth.uid()));

CREATE POLICY "Users can update own composition_items" ON composition_items FOR UPDATE
USING (EXISTS (SELECT 1 FROM compositions WHERE compositions.id = composition_items.composition_id AND compositions.user_id = auth.uid()));

CREATE POLICY "Users can delete own composition_items" ON composition_items FOR DELETE
USING (EXISTS (SELECT 1 FROM compositions WHERE compositions.id = composition_items.composition_id AND compositions.user_id = auth.uid()));

-- =====================================================
-- TRIGGERS PARA UPDATED_AT
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_budgets_updated_at BEFORE UPDATE ON budgets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_budget_items_updated_at BEFORE UPDATE ON budget_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_proposals_updated_at BEFORE UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_budget_schedules_updated_at BEFORE UPDATE ON budget_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_insumos_updated_at BEFORE UPDATE ON insumos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_compositions_updated_at BEFORE UPDATE ON compositions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- VERIFICAÇÃO
-- =====================================================

-- Execute esta query para verificar se tudo foi criado:
SELECT 
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
  AND table_name IN (
    'companies', 'budgets', 'budget_items', 'clients', 'proposals',
    'change_logs', 'budget_schedules', 'insumos', 'compositions', 'composition_items'
  )
ORDER BY table_name;

-- =====================================================
-- SUCESSO!
-- =====================================================
-- Se você viu a lista de tabelas acima, está tudo pronto!
-- Agora você pode:
-- 1. Atualizar o .env.local com suas credenciais
-- 2. Reiniciar o servidor (npm run dev)
-- 3. Criar sua conta no sistema
-- =====================================================
