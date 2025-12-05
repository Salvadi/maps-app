# Integrazione OPIMapTool in Maps-App

## Sommario

Questo documento valuta la fattibilità dell'integrazione di [OPIMapTool](https://github.com/Salvadi/opimaptool) nella maps-app (OPImaPPA).

## Analisi dei Progetti

### OPIMapTool (da integrare)

**Scopo**: App di annotazione e mappatura su planimetrie

**Tecnologie**:
- React + TypeScript
- Vite (build tool)
- IndexedDB (SiteMapperDB)

**Funzionalità principali**:
1. **Caricamento planimetrie**: Upload immagini di planimetrie
2. **Annotazione punti**: Aggiunta punti con numero, tipo, descrizione e posizione
3. **Disegno linee**: Linee colorate tra coordinate
4. **Trasformazioni immagine**: Rotazione, zoom, pan
5. **Gestione progetti**: Salvataggio/caricamento progetti
6. **Export**: JSON (dati) e JPEG (immagine annotata)

**Tipi di punti supportati**:
- `generic` - Punto generico
- `floor-single` - Pavimento singolo
- `wall-single` - Parete singola
- `floor-multi` - Pavimento multiplo
- `wall-multi` - Parete multipla

**Struttura dati MapPoint**:
```typescript
interface MapPoint {
  id: string;
  number: number;
  x: number;          // Posizione % (0-100)
  y: number;          // Posizione % (0-100)
  targetX?: number;   // Punta della freccia
  targetY?: number;
  type: PointType;
  description: string;
  timestamp: number;
}
```

### Maps-App (OPImaPPA) - Attuale

**Scopo**: PWA offline-first per mappatura cantieri/installazioni

**Tecnologie**:
- React 19 + TypeScript
- Create React App (build tool)
- IndexedDB via Dexie.js
- Supabase (sync/backend)

**Funzionalità principali**:
1. Gestione progetti con client, indirizzo, piani
2. Mapping entries con foto, attraversamenti
3. Export XLSX e ZIP
4. Sync cloud con Supabase
5. Autenticazione utenti

---

## Valutazione di Fattibilità

### Compatibilità: ALTA

| Aspetto | OPIMapTool | Maps-App | Compatibilità |
|---------|------------|----------|---------------|
| Framework | React | React 19 | ✅ Alta |
| Linguaggio | TypeScript | TypeScript | ✅ Alta |
| Storage | IndexedDB | IndexedDB (Dexie) | ✅ Alta |
| Build | Vite | CRA | ⚠️ Richiede adattamento |
| Concetto | Progetti/Punti | Progetti/MappingEntries | ✅ Sovrapponibile |

### Vantaggi dell'Integrazione

1. **Annotazione visiva planimetrie**: Gli utenti potranno caricare planimetrie per ogni piano e annotare punti direttamente sulla mappa
2. **Collegamento dati-posizione**: I mapping entries potranno essere collegati a posizioni specifiche sulla planimetria
3. **Export arricchito**: Oltre a XLSX, export di planimetrie annotate in JPEG
4. **Workflow completo**: Dalla foto al punto sulla mappa

### Sfide Tecniche

1. **Migrazione componenti Vite → CRA**: I componenti React sono compatibili, ma potrebbero servire aggiustamenti ai path e import
2. **Unificazione database**: Estendere lo schema Dexie per includere planimetrie e punti
3. **Sync Supabase**: Estendere le tabelle cloud per supportare i nuovi dati
4. **Integrazione UI**: Inserire l'editor planimetrie nel flusso esistente

---

## Piano di Integrazione Proposto

### Fase 1: Setup e Migrazione Base
- [ ] Copiare componenti OPIMapTool nella struttura maps-app
- [ ] Adattare import e path per CRA
- [ ] Creare componente `PlanimetryEditor` wrapper

### Fase 2: Integrazione Database
- [ ] Estendere schema Dexie con tabelle `planimetries` e `planimetryPoints`
- [ ] Collegare planimetrie ai progetti esistenti
- [ ] Aggiornare sync engine per nuove entità

### Fase 3: Integrazione UI
- [ ] Aggiungere sezione "Planimetrie" nella vista progetto
- [ ] Permettere upload planimetria per piano
- [ ] Integrare editor punti con flusso mapping entries

### Fase 4: Export e Sync
- [ ] Estendere export XLSX con dati planimetrie
- [ ] Aggiungere export JPEG planimetrie annotate
- [ ] Sincronizzare planimetrie con Supabase

---

## Struttura Database Proposta

### Nuove tabelle Dexie

```typescript
interface Planimetry {
  id: string;
  projectId: string;
  floor: string;
  imageName: string;
  imageData: string;      // Base64
  rotation: number;
  markerScale: number;
  createdAt: number;
  updatedAt: number;
  synced: boolean;
}

interface PlanimetryPoint {
  id: string;
  planimetryId: string;
  mappingEntryId?: string;  // Collegamento opzionale a mapping entry
  number: number;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  type: 'generic' | 'floor-single' | 'wall-single' | 'floor-multi' | 'wall-multi';
  description: string;
  timestamp: number;
  synced: boolean;
}

interface PlanimetryLine {
  id: string;
  planimetryId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: string;
  synced: boolean;
}
```

---

## Conclusione

**L'integrazione è FATTIBILE** e può portare un valore significativo all'applicazione, permettendo una mappatura visiva completa dei progetti.

La compatibilità tecnologica è alta (stesso stack React/TypeScript/IndexedDB), le sfide principali sono:
1. Migrazione build tool (Vite → CRA) - basso impatto
2. Estensione database e sync - medio impatto
3. Integrazione UI - medio impatto

**Stima complessità**: Media
**Raccomandazione**: Procedere con l'integrazione

---

## Prossimi Passi

1. Approvazione del piano da parte del team
2. Inizio Fase 1: migrazione componenti
3. Review incrementali per ogni fase
