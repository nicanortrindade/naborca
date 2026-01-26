# PHASE 2.2 - PERFORMANCE TUNING (A)

## Overview
This phase optimizes the database persistence layer by introducing configurable batch inserts. Previously, items were inserted in small fixed chunks or individually, which could be slow for large budgets.

## Configuration (Env Vars)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `USE_BATCH_INSERT` | `false` | Set to `true`, `1`, or `yes` to enable the new bulk insert logic. |
| `BATCH_SIZE` | `1000` | Number of rows per insert request (min 100, max 5000). |

## Telemetry & Metrics
Performance metrics are now logged in the `import_ai_summaries.header` JSONB column under the `performance` key.

### Example metric payload:
```json
"performance": {
  "use_batch_insert": true,
  "batch_size": 1000,
  "db_insert_ms_total": 542,
  "db_insert_batches": 3,
  "db_insert_avg_batch_size": 1000,
  "db_insert_fallback_used": false
}
```

## Validation Query
To check the performance of a specific job:
```sql
select 
  header->'performance' as speed_stats,
  header->>'model_used_final' as model,
  items_count,
  created_at
from import_ai_summaries
where job_id = 'YOUR_JOB_ID';
```

## Rollout Strategy
1. **Default State**: The feature is strictly opt-in (`USE_BATCH_INSERT` defaults to false).
2. **Safe Fallback**: If the batch insert fails (network/timeout), the worker automatically retries once and then falls back to the legacy insertion method to ensure data is not lost.
3. **Audit**: Use the query above to compare `db_insert_ms_total` between old and new methods.
