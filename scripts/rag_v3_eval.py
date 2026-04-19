#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import math
import urllib.error
import urllib.request

from rag_v3_common import PROJECT_ROOT, SUPABASE_KEY, SUPABASE_URL, get_supabase

GOLDEN_PATH = PROJECT_ROOT / "scripts" / "rag_v3_golden.json"


def reciprocal_rank(expected_documents: set[str], retrieved_documents: list[str]) -> float:
    for index, document_id in enumerate(retrieved_documents, start=1):
        if document_id in expected_documents:
            return 1 / index
    return 0.0


def recall_at_k(expected_documents: set[str], retrieved_documents: list[str], k: int) -> float:
    if not expected_documents:
        return 0.0
    return len(expected_documents.intersection(retrieved_documents[:k])) / len(expected_documents)


def ndcg(expected_documents: set[str], retrieved_documents: list[str], k: int) -> float:
    dcg = 0.0
    for index, document_id in enumerate(retrieved_documents[:k], start=1):
        if document_id in expected_documents:
            dcg += 1 / math.log2(index + 1)
    ideal_hits = min(len(expected_documents), k)
    if ideal_hits == 0:
        return 0.0
    idcg = sum(1 / math.log2(index + 1) for index in range(1, ideal_hits + 1))
    return dcg / idcg if idcg else 0.0


def resolve_expected_document_ids(client, query_case: dict) -> set[str]:
    expected_ids = set(query_case.get("expectedDocumentIds", []))
    for title in query_case.get("expectedDocumentTitles", []):
        response = (
            client.table("rag_documents")
            .select("id")
            .ilike("title", f"%{title}%")
            .execute()
        )
        expected_ids.update(row["id"] for row in (response.data or []))
    return expected_ids


def invoke_edge_search(query_case: dict) -> dict:
    endpoint = f"{SUPABASE_URL.rstrip('/')}/functions/v1/cert-search-v3"
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(
            {
                "query": query_case["query"],
                "filters": {
                    "manufacturer": query_case.get("manufacturer"),
                    "product": query_case.get("products"),
                    "hasTable": query_case.get("hasTable"),
                    "sourceType": query_case.get("sourceTypes"),
                    "primaryOnly": query_case.get("primaryOnly", False),
                },
            }
        ).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "apikey": SUPABASE_KEY,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"cert-search-v3 invocation failed: {details}") from error


def main() -> None:
    client = get_supabase()
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))

    run = client.table("rag_eval_runs").insert(
        {
            "query_set_name": golden["name"],
            "notes": golden.get("notes"),
            "retrieval_strategy": "cert-search-v3-hybrid",
        }
    ).execute()
    run_id = run.data[0]["id"]

    recalls = []
    reciprocal_ranks = []
    ndcgs = []
    citation_correctness_scores = []
    primary_supported = 0
    skipped_queries = []

    for query_case in golden["queries"]:
        payload = invoke_edge_search(query_case)
        rows = payload.get("results", [])
        citations = payload.get("citations", [])
        retrieved_document_ids = list(dict.fromkeys(row["documentId"] for row in rows))
        retrieved_chunk_ids = [row["chunkId"] for row in rows]
        expected_document_ids = resolve_expected_document_ids(client, query_case)
        evaluable = bool(expected_document_ids)

        if evaluable:
            recall = recall_at_k(expected_document_ids, retrieved_document_ids, 10)
            rr = reciprocal_rank(expected_document_ids, retrieved_document_ids)
            ndcg_value = ndcg(expected_document_ids, retrieved_document_ids, 10)
            citation_correctness = (
                len([citation for citation in citations if citation.get("documentId") in expected_document_ids]) /
                max(len(citations), 1)
            )
            recalls.append(recall)
            reciprocal_ranks.append(rr)
            ndcgs.append(ndcg_value)
            citation_correctness_scores.append(citation_correctness)
        else:
            recall = None
            rr = None
            ndcg_value = None
            citation_correctness = None
            skipped_queries.append(query_case["query"])

        if payload.get("support", {}).get("primaryResultCount", 0) > 0:
            primary_supported += 1

        client.table("rag_eval_results").insert(
            {
                "run_id": run_id,
                "query": query_case["query"],
                "manufacturer_code": query_case.get("manufacturer"),
                "expected_document_ids": list(expected_document_ids),
                "expected_products": query_case.get("products", []),
                "retrieved_chunk_ids": retrieved_chunk_ids,
                "retrieved_document_ids": retrieved_document_ids,
                "metrics": {
                    "evaluable": evaluable,
                    "recallAt10": recall,
                    "mrr": rr,
                    "ndcgAt10": ndcg_value,
                    "citationCorrectness": citation_correctness,
                    "productCoverage": len(set(query_case.get("products", [])).intersection({
                        product
                        for row in rows
                        for product in (row.get("products") or [])
                    })) / max(len(query_case.get("products", [])), 1),
                    "answerUsesPrimaryEvidence": payload.get("support", {}).get("primaryResultCount", 0) > 0,
                },
                "answer": payload.get("answer"),
                "citations": citations,
            }
        ).execute()

    summary = {
        "evaluatedQueries": len(recalls),
        "skippedQueries": skipped_queries,
        "recallAt10": (sum(recalls) / len(recalls)) if recalls else None,
        "mrr": (sum(reciprocal_ranks) / len(reciprocal_ranks)) if reciprocal_ranks else None,
        "ndcgAt10": (sum(ndcgs) / len(ndcgs)) if ndcgs else None,
        "citationCorrectness": (sum(citation_correctness_scores) / len(citation_correctness_scores)) if citation_correctness_scores else None,
        "primarySupportRate": primary_supported / max(len(golden["queries"]), 1),
    }
    client.table("rag_eval_runs").update({"metrics": summary}).eq("id", run_id).execute()
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
