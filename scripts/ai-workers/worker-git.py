#!/usr/bin/env python3
"""Esegui git add + commit + push opzionale su ordine dell'orchestratore."""

from __future__ import annotations

import argparse
import subprocess
import sys


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if check and result.returncode != 0:
        print(f"ERRORE [{' '.join(cmd)}]:\n{result.stderr.strip()}", file=sys.stderr)
        sys.exit(result.returncode)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="git add + commit + push opzionale. Nessun LLM — esegue comandi git diretti."
    )
    stage_group = parser.add_mutually_exclusive_group(required=True)
    stage_group.add_argument(
        "--files", nargs="+", metavar="FILE",
        help="File specifici da staged (preferito rispetto a --all)."
    )
    stage_group.add_argument(
        "--all", action="store_true",
        help="Staged tutti i file tracciati modificati (git add -u). Non aggiunge untracked."
    )
    stage_group.add_argument(
        "--untracked-too", action="store_true",
        help="Come --all ma include anche file untracked (git add -A). Usare con cautela."
    )
    parser.add_argument("--message", "-m", required=True, help="Messaggio di commit completo.")
    parser.add_argument("--push", action="store_true", help="git push dopo il commit.")
    parser.add_argument("--remote", default="origin", help="Remote per il push (default: origin).")
    parser.add_argument("--branch", default="", help="Branch esplicito per il push (default: branch corrente).")
    parser.add_argument("--dry-run", action="store_true", help="Stampa i comandi senza eseguirli.")
    args = parser.parse_args()

    def maybe_run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess | None:
        print(f"  $ {' '.join(cmd)}")
        if args.dry_run:
            return None
        return run(cmd, check=check)

    print("=== worker-git ===")

    # Stage
    if args.files:
        maybe_run(["git", "add", "--"] + args.files)
        print(f"[OK] staged: {', '.join(args.files)}")
    elif args.untracked_too:
        maybe_run(["git", "add", "-A"])
        print("[OK] staged: tutti i file (inclusi untracked)")
    else:
        maybe_run(["git", "add", "-u"])
        print("[OK] staged: file tracciati modificati")

    if not args.dry_run:
        # Verifica che ci sia qualcosa da committare
        status = run(["git", "diff", "--cached", "--name-only"])
        staged_files = [f for f in status.stdout.strip().splitlines() if f]
        if not staged_files:
            print("Nessuna modifica staged — commit saltato.")
            sys.exit(0)
        print(f"  File staged: {', '.join(staged_files)}")

    # Commit
    maybe_run(["git", "commit", "-m", args.message])
    print(f"[OK] commit: {args.message.splitlines()[0][:72]}")

    # Push
    if args.push:
        push_cmd = ["git", "push", args.remote]
        if args.branch:
            push_cmd.extend([args.branch])
        maybe_run(push_cmd)
        target = f"{args.remote}/{args.branch}" if args.branch else args.remote
        print(f"[OK] push -> {target}")

    if not args.dry_run:
        log = run(["git", "log", "--oneline", "-1"])
        print(f"HEAD: {log.stdout.strip()}")

    print("=== done ===")


if __name__ == "__main__":
    main()
