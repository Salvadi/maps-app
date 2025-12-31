# OPImaPPA - Documentazione

Questa cartella contiene la documentazione tecnica dell'applicazione OPImaPPA.

## 📚 Documenti Disponibili

### Setup e Deployment

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Guida completa per il deployment su Vercel/Netlify
- **[SUPABASE_SETUP.md](./SUPABASE_SETUP.md)** - Configurazione del backend Supabase

### Funzionalità Avanzate

- **[CONFLICT_RESOLUTION.md](./CONFLICT_RESOLUTION.md)** - Sistema di risoluzione conflitti per sincronizzazione multi-dispositivo
- **[UPDATE_SYSTEM.md](./UPDATE_SYSTEM.md)** - Sistema di aggiornamento automatico con Service Worker

### Configurazione Database

- **[ACTION_ITEMS_RLS_POLICIES.md](./ACTION_ITEMS_RLS_POLICIES.md)** - Action items per le policy RLS (Row Level Security)
- **[RLS_POLICIES_ANALYSIS.md](./RLS_POLICIES_ANALYSIS.md)** - Analisi dettagliata delle policy di sicurezza

### File di Configurazione

- **[.env.local.example](./.env.local.example)** - Template per le variabili d'ambiente

## 🗂️ Struttura File SQL

I file SQL sono organizzati nella cartella `/supabase/`:

```
supabase/
├── schema.sql              # Schema completo del database
├── storage-policies.sql    # Policy per Supabase Storage
└── migrations/
    ├── README.md
    ├── 20250101000000_add_sync_enabled_to_projects.sql
    ├── 20250104000001_update_projects_rls_policies.sql
    └── 20250104000002_add_projects_conflict_resolution.sql
```

## 🚀 Quick Start

Per iniziare con l'applicazione:

1. Leggi il **[README principale](../README.md)** per una panoramica completa
2. Segui la guida **[SUPABASE_SETUP.md](./SUPABASE_SETUP.md)** per configurare il backend
3. Consulta **[DEPLOYMENT.md](./DEPLOYMENT.md)** per il deploy in produzione

## 📖 Per Sviluppatori

### Modifiche al Database

Quando apporti modifiche al database:

1. Crea una nuova migration in `/supabase/migrations/`
2. Usa il formato timestamp: `YYYYMMDDHHMMSS_description.sql`
3. Testa la migration in ambiente di sviluppo
4. Documenta le modifiche in questa sezione

### Aggiornamenti Documentazione

La documentazione deve essere mantenuta aggiornata:

- Aggiorna i file rilevanti quando modifichi funzionalità
- Rimuovi documentazione obsoleta
- Mantieni la struttura organizzata

## ⚠️ Note Importanti

### Migrations

Le migration SQL sono organizzate cronologicamente:

- `20250101000000` - Sync enabled (deprecato, ora locale)
- `20250104000001` - Update RLS policies
- `20250104000002` - Conflict resolution

### Backward Compatibility

L'applicazione mantiene la compatibilità con progetti esistenti:

- Campi opzionali per nuove feature
- Gestione graceful di dati mancanti
- Fallback per configurazioni precedenti

## 🔗 Link Utili

- [Supabase Documentation](https://supabase.com/docs)
- [Vercel Documentation](https://vercel.com/docs)
- [PWA Guidelines](https://web.dev/progressive-web-apps/)

---

**Ultimo aggiornamento:** 2025-12-30
**Versione:** 1.0.0
