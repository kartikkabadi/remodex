# ADR-003: Thread Ownership

**Date:** 2026-05-30
**Status:** Accepted

## Context

When the user creates a thread with an OpenCode model, that thread must use OpenCode for every subsequent turn. The user cannot switch to Codex mid-thread. Similarly, Codex threads stay Codex. The bridge must enforce this across restarts — if the bridge process dies and comes back, a thread created in OpenCode must still route to OpenCode.

The current `opencode-provider.js` keeps thread ownership in an in-memory `Map`. This is lost on bridge restart.

## Decision

Persist thread → provider mappings to a **durable JSON file** at `~/.remodex/thread-ownership.json`.

```json
{
  "ownership": {
    "opencode-thread-1717000000-a1b2c3": {
      "providerId": "opencode",
      "assignedAt": "2026-05-30T12:00:00.000Z"
    },
    "thread-abc-123": {
      "providerId": "codex",
      "assignedAt": "2026-05-29T18:30:00.000Z"
    }
  }
}
```

### Ownership Lifecycle

1. **Set on `thread/start`** — the router calls `ownershipStore.setOwnership(threadId, provider.id)` before responding. The HTTP response has not been sent yet; if the write fails, the request fails.
2. **Checked on every route** — `thread/read`, `turn/start`, `turn/interrupt`, `thread/turns/list`, `thread/name/set`, `thread/archive` all look up ownership before dispatching.
3. **Atomic writes** — temp file + rename prevents corruption.
4. **30-day stale pruning** — entries older than 30 days with no activity are pruned on read. If a thread hasn't been touched in a month, we assume it's dead.
5. **Single writer** — the bridge process is the only thing writing this file. No concurrent access concerns.

### Strict Providers

Threads have a `strictProviders` policy: once opencode, always opencode. Once codex, always codex. The router rejects `turn/start` requests that try to change providers mid-thread with a structured error:

```json
{
  "error": {
    "code": -32000,
    "message": "This thread is owned by opencode and cannot be switched to another runtime.",
    "data": { "errorCode": "thread_provider_locked" }
  }
}
```

### Provider Isolation

- **Codex desktop refresh**: only Codex-owned threads trigger `CodexDesktopRefresher` or `desktop-ipc-action-follower`
- **Rollout mirror**: only Codex threads participate in JSONL rollout mirroring
- **Thread/list merge**: both providers contribute threads, but OpenCode threads carry `modelProvider: "opencode"` so the iOS sidebar can show provider badges

## Consequences

**Threads survive bridge restarts.** Ownership is read from disk on startup, not reconstructed from in-memory state.

**Provider migration is impossible mid-thread.** If a user wants to use a different runtime, they must create a new thread. This is by design.

**The store is deliberately simple.** No database, no versioning, no migration paths. The shape is stable. If it changes, we write a new file and the old one is orphaned.

**Codex threads without explicit provider fields default to Codex.** This preserves backward compatibility — existing threads created before provider routing was added are treated as Codex threads.
