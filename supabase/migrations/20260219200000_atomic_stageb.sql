
-- Migration to add atomic merge function for Stage B metadata
CREATE OR REPLACE FUNCTION atomic_merge_stageb_metadata(
  file_id UUID,
  stageb_data JSONB
) RETURNS VOID AS $$
BEGIN
  UPDATE import_files
  SET metadata = COALESCE(metadata, '{}'::jsonb) || 
                 jsonb_build_object('stageB', 
                   COALESCE(metadata->'stageB', '{}'::jsonb) || stageb_data
                 )
  WHERE id = file_id;
END;
$$ LANGUAGE plpgsql;
