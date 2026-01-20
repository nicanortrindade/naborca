-- =====================================================
-- TABELAS PARA COMERCIALIZAÇÃO FUTURA
-- =====================================================
-- 
-- Este script cria tabelas necessárias para:
-- - Gerenciamento de assinaturas
-- - Logs de auditoria
-- - Métricas de uso
-- - Controle de limites
--
-- IMPORTANTE: NÃO há integração de pagamento.
-- Isso é apenas estrutura preparatória.
-- =====================================================

-- =====================================================
-- 1. SUBSCRIPTIONS (Assinaturas)
-- =====================================================

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Plano
    plan_tier TEXT NOT NULL CHECK (plan_tier IN ('free', 'pro', 'enterprise')),
    status TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'expired', 'trial')),
    
    -- Datas
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    trial_ends_at TIMESTAMPTZ,
    
    -- Pagamento (Futuro)
    payment_provider TEXT, -- 'stripe', 'mercadopago', etc.
    external_subscription_id TEXT, -- ID no gateway de pagamento
    
    -- Metadados
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Índices
    CONSTRAINT unique_active_subscription UNIQUE (user_id, status)
);

-- Índices para performance
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_expires_at ON subscriptions(expires_at);

-- RLS
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscriptions"
ON subscriptions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscriptions"
ON subscriptions FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions"
ON subscriptions FOR UPDATE
USING (auth.uid() = user_id);

-- =====================================================
-- 2. AUDIT_LOGS (Logs de Auditoria)
-- =====================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Ação
    action TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    
    -- Recurso Afetado
    resource_type TEXT,
    resource_id TEXT,
    
    -- Detalhes
    details JSONB,
    
    -- Contexto
    ip_address TEXT,
    user_agent TEXT,
    
    -- Timestamp
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para performance e queries
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_severity ON audit_logs(severity);

-- RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own audit logs"
ON audit_logs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own audit logs"
ON audit_logs FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Logs são append-only (não podem ser editados ou deletados)
-- Isso garante integridade da auditoria

-- =====================================================
-- 3. USAGE_METRICS (Métricas de Uso)
-- =====================================================

CREATE TABLE IF NOT EXISTS usage_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Período
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Contadores
    budgets_created INTEGER DEFAULT 0,
    budgets_updated INTEGER DEFAULT 0,
    budgets_deleted INTEGER DEFAULT 0,
    
    proposals_created INTEGER DEFAULT 0,
    proposals_exported INTEGER DEFAULT 0,
    
    clients_created INTEGER DEFAULT 0,
    
    pdf_exports INTEGER DEFAULT 0,
    excel_exports INTEGER DEFAULT 0,
    
    -- Limites Atuais (Snapshot)
    current_budgets_count INTEGER DEFAULT 0,
    current_clients_count INTEGER DEFAULT 0,
    current_proposals_count INTEGER DEFAULT 0,
    
    -- Metadados
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraint: Um registro por usuário por período
    CONSTRAINT unique_user_period UNIQUE (user_id, period_start, period_end)
);

-- Índices
CREATE INDEX idx_usage_metrics_user_id ON usage_metrics(user_id);
CREATE INDEX idx_usage_metrics_period ON usage_metrics(period_start, period_end);

-- RLS
ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage metrics"
ON usage_metrics FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "System can insert usage metrics"
ON usage_metrics FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "System can update usage metrics"
ON usage_metrics FOR UPDATE
USING (auth.uid() = user_id);

-- =====================================================
-- 4. FEATURE_FLAGS (Controle de Features por Usuário)
-- =====================================================

CREATE TABLE IF NOT EXISTS user_feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Feature
    feature_key TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    
    -- Metadados
    enabled_at TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,
    reason TEXT,
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraint: Uma flag por feature por usuário
    CONSTRAINT unique_user_feature UNIQUE (user_id, feature_key)
);

-- Índices
CREATE INDEX idx_user_feature_flags_user_id ON user_feature_flags(user_id);
CREATE INDEX idx_user_feature_flags_feature_key ON user_feature_flags(feature_key);
CREATE INDEX idx_user_feature_flags_enabled ON user_feature_flags(enabled);

-- RLS
ALTER TABLE user_feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own feature flags"
ON user_feature_flags FOR SELECT
USING (auth.uid() = user_id);

-- Apenas admins podem modificar feature flags
-- (Implementar quando tiver sistema de roles)

-- =====================================================
-- 5. PAYMENT_HISTORY (Histórico de Pagamentos - Futuro)
-- =====================================================

