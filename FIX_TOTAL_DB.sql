-- =====================================================
-- SCRIPT DE CORREÇÃO TOTAL E DEFINITIVA
-- =====================================================
-- Execute este script no SQL Editor do Supabase para corrigir:
-- 1. Erro de sincronização SINAPI (coluna 'fonte' faltando e índice único)
-- 2. Erro de tabelas de Clientes e Propostas faltando
-- =====================================================

-- 1. ADICIONA COLUNAS QUE PODEM FALTAR NA TABELA INSUMOS
DO $$ 
BEGIN
    -- Adicionar coluna 'fonte' se não existir
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'insumos' AND column_name = 'fonte') THEN
        ALTER TABLE insumos ADD COLUMN fonte TEXT;
    END IF;
END $$;

-- 2. REMOVE ÍNDICESANTIGOS (PARA EVITAR CONFLITOS) E CRIA O CORRETO
DROP INDEX IF EXISTS idx_insumos_upsert_conflict;

-- Criação do índice único vital para o funcionamento da sincronização
-- Isso permite atualizar o preço se o insumo já existir (com base em user_id, code e fonte)
CREATE UNIQUE INDEX idx_insumos_upsert_conflict 
ON insumos (user_id, code, fonte);

-- 3. CRIAÇÃO/VERIFICAÇÃO DA TABELA DE CLIENTES
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

-- 4. CRIAÇÃO/VERIFICAÇÃO DA TABELA DE PROPOSTAS
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

-- 5. CONFIGURAÇÃO DE SEGURANÇA (RLS)
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumos ENABLE ROW LEVEL SECURITY;

-- Recriação segura de políticas
DO $$ 
BEGIN
    -- Policies para Clients
    DROP POLICY IF EXISTS "Users can view own clients" ON clients;
    CREATE POLICY "Users can view own clients" ON clients FOR SELECT USING (auth.uid() = user_id);
    
    DROP POLICY IF EXISTS "Users can insert own clients" ON clients;
    CREATE POLICY "Users can insert own clients" ON clients FOR INSERT WITH CHECK (auth.uid() = user_id);
    
    DROP POLICY IF EXISTS "Users can update own clients" ON clients;
    CREATE POLICY "Users can update own clients" ON clients FOR UPDATE USING (auth.uid() = user_id);
    
    DROP POLICY IF EXISTS "Users can delete own clients" ON clients;
    CREATE POLICY "Users can delete own clients" ON clients FOR DELETE USING (auth.uid() = user_id);

    -- Policies para Proposals
    DROP POLICY IF EXISTS "Users can view own proposals" ON proposals;
    CREATE POLICY "Users can view own proposals" ON proposals FOR SELECT USING (auth.uid() = user_id);
    
    DROP POLICY IF EXISTS "Users can insert own proposals" ON proposals;
    CREATE POLICY "Users can insert own proposals" ON proposals FOR INSERT WITH CHECK (auth.uid() = user_id);
    
    DROP POLICY IF EXISTS "Users can update own proposals" ON proposals;
    CREATE POLICY "Users can update own proposals" ON proposals FOR UPDATE USING (auth.uid() = user_id);
    
    DROP POLICY IF EXISTS "Users can delete own proposals" ON proposals;
    CREATE POLICY "Users can delete own proposals" ON proposals FOR DELETE USING (auth.uid() = user_id);
END $$;
