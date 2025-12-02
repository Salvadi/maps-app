# Troubleshooting: Admin non vede gli utenti in "Condividi Progetto"

## Problema

Quando un admin crea o modifica un progetto, la sezione "Condividi Progetto" non mostra alcun utente o mostra solo l'admin stesso.

## Errore "Infinite Recursion"

Se vedi questo errore nella console:
```
❌ Profile fetch error: {code: '42P17', message: 'infinite recursion detected in policy for relation "profiles"'}
```

**Causa**: Le RLS policies stanno cercando di leggere dalla tabella `profiles` per verificare se l'utente è admin, ma per leggere da `profiles` devono verificare le policies... che cercano di leggere da `profiles`... loop infinito!

**Soluzione**: Usa la funzione helper `is_admin()` con `SECURITY DEFINER` che bypassa RLS. Segui le istruzioni nella sezione "RLS Policies Non Applicate" qui sotto.

## Cause Possibili

### 1. RLS Policies Non Applicate

Le Row Level Security (RLS) policies potrebbero non essere state applicate correttamente su Supabase.

**Come Verificare:**
1. Vai su Supabase Dashboard → Authentication → Policies
2. Controlla che la tabella `profiles` abbia le seguenti policies:
   - ✅ "Users can view own profile"
   - ✅ "Admins can view all profiles"

**Come Risolvere:**
Se le policies non ci sono, eseguile manualmente:

**IMPORTANTE**: Prima crea la funzione helper per evitare ricorsione infinita:

```sql
-- Funzione helper per verificare se l'utente è admin
-- SECURITY DEFINER bypassa RLS per evitare ricorsione
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Poi crea le policies:

```sql
-- Abilita RLS sulla tabella profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Policy per utenti normali
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Policy per admin (usa la funzione helper)
CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (public.is_admin());
```

**ATTENZIONE**: NON usare mai questa sintassi che causa ricorsione infinita:
```sql
-- ❌ SBAGLIATO - Causa errore "infinite recursion"
USING (
  EXISTS (
    SELECT 1 FROM public.profiles  -- Legge dalla stessa tabella!
    WHERE id = auth.uid() AND role = 'admin'
  )
);
```

### 2. Utente Admin Senza Ruolo

L'utente admin potrebbe non avere `role = 'admin'` nella tabella `profiles`.

**Come Verificare:**
1. Vai su Supabase Dashboard → Table Editor → profiles
2. Cerca il tuo utente admin
3. Verifica che la colonna `role` sia impostata a `'admin'`

**Come Risolvere:**

```sql
-- Imposta l'utente come admin (sostituisci con l'email corretta)
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'admin@tuodominio.com';
```

### 3. Nessun Utente Nella Tabella Profiles

La tabella `profiles` potrebbe essere vuota o contenere solo l'admin.

**Come Verificare:**
1. Vai su Supabase Dashboard → Table Editor → profiles
2. Conta quanti utenti ci sono

**Come Risolvere:**
Crea degli utenti di test:

1. Vai su Supabase Dashboard → Authentication → Users
2. Clicca "Add user"
3. Compila email e password
4. Verifica che venga creato automaticamente un profilo in `profiles` (tramite trigger)

Se il profilo non viene creato automaticamente, controlla che il trigger `handle_new_user` sia attivo:

```sql
-- Verifica il trigger
SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';

-- Se non esiste, crealo
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'user')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```

## Debug Step-by-Step

### 1. Apri Console del Browser

Premi `F12` o `Cmd+Option+I` (Mac) per aprire DevTools

### 2. Vai alla Tab Console

Cerca questi messaggi quando apri il ProjectForm da admin:

✅ **Funzionamento Corretto:**
```
👑 Current user is admin, loading all users for sharing...
👤 Current user details: {id: "...", email: "...", role: "admin"}
📥 Fetching all users from Supabase...
✅ Fetched 5 users from Supabase
✅ Loaded 5 users for sharing
```

❌ **Problema - Nessun Utente:**
```
👑 Current user is admin, loading all users for sharing...
👤 Current user details: {id: "...", email: "...", role: "admin"}
📥 Fetching all users from Supabase...
⚠️  No profiles found in database
✅ Loaded 0 users for sharing
⚠️  No users loaded! Check:
   1. Supabase RLS policies allow admin to view profiles
   2. Admin user has role="admin" in profiles table
   3. There are other users in the profiles table
