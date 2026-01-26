# PHASE 2.1 - OBSERVABILITY

## Overview
This phase adds telemetry to the `import-extract-worker` by persisting execution status, progress, and metrics directly into the `import_files` table. This allows for real-time monitoring and post-mortem debugging of the extraction process without relying solely on ephemeral logs.

## New Columns in `import_files`

| Column | Type | Description |
| :--- | :--- | :--- |
| `extraction_status` | text | Current state: `running`, `success`, `success_no_items`, `failed` |
| `extraction_started_at` | timestamptz | Exact start time of the extraction logic |
| `extraction_completed_at` | timestamptz | Exact completion time (success or failure) |
| `extraction_duration_ms` | int | Total duration in milliseconds |
| `extraction_chunks_total` | int | Total number of text chunks to process |
| `extraction_chunks_done` | int | Number of chunks processed so far |
| `extraction_items_inserted` | int | Running count of items found and intended for insertion |
| `extraction_summary_saved` | boolean | Whether the summary was successfully UPSERTed |
| `extraction_reason` | text | Clarification for status (e.g., `no_budget_items_found`) |
| `extraction_last_error` | text | Truncated error message if failed |

## Debug Queries

### Check Job Status
```sql
select 
  job_id, 
  extraction_status, 
  extraction_chunks_done, 
  extraction_chunks_total,
  extraction_items_inserted, 
  extraction_summary_saved,
  extraction_started_at, 
  extraction_completed_at, 
  extraction_duration_ms,
  extraction_reason, 
  extraction_last_error
from import_files
where job_id = 'YOUR_JOB_ID';
```

### List Active Extractions
```sql
select 
  job_id, 
  extraction_started_at, 
  extraction_chunks_done, 
  extraction_chunks_total
from import_files
where extraction_status = 'running'
order by extraction_started_at desc
limit 50;
```

### Analyze "No Items" Results
```sql
select 
  job_id, 
  extraction_duration_ms, 
  extraction_chunks_total
from import_files
where extraction_status = 'success_no_items';
```
