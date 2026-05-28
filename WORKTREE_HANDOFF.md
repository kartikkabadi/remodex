# WORKTREE_HANDOFF — wt-sim-infra (WT-6)

| Field | Value |
|-------|-------|
| Branch | `opencode/wt-sim-infra` |
<<<<<<< HEAD
<<<<<<< HEAD
| Base | `opencode/integration` (post WT-3) |
=======
| HEAD | _(set after final commit)_ |
=======
| HEAD | `c08542e0` (`7900d288` — matrix path + codex-smoke) |
>>>>>>> 2dee6d9b (Point WT-6 handoff at final branch HEAD.)
| Base | `opencode/integration` @ `6b976000` |
>>>>>>> 7900d288 (Fix sim matrix path and codex-smoke row 9 recording.)
| Scope | WT-6 simulator infra only |

## Deliverables

| Item | Path |
|------|------|
| DEBUG RMX1 hook | `RemodexDebugPairing.swift`, `ContentViewModel`, `ContentView` |
| Emit RMX1 | `scripts/opencode-emit-pairing-rmx1.sh` |
<<<<<<< HEAD
| Preflight + row 9 | `scripts/opencode-sim-preflight.sh` |
=======
| Preflight + row 9 | `scripts/opencode-sim-preflight.sh` (`codex-smoke` records row 9, restores OpenCode launcher) |
>>>>>>> 7900d288 (Fix sim matrix path and codex-smoke row 9 recording.)
| Screenshot validator | `scripts/validate-qa-screenshot.sh` |
| Matrix recorder | `scripts/opencode-sim-record-row.sh` → `.qa-screenshots/opencode-sim/opencode-sim-matrix.json` |
| XcodeBuildMCP | `.xcodebuildmcp/config.yaml` |
<<<<<<< HEAD
| Runbook | `Docs/plans/opencode-sim-qa-runbook.md` |

## Integrator

Rebase onto latest `opencode/integration`, merge, gate with `./scripts/opencode-sim-preflight.sh --check-only`.
=======
| Gitignore | `.qa-screenshots/opencode-sim/` (explicit under `.qa-screenshots/`) |
| Runbook | `Docs/plans/opencode-sim-qa-runbook.md` (Wave 0/1a + DEBUG pairing) |

## Tests run (this worktree)

| Check | Command | Result |
|-------|---------|--------|
| Preflight check-only | `./scripts/opencode-sim-preflight.sh --check-only` | Pass |
| Script syntax | `bash -n scripts/opencode-*.sh scripts/validate-qa-screenshot.sh` | Pass |
| Matrix recorder | `./scripts/opencode-sim-record-row.sh 0 connected pass …` | Pass (writes under `.qa-screenshots/opencode-sim/`) |

**Not run here:** full `build_run_sim` / `xcodebuild` (integrator or Wave 2A orchestrator).

## Integrator

1. Rebase `opencode/wt-sim-infra` onto latest `opencode/integration`
2. Merge into `opencode/integration` (order: after wt-ios-runtime per plan)
3. Gate: `./scripts/opencode-sim-preflight.sh --check-only`
4. Do **not** merge to `multi-agents/opencode` until Wave 2 + thermo gates

## Allowed globs

- `scripts/opencode-*`
- `scripts/validate-qa-screenshot.sh`
- `.xcodebuildmcp/`
- `Docs/plans/opencode-sim-qa-runbook.md`
- `CodexMobile/**` (DEBUG pairing + launch wiring)
>>>>>>> 7900d288 (Fix sim matrix path and codex-smoke row 9 recording.)
