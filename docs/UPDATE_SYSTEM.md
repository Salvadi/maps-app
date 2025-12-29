# Sistema di Aggiornamento Automatico

## Panoramica

L'applicazione è dotata di un sistema di aggiornamento automatico che rileva quando è disponibile una nuova versione e guida l'utente attraverso il processo di aggiornamento.

## Come Funziona

### 1. Rilevamento Aggiornamenti

Il **Service Worker** controlla automaticamente se è disponibile una nuova versione dell'applicazione ogni volta che:
- L'utente carica l'app
- L'utente naviga nell'app
- Periodicamente in background

### 2. Notifica all'Utente

Quando viene rilevato un aggiornamento, appare un **banner di notifica** nella parte inferiore dello schermo:

```
🔄 Nuova versione disponibile!
Clicca "Aggiorna" per caricare l'ultima versione.
I dati locali verranno puliti e riscaricati da Supabase.

[Aggiorna Ora]  [Dopo]
```

### 3. Processo di Aggiornamento

Quando l'utente clicca su **"Aggiorna Ora"**, il sistema esegue automaticamente:

1. **Pulizia IndexedDB**
   - Elimina tutti i database locali (progetti, mapping entries, foto)
   - Assicura che non ci siano dati obsoleti o corrotti

2. **Pulizia Cache**
   - Elimina tutte le cache del service worker
   - Garantisce che vengano scaricati i file più recenti

3. **Pulizia LocalStorage**
   - Pulisce i dati temporanei
   - **Preserva il token di autenticazione** per evitare di fare logout

4. **Attivazione Nuova Versione**
   - Il nuovo service worker viene attivato
   - L'app viene ricaricata con la nuova versione

5. **Riscaricamento Dati**
   - Al login, i dati vengono riscaricati da Supabase
   - Tutto è sincronizzato con la versione più recente

## Vantaggi

✅ **Aggiornamenti Automatici**: Nessuna necessità di reinstallare l'app
✅ **Pulizia Dati**: Elimina dati corrotti o obsoleti
✅ **Seamless**: L'utente rimane autenticato durante l'aggiornamento
✅ **Sicuro**: I dati vengono riscaricati da Supabase
✅ **Offline-First**: Funziona anche con connessione intermittente

## Per Sviluppatori

### Rilasciare un Aggiornamento

1. **Modificare il codice** dell'applicazione

2. **Incrementare CACHE_VERSION** in `public/service-worker.js`:
   ```javascript
   const CACHE_VERSION = 4; // Incrementa questo numero!
   ```

3. **Fare il build** della nuova versione:
   ```bash
   npm run build
   ```

4. **Deployare** su produzione

5. Gli utenti riceveranno automaticamente la notifica al prossimo caricamento dell'app

### File Coinvolti

- **`public/service-worker.js`**: Service worker con logica di caching e aggiornamento
- **`src/components/UpdateNotification.tsx`**: Componente UI per la notifica
- **`src/components/UpdateNotification.css`**: Stili del componente
- **`src/serviceWorkerRegistration.ts`**: Registrazione del service worker
- **`src/index.tsx`**: Configurazione callbacks onUpdate

### Flusso Tecnico

```
1. Nuovo service worker installato → onupdatefound
2. Service worker in stato "installed" → onUpdate callback
3. index.tsx lancia evento 'swUpdate'
4. App.tsx cattura evento → setSwRegistration
5. UpdateNotification riceve registration
6. Utente clicca "Aggiorna"
7. clearIndexedDB() → clearCaches() → clearLocalStorage()
8. postMessage('SKIP_WAITING') al service worker
9. Service worker fa skipWaiting()
10. 'controllerchange' event → reload della pagina
11. Nuova versione attiva!
```

### Debugging

Per testare il sistema di aggiornamento in locale:

1. **Prima versione**:
   ```bash
   npm run build
   npm install -g serve
   serve -s build -p 3000
   ```

