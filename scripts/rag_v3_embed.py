#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

from rag_v3_common import get_supabase

EMBED_MODEL = os.environ.get("RAG_V3_EMBED_MODEL", "text-embedding-3-large")
EMBED_DIMENSIONS = 1536
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")


def embed_batch(inputs: list[str]) -> list[list[float]]:
    if OPENAI_API_KEY:
        return _request_embeddings(
            f"{OPENAI_BASE_URL.rstrip('/')}/embeddings",
            {"Authorization": f"Bearer {OPENAI_API_KEY}"},
            {"model": EMBED_MODEL, "input": inputs, "dimensions": EMBED_DIMENSIONS},
        )
    if OPENROUTER_API_KEY:
        return _request_embeddings(
            f"{OPENROUTER_BASE_URL.rstrip('/')}/embeddings",
            {
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "HTTP-Referer": "https://opimappa.local",
                "X-Title": "OPI Fire Safe CertSearch v3",
            },
            {"model": EMBED_MODEL, "input": inputs, "dimensions": EMBED_DIMENSIONS},
        )
    raise RuntimeError("Missing OPENAI_API_KEY or OPENROUTER_API_KEY for embeddings")


def _request_embeddings(url: str, headers: dict[str, str], payload: dict) -> list[list[float]]:
    body = json.dumps(payload).encode("utf-8")
    last_error: Exception | None = None
    for attempt in range(5):
        request = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json", **headers},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                data = json.loads(response.read().decode("utf-8"))
            if "data" not in data:
                raise RuntimeError(f"Embedding payload missing data field: {json.dumps(data)[:1000]}")
            return [entry["embedding"] for entry in data["data"]]
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", errors="ignore")
            last_error = RuntimeError(f"Embedding request failed: {details}")
        except Exception as error:
            last_error = error
        sleep_seconds = min(30, 2 * (attempt + 1))
        print(f"Embedding batch failed (attempt {attempt + 1}/5). Retrying in {sleep_seconds}s...")
        time.sleep(sleep_seconds)
    raise RuntimeError(f"Embedding request failed after retries: {last_error}")


def main() -> None:
    client = get_supabase()
    batch_size = int(os.environ.get("RAG_V3_EMBED_BATCH", "12"))
    total = 0

    while True:
        response = (
            client.table("rag_chunks")
            .select("id, content, content_markdown")
            .is_("embedding", "null")
            .limit(batch_size)
            .execute()
        )
        rows = response.data or []
        if not rows:
            break

        inputs = [row.get("content_markdown") or row.get("content") or "" for row in rows]
        embeddings = embed_batch(inputs)
        for row, embedding in zip(rows, embeddings):
            client.rpc(
                "rag_v3_upsert_chunk_embedding",
                {"target_chunk_id": row["id"], "embedding_text": json.dumps(embedding)},
            ).execute()
            total += 1
        print(f"Embedded {total} chunks...")

    print(f"Completed embeddings for {total} chunks.")


if __name__ == "__main__":
    main()
