# 📊 STATO IMPLEMENTAZIONE FLOOR PLAN EDITOR

## ✅ FASE 1: Setup Base e Struttura Database - COMPLETATA

### Completato:
- ✅ Schema database Supabase (`migration-floor-plans.sql`)
- ✅ Bucket "planimetrie" con policies
- ✅ Componente `FloorPlanEditor.tsx` base
- ✅ Componente `FloorPlanCanvas.tsx`
- ✅ Utilities per conversione PDF→PNG 2x (`floorPlanUtils.ts`)
- ✅ Tipi TypeScript definiti

### Da fare:
- ⏳ Applicare migrazione su Supabase (eseguire `migration-floor-plans.sql`)
- ⏳ Creare bucket "planimetrie" su Supabase Storage
- ⏳ Aggiornare tipi IndexedDB
- ⏳ Integrare con app esistente

---

## 🔄 FASE 2: Caricamento e Visualizzazione Planimetrie

### Obiettivo:
Upload e visualizzazione planimetrie in Project Form

### Da implementare:
1. Modificare `ProjectForm.tsx`:
   - Rinominare "Carica Pianta" → "Aggiungi Planimetrie"
   - Implementare upload PDF/immagine
   - Mostrare planimetrie caricate per piano
   - Gestire delete planimetrie

2. Integrare con Supabase:
   - Upload planimetrie su bucket
   - Salvare record in `floor_plans` table
   - Link con progetto e piano

---

## 🎨 FASE 3: Editor Planimetrico - Rendering Base

### Stato attuale:
✅ Canvas rendering implementato
✅ Zoom/pan implementati
✅ Toolbar base presente

### Da ottimizzare:
- Performance rendering con molti punti
- Gestione memoria per immagini grandi
- Smooth zoom/pan

---

## 📍 FASE 4: Sistema Punti Base

### Stato attuale:
✅ Struttura punti definita
✅ Toolbar con 4 tipi di punti
✅ Click per aggiungere punti

### Da completare:
- Rendering punto perimetro (linea tratteggiata)
- Gestione segmenti concatenati per perimetro
- Migliorare UX aggiunta punti

---

## 🏷️ FASE 5: Sistema Etichette

### Da implementare:
1. Generare naming foto da mapping entry:
   ```typescript
   // Formato: P{piano}_S{stanza}_Int{intervento}_{numero}
   // Esempi:
   // - P1_S2_Int3_01 (con room e intervention)
   // - P1_S2_01 (solo room)
   // - P1_Int3_01 (solo intervention)
   // - P1_01 (solo piano)
   ```

2. Estrarre tipologici da mapping entry:
   ```typescript
   // Riga 2 etichetta: "tip. 1 - 2 - 3"
   ```

3. Implementare rendering etichette
4. Linea di collegamento punto-etichetta

---

## 📐 FASE 6: Sistema Griglia

### Stato attuale:
✅ UI controlli griglia presente
✅ Configurazione griglia (rows, cols, offsets)

### Da implementare:
- Rendering griglia invisibile
- Snap etichette alla griglia
- Lasciare punti liberi dalla griglia

---

## 🔗 FASE 7-15: Fasi rimanenti

Verranno implementate dopo completamento fasi 2-6.

---

## 📝 PROSSIMI PASSI IMMEDIATI

### 1. Setup Supabase (manuale)
```sql
-- Eseguire migration-floor-plans.sql su Supabase
-- Creare bucket 'planimetrie' con policies
```

### 2. Aggiornare IndexedDB Schema
- Aggiungere tabelle `floorPlans`, `floorPlanPoints`, `standaloneMaps`

### 3. Implementare integrazione ProjectForm
- Upload planimetrie
- Visualizzazione planimetrie per piano
- Delete planimetrie

### 4. Implementare integrazione MappingPage
- Bottone "Aggiungi Punto" (se esiste planimetria)
- Aprire editor planimetrico
- Salvare punto con mapping entry

### 5. Implementare naming foto e tipologici
- Riutilizzare logica da `MappingView.generatePhotoPrefix`
- Estrarre tipologici da crossings

---

## 🐛 NOTE TECNICHE

### Logica naming foto (già presente in MappingView.tsx):
```typescript
const generatePhotoPrefix = (floor: string, room?: string, intervention?: string): string => {
  const parts: string[] = [];

  // Always include Piano if project has multiple floors
  if (project.floors && project.floors.length > 1) {
    parts.push(`P${floor}`);
  }

  // Include Stanza if room numbering is enabled and room is provided
  if (project.useRoomNumbering && room) {
    parts.push(`S${room}`);
  }

  // Include Intervento if intervention numbering is enabled and intervention is provided
  if (project.useInterventionNumbering && intervention) {
    parts.push(`Int${intervention}`);
  }

  return parts.length > 0 ? parts.join('_') + '_' : '';
};
```

### Estrazione tipologici da mapping entry:
```typescript
// crossing.tipologicoId → trova tipologico in project.typologies
// Ottieni tipologico.number
// Raggruppa: "tip. 1 - 2 - 3"
```

---

## ✨ OTTIMIZZAZIONI FUTURE

1. **Performance**:
   - Virtual scrolling per lista punti
   - Canvas rendering ottimizzato
   - Lazy loading planimetrie

2. **UX**:
   - Undo/Redo stack
   - Shortcuts tastiera
   - Touch gestures mobile

3. **Features**:
   - Export PDF annotato
   - Export PNG annotato
   - Condivisione planimetrie

---

**Ultima modifica**: 2025-12-23
**Versione**: 1.0
