# Observability

## Bridge Status

The bridge publishes status updates via `bridge-status.js`. The status object:

```json
{
  "state": "starting" | "running" | "error" | "stopped",
  "connectionStatus": "starting" | "connected" | "connecting" | "disconnected" | "error",
  "pid": 12345,
  "lastError": ""
}
```

**Extended status** (for diagnostics):
- `opencodeServerRunning: boolean`
- `opencodeVersion: string | null`
- `opencodeSdkReachable: boolean`
- `activeTurns: number`
- `ownedThreads: number`

**OpenCode subsection** (`bridge-status.json` → `opencode`, same object as `runtime/catalog` → `runtimes[].opencode`):
- `enabled`, `serveUrl`, `version`, `minVersion`, `versionBelowMinimum`
- `sessionCount`, `lastError`, `command`, `handoffEnvEnabled`, `authConfigured`
- `sseReconnectCount` — increments when the OpenCode event stream resubscribes after `streamError` (watch for reconnect churn during long turns)
- `permissionPendingCount` — size of the bridge `pendingPermissions` map (non-zero while a tool approval is waiting)
- `catalogRefreshMs` — milliseconds for the last `model/list` upstream refresh (`null` until the first warm fetch completes)

Heartbeat ticks refresh these three fields from `getObservabilityMetrics()` without mutating the persisted `latest()` snapshot (same pattern as stale-relay downgrade).

### Push notifications (OpenCode)

OpenCode turns use the **same** `pushNotificationTracker.handleOutbound` path as Codex (`bridge.js` outbound relay). Any application message with `turn/completed` and a tracked `threadId`/`turnId` can trigger a completion push when the push service URL is configured.

Signals to watch:
- `[remodex]` turn lifecycle logs (no `sessionId` in logs)
- Duplicate `turn/completed` from `session.idle` after `turn.completed` — provider dedupes by `completedTurnIds`

## Logging

### Levels

| Level | Use |
|-------|-----|
| `console.log` | Startup, connection, normal transitions |
| `console.warn` | Recoverable problems, retries, degraded state |
| `console.error` | Fatal errors, crash prevention |

### Prefixes

- Bridge core: `[remodex]`
- OpenCode server: `[remodex:opencode-server]`
- OpenCode SDK: `[remodex:opencode-sdk]`
- Router: `[remodex:router]`

### `thread/list` hot-path events

Emitted by `runtime-provider-router.js` and `opencode-provider.js` on each sidebar poll:

| Event | Fields | Meaning |
|-------|--------|---------|
| `thread_list_codex_ms` | `ms` | Codex leg wall time |
| `thread_list_opencode_ms` | `ms` | OpenCode leg wall time (`0` when paginated with cursor) |
| `thread_list_wall_ms` | `wallMs`, `codexMs`, `opencodeMs`, `discoverProjectsEnabled` | End-to-end merge time |
| `thread_list_leg_abandoned` | `leg`, `budgetMs` | Per-leg race hit fallback before underlying work finished |
| `thread_list_codex_failed` | `message` | Codex leg `.catch()` isolation |
| `thread_list_provider_failed` | `providerId`, `message` | OpenCode/provider leg `.catch()` isolation |
| `opencode_list_threads_wake_timeout` | `capMs` | Owned-thread wake exceeded `REMODEX_OPENCODE_ENSURE_STARTED_MS` |
| `opencode_list_threads_wake_failed` | `message`, `ms` | Owned-thread wake failed or timed out |
| `opencode_list_threads_degraded_stubs` | `threadId`, `reason` | Owned stub returned without SDK validation after wake timeout |

O18 SLO evidence: collect `thread_list_wall_ms` over a 5-minute window with both discover flags on.

### Redaction

Never log:
- `sessionId` values from relay pairing
- `notificationSecret` values
- Bearer tokens or API keys
- Private key material

Always redact to: `[redacted:session-id]`, `[redacted:token]`

## Diagnostics Mode

`REMODEX_DIAGNOSTICS=1` enables verbose output:
- Full SDK request/response bodies (without secrets)
- Event stream trace (event types and counts)
- Session lifecycle events (create, resume, destroy)
- Model cache hits/misses

## Health Monitoring

The bridge monitors `opencode serve` health:

1. **Startup:** Health check every 1s until server responds
2. **Running:** Health check every 30s
3. **Unhealthy:** If 3 consecutive health checks fail, restart the server (circuit breaker)
4. **Crash:** If server process exits unexpectedly, restart cycle (max 3 in 5 min)

**Health endpoint:** `GET http://127.0.0.1:<port>/health` → `{ "ok": true }`

## Error Reporting

Bridge errors are logged to stderr with full context (stack trace, SDK error cause, request payload). Only the sanitized message crosses the relay to iPhone.

**Pattern:**
```js
console.error("[remodex:opencode-sdk] session.create failed:", error.cause || error);
sendApplicationResponse(createJsonRpcErrorResponse(requestId, domainError));
```
