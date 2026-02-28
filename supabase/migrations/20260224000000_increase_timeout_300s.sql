-- Increase timeout for finalize function to 300s to handle heavy hydration
ALTER FUNCTION public.finalize_import_to_budget(uuid, uuid, jsonb, jsonb) 
SET statement_timeout = '300s';
