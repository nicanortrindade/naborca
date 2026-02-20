
-- Enable necessary extensions for scheduling and HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove existing job if it exists to avoid duplicates
SELECT cron.unschedule('invoke-import-watchdog') 
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-import-watchdog');

-- Schedule the import-watchdog job to run every 2 minutes
SELECT cron.schedule(
  'invoke-import-watchdog',
  '*/2 * * * *', -- Every 2 minutes
  $$
    SELECT net.http_post(
      url:='https://cgebiryqfqheyazwtzzm.supabase.co/functions/v1/import-watchdog',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        -- Try to fetch the key from the vault or use a placeholder if not available.
        -- User: If this fails, replace the subquery with your actual service role key.
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
      ),
      body:='{}'::jsonb
    ) as request_id;
  $$
);

-- Output verification query
SELECT * FROM cron.job WHERE jobname = 'invoke-import-watchdog';
