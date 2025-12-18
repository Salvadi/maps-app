# ⚠️ MIGRAZIONE DATABASE RICHIESTA

## Problema
L'app sta fallendo perché il database Supabase non ha ancora la colonna `sync_enabled` nella tabella `projects`.

## Soluzione Rapida (5 minuti)

### Passo 1: Apri Supabase Dashboard
1. Vai su https://supabase.com/dashboard
2. Seleziona il tuo progetto
3. Clicca su **SQL Editor** nel menu laterale

### Passo 2: Esegui la Migrazione
1. Apri il file `SUPABASE_MIGRATION.sql` nella root del progetto
2. Copia **TUTTO** il contenuto
3. Incolla nell'SQL Editor di Supabase
4. Clicca **Run** (o premi Cmd/Ctrl + Enter)

### Passo 3: Verifica
Dovresti vedere:
- ✅ "Success" nel risultato dell'esecuzione
- Una tabella che mostra i dati della colonna `sync_enabled`
- Una lista di 5 progetti con il nuovo campo

## Cosa fa questa migrazione?

Aggiunge il campo `sync_enabled` che permette di:
- ✅ Scegliere quali progetti sincronizzare completamente
- ✅ Alleggerire l'app al primo avvio (default: solo metadati)
- ✅ Controllare il consumo dati e spazio storage

## Alternative

Se preferisci usare la CLI di Supabase:

```bash
# Naviga nella cartella del progetto
cd /home/user/maps-app

# Esegui la migrazione
supabase db push
```

## Dopo la migrazione

Una volta completata la migrazione:
1. Ricarica l'app nel browser
2. Il checkbox di sync apparirà su ogni progetto
3. Click sul checkbox per attivare la sincronizzazione completa

## Supporto

Se hai problemi:
1. Verifica di essere loggato nel progetto Supabase corretto
2. Controlla che l'utente abbia permessi di modifica dello schema
3. Consulta i log di Supabase per eventuali errori

---

**Nota**: Tutti i progetti esistenti avranno `sync_enabled = 0` di default (solo metadati).
