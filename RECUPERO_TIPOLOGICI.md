# 🔧 Guida al Recupero dei Tipologici

## Il Problema

A causa di un bug ora **CORRETTO**, nascondere i tipologici nel ProjectForm e sincronizzare causava la cancellazione dei dati. Il bug è stato risolto, ma i dati già persi potrebbero essere recuperabili da Supabase.

## Soluzioni per il Recupero

### ✅ METODO CONSIGLIATO: Script nella Console del Browser

Questo è il metodo più semplice e diretto.

#### Istruzioni:

1. **Avvia l'applicazione** nel browser (assicurati che sia in esecuzione)

2. **Effettua il login** se non lo hai già fatto

3. **Apri gli Strumenti per Sviluppatori**:
   - Chrome/Edge: Premi `F12` o `Ctrl+Shift+I`
   - Firefox: Premi `F12`
   - Safari: `Cmd+Option+I`

4. **Vai nella tab "Console"**

5. **Copia il contenuto del file `recover-script.js`** e incollalo nella console, poi premi Invio

6. Lo script mostrerà tutti i progetti con tipologici trovati su Supabase

7. **Scegli come procedere**:

   **Opzione A - Ripristina un singolo progetto:**
   ```javascript
   restoreProjectTypologies(0)  // 0 è l'indice del progetto nell'elenco
   ```

   **Opzione B - Ripristina TUTTI i progetti automaticamente:**
   ```javascript
   restoreAllTypologies()
   ```

8. **Ricarica la pagina** (premi `F5`) per vedere i tipologici ripristinati

---

### 🌐 METODO ALTERNATIVO: Interfaccia Web

Se preferisci un'interfaccia grafica:

1. Avvia il server di sviluppo dell'applicazione

2. Apri nel browser: `http://localhost:5173/recover-typologies.html`

3. Segui le istruzioni nell'interfaccia:
   - Clicca "Carica Progetti dal Server"
   - Seleziona un progetto dall'elenco
   - Visualizza i tipologici in anteprima
   - Clicca "Ripristina Tipologici nel Database Locale"

4. Ricarica l'applicazione

---

## Come Funziona il Recupero

Lo script:

1. ✅ Si connette a Supabase utilizzando la tua sessione attuale
2. ✅ Scarica tutti i progetti dal server
3. ✅ Identifica quali progetti hanno tipologici salvati
4. ✅ Mostra un'anteprima dei dati
5. ✅ Ripristina i tipologici nel database locale IndexedDB

## Domande Frequenti

### ❓ I miei dati sono sul server?

Solo se hai sincronizzato il progetto **PRIMA** che i tipologici venissero cancellati. Se non hai mai sincronizzato o se hai cancellato i dati prima della prima sincronizzazione, i dati potrebbero non essere recuperabili.

### ❓ Cosa succede se non trovo i miei tipologici?

Se i progetti su Supabase non hanno tipologici, significa che:
- Non erano mai stati sincronizzati al server
- Erano stati cancellati anche sul server

In questo caso, purtroppo i dati non sono recuperabili automaticamente. Dovrai reinserirli manualmente.

### ❓ È sicuro eseguire questi script?

Sì, gli script:
- Operano solo in lettura su Supabase
- Modificano solo il database locale IndexedDB
- Non eliminano dati esistenti
- Non modificano il server

### ❓ Devo fare backup prima?

Non è strettamente necessario, ma se vuoi essere sicuro puoi:
1. Esportare il database IndexedDB usando gli strumenti del browser
2. Fare uno screenshot dei tuoi tipologici attuali

### ❓ Dopo il recupero, cosa succede alla sincronizzazione?

Dopo aver ripristinato i tipologici localmente, alla prossima sincronizzazione verranno mantenuti correttamente grazie alla correzione del bug.

---

## Il Bug è Stato Corretto

Il bug nel file `src/components/ProjectForm.tsx` è stato corretto nel commit `6f10926`.

**Prima (BUG):**
```typescript
typologies: showTipologici ? typologies : []  // ❌ Cancellava i dati!
```

**Dopo (CORRETTO):**
```typescript
typologies: showTipologici ? typologies : (project.typologies || [])  // ✅ Preserva i dati!
```

Ora puoi nascondere e mostrare i tipologici senza rischio di perdere i dati.

---

## Supporto

Se hai problemi con il recupero:
1. Verifica di essere autenticato
2. Verifica la connessione internet
3. Controlla la console del browser per eventuali errori
4. Verifica che il progetto esista sia localmente che su Supabase

Per ulteriore assistenza, contatta il team di sviluppo.
