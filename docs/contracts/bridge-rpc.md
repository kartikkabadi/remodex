# Bridge JSON-RPC Contract

The Remodex bridge handles encrypted JSON-RPC messages from the iPhone. Every method falls into one of four routing categories.

## Routing Categories

| Category | Description | Examples |
|----------|-------------|----------|
| `bridge-local` | Handled entirely in bridge.js, never forwarded to any agent | `git/*`, `workspace/*`, `desktop/*`, `project/*`, `pet/*`, `voice/transcribe` |
| `router` | Intercepted by `runtime-provider-router.js`, dispatched to Codex app-server or OpenCode SDK based on thread ownership or explicit `modelProvider` field | `model/list`, `thread/list`, `thread/start`, `thread/read`, `turn/start`, `turn/interrupt`, `runtime/catalog` |
| `passthrough` | Forwarded to Codex app-server unchanged after stripping provider fields | `turn/steer`, `turn/fork`, `account/login/start`, `account/logout` |
| `bridge-managed` | Bridge synthesizes response from local state without forwarding | `initialize`, `account/status/read`, `desktop/preferences/read` |

## Handler Cascade Order

In `bridge.js:handleApplicationMessage()`, handlers run in this fixed order. A handler that matches returns `true` and consumes the message. Order is load-bearing — insert new OpenCode bridge-local handlers **before** the runtime provider router (position 12), not at the end.

1. Bridge-managed handshake/account (`initialize`, `account/status/read`, `voice/resolveAuth`)
2. Voice handler (`voice/transcribe`)
3. Thread context handler (`thread/contextWindow/read` — Codex rollout or OpenCode fork; see below)
4. OpenCode session usage handler (`session/getUsageStats` — OpenCode-owned threads only)
5. Workspace handler (`workspace/*`)
6. OpenCode project discover handler (`project/discover`)
7. Project handler (`project/*`)
8. Pet handler (`pet/*`)
9. Notifications handler (`notifications/push/register`)
10. Desktop handler (`desktop/*`)
11. Git handler (`git/*`)
12. **Runtime provider router** (`model/list`, `thread/list`, `thread/*`, `turn/*`, `runtime/catalog`, `command/*`, `skills/list`)
13. Desktop refresher (observes thread/turn — does not consume)
14. Rollout live mirror (observes — does not consume)
15. IPC action follower (observes — may consume)
16. Thread turns list handler (JSONL fallback)
17. **Passthrough** — strip provider fields, forward to Codex app-server

## Method Reference

### model/list

**Routing:** `router` — merged Codex + OpenCode models

**Params:**
```
{ cursor?: string, limit?: number }
```
All fields optional. Omit for first page.

**Result:**
```json
{
  "items": [
    {
      "id": "openai/gpt-5.5",
      "model": "openai/gpt-5.5",
      "modelProvider": "opencode",
      "provider": "opencode",
      "upstreamProviderId": "openai",
      "upstreamProviderDisplayName": "OpenAI",
      "displayName": "GPT-5.5",
      "description": "OpenAI GPT-5.5 model",
      "isDefault": false,
      "capabilities": {
        "supportsAgentSelection": true,
        "supportsReasoningEffort": false,
        "supportsFastMode": false,
        "supportsPlanMode": false,
        "supportsVoice": false,
        "supportsDesktopHandoff": false,
        "supportsWorktree": false,
        "supportsFork": true,
        "supportsApprovals": true,
        "supportsStreamingTools": true,
        "supportsSlashCommands": true,
        "supportsSlashCommandExecute": true,
        "supportsMCP": false,
        "supportsSkillAutocomplete": true,
        "supportsStructuredSkillInput": false,
        "supportsSteer": false,
        "supportsQueue": true
      }
    }
  ],
  "nextCursor": null
}
```

**Routing behavior:** Bridge fetches Codex models via `codex.send("model/list")`, fetches OpenCode models via `provider.listModels()`, merges both arrays into `items`, adds `modelProvider` and `capabilities` fields to every model. Codex models always come first.

**`modelProvider` values:** `"codex"`, `"opencode"`, or future provider IDs.

**`upstreamProviderId`:** For OpenCode models only — the underlying provider (e.g. `"anthropic"`, `"openai"`, `"google"`). For Codex models this field is absent.

### thread/list

**Routing:** `router` — merged Codex + OpenCode threads

**Params:**
```
{ cursor?: string, limit?: number, includeArchived?: boolean }
```

**Result:**
```json
{
  "data": [
    {
      "id": "thread-abc-123",
      "title": "Fix login bug",
      "name": "Fix login bug",
      "model": "gpt-5.5",
      "modelProvider": "codex",
      "createdAt": "2026-05-30T12:00:00.000Z",
      "updatedAt": "2026-05-30T12:05:00.000Z"
    },
    {
      "id": "opencode-thread-1717000000-a1b2c3",
      "title": "OpenCode chat",
      "name": "OpenCode chat",
      "model": "openai/gpt-5.5",
      "modelProvider": "opencode",
      "provider": "opencode",
      "createdAt": "2026-05-30T12:10:00.000Z",
      "updatedAt": "2026-05-30T12:10:00.000Z",
      "metadata": {
        "provider": "opencode"
      }
    }
  ],
  "nextCursor": null
}
```

**Routing behavior:** Merged from Codex `thread/list` + OpenCode `provider.listThreads()`. Provider threads only included on first page (no cursor). Deduplicated by thread ID. Sorted by `updatedAt` descending. Provider-owned threads carry `modelProvider` and `metadata.provider` fields for sidebar badges.

#### Class (e) externally discovered OpenCode sessions

