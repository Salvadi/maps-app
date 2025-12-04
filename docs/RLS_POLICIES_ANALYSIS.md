# Analisi delle Policy RLS Supabase per Projects

## Data: 2025-12-04
## Autore: Claude Code Review

## Executive Summary

Sono state create nuove Row Level Security (RLS) policies per la tabella `projects` in Supabase. Questa analisi confronta le policy esistenti con quelle nuove, identifica potenziali problemi e verifica la coerenza con il `syncEngine`.

**Verdetto**: Le nuove policy sono generalmente ben strutturate ma presentano **un cambiamento critico** e diversi punti di attenzione per possibili bug futuri.

---

## Confronto Policy Vecchie vs Nuove

### SELECT Policies

#### Policy Vecchie (3 separate)
```sql
-- 1. Users can view own projects
USING (owner_id = auth.uid())

-- 2. Users can view accessible projects
USING (accessible_users @> jsonb_build_array(auth.uid()::text))

-- 3. Admins can view all projects
USING (public.is_admin())
```

#### Policy Nuova (consolidata)
```sql
-- Projects select (UNICA)
USING (
  owner_id = auth.uid()
  OR accessible_users @> jsonb_build_array(auth.uid()::text)
  OR public.is_admin()
)
```

**Analisi**: ✅ **OTTIMO** - La consolidazione è più pulita e performante. PostgreSQL valuta le condizioni con OR logico, nessun problema di sicurezza.

---

### INSERT Policies

#### Policy Vecchie
```sql
-- Users can create projects
WITH CHECK (owner_id = auth.uid())
```

#### Policy Nuove
```sql
-- 1. Users insert own projects
WITH CHECK (owner_id = auth.uid())

-- 2. Admins insert projects (NUOVA)
WITH CHECK (public.is_admin())
```

**Analisi**: ⚠️ **ATTENZIONE**

**Problema Identificato**: La nuova policy "Admins insert projects" **non ha un WITH CHECK su owner_id**, permettendo agli admin di creare progetti con `owner_id` di altri utenti.

**Coerenza con il codice**:
- ✅ `createProject()` (src/db/projects.ts:196) imposta sempre `ownerId: currentUser.id`
- ✅ `syncEngine.ts` (linea 176) invia `owner_id: project.ownerId`
- ❌ **L'UI non supporta la creazione di progetti per altri utenti**

**Rischio**: Se in futuro viene aggiunta un'interfaccia per permettere agli admin di creare progetti per altri utenti, potrebbero esserci problemi di sicurezza se non gestito correttamente.

**Raccomandazione**:
- Se intenzionale: documentare chiaramente questo comportamento
- Se non intenzionale: aggiungere `WITH CHECK (owner_id = auth.uid() OR public.is_admin())`

---

### UPDATE Policies

#### Policy Vecchie
```sql
-- 1. Users can update own projects
USING (owner_id = auth.uid())
-- Nota: NO WITH CHECK

-- 2. Users can update accessible projects
USING (accessible_users @> jsonb_build_array(auth.uid()::text))
WITH CHECK (accessible_users @> jsonb_build_array(auth.uid()::text))
```

#### Policy Nuove
```sql
-- 1. Users update own projects
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid())  -- AGGIUNTO

-- 2. Users update accessible projects
USING (accessible_users @> jsonb_build_array(auth.uid()::text))
WITH CHECK (accessible_users @> jsonb_build_array(auth.uid()::text))

-- 3. Admins update all projects (NUOVA)
USING (public.is_admin())
WITH CHECK (true)
```

**Analisi**: ⚠️ **ATTENZIONE - Multiple Issues**

#### Issue 1: Owner non può trasferire proprietà
Il nuovo `WITH CHECK (owner_id = auth.uid())` impedisce al proprietario di cambiare `owner_id`.

**Coerenza con il codice**: ✅ **COERENTE**
- `updateProject()` (src/db/projects.ts:74-76) non permette di modificare `id` o `createdAt`
- `syncEngine.ts` (linee 195-209) **NON include owner_id nell'UPDATE**
- Solo gli admin potrebbero cambiare owner_id tramite "Admins update all projects"

**Conclusione**: Questo è **intenzionale e corretto**. Il trasferimento di proprietà richiede privilegi admin.

#### Issue 2: Utenti condivisi non possono rimuoversi
Il `WITH CHECK (accessible_users @> jsonb_build_array(auth.uid()::text))` impedisce a un utente di rimuoversi da `accessible_users`.

**Scenario problematico**:
```javascript
// Un utente condiviso prova a rimuoversi
await updateProject(projectId, {
  accessibleUsers: ['other-user-id'] // rimuove se stesso
});
// ❌ FALLISCE: WITH CHECK richiede che l'utente rimanga in accessibleUsers
```

