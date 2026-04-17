# Online-First Audit (Apr 17, 2026)

## Contesto
Dopo la migrazione a Online-First (`ac4f0ff`) e i fix successivi su foto/planimetrie (`f1887e6`, `b5c8783`, `d59bee3`, `8b942c6`), la base è funzionale ma restano alcune aree critiche da consolidare per stabilità, UX e performance.

## Commit analizzati
- `ac4f0ff` — Migrazione architetturale Online-First
- `f1887e6` — Fix blob planimetrie/foto mancanti post-migrazione
- `b5c8783` — `getPhotosForMapping` online-first + fallback
- `d59bee3` — Signed URL per bucket foto privato
- `8b942c6` — Signed URL per bucket planimetrie privato

## Criticità principali trovate

### 1) Foto remote non resilienti a errori di firma URL
**Sintomo**: in `getPhotosForMapping`, se `createSignedUrls` fallisce, la funzione faceva throw e andava in fallback offline, con rischio di “foto sparite” quando i blob locali non esistono.  
**Impatto**: alto su utenti multi-dispositivo o su device appena loggati.  
**Fix applicato**: degradazione graceful: warning + fallback su `row.url` senza interrompere la lettura.

### 2) Overhead N+1 query IndexedDB nella lettura foto
**Sintomo**: `getPhotosForMapping` faceva `db.photos.get(row.id)` per ogni riga remota.  
**Impatto**: medio-alto su progetti grandi (latenza UI).  
**Fix applicato**: preload locale in una query (`toArray`) + mappa in memoria.

### 3) Ordinamento incoerente online vs offline dei progetti utente
**Sintomo**: online restituiva ordine `updatedAt DESC`, offline `sortBy('updatedAt')` (ASC).  
**Impatto**: medio, UX incoerente e regressioni percettive.  
**Fix applicato**: allineamento offline a `DESC`.

## Altre criticità da pianificare (non bloccanti)

1. **Scadenza signed URL (TTL 1h)**
   - Effetto: immagini/piante aperte a lungo possono diventare 403.
   - Proposta: refresh lazy delle URL alla ricezione 401/403 su fetch asset.

2. **Write-through cache seriale**
   - Effetto: molte operazioni await in loop possono rallentare dataset grandi.
   - Proposta: batching con `bulkPut` + lookup locale pre-caricato quando possibile.

3. **Osservabilità sync**
   - Effetto: difficile distinguere regressioni di rete da bug funzionali.
   - Proposta: metriche minime per tassi di fallback, retry e signed URL failure.

4. **Contratti TypeScript per record Supabase**
   - Effetto: uso diffuso di `any` nelle conversioni aumenta rischio di drift schema.
   - Proposta: introdurre tipi DTO `RemoteProject`, `RemoteMappingEntry`, `RemotePhoto`, ecc.

## Piano suggerito (breve)
1. Stabilizzazione letture remote (degradazione graceful già introdotta).
2. Performance pass su query calde (`photos`, `floor_plan_points`).
3. Hardening sync UX (retry/refresh URL scadute).
4. Tipizzazione DTO + test di integrazione offline/online.