When `REMODEX_OPENCODE_DISCOVER_SESSIONS=1`, the bridge calls SDK `session.list` (metadata-only; no `getMessages` on the hot path) and merges **class (e)** rows into the OpenCode leg of `thread/list`:

| Property | Value |
|----------|-------|
| Thread ID | `opencode-session-{sessionId}` (deterministic) |
| Ownership | **None** until explicit user open |
| `metadata.discoveredExternally` | `true` |
| `metadata.sessionId` | serve-native session ID |
| `modelProvider` | `opencode` |
| `cwd` | `session.location.directory` when present |
| Archived | **Excluded** when `time.archived` is set |
| Child sessions | **Excluded** when `parentID` is set |
| Inclusion signal | Non-empty `title` OR `time.updated` OR `time.created` |
| List-time dedup | Omit stub when the same `sessionId` is already owned under `opencode-thread-*` |

**Adopt boundary (IQ-1):** `thread/read` and `thread/resume` share the same OpenCode handler and call `adoptDiscoveredSession()` **only** on explicit user open. `turn/start` and `requireThread` **never** adopt — pre-adopt `turn/start` returns `thread_not_found`. iOS background sync must skip `discoveredExternally` rows (see `CodexService+Sync.swift` §6.5 guard).

**Example class (e) row:**
```json
{
  "id": "opencode-session-ses_mac_cli_01",
  "title": "Refactor auth module",
  "name": "Refactor auth module",
  "model": "openai/gpt-5.5",
  "modelProvider": "opencode",
  "provider": "opencode",
  "cwd": "/Users/me/project",
  "createdAt": "2026-06-08T10:00:00.000Z",
  "updatedAt": "2026-06-08T10:05:00.000Z",
  "metadata": {
    "provider": "opencode",
    "discoveredExternally": true,
    "sessionId": "ses_mac_cli_01"
  }
}
```

#### `thread/list` discovery flags and SLOs

Phased rollout uses dual env feature flags (both default **`0`** on the Mac until device matrix O18–O20 passes). The **Remodex iOS app** sends `discoverOpenCodeSessions` / `discoverOpenCodeProjects: true` on every `thread/list` poll when the user has not opted out (`openCodeExternalDiscoveryEnabled`, default **on**). Bridge policy honors client params when env is unset; env `=0` hard-kills; env `=1` enables without client params.

| Env knob | Default | Purpose |
|----------|---------|---------|
| `REMODEX_OPENCODE_DISCOVER_SESSIONS` | `0` → `1` to enable | Merge class (e) rows from SDK `session.list` on each `thread/list` |
| `REMODEX_OPENCODE_DISCOVER_PROJECTS` | `0` → `1` to enable | Fire-and-forget `project/discover` on `thread/list` (debounced) |
| `REMODEX_LIST_THREADS_DISCOVER_CAP` | `30` | Max discovered session rows per poll (after filter/sort) |
| `REMODEX_OPENCODE_DISCOVER_TTL_MS` | `60000` | TTL cache for discovered session metadata |
| `REMODEX_OPENCODE_DISCOVER_PROJECT_TTL_MS` | `120000` | Debounce hot-path `project/discover` |
| `REMODEX_OPENCODE_ENSURE_STARTED_MS` | `4000` | Cap blocking `ensureStarted` on discover path |
| `REMODEX_LIST_THREADS_VALIDATE_CAP` | `20` | Owned stub validation budget only — **not** shared with discover |

**Wall-clock SLOs** (iOS foreground poll every **10s**; secure transport per-message timeout **12s**):

| Metric | Budget | Notes |
|--------|--------|-------|
| `thread/list` p95 (discover flags on, cache hit) | **< 3s** | Steady-state poll |
| `thread/list` p95 (discover flags on, cache miss) | **< 8s** | O18 contract case; 4s headroom under 12s timeout |
| `thread/list` p99 (any) | **< 11s** | Must not exceed transport timeout |
| `ensureStarted` on discover path | **< 4s** | On timeout: serve stale discovery cache + schedule async refresh |

Router runs Codex `thread/list` and OpenCode `provider.listThreads()` **in parallel** (`Promise.all`), mirroring `model/list`. Each leg has an independent race budget; Codex failures are isolated via `.catch()` and return an empty `data` array.

| Env knob | Default | Purpose |
|----------|---------|---------|
| `REMODEX_THREAD_LIST_CODEX_BUDGET_MS` | `10000` | Cap blocking Codex leg |
| `REMODEX_THREAD_LIST_OPENCODE_BUDGET_MS` | `10000` | Cap blocking OpenCode leg |

**Telemetry** (JSON logs per `thread/list` response):

| Event | Fields | Meaning |
|-------|--------|---------|
| `thread_list_codex_ms` | `ms` | Codex leg wall time |
| `thread_list_opencode_ms` | `ms` | OpenCode leg wall time (0 when paginated with cursor) |
| `thread_list_wall_ms` | `wallMs`, `codexMs`, `opencodeMs`, `discoverProjectsEnabled` | End-to-end merge time |

See also `docs/operations/performance-limits.md`.

When `REMODEX_OPENCODE_DISCOVER_PROJECTS=1`, `maybeDiscoverOpenCodeProjects` runs fire-and-forget after merge (TTL 120s, non-blocking); response is never blocked by slow `project.list`.

**Cold-serve / first-poll:** If `ensureStarted` exceeds `REMODEX_OPENCODE_ENSURE_STARTED_MS`, return immediately with last-known discovered rows (TTL may be expired) + owned threads; log `discover_refresh_async`. O18 “≤10s visible” accepts **second poll** on cold serve; first poll must not block >12s.

