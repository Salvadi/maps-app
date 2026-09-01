#!/usr/bin/env python3
"""Generare boilerplate con un modello worker compatibile OpenAI."""

from __future__ import annotations

import argparse
import glob
import os
import pathlib
import re
import sys


def build_parser() -> argparse.ArgumentParser:
    default_base_url = os.getenv("WORKER_BASE_URL")
    default_model = os.getenv("WORKER_MODEL")
    if not default_base_url and os.getenv("OPENROUTER_API_KEY"):
        default_base_url = "https://openrouter.ai/api/v1"
    if not default_model and default_base_url == "https://openrouter.ai/api/v1":
        default_model = "moonshotai/kimi-k2.5"

    parser = argparse.ArgumentParser(
        description="Genera un file ripetitivo usando contesto locale e un modello economico."
    )
    parser.add_argument("--spec", required=True, help="Descrizione del file da generare.")
    parser.add_argument("--context", nargs="*", default=[], help="File di riferimento.")
    parser.add_argument("--target", required=True, help="File di output.")
    parser.add_argument("--force", action="store_true", help="Sovrascrive il target se esiste.")
    parser.add_argument("--model", default=default_model or "kimi-k2.5")
    parser.add_argument("--base-url", default=default_base_url or "https://api.moonshot.ai/v1")
    parser.add_argument("--max-tokens", type=int, default=int(os.getenv("WORKER_WRITE_MAX_TOKENS", "16384")))
    env_temperature = os.getenv("WORKER_TEMPERATURE")
    parser.add_argument(
        "--temperature",
        type=float,
        default=float(env_temperature) if env_temperature else None,
        help="Opzionale: omesso se non impostato, per compatibilita con provider diversi.",
    )
    return parser


def get_api_key() -> str:
    api_key = (
        os.getenv("WORKER_API_KEY")
        or os.getenv("OPENROUTER_API_KEY")
        or os.getenv("MOONSHOT_API_KEY")
    )
    if not api_key:
        raise SystemExit(
            "Manca WORKER_API_KEY, OPENROUTER_API_KEY o MOONSHOT_API_KEY. "
            "Impostala prima di usare il worker."
        )
    return api_key


def expand_paths(paths: list[str]) -> list[str]:
    expanded: list[str] = []
    for raw_path in paths:
        matches = glob.glob(raw_path, recursive=True)
        if matches:
            expanded.extend(matches)
        else:
            expanded.append(raw_path)
    return expanded


def read_context(paths: list[str]) -> str:
    docs: list[str] = []
    for raw_path in expand_paths(paths):
        path = pathlib.Path(raw_path)
        if not path.exists() or not path.is_file():
            raise SystemExit(f"File di contesto non valido: {raw_path}")
        content = path.read_text(encoding="utf-8", errors="replace")
        docs.append(f"<file path='{path.as_posix()}'>\n{content}\n</file>")
    return "\n\n".join(docs)


def strip_markdown_fence(text: str) -> str:
    match = re.fullmatch(r"\s*```(?:[\w.+-]+)?\n(.*?)\n```\s*", text, flags=re.DOTALL)
    return match.group(1) if match else text


def main() -> int:
    args = build_parser().parse_args()
    target = pathlib.Path(args.target)
    if target.exists() and not args.force:
        print(f"Target gia esistente: {target}. Usa --force per sovrascrivere.", file=sys.stderr)
        return 3

    try:
        from openai import OpenAI
    except ImportError:
        print(
            "Pacchetto Python mancante: installa con `python -m pip install openai`.",
            file=sys.stderr,
        )
        return 2

    context = read_context(args.context)
    headers = {}
    if os.getenv("OPENROUTER_SITE_URL"):
        headers["HTTP-Referer"] = os.environ["OPENROUTER_SITE_URL"]
    if os.getenv("OPENROUTER_APP_NAME"):
        headers["X-Title"] = os.environ["OPENROUTER_APP_NAME"]

    client = OpenAI(
        api_key=get_api_key(),
        base_url=args.base_url,
        default_headers=headers or None,
    )
    request = {
        "model": args.model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Genera solo il contenuto completo del file richiesto. "
                    "Non includere spiegazioni, prefazioni o blocchi markdown. "
                    "Rispetta stile, lingua e convenzioni dei file di contesto."
                ),
            },
            {"role": "user", "content": f"<context>\n{context}\n</context>"},
            {"role": "user", "content": args.spec},
        ],
        "max_tokens": args.max_tokens,
    }
    if args.temperature is not None:
        request["temperature"] = args.temperature

    response = client.chat.completions.create(**request)

    content = response.choices[0].message.content
    if not content:
        print(
            "[ERRORE: il worker non ha prodotto contenuto. Prova --max-tokens 32768]",
            file=sys.stderr,
        )
        return 1

    content = strip_markdown_fence(content)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    print(f"Scritto {target}")
    usage = getattr(response, "usage", None)
    if usage:
        prompt_tokens = getattr(usage, "prompt_tokens", "?")
        completion_tokens = getattr(usage, "completion_tokens", "?")
        details = getattr(usage, "prompt_tokens_details", None)
        cached_tokens = getattr(details, "cached_tokens", 0) if details else 0
        finish_reason = getattr(response.choices[0], "finish_reason", "?")
        print(
            f"[worker: {prompt_tokens} in ({cached_tokens or 0} cached) / "
            f"{completion_tokens} out | finish: {finish_reason}]",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
