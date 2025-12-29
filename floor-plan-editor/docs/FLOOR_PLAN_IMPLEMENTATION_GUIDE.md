# 🚀 GUIDA IMPLEMENTAZIONE FLOOR PLAN EDITOR

## 📋 SOMMARIO

Questa guida ti accompagna step-by-step nell'integrazione completa del Floor Plan Editor nell'app maps-app esistente.

---

## ✅ CHECKLIST PRELIMINARE

Prima di iniziare, assicurati di avere:

- [ ] Accesso al database Supabase
- [ ] Accesso allo Storage Supabase
- [ ] Progetto maps-app funzionante localmente
- [ ] Node.js e npm installati
- [ ] Backup del database attuale (precauzione)

---

## 📦 STEP 1: AGGIORNAMENTO DATABASE

### 1.1 Applicare Migration SQL su Supabase

1. **Accedi a Supabase Dashboard**
   - Vai su https://supabase.com/dashboard
   - Seleziona il tuo progetto

2. **Esegui Migration SQL**
   - SQL Editor → New Query
   - Copia il contenuto di `/docs/migration-floor-plans.sql`
   - Clicca "Run"
   - Verifica che non ci siano errori

3. **Verifica Tabelle Create**
   ```sql
   SELECT table_name
   FROM information_schema.tables
   WHERE table_schema = 'public'
   AND table_name IN ('floor_plans', 'floor_plan_points', 'standalone_maps')
   ORDER BY table_name;
   ```
   Dovresti vedere 3 tabelle.

### 1.2 Creare Bucket Storage "planimetrie"

1. **Vai su Storage**
   - Dashboard → Storage → Buckets

2. **Crea Nuovo Bucket**
   - Nome: `planimetrie`
   - Public: **NO** (privato)
   - Clicca "Create bucket"

3. **Applica Policies Storage**
   
   Vai su Policies del bucket `planimetrie` e aggiungi:

   ```sql
   -- Users can upload floor plans
   CREATE POLICY "Users can upload floor plans"
     ON storage.objects
     FOR INSERT
     WITH CHECK (
       bucket_id = 'planimetrie'
       AND auth.uid() IS NOT NULL
     );

   -- Users can view floor plans
   CREATE POLICY "Users can view floor plans"
     ON storage.objects
     FOR SELECT
     USING (
       bucket_id = 'planimetrie'
       AND auth.uid() IS NOT NULL
     );

   -- Users can update floor plans
   CREATE POLICY "Users can update floor plans"
     ON storage.objects
     FOR UPDATE
     USING (
       bucket_id = 'planimetrie'
       AND auth.uid() IS NOT NULL
     );

   -- Users can delete floor plans
   CREATE POLICY "Users can delete floor plans"
     ON storage.objects
     FOR DELETE
     USING (
       bucket_id = 'planimetrie'
       AND auth.uid() IS NOT NULL
     );
   ```

---

## 🔧 STEP 2: AGGIORNAMENTO CODICE LOCALE

### 2.1 Sostituire File Database

**File da aggiornare**: `src/db/database.ts`

1. **Backup del file originale**:
   ```bash
   cp src/db/database.ts src/db/database.ts.backup
   ```

2. **Sostituire con la nuova versione**:
   ```bash
   cp /home/claude/src/db/database-updated.ts src/db/database.ts
   ```

   **OPPURE** copia manualmente il contenuto da `/home/claude/src/db/database-updated.ts`

3. **Verifica modifiche principali**:
   - ✅ Aggiunte interfacce: `FloorPlan`, `FloorPlanPoint`, `StandaloneMap`
   - ✅ Aggiornato `MappingDatabase.version(4)` con nuove tabelle
   - ✅ Aggiornato `getDatabaseStats()` per includere floor plans

### 2.2 Aggiungere Nuovo File FloorPlans CRUD

**File da creare**: `src/db/floorPlans.ts`

Copia il contenuto da `/home/claude/src/db/floorPlans.ts` nella tua cartella `src/db/`.

Questo file contiene tutte le funzioni CRUD per:
- Floor Plans
- Floor Plan Points
- Standalone Maps

### 2.3 Copiare Componenti Floor Plan Editor

**File da copiare**:

1. **Componenti**:
   ```bash
   cp /home/claude/src/components/FloorPlanEditor.tsx src/components/
   cp /home/claude/src/components/FloorPlanEditor.css src/components/
   cp /home/claude/src/components/FloorPlanCanvas.tsx src/components/
   cp /home/claude/src/components/FloorPlanCanvas.css src/components/
   ```

2. **Utilities**:
   ```bash
   cp /home/claude/src/utils/floorPlanUtils.ts src/utils/
   ```

### 2.4 Aggiornare Esportazioni Database

**File da modificare**: `src/db/index.ts`

Aggiungi le seguenti esportazioni:

