
select 
  id,
  job_id,
  metadata->'stageB'->>'llm_sdk' as sdk,
  jsonb_array_length(metadata->'stageB'->'llm_model_attempts') as valid_attempts,
  metadata->'stageB'->'debug'->'index_gate' as gate_preserved,
  metadata->'stageB'->>'llm_model_actual' as model_actual
from import_files 
where job_id = '87b1ceb3-1772-4dd2-99d7-eda32354dead';