```

❌ **Problema - Errore Policy:**
```
👑 Current user is admin, loading all users for sharing...
👤 Current user details: {id: "...", email: "...", role: "admin"}
📥 Fetching all users from Supabase...
❌ Fetch users error: {...}
❌ Error details: {message: "...", code: "..."}
```

### 3. Verifica il Ruolo Admin

Se vedi `role: "user"` invece di `role: "admin"`, devi aggiornare il ruolo nel database.

### 4. Verifica le Policies

Se vedi errori come "permission denied" o "policy violation", devi controllare le RLS policies.

## Test Manuale delle Queries

Puoi testare la query direttamente da Supabase Dashboard → SQL Editor:

```sql
-- Come utente normale (sostituisci con un UUID utente)
SET LOCAL request.jwt.claim.sub TO 'uuid-utente-normale';
SELECT * FROM public.profiles;
-- Dovrebbe restituire solo il profilo dell'utente

-- Come admin
SET LOCAL request.jwt.claim.sub TO 'uuid-utente-admin';
SELECT * FROM public.profiles;
-- Dovrebbe restituire TUTTI i profili
```

## Errore "Column Not Found" Durante Upload

Se vedi questo errore durante l'upload di progetti:
```
❌ Failed to sync project UPDATE: Could not find the 'archived' column of 'projects' in the schema cache
```

**Causa**: Lo schema Supabase non è sincronizzato con lo schema locale. Il database locale (IndexedDB) ha colonne che non esistono su Supabase.

**Soluzione**:
1. Vai su Supabase Dashboard → SQL Editor
2. Esegui il file di migrazione: `docs/migration-add-archived-column.sql`
3. Questo aggiungerà la colonna `archived` alla tabella `projects`
4. Riprova l'upload del progetto

**Verifica**:
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'projects'
  AND column_name = 'archived';
```

Dovresti vedere:
```
column_name | data_type | is_nullable | column_default
archived    | boolean   | NO          | false
```

## Checklist Risoluzione

- [ ] RLS è abilitato sulla tabella `profiles`
- [ ] Policy "Users can view own profile" esiste
- [ ] Policy "Admins can view all profiles" esiste
- [ ] Il mio utente ha `role = 'admin'` nella tabella `profiles`
- [ ] Ci sono altri utenti nella tabella `profiles`
- [ ] Il trigger `handle_new_user` è attivo
- [ ] Ho fatto logout/login dopo aver cambiato il ruolo
- [ ] Ho cancellato IndexedDB e ricaricato i dati (vedi UPDATE_SYSTEM.md)
- [ ] Lo schema Supabase ha tutte le colonne richieste (incluso `archived`)

## Riapplicare Tutto lo Schema

Se niente funziona, puoi riapplicare l'intero schema:

1. **ATTENZIONE: Questo eliminerà tutti i dati!**
2. Vai su Supabase Dashboard → SQL Editor
3. Esegui il file `docs/supabase-schema.sql` completo
4. Ricrea gli utenti admin

## Ulteriore Supporto

Se il problema persiste dopo aver seguito tutti questi passaggi:

1. Controlla i log di Supabase: Dashboard → Logs → Postgres Logs
2. Verifica la configurazione di Supabase nel file `.env.local`
3. Controlla che Supabase sia configurato correttamente: `src/lib/supabase.ts`
4. Apri un issue su GitHub con:
   - Screenshot della console
   - Screenshot delle policies in Supabase
   - Screenshot della tabella profiles
