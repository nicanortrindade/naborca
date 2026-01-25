-- A) achar funções que contenham net.http_post e/ou import-parse-worker
select
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  p.oid
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    pg_get_functiondef(p.oid) ilike '%net.http_post%'
    or pg_get_functiondef(p.oid) ilike '%import-parse-worker%'
    or pg_get_functiondef(p.oid) ilike '%dispatch_parse%'
  )
order by p.proname;