**Codex regression:** `REMODEX_DISABLE_OPENCODE=1` omits OpenCode provider leg entirely — no session discover, no hot-path project discover.

### thread/start

**Routing:** `router` — dispatched by `modelProvider` field

**Params (Codex):**
```json
{
  "model": "gpt-5.5",
  "cwd": "/path/to/project",
  "serviceTier": "default",
  "title": "Optional title"
}
```

**Params (OpenCode):**
```json
{
  "modelProvider": "opencode",
  "model": "openai/gpt-5.5",
  "agent": "build",
  "cwd": "/path/to/project",
  "title": "Optional title"
}
```

**Result:**
```json
{
  "thread": {
    "id": "opencode-thread-1717000000-a1b2c3",
    "title": "OpenCode chat",
    "name": "OpenCode chat",
    "model": "openai/gpt-5.5",
    "modelProvider": "opencode",
    "cwd": "/path/to/project",
    "createdAt": "2026-05-30T12:00:00.000Z",
    "updatedAt": "2026-05-30T12:00:00.000Z"
  }
}
```

**Routing behavior:** Bridge reads `modelProvider` from params. If `"opencode"` → routes to OpenCode provider (creates thread in memory, records ownership, does NOT create session). If absent or `"codex"` → forwards to Codex app-server (strips provider fields first). Thread ownership is written to `~/.remodex/thread-ownership.json`.

### thread/read

**Routing:** `router` — dispatched by thread ownership

**Params:**
```json
{
  "threadId": "opencode-thread-1717000000-a1b2c3",
  "includeTurns": false
}
```

**Result:** Same shape as `thread/start` result, plus optional `turns` array if `includeTurns: true`.

**Routing behavior:** Router reads `thread-ownership.json` to determine which provider owns the thread. Dispatches to that provider's `handleRequest`.

### thread/archive, thread/unarchive

**Routing:** `router` — dispatched by thread ownership

**Params:** `{ threadId: string }`
**Result:** `{ thread: ThreadObject }` with updated `archived` state.

### thread/name/set

**Routing:** `router` — dispatched by thread ownership

**Params:** `{ threadId: string, name: string }`
**Result:** `{ thread: ThreadObject }` with updated `title`/`name`.

### turn/start

**Routing:** `router` — dispatched by thread ownership

**Params (OpenCode):**
```json
{
  "threadId": "opencode-thread-1717000000-a1b2c3",
  "model": "openai/gpt-5.5",
  "agent": "build",
  "effort": "high",
  "input": [
    { "type": "text", "text": "Fix the login bug in auth.ts" }
  ]
}
```

**Result:**
```json
{
  "turnId": "opencode-turn-1717001000-d4e5f6",
  "turn": {
    "id": "opencode-turn-1717001000-d4e5f6",
    "threadId": "opencode-thread-1717000000-a1b2c3",
    "status": "running"
  }
}
```

**Streamed events (notifications, no request ID):**

| Notification method | When | Params |
|---------------------|------|--------|
| `turn/started` | Turn begins executing | `{ threadId, turnId, turn: { id, status } }` |
| `item/reasoning/textDelta` | Thinking/reasoning chunk | `{ threadId, turnId, itemId, delta, item: { id, type, turnId } }` |
| `item/agentMessage/delta` | Assistant text chunk | `{ threadId, turnId, itemId, delta, assistantPhase, item: { id, type, phase } }` |
| `item/toolCall` | Tool invocation started | `{ threadId, turnId, itemId, toolName, status: "pending" }` |
| `item/toolCallUpdate` | Tool result/error | `{ threadId, turnId, itemId, status: "completed"|"failed" }` |
| `item/completed` | Assistant message final | `{ threadId, turnId, itemId, message, assistantPhase, item: { id, type, phase, text } }` |
| `turn/completed` | Turn finished | `{ threadId, turnId, status: "completed"|"failed"|"stopped", turn: { id, status } }` |
| `runtime/catalog/updated` | OpenCode provider inventory fingerprint changed | `{ catalogRevision: string, providerInventoryPartial?: boolean }` |

**Routing behavior:** Router reads thread ownership. For OpenCode: creates session if first turn, calls `client.session.prompt()`, subscribes to `client.event.subscribe()`, maps SDK events to notification types above. For Codex: strips provider fields, forwards to app-server.

### turn/interrupt

**Routing:** `router` — dispatched by thread ownership

**Params:** `{ threadId: string, turnId?: string }`
**Result:** `{ success: true, interrupted: true|false }`

**For OpenCode:** Calls `client.session.abort()` then emits `turn/completed` with status `"stopped"`.

### permission/request

**Routing:** bridge → iPhone notification (no request id). Emitted by `opencode-provider.js` when OpenCode SDK surfaces `permission.asked`.

**Params:**
```json
{
  "permissionId": "perm-abc123",
  "threadId": "opencode-thread-…",
  "turnId": "opencode-turn-…",
  "sessionId": "ses-…",
  "tool": "bash",
  "argsSummary": "command=*** note=safe",
  "cwd": "/Users/me/project",
  "requestedAt": "2026-06-08T12:00:00.000Z"
}
```

**Notes:**
- Raw `args` are **not** forwarded to iPhone — only `argsSummary` (redacted/truncated) for the permission sheet.
- When `REMODEX_OPENCODE_PERMISSIONS_UI=0`, the bridge auto-denies via watchdog without emitting this notification.
- Outbound relay also feeds `pushNotificationTracker` → relay `POST /v1/push/session/notify-permission` when push is configured.

### permission/reply

