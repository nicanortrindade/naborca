# PHASE 2.2D - EMPTY CHUNKS HANDLING

## Overview
This phase refines the error classification logic. Previously, a chunk that returned 0 items (e.g., a chunk containing only legalese or headers) was treated the same as a failed chunk, sometimes triggering "Partial Extraction" status incorrectly.

## Changes
1. **Status Classification**:
   - `ok`: Chunk returned JSON with items > 0.
   - `empty`: Chunk returned valid JSON but with items = 0. **This is considered a SUCCESS.**
   - `failed`: Chunk timed out, network error, or invalid JSON.

2. **Reprocessing Logic**:
   - The Second Pass (Reprocess) now **ONLY** targets chunks with status `failed`.
   - `empty` chunks are skipped, saving API costs and time.

3. **Status Reporting**:
   - `extraction_reason` is set to `partial_extraction_chunks_failed` **ONLY** if there are remaining `failed` chunks after reprocessing.
   - If a job has 10 chunks, 9 ok and 1 empty, it finishes as PERFECT SUCCESS (reason: `standard_success`).

## Metrics Update
The `performance` header now includes `chunks_empty`.

```json
"performance": {
  "chunks_ok": 12,
  "chunks_empty": 2,
  "chunks_failed": 0,
  "failed_chunks_after_reprocess": 0
}
```

## Validation Query
Isolate jobs where empty chunks occurred but no failure was recorded:
```sql
select 
  job_id,
  header->'performance'->>'chunks_empty' as empty_count,
  header->'performance'->>'chunks_failed' as failed_count,
  header->'performance'
from import_ai_summaries
where header->'performance'->>'chunks_empty' != '0'
order by created_at desc;
```
