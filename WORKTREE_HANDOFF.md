# WORKTREE_HANDOFF — wt-bridge-p1

| Field | Value |
|-------|-------|
| Branch | `opencode/wt-bridge-p1` |
| Base | `opencode/integration` (post WT-1) |
| Scope | WT-2 bridge routing P1 |

## Changes

- **Method-level git gate:** `shouldInvokeGitHandler` routes `git/*` + `thread/generateTitle` to `handleGitRequest` under OpenCode; `thread/name/set` falls through to transport.
- **Codex account forward:** `account/login/*`, `logout`, `account/rateLimits/read` no longer bridge-managed in Codex mode (reach `codex.send`); OpenCode refusals unchanged.
- **Tests:** `bridge-opencode-git-routing.test.js`; `t1-8-git-handler-gate.test.js` updated for WT-2 gate.
- **LOC:** `bridge.js` +24 net (within ≤30 budget).

## Files touched

- `phodex-bridge/src/bridge.js`
- `phodex-bridge/test/bridge-opencode-git-routing.test.js` (new)
- `phodex-bridge/test/t1-8-git-handler-gate.test.js`

## Integrator

Rebase onto latest `opencode/integration`, merge `opencode/wt-bridge-p1`, run `sfw npm test` in `phodex-bridge/`. **Do not merge to integration from this worktree.**
