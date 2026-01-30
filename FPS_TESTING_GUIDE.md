# FPS Testing & Debugging Guide

## 🔍 Panoramica Architettura Sistema

### Architettura End-to-End

```
┌─────────────────────────────────────────────────────────────────┐
│                        INGESTION (LOCAL)                        │
├─────────────────────────────────────────────────────────────────┤
│ npm run ingest  →  203 PDF → LlamaParse (parse) →  Markdown    │
│                       ↓      Chunk (intelligente) → Vettori      │
│                    Qdrant (indicizzazione)  ←  OpenAI embedding  │
│                       ↓                                          │
│                   Supabase (metadata: certificati/chunk)         │
│                                                                  │
│ Nota: Gira LOCALMENTE, no timeout. Batch raro (annuale).       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    SEARCH (REAL-TIME, BROWSER)                  │
├─────────────────────────────────────────────────────────────────┤
│  CertSearch.tsx (React UI) sul browser                          │
│         ↓                                                        │
│  User query naturale + filtri (certificato, solo tabelle)      │
│         ↓                                                        │
│  /api/search (Vercel serverless, 30s timeout)                   │
│    1. OpenRouter: query → embedding 3072d                       │
│    2. Qdrant: vector search + payload filters                   │
│    3. Claude Sonnet: reranking + risposta + citazioni           │
│         ↓                                                        │
│  Risultati + AI answer card + report button                     │
│         ↓                                                        │
│  /api/report (genera HTML professionale)                        │
│  Report apribile in nuova finestra, stampabile (Ctrl+P)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📚 Tre Workflow Principali

### **WORKFLOW 1: INGESTION (Batch, locale)**

**Cosa accade:**
- 203 PDF vengono processati localmente
- Ogni PDF → Markdown strutturato (LlamaParse preserva tabelle)
- Chunking intelligente per sezione, overlap 50 token
- Ogni chunk → vettore OpenAI 3072d
- Qdrant indicizza vettori + metadata
- Supabase salva metadati

**Passaggi:**
```
1. LlamaParse API legge PDF → Markdown strutturato
2. Chunking: dividi per sezione (## header), mantieni tabelle intatte
3. OpenAI Embedding (text-embedding-3-large, 3072d): chunk → vettore
4. Qdrant: upsert points con payload (cert_name, section, content, has_table, chunk_index)
5. Supabase: insert in certificates + certificate_chunks tables
```

**File salvati localmente:**
- `./pdfs/*.parsed.md` → markdown intermedio (debug)
- `./pdfs/_extracted_rules.json` → regole strutturate (opzionale)

**Skip logic:**
- Se `.parsed.md` esiste, skip PDF
- `npm run ingest -- --force` per riprocessare

---

### **WORKFLOW 2: RICERCA (Real-time dal browser)**

**User journey:**
```
1. App home page → FAB Menu (+) → "Ricerca Certificazioni"
2. Input query: "Resistenza al fuoco EI120"
3. Filtri opzionali:
   - Certificato (dropdown)
   - Solo tabelle (toggle)
4. Click "Cerca"
   ↓
   Client invia POST /api/search { query, cert_filter, tables_only }
   ↓
   Server /api/search:
   - OpenRouter: query → embedding 3072d
   - Qdrant: vector_search top-k + apply filters
   - Claude Sonnet: rerank + generate answer con citazioni
   ↓
5. Response: { query, answer, citations, results[] }
   ↓
6. UI mostra:
   - AI Answer Card (con fonti)
   - Lista risultati espandibili (score visuale)
   - Tasto "Genera Report"
```

**Risultati esperienza:**
- Score colore-codificato (verde alta rilevanza, giallo bassa)
- Snippet del chunk (primi 300 char)
- Click per espandere contenuto completo
- Fonte: nome certificato + sezione

---

### **WORKFLOW 3: REPORT GENERATION**

**Trigger:** User click "Genera Report" dopo una ricerca

```
POST /api/report {
  query: "...",
  answer: "...",
  citations: [...],
  results: [...]
}
↓
Claude genera HTML professionale con:
1. Intestazione (query + data)
2. Sintesi risposta AI
3. Soluzioni trovate (elenco dettagliato)
4. Tabella riepilogativa
5. Fonti e riferimenti
↓
Response: { html: "<!DOCTYPE html>..." }
↓
Window.open() in nuova finestra
↓
User Ctrl+P → print/save PDF
```

---

## 🧪 CHECKLIST TESTING PRATICA

### **Phase 1: Validare Ingestion**

**Objective:** Verificare che 203 PDF siano stati processati correttamente

**Comandi:**
```bash
# Terminal per monitorare ingestion
cd scripts/ingest && npm run ingest

# Alternate: controlla Qdrant collection
curl -H "Authorization: Bearer YOUR_QDRANT_API_KEY" \
  https://928c1f34-5729-438a-9c48-dedc154155be.europe-west3-0.gcp.cloud.qdrant.io/collections/fire_certificates
```

**Verifiche Qdrant:**
- [ ] Collection "fire_certificates" esiste
- [ ] Vector size = 3072
- [ ] Points count > 5000 (expectation: 8000-15000 chunks da 203 certificati)

**Verifiche Supabase:**
```sql
SELECT COUNT(*) as certificates FROM certificates;
SELECT COUNT(*) as chunks FROM certificate_chunks;
SELECT COUNT(*) as unique_certs FROM (
  SELECT DISTINCT cert_id FROM certificate_chunks
);
```

**Expectation:**
- [ ] `certificates` ≈ 203 (o numero PDF processati)
- [ ] `certificate_chunks` ≈ 8000-15000 (chunks totali)
- [ ] unique_certs ≈ 203

**Possibili issues:**
- ❌ Qdrant collection non esiste → ingest.js auto-crea ✓
- ❌ RLS errors → migration 005_certificates_schema.sql non eseguita
- ❌ Supabase timeout → check .env SUPABASE_URL/SERVICE_KEY

---

### **Phase 2: Configurare Vercel Environment**

**Objective:** Environment variables disponibili per API routes

**Via Vercel Dashboard:**
```
https://vercel.com → [project] → Settings → Environment Variables
```

**Aggiungi:**
- `OPENROUTER_API_KEY` = sk-or-v1-...
- `QDRANT_URL` = https://928c1f34-5729-...eu-west3-0.gcp.cloud.qdrant.io
- `QDRANT_API_KEY` = eyJhbGc...

**Oppure via CLI:**
```bash
cd /path/to/maps-app
vercel env add OPENROUTER_API_KEY
vercel env add QDRANT_URL
vercel env add QDRANT_API_KEY
```

**Verify:**
```bash
vercel env list
```

**Post-deploy check:**
- [ ] Variables visibili in Vercel dashboard
- [ ] Deploy nuovo (push) per applicare

---

### **Phase 3: Test Search Locale (Dev Server)**

**Objective:** Testare la pipeline di ricerca end-to-end

**Setup:**
```bash
npm run dev
# Apri http://localhost:5173
# Se richiede auth, login con credenziali test
```

**Test Query 1: Simple Search**
```
Input: "EI120"
Expected:
  ✓ Results card lista 3-5 chunk rilevanti
  ✓ AI answer card: "EI120 è una classificazione di resistenza al fuoco..."
  ✓ Score > 0.7 (similarity)
  ✓ No console errors
```

**Test Query 2: Table Filter**
```
Input: "proprietà diametri materiali"
Filter: "Solo sezioni con tabelle" = ON
Expected:
  ✓ Results mostrano solo chunk con tabelle Markdown (contengono "|")
  ✓ has_table=true in Qdrant payload
  ✓ Snippet mostra porzione di tabella
```

**Test Query 3: Certificate Filter**
```
Input: "resistenza"
Filter: Certificato = "PROMATECT 100" (se disponibile)
Expected:
  ✓ Results limitati a quel certificato
  ✓ cert_name nel payload = "PROMATECT 100"
  ✓ Meno risultati rispetto query non filtrata
```

**Test Query 4: No Results Edge Case**
```
Input: "xyz123randomnonexistent"
Expected:
  ✓ Empty state message
  ✓ AI answer: "Non ho trovato..."
  ✓ No crash/error
```

**Test Query 5: Long Query**
```
Input: "Quali sono le proprietà chimiche e le condizioni di applicazione dei prodotti in relazione alle diverse classi di fuoco e ai materiali di supporto?"
Expected:
  ✓ Embedding generato (non timeout)
  ✓ Qdrant search completa
  ✓ Claude rerank + answer entro 30s Vercel timeout
```

---

### **Phase 4: Test Report Generation**

**Setup:** Avere completato Test Query 1 (almeno 1 risultato)

**Test Report 1: Basic HTML**
```
1. Click "Genera Report" button
2. Aspetta 5-10 secondi (Claude elabora)
3. Nuova finestra apre
4. Verifica contenuti:
   ✓ Title tag include la query
   ✓ Styling applicato (colori, font, layout)
   ✓ Intestazione con data odierna
   ✓ Sintesi della risposta AI
   ✓ Lista soluzioni (risultati)
   ✓ Sezione "Fonti e Riferimenti"
   ✓ Footer con timestamp
```

**Test Report 2: Stampa/PDF**
```
1. Finestra report aperta
2. Ctrl+P (o File → Print)
3. Salva come PDF
4. Verifica PDF:
   ✓ Layout preservato
   ✓ Pagine multiple se necessario
   ✓ Immagini/tabelle intatte
   ✓ Testo leggibile
```

**Possibili issues:**
- ❌ Finestra blank → Claude API failed, check browser console
- ❌ CSS non applicato → HTML malformato
- ❌ Timeout su /api/report → aumentare max_tokens o ridurre resultCount

---

### **Phase 5: Browser Console & Network Checks**

**Objective:** Validare assenza di errori e performance

**Apri DevTools (F12):**

**Console tab:**
```
✓ Zero errors (reds)
✓ Zero CORS warnings (da api/search, api/report)
✓ Possibili warnings ignorabili (React dev warnings)
```

**Network tab:**
```
Filtra per: fetch/XHR

POST /api/search?
  ✓ Status 200
  ✓ Response: { query, answer, citations, results }
  ✓ Duration: 5-15s (normal, Claude elabora)
  ✓ Size: 50-200KB

POST /api/report?
  ✓ Status 200
  ✓ Response: { html: "<!DOCTYPE..." }
  ✓ Duration: 8-12s
  ✓ Size: 100-300KB
```

**Performance tab:**
```
✓ No layout thrashing
✓ First contentful paint < 2s (se già caricato)
✓ Interaction to paint < 100ms
```

---

## 🐛 Bug Tracking & Issues

### **Known Issues**

| # | Issue | Severity | Status | Notes |
|---|-------|----------|--------|-------|
| I-5 | Vercel free tier 10s timeout (search+LLM può eccedere) | Medium | ⚠️ Monitor | Se fallisce, upgrade a Vercel Pro (30s) o split calls |
| I-6 | Qdrant free cluster 1GB limit | Low | ⚠️ Monitor | 203 PDF × embedding 3072d = ~500MB max (within limit) |

### **Testing Issues Found**

Documentare qui durante testing:

```
[TESTING SESSION]
Date: YYYY-MM-DD
Tester:
Result:

| # | Issue | Steps to Reproduce | Expected | Actual | Fix | Status |
|---|-------|-------------------|----------|--------|-----|--------|
| B-1 |  |  |  |  |  | 🔴 Open |
```

---

## ✅ Final Validation Checklist

**Prima di considerare il sistema "production-ready":**

- [ ] **Ingestion:** 203 PDF → Qdrant/Supabase (0 errors)
- [ ] **Qdrant:** ~10K+ points, correct vector size (3072)
- [ ] **Supabase:** ~203 certificates, ~10K chunks
- [ ] **Vercel:** Environment variables configurate
- [ ] **Search:** Test Query 1-5 pass, no console errors
- [ ] **Report:** HTML generato correttamente, stampabile
- [ ] **Filters:** Certificato + Tables toggle funzionano
- [ ] **Network:** All API calls 200, durations acceptable
- [ ] **Edge cases:** No results handled gracefully
- [ ] **Performance:** <30s Vercel timeout respected

---

## 📋 Next Steps After Testing

1. **If all tests pass:**
   - Push branch to remote
   - Create PR to master
   - Deploy to production
   - Celebrate! 🎉

2. **If issues found:**
   - Document in Bug Tracking section above
   - Prioritize by severity
   - Create fixes in separate commits
   - Re-test phases affected by fix

3. **Post-deployment:**
   - Monitor Vercel logs for API errors
   - Monitor Qdrant points growth
   - Monitor Supabase row counts
   - Gather user feedback on search quality

---

## 🔗 Useful Links & Commands

**Qdrant Cloud Dashboard:**
```
https://cloud.qdrant.io/clusters
```

**Supabase Dashboard:**
```
https://supabase.com/dashboard/project/tpqgojucydzobrhpdmks
```

**Vercel Dashboard:**
```
https://vercel.com/dashboard
```

**Local Dev Server:**
```bash
npm run dev
# http://localhost:5173
```

**Ingest Status Check:**
```bash
cd scripts/ingest
npm run ingest 2>&1 | tail -50  # Last 50 lines
```

**Check Qdrant Points:**
```bash
curl -s -H "Authorization: Bearer $QDRANT_API_KEY" \
  $QDRANT_URL/collections/fire_certificates | jq .
```

**Check Supabase:**
```sql
-- In Supabase SQL Editor
SELECT
  COUNT(*) as total_chunks,
  COUNT(DISTINCT cert_id) as unique_certs,
  COUNT(CASE WHEN has_table THEN 1 END) as chunks_with_tables
FROM certificate_chunks;
```

---

## 📝 Testing Notes

Use this section to log observations during testing:

```
[Session 1 - 2026-01-30]
- Started ingestion of 203 PDFs
- First batch processed successfully
- Monitoring for completion...

[Session 2 - TBD]
- [Your notes here]
```

