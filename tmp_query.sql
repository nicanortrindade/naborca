\copy (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'finalize_import_to_budget' AND pronamespace = 'public'::regnamespace ORDER BY pronargs DESC LIMIT 1) TO STDOUT;
