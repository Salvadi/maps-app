# Debug: Photo Upload Not Working

## Step 1: Verifica Policies Applicate

**PRIMA DI TUTTO**, devi applicare le policies SQL su Supabase:

1. Vai su **Supabase Dashboard** → **SQL Editor**
2. Apri il file `docs/fix-admin-photo-upload-policies.sql`
3. Copia TUTTO il contenuto
4. Incolla nello SQL Editor
5. Clicca **"Run"**
6. Verifica che non ci siano errori

**Senza le policies, le foto NON possono essere caricate su Supabase Storage!**

## Step 2: Verifica Stato nel Browser

Apri la **Console del browser** (F12 → Console) e esegui questi comandi:

### 2.1 Verifica foto in IndexedDB

```javascript
// Apri IndexedDB per vedere le foto
const request = indexedDB.open('opimappa-db');
request.onsuccess = function(event) {
  const db = event.target.result;
  const tx = db.transaction(['photos'], 'readonly');
  const store = tx.objectStore('photos');
  const getAllRequest = store.getAll();

  getAllRequest.onsuccess = function() {
    console.log('📸 Foto in IndexedDB:', getAllRequest.result);
    console.log('📸 Foto non caricate:', getAllRequest.result.filter(p => !p.uploaded));
  };
};
```

**Cosa cercare:**
- Ci sono foto con `uploaded: false`? ✅ BENE
- Se non ci sono foto, il problema è nel salvataggio locale

### 2.2 Verifica sync queue

```javascript
// Verifica sync queue
const request = indexedDB.open('opimappa-db');
request.onsuccess = function(event) {
  const db = event.target.result;
  const tx = db.transaction(['syncQueue'], 'readonly');
  const store = tx.objectStore('syncQueue');
  const getAllRequest = store.getAll();

  getAllRequest.onsuccess = function() {
    console.log('🔄 Sync Queue:', getAllRequest.result);
    console.log('📸 Photo sync items:', getAllRequest.result.filter(i => i.entityType === 'photo'));
    console.log('❌ Failed items:', getAllRequest.result.filter(i => i.synced === 0));
  };
};
```

**Cosa cercare:**
- Ci sono item di tipo 'photo' con `synced: 0`? → Le foto sono in coda
- Ci sono item di tipo 'photo' con `synced: 1`? → Il sync è riuscito
- Non ci sono item 'photo'? → Le foto non sono state aggiunte alla coda

### 2.3 Controlla errori di sync

Nella Console, cerca messaggi che iniziano con:
- `❌ Failed to sync photo` → Errore nel caricamento
- `⚠️ Conflict detected` → Conflitto risolto
- `✅ Synced photo` → Foto caricata con successo

## Step 3: Trigger Sync Manuale

1. Nell'app, clicca il pulsante **"Sync"**
2. Aspetta che finisca
3. Guarda la console per errori

Se vedi errori come:
- `"new row violates row-level security policy"` → **Le policies NON sono state applicate**
- `"permission denied for table photos"` → **Le policies NON sono state applicate**
- `"Failed to upload to storage"` → **Le policies dello storage NON sono state applicate**

## Step 4: Verifica su Supabase

1. Vai su **Supabase Dashboard** → **Storage** → **photos**
2. Cerca le cartelle con l'ID della mapping entry
3. Le foto dovrebbero essere in `{mappingEntryId}/{photoId}.jpg`

## Step 5: Verifica Policies Attive

Nel **Supabase SQL Editor**, esegui:

```sql
-- Verifica policies tabella photos
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'photos'
ORDER BY policyname;

-- Verifica policies storage
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname LIKE '%photo%' OR policyname LIKE '%Admin%'
ORDER BY policyname;
```

**Dovresti vedere:**
- `Admins can create photos` (INSERT)
- `Admins can update all photos` (UPDATE)
- `Admins can delete all photos` (DELETE)
- `Admins can upload photos to any mapping entry` (INSERT su storage)

**Se non vedi queste policies, NON sono state applicate!**

## Soluzioni Comuni

### Problema: "Row-level security policy violation"

**Causa:** Le policies non sono state applicate su Supabase.

**Soluzione:** Esegui lo script SQL `docs/fix-admin-photo-upload-policies.sql` nel Supabase SQL Editor.

### Problema: Le foto sono in IndexedDB ma non nella sync queue

**Causa:** Il sync della mapping entry non è stato eseguito dopo aver aggiunto le foto.

**Soluzione:**
1. Clicca il pulsante "Sync" manualmente
2. Aspetta che finisca
3. Ricontrolla la sync queue

### Problema: Le foto sono nella sync queue ma con synced: 0

**Causa:** Il sync sta fallendo, probabilmente per le policies mancanti.

**Soluzione:**
1. Controlla la console per errori specifici
2. Applica le policies SQL se non l'hai fatto
3. Riprova il sync manuale

### Problema: Le foto vengono caricate ma non si vedono su Supabase

**Causa:** Potrebbe essere un problema di cache del browser o delle policies di SELECT.

**Soluzione:**
1. Fai refresh del browser (Ctrl+Shift+R)
2. Controlla direttamente su Supabase Dashboard → Storage
3. Verifica le policies di SELECT sullo storage

## Informazioni di Debug

Quando chiedi aiuto, fornisci:
1. Output della console quando fai sync
2. Risultati dei comandi IndexedDB sopra
3. Conferma se hai applicato le policies SQL
4. Eventuali errori specifici che vedi

## Test Rapido

Esegui questo nella console del browser:

```javascript
// Test completo rapido
(async () => {
  const request = indexedDB.open('opimappa-db');

  request.onsuccess = async (event) => {
    const db = event.target.result;

    // Conta foto
    const txPhotos = db.transaction(['photos'], 'readonly');
    const photosStore = txPhotos.objectStore('photos');
    const photos = await new Promise(resolve => {
      const req = photosStore.getAll();
      req.onsuccess = () => resolve(req.result);
    });

    // Conta sync queue
    const txQueue = db.transaction(['syncQueue'], 'readonly');
    const queueStore = txQueue.objectStore('syncQueue');
    const queue = await new Promise(resolve => {
      const req = queueStore.getAll();
      req.onsuccess = () => resolve(req.result);
    });

    console.log('=== PHOTO UPLOAD DEBUG ===');
    console.log(`📸 Foto totali: ${photos.length}`);
    console.log(`📸 Foto non caricate: ${photos.filter(p => !p.uploaded).length}`);
    console.log(`🔄 Item in sync queue: ${queue.length}`);
    console.log(`🔄 Photo items in queue: ${queue.filter(i => i.entityType === 'photo').length}`);
    console.log(`❌ Photo items non sincronizzati: ${queue.filter(i => i.entityType === 'photo' && i.synced === 0).length}`);
    console.log('=========================');

    if (photos.filter(p => !p.uploaded).length > 0 && queue.filter(i => i.entityType === 'photo' && i.synced === 0).length === 0) {
      console.warn('⚠️ PROBLEMA: Ci sono foto non caricate ma non ci sono item nella sync queue!');
      console.warn('⚠️ SOLUZIONE: Fai sync manualmente per aggiungere le foto alla coda');
    }
  };
})();
```

Questo ti darà un riepilogo immediato dello stato.
