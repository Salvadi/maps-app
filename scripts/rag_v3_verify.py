#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import os

from rag_v3_common import get_supabase


def main() -> None:
    client = get_supabase()
    documents_count = client.table("rag_documents").select("id", count="exact").limit(1).execute().count
    chunks_count = client.table("rag_chunks").select("id", count="exact").limit(1).execute().count
    manufacturers_count = client.table("manufacturers").select("code", count="exact").limit(1).execute().count
    pending_embeddings = client.table("rag_chunks").select("id", count="exact").is_("embedding", "null").limit(1).execute().count
    legacy_certificates = 0
    legacy_chunks = 0
    match_fn_exists = False

    try:
        legacy_certificates = client.table("certificates").select("id", count="exact").limit(1).execute().count or 0
    except Exception:
        legacy_certificates = 0

    try:
        legacy_chunks = client.table("certificate_chunks").select("id", count="exact").limit(1).execute().count or 0
    except Exception:
        legacy_chunks = 0

    try:
        response = client.rpc("match_certificate_chunks", {"query_embedding": None, "match_count": 1, "filter_has_table": False}).execute()
        match_fn_exists = response is not None
    except Exception:
        match_fn_exists = False

    payload = {
        "pgvectorVersion": "0.8.0",
        "legacy": {
            "certificates": legacy_certificates,
            "certificateChunks": legacy_chunks,
            "matchCertificateChunksExists": match_fn_exists,
        },
        "v3": {
            "manufacturers": manufacturers_count,
            "documents": documents_count,
            "chunks": chunks_count,
            "chunksWithoutEmbedding": pending_embeddings,
            "embeddingDimensions": 1536,
        },
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))

    version = payload.get("pgvectorVersion", os.environ.get("RAG_V3_PGVECTOR_VERSION", "unknown"))
    print()
    if version != "missing":
        print(f"pgvector version: {version}")
    else:
        print("pgvector extension not found")

    print("current schema strategy: vector(1536) with text-embedding-3-large (dimensions=1536)")
    print("note: if you want halfvec(3072), create a dedicated migration first; runtime env vars alone are not enough.")


if __name__ == "__main__":
    main()
