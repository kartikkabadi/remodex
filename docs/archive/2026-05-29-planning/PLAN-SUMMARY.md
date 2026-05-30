# Remodex + OpenCode — canonical short plan

**Reset 2026-05-29.** Full OpenCode in Remodex. Work in `remodex:opencode` only. **No upstream PR** until device E2E passes.

## Goal

Ship **as much OpenCode as Remodex can honestly support** behind the existing composer pill and Codex-shaped JSON-RPC — not cherry-picked slices from `codex/add-opencode-provider`.

## Done bar

1. **Device:** Codex regression pass + OpenCode session (agent, model, turn, git, slash/skills that matter).
2. **Bridge:** `sfw npm test` green (ACP mocked + CLI fallback + router).
3. **Parity matrix** published and kept current (no fake-enabled UI).

## Composer UX (unchanged hierarchy)

```
runtime → opencode agent → provider → model → reasoning → fast
```

OpenCode cannot do something → **greyed + reason** on OpenCode threads. Never silent failure or enabled controls without catalog proof.

## Harness

| Mode | Role |
|------|------|
| **ACP stdio** (`opencode acp`) | Primary — long-lived child, session-scoped slash/skills |
| **CLI** (`opencode run`) | Fallback only — catalog lists when/why |

## Branch strategy

Use **`codex/add-opencode-provider` as integration base** OR merge holistically and **fix forward** — **NOT** file-by-file cherry-pick onto `main`.

## Milestones

| # | Name | Exit |
|---|------|------|
| **M1** | Base + router + catalog | Tests green; Codex unchanged when OpenCode off |
| **M2** | ACP harness primary | Device turn via ACP; CLI fallback tested |
| **M3** | iOS composer + selection | Full pill hierarchy; capability grey-out |
| **M4** | Parity (modes, slash, git) | Matrix filled; no fake rows |
| **M5** | Device sign-off | Kartik OK → upstream optional |

## Parity matrix

| Feature | Codex | OpenCode | UI |
|---------|-------|----------|-----|
| Runtime pick | enabled | enabled* | enabled |
| OC agent row | n/a | enabled* | Codex-only hidden |
| Provider / model | enabled | enabled* | enabled |
| Reasoning | enabled | catalog | greyed + reason |
| Fast | enabled | catalog | greyed + reason |
| Codex Plan (+) | enabled | n/a | hidden on OC |
| Remodex slash/skills | enabled | partial | greyed + reason |
| MCP (iOS settings) | enabled | in-process | greyed + reason |
| Git / workspace | enabled | enabled | enabled |
| Streaming / tools | enabled | partial | beta until parity |
| Voice | enabled | n/a | greyed on OC |
| Approvals | enabled | partial | greyed + reason |
| Steer / fork / queue | enabled | partial | greyed + reason |

\*When `opencode` on PATH + `REMODEX_ENABLE_OPENCODE=1`. Otherwise runtime greyed: *OpenCode not installed on Mac*.

## What we're NOT doing

- Tiny PR-first / “PR #1 registry only” roadmap.
- Cherry-pick files onto `main` as the integration strategy.
- Upstream PR before Kartik device E2E.
- “Open issue first” blocker.
- CLI-per-turn as primary harness.
- Fake-enabled composer controls.

## Agent pointers

- Detail: `plan.md`, `ux-spec.md` (§ Capability-driven UI), `architecture.md`, `gaps.md`.
