# Piano di Implementazione — Opzione C: Export PDF Vettoriale con pdf-lib

**Branch:** `feature/pdf-lib-vector-export`
**Difficoltà stimata:** Media
**Impatto sul codice esistente:** Basso — si aggiunge una nuova funzione di export, non si tocca l'editor

---

## Obiettivo

Sostituire l'export PDF attuale (che salva un'immagine JPEG dentro un contenitore PDF)
con un PDF vettoriale che contiene:
- L'immagine di sfondo (planimetria) incorporata come immagine raster ad alta qualità
- Tutti i punti, etichette, linee e perimetri come **oggetti vettoriali nativi PDF**
- Il testo delle etichette come **testo reale** (cercabile, copiabile, scalabile)

Il risultato è un PDF professionale: nessuna perdita di risoluzione, testo selezionabile,
perfetto anche in stampa A0.

---

## Cosa NON cambia

- L'editor (FloorPlanCanvas.tsx) rimane identico
- Il database e la struttura dati rimangono identici
- L'export PNG rimane come alternativa rapida
- La UI del bottone export rimane identica

---

## Architettura della soluzione

### Problema centrale

L'export attuale funziona così:
```
Canvas HTML (tutto già disegnato) → screenshot JPEG → PDF
```

Con pdf-lib, dobbiamo invece:
```
Dati grezzi (points[], gridConfig, imageBlob) → disegno vettoriale PDF
```

Questo significa **ricostruire la logica di rendering** da zero usando l'API di pdf-lib,
partendo dagli stessi dati che usa il canvas per disegnare.

---

## Passi di implementazione

### Step 1 — Installare pdf-lib
**File:** `package.json`

```bash
npm install pdf-lib
```

pdf-lib è una libreria TypeScript-first, ben mantenuta, ~300KB, zero dipendenze.
Non serve configurazione aggiuntiva.

---

### Step 2 — Creare la funzione di export vettoriale
**File nuovo:** `src/utils/exportVectorUtils.ts`

Questa funzione riceve i dati grezzi (non il canvas HTML) e produce un PDF vettoriale.

**Firma della funzione:**
```typescript
exportFloorPlanToPDF(
  imageBlob: Blob,           // Immagine di sfondo (PNG 2x)
  imageWidth: number,        // Larghezza originale immagine (px)
  imageHeight: number,       // Altezza originale immagine (px)
  points: CanvasPoint[],     // Tutti i punti con posizioni e etichette
  gridConfig: GridConfig,    // Configurazione griglia (se attiva)
  filename: string           // Nome file output
): Promise<void>
```

**Struttura interna della funzione:**

```
1. Crea documento PDF con pdf-lib
2. Calcola dimensioni pagina in base all'aspect ratio immagine
   → Landscape se larghezza > altezza, Portrait altrimenti
   → Usa A4 (595×842 pt) come base
3. Converti imageBlob in Uint8Array
4. Incorpora immagine nel PDF (embedPng / embedJpg)
5. Calcola fattori di scala: immagine → punti PDF
6. Disegna immagine di sfondo
7. Se griglia attiva: disegna linee griglia (tratteggio blu, 30% opacità)
8. Per ogni punto in points[]:
   a. Calcola posizione punto sul PDF (da normalizzato 0-1 a PDF pt)
   b. Disegna punto (cerchio pieno colorato per tipo)
   c. Calcola posizione e dimensioni etichetta
   d. Disegna rettangolo etichetta (sfondo + bordo)
   e. Disegna testo etichetta (ogni riga, con font bold/italic corretto)
   f. Disegna linea tratteggiata da punto a bordo etichetta
   g. Se tipo 'perimetro': disegna poligono tratteggiato
9. Salva e scarica il file PDF
```

---

### Step 3 — Logica di scala e coordinate

**Sistema di coordinate pdf-lib:**
- Origine in basso a sinistra (Y invertita rispetto al canvas!)
- Unità: punti tipografici (1 pt = 1/72 pollice)
- A4 landscape: 841.89 × 595.28 pt

**Conversione da normalizzato a PDF:**
```typescript
const scale = {
  x: pageWidth / imageWidth,   // o pdfImageWidth se scalato
  y: pageHeight / imageHeight
}

function normalizedToPDF(nx: number, ny: number) {
  return {
    x: nx * pdfImageWidth + imageOffsetX,
    // Y invertita: 0 = top in canvas, 0 = bottom in pdf
    y: pageHeight - (ny * pdfImageHeight + imageOffsetY)
  }
}
```

Attenzione: le Y sono invertite. Ogni coordinata Y deve essere trasformata.

---

### Step 4 — Rendering punti e colori

**Colori per tipo (identici al canvas):**
```typescript
const POINT_COLORS = {
  parete:    '#0066FF',   // Blu
  solaio:    '#00CC66',   // Verde
  perimetro: '#FF6600',   // Arancione
  generico:  '#9933FF'    // Viola
}
```

**Disegno punto:**
```typescript
page.drawCircle({
  x: pt.x,
  y: pt.y,
  size: 4,  // raggio in pt
  color: rgb(r, g, b),  // da hex parsing
  borderWidth: 0
})
```

**Nota:** pdf-lib usa `rgb(0-1, 0-1, 0-1)`, non hex. Serve una funzione `hexToRgb()`.

---

### Step 5 — Rendering etichette

**Etichetta = rettangolo + testo multi-riga:**

