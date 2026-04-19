#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from rag_v3_common import (
    build_document_record,
    chunk_document,
    delete_document_tree,
    get_supabase,
    infer_manufacturer_code,
    parse_args,
    parse_pdf,
    print_document_summary,
    resolve_source_files,
    truncate_v3_tables,
    upsert_manufacturer,
    insert_document_tree,
)


def main() -> None:
    parser = parse_args("Ingest clean v3 pipeline into rag_* tables")
    parser.add_argument("--truncate-v3", action="store_true", help="Delete existing v3 documents/chunks before ingest")
    args = parser.parse_args()

    client = get_supabase()

    if args.truncate_v3:
        print("Clearing existing rag_* content...")
        truncate_v3_tables(client)

    files = resolve_source_files(args.file, args.limit)
    if not files:
        print("No files found to ingest.")
        return

    inserted_documents = 0
    inserted_chunks = 0

    for pdf_path in files:
        print(f"\nProcessing {pdf_path.name}")
        items = parse_pdf(pdf_path)
        manufacturer_code = infer_manufacturer_code(pdf_path, " ".join(item.text for item in items[:30]), args.manufacturer)
        document = build_document_record(pdf_path, items, manufacturer_code, args.status)
        chunks = chunk_document(items, document.document_kind)
        print_document_summary(document, chunks)

        if args.dry_run:
            continue

        upsert_manufacturer(client, manufacturer_code)
        delete_document_tree(client, manufacturer_code, document.file_path)
        _, chunk_count = insert_document_tree(client, document, chunks)
        inserted_documents += 1
        inserted_chunks += chunk_count

    print(f"\nDone. Inserted {inserted_documents} documents and {inserted_chunks} chunks into rag_* tables.")


if __name__ == "__main__":
    main()
