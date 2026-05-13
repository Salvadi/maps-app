# Codex Writer Prompt

```text
ROLE: writer.

Read AGENTS.md first.

Objective:
<specific change to implement>

Task spec:
<paste task spec or reference docs/task-template.md instance>

Scope:
<allowed files/folders>

Non-goals:
<explicitly out of scope>

Constraints:
- Inspect existing patterns before editing.
- Make the smallest safe change.
- Preserve unrelated user changes.
- Do not invent requirements.
- Do not change dependencies unless explicitly requested.
- Keep Italian comments/UI text where product-facing.
- Update tests/docs only when relevant.
- Respect Dexie, Supabase, sync, storage, auth, and service worker invariants from AGENTS.md.

Verification commands:
<safe commands to run, e.g. npm test -- --watchAll=false --testPathPattern=...>

Expected output:
- Changed files
- Summary of implementation
- Commands run and results
- Risks/uncertainties
- Anything not completed and why
```