**Routing:** `router` — top-level (not in `ROUTABLE_THREAD_METHODS` ownership list); handled by `opencode-provider.permissionReply` via `runtime-provider-router.js`.

**Params:**
```json
{
  "permissionId": "perm-abc123",
  "threadId": "opencode-thread-…",
  "sessionId": "ses-…",
  "allow": true,
  "scope": "once"
}
```

`permission_id` is accepted as a snake_case alias. `scope` may be `"once"` or `"session"` (in-memory grant for this bridge process only).

**Result (success):**
```json
{
  "success": true,
  "permissionId": "perm-abc123",
  "allow": true,
  "scope": "once"
}
```

**Routing behavior:** Bridge validates `permissionId` against `pendingPermissions` before calling SDK `replyToPermission`. Unknown, expired, or mismatched `threadId`/`sessionId` replies are rejected.

**Errors:**

| errorCode | When |
|-----------|------|
| `permission_id_required` | `permissionId` omitted |
| `permission_unknown` | `permissionId` not in `pendingPermissions` |
| `permission_thread_mismatch` | `threadId` does not match pending entry |
| `permission_session_mismatch` | `sessionId` does not match pending entry |
| `opencode_permission_denied` | SDK reply failed or auto-deny watchdog fired |

### thread/turns/list

**Routing:** `router` — dispatched by thread ownership

**Params:** `{ threadId: string, limit?: number, cursor?: string, sortDirection?: "asc"|"desc" }`
**Result:** `{ data: TurnObject[], nextCursor: string|null }`

**For OpenCode:** Calls `client.session.messages({ sessionID })` and converts messages to TurnObject shape. If session doesn't exist (first turn not sent yet), returns empty data.

**For Codex:** Forwards to app-server with JSONL fallback for empty results.

### runtime/catalog

**Routing:** `router` — synthesized by bridge

**Params:** None (or empty object)

**Result:**
```json
{
  "runtimes": [
    {
      "id": "codex",
      "label": "Codex",
      "enabled": true,
      "unavailableReason": null,
      "reasonCode": null,
      "agents": [],
      "capabilities": {
        "supportsAgentSelection": false,
        "supportsReasoningEffort": true,
        "supportsFastMode": true,
        "supportsPlanMode": true,
        "supportsVoice": true,
        "supportsDesktopHandoff": true,
        "supportsWorktree": true,
        "supportsFork": true,
        "supportsApprovals": true,
        "supportsStreamingTools": true,
        "supportsSlashCommands": true,
        "supportsSlashCommandExecute": false,
        "supportsMCP": true,
        "supportsSkillAutocomplete": true,
        "supportsStructuredSkillInput": true,
        "supportsSteer": true,
        "supportsQueue": true
      }
    },
    {
      "id": "opencode",
      "label": "OpenCode",
      "enabled": true,
      "showsBetaLabel": true,
      "unavailableReason": null,
      "reasonCode": null,
      "agents": [
        { "id": "build", "label": "Build" },
        { "id": "plan", "label": "Plan" }
      ],
      "capabilities": {
        "supportsAgentSelection": true,
        "supportsReasoningEffort": false,
        "supportsFastMode": false,
        "supportsPlanMode": false,
        "supportsVoice": false,
        "supportsDesktopHandoff": false,
        "supportsWorktree": false,
        "supportsFork": true,
        "supportsApprovals": true,
        "supportsStreamingTools": true,
        "supportsSlashCommands": true,
        "supportsSlashCommandExecute": true,
        "supportsMCP": false,
        "supportsSkillAutocomplete": true,
        "supportsStructuredSkillInput": false,
        "supportsSteer": false,
        "supportsQueue": true
      }
    }
  ]
}
```

**OpenCode `opencode` block (nested under the `opencode` runtime row):** includes live provider inventory fields from `getRuntimeStatus()` plus:

| Field | Type | Notes |
|-------|------|-------|
| `catalogRevision` | string | Fingerprint token `fp:…` derived from inventory auth/connection state; changes when provider inventory warms or auth discovery completes |

Warm inventory before catalog snapshot is controlled by `REMODEX_CATALOG_WARM_INVENTORY` (default `1`). When the fingerprint changes, the bridge emits `runtime/catalog/updated` (see streamed events table).

### OpenCode runtime enablement

OpenCode is **on by default**. Disable for Codex-only regression with `REMODEX_DISABLE_OPENCODE=1` (or `true`). Legacy opt-out: `REMODEX_ENABLE_OPENCODE=0` (or `false`). See `opencode-runtime-policy.js` and `docs/architecture/002-capability-model.md`.

When disabled (`REMODEX_DISABLE_OPENCODE=1` or legacy `REMODEX_ENABLE_OPENCODE=0`), `buildCatalogOpenCodeRuntime()` returns `null` and OpenCode is **omitted** from `runtimes[]` — the catalog is Codex-only. No `reasonCode` is emitted for disable; iOS sees only Codex in the runtime picker (see `opencode-regression.test.js` “runtime catalog excludes opencode when flag is off”).

**`reasonCode`** (structured, optional per runtime): machine-readable companion to `unavailableReason`. iOS switches on this field instead of substring-matching human copy. Only present when the runtime row exists in the catalog.

| Value | When |
|-------|------|
| `null` | Runtime is available (or Codex, which is always available) |
| `"opencode_not_enabled"` | OpenCode is advertised in catalog but not enabled (OpenCode provider not registered, or `opencode` command missing on PATH) — not used when `REMODEX_DISABLE_OPENCODE` is set |
| `"opencode_agents_unavailable"` | OpenCode is registered but `listAgents()` failed |
| `"opencode_server_failed"` | `opencode serve` could not start or health check failed (see catalog builder) |

