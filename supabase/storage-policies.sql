-- =============================================================================
-- OPImaPPA — Storage buckets & policies
-- =============================================================================
-- Bucket:
--   `photos`      → privato, file foto dei mapping entry (1 cartella per entry)
--   `planimetrie` → pubblico in lettura, immagini e PDF delle planimetrie
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BUCKET: photos (privato)
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'photos',
  'photos',
  false,
  10485760, -- 10 MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can upload photos to accessible mapping entries"  ON storage.objects;
DROP POLICY IF EXISTS "Users can view photos from accessible mapping entries"  ON storage.objects;
DROP POLICY IF EXISTS "Users can update photos in accessible mapping entries"  ON storage.objects;
DROP POLICY IF EXISTS "Users can delete photos from accessible mapping entries" ON storage.objects;

-- Path convention: `{mappingEntryId}/{photoId}.jpg`

CREATE POLICY "Users can upload photos to accessible mapping entries"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'photos'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.mapping_entries me
      JOIN public.projects p ON p.id = me.project_id
      WHERE me.id::text = (storage.foldername(name))[1]
        AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
    )
  );

CREATE POLICY "Users can view photos from accessible mapping entries"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'photos'
    AND (
      (auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.mapping_entries me
        JOIN public.projects p ON p.id = me.project_id
        WHERE me.id::text = (storage.foldername(name))[1]
          AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
      ))
      OR public.is_admin()
    )
  );

CREATE POLICY "Users can update photos in accessible mapping entries"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'photos'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.mapping_entries me
      JOIN public.projects p ON p.id = me.project_id
      WHERE me.id::text = (storage.foldername(name))[1]
        AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
    )
  );

CREATE POLICY "Users can delete photos from accessible mapping entries"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'photos'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.mapping_entries me
      JOIN public.projects p ON p.id = me.project_id
      WHERE me.id::text = (storage.foldername(name))[1]
        AND (p.owner_id = auth.uid() OR p.accessible_users @> jsonb_build_array(auth.uid()::text))
    )
  );

-- -----------------------------------------------------------------------------
-- BUCKET: planimetrie (pubblico in lettura)
-- -----------------------------------------------------------------------------
-- Le URL delle planimetrie vengono servite direttamente al client; le
-- scritture restano riservate agli utenti autenticati.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'planimetrie',
  'planimetrie',
  true,
  52428800, -- 50 MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Authenticated can upload planimetrie" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update planimetrie" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete planimetrie" ON storage.objects;

CREATE POLICY "Authenticated can upload planimetrie"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'planimetrie');

CREATE POLICY "Authenticated can update planimetrie"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'planimetrie');

CREATE POLICY "Authenticated can delete planimetrie"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'planimetrie');
