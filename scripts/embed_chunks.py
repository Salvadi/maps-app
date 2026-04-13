"""
embed_chunks.py — Genera embedding per tutti i chunk di certificate_chunks su Supabase.

Usa OpenRouter (openai/text-embedding-3-small) per gli embedding.
È riprendibile: filtra solo i chunk con embedding IS NULL.

Setup:
  pip install openai supabase python-dotenv

Env vars richieste in .env.local:
  REACT_APP_SUPABASE_URL   — URL del progetto Supabase
  SUPABASE_SERVICE_KEY     — service_role key (Supabase → Settings → API)
  OPENROUTER_API_KEY       — chiave OpenRouter

Costo stimato: ~$0.08 una tantum per 13k chunks.
Dopo l'esecuzione, eseguire su Supabase SQL Editor:
  REINDEX INDEX idx_cert_chunks_embedding;
"""

import os
import time
import sys
from openai import OpenAI
from supabase import create_client
from dotenv import load_dotenv

# Carica .env.local dalla root del progetto
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get("REACT_APP_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY")

if not all([SUPABASE_URL, SUPABASE_KEY, OPENROUTER_KEY]):
    print("Errore: variabili d'ambiente mancanti.")
    print("  REACT_APP_SUPABASE_URL:", "OK" if SUPABASE_URL else "MANCANTE")
    print("  SUPABASE_SERVICE_KEY:  ", "OK" if SUPABASE_KEY else "MANCANTE")
    print("  OPENROUTER_API_KEY:    ", "OK" if OPENROUTER_KEY else "MANCANTE")
    sys.exit(1)

client = OpenAI(
    api_key=OPENROUTER_KEY,
    base_url="https://openrouter.ai/api/v1",
)
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

BATCH_SIZE = 100      # chunks per chiamata OpenRouter
FETCH_LIMIT = 500     # chunk recuperati per iterazione (per non caricare tutto in RAM)
MODEL = "openai/text-embedding-3-small"


def get_unembed_chunks(limit: int) -> list[dict]:
    result = (
        supabase.table("certificate_chunks")
        .select("id, content")
        .is_("embedding", "null")
        .limit(limit)
        .execute()
    )
    return result.data or []


def embed_batch(texts: list[str]) -> list[list[float]]:
    response = client.embeddings.create(
        model=MODEL,
        input=texts,
    )
    return [item.embedding for item in response.data]


def save_embeddings(rows: list[dict], embeddings: list[list[float]]) -> None:
    supabase.table("certificate_chunks").upsert(
        [{"id": row["id"], "embedding": emb} for row, emb in zip(rows, embeddings)],
        on_conflict="id",
    ).execute()


def main() -> None:
    print(f"Avvio embedding con modello {MODEL}...")
    total_done = 0

    while True:
        chunks = get_unembed_chunks(FETCH_LIMIT)
        if not chunks:
            print(f"\nCompletato. Totale chunk embeddati: {total_done}")
            break

        for i in range(0, len(chunks), BATCH_SIZE):
            batch = chunks[i : i + BATCH_SIZE]
            texts = [c["content"] for c in batch]

            try:
                embeddings = embed_batch(texts)
                save_embeddings(batch, embeddings)
                total_done += len(batch)
                print(f"  {total_done} chunk embeddati...", end="\r", flush=True)
            except Exception as e:
                print(f"\nErrore al batch {i}: {e}")
                print("Riprova tra 10 secondi...")
                time.sleep(10)
                continue

            time.sleep(0.3)  # buffer rate limit

    print("\nRicorda di eseguire su Supabase SQL Editor:")
    print("  REINDEX INDEX idx_cert_chunks_embedding;")


if __name__ == "__main__":
    main()
