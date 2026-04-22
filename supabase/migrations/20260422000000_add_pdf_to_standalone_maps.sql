ALTER TABLE standalone_maps ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE standalone_maps ADD COLUMN IF NOT EXISTS grid_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE standalone_maps ADD COLUMN IF NOT EXISTS grid_config jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE standalone_maps ADD COLUMN IF NOT EXISTS points jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE standalone_maps ADD COLUMN IF NOT EXISTS pdf_url text;
ALTER TABLE standalone_maps ADD COLUMN IF NOT EXISTS original_format text;
