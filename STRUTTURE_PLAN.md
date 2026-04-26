# Piano: Integrazione Strutture (Pareti, Soffitti, Cassonetti)

## Context

L'app gestisce già gli "attraversamenti" (sigillature di cavi/tubi). L'utente vuole mappare anche le **strutture** costruite (pareti, soffitti, cassonetti porta-impianto), con tipologici simili agli attraversamenti, marcatura via "perimetro" sulle planimetrie, e integrazione con lo stesso sistema SAL/contabilità del progetto.

---

## Decisione architetturale core

**Entità separata `StructureEntry` in una nuova tabella Dexie**, parallela a `MappingEntry`.

Non si estende `MappingEntry` con un campo `entryType` perché:
- Tutto il SAL engine, CostsTab e sync iterano `entry.crossings[]` direttamente
- Il FK `FloorPlanPoint.mappingEntryId` non può essere ambiguo
- Le strutture hanno campi diversi (superficie, lunghezza) incompatibili con `Crossing`

---

## Modifiche per area

### 1. `src/db/database.ts` — nuove interfacce + Dexie v11

**Nuove interfacce:**

```typescript
interface Structure {
  id: string;
  struttura: string;          // "Parete" | "Soffitto" | "Cassonetto porta-impianto" | "Altro"
  strutturaCustom?: string;
  tipoStruttura?: string;     // es. "Flessibile", "Rigido"
  tipologicoId?: string;      // → Project.typologies (category='struttura')
  superficie?: number;        // mq
  lunghezza?: number;         // ml (per cassonetti)
  notes?: string;
  salId?: string;             // → Sal per contabilità
}

interface StructureEntry {
  id: string;
  projectId: string;
  floor: string;
  room?: string;
  intervention?: string;
  photos: PhotoMetadata[];
  structures: Structure[];
  toComplete?: boolean;
  timestamp: number;
  createdBy: string;
  lastModified: number;
  modifiedBy: string;
  version: number;
  synced: 0 | 1;
}
```

**Modifiche a interfacce esistenti:**

```typescript
// Typology: aggiungere category
interface Typology {
  // ... campi esistenti invariati ...
  category?: 'attraversamento' | 'struttura';  // undefined = 'attraversamento' (retrocompatibile)
  struttura?: string;       // solo per category='struttura'
  tipoStruttura?: string;   // solo per category='struttura'
}

// TypologyPrice: aggiungere unità ml e category
interface TypologyPrice {
  // ... campi esistenti ...
  category?: 'attraversamento' | 'struttura';   // undefined = 'attraversamento'
  unit: 'piece' | 'sqm' | 'lm';               // 'lm' = metro lineare per cassonetti
}

// SyncQueueItem: aggiungere entityType
entityType: '...' | 'structure_entry';

// Photo: aggiungere entryType
interface Photo {
  // ... campi esistenti ...
  entryType?: 'mapping' | 'structure';  // undefined = 'mapping' (retrocompatibile)
}
```

**Dexie v11:**
```typescript
this.version(11).stores({
  // tutte le store v10 invariate...
  structureEntries: 'id, projectId, floor, createdBy, synced, timestamp'
})
```

Aggiungere `structureEntries!: Table<StructureEntry, string>` alla classe `MappingDatabase`.

---

### 2. `supabase/schema.sql` — nuove tabelle e colonne

**Nuova tabella `structure_entries`** (speculare a `mapping_entries`):
- Stesse colonne: `id, project_id, floor, room, intervention, structures JSONB, photos JSONB, to_complete, timestamp, last_modified, version, created_by, modified_by, synced`
- Indici su `project_id`, `floor`, `created_by`
- RLS speculare a `mapping_entries`

**`floor_plan_points`:**
```sql
ALTER TABLE floor_plan_points
  ALTER COLUMN mapping_entry_id DROP NOT NULL,
  ADD COLUMN structure_entry_id UUID REFERENCES structure_entries(id) ON DELETE CASCADE;
-- CHECK: esattamente uno dei due deve essere non-null
```

**`photos`:**
```sql
ALTER TABLE photos
  ALTER COLUMN mapping_entry_id DROP NOT NULL,
  ADD COLUMN structure_entry_id UUID REFERENCES structure_entries(id) ON DELETE CASCADE;
-- CHECK: esattamente uno dei due deve essere non-null
```

**`typology_prices`:**
```sql
ALTER TABLE typology_prices
  ADD COLUMN category TEXT NOT NULL DEFAULT 'attraversamento',
  ALTER COLUMN unit TYPE TEXT;  -- aggiungere 'lm' al CHECK
```

**TypeScript `FloorPlanPoint`:**
```typescript
interface FloorPlanPoint {
  // ...
  mappingEntryId?: string;      // ora opzionale
  structureEntryId?: string;    // nuovo campo
}
```

---

### 3. `src/db/structures.ts` — nuovo file CRUD

