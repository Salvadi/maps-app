# PDR -- Sistema Intelligente per la Ricerca di Soluzioni Antincendio su Certificazioni PDF

## 1. Contesto e Obiettivi

Il presente documento descrive l'architettura tecnica e funzionale per
la realizzazione di una piattaforma software destinata alla ricerca
avanzata, analisi e consultazione di certificazioni antincendio in
formato PDF.

Il sistema nasce dall'esigenza di supportare tecnici, progettisti e
professionisti della prevenzione incendi nella consultazione rapida e
verificabile di soluzioni certificate, partendo da documenti normativi
complessi che includono:

-   Testi descrittivi
-   Tabelle tecniche
-   Figure e schemi
-   Riferimenti incrociati tra sezioni

L'obiettivo è creare un motore intelligente che consenta:

-   Ricerca semantica su contenuti tecnici
-   Estrazione automatica di regole e condizioni di applicabilità
-   Generazione di report tecnici con citazioni verificabili
-   Funzionamento offline-first
-   Scalabilità progressiva
-   Riduzione dei costi operativi

------------------------------------------------------------------------

## 2. Requisiti Funzionali

### 2.1 Ricerca

Il sistema deve permettere interrogazioni in linguaggio naturale, ad
esempio:

-   "Soluzioni tubi combustibili solaio EI 120"
-   "Diametro massimo tubo metallico con AF Pipeguard"

Restituendo:

-   Più soluzioni possibili
-   Condizioni tecniche
-   Classificazioni antincendio
-   Collegamenti diretti alle fonti

### 2.2 Report Tecnici

Ogni risposta deve poter generare un report contenente:

-   Estratti testuali
-   Tabelle rilevanti
-   Figure correlate
-   Numeri di pagina
-   Riferimenti al documento originale

### 2.3 Gestione Documentale

-   Upload singolo e batch
-   Versionamento
-   Aggiornamento incrementale
-   Re-indicizzazione selettiva

### 2.4 Modalità Offline

-   Cache locale tramite IndexedDB
-   Sincronizzazione con backend
-   Risoluzione conflitti

------------------------------------------------------------------------

## 3. Requisiti Non Funzionali

  Categoria       Requisito
  --------------- ----------------
  Performance     \< 2s
  Accuratezza     \> 90%
  Disponibilità   99.5%
  Scalabilità     fino a 500 PDF
  Sicurezza       JWT + RBAC
  Audit           Log completo

------------------------------------------------------------------------

## 4. Architettura Generale

    Frontend (React + Dexie)
            |
            v
    Backend API (FastAPI)
            |
            v
    Document Engine
            |
            v
    Supabase + Qdrant

------------------------------------------------------------------------

## 5. Stack Tecnologico

### 5.1 Frontend

-   React
-   Dexie.js
-   PDF.js

### 5.2 Backend

-   FastAPI
-   Celery / RQ
-   Redis
-   Docker

### 5.3 Database e Storage

-   Supabase (PostgreSQL + pgvector)
-   Supabase Storage
-   Qdrant Free Cluster

### 5.4 AI e NLP

  Funzione       Strumento
  -------------- ----------------------------
  Parsing        LayoutParser, Unstructured
  Tabelle        Camelot, Tabula
  OCR            Tesseract
  Embedding      BGE-M3
  Reranking      bge-reranker
  LLM            Qwen, Mistral, Llama
  API Fallback   OpenAI / Claude

------------------------------------------------------------------------

## 6. Schema Database

``` sql
create extension if not exists vector;

create table certificates (
  id uuid primary key,
  name text,
  version text,
  pages int,
  file_path text,
  uploaded_at timestamp
);

create table chunks (
  id uuid primary key,
  cert_id uuid,
  page int,
  section text,
  content text,
  embedding vector(1024),
  metadata jsonb
);

create table rules (
  id uuid primary key,
  cert_id uuid,
  summary text,
  conditions jsonb,
  result jsonb,
  pages int[]
);

create table references (
  id uuid primary key,
  rule_id uuid,
  page int,
  ref_type text,
  ref_label text
);
```

------------------------------------------------------------------------

## 7. Pipeline di Ingestion

1.  Upload PDF
2.  Salvataggio Storage
3.  Parsing layout
4.  Estrazione tabelle
5.  OCR immagini
6.  Normalizzazione chunk
7.  Generazione embedding
8.  Indicizzazione
9.  Rule extraction LLM
10. Reference linking

------------------------------------------------------------------------

## 8. Estrazione della Conoscenza

### 8.1 Rule Extraction

Input: Chunk strutturati

Output:

``` json
{
  "material": "PVC",
  "diameter": 110,
  "fire_class": "EI120",
  "product": "AF Collar",
  "pages": [7,32,46]
}
```

### 8.2 Linking

Costruzione grafo:

    Rule → Section → Table → Figure

------------------------------------------------------------------------

## 9. Motore di Ricerca

### 9.1 Pipeline

    Query → Parser → Filter → Vector → Rerank → Aggregate

### 9.2 Vector Search

``` sql
select *
from chunks
order by embedding <-> :query_embedding
limit 10;
```

------------------------------------------------------------------------

## 10. Generazione Report

-   Aggregazione riferimenti
-   Composizione JSON
-   Rendering HTML/PDF
-   Download/Condivisione

------------------------------------------------------------------------

## 11. Modalità Offline

-   Replica subset dati
-   Compressione embedding
-   Sync incrementale

------------------------------------------------------------------------

## 12. DevOps

-   Docker Compose
-   GitHub Actions
-   Backup automatici
-   Monitoring

------------------------------------------------------------------------

## 13. Sicurezza

-   JWT Auth
-   RBAC
-   Crittografia storage
-   Audit trail

------------------------------------------------------------------------

## 14. Costi Stimati

### Fase Setup (una tantum)

  Voce        Costo
  ----------- -------
  Ingestion   €0
  LLM Batch   €100
  Setup       €0

### Operativo

  Voce       Costo Mensile
  ---------- ---------------
  Supabase   €25
  Qdrant     €0
  Server     €15
  Storage    €5

Totale: \~€45/mese

------------------------------------------------------------------------

## 15. Roadmap

### Fase 1 (0-2 mesi)

-   Ingestion
-   Search base

### Fase 2 (3-4 mesi)

-   Report engine
-   Linking

### Fase 3 (5-6 mesi)

-   Comparazioni
-   Dashboard

------------------------------------------------------------------------

## 16. Rischi

  Rischio              Mitigazione
  -------------------- ----------------------
  Tabelle irregolari   LLM fallback
  OCR scarso           Review
  Allucinazioni        Citation enforcement
  Cambi normativi      Versioning

------------------------------------------------------------------------

## 17. KPI

-   Precision@5 \> 90%
-   Recall \> 85%
-   Coverage citazioni 100%
-   Latenza \< 2s

------------------------------------------------------------------------

## 18. Conclusione

Questa architettura consente di costruire un sistema professionale,
affidabile e scalabile per la gestione intelligente delle certificazioni
antincendio, mantenendo bassi i costi iniziali e permettendo upgrade
progressivi.

L'approccio ibrido open-source + servizi opzionali garantisce controllo,
sostenibilità e qualità industriale.
