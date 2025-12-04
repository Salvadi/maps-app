# Conflict Resolution per Projects

**Data**: 2025-12-04
**Status**: ✅ Implementato

## Overview

La conflict resolution per i **projects** è ora implementata e funziona in modo simile a quella già esistente per i **mapping_entries**. Questo previene la perdita di dati quando più utenti modificano lo stesso progetto offline.

---

## Come Funziona

### 1. Rilevamento Conflitti

Quando il `syncEngine` tenta di sincronizzare un UPDATE di un progetto, **prima controlla se esiste un conflitto**:

```typescript
// In syncEngine.ts - syncProject() UPDATE operation
const { hasConflict, remote } = await checkForConflicts('project', project.id);

if (hasConflict && remote) {
  console.log(`⚠️  Conflict detected for project ${project.id}`);
  // ... risoluzione conflitto
}
```

**Un conflitto viene rilevato quando**:
- Il `version` locale è diverso dal `version` remoto
- Oppure il `lastModified` locale è diverso dal `last_modified` remoto

### 2. Strategie di Risoluzione

Il sistema supporta 4 strategie (attualmente usa **last-modified-wins**):

#### `last-modified-wins` (Default)
- Confronta i timestamp `lastModified` (locale) vs `last_modified` (remoto)
- Vince la versione più recente
- **Pro**: Automatico, nessun input utente richiesto
- **Contro**: L'ultima modifica sovrascrive le precedenti

```typescript
if (localProject.updatedAt > remoteProject.updated_at) {
  // Local wins - mantiene versione locale
} else {
  // Remote wins - scarica versione remota
}
```

#### `local-wins`
- Mantiene sempre la versione locale
- Sovrascrive quella remota
- Utile per testing o casi specifici

#### `remote-wins`
- Mantiene sempre la versione remota
- Sovrascrive quella locale
- Utile quando si vuole "resettare" ai dati del server

#### `merge`
- Combina intelligentemente i campi di entrambe le versioni
- **Campi uniti**: `floors`, `plans`, `typologies`, `accessibleUsers`
- **Base**: usa la versione più recente come punto di partenza
- **Version**: incrementa al massimo delle due + 1
- **Pro**: Nessuna perdita di dati
- **Contro**: Potrebbe creare stati inconsistenti in alcuni casi edge

```typescript
// Esempio merge di floors
const mergedFloors = Array.from(new Set([
  ...local.floors,      // ["0", "1", "2"]
  ...remote.floors      // ["1", "2", "3"]
]));
// Risultato: ["0", "1", "2", "3"]
```

### 3. Campi di Tracking

Ogni progetto ora ha due campi aggiuntivi (opzionali per backward compatibility):

```typescript
interface Project {
  // ... campi esistenti
  version?: number;       // Incrementa ad ogni UPDATE
  lastModified?: number;  // Timestamp dell'ultima modifica
}
```

**Quando vengono aggiornati**:
- **version**: Incrementa automaticamente in `updateProject()`: `(project.version || 0) + 1`
- **lastModified**: Si aggiorna a `Date.now()` in `updateProject()`
- **Supabase**: Trigger automatico aggiorna `last_modified` ad ogni UPDATE

---

## Flusso Completo

### Scenario: Due utenti modificano lo stesso progetto offline

```
T0: Progetto "Casa Milano" creato
    - version: 1
    - lastModified: 1733318400000
    - title: "Casa Milano"
    - client: "Rossi"

T1: User A e User B vanno offline

T2: User A modifica offline
    - version: 2 (incrementato)
    - lastModified: 1733318460000
    - title: "Casa Milano - Ristrutturazione"
    - client: "Rossi"

T3: User B modifica offline (senza sapere della modifica di A)
    - version: 2 (incrementato anche qui)
    - lastModified: 1733318490000 (30 sec dopo A)
    - title: "Casa Milano"
    - client: "Rossi S.p.A."

T4: User A torna online e sincronizza
    ✅ Sync successful: nessun conflitto (server ancora a version 1)
    Server ora ha:
    - version: 2
    - last_modified: 1733318460000
    - title: "Casa Milano - Ristrutturazione"
    - client: "Rossi"

T5: User B torna online e sincronizza
    ⚠️  CONFLICT DETECTED!
    - Local version: 2, lastModified: 1733318490000
    - Remote version: 2, last_modified: 1733318460000

    🔀 Resolving with strategy: last-modified-wins
    - Local (B) è più recente: 1733318490000 > 1733318460000
    - ✅ Local wins - mantiene le modifiche di B

    Versione finale (su server):
    - version: 3 (incrementato dal merge/sync)
    - last_modified: 1733318490000
    - title: "Casa Milano" (da B)
    - client: "Rossi S.p.A." (da B)

❌ Modifiche di A perse (title "Ristrutturazione")
```