**When OpenCode is advertised but unavailable** (default router with `providers: []`, missing binary, or provider not registered — OpenCode row still in catalog):
- `enabled: false`
- `reasonCode: "opencode_not_enabled"` (or `"opencode_agents_unavailable"` / `"opencode_server_failed"` per table above)
- `unavailableReason`: human-readable explanation (exact string may vary)
- `agents: []`

### command/list

**Routing:** `router` — handled in `runtime-provider-router.js`, never forwarded to Codex

**Params:**
```
{ directory?: string, cwd?: string }
```
Optional project directory for slash-command discovery. `directory` is preferred; `cwd` is an alias. When omitted, the bridge uses its process `cwd`.

**Result:**
```json
{
  "commands": [
    {
      "token": "/build",
      "title": "Build",
      "description": "Build the project",
      "requiresArguments": false
    },
    {
      "token": "/init",
      "title": "Init",
      "description": "guided AGENTS.md setup",
      "requiresArguments": true,
      "template": "Focus:\n$ARGUMENTS",
      "hints": ["$ARGUMENTS"],
      "source": "command"
    }
  ]
}
```

**Routing behavior:** Router calls `opencodeProvider.listCommands(directory)` when the OpenCode harness is registered. Otherwise returns `{ commands: [] }`. Does not consult thread ownership and does not call the Codex app-server.

**OpenCode-only notes:** Requires OpenCode runtime not disabled (`REMODEX_DISABLE_OPENCODE` unset) and a running `opencode serve` instance (`ensureStarted`). On startup failure or SDK errors, the provider returns an empty array (warnings are logged on the bridge). Commands come from the SDK `command.list` query scoped to `directory`. iOS OpenCode threads load commands via `command/list` (`CodexService+SlashCommands`, `TurnViewModel.loadBridgeSlashCommandsIfNeeded`); Codex threads keep the hardcoded slash enum only.

Static CLI builtins from `buildStaticSlashCommands()` include **`requiresArguments: false`** so zero-arg commands (e.g. `/skills`, `/clear`) can be sent immediately without an arguments sheet.

### command/execute

**Routing:** `router` — handled in `runtime-provider-router.js`, never forwarded to Codex

**Params:**
```json
{
  "threadId": "opencode-thread-1717000000-a1b2c3",
  "command": "/skills",
  "arguments": "",
  "argumentFields": [{ "key": "$ARGUMENTS", "value": "user text" }],
  "template": "Focus:\n$ARGUMENTS",
  "hints": ["$ARGUMENTS"],
  "clientCommandId": "550e8400-e29b-41d4-a716-446655440000",
  "directory": "/path/to/project",
  "cwd": "/path/to/project"
}
```

`thread_id` and `id` are accepted aliases for `threadId`. `command` may include a leading `/`; the bridge strips it for OpenCode SDK `session.command` (`command: "skills"`). `arguments` is optional (defaults to `""`) for zero-arg commands (PR5a). **PR5b:** when `argumentFields` is non-empty, the bridge runs `serializeCommandArguments({ template, hints, fields })` and passes the resulting single string to SDK `session.command.arguments` (PM-1; mirrors `session/prompt.ts`). `template` and `hints` may be omitted when the allowlisted `command/list` row already carries them. `clientCommandId` is optional (iOS UUID per tap); when present, the bridge drops duplicate executes for the same `threadId + commandToken + clientCommandId` within **5s** and logs `opencode_command_execute_deduped`. `directory` / `cwd` scope allowlist discovery; when omitted, the owned thread's `cwd` is used.

**Result (success):**
```json
{ "ok": true, "sessionId": "ses_abc123", "deduped": false }
```

Duplicate within dedupe window:
```json
{ "ok": true, "sessionId": "ses_abc123", "deduped": true }
```

**Result (OpenCode unavailable — provider not registered or disabled):**
```json
{ "ok": false, "errorCode": "opencode_unavailable" }
```

**Routing behavior:** `resolveThreadOwnershipMismatch` runs before the OpenCode provider (same as `turn/start`). When the OpenCode harness is registered, `opencodeProvider.commandExecute` validates the command against `listCommands(directory)`, ensures a session (`createSession` on first use), calls SDK `session.command`, sets `userStartedInProcess` on success, and logs `opencode_command_execute` (`commandToken`, `commandSdk`, `ok`, `errorCode`).

**Errors (OpenCode provider):**

| errorCode | When |
|-----------|------|
| `thread_not_found` | Unknown `threadId` |
| `thread_provider_mismatch` | Explicit provider field conflicts with ownership store |
| `command_required` | Missing `command` |
| `command_arguments_required` | Command requires input but `argumentFields` / `arguments` missing |
| `command_not_allowed` | Token not in allowlist for `directory` |
| `opencode_session_expired` | SDK session missing/404 |
| `opencode_server_unreachable` | SDK client unavailable |
| `opencode_turn_failed` | SDK `session.command` failed |

**Capability:** `supportsSlashCommandExecute` (17th catalog flag) — `true` for OpenCode, `false` for Codex. Distinct from `supportsSlashCommands` (list/autocomplete visibility).

### skills/list

**Routing:** `router` — merges Codex app-server skills with OpenCode `app.skills()` when the harness is registered

**Params:**
```
{ cwds?: string[], cwd?: string, forceReload?: boolean }
```

**Result:** Same shapes as Codex app-server — bucketed `{ data: [{ cwd, skills: [...] }] }` or flat `{ skills: [...] }`. Each skill includes `name`, `description`, `path`, `scope`, `enabled`, `provider` (primary), and `providers` (all contributing runtimes).

