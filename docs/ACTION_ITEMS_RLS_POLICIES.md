# Action Items - RLS Policies Update

**Data**: 2025-12-04
**Riferimento**: [RLS_POLICIES_ANALYSIS.md](./RLS_POLICIES_ANALYSIS.md)
**Migration SQL**: [migration-update-projects-rls-policies.sql](./migration-update-projects-rls-policies.sql)

---

## 🔴 Priorità CRITICA - Fare PRIMA del deploy

### 1. Decidere sulla policy DELETE per utenti condivisi

**Problema**: Le nuove policy rimuovono la possibilità per gli utenti con accesso condiviso di eliminare progetti.

**Decisione richiesta**:
- [ ] **Opzione A**: Mantenere il nuovo comportamento (solo owner/admin possono eliminare)
  - ✅ Pro: Maggiore sicurezza, solo proprietari controllano eliminazione
  - ❌ Con: Breaking change, utenti condivisi perdono questa funzionalità
  - **Se scelta**:
    - [ ] Aggiornare UI per disabilitare pulsante "Delete" per utenti condivisi
    - [ ] Aggiornare documentazione utente
    - [ ] Comunicare agli utenti il cambio di comportamento

- [ ] **Opzione B**: Ripristinare la vecchia policy (utenti condivisi possono eliminare)
  - ✅ Pro: Mantiene comportamento esistente, no breaking changes
  - ❌ Con: Meno controllo per i proprietari
  - **Se scelta**:
    - [ ] Aggiungere policy al file migration:
      ```sql
      CREATE POLICY "Users delete accessible projects"
      ON public.projects
      FOR DELETE
      USING (
        accessible_users @> jsonb_build_array(auth.uid()::text)
      );
      ```

**Assegnato a**: _________
**Deadline**: Prima del deploy delle nuove policy
**Status**: ⏳ In attesa di decisione

---

### 2. Implementare Conflict Resolution per Projects

**Problema**: Attualmente il `syncEngine` non gestisce conflitti per progetti. Se due utenti modificano lo stesso progetto offline, l'ultimo che sincronizza sovrascrive le modifiche dell'altro.

**Azioni richieste**:

#### 2.1 Database Schema Update
- [ ] Aggiungere campi alla tabella `projects`:
  ```sql
  ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_modified BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
  ```