Speculare a `src/db/mappings.ts`. Funzioni principali:
- `createStructureEntry(data, photoBlobs)`
- `getStructureEntry(id)`
- `getStructureEntriesForProject(projectId, options?)` — online-first
- `updateStructureEntry(id, updates, userId)`
- `deleteStructureEntry(id)` — cascade su foto e floor plan points
- `getPhotosForStructure(id)` / `addPhotosToStructure()` / `removePhotoFromStructure()`

Export da `src/db/index.ts`.

---

### 4. `src/db/sal.ts` — estensione SAL

Aggiungere `assignStructuresToSal(projectId, salId, userId)` parallela a `assignCrossingsToSal`.

Estendere `deleteSal` per unassignare anche le strutture (aggiungere `db.structureEntries` alla transazione).

---

### 5. `src/db/pricing.ts` — nessun cambio strutturale

La chiave di pricing per le strutture sarà il tipo `struttura` (es. `"Parete"`) con `category='struttura'`. Aggiungere `category` come parametro opzionale a `upsertTypologyPrice`.

---

### 6. `src/sync/syncUploadHandlers.ts`

Aggiungere `case 'structure_entry'` al dispatcher `processSyncItem`.
Implementare `syncStructureEntry(item)` speculare a `syncMappingEntry`.
Aggiornare `syncPhoto` per scrivere `structure_entry_id` invece di `mapping_entry_id` quando `photo.entryType === 'structure'`.

---

### 7. `src/sync/syncDownloadHandlers.ts`

Aggiungere `downloadStructureEntriesFromSupabase()` speculare a quella dei mapping.

---

### 8. `src/components/TypologyViewerModal.tsx`

Aggiungere tab "Strutture" / "Attraversamenti" in cima al modal.
Ogni tab filtra `typologies` per `category`.
Il form per le strutture mostra `struttura` (dropdown) e `tipoStruttura` invece di `attraversamento`.

---

### 9. `src/components/StructureWizard.tsx` — nuovo componente

Speculare a `MappingWizard.tsx`. Step:
1. **Posizione** — piano, locale, intervento
2. **Strutture** — lista con `struttura`, `tipoStruttura`, `tipologicoId`, `superficie`, `lunghezza`, `note`
3. **Foto**

---

### 10. `src/components/StructureEntryCard.tsx` — nuovo componente

Speculare a `MappingEntryCard.tsx`, mostra `entry.structures[]`.

---

### 11. `src/components/SalTab.tsx` — unica pagina per attraversamenti + strutture

SAL e contabilità sono **un'unica vista** per tutto il progetto.
- Conteggio totale non assegnato: "N attraversamenti + M strutture"
- La bulk-assign chiama sia `assignCrossingsToSal` che `assignStructuresToSal` allo stesso SAL
- Nessuna separazione di pagine: un SAL raggruppa tutto il lavoro del periodo

---

### 12. `src/components/CostsTab.tsx`

Aggiungere tab selector "Attraversamenti" / "Strutture" / "Riepilogo".
La sezione strutture aggrega `(struttura, tipologicoId)` invece di `(attraversamento, tipologicoId)`.
Riepilogo combina entrambi.
XLSX: aggiungere sheet "Strutture".

---

### 13. `src/components/FloorPlanEditor.tsx` / `FloorPlanCanvas.tsx`

Le strutture vengono piazzate come `pointType: 'perimetro'` (già supportato).
`UnmappedEntry` esteso per accettare anche strutture.
Callback `onOpenEntry(id, type: 'mapping' | 'structure')` invece di `onOpenMappingEntry`.

---

### 14. Navigation / ProjectDetail

Aggiungere tab `'strutture'` alla navigazione del progetto.
Pulsante "Aggiungi Struttura" → `StructureWizard`.

---

### 15. Dropdown options per strutture

Seeding dei dropdown `struttura` e `tipo_struttura` in Supabase `dropdown_options` (SQL o via admin UI).
Valori iniziali: `struttura` → [Parete, Soffitto, Cassonetto porta-impianto, Altro]; `tipo_struttura` → [Flessibile, Rigido, ...da definire].

---

## File critici da modificare

| File | Tipo modifica |
|------|--------------|
| `src/db/database.ts` | Nuove interfacce, Dexie v11 |
| `src/db/sal.ts` | Estensione SAL per strutture |
| `src/db/pricing.ts` | Aggiunta `category` |
| `src/db/index.ts` | Nuovi export |
| `src/sync/syncUploadHandlers.ts` | Handler `structure_entry` |
| `src/sync/syncDownloadHandlers.ts` | Download strutture |
| `src/components/CostsTab.tsx` | Track parallelo strutture |
| `src/components/SalTab.tsx` | Conteggio + assign strutture |
| `src/components/TypologyViewerModal.tsx` | Tab attraversamenti/strutture |
| `src/components/FloorPlanEditor.tsx` | UnmappedEntry + callback |
| `supabase/schema.sql` | Nuova tabella + colonne FK |

## Nuovi file da creare