### Con strategia `merge`

```
T5: User B sincronizza con strategy: 'merge'
    ⚠️  CONFLICT DETECTED!

    🔀 Merging fields:
    - Base: User B (più recente)
    - title: "Casa Milano" (da B, base più recente)
    - client: "Rossi S.p.A." (da B, base più recente)
    - floors: merge unique [da A: ["0","1"], da B: ["0","1","2"]] → ["0","1","2"]
    - accessibleUsers: merge unique
    - version: max(2, 2) + 1 = 3

    ✅ Nessuna perdita di dati strutturali (floors, users, ecc.)
    ⚠️  Campi scalari (title, client) seguono il "più recente"
```

---

## Testing

### Test 1: Conflict Last-Modified-Wins

```javascript
// Device A
const projectA = await createProject({ title: "Test", ownerId: userA.id });
await processSyncQueue(); // Sync to server

// Device B (download il progetto)
await syncFromSupabase();

// Entrambi vanno offline e modificano
// Device A (offline)
await updateProject(projectA.id, { title: "Modified by A", client: "Client A" });

// Device B (offline) - 10 secondi dopo
await new Promise(resolve => setTimeout(resolve, 10000));
await updateProject(projectA.id, { title: "Modified by B", client: "Client B" });

// Device A torna online e sincronizza
await processSyncQueue(); // SUCCESS, nessun conflitto

// Device B torna online e sincronizza
await processSyncQueue();
// Console output:
// ⚠️  Conflict detected for project <id>
// 🔀 Resolving conflict for project <id> using strategy: last-modified-wins
// ✅ Conflict resolved: local is newer
// ✅ Synced project UPDATE: <id>

// Risultato: title="Modified by B", client="Client B" (B è più recente)
```

### Test 2: Conflict Merge Strategy

```javascript
// Modificare la strategia in syncEngine.ts temporaneamente:
project = await resolveProjectConflict(project, remote, 'merge');

// Setup: stesso del Test 1, ma:
// Device A aggiunge floor "3"
await updateProject(projectA.id, { floors: ["0", "1", "2", "3"] });

// Device B aggiunge floor "4"
await updateProject(projectA.id, { floors: ["0", "1", "2", "4"] });

// Dopo sync con merge:
// Risultato: floors = ["0", "1", "2", "3", "4"] ✅
```

### Test 3: No Conflict (modifiche diverse in tempi diversi)

```javascript
// Device A modifica e sincronizza
await updateProject(projectA.id, { title: "Modified by A" });
await processSyncQueue(); // SUCCESS

// Device B scarica l'update
await syncFromSupabase(); // Get latest version

// Device B modifica e sincronizza
await updateProject(projectA.id, { client: "Modified by B" });
await processSyncQueue(); // SUCCESS, nessun conflitto

// Console output:
// ✅ Synced project UPDATE: <id>
// (Nessun messaggio di conflitto)
```

---

## Implementazione Tecnica

### Files Modificati

1. **src/db/database.ts**
   - Aggiunto `version?: number` e `lastModified?: number` al tipo `Project`

2. **src/db/projects.ts**
   - `createProject()`: Inizializza `version: 1`, `lastModified: now()`
   - `updateProject()`: Incrementa `version`, aggiorna `lastModified`

3. **src/sync/syncEngine.ts**
   - `syncProject() UPDATE`: Aggiunto check conflitti PRIMA di update
   - `syncProject() CREATE/UPDATE`: Invia `version` e `last_modified` a Supabase
   - `downloadProjectsFromSupabase()`: Converte `version` e `last_modified` da Supabase

4. **src/sync/conflictResolution.ts**
   - `convertRemoteToLocalProject()`: Aggiunto `version` e `lastModified`
   - `mergeProjects()`: Incrementa `version` dopo merge

