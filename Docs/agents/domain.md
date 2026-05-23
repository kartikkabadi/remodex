# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root
- **`docs/adr/`** — read ADRs that touch the area you're about to work in (especially agent runtime and canonical events)

This is a single-context repo. There is no `CONTEXT-MAP.md`.

## File structure

```
/
├── CONTEXT.md
├── Docs/adr/
│   ├── 002-agent-runtime-and-canonical-events.md
│   └── 003-cursor-agent-runtime.md
├── Docs/plans/
│   └── multi-agent-runtime.md   ← index; links to GitHub issues on fork
└── docs/agents/
```

## Use the glossary's vocabulary

When your output names a domain concept, use the term as defined in `CONTEXT.md`. Key terms: **Agent Runtime**, **OpenCode Agent**, **Agent Session**, **Environment** (not "runtime" for repo context).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding.
