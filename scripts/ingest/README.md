# FPS Ingestion Pipeline

Script locale per processare certificazioni antincendio PDF e indicizzarle per la ricerca semantica.

## Setup

```bash
cd scripts/ingest
npm install
```

## Uso

1. Metti i PDF in `./pdfs/`
2. Configura `.env` con le API keys
3. Esegui:

```bash
# Test senza scrivere nulla
npm run ingest:dry

# Processamento reale
npm run ingest
```

## Pipeline

```
PDF → LlamaParse (tabelle + testo) → Chunking → OpenAI Embedding (3072d) → Qdrant + Supabase
```

## Output

- Vettori indicizzati su Qdrant Cloud
- Metadata certificati su Supabase
- File `.parsed.md` per debug (nella cartella pdfs/)