| File | Scopo |
|------|-------|
| `src/db/structures.ts` | CRUD strutture |
| `src/components/StructureWizard.tsx` | Form inserimento |
| `src/components/StructureEntryCard.tsx` | Card visualizzazione |

---

## Verifica (end-to-end)

1. Aprire un progetto, tab "Strutture" → aggiungere una struttura via `StructureWizard`
2. Verificare che la struttura appaia nella lista con tipologico corretto
3. Aprire planimetria del piano, disegnare un perimetro e collegarlo alla struttura
4. Andare in CostsTab → sezione Strutture → configurare prezzo per "Parete" → verificare totale
5. Andare in SalTab → creare SAL → conteggio include strutture → assegnare → verificare
6. Verificare export XLSX con sheet "Strutture"
7. Se sync attivo: verificare upload/download strutture su Supabase

---

## Scelte confermate

| Domanda | Scelta |
|---------|--------|
| Unità cassonetti | **mq** — stessa unità di pareti e soffitti; nessun 'lm' da aggiungere |
| Numerazione tipologici | **Counter condiviso** — un unico progressivo nel progetto (strutture e attraversamenti mischiati, es. Tip.1=tubo, Tip.2=parete) |
| Granularità SAL | **Per singola `Structure`** — speculare a `Crossing.salId` |
| Foto strutture | **Sì** — stessa logica di `MappingEntry` |

### Impatto delle scelte sul piano

- `TypologyPrice.unit` rimane `'piece' | 'sqm'` (nessun 'lm')
- `Typology.number` è condiviso: `Project.typologies` contiene sia attraversamenti che strutture, numerati insieme. Il modal dei tipologici mostra tutti in lista unica (con una colonna/badge che indica il tipo), oppure con un filtro per categoria che non cambia il numero
- `Structure.salId` (non su `StructureEntry`)
- `StructureEntry.photos` e gestione foto speculare a `MappingEntry`

---

## Adversarial review (stato reale del branch al 2026-04-25)

### Sintesi stato di avanzamento

| Area piano | Stato | Evidenza rapida |
|---|---|---|
| Modello dati locale (`Structure`, `StructureEntry`, Dexie v11) | ✅ Completato | `src/db/database.ts` include interfacce + store `structureEntries` |
| Persistenza strutture (`src/db/structures.ts`) | ✅ Completato | CRUD + online-first + foto dedicata |
| Sync upload/download strutture | ✅ Completato | handler `structure_entry` in upload/download |
| Schema Supabase (`structure_entries`, FK alternative, seed dropdown) | ✅ Completato | blocchi SQL presenti in `supabase/schema.sql` |
| SAL unificato attraversamenti+strutture | ✅ Completato | `assignStructuresToSal`, delete SAL con unassign anche strutture |
| Typology modal con categoria struttura | ✅ Completato | tab e campi struttura presenti |
| Wizard/Card strutture | ✅ Completato | `StructureWizard.tsx`, `StructureEntryCard.tsx` presenti |
| CostsTab con vista strutture + sheet XLSX dedicato | ❌ Non completato | `CostsTab.tsx` lavora solo su `MappingEntry/crossings` |
| Navigazione progetto con tab “Strutture” dedicata | ❌ Non completato | `ProjectDetail.tsx` non espone sub-tab strutture |
| Integrazione floor plan “open entry” typed (`mapping|structure`) | ⚠️ Parziale/non verificata E2E | piano previsto ma non coperto in modo esplicito dai componenti principali |

### Bug e rischi emersi (adversarial)

1. **Build breaker**: in `src/db/sal.ts` era presente `async async function ...` (errore sintattico bloccante).  
   ✅ **Risolto** in questo branch.

2. **Rischio contaminazione foto mapping/structure in locale**: in `src/db/structures.ts` il fallback locale leggeva per `mappingEntryId` senza filtrare `entryType`.  
   ✅ **Mitigato** filtrando esplicitamente `entryType === 'structure'`.

3. **Gap funzionale rilevante**: la contabilità costi non include ancora strutture; questo impatta l’obiettivo business “SAL/contabilità unica”.

### Piano di completamento consigliato (ordine minimo a rischio ridotto)

1. **CostsTab**: introdurre dataset strutture parallelo + tab Attraversamenti/Strutture/Riepilogo + export sheet “Strutture”.
2. **ProjectDetail / Navigation**: aggiungere sub-tab “Strutture” con lista `StructureEntryCard` e CTA “Aggiungi Struttura”.
3. **FloorPlan linking**: verificare end-to-end collegamento perimetro ↔ structure entry + callback typed.
4. **Test regressione**: smoke test per build + test logici su pricing category, SAL assign/unassign e sync foto struttura.

### Decisioni di prodotto confermate (post-review)

1. **Unità strutture**: solo `mq` anche per cassonetti; `lunghezza` resta dato descrittivo/informativo.
2. **Riepilogo economico**: totale unico progetto con subtotali per categoria.
3. **UI progetto**: tab **separata** “Strutture” in ProjectDetail.
