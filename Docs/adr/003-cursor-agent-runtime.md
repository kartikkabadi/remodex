# ADR 003: Cursor agent runtime (V1)

**Status:** Accepted (planning)  
**Date:** 2026-05-23  
**Deciders:** Remodex fork (`kartikkabadi/remodex`)  
**Depends on:** [ADR 002](002-agent-runtime-and-canonical-events.md)

## Context

Cursor support was sketched on upstream branch `codex/add-cursor-provider` using the same `modelProvider` router as OpenCode. ADR 002 rejects that pattern. Cursor must be a third `agentRuntime` peer behind the same canonical event layer as OpenCode.

## Decision

1. **`agentRuntime: "cursor"`** with **`agentSessionId`** = Cursor ACP session id from `session/new`.
2. **Transport:** bridge spawns or reuses the verified Cursor Agent ACP command — locally `/Users/user/.local/bin/agent acp`, or an equivalent documented `cursor-agent acp` / `cursor agent acp` entrypoint — JSON-RPC over stdio per thread `cwd` (same security posture as other local runtimes: Mac-only, no credentials to iOS).
3. **Canonical only:** `cursor-to-canonical-adapter.js` maps ACP updates to `remodex/event/*` and `plan.*`; permission frames become **`remodex/request/permission`** with responses from the phone — **not** maintainer-branch auto `selectPermissionOption` in production.
4. **Plan mode:** map Remodex plan turns to ACP mode `plan` (reuse `cursorModeForParams` idea from maintainer branch inside adapter).
5. **No Cursor-internal agent picker in V1** (unlike OpenCode build/plan agents). Model/mode via Cursor config; optional display hints only.
6. **iOS:** same `RemodexEventAdapter` and composer Agent Runtime pill as OpenCode; Cursor row in `agent/runtime/list` when ACP is available.
7. **Grok:** placeholder fourth runtime; out of V1 scope.

## Consequences

### Positive

- Reuses ADR 002 registry, thread state file, and iOS cutover once.
- Cursor can ship in parallel with OpenCode after issue 03 lands.

### Negative

- ACP schema and plan-update shapes need fixture-backed tests; maintainer branch may be incomplete for plan timeline parity.
- Long-lived ACP sessions need explicit cancel/reconnect policy (document in issue 10).

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Merge `add-cursor-provider` as-is | `modelProvider` router + auto permissions |
| iOS talks to Cursor directly | Breaks E2EE + Mac-only trust boundary |
| Defer Cursor until after upstream merge | Fork needs full multi-runtime on `kartikkabadi/remodex` first |

## References

- Master plan: [Docs/plans/multi-agent-runtime.md](../plans/multi-agent-runtime.md)
- Maintainer reference: `origin/codex/add-cursor-provider`
- Parent PRD issue: https://github.com/kartikkabadi/remodex/issues/16
- Cursor execution issues: https://github.com/kartikkabadi/remodex/issues/25, https://github.com/kartikkabadi/remodex/issues/26, https://github.com/kartikkabadi/remodex/issues/27
- Implementation blueprint: [Docs/plans/multi-agent-runtime-implementation.md](../plans/multi-agent-runtime-implementation.md)
