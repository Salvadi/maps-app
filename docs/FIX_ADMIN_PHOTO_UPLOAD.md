# Fix: Admin Photo Upload Issue

## Problema

Gli admin non riuscivano a caricare foto quando modificavano le mappature. Le foto venivano salvate localmente nell'IndexedDB ma non venivano sincronizzate su Supabase Storage.

## Causa

Il problema aveva **due componenti**:

### 1. Problema Applicativo (RISOLTO)

Nel file `src/components/MappingPage.tsx`, quando si modificava una mappatura esistente, le nuove foto non venivano mai salvate nel database locale.

**Fix applicato:**
- Importata la funzione `addPhotosToMapping`
- Tracciato il numero iniziale di foto per distinguere le esistenti dalle nuove
- Compressione solo delle nuove foto (non ri-compressione delle esistenti)
- Chiamata a `addPhotosToMapping` per salvare le nuove foto quando si modifica una mappatura

### 2. Problema Policies Supabase (DA APPLICARE MANUALMENTE)

Le policies RLS di Supabase permettevano agli admin solo di **visualizzare** (SELECT) le foto, ma non di **crearle o caricarle** (INSERT).

**Policies mancanti:**
- INSERT sulla tabella `photos` per admin
- INSERT sullo storage bucket `photos` per admin
- UPDATE e DELETE per completezza

## Come Applicare il Fix

### Step 1: Code Fix (Già Applicato)

Il codice è già stato modificato e committato. Le modifiche sono in `src/components/MappingPage.tsx`.

### Step 2: Applicare le Policies su Supabase

1. **Accedi al Dashboard di Supabase**
   - Vai su https://supabase.com
   - Seleziona il tuo progetto

2. **Apri SQL Editor**
   - Nel menu laterale, clicca su "SQL Editor"
   - Crea una nuova query

3. **Esegui lo Script SQL**
   - Copia il contenuto del file `docs/fix-admin-photo-upload-policies.sql`
   - Incolla nello SQL Editor
   - Clicca "Run" per eseguire

4. **Verifica le Policies**
   - Le query di verifica alla fine dello script mostreranno tutte le policies create
   - Dovresti vedere le nuove policies per admin:
     - `Admins can create photos`
     - `Admins can update all photos`
     - `Admins can delete all photos`
     - `Admins can upload photos to any mapping entry`
     - `Admins can update photos in any mapping entry`
     - `Admins can delete photos from any mapping entry`

### Step 3: Test

1. **Login come admin**
2. **Modifica una mappatura esistente**
3. **Aggiungi una o più foto**
4. **Salva la mappatura**
5. **Fai sync manualmente** (pulsante sync nell'interfaccia)
6. **Verifica che le foto siano su Supabase:**
   - Dashboard > Storage > photos bucket
   - Dovresti vedere le foto caricate nella cartella corrispondente al mapping entry ID

## Files Modificati

### Codice
- `src/components/MappingPage.tsx` - Fix per salvare le nuove foto quando si modifica una mappatura

### Documentazione
- `docs/fix-admin-photo-upload-policies.sql` - Script SQL con le policies mancanti
- `docs/FIX_ADMIN_PHOTO_UPLOAD.md` - Questo documento

## Policies Create

### Tabella `photos`

```sql
-- Admins can insert photos (metadata)
CREATE POLICY "Admins can create photos"
  ON public.photos
  FOR INSERT
  WITH CHECK (public.is_admin());

-- Admins can update photos (metadata)
CREATE POLICY "Admins can update all photos"
  ON public.photos
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Admins can delete photos
CREATE POLICY "Admins can delete all photos"
  ON public.photos
  FOR DELETE
  USING (public.is_admin());
```

### Storage Bucket `photos`

```sql
-- Admins can upload photos
CREATE POLICY "Admins can upload photos to any mapping entry"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'photos'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Similar policies for UPDATE and DELETE
```

## Note Importanti

1. **Le policies sono cumulative**: Gli admin avranno sia le loro policies specifiche che quelle degli utenti normali
2. **Sicurezza**: Le policies verificano sempre che l'utente sia autenticato e abbia il ruolo 'admin'
3. **Sincronizzazione**: Dopo l'upload locale, le foto vengono messe in coda per la sincronizzazione
4. **Auto-sync**: Se l'auto-sync è attivo, le foto verranno caricate automaticamente entro 60 secondi
5. **Sync manuale**: Puoi forzare la sincronizzazione usando il pulsante "Sync" nell'interfaccia

## Troubleshooting

### Le foto non si caricano ancora

1. **Verifica che l'utente sia admin:**
   ```sql
   SELECT email, role FROM public.profiles WHERE email = 'tua-email@example.com';
   ```

2. **Verifica che le policies siano attive:**
   ```sql
   SELECT policyname, cmd FROM pg_policies
   WHERE tablename IN ('photos') AND policyname LIKE '%Admin%';
   ```

3. **Controlla i log del browser:**
   - Apri DevTools (F12)
   - Vai su Console
   - Cerca errori relativi a "Supabase" o "photo upload"

4. **Controlla la sync queue:**
   - Le foto non caricate dovrebbero essere in `db.photos` con `uploaded: false`
   - Dovrebbero esserci item nella sync queue di tipo 'photo'

### Errore "new row violates row-level security policy"

Significa che le policies non sono state applicate correttamente. Ri-esegui lo script SQL.

### Le foto si caricano ma non si vedono

Verifica le policies di SELECT sullo storage bucket. Dovrebbero già essere corrette (incluse nel file `supabase-storage-policies.sql` originale).

## Commit

- Commit iniziale: Fix per salvare foto localmente quando si modifica una mappatura
- Commit attuale: Aggiunto script SQL per le policies mancanti e documentazione

## Data

2025-12-16