**Coerenza con il codice**: ⚠️ **POTENZIALE PROBLEMA**
- `ProjectForm.tsx` (linea 181) permette agli admin di modificare `accessibleUsers`
- Gli utenti normali NON vedono questa sezione (linea 309: `currentUser.role === 'admin'`)
- Tuttavia, se in futuro viene aggiunta la possibilità per gli utenti di rimuoversi, questa policy lo bloccherebbe

**Raccomandazione**: Se volete permettere agli utenti di rimuoversi, modificare la policy:
```sql
-- Opzione 1: Permettere rimozione di se stessi
WITH CHECK (
  accessible_users @> jsonb_build_array(auth.uid()::text)
  OR NOT (OLD.accessible_users @> jsonb_build_array(auth.uid()::text))
)

-- Opzione 2: Solo gli owner possono modificare accessible_users
-- Rimuovere completamente questa clausola WITH CHECK dalla policy "Users update accessible projects"
```

#### Issue 3: Admin può modificare qualsiasi cosa
La policy "Admins update all projects" con `WITH CHECK (true)` permette agli admin di:
- Cambiare `owner_id` ad altri utenti
- Rimuovere se stessi da `accessible_users`
- Modificare qualsiasi campo senza restrizioni

**Coerenza con il codice**: ✅ **COERENTE ma PERICOLOSO**
- `ProjectForm.tsx` (linea 181) permette agli admin di modificare `accessibleUsers`
- L'UI **NON** permette di cambiare `owner_id` (questo campo non è modificabile)
- Potenzialmente pericoloso se un admin fa errori o se l'UI viene modificata senza precauzioni

**Raccomandazione**: Considerare l'aggiunta di una validazione a livello applicazione per prevenire modifiche accidentali dell'owner_id.

---

### DELETE Policies

#### Policy Vecchie
```sql
-- 1. Users can delete own projects
USING (owner_id = auth.uid())

-- 2. Users can delete accessible projects
USING (accessible_users @> jsonb_build_array(auth.uid()::text))
```

#### Policy Nuove
```sql
-- 1. Users delete own projects
USING (owner_id = auth.uid())

-- 2. Admins delete all projects (NUOVA)
USING (public.is_admin())

-- NOTA: "Users can delete accessible projects" è stata RIMOSSA
```

**Analisi**: 🔴 **CRITICO - BREAKING CHANGE**

#### PROBLEMA CRITICO: Utenti condivisi non possono più eliminare progetti

**Prima**: Utenti in `accessible_users` potevano eliminare progetti condivisi con loro
**Dopo**: Solo i proprietari e gli admin possono eliminare progetti

**Scenario d'uso compromesso**:
```javascript
// Utente A crea un progetto e lo condivide con Utente B
// Prima: Utente B poteva eliminare il progetto
await deleteProject(projectId); // ✅ Funzionava

// Dopo: Utente B NON può più eliminare il progetto
await deleteProject(projectId); // ❌ FALLISCE: RLS policy violation
```

**Impatto**:
- ⚠️ **Cambio di comportamento** rispetto alla versione precedente
- Gli utenti condivisi che prima potevano eliminare progetti ora non possono più farlo
- Potrebbero ricevere errori inaspettati nell'UI

**Domanda**: È intenzionale?
- **Se SÌ**: Ottimo cambiamento per la sicurezza. Solo i proprietari dovrebbero poter eliminare. Documentare chiaramente.
- **Se NO**: Ripristinare la policy:
  ```sql
  CREATE POLICY "Users delete accessible projects"
  ON public.projects
  FOR DELETE
  USING (
    accessible_users @> jsonb_build_array(auth.uid()::text)
  );
  ```

**Raccomandazione**: ⚠️ **DECISIONE NECESSARIA** - Chiarire l'intento e aggiornare l'UI di conseguenza.

---

## Analisi Syncengine e Coerenza

### syncProject() Function (syncEngine.ts:155-233)

#### CREATE Operation (linee 164-189)
```typescript
const supabaseProject = {
  id: project.id,
  title: project.title,
  // ... altri campi
  owner_id: project.ownerId,        // ✅ Inviato
  accessible_users: project.accessibleUsers,  // ✅ Inviato
  // ...
};
await supabase.from('projects').insert(supabaseProject);
```
**Coerenza**: ✅ **PERFETTA** con le policy INSERT

#### UPDATE Operation (linee 194-217)
```typescript
const supabaseProject = {
  title: project.title,
  // ... altri campi
  accessible_users: project.accessibleUsers,  // ✅ Inviato
  // Nota: owner_id NON viene inviato  // ✅ CORRETTO
  // ...
};
await supabase.from('projects').update(supabaseProject).eq('id', project.id);
```
**Coerenza**: ✅ **PERFETTA** con le policy UPDATE. L'owner_id non viene mai modificato, coerente con il `WITH CHECK`.

