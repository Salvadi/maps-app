# Supabase Setup

Procedura per ricostruire il backend Supabase di OPImaPPA da zero, oppure riallineare un'istanza esistente allo schema corrente.

## 1. Progetto Supabase

1. Crea un progetto su [supabase.com](https://supabase.com).
2. In **Project Settings → API** copia:
   - `Project URL` → `REACT_APP_SUPABASE_URL`
   - `anon` public key → `REACT_APP_SUPABASE_ANON_KEY`
3. Inserisci entrambe in `.env.local` nella root del progetto (template in [.env.local.example](./.env.local.example)).

## 2. Schema database

Apri **SQL Editor** e incolla integralmente [`supabase/schema.sql`](../supabase/schema.sql).

Lo script è **idempotente** (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` prima di ogni `CREATE POLICY`), quindi puó essere rieseguito senza errori anche su un DB già popolato — serve anche come riallineamento.

Lo script crea:

- Estensione `uuid-ossp`
- Funzione helper `public.is_admin()` (SECURITY DEFINER)
- Tabelle: `profiles`, `projects`, `mapping_entries`, `photos`, `floor_plans`, `floor_plan_points`, `dropdown_options`, `products`, `sals`, `typology_prices`, `standalone_maps`
- Indici, trigger `updated_at`, trigger `last_modified` per `projects`
- Trigger `on_auth_user_created` che crea automaticamente una riga in `profiles` al signup
- RLS enabled + policies complete per ogni tabella

## 3. Storage buckets

Sempre da SQL Editor, incolla [`supabase/storage-policies.sql`](../supabase/storage-policies.sql). Crea e configura due bucket:

| Bucket        | Visibilità          | Uso                                    |
|---------------|---------------------|----------------------------------------|
| `photos`      | privato             | Foto dei mapping entry (signed URL)    |
| `planimetrie` | pubblico in lettura | Immagini e PDF delle planimetrie       |

Path convention: nel bucket `photos` i file vivono in `{mappingEntryId}/{photoId}.jpg`.

## 4. Primo admin

Dopo il primo signup tramite l'app, promuovi l'utente a admin da SQL Editor:

```sql
UPDATE public.profiles SET role = 'admin' WHERE email = 'tua@email.com';
```

Solo gli admin possono popolare `dropdown_options` e `products` via UI (pagina Impostazioni).

## 5. Verifica

```sql
-- Tabelle create
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- RLS attiva ovunque
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Bucket creati
SELECT id, public FROM storage.buckets WHERE id IN ('photos','planimetrie');
```

Attesi in `public.`:
`dropdown_options, floor_plan_points, floor_plans, mapping_entries, photos, products, profiles, projects, sals, standalone_maps, typology_prices`.

## Note

- **Conflict resolution**: `projects` e `mapping_entries` portano `version` + `last_modified`; il trigger `update_projects_last_modified` aggiorna il timestamp sul server. Dettagli in [CONFLICT_RESOLUTION.md](./CONFLICT_RESOLUTION.md).
- **Aggiornamenti schema**: edita `schema.sql` e rieseguilo, oppure applica SQL mirato. Non ci sono migration incrementali nel repo — `schema.sql` è la baseline.
- **Pipeline RAG certificati**: vive in un repo separato. Le tabelle `rag_*`, `manufacturers`, `manufacturer_lexicon` non fanno parte di questo schema.
