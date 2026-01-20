-- ARQUIVO DE CORREÇÃO: CORRECAO_CLIENTES_PROPOSTAS.sql
-- Execute APENAS este arquivo para corrigir o erro de carregamento de Clientes e Propostas.

-- 1. TABELA DE CLIENTES (Se não existir)
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

-- Ativar RLS (Segurança) para Clientes
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Políticas de Segurança (Ignora erro se já existirem)
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

-- Trigger de atualização de data
DROP TRIGGER IF EXISTS update_clients_modtime ON clients;
CREATE TRIGGER update_clients_modtime BEFORE UPDATE ON clients FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();


-- 2. TABELA DE PROPOSTAS (Se não existir)
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

-- Ativar RLS (Segurança) para Propostas
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;

-- Políticas de Segurança
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

-- Trigger de atualização de data
DROP TRIGGER IF EXISTS update_proposals_modtime ON proposals;
CREATE TRIGGER update_proposals_modtime BEFORE UPDATE ON proposals FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