```typescript
// Existing exports...
export * from './database';
export * from './projects';
export * from './mappings';
export * from './auth';

// NEW: Floor Plans exports
export * from './floorPlans';

// NEW: Export floor plan types
export type { FloorPlan, FloorPlanPoint, StandaloneMap } from './database';
```

---

## 🔗 STEP 3: INTEGRAZIONE CON PROJECTFORM

### 3.1 Modificare ProjectForm.tsx

**File da modificare**: `src/components/ProjectForm.tsx`

#### A. Aggiungere Import

All'inizio del file, aggiungi:

```typescript
import {
  createFloorPlan,
  getFloorPlansByProject,
  deleteFloorPlan,
  getFloorPlanBlobUrl,
  hasFloorPlan
} from '../db/floorPlans';
import type { FloorPlan } from '../db';
```

#### B. Aggiungere State per Floor Plans

Dopo gli state esistenti, aggiungi:

```typescript
const [floorPlans, setFloorPlans] = useState<Map<string, FloorPlan>>(new Map());
const [loadingFloorPlans, setLoadingFloorPlans] = useState(false);
```

#### C. Caricare Floor Plans Esistenti

Nel `useEffect` esistente o in uno nuovo, aggiungi:

```typescript
useEffect(() => {
  if (project?.id) {
    loadFloorPlans();
  }
}, [project?.id]);

const loadFloorPlans = async () => {
  if (!project) return;
  
  setLoadingFloorPlans(true);
  try {
    const plans = await getFloorPlansByProject(project.id);
    const planMap = new Map<string, FloorPlan>();
    plans.forEach(plan => {
      planMap.set(plan.floor, plan);
    });
    setFloorPlans(planMap);
  } catch (error) {
    console.error('Error loading floor plans:', error);
  } finally {
    setLoadingFloorPlans(false);
  }
};
```

#### D. Funzioni per Gestire Upload/Delete

```typescript
const handleFloorPlanUpload = async (floor: string, file: File) => {
  if (!project) return;
  
  try {
    // Check if floor plan already exists
    const existing = await hasFloorPlan(project.id, floor);
    if (existing) {
      if (!confirm('Esiste già una planimetria per questo piano. Sostituire?')) {
        return;
      }
      // Delete existing
      const existingPlan = floorPlans.get(floor);
      if (existingPlan) {
        await deleteFloorPlan(existingPlan.id);
      }
    }

    // Create new floor plan
    const floorPlan = await createFloorPlan(
      project.id,
      floor,
      file,
      currentUser.id
    );

    // Update state
    setFloorPlans(prev => {
      const newMap = new Map(prev);
      newMap.set(floor, floorPlan);
      return newMap;
    });

    alert('Planimetria caricata con successo!');
  } catch (error) {
    console.error('Error uploading floor plan:', error);
    alert('Errore nel caricamento della planimetria');
  }
};

const handleFloorPlanDelete = async (floor: string) => {
  const floorPlan = floorPlans.get(floor);
  if (!floorPlan) return;

  if (!confirm('Sei sicuro di voler eliminare questa planimetria?')) {
    return;
  }

  try {
    await deleteFloorPlan(floorPlan.id);
    
    // Update state
    setFloorPlans(prev => {
      const newMap = new Map(prev);
      newMap.delete(floor);
      return newMap;
    });

    alert('Planimetria eliminata');
  } catch (error) {
    console.error('Error deleting floor plan:', error);
    alert('Errore nell\'eliminazione della planimetria');
  }
};
```

#### E. Modificare UI - Rinominare Bottone

Cerca il bottone "Carica Pianta" e sostituiscilo con questa sezione:

```tsx
{/* Floor Plans Section */}
<div className="form-section">
  <label className="section-label">Planimetrie</label>
  
  {project?.floors && project.floors.length > 0 ? (
    <div className="floor-plans-list">
      {project.floors.map(floor => {
        const floorPlan = floorPlans.get(floor);
        
        return (
          <div key={floor} className="floor-plan-item">
            <div className="floor-plan-info">
              <span className="floor-label">Piano {floor}</span>
              {floorPlan && (
                <span className="floor-plan-status">✓ Planimetria caricata</span>
              )}
            </div>
            
            <div className="floor-plan-actions">
              {floorPlan ? (
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      const url = getFloorPlanBlobUrl(floorPlan.imageBlob);
                      window.open(url, '_blank');
                    }}
                  >
                    Visualizza
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => handleFloorPlanDelete(floor)}
                  >
                    Elimina
                  </button>
                </>
              ) : (
                <label className="btn-primary">
                  Aggiungi Planimetria
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleFloorPlanUpload(floor, file);
                        e.target.value = ''; // Reset input
                      }
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        );
      })}
    </div>
  ) : (
    <p className="form-note">
      Configura i piani sopra per caricare le planimetrie
    </p>
  )}
</div>
```

