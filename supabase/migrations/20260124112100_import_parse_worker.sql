-- =====================================================
-- NABOORCA - MIGRAÇÃO: IMPORT PARSE WORKER (Fase 1.5)
-- =====================================================
-- Esta migração cria o sistema de fila para parsing pesado de PDFs.
-- O objetivo é desacoplar o parsing CPU-bound da Edge Function de entrada
-- para evitar que o watchdog mate o job por timeout.
-- =====================================================

-- -----------------------------------------------------
-- 1. TABELA: import_parse_tasks (Fila de parsing)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.import_parse_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES public.import_files(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'dispatched', 'running', 'done', 'failed')),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    last_error TEXT,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Constraint: 1 tarefa por job (simplifica lógica)
    CONSTRAINT unique_parse_task_per_job UNIQUE (job_id)
);

-- Índice para busca eficiente de tarefas pendentes
CREATE INDEX IF NOT EXISTS idx_import_parse_tasks_status_created 
    ON public.import_parse_tasks(status, created_at);

-- Índice para busca por file_id
CREATE INDEX IF NOT EXISTS idx_import_parse_tasks_file_id 
    ON public.import_parse_tasks(file_id);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE TRIGGER update_import_parse_tasks_modtime
    BEFORE UPDATE ON public.import_parse_tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS para import_parse_tasks
ALTER TABLE public.import_parse_tasks ENABLE ROW LEVEL SECURITY;

-- Política: usuários só veem suas próprias tasks (via join com import_jobs)
CREATE POLICY "Users can view own parse tasks" ON public.import_parse_tasks
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.import_jobs 
            WHERE import_jobs.id = import_parse_tasks.job_id 
              AND import_jobs.user_id = auth.uid()
        )
    );

-- Service role pode fazer tudo
CREATE POLICY "Service role full access on parse tasks" ON public.import_parse_tasks
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- -----------------------------------------------------
-- 2. FUNÇÃO: dispatch_parse_task (Dispatcher via pg_net)
-- -----------------------------------------------------
-- Esta função é chamada pelo cron para disparar a Edge Function
-- de parsing. Usa pg_net para fazer HTTP POST assíncrono.
-- Se pg_net não estiver disponível, a função retorna erro.
-- 
-- NOTA: Assumimos que pg_net está habilitado. Se não estiver:
-- - Habilitar via Dashboard do Supabase (Database -> Extensions -> pg_net)
-- - Ou usar alternativa com Edge Function dispatcher
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.dispatch_parse_task(max_tasks INT DEFAULT 1)
RETURNS TABLE (
    task_id UUID,
    job_id UUID,
    file_id UUID,
    dispatch_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task RECORD;
    v_edge_function_url TEXT;
    v_service_role_key TEXT;
    v_request_id BIGINT;
    v_dispatched_count INT := 0;
BEGIN
    -- Obtém URL base do Supabase (configurar via variável de ambiente ou hardcode)
    -- NOTA: Em produção, usar current_setting('app.settings.supabase_url') ou similar
    v_edge_function_url := current_setting('app.settings.supabase_url', true);
    v_service_role_key := current_setting('app.settings.supabase_service_role_key', true);
    
    -- Fallback: usar URL padrão se não configurado
    IF v_edge_function_url IS NULL OR v_edge_function_url = '' THEN
        -- Este valor deve ser substituído pelo seu URL real
        v_edge_function_url := 'https://YOUR_PROJECT.supabase.co';
    END IF;
    
    -- Loop para processar tasks
    FOR v_task IN
        SELECT t.id, t.job_id, t.file_id, t.attempts
        FROM public.import_parse_tasks t
        WHERE t.status = 'queued'
          AND t.attempts < t.max_attempts
        ORDER BY t.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT max_tasks
    LOOP
        -- Incrementa tentativas e marca como dispatched
        UPDATE public.import_parse_tasks
        SET 
            status = 'dispatched',
            attempts = attempts + 1,
            locked_at = NOW(),
            locked_by = 'pg_cron_dispatcher',
            updated_at = NOW()
        WHERE id = v_task.id;
        
        -- Atualiza o job para indicar que está na fila de processamento
        UPDATE public.import_jobs
        SET 
            current_step = 'dispatched_to_worker',
            updated_at = NOW()
        WHERE id = v_task.job_id;
        
        -- Tenta disparar via pg_net
        BEGIN
            -- Verifica se pg_net está disponível
            IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
                -- Dispara HTTP POST para Edge Function
                SELECT net.http_post(
                    url := v_edge_function_url || '/functions/v1/import-parse-worker',
                    headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'Authorization', 'Bearer ' || v_service_role_key
                    ),
                    body := jsonb_build_object(
                        'task_id', v_task.id::TEXT,
                        'job_id', v_task.job_id::TEXT,
                        'file_id', v_task.file_id::TEXT
                    )
                ) INTO v_request_id;
                
                task_id := v_task.id;
                job_id := v_task.job_id;
                file_id := v_task.file_id;
                dispatch_status := 'dispatched_via_pg_net';
                RETURN NEXT;
                
                v_dispatched_count := v_dispatched_count + 1;
            ELSE
                -- pg_net não disponível: marca como falha temporária
                UPDATE public.import_parse_tasks
                SET 
                    status = 'failed',
                    last_error = 'pg_net extension not available. Enable it in Supabase Dashboard.',
                    updated_at = NOW()
                WHERE id = v_task.id;
                
                task_id := v_task.id;
                job_id := v_task.job_id;
                file_id := v_task.file_id;
                dispatch_status := 'failed_no_pg_net';
                RETURN NEXT;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            -- Erro ao disparar: marca como failed
            UPDATE public.import_parse_tasks
            SET 
                status = 'failed',
                last_error = 'Dispatch error: ' || SQLERRM,
                updated_at = NOW()
            WHERE id = v_task.id;
            
            task_id := v_task.id;
            job_id := v_task.job_id;
            file_id := v_task.file_id;
            dispatch_status := 'dispatch_error: ' || SQLERRM;
            RETURN NEXT;
        END;
    END LOOP;
    
    RETURN;