- [ ] Creare indice per performance:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_projects_last_modified
  ON public.projects(last_modified DESC);
  ```

#### 2.2 TypeScript Types Update
- [ ] Aggiornare `src/db/database.ts`:
  ```typescript
  export interface Project {
    // ... campi esistenti
    version: number;           // Aggiungere
    lastModified: number;      // Aggiungere
  }
  ```

#### 2.3 Conflict Resolution Logic
- [ ] Modificare `src/sync/conflictResolution.ts`:
  - [ ] Aggiungere funzione `resolveProjectConflict()`
  - [ ] Implementare strategia "last-modified-wins" o "manual-merge"

- [ ] Modificare `src/sync/syncEngine.ts` - funzione `syncProject()`:
  ```typescript
  if (item.operation === 'UPDATE') {
    // Aggiungere check conflitti PRIMA dell'upsert
    const { hasConflict, remote } = await checkForConflicts('project', project.id);

    if (hasConflict && remote) {
      console.log(`⚠️  Conflict detected for project ${project.id}`);
      project = await resolveProjectConflict(project, remote, 'last-modified-wins');
      await db.projects.put(project);
      console.log(`✅ Conflict resolved for project ${project.id}`);
    }

    // ... poi procedere con update su Supabase
  }
  ```

#### 2.4 Data Migration
- [ ] Creare script per popolare i nuovi campi nei progetti esistenti:
  ```sql
  UPDATE public.projects
  SET
    version = 1,
    last_modified = EXTRACT(EPOCH FROM updated_at)::BIGINT * 1000
  WHERE version IS NULL OR last_modified IS NULL;
  ```

**Assegnato a**: _________
**Deadline**: Sprint corrente
**Status**: ⏳ Non iniziato
**Story Points**: 8

---

## ⚠️ Priorità ALTA - Fare presto

### 3. Aggiungere validazione owner_id in updateProject()

**Problema**: La funzione `updateProject()` non impedisce modifiche al campo `ownerId`. Anche se le policy RLS lo bloccano per utenti normali, meglio aggiungere validazione a livello applicativo.

**Azioni richieste**:
- [ ] Modificare `src/db/projects.ts` - funzione `updateProject()`:
  ```typescript
  export async function updateProject(
    id: string,
    updates: Partial<Omit<Project, 'id' | 'createdAt' | 'ownerId'>>  // ← Rimuovere ownerId dal tipo
  ): Promise<Project> {
    // ... resto del codice
  }
  ```

- [ ] (Opzionale) Creare funzione dedicata per trasferimento proprietà:
  ```typescript
  export async function transferProjectOwnership(
    projectId: string,
    newOwnerId: string,
    currentUserId: string
  ): Promise<Project> {
    // Verificare che currentUserId sia admin
    const currentUser = await getUser(currentUserId);
    if (currentUser.role !== 'admin') {
      throw new Error('Only admins can transfer project ownership');
    }

    // ... logica di trasferimento
  }
  ```

**Assegnato a**: _________
**Deadline**: Sprint corrente
**Status**: ⏳ Non iniziato
**Story Points**: 2

---

### 4. Testing completo delle nuove policy

**Azioni richieste**:

#### 4.1 Unit Tests
- [ ] Creare file `src/sync/__tests__/syncEngine.projects.test.ts`
- [ ] Test: Utente condiviso NON può eliminare progetto
- [ ] Test: Owner può eliminare progetto
- [ ] Test: Admin può eliminare qualsiasi progetto
- [ ] Test: Owner NON può cambiare owner_id
- [ ] Test: Admin può cambiare owner_id
- [ ] Test: Utente condiviso NON può rimuoversi da accessible_users

#### 4.2 Integration Tests (con Supabase)
- [ ] Setup ambiente di test con Supabase locale o staging
- [ ] Test scenario: Due utenti modificano progetto offline (conflict)
- [ ] Test scenario: Admin crea progetto per altro utente
- [ ] Test scenario: Utente condiviso prova a modificare accessible_users

#### 4.3 Manual Testing
- [ ] Test end-to-end con UI:
  - [ ] User crea progetto e lo condivide con altro user
  - [ ] User condiviso prova a eliminare progetto (deve fallire con nuovo comportamento)
  - [ ] Admin vede tutti i progetti
  - [ ] Admin può modificare accessible_users di qualsiasi progetto

**Assegnato a**: _________
**Deadline**: Prima del deploy in produzione
**Status**: ⏳ Non iniziato
**Story Points**: 5

---

### 5. Documentare comportamento admin policies

**Azioni richieste**:
- [ ] Aggiornare `docs/SUPABASE_SETUP.md`:
  - [ ] Documentare che admin possono creare progetti per altri utenti
  - [ ] Documentare che admin possono cambiare owner_id
  - [ ] Aggiungere warning sui rischi

- [ ] (Opzionale) Aggiungere warnings nell'UI admin:
  - [ ] Mostrare modal di conferma quando admin cambia accessible_users
  - [ ] Mostrare badge "ADMIN ACTION" quando admin modifica progetti di altri

**Assegnato a**: _________
**Deadline**: Prima del deploy in produzione
**Status**: ⏳ Non iniziato
**Story Points**: 2

---

## ℹ️ Priorità MEDIA - Considerare per il futuro

### 6. Permettere agli utenti di rimuoversi da progetti condivisi

**Descrizione**: Attualmente la policy "Users update accessible projects" impedisce agli utenti di rimuoversi dalla lista `accessible_users`.

**Se si vuole implementare**:

#### Opzione A: Modificare la policy RLS
```sql
DROP POLICY IF EXISTS "Users update accessible projects" ON public.projects;

