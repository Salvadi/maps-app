-- Aggiunge colonna pdf_url alla tabella floor_plans
-- Usata per memorizzare l'URL Supabase Storage del PDF originale della planimetria
-- (disponibile solo se il piano è stato caricato come PDF)
ALTER TABLE floor_plans
ADD COLUMN IF NOT EXISTS pdf_url TEXT DEFAULT NULL;