```typescript
// 1. Calcola dimensioni testo (stima: ~7pt per carattere, 14pt altezza riga)
const FONT_SIZE = 10   // punti PDF
const LINE_HEIGHT = 14
const PADDING = 6

// 2. Disegna rettangolo background
page.drawRectangle({
  x: labelRect.x,
  y: labelRect.y,
  width: labelRect.width,
  height: labelRect.height,
  color: hexToRgbLib(point.labelBackgroundColor ?? '#FAFAF0'),
  borderColor: hexToRgbLib('#333333'),
  borderWidth: 1
})

// 3. Disegna ogni riga di testo
// Regola italic: righe che iniziano con "foto n. " o "Tip. "
// pdf-lib supporta StandardFonts.Helvetica e Helvetica-Oblique (simil italic)
for (const line of point.labelText) {
  page.drawText(line, {
    x: textX,
    y: textY,
    size: FONT_SIZE,
    font: boldFont,  // o italicFont per prefissi speciali
    color: hexToRgbLib(point.labelTextColor ?? '#000000')
  })
}
```

**Limitazione nota:** pdf-lib usa font standard PDF (Helvetica, Times, Courier).
Il render del testo non sarà pixel-perfect rispetto al canvas (che usa Arial),
ma sarà vettoriale e professionale.

---

### Step 6 — Rendering linea tratteggiata punto → etichetta

```typescript
page.drawLine({
  start: { x: pointPos.x, y: pointPos.y },
  end:   { x: labelEdgePos.x, y: labelEdgePos.y },
  thickness: 1,
  color: rgb(0.4, 0.4, 0.4),  // grigio #666666
  dashArray: [3, 3]            // pdf-lib supporta dashArray
})
```

La logica per trovare il bordo più vicino dell'etichetta va replicata
(è già in `FloorPlanCanvas.tsx` alla riga ~498 — va estratta in una funzione utility condivisa).

---

### Step 7 — Rendering perimetro

```typescript
// Percorso poligono
const path = point.perimeterPoints
  .map((p, i) => {
    const pos = normalizedToPDF(p.x, p.y)
    return i === 0 ? `M ${pos.x} ${pos.y}` : `L ${pos.x} ${pos.y}`
  })
  .join(' ') + ' Z'  // chiude il poligono

page.drawSvgPath(path, {
  borderColor: hexToRgbLib('#FF6600'),
  borderWidth: 2,
  borderDashArray: [10, 5]
})
```

---

### Step 8 — Griglia (opzionale nel PDF)

```typescript
if (gridConfig.enabled) {
  // Linee verticali (cols + 1)
  // Linee orizzontali (rows + 1)
  // Colore: blu chiaro rgba(100, 100, 255, 0.3)
  // pdf-lib: opacity tramite color con alpha ridotta
  // Tratteggio: dashArray [5, 5]
}
```

---

### Step 9 — Aggiornare i punti di chiamata nell'UI

**File:** `src/utils/exportUtils.ts`

Aggiungere la nuova funzione accanto all'export attuale:
```typescript
// Esistente (mantenerlo)
export async function exportCanvasToPDF(canvas, filename)

// Nuovo
export async function exportFloorPlanToVectorPDF(imageBlob, imageWidth, imageHeight, points, gridConfig, filename)
```

**File:** `src/components/FloorPlanEditor.tsx`

Il bottone "Esporta PDF" può:
- **Opzione A:** Chiamare sempre il nuovo export vettoriale
- **Opzione B:** Offrire scelta all'utente (raster per velocità, vettoriale per qualità)

Raccomandazione: sostituire direttamente con il vettoriale, mantenere PNG come alternativa raster.

---

### Step 10 — Gestire il passaggio dei dati all'export

**Problema:** `exportFloorPlanToVectorPDF` ha bisogno di `imageBlob` e dei `points`,
che ora non vengono passati alla funzione export (che lavora solo sul canvas HTML).

**Soluzione:**
In `FloorPlanEditor.tsx`, la funzione `handleExportPDF` deve:
1. Recuperare `imageBlob` da Dexie (già disponibile come `floorPlan.imageBlob`)
2. Passare `points` (già in state)
3. Passare `gridConfig` (già in state)
4. Chiamare la nuova funzione

---

## File coinvolti

| File | Modifica | Tipo |
|------|---------|------|
| `package.json` | Aggiunge `pdf-lib` | Modifica |
| `src/utils/exportVectorUtils.ts` | Tutta la logica di export vettoriale | **Nuovo** |
| `src/utils/exportUtils.ts` | Aggiunge wrapper / rimuove vecchio export | Modifica |
| `src/components/FloorPlanEditor.tsx` | Aggiorna chiamate al nuovo export | Modifica |
| `src/utils/geometryUtils.ts` | Estrae logica bordo-etichetta riutilizzabile | **Nuovo** (opzionale) |

---

## Rischi e limitazioni note

| Problema | Impatto | Soluzione |
|---------|---------|---------|
| Font non identici al canvas | Estetico (Arial → Helvetica) | Incorporare font custom con pdf-lib |
| Misura testo approssimativa | Layout etichette leggermente diverso | Calibrare con font size e padding |
| Y-axis invertita | Bug se non gestita | Unit test con coordinate |
| Immagini molto grandi | PDF pesante | Comprimere prima dell'embed |
| Colori con alpha (griglia) | pdf-lib non supporta alpha nativa | Simulare con colore più chiaro |

---

## Ordine di sviluppo consigliato

1. `npm install pdf-lib`
2. Crea `exportVectorUtils.ts` con solo il rendering dell'immagine di sfondo → verifica che il PDF si apra correttamente
3. Aggiungi rendering punti (cerchi colorati) → verifica posizioni
4. Aggiungi rendering etichette (rettangoli + testo) → verifica layout
5. Aggiungi linee tratteggiate → verifica connessioni
6. Aggiungi perimetri → verifica poligoni
7. Aggiungi griglia (opzionale)
8. Aggiorna UI in `FloorPlanEditor.tsx`
9. Test su planimetrie reali di varie dimensioni (A4, A3, A0)
10. Confronto visivo output vettoriale vs canvas raster
