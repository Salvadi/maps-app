# Scripts per Aggiornamento "Da Completare"

Questa cartella contiene script per marcare automaticamente le mapping entries senza foto come "Da Completare" (to_complete = true).

## 🎯 Problema Risolto

Quando è stata aggiunta la funzionalità "Da Completare", le entry esistenti non avevano questo flag impostato. Questi script permettono di aggiornare in massa tutte le entry senza foto, marcandole come da completare.

## 📝 Script Disponibili

### 1. `mark_entries_without_photos.sql` ⭐ **CONSIGLIATO**

**Miglior opzione**: Esegui direttamente su Supabase per aggiornamenti rapidi.

**Come usare:**
1. Apri Supabase Dashboard
2. Vai su "SQL Editor"
3. Copia e incolla il contenuto del file
4. Clicca "Run"
5. Vedrai un riepilogo degli aggiornamenti

**Cosa fa:**
- Mostra quante entry saranno aggiornate
- Aggiorna tutte le entry senza foto
- Mostra un riepilogo e alcuni esempi

---

### 2. `markEntriesWithoutPhotos.js`

**Per browser**: Script JavaScript da eseguire nella console del browser.

**Come usare:**
1. Apri l'app nel browser
2. Apri la Console (F12)
3. Copia e incolla l'intero contenuto del file
4. Premi Invio
5. Lo script si eseguirà automaticamente

**Cosa fa:**
- Aggiorna IndexedDB locale
- Aggiorna Supabase
- Mostra progresso in console
- Alert finale con riepilogo

---

### 3. `markEntriesWithoutPhotos.ts`

Versione TypeScript per riferimento. Non eseguibile direttamente.

---

## 🔧 Fix Principale nel Codice

Il bug principale era in `src/sync/syncEngine.ts` nella funzione `downloadMappingEntriesFromSupabase`.

**Prima (BUG):**
```typescript
const mappingEntry: MappingEntry = {
  id: supabaseEntry.id,
  // ... altri campi ...
  crossings: supabaseEntry.crossings || [],
  // ❌ MANCAVA to_complete!
  timestamp: new Date(supabaseEntry.created_at).getTime(),
  // ...
};
```

**Dopo (FIXED):**
```typescript
const mappingEntry: MappingEntry = {
  id: supabaseEntry.id,
  // ... altri campi ...
  crossings: supabaseEntry.crossings || [],
  toComplete: supabaseEntry.to_complete || false, // ✅ AGGIUNTO!
  timestamp: new Date(supabaseEntry.created_at).getTime(),
  // ...
};
```

## 🚀 Raccomandazioni

1. **Esegui lo script SQL su Supabase** (più veloce e affidabile)
2. **Fai un sync manuale nell'app** dopo l'esecuzione
3. **Verifica** che i dati ora appaiano correttamente nell'app

## ⚠️ Note Importanti

- Gli script aggiornano solo le entry **senza foto**
- Le entry che già hanno `to_complete = true` vengono saltate
- La `version` viene incrementata per ogni entry aggiornata
- L'`updated_at` viene aggiornato al momento dell'esecuzione

## 📊 Esempio Output

```
📊 Summary:
   - Total entries checked: 150
   - Local IndexedDB updated: 45
   - Supabase updated: 45
   - Errors: 0

✅ Script completed successfully!
```
