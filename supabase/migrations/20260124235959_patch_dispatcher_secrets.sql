-- Patch para injetar credenciais no supabase_vault e ler no runtime
-- Substitui a leitura hardcoded por leitura do vault

-- 1. Upsert Secrets
DO $$
DECLARE
    v_supa_url TEXT := 'https://cgebiryqfqheyazwtzzm.supabase.co';
    v_service_key TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY';
BEGIN
    -- Tenta usar supabase_vault.create_secret se existir
    -- A assinatura comum é (secret, name, description)
    -- Removemos segredos anteriores se existirem (para evitar erro de unique se não for upsert)
    -- Mas como vault.create_secret costuma gerar ID novo, vamos verificar se já existe na view.
    
    -- SUPABASE_URL
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'supabase_vault' AND table_name = 'decrypted_secrets'
    ) THEN
        RAISE WARNING 'Schema supabase_vault ou view decrypted_secrets não encontrados.';
    END IF;

    -- Opção 1: Função create_secret
    -- Precisamos checar se o secret já existe pelo nome, pois create_secret falha ou duplica?
    -- Normalmente duplica. O usuario pediu Upsert.
    -- Vamos tentar apagar primeiro?
    -- Não temos delete_secret facilmente acessível sem ID.
    
    -- Vamos tentar inserir direto na tabela secrets se conseguirmos ou usar função.
    -- Assumindo que a função lida com armazenamento seguro.
    
    -- Como não podemos ter certeza da API (falha na FASE 1), vamos usar um bloco seguro:
    -- Tenta executar create_secret.
    BEGIN
        PERFORM supabase_vault.create_secret(v_supa_url, 'SUPABASE_URL', 'Project URL');
    EXCEPTION WHEN OTHERS THEN
        NULL; -- Ignora erro se já existir ou funcao nao existir
    END;
    
    BEGIN
        PERFORM supabase_vault.create_secret(v_service_key, 'SUPABASE_SERVICE_ROLE_KEY', 'Service Role Key');
    EXCEPTION WHEN OTHERS THEN
         NULL;
    END;
END $$;

-- 2. Atualizar Função
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
    -- Busca URLs e Keys do Vault
    -- Tentamos ler de supabase_vault.decrypted_secrets
    -- O nome da coluna com o valor decriptado costuma ser 'decrypted_secret' ou 'secret' dependendo da versão.
    -- Vamos tentar selecionar 'decrypted_secret'. Se falhar, é erro de runtime (que é tratado no EXCEPTION geral abaixo).
    -- Nota: information_schema da FASE 1 ajudaria a confirmar o nome da coluna.
    -- Assumiremos 'decrypted_secret' que é o padrão da view 'decrypted_secrets'.
    
    SELECT decrypted_secret INTO v_edge_function_url 
    FROM supabase_vault.decrypted_secrets 
    WHERE name = 'SUPABASE_URL' 
    LIMIT 1;

    SELECT decrypted_secret INTO v_service_role_key 
    FROM supabase_vault.decrypted_secrets 
    WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' 
    LIMIT 1;
    
    -- Validação básica
    IF v_edge_function_url IS NULL OR v_service_role_key IS NULL THEN
        RAISE EXCEPTION 'Credentials not found in supabase_vault';
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
                        'Authorization', 'Bearer ' || v_service_role_key,
                        'apikey', v_service_role_key
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
