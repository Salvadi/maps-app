#!/usr/bin/env python3
"""Estrarre testo leggibile da transcript JSONL di Claude Code."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Estrae messaggi human/assistant da un transcript JSONL."
    )
    parser.add_argument("transcript", help="File JSONL della sessione Claude Code.")
    parser.add_argument("-o", "--output", help="File di output. Default: stdout.")
    return parser


def content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type in {"tool_use", "tool_result", "image", "thinking"}:
            continue
        text = item.get("text")
        if isinstance(text, str):
            parts.append(text)
    return "\n".join(parts)


def extract(path: pathlib.Path) -> str:
    chunks: list[str] = []
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line_number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                print(f"Riga JSON non valida ignorata: {line_number}", file=sys.stderr)
                continue

            message = event.get("message") if isinstance(event, dict) else None
            if not isinstance(message, dict):
                message = event if isinstance(event, dict) else None
            if not isinstance(message, dict):
                continue

            role = message.get("role") or event.get("type")
            if role not in {"user", "assistant", "human"}:
                continue
            text = content_to_text(message.get("content"))
            if text.strip():
                chunks.append(f"## {role}\n{text.strip()}")
    return "\n\n".join(chunks) + ("\n" if chunks else "")


def main() -> int:
    args = build_parser().parse_args()
    transcript = pathlib.Path(args.transcript)
    if not transcript.exists() or not transcript.is_file():
        print(f"Transcript non trovato: {transcript}", file=sys.stderr)
        return 2

    output = extract(transcript)
    if args.output:
        pathlib.Path(args.output).write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
