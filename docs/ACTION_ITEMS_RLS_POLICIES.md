# Action Items - RLS Policies Update

**Data**: 2025-12-04
**Riferimento**: [RLS_POLICIES_ANALYSIS.md](./RLS_POLICIES_ANALYSIS.md)
**Migration SQL**: [migration-update-projects-rls-policies.sql](./migration-update-projects-rls-policies.sql)

---

## 🔴 Priorità CRITICA - Fare PRIMA del deploy

### 1. Decidere sulla policy DELETE per utenti condivisi

**Problema**: Le nuove policy rimuovono la possibilità per gli utenti con accesso condiviso di eliminare progetti.

**Decisione**: ✅ **PRESA** (2025-12-04)

- [x] **Opzione A - SCELTA**: Mantenere il nuovo comportamento (solo owner/admin possono eliminare)
  - ✅ Pro: Maggiore sicurezza, solo proprietari controllano eliminazione
  - ✅ Decisione: Gli utenti condivisi NON possono eliminare progetti
  - **Comportamento finale**:
    - ✅ Owner: può eliminare progetti propri
    - ✅ Admin: può eliminare qualsiasi progetto
    - ❌ Utenti condivisi: NON possono eliminare (solo view/edit)

**Azioni completate**:
- [x] Decisione presa: mantenere nuovo comportamento
- [x] Documentato in RLS_POLICIES_ANALYSIS.md
- [x] Policy SQL pronta in migration-update-projects-rls-policies.sql

**Rimanente**:
- [ ] (Opzionale) Aggiornare UI per disabilitare pulsante "Delete" per utenti condivisi se presente
- [ ] (Opzionale) Comunicare agli utenti il comportamento se necessario

**Assegnato a**: Completato
**Deadline**: ✅ Completato 2025-12-04
**Status**: ✅ Decisione presa e documentata

---

### 2. Implementare Conflict Resolution per Projects

**Problema**: ✅ **RISOLTO** (2025-12-04)

La conflict resolution è stata implementata! Vedi [CONFLICT_RESOLUTION.md](./CONFLICT_RESOLUTION.md) per dettagli.

**Azioni rimanenti per completamento**:

#### 2.1 Database Schema Update ✅ COMPLETATO
- [x] Aggiungere campi alla tabella `projects` (vedi migration SQL)
- [x] Creare indici per performance
- [x] File: `migration-add-projects-conflict-resolution.sql`

#### 2.2 TypeScript Types Update ✅ COMPLETATO
- [x] Aggiornato `src/db/database.ts` con campi `version?` e `lastModified?` (opzionali)
- [x] Campi opzionali per backward compatibility

#### 2.3 Conflict Resolution Logic ✅ COMPLETATO
- [x] `resolveProjectConflict()` già esistente in `conflictResolution.ts`
- [x] Modificato `syncEngine.ts` per usare check conflitti prima UPDATE
- [x] Implementata strategia "last-modified-wins" (default)
- [x] Supporto per strategie: local-wins, remote-wins, merge

#### 2.4 Data Migration ✅ CREATO
- [x] Script SQL completo in `migration-add-projects-conflict-resolution.sql`
- [x] Include UPDATE per progetti esistenti
- [x] Trigger automatico per last_modified

**Rimanente**:
- [ ] **Applicare migration SQL in Supabase** ⚠️ IMPORTANTE
- [ ] **Testare conflict resolution** (vedi CONFLICT_RESOLUTION.md)
- [ ] Verificare backward compatibility con progetti esistenti

**Assegnato a**: _________
**Deadline**: Sprint corrente
**Status**: ✅ Implementato, ⏳ Testing pendente
**Story Points**: 8 → 2 rimanenti (solo testing)

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

- [x] ✅ Decisione presa su DELETE per utenti condivisi (Item #1) - **Mantenere nuovo comportamento**
- [x] ✅ Conflict resolution implementato (Item #2) - **Implementato**
- [ ] ⏳ Testing completo eseguito (Item #4)
- [x] ✅ Documentazione aggiornata (Item #5) - **Completato**
- [ ] ⏳ Migration SQL testato in staging
- [ ] ⏳ Backup del database creato
- [ ] ⏳ Piano di rollback preparato
- [ ] ⏳ Team informato dei cambiamenti
- [ ] ⏳ Utenti informati se breaking changes (opzionale, behavior intenzionale)

---

## 📊 Tracking

| Item | Priorità | Status | Assegnato | Deadline | Story Points |
|------|----------|--------|-----------|----------|--------------|
| #1 Decisione DELETE | 🔴 CRITICA | ✅ Deciso | User | 2025-12-04 | - |
| #2 Conflict Resolution | 🔴 CRITICA | ✅ Implementato | Claude | 2025-12-04 | 8 → 2 |
| #3 Validazione ownerId | ⚠️ ALTA | ⏳ Non iniziato | ___ | Sprint corrente | 2 |
| #4 Testing | ⚠️ ALTA | ⏳ Non iniziato | ___ | Pre-deploy | 5 |
| #5 Documentazione | ⚠️ ALTA | ✅ Completato | Claude | 2025-12-04 | 2 |
| #6 Leave Project | ℹ️ MEDIA | 💡 Idea | ___ | Backlog | 3 |
| #7 Ottimizzazione Download | ℹ️ MEDIA | 📊 Monitoring | ___ | Se necessario | 3 |
| #8 Audit Log | ℹ️ BASSA | 💡 Nice to have | ___ | Backlog | 5 |

**Totale Story Points (Priorità Alta)**: 17 → **9 rimanenti**
**Completato oggi**: 8 story points (conflict resolution + docs) + decisione DELETE
**Tempo stimato rimanente**: 1 sprint

---

**Ultima modifica**: 2025-12-04
**Prossima revisione**: Dopo completamento Item #1 e #2
