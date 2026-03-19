DELETE FROM budget_items WHERE budget_id = (SELECT result_budget_id FROM import_jobs ORDER BY created_at DESC LIMIT 1);
DELETE FROM ONLY import_hydration_issues WHERE budget_id = (SELECT result_budget_id FROM import_jobs ORDER BY created_at DESC LIMIT 1);

SELECT * FROM finalize_import_to_budget(
  (SELECT id FROM import_jobs ORDER BY created_at DESC LIMIT 1),
  NULL,
  (SELECT settings FROM budgets WHERE id = (SELECT result_budget_id FROM import_jobs ORDER BY created_at DESC LIMIT 1)),
  '{}'::jsonb
);

SELECT level, type, COUNT(*)
FROM budget_items
WHERE budget_id = (SELECT result_budget_id FROM import_jobs ORDER BY created_at DESC LIMIT 1)
GROUP BY level, type
ORDER BY level, type;

-- Não deve ter grupo nível 5
SELECT description, level, type, hydration_details->>'path_key' AS path_key
FROM budget_items
WHERE budget_id = (SELECT result_budget_id FROM import_jobs ORDER BY created_at DESC LIMIT 1)
  AND type = 'group' AND level = 5;
