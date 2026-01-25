-- A) Tabelas do supabase_vault
select table_schema, table_name
from information_schema.tables
where table_schema = 'supabase_vault'
order by table_name;

-- B) Funções do supabase_vault
select
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'supabase_vault'
order by p.proname, args;

-- C) Colunas das tabelas relevantes (se existirem)
select table_name, column_name, data_type
from information_schema.columns
where table_schema='supabase_vault'
  and table_name in ('secrets','secret','vault_secrets')
order by table_name, ordinal_position;
