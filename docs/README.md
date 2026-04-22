# Documentazione OPImaPPA

Indice dei documenti tecnici del progetto.

## Setup & deploy

- [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) — provisioning backend Supabase da zero (schema, RLS, bucket)
- [DEPLOYMENT.md](./DEPLOYMENT.md) — deploy su Vercel / Netlify
- [.env.local.example](./.env.local.example) — template variabili d'ambiente

## Runtime

- [CONFLICT_RESOLUTION.md](./CONFLICT_RESOLUTION.md) — strategia `last-modified-wins` per progetti e mapping entries
- [UPDATE_SYSTEM.md](./UPDATE_SYSTEM.md) — flusso di aggiornamento PWA via Service Worker

## File SQL

Lo schema Supabase vive in [`/supabase/`](../supabase/):

```
supabase/
├── schema.sql           # Baseline: tabelle, indici, trigger, RLS policies
└── storage-policies.sql # Bucket (photos, planimetrie) + policies
```

Non ci sono migration incrementali in repo: `schema.sql` è il singolo punto di verità e viene mantenuto allineato con lo stato live. Le modifiche al DB si propagano editando `schema.sql` e rieseguendolo (è idempotente) oppure con SQL mirato nella SQL Editor di Supabase.