#### F. Aggiungere CSS

Aggiungi in `ProjectForm.css`:

```css
.floor-plans-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.floor-plan-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-md);
  background-color: var(--color-bg-input);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.floor-plan-info {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.floor-label {
  font-weight: 600;
  color: var(--color-text-primary);
}

.floor-plan-status {
  font-size: 0.875rem;
  color: var(--color-success);
}

.floor-plan-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.btn-danger {
  background-color: var(--color-danger);
  color: white;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  border: none;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-danger:hover {
  opacity: 0.8;
}
```

---

## 🔗 STEP 4: INTEGRAZIONE CON MAPPINGPAGE

### 4.1 Modificare MappingPage.tsx

**File da modificare**: `src/components/MappingPage.tsx`

#### A. Aggiungere Import

```typescript
import { useState, useEffect } from 'react';
import FloorPlanEditor from './FloorPlanEditor';
import type { CanvasPoint, GridConfig } from './FloorPlanCanvas';
import {
  getFloorPlanByProjectAndFloor,
  getFloorPlanPointByMappingEntry,
  createFloorPlanPoint,
  updateFloorPlanPoint,
  getFloorPlanBlobUrl,
} from '../db/floorPlans';
import type { FloorPlan, FloorPlanPoint } from '../db';
```

#### B. Aggiungere State

```typescript
const [showFloorPlanEditor, setShowFloorPlanEditor] = useState(false);
const [currentFloorPlan, setCurrentFloorPlan] = useState<FloorPlan | null>(null);
const [currentFloorPlanPoint, setCurrentFloorPlanPoint] = useState<FloorPlanPoint | null>(null);
const [floorPlanImageUrl, setFloorPlanImageUrl] = useState<string | null>(null);
```

#### C. Caricare Floor Plan quando cambia il piano

```typescript
useEffect(() => {
  loadFloorPlan();
  return () => {
    // Cleanup blob URL
    if (floorPlanImageUrl) {
      URL.revokeObjectURL(floorPlanImageUrl);
    }
  };
}, [floor, project?.id]);

const loadFloorPlan = async () => {
  if (!project || !floor) return;

  try {
    const floorPlan = await getFloorPlanByProjectAndFloor(project.id, floor);
    setCurrentFloorPlan(floorPlan || null);
    
    if (floorPlan) {
      // Create blob URL for display
      const url = getFloorPlanBlobUrl(floorPlan.imageBlob);
      setFloorPlanImageUrl(url);
    } else {
      setFloorPlanImageUrl(null);
    }
  } catch (error) {
    console.error('Error loading floor plan:', error);
  }
};
```

#### D. Funzioni per Gestire Editor

```typescript
const handleOpenFloorPlanEditor = async () => {
  if (!currentFloorPlan) return;

  // Load existing point if editing
  if (editingEntry) {
    const point = await getFloorPlanPointByMappingEntry(editingEntry.id);
    setCurrentFloorPlanPoint(point || null);
  }

  setShowFloorPlanEditor(true);
};

const handleSaveFloorPlanPoint = async (points: CanvasPoint[], gridConfig: GridConfig) => {
  if (!currentFloorPlan || !editingEntry) {
    alert('Errore: mapping entry non trovata');
    return;
  }

  try {
    // We expect only one point per mapping entry
    const point = points[0];
    if (!point) {
      alert('Nessun punto aggiunto');
      setShowFloorPlanEditor(false);
      return;
    }

    if (currentFloorPlanPoint) {
      // Update existing point
      await updateFloorPlanPoint(currentFloorPlanPoint.id, {
        pointType: point.type,
        pointX: point.pointX,
        pointY: point.pointY,
        labelX: point.labelX,
        labelY: point.labelY,
        perimeterPoints: point.perimeterPoints,
        customText: point.customText,
      });
    } else {
      // Create new point
      await createFloorPlanPoint(
        currentFloorPlan.id,
        editingEntry.id,
        point.type,
        point.pointX,
        point.pointY,
        point.labelX,
        point.labelY,
        currentUser.id,
        {
          perimeterPoints: point.perimeterPoints,
          customText: point.customText,
        }
      );
    }

    alert('Punto salvato sulla planimetria!');
    setShowFloorPlanEditor(false);
  } catch (error) {
    console.error('Error saving floor plan point:', error);
    alert('Errore nel salvataggio del punto');
  }
};
```

#### E. Aggiungere Bottone nell'UI

Dopo i bottoni per foto (Camera/Sfoglia), aggiungi:

