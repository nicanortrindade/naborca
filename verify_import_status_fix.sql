-- Verification Queries for Import Status Fix
-- 1. Check specific job details (Replace 'JOB_ID_HERE' with actual UUID)
-- Expected: Status should be 'done' if result_budget_id exists. last_error should be null.
SELECT id,
    status,
    last_error,
    result_budget_id,
    document_context->'user_action' as user_action
FROM import_jobs
WHERE result_budget_id IS NOT NULL;
-- 2. Count items for validation
-- Replace 'JOB_ID_HERE' and 'BUDGET_ID_HERE'
SELECT (
        SELECT count(*)
        FROM import_items
        WHERE job_id = 'JOB_ID_HERE'
    ) as import_items_count,
    (
        SELECT count(*)
        FROM budget_items
        WHERE budget_id = 'BUDGET_ID_HERE'
    ) as budget_items_count;
-- 3. Assert Consistency
-- Should return 0 rows. If it returns rows, these are INCONSISTENT jobs.
SELECT id,
    status,
    result_budget_id,
    last_error
FROM import_jobs
WHERE result_budget_id IS NOT NULL
    AND status NOT IN ('done', 'completed')
    AND (
        SELECT count(*)
        FROM import_items
        WHERE job_id = import_jobs.id
    ) > 0;