#### DELETE Operation (linee 222-229)
```typescript
await supabase.from('projects').delete().eq('id', project.id);
```
**Coerenza**: ⚠️ **DIPENDE** dalla decisione sulla policy DELETE per utenti condivisi (vedi sopra).

---

## Bug e Problemi Potenziali Futuri

### 1. 🔴 CRITICO: No Conflict Resolution per Projects

**Problema**: Il `syncEngine` gestisce i conflitti per `mapping_entries` (linee 243-254) ma **NON per projects**.

**Scenario problematico**:
```
T0: Progetto ha title="Original"
T1: Utente A (owner) offline modifica title="Version A"
T2: Utente B (accessible) offline modifica title="Version B"
T3: Utente A sincronizza → Supabase title="Version A"
T4: Utente B sincronizza → Supabase title="Version B"
Risultato: Le modifiche di A sono perse!
```

**Confronto con mapping_entries**:
```typescript
// mapping_entries HA conflict resolution (linee 243-254)
const { hasConflict, remote } = await checkForConflicts('mapping', entry.id);
if (hasConflict && remote) {
  entry = await resolveMappingEntryConflict(entry, remote, 'last-modified-wins');
  await db.mappingEntries.put(entry);
}

// projects NON HA conflict resolution ❌
// L'ultimo che sincronizza semplicemente sovrascrive
```

**Raccomandazione**: 🚨 **ALTA PRIORITÀ**
- Implementare conflict resolution per projects simile a mapping_entries
- Aggiungere campi `version` e `last_modified` alla tabella projects
- Utilizzare strategia "last-modified-wins" o "manual-merge"

**File da modificare**:
- `docs/supabase-schema.sql`: Aggiungere `version INTEGER, last_modified BIGINT`
- `src/db/database.ts`: Aggiungere campi al tipo `Project`
- `src/sync/syncEngine.ts`: Implementare `checkForConflicts('project', ...)` in `syncProject()`

---

### 2. ⚠️ Admin può inavvertitamente cambiare owner_id

**Problema**: La policy "Admins update all projects" permette di modificare `owner_id`, ma:
- L'UI non supporta questa funzionalità
- Nessuna validazione a livello applicazione
- Potenziale per errori umani

**Scenario problematico**:
```typescript
// Admin accidentalmente invia owner_id in un update
await updateProject(projectId, {
  title: "New Title",
  ownerId: "wrong-user-id"  // ❌ Viene accettato!
});
```

**Raccomandazione**:
- Aggiungere validazione in `updateProject()` per bloccare modifiche di `ownerId`
- Oppure creare una funzione separata `transferOwnership()` solo per admin

---

### 3. ⚠️ Nessuna policy per "Admins can view all profiles"

**Osservazione**: Nel codice `ProjectForm.tsx` (linea 78) viene chiamato:
```typescript
const users = await getAllUsers();
```

Questo funziona perché esiste la policy:
```sql
-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (public.is_admin());
```

**Coerenza**: ✅ **OK** - La policy esiste già nello schema (supabase-schema.sql:161-165)

---

### 4. ℹ️ downloadProjectsFromSupabase filtra client-side

**Osservazione**: In `syncEngine.ts:459-483`, il download fa:
```typescript
// Download ALL projects
const { data: allProjects } = await supabase.from('projects').select('*');

// Filter client-side
userProjects = allProjects.filter((p: any) =>
  p.owner_id === userId ||
  (p.accessible_users && Array.isArray(p.accessible_users) && p.accessible_users.includes(userId))
);
```

