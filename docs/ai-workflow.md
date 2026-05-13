# AI Workflow

This repo uses a Claude Code + Codex CLI workflow.

Claude Code is the orchestrator: it classifies the task, writes the task spec, delegates broad reading and implementation, compares results, handles architecture/debug decisions, and communicates with the user.

Codex CLI is used in three roles:
- **Reader**: read-only repo analysis and bug investigation.
- **Writer**: scoped implementation with minimal patches.
- **Reviewer**: adversarial review of uncommitted changes or a patch.

No GitHub Copilot is part of this stack.

## Standard Loop

1. Claude defines objective, constraints, likely files, risks, and acceptance criteria.
2. Claude runs Codex Reader when context is broad, risky, or unclear.
3. Claude writes a narrow task spec.
4. Claude runs Codex Writer for implementation.
5. Claude runs Codex Reviewer for every non-trivial code change.
6. Claude sends targeted Writer fixes if review finds real issues.
7. Claude makes the final decision and summarizes outcome, checks, assumptions, and uncertainties.

## Bug Fix Flow

1. Claude describes the symptom and acceptance criteria.
2. Codex Reader maps current behavior, likely root cause, files, and risky invariants.
3. Claude creates a narrow fix task.
4. Codex Writer patches the smallest safe surface.
5. Codex Reviewer checks regressions and missing tests.
6. Claude synthesizes the result and reports verification.

## Feature Implementation Flow

1. Claude confirms the feature is actually requested and not out of scope.
2. Codex Reader maps affected UI, data, sync, and tests.
3. Claude writes a task spec with non-goals to avoid broad refactors.
4. Codex Writer implements the scoped change.
5. Codex Reviewer reviews for behavior, TypeScript, tests, and project invariants.
6. Claude decides whether the feature is complete or needs a targeted follow-up.

## Sync/Dexie/Supabase Risky Change Flow

Use this for `src/db/`, `src/sync/`, `src/lib/supabase.ts`, `supabase/schema.sql`, RLS, storage, auth, or service worker/update flow.

1. Claude reads `CLAUDE.md`, `AGENTS.md`, and the relevant docs (`CONFLICT_RESOLUTION.md`, `SUPABASE_SETUP.md`, `UPDATE_SYSTEM.md`).
2. Codex Reader maps current data flow, queue behavior, schema/types, and failure modes.
3. Claude writes a detailed task spec including rollback and verification.
4. Codex Writer implements the smallest safe patch.
5. Codex Reviewer performs adversarial review focused on data loss, conflicts, remote/local divergence, RLS/storage/auth, and missing tests.
6. Repeat Writer/Reviewer until blocking issues are gone.
7. Claude reports manual SQL or deployment steps separately when required.

## Documentation-Only Flow

1. Claude may edit directly if the task is small and does not affect runtime behavior.
2. For large docs rewrites, Claude should still inspect existing docs first and preserve project-specific rules.
3. Verification is usually `git diff --check` and a quick status/diff review.
4. Codex Reviewer is optional unless the docs define enforceable coding workflow or risky project instructions.
