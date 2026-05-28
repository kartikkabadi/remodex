# WORKTREE_HANDOFF — WT-1 transport P1

## Branch
`opencode/wt-transport-p1`

## Base
`opencode/integration` @ `6b976000`

## HEAD
`4aae679e2147c6f38b1909181ec7816724c9e43d`

## Scope
Transport P1 fixes + mandatory regression tests (merged WT-1 + WT-5).

## Files touched
- `phodex-bridge/src/opencode-transport.js`
- `phodex-bridge/test/opencode-transport.test.js`
- `phodex-bridge/test/opencode-e2e.test.js`

## Changes
- `prompt_async`: guard `result?.__opencodeError`; treat 204 / null body as success
- `formatOpenCodeModel` → `{ providerID, modelID }` on POST body only
- `try/finally` cwd lock release when turn does not commit to running
- `finalizeActiveTurn` inline; wired to SSE 20-attempt ceiling, `session.error`, interrupt, idle, prompt failure, boot/read paths
- `makeJsonRpcRequest`; approvals and user-input emit JSON-RPC **requests** with top-level `id`
- Tests: 204, model wire, SSE exhaustion cleanup, thread list/resume/turns/name routes, approval id, e2e response poll filter

## Tests run
```bash
cd phodex-bridge && sfw npm test
```
Result: **501 tests, 499 pass, 0 fail, 2 skip** (workspace image tests).

## Merge instructions
Parent integrator: rebase onto latest `opencode/integration`, run gate, merge **after** WT-0. Do **not** merge to `multi-agents/opencode` from this worktree.

## Allowed globs (bootstrap)
- `phodex-bridge/src/opencode-transport.js`
- `phodex-bridge/test/*opencode*`
- `phodex-bridge/test/*transport*`
