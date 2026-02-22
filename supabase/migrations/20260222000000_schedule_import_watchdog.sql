
-- Enable pg_net to make HTTP requests
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Schedule the watchdog to run every 2 minutes
-- NOTE: You must replace 'YOUR_PROJECT_REF' and 'YOUR_ANON_KEY' or setup secure headers
-- For local/self-hosted dev, we simulate logic. For Supabase Cloud, project ref is needed.
-- Since this is generated, we'll use a placeholder URL structure for Supabase.

SELECT cron.schedule(
  'invoke-import-watchdog', -- name of the cron job
  '*/2 * * * *', -- every 2 minutes
  $$
  select net.http_post(
      url:='https://cgebiryqfqheyazwtzzm.supabase.co/functions/v1/import-watchdog',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}'::jsonb,
      body:='{}'::jsonb
  ) as request_id;
  $$
);