**Example skill entry (cross-provider overlap):**
```json
{
  "name": "review",
  "description": "Code review skill",
  "path": "/path/to/.agents/skills/review/SKILL.md",
  "scope": "project",
  "enabled": true,
  "provider": "codex",
  "providers": ["codex", "opencode"]
}
```

**Merge behavior:** For each `cwd`, Codex and OpenCode skills are merged with `mergeSkillsAcrossProviders`: dedupe key is `name.trim().toLowerCase()` (case-folded); enabled entries win; `provider` is the primary runtime via `resolvePrimaryProvider` (prefers `codex` when both contribute); `providers` lists every contributing runtime id (sorted). The flat `{ skills: [...] }` response shape uses the same cross-provider merge (not per-bucket concatenation). OpenCode skills are omitted when `app.skills` is unavailable or returns empty.

**OpenCode-only notes:** When `REMODEX_ENABLE_OPENCODE` is set and the OpenCode provider is registered, `listOpenCodeSkillsBuckets` calls `opencodeProvider.listSkills(cwd)` per requested cwd (defaulting to `process.cwd()` when none are supplied). SDK failures return empty buckets with a bridge warning; Codex buckets are still returned.

**Structured turn input (OpenCode `turn/start`):** iOS may send `input` items with `type: "skill"` (`id`, optional `name`, optional `path`) when `supportsStructuredSkillInput` is true on `runtime/catalog`. The bridge maps each skill to an OpenCode `session.prompt` **file** part (`mime: text/markdown`, `url: file://…`, `filename: name`) when `path` is present, or a **text** part (`$skillName`) when only the name/id is known. User text and `@mention` items are mapped to text/file parts respectively. This is separate from `supportsSkillAutocomplete` (composer `$` autocomplete only).

### thread/fork

**Routing:** `router` — dispatched by thread ownership (OpenCode-owned threads); Codex-owned threads fall through to `passthrough`

**Params:**
```json
{
  "threadId": "opencode-thread-1717000000-a1b2c3"
}
```
`thread_id` and `id` are accepted aliases. iOS may also send `excludeTurns` for Codex; the OpenCode provider ignores unknown fields.

**Result (OpenCode):**
```json
{
  "thread": {
    "id": "opencode-thread-1717002000-f6g7h8",
    "title": "OpenCode chat",
    "name": "OpenCode chat",
    "model": "openai/gpt-5.5",
    "modelProvider": "opencode",
    "provider": "opencode",
    "agent": "build",
    "cwd": "/path/to/project",
    "createdAt": "2026-05-30T12:20:00.000Z",
    "updatedAt": "2026-05-30T12:20:00.000Z",
    "metadata": { "provider": "opencode" }
  }
}
```

**Routing behavior:** Router reads `thread-ownership.json` via `providerForRequest`. OpenCode-owned `threadId` → `opencode-provider` `threadFork` (SDK `session.fork`, then `thread/start` with the new `sessionId`, preserving `model`, `agent`, and `cwd`). Codex-owned threads are not handled by the router; the request is stripped of provider fields and forwarded to the Codex app-server unchanged.

**OpenCode-only notes:** The source thread must already have a persisted OpenCode `sessionId` (created on the first successful `turn/start`). Forking a thread that was only created via `thread/start` fails with `opencode_fork_requires_session`. The new thread gets a fresh `opencode-thread-*` id and ownership entry; the source thread is unchanged. Capability flag `supportsFork` on `runtime/catalog` gates the composer UI — Codex threads use native Codex fork semantics via passthrough.

**Errors (OpenCode):**

| errorCode | When |
|-----------|------|
| `thread_not_found` | `threadId` is unknown to the OpenCode provider |
| `opencode_fork_requires_session` | Source thread has no `sessionId` yet |
| `opencode_server_unreachable` | `opencode serve` could not be reached for `session.fork` |

### session/getUsageStats

**Routing:** `bridge-local` with an ownership fork — handled by `opencode-session-usage-handler.js` at cascade position **4**, before workspace/project handlers and **before** the runtime provider router.

**Purpose:** Return live OpenCode session token counters for the context-window ring on iPhone. Codex-owned threads do **not** use this method; they use `thread/contextWindow/read` (rollout JSONL).

#### Routing fork (maintainers)