```tsx
{/* Floor Plan Point Button */}
{currentFloorPlan && (
  <button
    type="button"
    className="floor-plan-btn"
    onClick={handleOpenFloorPlanEditor}
    title="Aggiungi punto sulla planimetria"
  >
    <span className="btn-icon">📍</span>
    Aggiungi Punto
  </button>
)}

{/* Floor Plan Editor Modal */}
{showFloorPlanEditor && floorPlanImageUrl && (
  <div className="floor-plan-editor-overlay">
    <FloorPlanEditor
      imageUrl={floorPlanImageUrl}
      initialPoints={currentFloorPlanPoint ? [{
        id: currentFloorPlanPoint.id,
        type: currentFloorPlanPoint.pointType,
        pointX: currentFloorPlanPoint.pointX,
        pointY: currentFloorPlanPoint.pointY,
        labelX: currentFloorPlanPoint.labelX,
        labelY: currentFloorPlanPoint.labelY,
        labelText: generateLabelText(), // Implement this
        perimeterPoints: currentFloorPlanPoint.perimeterPoints,
        customText: currentFloorPlanPoint.customText,
      }] : []}
      mode="mapping"
      onSave={handleSaveFloorPlanPoint}
      onClose={() => setShowFloorPlanEditor(false)}
    />
  </div>
)}
```

#### F. Implementare generateLabelText()

```typescript
const generateLabelText = (): string[] => {
  // Line 1: Photo name
  const photoName = generatePhotoPrefix(floor, roomNumber, interventionNumber) + '01';
  
  // Line 2: Tipologici numbers
  const tipNumbers = sigillature
    .map(sig => {
      if (sig.tipologicoId) {
        const tip = project?.typologies.find(t => t.id === sig.tipologicoId);
        return tip ? tip.number : null;
      }
      return null;
    })
    .filter(n => n !== null)
    .join(' - ');

  const tipLine = tipNumbers ? `tip. ${tipNumbers}` : '';

  return [photoName, tipLine].filter(Boolean);
};

// Helper function (same as MappingView)
const generatePhotoPrefix = (floor: string, room?: string, intervention?: string): string => {
  const parts: string[] = [];

  if (project?.floors && project.floors.length > 1) {
    parts.push(`P${floor}`);
  }

  if (project?.useRoomNumbering && room) {
    parts.push(`S${room}`);
  }

  if (project?.useInterventionNumbering && intervention) {
    parts.push(`Int${intervention}`);
  }

  return parts.length > 0 ? parts.join('_') + '_' : '';
};
```

#### G. Aggiungere CSS

In `MappingPage.css`:

```css
.floor-plan-btn {
  flex: 1;
  padding: var(--spacing-md);
  background-color: var(--color-accent);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  transition: opacity 0.2s;
}

.floor-plan-btn:hover {
  opacity: 0.9;
}

.floor-plan-btn:active {
  transform: translateY(1px);
}

.floor-plan-editor-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  background-color: rgba(0, 0, 0, 0.95);
}
```

---

## ✅ STEP 5: TEST

### 5.1 Test Upload Planimetria

1. Avvia l'app: `npm start`
2. Crea o modifica un progetto
3. Configura i piani (es: "0, 1, 2")
4. Per ogni piano, clicca "Aggiungi Planimetria"
5. Carica un PDF o immagine
6. Verifica che appaia "✓ Planimetria caricata"

### 5.2 Test Aggiungi Punto

1. Vai in Mapping Form
2. Seleziona un piano con planimetria
3. Verifica che appaia il bottone "📍 Aggiungi Punto"
4. Clicca il bottone
5. L'editor si apre con la planimetria
6. Seleziona un tipo di punto (Parete/Solaio/etc)
7. Clicca sulla planimetria per aggiungere punto
8. Sposta l'etichetta se necessario
9. Clicca "Salva"

### 5.3 Test Database IndexedDB

1. Apri DevTools (F12)
2. Application tab → IndexedDB → MappingDatabase
3. Verifica presenza tabelle:
   - `floorPlans`
   - `floorPlanPoints`
   - `standaloneMaps`

---

## 🐛 TROUBLESHOOTING

### Errore: "version() already called"

**Soluzione**: Il database è già inizializzato. Chiudi il browser, cancella IndexedDB, riapri.

### Floor plan non si carica

**Soluzione**: 
1. Verifica console per errori
2. Controlla che il bucket "planimetrie" esista
3. Verifica policies storage

### Errore PDF.js

**Soluzione**: Controlla connessione internet (PDF.js viene caricato da CDN)

---

## 📚 PROSSIMI STEP

Dopo aver completato questa integrazione base, procedi con:

- [ ] FASE 7: Tipo Punto Perimetro (linea tratteggiata)
- [ ] FASE 10: Sincronizzazione Bidirezionale
- [ ] FASE 11: Mapping View - Visualizzazione Planimetrie
- [ ] FASE 12: Export Planimetrie
- [ ] FASE 13: Modalità Standalone

---

**Data ultimo aggiornamento**: 2025-12-23
**Versione guida**: 1.0

Buona implementazione! 🎉
