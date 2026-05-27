# OpenCode runtime — status (honest)

**Updated:** 2026-05-28 (Wave 2 sim QA)  
**Branch:** `multi-agents/opencode` · **PR:** [#54](https://github.com/kartikkabadi/remodex/pull/54)

## Success tiers

| Tier | Status | Notes |
|------|--------|-------|
| **P0_CODE** | Done | `agent/list`, loopback bind, `--opencode` on fork |
| **P0_DOCS** | Done | ADR + plans + runbook + AGENTS/CLAUDE launcher runbook |
| **SIM_EVIDENCE** | Partial | Infra + unit gates pass; UI matrix blocked at sim pairing (paste-code not automated) |
| **DEVICE_SIGNOFF** | Pending | Kartik physical iPhone — **not agent-substitutable** |
| **SHIP_WORDING** | Blocked | Requires SIM_EVIDENCE (UI rows) + DEVICE_SIGNOFF |

## Wave 2A infrastructure (2026-05-28)

| Check | Result | Evidence |
|-------|--------|----------|
| `./run-local-remodex.sh --opencode --hostname 127.0.0.1` | Pass | `/tmp/remodex-opencode-launcher.log` |
| `curl http://127.0.0.1:9000/health` | Pass | `{"ok":true}` |
| Pairing code emitted | Pass | Code `G28NR3UVAB` in launcher log (expires ~20:34Z) |
| Sim app paired to OpenCode bridge | **Blocked** | App on QR screen; paste-code flow not completed in automation session |
| `xcodebuildmcp simulator build-and-run` | Pass | Bundle `com.emanueledipietro.Remodex`, DerivedData `.build/DerivedData-Sim` |
| `phodex-bridge npm test` | Pass | 490 pass, 2 skipped |
| Filtered `test_sim` | Pass | 43 pass (`CodexThreadRuntimeOverrideTests`, `TurnComposerReviewModeTests`, related) |
| `OPENCODE_E2E=1` | Pass | 491 pass when `opencode` on PATH |

**Screenshot:** `.qa-screenshots/opencode-sim/row-00-pairing-screen.jpg` (pairing gate, not connected)

## PR #54 manual matrix (simulator)

| # | Scenario | Sim | Evidence / notes |
|---|----------|-----|------------------|
| 1 | New OpenCode thread — `agentRuntime` + sidebar logo | **Blocked** | Needs paired sim session |
| 2 | `model/list` — providers/models stick | **Blocked** | Needs paired sim session |
| 3 | Variant — Intelligence menu + turn | **Blocked** | Needs paired sim session |
| 4 | Agent — build/plan/custom + turn | **Partial** | Bridge `T2-1 agent/list` unit test pass; UI blocked |
| 5 | Fast model — Speed menu | **Blocked** | Needs paired sim session |
| 6 | Stop during run + interrupt | **Blocked** | Needs live turn |
| 7 | Reconnect — Stop still works | **Blocked** | Needs paired session |
| 8 | Plan flow → plan agent | **Blocked** | Needs paired session |
| 9 | Codex regression (launcher without `--opencode`) | **Not run** | Blocked on sim pairing; sub-flow documented in runbook |
| 10 | No ChatGPT spam; `/status` absent on OpenCode | **Partial** | iOS/runtime unit tests pass; UI blocked |
| 11 | Errors not `[object Object]` in toasts | **Blocked** | Needs real RPC failure in UI |

## PR #54 manual matrix (physical iPhone — Kartik)

| # | Scenario | Status |
|---|----------|--------|
| 1–11 | Same as sim table | **DEVICE_SIGNOFF pending** — background, Local Network, real Wi‑Fi |

Agents must not mark device rows pass without Kartik’s results.

## Commits pushed (fork `multi-agents/opencode`)

| Commit | Summary |
|--------|---------|
| `0b5932e2` | `agent/list` + tests + `.gitignore` / untrack `.scratch` |
| `bf8e1f11` | Loopback bind + `--opencode` |
| `e1318981` | ADR + plans + runbook |
| `7a94f9d8` | AGENTS/CLAUDE single-launcher runbook |

## Deferred (T3 — tracker issues, Wave 4)

- [#55](https://github.com/kartikkabadi/remodex/issues/55) slash commands
- [#56](https://github.com/kartikkabadi/remodex/issues/56) autocomplete / rich bus
- [#57](https://github.com/kartikkabadi/remodex/issues/57) `thread/name/set` vs git-handler
- [#58](https://github.com/kartikkabadi/remodex/issues/58) split transport (post-merge)
- [#59](https://github.com/kartikkabadi/remodex/issues/59) optional session-jsonl-history
