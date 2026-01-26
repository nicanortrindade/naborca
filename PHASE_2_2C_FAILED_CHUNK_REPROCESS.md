# PHASE 2.2C - FAILED CHUNK REPROCESS & SMART CHUNKING

## Overview
This phase adds robustness to the extraction pipeline by addressing two key issues:
1. **Broken Text Context**: Splitting text blindly every N characters could cut tables or lines in half. We now try to split on newlines.
2. **Partial Failures**: If 1 out of 20 chunks fails (timeout/network/bad JSON), the job previously finished with missing items. Now, we perform a "Second Pass" to reprocess only the failed chunks.

## Configuration (Env Vars)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `ENABLE_FAILED_CHUNK_REPROCESS` | `false` | Enable the second pass for failed chunks. Recommend setting to `true`. |
| `CHUNK_BOUNDARY_BY_NEWLINE` | `true` | Attempt to split text at the nearest newline instead of hard cut. |

## How Reprocessing Works
1. The worker processes all chunks (Serial or Parallel) as usual.
2. It collects the indices of chunks that failed (network error, invalid JSON, or dry run).
3. If `ENABLE_FAILED_CHUNK_REPROCESS` is true, it iterates over these failed indices one by one (Serial).
4. It sends a stricter prompt ("Return JSON ONLY") to the AI.
5. If successful, the new items are merged into the final result.

## Metrics & Auditing
The `performance` object in `import_ai_summaries.header` now includes:

```json
"performance": {
  "chunk_boundary_mode": "newline",
  "failed_chunks_initial": 2,
  "failed_chunks_after_reprocess": 0,
  "reprocess_attempted": true,
  "reprocess_succeeded_count": 2,
  "reprocess_ms_total": 4500
}
```

## Validation Query
```sql
select 
  job_id,
  header->'performance'->>'failed_chunks_initial' as initial_fails,
  header->'performance'->>'failed_chunks_after_reprocess' as final_fails,
  header->'performance'->>'reprocess_attempted' as did_retry,
  items_count
from import_ai_summaries
where job_id = 'YOUR_JOB_ID';
```
