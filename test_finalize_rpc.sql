-- Test Script for finalize_import_to_budget
-- 1. Create a dummy user (if not exists, or pick one)
DO $$
DECLARE v_user_id uuid;
v_job_failed_id uuid;
v_job_empty_id uuid;
v_res json;
BEGIN
SELECT id INTO v_user_id
FROM auth.users
LIMIT 1;
IF v_user_id IS NULL THEN RAISE NOTICE 'No user found for test.';
RETURN;
END IF;
-- TEST CASE 1: Failed Job (Oversized simulation)
INSERT INTO public.import_jobs (user_id, status, current_step, last_error)
VALUES (
        v_user_id,
        'failed',
        'waiting_user_extraction_failed',
        'Simulated Oversized Failure'
    )
RETURNING id INTO v_job_failed_id;
-- Call RPC
SELECT public.finalize_import_to_budget(v_job_failed_id, v_user_id, '{}'::jsonb) INTO v_res;
RAISE NOTICE 'Test 1 (Failed Job) Result: %',
v_res;
IF (v_res->>'ok')::boolean = false
AND (v_res->>'reason') = 'extraction_failed_or_empty' THEN RAISE NOTICE 'PASS: Test 1 correctly rejected failed job.';
ELSE RAISE EXCEPTION 'FAIL: Test 1 did not reject failed job correctly.';
END IF;
-- TEST CASE 2: Empty Job (No items)
INSERT INTO public.import_jobs (user_id, status, current_step)
VALUES (v_user_id, 'completed', 'extraction_completed')
RETURNING id INTO v_job_empty_id;
-- Call RPC
SELECT public.finalize_import_to_budget(v_job_empty_id, v_user_id, '{}'::jsonb) INTO v_res;
RAISE NOTICE 'Test 2 (Empty Job) Result: %',
v_res;
IF (v_res->>'ok')::boolean = false
AND (v_res->>'reason') = 'extraction_failed_no_items' THEN RAISE NOTICE 'PASS: Test 2 correctly rejected empty job.';
ELSE RAISE EXCEPTION 'FAIL: Test 2 did not reject empty job correctly.';
END IF;
-- CLEANUP
DELETE FROM public.import_jobs
WHERE id IN (v_job_failed_id, v_job_empty_id);
END $$;