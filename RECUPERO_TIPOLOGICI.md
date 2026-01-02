# 🔧 Guida al Recupero dei Tipologici

## Il Problema

A causa di un bug ora **CORRETTO**, nascondere i tipologici nel ProjectForm e sincronizzare causava la cancellazione dei dati. Il bug è stato risolto, ma i dati già persi potrebbero essere recuperabili da Supabase.

## Soluzioni per il Recupero

### ✅ METODO CONSIGLIATO: Interfaccia Web (Funziona ovunque!)

Questo è il metodo più semplice e funziona sia in produzione che in locale.

#### Istruzioni:

1. **Apri l'applicazione principale** e **effettua il login**:
   - Produzione: https://opimappa.vercel.app
   - Locale: http://localhost:5173

2. **Apri lo strumento di recupero** in una NUOVA scheda:
   - Produzione: **https://opimappa.vercel.app/recover-typologies.html**
   - Locale: **http://localhost:5173/recover-typologies.html**

3. **Segui i 4 passaggi nell'interfaccia**:
   - **Step 1**: Clicca "Verifica Connessione e Autenticazione"
   - **Step 2**: Clicca "Carica Progetti da Supabase" - vedrai quanti progetti hanno tipologici
   - **Step 3**: Seleziona un progetto e clicca "Mostra Tipologici" per vedere l'anteprima
   - **Step 4**: Clicca "Ripristina Tipologici" per un singolo progetto o "Ripristina TUTTI" per tutti

4. **Ricarica l'applicazione principale** (F5) per vedere i tipologici ripristinati

---

### 🔧 METODO ALTERNATIVO: Script Console (Solo per utenti avanzati)

⚠️ **Nota**: Questo metodo potrebbe non funzionare in produzione a causa delle limitazioni degli import dinamici.

#### Istruzioni:

1. **Apri l'applicazione** e **effettua il login**

2. **Apri gli Strumenti per Sviluppatori** (F12)

3. **Vai nella tab "Console"**

4. **Copia il contenuto del file `recover-script.js`** e incollalo nella console

5. Segui le istruzioni visualizzate

---

## ⭐ Raccomandazione

**Usa l'interfaccia web** (primo metodo). È più semplice, più affidabile e funziona sia in locale che in produzione su Vercel!

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