**Problema**: Questo approccio:
- È **meno efficiente** (scarica tutti i progetti anche se l'utente ne ha accesso solo a pochi)
- È **meno sicuro** in teoria (anche se RLS blocca i progetti non accessibili)
- Commento nel codice: "This is less efficient but more reliable than PostgREST array queries"

**Raccomandazione**:
- Mantenere per ora (il commento suggerisce che le query PostgREST su array JSONB possono essere problematiche)
- Monitorare le performance quando il numero di progetti cresce
- Considerare l'uso di una funzione PostgreSQL personalizzata se diventa un problema

---

## Checklist Sicurezza

| Item | Status | Note |
|------|--------|------|
| SELECT policies consolidate correttamente | ✅ OK | Funziona correttamente con OR logico |
| INSERT policies prevengono creazione non autorizzata | ✅ OK | Solo owner e admin possono creare |
| UPDATE policies proteggono owner_id | ✅ OK | Solo admin possono modificare owner_id |
| DELETE policies proteggono progetti | ⚠️ VERIFICARE | Utenti condivisi non possono più eliminare |
| is_admin() usa SECURITY DEFINER | ✅ OK | Previene infinite recursion |
| RLS abilitato su tutte le tabelle | ✅ OK | Confermato in schema |
| Conflict resolution implementato | 🔴 NO | Manca per projects, presente per mapping_entries |
| Validazioni a livello applicazione | ⚠️ PARZIALE | owner_id non validato in updateProject |

---

## Raccomandazioni Finali

### 🔴 Priorità Alta (Implementare SUBITO)

1. **Decidere sul DELETE per utenti condivisi**
   - Se intenzionale: Aggiornare UI e documentazione
   - Se non intenzionale: Ripristinare policy

2. **Implementare Conflict Resolution per Projects**
   - Aggiungere campi `version` e `last_modified`
   - Implementare logica in `syncProject()`
   - Prevenire perdita di dati da modifiche concorrenti

### ⚠️ Priorità Media (Implementare presto)

3. **Validare owner_id in updateProject()**
   - Bloccare modifiche di `ownerId` a livello applicazione
   - Creare funzione dedicata per trasferimento proprietà

4. **Documentare comportamento admin policies**
   - Chiarire che admin possono creare progetti per altri utenti
   - Documentare che admin possono modificare owner_id
   - Aggiungere warnings nell'UI admin

### ℹ️ Priorità Bassa (Considerare per il futuro)

5. **Permettere agli utenti di rimuoversi da progetti condivisi**
   - Modificare policy "Users update accessible projects"
   - Aggiungere UI per "Leave project"

6. **Ottimizzare downloadProjectsFromSupabase**
   - Valutare se il filtro client-side diventa un problema
   - Considerare funzioni PostgreSQL custom se necessario

---

## Testing Raccomandato

Prima del deploy in produzione, testare i seguenti scenari:

### Scenario 1: Utente condiviso prova a eliminare progetto
```sql
-- Setup
INSERT INTO profiles (id, email, username, role) VALUES
  ('user-a-id', 'a@test.com', 'usera', 'user'),
  ('user-b-id', 'b@test.com', 'userb', 'user');

INSERT INTO projects (id, title, owner_id, accessible_users) VALUES
  ('proj-1', 'Test Project', 'user-a-id', '["user-a-id", "user-b-id"]'::jsonb);

-- Test (come user-b)
SET request.jwt.claim.sub = 'user-b-id';
DELETE FROM projects WHERE id = 'proj-1';
-- Risultato atteso: ERRORE (policy violation)
-- Risultato vecchio: SUCCESS
```

### Scenario 2: Owner prova a cambiare owner_id
```sql
-- Test (come user-a, owner del progetto)
SET request.jwt.claim.sub = 'user-a-id';
UPDATE projects SET owner_id = 'user-b-id' WHERE id = 'proj-1';
-- Risultato atteso: ERRORE (WITH CHECK violation)
```

### Scenario 3: Admin crea progetto per altro utente
```sql
-- Test (come admin)
SET request.jwt.claim.sub = 'admin-id';
INSERT INTO projects (title, owner_id) VALUES ('Admin Project', 'user-a-id');
-- Risultato atteso: SUCCESS
```

### Scenario 4: Utente condiviso si rimuove da accessible_users
```sql
-- Test (come user-b)
SET request.jwt.claim.sub = 'user-b-id';
UPDATE projects
SET accessible_users = '["user-a-id"]'::jsonb
WHERE id = 'proj-1';
-- Risultato atteso: ERRORE (WITH CHECK richiede user-b in lista)
```

### Scenario 5: Modifiche concorrenti (conflict)
```javascript
// Setup: Due utenti offline modificano lo stesso progetto
// User A (owner)
await updateProject('proj-1', { title: 'Title A', client: 'Client A' });
// User B (accessible)
await updateProject('proj-1', { title: 'Title B', notes: 'Notes B' });

// Sync User A
await processSyncQueue(); // Title="Title A", client="Client A"

// Sync User B
await processSyncQueue(); // Title="Title B", notes="Notes B"
// ❌ PROBLEMA: Le modifiche di A (client) sono perse!
```

---

## Conclusioni

Le nuove policy Supabase sono ben strutturate e consolidano efficacemente le vecchie policy SELECT. Tuttavia, presentano:

- ✅ **Punti di forza**: Consolidamento SELECT, protezione owner_id, separazione ruoli admin/user
- 🔴 **Criticità**: Rimozione DELETE per utenti condivisi (breaking change), mancanza conflict resolution
- ⚠️ **Attenzioni**: Validazioni applicative incomplete, possibili problemi futuri con modifiche concorrenti

**Raccomandazione generale**: Le policy possono essere implementate ma richiedono:
1. Decisione chiara su DELETE per utenti condivisi
2. Implementazione conflict resolution per projects (alta priorità)
3. Testing approfondito degli scenari edge case

---

**Documento generato da**: Claude Code Analysis
**Data**: 2025-12-04
**Versione**: 1.0