CREATE POLICY "Users update accessible projects"
ON public.projects
FOR UPDATE
USING (
  accessible_users @> jsonb_build_array(auth.uid()::text)
)
WITH CHECK (
  -- Permetti rimozione di se stessi OR mantieni l'utente nella lista
  NOT (OLD.accessible_users @> jsonb_build_array(auth.uid()::text))
  OR accessible_users @> jsonb_build_array(auth.uid()::text)
);
```

#### Opzione B: Creare funzione dedicata
- [ ] Creare `leaveProject(projectId: string, userId: string)` in `src/db/projects.ts`
- [ ] La funzione rimuove l'utente da `accessible_users` solo se non è l'owner
- [ ] Aggiungere pulsante "Leave Project" nell'UI

**Assegnato a**: _________
**Deadline**: Backlog
**Status**: 💡 Idea / Non prioritario

---

### 7. Ottimizzare downloadProjectsFromSupabase

**Descrizione**: Attualmente scarica TUTTI i progetti e filtra client-side. Inefficiente se ci sono molti progetti.

**Possibili soluzioni**:

#### Opzione A: Usare PostgreSQL function
```sql
CREATE OR REPLACE FUNCTION get_accessible_projects(user_id UUID)
RETURNS SETOF projects AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM projects
  WHERE owner_id = user_id
     OR accessible_users @> jsonb_build_array(user_id::text)
  ORDER BY updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Poi nel client:
```typescript
const { data } = await supabase.rpc('get_accessible_projects', { user_id: userId });
```

#### Opzione B: Migliorare query PostgREST
Testare se le query su JSONB arrays sono diventate più affidabili:
```typescript
const { data } = await supabase
  .from('projects')
  .select('*')
  .or(`owner_id.eq.${userId},accessible_users.cs.["${userId}"]`)
  .order('updated_at', { ascending: false });
```

**Assegnato a**: _________
**Deadline**: Solo se diventa un problema di performance
**Status**: 📊 Monitoring

---

## ℹ️ Priorità BASSA - Nice to have

### 8. Aggiungere audit log per azioni admin

**Descrizione**: Tracciare quando gli admin:
- Cambiano owner_id di un progetto
- Creano progetti per altri utenti
- Modificano accessible_users

**Implementazione**:
- [ ] Creare tabella `admin_audit_log`
- [ ] Aggiungere triggers PostgreSQL per tracciare modifiche
- [ ] (Opzionale) Creare UI per visualizzare audit log

**Assegnato a**: _________
**Deadline**: Backlog
**Status**: 💡 Nice to have

---

## 📋 Checklist Pre-Deploy

Prima di fare il deploy delle nuove policy in produzione, verificare:

- [ ] ✅ Decisione presa su DELETE per utenti condivisi (Item #1)
- [ ] ✅ Conflict resolution implementato (Item #2)
- [ ] ✅ Testing completo eseguito (Item #4)
- [ ] ✅ Documentazione aggiornata (Item #5)
- [ ] ✅ Migration SQL testato in staging
- [ ] ✅ Backup del database creato
- [ ] ✅ Piano di rollback preparato
- [ ] ✅ Team informato dei cambiamenti
- [ ] ✅ Utenti informati se breaking changes

---

## 📊 Tracking

| Item | Priorità | Status | Assegnato | Deadline | Story Points |
|------|----------|--------|-----------|----------|--------------|
| #1 Decisione DELETE | 🔴 CRITICA | ⏳ In attesa | ___ | Pre-deploy | - |
| #2 Conflict Resolution | 🔴 CRITICA | ⏳ Non iniziato | ___ | Sprint corrente | 8 |
| #3 Validazione ownerId | ⚠️ ALTA | ⏳ Non iniziato | ___ | Sprint corrente | 2 |
| #4 Testing | ⚠️ ALTA | ⏳ Non iniziato | ___ | Pre-deploy | 5 |
| #5 Documentazione | ⚠️ ALTA | ⏳ Non iniziato | ___ | Pre-deploy | 2 |
| #6 Leave Project | ℹ️ MEDIA | 💡 Idea | ___ | Backlog | 3 |
| #7 Ottimizzazione Download | ℹ️ MEDIA | 📊 Monitoring | ___ | Se necessario | 3 |
| #8 Audit Log | ℹ️ BASSA | 💡 Nice to have | ___ | Backlog | 5 |

**Totale Story Points (Priorità Alta)**: 17
**Tempo stimato**: 1-2 sprint

---

**Ultima modifica**: 2025-12-04
**Prossima revisione**: Dopo completamento Item #1 e #2
