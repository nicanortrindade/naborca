# PHASE 2.2B - PARALLEL CHUNKS

## Overview
This phase introduces parallel processing for AI extraction chunks to reduce "wall-clock" time. Instead of processing Chunk 1 -> Chunk 2 -> Chunk 3 sequentially, we can now process `N` chunks simultaneously.

## Configuration (Env Vars)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `CHUNK_CONCURRENCY` | `1` | Number of simultaneous chunks to process (min 1, max 6). |
| `USE_BATCH_INSERT` | `false` | (From Phase 2.2A) Bulk insert toggle. |

## How to Enable
To speed up extraction, set `CHUNK_CONCURRENCY` to `2` or `3` in the Supabase Dashboard.
**Recommendation:** Start with `2` and monitor for Rate Limits (429). Do not exceed `5`.

## Safety Mechanisms
1. **Fallback to Serial**: If the worker detects Rate Limits (Status 429) or a high failure rate in the first few chunks, it automatically aborts the parallel pool and processes the remaining chunks sequentially.
2. **Backoff**: Individual chunks retry after 1s if a transient 429 is encountered.
3. **Concurrency Clamp**: The code enforces a hard limit of 6 to prevent accidental flag misconfiguration causing DOS.

## Validation Query
Check if parallelism was used and effective:
```sql
select 
  header->'performance'->>'parallel_enabled' as parallel,
  header->'performance'->>'chunk_concurrency' as concurrency,
  header->'performance'->>'chunk_wall_ms_total' as wall_time_ms,
  header->'performance'->>'gemini_ms_total' as api_time_ms,
  header->'performance'->>'parallel_fallback_used' as fallback_trigger,
  items_count
from import_ai_summaries
where job_id = 'YOUR_JOB_ID';
```

Expected Result (Concurrency 2): `wall_time_ms` should be significantly lower than `api_time_ms`.
