-- Agendamento do OCR Poker (a cada 1 minuto)
-- Substitui 'ocr-poker-cron' se já existir

SELECT cron.unschedule('ocr-poker-cron') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='ocr-poker-cron');

SELECT cron.schedule(
  'ocr-poker-cron',
  '* * * * *', -- Minuto a minuto
  $$
    SELECT net.http_post(
      url:='https://cgebiryqfqheyazwtzzm.supabase.co/functions/v1/ocr-poker',
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
