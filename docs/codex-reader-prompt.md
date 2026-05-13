# Codex Reader Prompt

```text
ROLE: reader.

Run read-only. Do not modify files.

Objective:
<state the question Claude needs answered>

Scope:
<files/folders likely involved, or "discover from repo if unknown">

Repository invariants:
- Read AGENTS.md for repo rules.
- Preserve Dexie, Supabase, sync, storage, auth, and service worker invariants.
- Keep context concise and useful for Claude.

Instructions:
1. Inspect the repo only as needed.
2. Identify relevant files, symbols, and line ranges.
3. Summarize current behavior.
4. Identify risks, invariants, and edge cases.
5. Identify likely tests or verification commands.
6. Do not make changes.

Expected output:
- Summary
- Relevant files/symbols/line ranges
- Current behavior
- Risks/invariants
- Recommended writer scope
- Open questions/uncertainties
```
