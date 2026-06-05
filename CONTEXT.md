# Context — remodex:opencode

Glossary and doc index for agent and planning sessions. Implementation details belong in code and ADRs, not here.

## Execute-plan doc set (start here)

| File | Purpose |
|------|---------|
| [`docs/operations/execute-plan-a6c7a11c-INDEX.md`](docs/operations/execute-plan-a6c7a11c-INDEX.md) | Entry point — which file to read |
| [`docs/operations/execute-plan-a6c7a11c-STATUS.md`](docs/operations/execute-plan-a6c7a11c-STATUS.md) | Done vs not done; on `main` vs worktrees |
| [`.cursor/plans/execute-plan-a6c7a11c-integration.plan.md`](.cursor/plans/execute-plan-a6c7a11c-integration.plan.md) | Agent-executable resume plan (Phase 0, Themes A–D) |
| [`.cursor/EXECUTE-PLAN-RECOVERY-a6c7a11c.md`](.cursor/EXECUTE-PLAN-RECOVERY-a6c7a11c.md) | Forensic reference (worktrees, Grok artifacts) |

## Terms

| Term | Meaning |
|------|---------|
| **Integration surface** | `repos/remodex-opencode/` — bridge + iOS app where the OpenCode integration must be complete. |
| **Meta workspace** | `$REMODEX_WORKSPACE` — monorepo root; git `main` tracks `repos/remodex-opencode/` files. |
| **Execute-plan `a6c7a11c`** | Interrupted Grok 16-PR batch (Jun 2026). Code lives in isolated subagent worktrees, not on `main`. |
| **Themed integration PR** | One of four merge units (Messaging, Skills+Slash, Branding, Docs closeout) landing on meta `main`. |
| **Grok worktree** | Separate git clone under `~/.grok/worktrees/downloads-remodexopencode/subagent-*` — authoritative for execute-plan commits. |
| **Production-ready (pre-upstream)** | All themed PRs merged + per-theme automated tests green + owner device iteration until stable; upstream Remodex PR is a later step. |
| **Phase 0** | Pre-merge tidy: inventory, PR-13 commit, PR-5/6 reconcile, messaging review, refreshed SHA map. |
| **Theme B B1 / B2** | B1 = functional composer (PR 4,5,6,14); B2 = iOS UX (PR 9 + mandatory greenfield PR-10). One branch, one merge. |
| **Final bar** | After all themes on `main`: device testing and iteration by owner — not per-theme. |
