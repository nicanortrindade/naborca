BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- Remove jobs antigos (se existirem)
SELECT cron.unschedule('import-parse-worker-00') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='import-parse-worker-00');
SELECT cron.unschedule('import-parse-worker-30') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='import-parse-worker-30');

-- Recria jobs
SELECT cron.schedule(
  'import-parse-worker-00',
  '* * * * *',
  $$
    SELECT net.http_post(
      url:='https://cgebiryqfqheyazwtzzm.supabase.co/functions/v1/import-parse-worker',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1),
        'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
      ),
      body:='{}'::jsonb
    );
  $$
);

SELECT cron.schedule(
  'import-parse-worker-30',
  '* * * * *',
  $$
    SELECT pg_sleep(30);
    SELECT net.http_post(
      url:='https://cgebiryqfqheyazwtzzm.supabase.co/functions/v1/import-parse-worker',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1),
        'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
      ),
      body:='{}'::jsonb
    );
  $$
);

COMMIT;
