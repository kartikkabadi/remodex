# Domain Docs

This is a single-context repo.

## Before exploring, read these

- `CONTEXT.md` at the repo root, when present
- `docs/adr/`, when present, for architectural decisions relevant to the area being changed

If these files do not exist, proceed silently. The producer skill creates them lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When output names a domain concept, use the term as defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If the concept is not in the glossary yet, either reconsider the language or note it as a gap for the documentation-producing workflow.

## Flag ADR conflicts

If work contradicts an existing ADR, surface that explicitly instead of silently overriding it.
