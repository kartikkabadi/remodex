# Architect contract — WT-4 iOS AgentRuntime normalization

**Depends on:** WT-3 merged (Swift-only fixes in `CodexService+RuntimeConfig`, `TurnViewModel`, etc.).

## Target type

```swift
enum AgentRuntime: String, Codable, Sendable {
    case codex
    case opencode

    static func normalize(_ raw: String?) -> AgentRuntime
}
```

**Wire:** `agent_runtime` / `agentRuntime` on thread read payloads (already decoded in `CodexThread`).

## Single normalization source

| Today | WT-4 |
|-------|------|
| `CodexThread.normalizeAgentRuntime` (string) | Delegate to `AgentRuntime.normalize` |
| `modelProvider == "opencode"` heuristic in `decodeAgentRuntime` | **Remove** — trust bridge `agent_runtime` only |
| `CodexService.preferredAgentRuntime` string in UserDefaults | Keep storage; map through `AgentRuntime` at boundaries |
| `isOpenCodeAgentRuntime` on thread | `thread.agentRuntime == .opencode` |
| `isOpenCodeRuntimeConnected` on service | Rename clarity: connection vs thread (see below) |

## Connection vs thread runtime

| Concept | Property (proposed) | Meaning |
|---------|---------------------|---------|
| Bridge transport | `CodexService.isOpenCodeBridgeConnected` (rename from `isOpenCodeRuntimeConnected`) | `REMODEX_PROVIDER` / bridge capabilities at pairing |
| Per-thread | `CodexThread.agentRuntime: AgentRuntime` | Persisted thread metadata from bridge |

**WT-4:** Rename `isOpenCodeThread` usages in composer to `isOpenCodeBridgeConnected` only where meaning is **connection**; thread-scoped UI uses `thread.agentRuntime`.

## `supportsVariants`

- Source: bridge capabilities payload (already surfaced in runtime config fetch).
- Gate: `TurnComposerRuntimeState.supportsVariants` ← `capabilities.supportsVariants` (or equivalent key), not inferred from model id.
- OpenCode: variants when bridge reports support; Codex: existing variant menu rules.

## Files to touch (WT-4 only)

- `CodexThread.swift` — enum + decoding
- `CodexService+RuntimeConfig.swift` — preferred runtime, capabilities
- `TurnComposerRuntimeState.swift` (or equivalent) — `supportsVariants`
- `TurnComposerRuntimeUIKitMenu.swift` — agent submenu visibility
- `CodexThreadRuntimeOverrideTests.swift` — table-driven normalize tests

## Out of scope (WT-3)

- `RuntimeOverride` custom `Decodable`
- Stale variant prune, skill miss markers, timeline collapse, settings cards

## Optional (worth exploring, not blocking)

- Small `EffectiveAgentRuntime` resolver: `max(connection, thread)` for composer defaults when thread is `.codex` but user prefers OpenCode for **new** threads only.
