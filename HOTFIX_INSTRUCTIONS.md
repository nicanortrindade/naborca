# HOTFIX VALIDATION & INSTRUCTIONS

## 1. Context check
The `import-extract-worker` has been patched to:
- Ignore `extracted_completed_at` (no longer waits for it).
- Rely solely on `extracted_text`.
- Log preflight status properly.
- Return explicit `ok: false, reason: "all_chunks_failed"` if processing yields no data, instead of 500.

## 2. Validation Steps
To validate the fix without waiting for a new upload, follow these steps with a `job_id` that is currently stuck (where `extracted_text` exists but `extracted_completed_at` is NULL).

1.  **Trigger Extraction**: In the App, click "Extrair Itens" for the stuck job.
2.  **Verify Database Inserts**:
    Run the following SQL queries (replace `'COLE_JOB_ID'` with your actual Job ID):

    ```sql
    -- Check items count (should be > 0)
    select count(*) from import_ai_items where job_id = 'COLE_JOB_ID';

    -- Check summary existence (should be 1)
    select count(*) from import_ai_summaries where job_id = 'COLE_JOB_ID';

    -- Check model usage and summary text
    select
      header->>'model_used' as model_used_final,
      notes as summary_text,
      created_at
    from import_ai_summaries
    where job_id = 'COLE_JOB_ID'
    order by created_at desc
    limit 1;
    ```
3.  **Expected Result**:
    - `import_ai_items` count >= 1.
    - `model_used_final` should be `flash` variant (e.g. `gemini-2.0-flash`).

## 3. SQL Workaround (Manual Test Only)
If you want to manually fix the data state for existing rows just to test if the OLD worker logic would have worked (or for general cleanup), you can run this. **Do NOT run this if checking the Hotfix**, as the Hotfix specifically handles the NULL state.

```sql
update import_files
set extracted_completed_at = now()
where extracted_text is not null
  and extracted_completed_at is null;
```
