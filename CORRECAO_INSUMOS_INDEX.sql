-- =====================================================
-- CORREÇÃO: ÍNDICE ÚNICO PARA UPSERT DE INSUMOS
-- =====================================================
-- Este script adiciona o índice único necessário para que a 
-- funcionalidade de Sincronização de Bases funcione corretamente.
-- Sem este índice, o comando ON CONFLICT (user_id, code, fonte) falha.

-- 1. Cria o índice único (necessário para o UPSERT)
CREATE UNIQUE INDEX IF NOT EXISTS idx_insumos_upsert_conflict 
ON insumos (user_id, code, fonte);

-- 2. Garante que as políticas de RLS estão corretas para o Insumos
-- (Embora já devam existir se o script completo foi rodado)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'insumos' AND policyname = 'Users can insert own insumos') THEN
        CREATE POLICY "Users can insert own insumos" ON insumos FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'insumos' AND policyname = 'Users can update own insumos') THEN
        CREATE POLICY "Users can update own insumos" ON insumos FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;

-- 3. Verifica se as colunas estão corretas (opcional, para debug)
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'insumos';
