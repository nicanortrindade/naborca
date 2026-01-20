/**
 * EXECUTE ESTE SCRIPT NO EDITOR SQL DO SUPABASE
 * Ele cria as tabelas 'clients' e 'proposals' que faltam, com suporte a segurança (RLS).
 * Corrigindo erros de "Erro ao carregar clientes" e falhas nas Propostas.
 */

-- 0. Garantir extensão de UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Helper function for updated_at (caso não exista)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 1. CLIENTS TABLE
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL,
    nome TEXT NOT NULL,
    documento TEXT,         -- CPF ou CNPJ
    tipo_documento TEXT,    -- 'cpf' ou 'cnpj'
    tipo_cliente TEXT,      -- 'publico' ou 'privado'
    orgao TEXT,
    endereco TEXT,
    cidade TEXT,
    uf TEXT,
    responsavel TEXT,
    telefone TEXT,
    email TEXT,
    obra_predominante TEXT,
    is_ativo BOOLEAN DEFAULT true,
    observacoes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ativar RLS para Clientes
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Políticas de Segurança para Clientes (CRUD apenas para o dono)
DO $$ BEGIN
    CREATE POLICY "Users can view own clients" ON clients FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Users can insert own clients" ON clients FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Users can update own clients" ON clients FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Users can delete own clients" ON clients FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Trigger para updated_at em Clientes
DROP TRIGGER IF EXISTS update_clients_modtime ON clients;
CREATE TRIGGER update_clients_modtime BEFORE UPDATE ON clients FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();


-- 2. PROPOSALS TABLE
CREATE TABLE IF NOT EXISTS proposals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL,
    nome TEXT NOT NULL,
    budget_id UUID REFERENCES budgets(id) ON DELETE SET NULL, 
    budget_name TEXT,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    client_name TEXT,
    valor_total DECIMAL(15, 2),
    status TEXT DEFAULT 'rascunho',
    tipo_orcamento TEXT DEFAULT 'sintetico',
    empresa_nome TEXT,
    empresa_cnpj TEXT,
    responsavel_nome TEXT,
    responsavel_crea TEXT,
    logo_base64 TEXT,
    inclui_curva_abc BOOLEAN DEFAULT false,
    inclui_memorial_calculo BOOLEAN DEFAULT false,
    inclui_cronograma BOOLEAN DEFAULT false,
    termos_ressalvas TEXT,
    gerada_em TIMESTAMPTZ,
    revisada_em TIMESTAMPTZ,
    aprovada_em TIMESTAMPTZ,
    emitida_em TIMESTAMPTZ,
    observacoes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ativar RLS para Propostas
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;

-- Políticas de Segurança para Propostas
DO $$ BEGIN
    CREATE POLICY "Users can view own proposals" ON proposals FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Users can insert own proposals" ON proposals FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Users can update own proposals" ON proposals FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Users can delete own proposals" ON proposals FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Trigger para updated_at em Propostas
DROP TRIGGER IF EXISTS update_proposals_modtime ON proposals;
CREATE TRIGGER update_proposals_modtime BEFORE UPDATE ON proposals FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
