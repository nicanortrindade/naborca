-- 1) Ver se o cron está rodando:
select jobname, schedule, active from cron.job where jobname like 'import-parse-worker-%' order by jobname;

-- 2) Ver respostas HTTP (pg_net guarda histórico):
select
  r.id,
  r.created,
  r.status_code,
  r.content::text as content_snippet
from net._http_response r
order by r.created desc
limit 20;

-- 3) Ver se está criando itens AGORA:
select count(*) as items_last_5min
from public.import_ai_items
where created_at > now() - interval '5 minutes';

-- 4) Ver tasks recentes e erros:
select status, count(*) from public.import_parse_tasks group by status order by status;

select id, status, locked_by, locked_at, last_error, updated_at
from public.import_parse_tasks
order by updated_at desc
limit 30;
