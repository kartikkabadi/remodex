# OpenCode runtime — status (honest)

**Updated:** 2026-05-28  
**Branch:** `multi-agents/opencode` · **PR:** [#54](https://github.com/kartikkabadi/remodex/pull/54)

## Success tiers

| Tier | Status | Notes |
|------|--------|-------|
| **P0_CODE** | Done | `agent/list`, loopback bind, `--opencode` on fork |
| **P0_DOCS** | In progress | ADR + plans committed this wave |
| **SIM_EVIDENCE** | Pending | Wave 2 orchestrator + screenshots |
| **DEVICE_SIGNOFF** | Pending | Kartik physical iPhone — **not agent-substitutable** |
| **SHIP_WORDING** | Blocked | Requires SIM_EVIDENCE + DEVICE_SIGNOFF |

## Code + automated tests

| Item | Status |
|------|--------|
| T1 transport, policy, refusals | Done (branch) |
| T2 iOS runtime UI, composer, Settings | Done (branch) |
| T3-G hide `/status` on OpenCode | Done |
| `agent/list` + T2-1 unit test | Done (`0b5932e2`) |
| `phodex-bridge` `npm test` | Green (~490 pass, 2 skipped) |
| Relay bind `127.0.0.1` (launcher, snippet, `relay/server.js`) | Done (`bf8e1f11`) |
| `./run-local-remodex.sh --opencode` | Done (`bf8e1f11`) |

## Documentation

| Item | Status |
|------|--------|
| `Docs/adr/001-opencode-runtime-shape.md` | Done (this wave) |
| `Docs/plans/opencode-runtime.md` | Done (this wave) |
| `Docs/plans/opencode-local-dev.md` | Done (this wave) |
| `Docs/plans/opencode-sim-qa-runbook.md` | Done (this wave) |
| CONTRIBUTING OpenCode section | Done (this wave) |
| AGENTS.md pointers | Done (this wave) |
| Issue #53 aligned with branch scope | Comment added (this wave) |

## PR #54 manual matrix (simulator)

Evidence path: `.qa-screenshots/opencode-sim/` (gitignored).  
Orchestration: [opencode-sim-qa-runbook.md](./opencode-sim-qa-runbook.md).

| # | Scenario | Sim | Device |
|---|----------|-----|--------|
| 1 | New OpenCode thread — `agentRuntime` + sidebar logo | Pending | Pending |
| 2 | `model/list` — providers/models stick | Pending | Pending |
| 3 | Variant — Intelligence menu + turn uses selection | Pending | Pending |
| 4 | Agent — build/plan/custom + turn uses agent | Pending | Pending |
| 5 | Fast model — Speed menu | Pending | Pending |
| 6 | Stop during run + interrupt | Pending | Pending |
| 7 | Reconnect — Stop still works | Pending | Pending |
| 8 | Plan flow → plan agent | Pending | Pending |
| 9 | Codex regression (launcher **without** `--opencode`) | Pending | Pending |
| 10 | No ChatGPT spam; `/status` absent on OpenCode | Pending | Pending |
| 11 | Errors not `[object Object]` in toasts | Pending | Pending |

## PR #54 manual matrix (physical iPhone — Kartik)

| # | Scenario | Status |
|---|----------|--------|
| 1–11 | Same as sim table | **DEVICE_SIGNOFF pending** — background, Local Network, real Wi‑Fi |

Agents must not mark device rows pass without Kartik’s results.

## Deferred (T3 — tracker issues, Wave 4)

- Slash `/fork`, `/compact`, `/review` on OpenCode
- Autocomplete / rich bus
- `thread/name/set` vs git-handler edge cases (documented in spec)
- Transport file split (ADR deferred)
