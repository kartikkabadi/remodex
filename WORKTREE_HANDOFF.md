# WORKTREE_HANDOFF — wt-0-upstream-sync

| Field | Value |
|-------|-------|
| Branch | `opencode/wt-0-upstream-sync` |
| HEAD | `685c05db17d7cd5ef1bb51becc8fa012872df39e` |
| Base | `opencode/integration` @ `36d5efc2` |
| Merge | `origin/main` — **clean** (ort, no conflict markers) |

## Tests (this worktree)

| Package | Command | Pass | Fail | Skipped |
|---------|---------|------|------|---------|
| phodex-bridge | `cd phodex-bridge && sfw npm test` | 490 | 0 | 2 |
| relay | `cd relay && sfw npm test` | 41 | 0 | 0 |

## Files touched

Upstream merge only (no intentional OpenCode lane edits):

- `CodexMobile/` — terminal help sheet, app review prompt, composer/toolbar tweaks
- `phodex-bridge/` — ios-app-compatibility, package version bump
- `README.md`

## Allowed globs (worker scope)

- `phodex-bridge/`
- `relay/`
- `package.json` / `package-lock.json`

## Integrator

Merge this branch into `opencode/integration`, then re-run bridge + relay `sfw npm test` on integration checkout.