2. **Modificare CACHE_VERSION** e rifare il build:
   ```javascript
   const CACHE_VERSION = 100; // Versione di test
   ```
   ```bash
   npm run build
   ```

3. **Ricaricare la pagina** nel browser

4. **Aprire DevTools → Console** per vedere i log:
   ```
   📦 Service Worker update detected in App
   🗑️  Clearing IndexedDB...
   📦 Found databases: ["MappingDatabase"]
   ✅ Deleted database: MappingDatabase
   ✅ IndexedDB cleared successfully
   🗑️  Clearing caches...
   📦 Found caches: ["mapping-app-v3", "mapping-app-runtime-v3"]
   ✅ Deleted cache: mapping-app-v3
   ✅ Deleted cache: mapping-app-runtime-v3
   ✅ All caches cleared
   🗑️  Clearing localStorage...
   ✅ localStorage cleared
   📤 Sending SKIP_WAITING message to service worker
   [Service Worker] Message received: {type: "SKIP_WAITING"}
   [Service Worker] Skipping waiting and activating immediately
   🔄 New service worker activated, reloading...
   ```

### Gestione Errori

Il sistema è progettato per essere **robusto**:

- Se la pulizia di IndexedDB fallisce, continua comunque
- Se la pulizia delle cache fallisce, continua comunque
- Se il service worker non risponde entro 2 secondi, ricarica comunque
- Se ci sono errori durante il processo, ricarica la pagina

### Preservare Dati Durante l'Aggiornamento

Se in futuro si vogliono preservare alcuni dati durante l'aggiornamento, modificare `clearLocalStorage()` in `UpdateNotification.tsx`:

```typescript
const keysToPreserve = [
  'supabase.auth.token',      // Già preservato
  'user-preferences',         // Aggiungi qui
  'app-settings'              // Altri dati da preservare
];
```

## FAQ

**Q: L'aggiornamento elimina i miei dati?**
A: Sì, i dati locali vengono eliminati, ma vengono immediatamente riscaricati da Supabase al prossimo login.

**Q: Devo fare logout durante l'aggiornamento?**
A: No, il token di autenticazione viene preservato.

**Q: Cosa succede se rifiuto l'aggiornamento?**
A: Puoi cliccare "Dopo" e continuare a usare la versione corrente. Il banner riapparirà al prossimo caricamento dell'app.

**Q: L'aggiornamento funziona offline?**
A: Il rilevamento richiede una connessione, ma una volta rilevato, il processo funziona anche offline.

**Q: Come faccio a forzare un aggiornamento manualmente?**
A: DevTools → Application → Service Workers → "Update" → Ricarica la pagina

## Migliori Pratiche

1. **Incrementa sempre CACHE_VERSION** quando fai deploy
2. **Testa gli aggiornamenti** in locale prima del deploy
3. **Monitora i log** in produzione per individuare problemi
4. **Comunica agli utenti** quando ci sono aggiornamenti importanti
5. **Non modificare la struttura del database** senza migration script

## Troubleshooting

### L'aggiornamento non appare

1. Verifica che CACHE_VERSION sia stato incrementato
2. Verifica che il build sia stato fatto correttamente
3. Fai hard refresh (Ctrl+Shift+R o Cmd+Shift+R)
4. Controlla DevTools → Application → Service Workers

### L'app non ricarica dopo l'aggiornamento

1. Apri la console per vedere gli errori
2. Verifica che il service worker sia attivo
3. Prova a disinstallare il service worker e ricaricare

### I dati non vengono riscaricati

1. Verifica la connessione a Supabase
2. Controlla che l'utente sia autenticato
3. Verifica i log di sync nella console

## Roadmap Futura

- [ ] Mostrare changelog nella notifica di aggiornamento
- [ ] Permettere aggiornamenti in background senza conferma
- [ ] Notifiche push per aggiornamenti critici
- [ ] Rollback automatico in caso di errori
- [ ] Analytics sugli aggiornamenti
