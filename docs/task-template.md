# Task Template

## Title

`<short task name>`

## Objective

`<what must be achieved>`

## Background

`<relevant context, symptoms, links, prior decisions>`

## User-Visible Goal

`<what the user should observe when done>`

## Non-Goals

- `<explicitly out of scope>`
- `<no broad refactors unless requested>`

## Files Likely Involved

- `<file or folder>`
- `<file or folder>`

## Constraints

- Preserve unrelated user changes.
- Do not change dependencies unless explicitly requested.
- Do not change runtime behavior outside the stated objective.
- Keep Italian comments/UI text where product-facing.

## Architecture Invariants

- Dexie schema changes require a new version block, never mutation of old versions.
- Indexed boolean-like Dexie fields remain numeric (`0 | 1` / `number`).
- Supabase schema changes update `supabase/schema.sql` and `src/lib/supabase.ts`.
- Storage URLs must use established signed/public policy helpers, not hand-built URLs.
- Sync changes must preserve queue, conflict handling, and local/remote fallback behavior.

## Acceptance Criteria

- `<observable result>`
- `<edge case>`
- `<test or check expectation>`

## Verification Commands

```powershell
git status --short
npm test -- --watchAll=false
npm run build
```

Adjust commands to the actual scope.

## Risks

- `<data loss / sync / auth / storage / service worker / TypeScript risk>`

## Rollback Plan

- `<how to revert or disable safely>`
- `<manual Supabase/Vercel step if applicable>`

## Codex Reader Prompt

```text
ROLE: reader.
Objective: <context question>.
Scope: <files/folders likely involved>.
Constraints: read-only, do not modify files, keep output concise.
Invariants: <copy relevant invariants>.
Return: current behavior, relevant files/symbols/line ranges, risks, and recommended writer scope.
```

## Codex Writer Prompt

```text
ROLE: writer.
Read AGENTS.md first.
Objective: <specific implementation>.
Task spec: <paste or reference this task>.
Scope: <allowed files/folders>.
Non-goals: <out of scope>.
Constraints: smallest safe patch, preserve unrelated user changes, no broad refactor.
Acceptance criteria: <criteria>.
Verification commands: <commands>.
Return: changed files, summary, commands run, risks/uncertainties.
```

## Codex Reviewer Prompt

```text
ROLE: reviewer.
Read AGENTS.md and this task spec.
Review uncommitted changes against the objective, non-goals, invariants, and acceptance criteria.
Focus on regressions, data loss, offline/online-first behavior, sync queue, Dexie schema/versioning, Supabase schema/types/RLS, storage signed URLs, auth, service worker/update flow, TypeScript, and missing tests.
Output sections: Critical, High, Medium, Low, Missing tests. Include file/line references where possible. Say no blocking findings only if appropriate.
```
