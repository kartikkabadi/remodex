# ADR-006: Session Lifecycle

**Date:** 2026-05-30
**Status:** Accepted

## Context

Each OpenCode thread requires a session (created via `client.session.create()`). Sessions consume resources: the `opencode serve` process maintains in-memory session state, event subscriptions, and possibly MCP server connections.

Questions:
- When is a session created? At `thread/start` or at first `turn/start`?
- When is a session destroyed? On bridge shutdown? On idle timeout?
- How does a session survive bridge restart?

## Decision

### Lifecycle State Machine

```
                    ┌─────────────┐
                    │  NOT_EXISTS │
                    └──────┬──────┘
                           │ thread/start
                           ▼
                    ┌─────────────┐
         ┌─────────│   ACTIVE    │◄────────┐
         │         └──────┬──────┘         │
         │                │ turn/start     │ turn/completed
         │                ▼                │
         │         ┌─────────────┐         │
         │         │   RUNNING   │─────────┘
         │         └──────┬──────┘
         │                │ turn/interrupt
         │                ▼
         │         ┌─────────────┐
         │         │  COMPLETING │
         │         └──────┬──────┘
         │                │
         │         ┌──────▼──────┐
         │         │    IDLE     │
         │         └──────┬──────┘
         │                │ 10 min no activity
         │                ▼
         │         ┌─────────────┐
         └─────────│  SHUTDOWN   │
                   └─────────────┘
```

### Creation: Lazy on First Turn

**Not at `thread/start`.** A thread can be created and sit idle. Creating a session at thread creation wastes resources.

**At `turn/start`.** The first `turn/start` for a thread triggers session creation if one doesn't exist. This is how dpcode works — sessions are per-conversation, created when the user first sends a message.

Session ID is persisted to `~/.remodex/opencode-sessions.json`:
```json
{
  "sessions": {
    "opencode-thread-1717000000-a1b2c3": {
      "sessionId": "ses_abc123",
      "createdAt": "2026-05-30T12:00:00.000Z",
      "lastActivityAt": "2026-05-30T12:05:00.000Z"
    }
  }
}
```

### Persistence Across Restarts

When the bridge restarts:
1. Read `thread-ownership.json` → know which threads are OpenCode
2. Read `opencode-sessions.json` → know which sessions exist
3. On first `thread/read` or `thread/turns/list` for a thread with a persistent session: call `client.session.get({ sessionID })` to rehydrate
4. On first `turn/start` for a thread with a persistent session: use the existing session, don't create a new one
5. If `session.get()` fails (session expired, server restarted): create a new session, update the mapping

### Idle Shutdown

After 10 minutes with no active turns and no `activeTurns`, the provider idle timer fires (`opencode-provider.js:resetIdleTimer`). The bridge calls **`server.stop()`** on the `opencode serve` child process, sets `client = null`, and marks the provider unhealthy. This tears down the serve process and its in-memory SDK subscriptions — not merely a soft unsubscribe.

**What survives idle shutdown:**
- Session IDs in `opencode-sessions.json` (durable mapping)
- Thread ownership in `thread-ownership.json`
- Thread metadata in the provider's in-memory `threads` map (until bridge restart)

**What is lost until the next wake:**
- Live SDK client handle and SSE event subscriptions
- In-flight serve health state (`healthy = false`)

The next `turn/start`, `thread/list`, or other serve-touching RPC calls `ensureStarted()`, which restarts `opencode serve` and rehydrates sessions via `session.get()` using the persisted session IDs. `opencode-idle-shutdown.test.js` asserts `server.stop` is invoked by the idle timer and that `thread/list` / `turn/start` restart serve afterward.

If `session.get()` fails after a serve restart (session expired on the OpenCode side), the bridge creates a new session and updates the mapping.

### Shutdown Cleanup

On bridge shutdown (`SIGINT`/`SIGTERM`):
1. All active turns are interrupted (`session.abort()`)
2. Session map is written to disk
3. `opencode serve` process receives SIGTERM, 5s grace, SIGKILL

## Consequences

**Serve process doesn't leak.** Idle shutdown stops `opencode serve` after 10 minutes with no active turns. A thread left open overnight does not keep the serve child running; the next turn pays a cold-start wake cost (~`REMODEX_OPENCODE_SERVE_WAKE_MS`, default 8s cap).

**Threads survive bridge restarts.** Session IDs are durable. Even if `opencode serve` restarts, the session ID can be replayed.

**Startup is deterministic.** On bridge start: read two JSON files, reconcile with running opencode serve state. No hidden state, no reconstruction from logs.

**First turn is slightly slower.** Session creation happens at `turn/start`, not `thread/start`. This adds ~200-500ms to the first turn of a new thread. Subsequent turns reuse the existing session.