| Thread ownership | iOS caller | Bridge handler | Data source |
|----------------|------------|----------------|-------------|
| `opencode` | `CodexService+Status.refreshOpenCodeContextWindowUsage` → `session/getUsageStats` | `handleOpenCodeSessionUsageRequest` (cascade #4) | `opencode-provider.getUsageStatsForThread` → SDK `session.get` + `mapOpenCodeSessionToContextUsage` |
| `opencode` | Legacy/alternate: `thread/contextWindow/read` | `handleThreadContextRequest` (cascade #3) **forks** to the same `sessionGetUsageStats` helper when `ownershipStore.ownsThread(threadId, "opencode")` | Same OpenCode session stats |
| `codex` | `CodexService+Status.refreshContextWindowUsage` → `thread/contextWindow/read` | `handleThreadContextRequest` (cascade #3) | Local Codex rollout via `readLatestContextWindowUsage` |
| `codex` | `session/getUsageStats` | Handler still matches method name but returns `wrong_provider` error | N/A — iOS must not call this for Codex threads |

**Why two entry points for OpenCode usage:** iOS prefers the dedicated `session/getUsageStats` RPC for OpenCode threads. `thread/contextWindow/read` remains compatible and delegates to the same `sessionGetUsageStats` implementation when ownership is `opencode`, so older clients and status-sheet fallbacks stay aligned.

**Params:**
```json
{ "threadId": "opencode-thread-1717000000-a1b2c3" }
```

**Result (success):**
```json
{
  "threadId": "opencode-thread-1717000000-a1b2c3",
  "sessionId": "ses_abc123",
  "usage": { "tokensUsed": 1650, "tokenLimit": 128000 },
  "source": "opencode"
}
```

**Errors:**

| errorCode | When |
|-----------|------|
| `missing_thread_id` | `threadId` omitted |
| `wrong_provider` | Thread not owned by `opencode` |
| `opencode_disabled` | `REMODEX_DISABLE_OPENCODE=1` |
| `opencode_unavailable` | OpenCode provider not registered |
| `session_usage_failed` | SDK/session lookup failed |

**Push path:** After OpenCode turns, `opencode-provider.pushThreadUsageUpdate` may emit `thread/tokenUsage/updated` with the same `usage` shape (no request id).

### runtime/auth/error

**Routing:** bridge → iPhone notification (no request id). Emitted by `opencode-auth-error-handler.js` when OpenCode surfaces a structured `ProviderAuthError`.

**Params:**
```json
{
  "providerID": "anthropic",
  "providerId": "anthropic",
  "threadId": "opencode-thread-…",
  "turnId": "opencode-turn-…",
  "message": "Re-authenticate on your Mac.",
  "errorCode": "provider_auth_error",
  "source": "turn_failed"
}
```

Detection uses structured fields (`name`, `errorCode`, `providerID`, HTTP 401/403 with provider id) — not loose message substring matching. See ADR-005.

### Bridge-Local Methods

These methods are handled by bridge.js handlers and never reach any agent:

| Method | Handler | Purpose |
|--------|---------|---------|
| `git/status` | `git-handler.js` | Branch status, diff, tracking info |
| `git/commit` | `git-handler.js` | Commit staged changes |
| `git/push` | `git-handler.js` | Push to remote |
| `git/pull` | `git-handler.js` | Pull from remote |
| `git/branches` | `git-handler.js` | List branches |
| `git/checkout` | `git-handler.js` | Switch branches |
| `git/createBranch` | `git-handler.js` | Create and switch |
| `git/log` | `git-handler.js` | Recent commits |
| `git/stash` | `git-handler.js` | Stash working changes |
| `git/stashPop` | `git-handler.js` | Pop latest stash |
| `git/resetToRemote` | `git-handler.js` | Hard reset to remote |
| `git/remoteUrl` | `git-handler.js` | Get remote URL |
| `workspace/readImage` | `workspace-handler.js` | Read image file |
| `workspace/readFile` | `workspace-handler.js` | Read text file |
| `workspace/revertPatchPreview` | `workspace-handler.js` | Preview patch revert |
| `workspace/revertPatchApply` | `workspace-handler.js` | Apply patch revert |
| `project/list` | `project-handler.js` | List project folders |
| `project/directory` | `project-handler.js` | Browse directories |
| `pet/list` | `pet-handler.js` | List Codex pets |
| `desktop/continueOnMac` | `desktop-handler.js` | Hand off to Codex.app |
| `desktop/continueOpenCode` | `desktop-handler.js` | Hand off OpenCode-owned thread to Mac (TUI + optional desktop app) |
| `desktop/wakeDisplay` | `desktop-handler.js` | Wake Mac display |
| `desktop/preferences/read` | `desktop-handler.js` | Read bridge prefs |
| `voice/transcribe` | `voice-handler.js` | Transcribe audio |
| `session/getUsageStats` | `opencode-session-usage-handler.js` | OpenCode session token usage (owned threads only) |
| `project/discover` | `opencode-project-discover-handler.js` | Discover OpenCode projects into registry (on-demand RPC + hot-path when `REMODEX_OPENCODE_DISCOVER_PROJECTS=1`) |
| `notifications/push/register` | `notifications-handler.js` | Register push token |
| `account/status/read` | `bridge.js` (bridge-managed) | Auth status snapshot |
| `initialize` | `bridge.js` (bridge-managed) | Handshake + version check |

### project/discover

**Routing:** `bridge-local` — `opencode-project-discover-handler.js` (cascade position 6)

**Purpose:** Sync OpenCode `project.list` workspaces into the durable file registry at `~/.codex/remodex/known-projects.json`. Callable on-demand from iOS or invoked fire-and-forget on `thread/list` when `REMODEX_OPENCODE_DISCOVER_PROJECTS=1` (debounced TTL 120s; does not block merge response).

**Params:**
```json
{
  "directory": "/optional/path/to/scope"
}
```
`directory` and `cwd` are aliases. When omitted, discovers all projects visible to the bridge's `opencode serve` instance. When present, `directory` is validated against the home-root allowlist (same policy as `project/listDirectory`) before any SDK call.

**Result (success):**
```json
{
  "projects": [
    {
      "id": "proj_abc",
      "path": "/Users/me/my-app",
      "name": "my-app"
    }
  ],
  "source": "opencode",
  "count": 1
}
```

**Result (OpenCode disabled):**
```json
{
  "projects": [],
  "source": "opencode",
  "disabled": true
}
```

**Routing behavior:** Calls `opencodeProvider.discoverProjects()`. Allowlisted paths are written via `projectRegistry.rememberProjectPath` (`source: opencode-project-discover`). iOS `project/knownProjects` reads the same file registry (PR-1). Hot-path discover on `thread/list` logs `opencode_discover_on_list` and respects `REMODEX_OPENCODE_DISCOVER_PROJECT_TTL_MS`.

**Errors:**

| errorCode | When |
|-----------|------|
| `opencode_unavailable` | OpenCode provider not registered or `discoverProjects` missing |
| `path_not_allowed` | `directory` outside home-root allowlist |
| `project_discover_failed` | Generic SDK/registry failure |

Skipped when `REMODEX_DISABLE_OPENCODE=1`.

## Error Response Shape

Every error across all methods uses this shape:

```json
{
  "id": "<request-id>",
  "error": {
    "code": -32000,
    "message": "Human-readable description for the iOS user",
    "data": {
      "errorCode": "snake_case_code",
      "sdkMessage": "Optional: raw diagnostic message (never shown on iPhone)",
      "minVersion": "Optional: minimum required version"
    }
  }
}
```

### Example: `thread_provider_mismatch` (ownership enforcement)
From `resolveThreadOwnershipMismatch` (router:190) + `createJsonRpcErrorResponse` (router:663 / bridge:970 dupe; see taste/bridge.md note):
```json
// Example: thread_provider_mismatch (from resolveThreadOwnershipMismatch + createJsonRpcErrorResponse)
{
  "id": "req-123",
  "error": {
    "code": -32000,
    "message": "This chat is tied to codex. Start a new chat to switch providers.",
    "data": { "errorCode": "thread_provider_mismatch" }
  }
}
```
(Note: userMessage surfaces in top-level "message"; data.errorCode for iOS routing. Cross-ref ADR-005, router:452 for construction, respondAsync:228.)

## Error Codes

| errorCode | Meaning | iOS Action |
|-----------|---------|------------|
| `opencode_not_installed` | `opencode` binary not found on PATH | Show install instructions |
| `opencode_version_too_old` | Installed version below minimum | Show upgrade instructions with minVersion |
| `opencode_server_failed` | `opencode serve` wouldn't start | Show generic error + "check terminal" hint |
| `opencode_server_not_healthy` | Server started but health check fails | Retry or suggest restart |
| `opencode_sdk_error` | SDK call failed (generic) | Show error message, log details on bridge |
| `opencode_timeout` | SDK call timed out | Retry or suggest bridge restart |
| `opencode_input_required` | Turn started with empty prompt | Show inline validation message |
| `opencode_session_expired` | Session lost on server restart | Automatically retry with new session |
| `thread_not_found` | Thread ID doesn't exist | Show "Thread not found" |
| `thread_turn_active` | Turn already running on this thread | Show "A turn is already running" |
| `thread_provider_mismatch` | Cannot switch runtime mid-thread (ownership durable; explicit modelProvider or ownsThread check failed) | Show "This thread uses a different runtime" (exact code from router:452 + respondAsync; also surfaced as -32000 in createJsonRpcErrorResponse at router:663/bridge:970) |
| `runtime_provider_failed` | Generic provider failure | Show error, log details |
| `unsupported_opencode_method` | RPC method not implemented for OpenCode | Show "Feature not available for OpenCode" |
| `ios_app_update_required` | iOS app version too old for bridge | Show App Store update prompt |
| `bridge_update_failed` | Bridge self-update failed | Show error with suggested manual command |
| `auth_status_failed` | Account status read failed | Show degraded state |

### desktop/continueOpenCode

**Routing:** `bridge-local` — `desktop-handler.js` delegates to `opencode-handoff.js`. macOS only.

**Env gate:** Requires `REMODEX_OPENCODE_HANDOFF=1` (or `true`). When unset/`0`/`false`, returns `opencode_handoff_disabled` with no success payload.

**Params:**
```json
{
  "threadId": "opencode-thread-1717000000-a1b2c3",
  "sessionId": "ses_abc123",
  "directory": "/path/to/project",
  "preferDesktopApp": true
}
```

**Result:**
```json
{
  "success": true,
  "threadId": "opencode-thread-1717000000-a1b2c3",
  "sessionId": "ses_abc123",
  "cwd": "/path/to/project",
  "model": "anthropic/claude-sonnet-4-5",
  "agent": "build",
  "title": "Mobile thread",
  "handoffMode": "tui",
  "sessionSelected": true,
  "desktopAppInstalled": true,
  "instructions": "Session selected in OpenCode TUI. Run `opencode` in Terminal if needed."
}
```

| `handoffMode` | Meaning |
|---------------|---------|
| `tui` | `tui.selectSession` succeeded |
| `desktop_app` | Desktop app launched; `sessionSelected` may be `false` when no deep link |
| `tui_only` | No desktop app; CLI/TUI instructions only |

**Errors:**

| errorCode | When |
|-----------|------|
| `opencode_handoff_disabled` | `REMODEX_OPENCODE_HANDOFF` not enabled |
| `wrong_provider` | Thread not owned by `opencode` |
| `missing_thread_id` | `threadId` omitted or empty |
| `thread_not_found` | Unknown thread or rehydrate failed |
| `invalid_thread_id` | Fails desktop thread id pattern |
| `opencode_session_expired` | Missing or stale `sessionId` |
| `opencode_server_unreachable` | OpenCode provider unavailable |
| `unsupported_platform` | Non-macOS bridge |

## OpenCode Threads — Desktop/Phone Split

OpenCode threads do NOT participate in Codex desktop features:
- `CodexDesktopRefresher` skips OpenCode threads
- `desktop-ipc-action-follower` skips OpenCode threads
- JSONL rollout mirroring skips OpenCode threads
- `DesktopHandoffService` shows "Hand off unavailable for OpenCode threads"
- `desktop/continueOnMac` returns error for OpenCode threads (use `desktop/continueOpenCode` instead)
