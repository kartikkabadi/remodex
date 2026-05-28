# WORKTREE_HANDOFF — wt-sim-infra (WT-6)

| Field | Value |
|-------|-------|
| Branch | `opencode/wt-sim-infra` |
| Base | `opencode/integration` (post WT-3) |
| Scope | WT-6 simulator infra only |

## Deliverables

| Item | Path |
|------|------|
| DEBUG RMX1 hook | `RemodexDebugPairing.swift`, `ContentViewModel`, `ContentView` |
| Emit RMX1 | `scripts/opencode-emit-pairing-rmx1.sh` |
| Preflight + row 9 | `scripts/opencode-sim-preflight.sh` (`codex-smoke` records row 9, restores OpenCode launcher) |
| Screenshot validator | `scripts/validate-qa-screenshot.sh` |
| Matrix recorder | `scripts/opencode-sim-record-row.sh` → `.qa-screenshots/opencode-sim/opencode-sim-matrix.json` |
| XcodeBuildMCP | `.xcodebuildmcp/config.yaml` |
| Gitignore | `.qa-screenshots/opencode-sim/` |
| Runbook | `Docs/plans/opencode-sim-qa-runbook.md` |

## Integrator

Rebase onto latest `opencode/integration`, merge, gate with `./scripts/opencode-sim-preflight.sh --check-only`.