CREATE TABLE IF NOT EXISTS payment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    
    -- Pagamento
    amount DECIMAL(10, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'BRL',
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    
    -- Gateway
    payment_provider TEXT,
    external_payment_id TEXT,
    payment_method TEXT, -- 'credit_card', 'pix', 'boleto', etc.
    
    -- Datas
    paid_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,
    
    -- Metadados
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_payment_history_user_id ON payment_history(user_id);
CREATE INDEX idx_payment_history_subscription_id ON payment_history(subscription_id);
CREATE INDEX idx_payment_history_status ON payment_history(status);
CREATE INDEX idx_payment_history_created_at ON payment_history(created_at DESC);

-- RLS
ALTER TABLE payment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own payment history"
ON payment_history FOR SELECT
USING (auth.uid() = user_id);

-- =====================================================
-- FUNÇÕES AUXILIARES
-- =====================================================

-- Função para obter plano atual do usuário
CREATE OR REPLACE FUNCTION get_user_plan(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_plan TEXT;
BEGIN
    SELECT plan_tier INTO v_plan
    FROM subscriptions
    WHERE user_id = p_user_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC
    LIMIT 1;
    
    -- Se não encontrou assinatura ativa, retorna 'free'
    RETURN COALESCE(v_plan, 'free');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para verificar se usuário atingiu limite
CREATE OR REPLACE FUNCTION check_user_limit(
    p_user_id UUID,
    p_resource_type TEXT,
    p_current_count INTEGER,
    p_limit INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Se limite é -1 (ilimitado), sempre permite
    IF p_limit = -1 THEN
        RETURN TRUE;
    END IF;
    
    -- Verifica se ainda não atingiu o limite
    RETURN p_current_count < p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para incrementar métrica de uso
CREATE OR REPLACE FUNCTION increment_usage_metric(
    p_user_id UUID,
    p_metric_name TEXT,
    p_increment INTEGER DEFAULT 1
)
RETURNS VOID AS $$
DECLARE
    v_period_start DATE;
    v_period_end DATE;
BEGIN
    -- Define período como mês atual
    v_period_start := DATE_TRUNC('month', NOW())::DATE;
    v_period_end := (DATE_TRUNC('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    
    -- Insere ou atualiza métrica
    INSERT INTO usage_metrics (
        user_id,
        period_start,
        period_end,
        budgets_created,
        budgets_updated,
        budgets_deleted,
        proposals_created,
        proposals_exported,
        clients_created,
        pdf_exports,
        excel_exports
    ) VALUES (
        p_user_id,
        v_period_start,
        v_period_end,
        CASE WHEN p_metric_name = 'budgets_created' THEN p_increment ELSE 0 END,
        CASE WHEN p_metric_name = 'budgets_updated' THEN p_increment ELSE 0 END,
        CASE WHEN p_metric_name = 'budgets_deleted' THEN p_increment ELSE 0 END,
        CASE WHEN p_metric_name = 'proposals_created' THEN p_increment ELSE 0 END,
        CASE WHEN p_metric_name = 'proposals_exported' THEN p_increment ELSE 0 END,
        CASE WHEN p_metric_name = 'clients_created' THEN p_increment ELSE 0 END,
        CASE WHEN p_metric_name = 'pdf_exports' THEN p_increment ELSE 0 END,
        CASE WHEN p_metric_name = 'excel_exports' THEN p_increment ELSE 0 END
    )
    ON CONFLICT (user_id, period_start, period_end)
    DO UPDATE SET
        budgets_created = usage_metrics.budgets_created + CASE WHEN p_metric_name = 'budgets_created' THEN p_increment ELSE 0 END,
        budgets_updated = usage_metrics.budgets_updated + CASE WHEN p_metric_name = 'budgets_updated' THEN p_increment ELSE 0 END,
        budgets_deleted = usage_metrics.budgets_deleted + CASE WHEN p_metric_name = 'budgets_deleted' THEN p_increment ELSE 0 END,
        proposals_created = usage_metrics.proposals_created + CASE WHEN p_metric_name = 'proposals_created' THEN p_increment ELSE 0 END,
        proposals_exported = usage_metrics.proposals_exported + CASE WHEN p_metric_name = 'proposals_exported' THEN p_increment ELSE 0 END,
        clients_created = usage_metrics.clients_created + CASE WHEN p_metric_name = 'clients_created' THEN p_increment ELSE 0 END,
        pdf_exports = usage_metrics.pdf_exports + CASE WHEN p_metric_name = 'pdf_exports' THEN p_increment ELSE 0 END,
        excel_exports = usage_metrics.excel_exports + CASE WHEN p_metric_name = 'excel_exports' THEN p_increment ELSE 0 END,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_usage_metrics_updated_at
    BEFORE UPDATE ON usage_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_feature_flags_updated_at
    BEFORE UPDATE ON user_feature_flags
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_history_updated_at
    BEFORE UPDATE ON payment_history
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- DADOS INICIAIS (OPCIONAL)
-- =====================================================

-- Criar assinatura 'enterprise' para usuário atual (desenvolvimento)
-- Descomente e ajuste o user_id quando necessário:
/*
INSERT INTO subscriptions (user_id, plan_tier, status, started_at)
VALUES (
    'SEU_USER_ID_AQUI',
    'enterprise',
    'active',
    NOW()
);
*/

-- =====================================================
-- VERIFICAÇÃO
-- =====================================================
-- Execute esta query para verificar se todas as tabelas foram criadas:
/*
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('subscriptions', 'audit_logs', 'usage_metrics', 'user_feature_flags', 'payment_history')
ORDER BY table_name;
*/

-- =====================================================
-- NOTAS IMPORTANTES
-- =====================================================
-- 
-- 1. PAGAMENTOS
--    - NÃO há integração de pagamento implementada
--    - Tabelas estão preparadas para futuro
--    - Quando implementar, usar Stripe/MercadoPago
--
-- 2. ASSINATURAS
--    - Por padrão, todos usuários têm plano 'enterprise'
--    - Ajustar função getUserPlan() quando ativar comercialização
--
-- 3. AUDITORIA
--    - Logs são append-only (não podem ser deletados)
--    - Importante para compliance e segurança
--
-- 4. MÉTRICAS
--    - Agregadas por mês
--    - Útil para analytics e billing futuro
--
-- 5. FEATURE FLAGS
--    - Controle granular de features por usuário
--    - Útil para beta testing e rollout gradual
--
-- =====================================================
