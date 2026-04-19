#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable, Optional

from dotenv import load_dotenv
from supabase import Client, create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PDFS_DIR = PROJECT_ROOT / "scripts" / "ingest" / "pdfs"
PILOT_MANUAL = PROJECT_ROOT / "manualesigillatureafsystems.pdf"

load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / "scripts" / "ingest" / ".env", override=False)

SUPABASE_URL = os.environ.get("REACT_APP_SUPABASE_URL") or os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Missing Supabase credentials in .env.local", file=sys.stderr)
    sys.exit(1)

RE_RAPPORTO = re.compile(r"RAPPORTO\s+DI\s+CLASSIFICAZIONE", re.I)
RE_ETA = re.compile(
    r"VALUTAZIONE\s+TECNICA\s+EUROPEA|EUROPEAN\s+TECHNICAL\s+ASSESSMENT|ETA[-\s]?\d{2}[-_]\d+",
    re.I,
)
RE_TEST_REPORT = re.compile(r"RAPPORTO\s+DI\s+PROVA|TEST\s+REPORT", re.I)
RE_MANUAL = re.compile(r"MANUALE|CATALOGO|GUIDA", re.I)
RE_DATE_CONTEXT = re.compile(
    r"(?:data|date?|issued?\s*(?:on)?|emissione|emesso\s*il|del|rilasciato\s*il)"
    r"\s*[:\s]*(\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2})",
    re.I,
)
RE_DATE_BARE = re.compile(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b")
RE_DATE_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
RE_PRODUCTS = re.compile(
    r"\b(AF[-\s]?\w[\w\-]*|FLEXISYSTEM\w*|PROMASTOP[-\s]?\w*|FLAMMOSTOP\w*|"
    r"PYROSTOP\w*|PROMAPLUG\w*|CP\s*\d+[A-Z\-]*|FS[-\s]?[A-Z0-9\-]+|CFS[-\s]?[A-Z0-9\-]+)\b",
    re.I,
)
RE_PRODUCT_FAMILY = re.compile(
    r"\b(collari|sigillanti|schiume|malte|nastri|manicotti|pannelli|sleeve|wrap|coating)\b",
    re.I,
)
RE_FIRE_CLASS = re.compile(r"\b(?:EI|REI|EW|E)\s*\d+(?:\s*[-–]\s*[A-Z]/[A-Z])?\b", re.I)
RE_SUPPORTS = re.compile(
    r"\b(calcestruzzo|muratura|cartongesso|parete rigida|parete flessibile|solaio|legno|acciaio)\b",
    re.I,
)
RE_PENETRATION = re.compile(
    r"\b(cavo(?:\s+elettrico)?|tubo(?:\s+metallico|\s+plastico)?|canalina|fascio\s+cavi|condotta)\b",
    re.I,
)
RE_DIMENSIONS = re.compile(
    r"\b(?:\d+(?:[.,]\d+)?\s*(?:mm|cm|m)|DN\s*\d+|Ø\s*\d+(?:[.,]\d+)?)\b",
    re.I,
)
RE_ALIASES = {
    "AF_SYSTEMS": ["af systems", "af-systems", "af"],
    "PROMAT": ["promat"],
    "HILTI": ["hilti"],
    "GLOBAL_BUILDING": ["global building", "globalbuilding"],
}
MANUAL_KEYWORD_STOPWORDS = {
    "abbiamo", "abbia", "accessori", "accordo", "affidabile", "affinche", "affinché", "alcuni", "alcune",
    "all", "alla", "alle", "also", "altre", "altro", "anche", "anni", "application", "applications",
    "attraverso", "available", "base", "better", "building", "catalogo", "classe", "comunque", "condizioni",
    "consente", "controllo", "corretto", "della", "delle", "degli", "della", "dello", "descrizione",
    "deve", "devono", "documento", "dopo", "dove", "durante", "each", "edificio", "elementi", "ensuring",
    "essere", "fire", "general", "generale", "generali", "guida", "have", "installation", "installazione",
    "installazioni", "manuale", "materiale", "materials", "mediante", "molto", "nelle", "negli", "norma",
    "normativa", "normative", "nostri", "nostro", "ogni", "oltre", "perche", "perché", "possono",
    "possible", "prima", "principi", "prodotto", "prodotti", "progettazione", "protezione", "quadro",
    "quando", "quindi", "rappresenta", "requirements", "resistenza", "risultato", "safety", "sarebbe",
    "secondo", "section", "seguente", "seguenti", "senza", "sistema", "sistemi", "situazioni", "sono",
    "specifica", "specifiche", "systems", "technical", "their", "these", "through", "tutte", "tutti",
    "using", "varie", "various", "viene", "with", "your",
}
MANUAL_KEYWORD_ALLOWED_PREFIXES = (
    "af", "fs", "cfs", "cp", "proma", "promastop", "promaseal", "hilti", "global",
)
KNOWN_ISSUERS = [
    "Istituto Giordano",
    "IMQ",
    "PAVUS",
    "EFECTIS",
    "CNPP",
    "Warrington",
    "BRE Global",
    "Kiwa",
    "TÜV",
    "VdS",
    "LGAI",
    "CSI",
    "RINA",
    "DNV",
    "ITeC",
    "ITEC",
]


@dataclass
class ParsedItem:
    type: str
    text: str
    level: int
    page_start: int
    page_end: int
    is_table: bool


@dataclass
class ChunkRecord:
    chunk_kind: str
    section: str
    section_path: list[str]
    content: str
    content_markdown: Optional[str]
    has_table: bool
    page_start: int
    page_end: int
    products: list[str]
    product_families: list[str]
    fire_classes: list[str]
    supports: list[str]
    penetration_types: list[str]
    dimensions: list[str]
    cross_refs: list[str]
    metadata: dict


@dataclass
class DocumentRecord:
    manufacturer_code: str
    source_type: str
    evidence_level: str
    document_kind: str
    title: str
    issuer: str
    issue_date: Optional[date]
    file_path: str
    version_tag: Optional[str]
    status: str
    metadata: dict


def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def parse_args(default_description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=default_description)
    parser.add_argument("--file", help="Single PDF path or stem to process")
    parser.add_argument("--manufacturer", help="Force manufacturer code, e.g. AF_SYSTEMS")
    parser.add_argument("--status", default="ready", help="Document status for rag_documents")
    parser.add_argument("--dry-run", action="store_true", help="Parse without writing to Supabase")
    parser.add_argument("--limit", type=int, help="Limit number of files")
    return parser


def resolve_source_files(file_arg: Optional[str], limit: Optional[int] = None) -> list[Path]:
    if file_arg:
        raw_path = Path(file_arg)
        if raw_path.exists():
            return [raw_path]

        candidates = []
        if file_arg.lower() in {"pilot-manual", "manuale-af", "af-manual"}:
            candidates.append(PILOT_MANUAL)
        candidates.extend(PDFS_DIR.glob(f"{file_arg}*.pdf"))
        candidates.extend(PDFS_DIR.glob(f"{file_arg}*.PDF"))
        if not candidates:
            raise FileNotFoundError(f"Could not resolve input file: {file_arg}")
        return [candidates[0]]

    files = []
    if PILOT_MANUAL.exists():
        files.append(PILOT_MANUAL)
    files.extend(sorted(PDFS_DIR.glob("*.pdf"), key=lambda path: path.name.lower()))
    if limit:
        files = files[:limit]
    return files


def normalize_term(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def strip_accents(value: str) -> str:
    import unicodedata

    return "".join(
        char for char in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(char)
    )


def clean_terms(values: Iterable[str]) -> list[str]:
    seen: dict[str, str] = {}
    for raw_value in values:
        value = raw_value.strip()
        if not value:
            continue
        normalized = normalize_term(value)
        if normalized not in seen:
            seen[normalized] = value
    return list(seen.values())


def infer_manufacturer_code(pdf_path: Path, text: str, forced: Optional[str] = None) -> str:
    if forced:
        return forced.strip().upper().replace(" ", "_")

    haystack = f"{pdf_path.name} {text[:1500]}".lower()
    for code, aliases in RE_ALIASES.items():
        if any(alias in haystack for alias in aliases):
            return code

    stem = pdf_path.stem.upper()
    if "PROMAT" in stem:
        return "PROMAT"
    if "HILTI" in stem:
        return "HILTI"
    if "GLOBAL" in stem:
        return "GLOBAL_BUILDING"
    return "AF_SYSTEMS"


def detect_document_kind(items: list[ParsedItem], pdf_path: Path) -> str:
    sample = " ".join(item.text for item in items[:40])
    if RE_ETA.search(sample) or "ETA" in pdf_path.name.upper():
        return "eta"
    if RE_RAPPORTO.search(sample):
        return "classification_report"
    if RE_TEST_REPORT.search(sample):
        return "test_report"
    if RE_MANUAL.search(sample) or "manuale" in pdf_path.name.lower():
        return "manual"
    return "technical_report"


def infer_source_type(document_kind: str) -> str:
    return "manual" if document_kind == "manual" else "certificate"


def infer_evidence_level(source_type: str) -> str:
    return "secondary" if source_type == "manual" else "primary"


def extract_issue_date(items: list[ParsedItem]) -> Optional[date]:
    early = [item for item in items if item.page_start <= 3]
    full_text = "\n".join(item.text for item in early)

    for match in RE_DATE_CONTEXT.finditer(full_text):
        parsed = _parse_date(match.group(1))
        if parsed:
            return parsed
    for match in RE_DATE_ISO.finditer(full_text):
        parsed = _parse_date(match.group(0))
        if parsed:
            return parsed
    for match in RE_DATE_BARE.finditer(full_text):
        parsed = _parse_date(match.group(0))
        if parsed:
            return parsed
    return None


def _parse_date(value: str) -> Optional[date]:
    match = RE_DATE_ISO.search(value)
    if match:
        try:
            return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        except ValueError:
            return None
    match = RE_DATE_BARE.search(value)
    if match:
        day, month, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
        if year < 100:
            year += 2000
        try:
            return date(year, month, day)
        except ValueError:
            try:
                return date(year, day, month)
            except ValueError:
                return None
    return None


def extract_issuer(items: list[ParsedItem]) -> str:
    sample = " ".join(item.text for item in items[:20])
    for issuer in KNOWN_ISSUERS:
        if issuer.lower() in sample.lower():
            return issuer
    return "N/D"


def extract_metadata(text: str) -> dict:
    cross_refs = re.findall(r"\b(?:tabella|table|appendice|annex|allegato|attraversamento)\s+[A-Z0-9.\-]+\b", text, re.I)
    return {
        "products": clean_terms(RE_PRODUCTS.findall(text)),
        "product_families": clean_terms(RE_PRODUCT_FAMILY.findall(text)),
        "fire_classes": clean_terms(match.upper() for match in RE_FIRE_CLASS.findall(text)),
        "supports": clean_terms(RE_SUPPORTS.findall(text)),
        "penetration_types": clean_terms(RE_PENETRATION.findall(text)),
        "dimensions": clean_terms(RE_DIMENSIONS.findall(text)),
        "cross_refs": clean_terms(cross_refs),
    }


def _get_converter():
    from docling.document_converter import DocumentConverter

    return DocumentConverter()


def parse_pdf(pdf_path: Path) -> list[ParsedItem]:
    converter = _get_converter()
    result = converter.convert(str(pdf_path))
    doc = result.document
    items: list[ParsedItem] = []

    for item, level in doc.iterate_items():
        label = getattr(item, "label", None)
        label_value = label.value.lower() if hasattr(label, "value") else str(label).lower()
        item_type = ""
        text = ""
        is_table = False

        if label_value in {"title", "section_header"}:
            item_type = "heading"
            text = getattr(item, "text", "") or ""
        elif label_value == "table":
            item_type = "table"
            is_table = True
            try:
                text = item.export_to_markdown(doc=doc)
            except Exception:
                text = getattr(item, "text", "") or ""
        elif label_value in {"text", "paragraph", "list_item", "caption", "footnote"}:
            item_type = "text"
            text = getattr(item, "text", "") or ""
        else:
            continue

        text = text.strip()
        if not text:
            continue

        page_start = 0
        page_end = 0
        prov = getattr(item, "prov", None)
        if prov:
            page_start = prov[0].page_no if prov else 0
            page_end = prov[-1].page_no if len(prov) > 1 else page_start

        items.append(
            ParsedItem(
                type=item_type,
                text=text,
                level=level,
                page_start=page_start,
                page_end=page_end,
                is_table=is_table,
            )
        )

    return items


def _flush_section(
    chunks: list[ChunkRecord],
    section: str,
    section_path: list[str],
    buffer_items: list[ParsedItem],
    document_kind: str,
) -> None:
    if not buffer_items:
        return

    content = "\n\n".join(item.text for item in buffer_items)
    page_start = next((item.page_start for item in buffer_items if item.page_start), 0)
    page_end = next((item.page_end for item in reversed(buffer_items) if item.page_end), page_start)
    metadata = extract_metadata(content)
    chunks.append(
        ChunkRecord(
            chunk_kind="section_chunk",
            section=section,
            section_path=section_path[:] or [section],
            content=content,
            content_markdown=content,
            has_table=any(item.is_table for item in buffer_items),
            page_start=page_start,
            page_end=page_end,
            products=metadata["products"],
            product_families=metadata["product_families"],
            fire_classes=metadata["fire_classes"],
            supports=metadata["supports"],
            penetration_types=metadata["penetration_types"],
            dimensions=metadata["dimensions"],
            cross_refs=metadata["cross_refs"],
            metadata={"documentKind": document_kind, "pageWindow": [page_start, page_end]},
        )
    )


def _table_rows(markdown_table: str) -> list[str]:
    rows = []
    for line in markdown_table.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|") or not stripped.endswith("|"):
            continue
        if set(stripped.replace("|", "").replace("-", "").replace(":", "").strip()) == set():
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        rows.append(" | ".join(cell for cell in cells if cell))
    return rows


def chunk_document(items: list[ParsedItem], document_kind: str) -> list[ChunkRecord]:
    chunks: list[ChunkRecord] = []
    buffer_items: list[ParsedItem] = []
    current_section = "Documento"
    section_stack: list[str] = []
    last_heading = "Documento"

    for item in items:
        if item.type == "heading":
            _flush_section(chunks, current_section, section_stack or [current_section], buffer_items, document_kind)
            buffer_items = [item]
            section_stack = (section_stack[: max(item.level - 1, 0)] + [item.text]) if item.level > 0 else [item.text]
            current_section = " > ".join(section_stack)
            last_heading = item.text
            continue

        if item.is_table:
            _flush_section(chunks, current_section, section_stack or [current_section], buffer_items, document_kind)
            buffer_items = []
            table_section = f"{last_heading} [Tabella]"
            metadata = extract_metadata(item.text)
            chunks.append(
                ChunkRecord(
                    chunk_kind="table_chunk",
                    section=table_section,
                    section_path=(section_stack or [last_heading]) + ["table"],
                    content=item.text,
                    content_markdown=item.text,
                    has_table=True,
                    page_start=item.page_start,
                    page_end=item.page_end,
                    products=metadata["products"],
                    product_families=metadata["product_families"],
                    fire_classes=metadata["fire_classes"],
                    supports=metadata["supports"],
                    penetration_types=metadata["penetration_types"],
                    dimensions=metadata["dimensions"],
                    cross_refs=metadata["cross_refs"],
                    metadata={"documentKind": document_kind, "pageWindow": [item.page_start, item.page_end]},
                )
            )
            for row_index, row in enumerate(_table_rows(item.text), start=1):
                row_meta = extract_metadata(row)
                chunks.append(
                    ChunkRecord(
                        chunk_kind="table_row_chunk",
                        section=f"{table_section} / Riga {row_index}",
                        section_path=(section_stack or [last_heading]) + ["table", f"row_{row_index}"],
                        content=row,
                        content_markdown=f"{table_section}\n{row}",
                        has_table=True,
                        page_start=item.page_start,
                        page_end=item.page_end,
                        products=row_meta["products"],
                        product_families=row_meta["product_families"],
                        fire_classes=row_meta["fire_classes"],
                        supports=row_meta["supports"],
                        penetration_types=row_meta["penetration_types"],
                        dimensions=row_meta["dimensions"],
                        cross_refs=row_meta["cross_refs"],
                        metadata={
                            "documentKind": document_kind,
                            "pageWindow": [item.page_start, item.page_end],
                            "tableRowIndex": row_index,
                        },
                    )
                )
            continue

        buffer_items.append(item)

    _flush_section(chunks, current_section, section_stack or [current_section], buffer_items, document_kind)
    return chunks


def build_document_record(
    pdf_path: Path,
    items: list[ParsedItem],
    manufacturer_code: str,
    status: str = "ready",
) -> DocumentRecord:
    document_kind = detect_document_kind(items, pdf_path)
    source_type = infer_source_type(document_kind)
    evidence_level = infer_evidence_level(source_type)
    issue_date = extract_issue_date(items)
    issuer = extract_issuer(items)
    sample = " ".join(item.text for item in items[:50])

    return DocumentRecord(
        manufacturer_code=manufacturer_code,
        source_type=source_type,
        evidence_level=evidence_level,
        document_kind=document_kind,
        title=pdf_path.stem,
        issuer=issuer,
        issue_date=issue_date,
        file_path=str(pdf_path.relative_to(PROJECT_ROOT)),
        version_tag=issue_date.isoformat() if issue_date else None,
        status=status,
        metadata={
            "originalFileName": pdf_path.name,
            "sampleText": sample[:1500],
            "pageCountHint": max((item.page_end for item in items), default=0),
        },
    )


def build_lexicon_entries(manufacturer_code: str, document_id: str, document: DocumentRecord, chunks: list[ChunkRecord]) -> list[dict]:
    terms: list[tuple[str, str]] = []
    manufacturer_name = manufacturer_code.replace("_", " ").title()
    terms.append((manufacturer_name, "brand"))
    for alias in RE_ALIASES.get(manufacturer_code, []):
        terms.append((alias, "alias"))

    for chunk in chunks:
        for value in chunk.products:
            terms.append((value, "product"))
        for value in chunk.product_families:
            terms.append((value, "product_family"))
        for value in chunk.fire_classes:
            terms.append((value, "fire_class"))
        for value in chunk.supports:
            terms.append((value, "support"))
        for value in chunk.penetration_types:
            terms.append((value, "penetration"))
        for value in chunk.dimensions:
            terms.append((value, "dimension"))

    if document.source_type == "manual":
        joined_text = " ".join(chunk.content for chunk in chunks[:20])
        for word in re.findall(r"\b[a-zA-Z][a-zA-Z0-9\-]{4,}\b", joined_text):
            normalized_word = normalize_term(word)
            ascii_word = strip_accents(normalized_word)
            raw_word = word.strip()
            if ascii_word in MANUAL_KEYWORD_STOPWORDS:
                continue
            if len(ascii_word) < 5:
                continue
            if ascii_word.isdigit():
                continue
            if not (
                any(ascii_word.startswith(prefix) for prefix in MANUAL_KEYWORD_ALLOWED_PREFIXES)
                or any(char.isdigit() for char in ascii_word)
                or "-" in ascii_word
                or raw_word.isupper()
            ):
                continue
            if normalized_word not in {"sistema", "systems", "manuale", "installation", "certificato"}:
                terms.append((word, "manual_keyword"))

    entries = []
    seen = set()
    for term, term_type in terms:
        normalized = normalize_term(term)
        key = (normalized, term_type)
        if not normalized or key in seen:
            continue
        seen.add(key)
        entries.append(
            {
                "manufacturer_code": manufacturer_code,
                "term": term.strip(),
                "normalized_term": normalized,
                "term_type": term_type,
                "source_document_id": document_id,
            }
        )
    return entries


def hash_chunk(document: DocumentRecord, chunk: ChunkRecord, chunk_index: int) -> str:
    payload = {
        "file_path": document.file_path,
        "chunk_index": chunk_index,
        "section_path": chunk.section_path,
        "chunk_kind": chunk.chunk_kind,
        "content": chunk.content,
        "page_start": chunk.page_start,
        "page_end": chunk.page_end,
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def upsert_manufacturer(client: Client, manufacturer_code: str) -> None:
    client.table("manufacturers").upsert(
        {
            "code": manufacturer_code,
            "name": manufacturer_code.replace("_", " ").title(),
            "aliases": RE_ALIASES.get(manufacturer_code, []),
            "is_active": True,
        }
    ).execute()


def delete_document_tree(client: Client, manufacturer_code: str, file_path: str) -> None:
    result = (
        client.table("rag_documents")
        .select("id")
        .eq("manufacturer_code", manufacturer_code)
        .eq("file_path", file_path)
        .execute()
    )
    for row in result.data or []:
        client.table("rag_documents").delete().eq("id", row["id"]).execute()


def insert_document_tree(client: Client, document: DocumentRecord, chunks: list[ChunkRecord]) -> tuple[str, int]:
    doc_response = client.table("rag_documents").insert(
        {
            "manufacturer_code": document.manufacturer_code,
            "source_type": document.source_type,
            "evidence_level": document.evidence_level,
            "document_kind": document.document_kind,
            "title": document.title,
            "issuer": document.issuer,
            "issue_date": document.issue_date.isoformat() if document.issue_date else None,
            "file_path": document.file_path,
            "version_tag": document.version_tag,
            "status": document.status,
            "metadata": document.metadata,
        }
    ).execute()
    document_id = doc_response.data[0]["id"]

    rows = []
    for chunk_index, chunk in enumerate(chunks):
        rows.append(
            {
                "document_id": document_id,
                "manufacturer_code": document.manufacturer_code,
                "source_type": document.source_type,
                "evidence_level": document.evidence_level,
                "section": chunk.section,
                "section_path": chunk.section_path,
                "chunk_kind": chunk.chunk_kind,
                "content": chunk.content,
                "content_markdown": chunk.content_markdown,
                "has_table": chunk.has_table,
                "page_start": chunk.page_start,
                "page_end": chunk.page_end,
                "products": chunk.products,
                "product_families": chunk.product_families,
                "fire_classes": chunk.fire_classes,
                "supports": chunk.supports,
                "penetration_types": chunk.penetration_types,
                "dimensions": chunk.dimensions,
                "cross_refs": chunk.cross_refs,
                "content_hash": hash_chunk(document, chunk, chunk_index),
                "metadata": chunk.metadata,
            }
        )

    batch_size = 200
    for index in range(0, len(rows), batch_size):
        client.table("rag_chunks").insert(rows[index : index + batch_size]).execute()

    lexicon_entries = build_lexicon_entries(document.manufacturer_code, document_id, document, chunks)
    for index in range(0, len(lexicon_entries), batch_size):
        client.table("manufacturer_lexicon").insert(lexicon_entries[index : index + batch_size]).execute()

    return document_id, len(rows)


def truncate_v3_tables(client: Client) -> None:
    for table_name in ["rag_eval_results", "rag_eval_runs", "manufacturer_lexicon", "rag_chunks", "rag_documents"]:
        client.table(table_name).delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()


def print_document_summary(document: DocumentRecord, chunks: list[ChunkRecord]) -> None:
    print(f"- {document.title}")
    print(f"  manufacturer: {document.manufacturer_code}")
    print(f"  source_type: {document.source_type}")
    print(f"  evidence_level: {document.evidence_level}")
    print(f"  document_kind: {document.document_kind}")
    print(f"  issue_date: {document.issue_date or 'N/D'}")
    print(f"  chunks: {len(chunks)}")