5. **docs/migration-add-projects-conflict-resolution.sql**
   - Aggiunge colonne `version` e `last_modified` alla tabella `projects`
   - Crea indici per performance
   - Crea trigger per auto-update di `last_modified`

### Database Schema

```sql
-- Nuove colonne in public.projects
ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS last_modified BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;

-- Trigger per auto-update
CREATE TRIGGER update_projects_last_modified
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION update_last_modified_column();
```

---

## Limitazioni e Considerazioni

### ⚠️ Last-Modified-Wins può perdere dati

Con la strategia default, se User A modifica `title` e User B modifica `client`, ma B sincronizza dopo:
- **Problema**: Le modifiche di A al `title` vengono perse
- **Soluzione**: Usare strategia `merge` (ma va testata attentamente)

### ⚠️ Merge Strategy può creare inconsistenze

Con la strategia merge:
- Array vengono uniti (floors, plans, accessibleUsers)
- Campi scalari seguono il "più recente"
- **Problema**: Potrebbero esserci inconsistenze logiche (es. typologies aggiunte ma non corrispondenti floor)

### ⚠️ Backward Compatibility

I campi `version` e `lastModified` sono **opzionali** per backward compatibility:
- Progetti creati prima della migration non hanno questi campi
- Il codice gestisce `project.version || 1` e `project.lastModified || project.updatedAt`
- Dopo la migration SQL, tutti i progetti esistenti vengono popolati

### ✅ Performance

- **Impatto minimo**: Solo un SELECT aggiuntivo prima dell'UPDATE
- Indici creati su `version` e `last_modified` per query veloci
- Trigger automatico efficiente (esegue solo su UPDATE)

---

## Confronto con Mapping Entries

| Aspetto | Mapping Entries | Projects |
|---------|----------------|----------|
| **Conflict Detection** | `version` + `lastModified` | `version` + `lastModified` |
| **Default Strategy** | `last-modified-wins` | `last-modified-wins` |
| **Merge Support** | ✅ Sì | ✅ Sì |
| **Trigger Auto-Update** | ✅ Sì | ✅ Sì (dopo migration) |
| **Backward Compatible** | ✅ Sì | ✅ Sì |
| **Implementato in** | Già esistente | ✅ Nuovo (2025-12-04) |

---

## Prossimi Passi

1. **Applicare Migration SQL**
   ```sql
   -- In Supabase SQL Editor
   -- File: migration-add-projects-conflict-resolution.sql
   ```

2. **Testing Approfondito**
   - Testare scenario base (Test 1)
   - Testare merge strategy (Test 2)
   - Testare con progetti esistenti (backward compatibility)

3. **Monitoring in Produzione**
   - Monitorare console per messaggi di conflitto
   - Verificare che i conflitti vengano risolti correttamente
   - Raccogliere feedback utenti su perdite di dati

4. **Possibili Miglioramenti Futuri**
   - UI per mostrare conflitti all'utente
   - Scelta strategia conflict resolution nell'app (settings)
   - Merge strategy più intelligente per campi scalari
   - Conflict log/audit trail

---

## FAQ

**Q: Cosa succede se non applico la migration SQL?**
A: Il codice continua a funzionare! I campi `version` e `lastModified` sono opzionali. Usa `updatedAt` come fallback.

**Q: Posso cambiare la strategia di risoluzione?**
A: Sì, modifica `syncEngine.ts` linea ~202: `resolveProjectConflict(project, remote, 'merge')`

**Q: I progetti esistenti funzioneranno?**
A: Sì! Il codice gestisce progetti senza `version`/`lastModified` usando valori di default.

**Q: Come faccio a sapere se un conflitto è stato risolto?**
A: Controlla la console del browser. Vedrai messaggi come:
```
⚠️  Conflict detected for project <id>
🔀 Resolving conflict for project <id> using strategy: last-modified-wins
✅ Conflict resolved: local is newer
```

**Q: La conflict resolution funziona anche per admin?**
A: Sì! Admin e utenti normali usano lo stesso meccanismo.

---

**Documento creato**: 2025-12-04
**Ultima modifica**: 2025-12-04
**Autore**: Claude Code Implementation