END;
$$;

-- -----------------------------------------------------
-- 3. FUNÇÃO ALTERNATIVA: run_import_parse_worker_simple
-- -----------------------------------------------------
-- Versão simplificada que apenas marca tasks como "ready"
-- para serem processadas por um Edge Function scheduler.
-- Usar se pg_net não estiver disponível.
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_parse_tasks_ready(max_tasks INT DEFAULT 1)
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task_id UUID;
BEGIN
    FOR v_task_id IN
        UPDATE public.import_parse_tasks
        SET 
            status = 'dispatched',
            attempts = attempts + 1,
            locked_at = NOW(),
            locked_by = 'pg_cron_marker',
            updated_at = NOW()
        WHERE id IN (
            SELECT id FROM public.import_parse_tasks
            WHERE status = 'queued'
              AND attempts < max_attempts
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT max_tasks
        )
        RETURNING id
    LOOP
        RETURN NEXT v_task_id;
    END LOOP;
    
    RETURN;
END;
$$;

-- -----------------------------------------------------
-- 4. FUNÇÃO: recover_stuck_parse_tasks
-- -----------------------------------------------------
-- Recupera tasks que ficaram presas em 'dispatched' ou 'running'
-- por mais de 5 minutos sem atualização.
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.recover_stuck_parse_tasks()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_recovered INT;
BEGIN
    WITH stuck AS (
        SELECT id
        FROM public.import_parse_tasks
        WHERE status IN ('dispatched', 'running')
          AND updated_at < NOW() - INTERVAL '5 minutes'
          AND attempts < max_attempts
    )
    UPDATE public.import_parse_tasks t
    SET 
        status = 'queued',
        locked_at = NULL,
        locked_by = NULL,
        last_error = COALESCE(last_error, '') || ' [recovered from stuck at ' || NOW()::TEXT || ']',
        updated_at = NOW()
    FROM stuck
    WHERE t.id = stuck.id;
    
    GET DIAGNOSTICS v_recovered = ROW_COUNT;
    
    RETURN v_recovered;
END;
$$;

-- -----------------------------------------------------
-- 5. CRON JOBS
-- -----------------------------------------------------
-- NOTA: Estes comandos devem ser executados com permissão
-- para criar jobs no pg_cron (tipicamente superuser ou via Dashboard)
-- -----------------------------------------------------

-- Job 1: Dispatcher - roda a cada 30 segundos (ou 1 minuto se 30s não suportar)
-- IMPORTANTE: Verificar se pg_cron suporta intervalo de 30s
-- Em muitos casos, o mínimo é 1 minuto.

DO $$
BEGIN
    -- Remove job existente se houver
    PERFORM cron.unschedule('dispatch_parse_tasks');
EXCEPTION WHEN OTHERS THEN
    NULL; -- Ignora se não existir
END $$;

-- Agenda dispatcher para rodar a cada minuto
SELECT cron.schedule(
    'dispatch_parse_tasks',
    '* * * * *',  -- A cada minuto
    $$SELECT public.dispatch_parse_task(2);$$
);

-- Job 2: Recovery de tasks stuck - roda a cada 2 minutos
DO $$
BEGIN
    PERFORM cron.unschedule('recover_stuck_parse_tasks');
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

SELECT cron.schedule(
    'recover_stuck_parse_tasks',
    '*/2 * * * *',  -- A cada 2 minutos
    $$SELECT public.recover_stuck_parse_tasks();$$
);

-- -----------------------------------------------------
-- 6. CONFIGURAÇÕES DE APP (para pg_net)
-- -----------------------------------------------------
-- Estas configurações devem ser definidas no Supabase Dashboard
-- ou via ALTER DATABASE com privilégios adequados.
-- 
-- Exemplo:
-- ALTER DATABASE postgres SET app.settings.supabase_url = 'https://xxx.supabase.co';
-- ALTER DATABASE postgres SET app.settings.supabase_service_role_key = 'eyJ...';
-- 
-- OU via Dashboard: Database -> Extensions -> custom_settings
-- -----------------------------------------------------

COMMENT ON TABLE public.import_parse_tasks IS 
'Fila de tarefas de parsing pesado de PDFs. Processada pelo worker import-parse-worker.';

COMMENT ON FUNCTION public.dispatch_parse_task IS 
'Dispatcher que envia tasks para a Edge Function de parsing via pg_net.';

COMMENT ON FUNCTION public.mark_parse_tasks_ready IS 
'Alternativa ao dispatcher: marca tasks como prontas para polling por Edge Function.';

COMMENT ON FUNCTION public.recover_stuck_parse_tasks IS 
'Recupera tasks que ficaram presas por muito tempo sem atualização.';

-- -----------------------------------------------------
-- FIM DA MIGRAÇÃO
-- -----------------------------------------------------
-- Após aplicar esta migração:
-- 1. Habilitar pg_net no Dashboard se não estiver habilitado
-- 2. Configurar app.settings.supabase_url e supabase_service_role_key
-- 3. Deploy da Edge Function import-parse-worker
-- 4. Validar com um PDF de teste
-- -----------------------------------------------------
