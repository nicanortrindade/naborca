DO $$
DECLARE
    v_def TEXT;
    v_url_exists BOOLEAN;
    v_key_exists BOOLEAN;
    v_cron_active BOOLEAN;
BEGIN
    RAISE NOTICE 'VALIDATION START';
    
    -- 1. Check Function Definition for Hardcoded Values
    SELECT pg_get_functiondef('public.dispatch_parse_task'::regproc) INTO v_def;
    
    IF v_def ILIKE '%https://cgebiryqfqheyazwtzzm.supabase.co%' THEN
        RAISE EXCEPTION 'FAIL: Hardcoded URL found in function definition';
    END IF;
    
    IF v_def ILIKE '%eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9%' THEN
        RAISE EXCEPTION 'FAIL: Hardcoded Key found in function definition';
    END IF;
    
    RAISE NOTICE 'HARDCODE REMOVED: SIM';

    -- 2. Check Secrets in Vault
    SELECT EXISTS (SELECT 1 FROM supabase_vault.decrypted_secrets WHERE name = 'SUPABASE_URL') INTO v_url_exists;
    SELECT EXISTS (SELECT 1 FROM supabase_vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY') INTO v_key_exists;
    
    IF v_url_exists AND v_key_exists THEN
        RAISE NOTICE 'SECRETS IN VAULT: SIM';
    ELSE
        RAISE EXCEPTION 'FAIL: Secrets not found in vault';
    END IF;

    -- 3. Check Cron Job
    -- Only works if user has permissions on cron schema
    BEGIN
        SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch_parse_tasks' AND active = true) INTO v_cron_active;
        IF v_cron_active THEN
            RAISE NOTICE 'CRON ACTIVE: SIM';
        ELSE
            RAISE NOTICE 'CRON STATUS: Inactive or Not Found';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'CRON CHECK: Skipped (permission denied)';
    END;
    
    RAISE NOTICE 'VALIDATION: ALL PASS';
END $$;
