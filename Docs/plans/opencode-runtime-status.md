# OpenCode runtime — status (honest)

**Updated:** 2026-05-28 (execution readiness + fresh-onboarding sim QA)  
**Branch:** `opencode/integration` @ `099e24dd` (local — **not** merged to `multi-agents/opencode`, **not** pushed)  
**PR:** [#54](https://github.com/kartikkabadi/remodex/pull/54)  
**Plan:** Cursor `opencode_p0_ship_prep_e66437d5.plan.md` (Phase 2.5 execution + readiness matrix)

## Execution readiness (2026-05-28)

| Stance | Detail |
|--------|--------|
| **Build (Phase 2.5)** | **Execute now** — upstream cherry-picks, P1 UX, P2 composer, transport probe test |
| **Ship / PR language** | **Blocked** until Kartik sim retest passes (P0-MSG proof) |
| **Pre-QA** | Stack restart + fresh thread + one “Hey” — **deferred**, not a blocker to start build work |

## Success tiers

| Tier | Status | Notes |
|------|--------|-------|
| **P0_CODE** | Done | `agent/list`, loopback bind, `--opencode`; WT-0…WT-6 on `opencode/integration` |
| **P0_DOCS** | Done | ADR + plans + runbook + AGENTS/CLAUDE launcher runbook |
| **P0_MSG_FIX** | Code done | `099e24dd` — `turn/started` + completion probe when SSE misses idle |
| **SIM_EVIDENCE** | Partial / blocked | Fresh-onboarding QA found stuck `running`; fix committed; **sim retest deferred** (no stack restart) |
| **DEVICE_SIGNOFF** | Pending | Kartik physical iPhone — **not agent-substitutable** |
| **SHIP_WORDING** | Blocked | Requires SIM_EVIDENCE + DEVICE_SIGNOFF |

## Integration / upstream

| Metric | Value |
|--------|--------|
| vs `origin/main` @ `28f7d3c8` | **41 commits ahead**, **0 behind** |
| `fork/main` | **Do not merge** (superseded stack) |
| thermo-verify | **PASS-with-waiver** @ `57815cb6` (see `.audit/opencode-p0-ship.tsv`) |
| Wave 2 automated sim | **Cancelled** — manual QA only |

## Recent commits (`opencode/integration`)

| Commit | Summary |
|--------|---------|
| `099e24dd` | P0 messaging: `turn/started`, completion probe; agent-list error surfacing |
| `d768d11b` | `scripts/opencode-fresh-onboarding.sh` for sim QA reset |
| `57815cb6` | WT-4 `AgentRuntime` + composer gates |

## Sim QA findings (2026-05-28)

| ID | Severity | Status |
|----|----------|--------|
| P0-MSG | P0 | Fix committed; sim retest **pending** |
| P1-AGENTS | P1 | Fix committed (`099e24dd`); verify on retest |
| P1-BRIDGE-VER | P1 | Open — global `remodex@1.5.x` vs repo `2.0.0` false positive |
| P1-RUNTIME | P1 | Document — bridge-wide runtime (ADR); no per-session switch in P0 |
| P1-SELECTORS | P1 | Open — OpenCode lane copy for model/intelligence/speed |
| P2-COMPOSER | P2 | Open — upstream cherry-pick `db5bb695`, `7968103f`, etc. |

## Wave 2A infrastructure (2026-05-28)

| Check | Result | Evidence |
|-------|--------|----------|
| `./run-local-remodex.sh --opencode --hostname 127.0.0.1` | Pass | `/tmp/remodex-opencode-launcher.log` |
| `curl http://127.0.0.1:9000/health` | Pass | `{"ok":true}` |
| `phodex-bridge npm test` | Pass | 490+ pass (see integrator merges) |
| Filtered `test_sim` | Pass | Runtime/composer unit tests |
| `OPENCODE_E2E=1` | Pass | When `opencode` on PATH |
| Sim paired + connected screenshot | **Blocked** | Retest after stack restart; see plan Pre-QA checklist |

**Screenshot (stale):** `.qa-screenshots/opencode-sim/row-00-pairing-screen.jpg` (pairing gate, not connected)

## PR #54 manual matrix (simulator)

Rows 1–11 remain **blocked** or **partial** until post-fix sim session. Agents must not mark pass without Kartik evidence. Automated Wave 2 orchestration is **cancelled**; update matrix manually after retest.

## PR #54 manual matrix (physical iPhone — Kartik)

| # | Scenario | Status |
|---|----------|--------|
| 1–11 | Same as sim table | **DEVICE_SIGNOFF pending** |

## Pending workstreams

| WT | Item |
|----|------|
| Phase 2.5 | Upstream cherry-picks; P1 UX; P2 composer; transport probe test |
| Sim gate | Pre-QA checklist → P0-MSG verification |
| WT-7 | AGENTS paths, this doc, issue #53, PR #54, bot threads with SHAs |
| Push | Merge `opencode/integration` → `multi-agents/opencode`; push fork |

## Commits on fork `multi-agents/opencode` (pre-integration; stale until push)

| Commit | Summary |
|--------|---------|
| `0b5932e2` | `agent/list` + tests |
| `bf8e1f11` | Loopback bind + `--opencode` |
| `e1318981` | ADR + plans + runbook |
| `7a94f9d8` | AGENTS/CLAUDE single-launcher runbook |

*Integration branch has additional merges (WT-0…WT-6, `099e24dd`, etc.) not yet on fork until push.*

## Deferred (T3 — tracker issues, Wave 4)

- [#55](https://github.com/kartikkabadi/remodex/issues/55) slash commands
- [#56](https://github.com/kartikkabadi/remodex/issues/56) autocomplete / rich bus
- [#57](https://github.com/kartikkabadi/remodex/issues/57) `thread/name/set` vs git-handler
- [#58](https://github.com/kartikkabadi/remodex/issues/58) split transport (post-merge)
- [#59](https://github.com/kartikkabadi/remodex/issues/59) optional session-jsonl-history
