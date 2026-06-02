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

In `bridge.js:handleApplicationMessage()`, handlers run in this fixed order. A handler that matches returns true and consumes the message. Order is load-bearing:

1. Bridge-managed handshake/account (initialize, account/status/read, voice/resolveAuth)
2. Voice handler (voice/transcribe)
3. Thread context handler (thread/contextWindow/read)
4. Workspace handler (workspace/*)
5. Project handler (project/*)
6. Pet handler (pet/*)
7. Notifications handler (notifications/push/register)
8. Desktop handler (desktop/*)
9. Git handler (git/*)
10. Desktop refresher (observes thread/turn — does not consume)
11. Rollout live mirror (observes — does not consume)
12. IPC action follower (observes — may consume)
13. **Runtime provider router** (model/list, thread/list, thread/*, turn/*, runtime/catalog)
14. Thread turns list handler (JSONL fallback)
15. **Passthrough** — strip provider fields, forward to Codex

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
        "supportsMCP": true
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

**Routing behavior:** Router reads thread ownership. For OpenCode: creates session if first turn, calls `client.session.prompt()`, subscribes to `client.event.subscribe()`, maps SDK events to notification types above. For Codex: strips provider fields, forwards to app-server.

### turn/interrupt

**Routing:** `router` — dispatched by thread ownership

**Params:** `{ threadId: string, turnId?: string }`
**Result:** `{ success: true, interrupted: true|false }`

**For OpenCode:** Calls `client.session.abort()` then emits `turn/completed` with status `"stopped"`.

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
        "supportsMCP": true,
        "supportsSkillAutocomplete": true,
        "supportsStructuredSkillInput": true,
        "supportsSteer": false,
        "supportsQueue": true
      }
    }
  ]
}
```

**`reasonCode`** (structured, optional per runtime): machine-readable companion to `unavailableReason`. iOS switches on this field instead of substring-matching human copy.

| Value | When |
|-------|------|
| `null` | Runtime is available (or Codex, which is always available) |
| `"opencode_not_enabled"` | `REMODEX_ENABLE_OPENCODE` is not `"1"` or OpenCode command is missing |
| `"opencode_agents_unavailable"` | OpenCode is enabled but `listAgents()` failed |

**When OpenCode is unavailable** (binary missing or `REMODEX_ENABLE_OPENCODE` not set):
- `enabled: false`
- `reasonCode: "opencode_not_enabled"`
- `unavailableReason: "OpenCode is not enabled on this Mac"` (human-readable)
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
      "description": "Build the project"
    }
  ]
}
```

**Routing behavior:** Router calls `opencodeProvider.listCommands(directory)` when the OpenCode harness is registered. Otherwise returns `{ commands: [] }`. Does not consult thread ownership and does not call the Codex app-server.

**OpenCode-only notes:** Requires `REMODEX_ENABLE_OPENCODE` and a running `opencode serve` instance (`ensureStarted`). On startup failure or SDK errors, the provider returns an empty array (warnings are logged on the bridge). Commands come from the SDK `command.list` query scoped to `directory`.

### skills/list

**Routing:** `router` — merges Codex app-server skills with OpenCode `app.skills()` when the harness is registered

**Params:**
```
{ cwds?: string[], cwd?: string, forceReload?: boolean }
```

**Result:** Same shapes as Codex app-server — bucketed `{ data: [{ cwd, skills: [...] }] }` or flat `{ skills: [...] }`. Each skill includes `name`, `description`, `path`, `scope`, `enabled`.

**Merge behavior:** For each `cwd`, Codex skills and OpenCode skills are deduped by `name` (enabled wins). OpenCode skills are omitted when `app.skills` is unavailable or returns empty.

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
| `desktop/continueOpenCode` | `desktop-handler.js` + `runtime-provider-router.js` | Hand off OpenCode-owned thread to Mac (TUI + optional desktop app) |
| `desktop/wakeDisplay` | `desktop-handler.js` | Wake Mac display |
| `desktop/preferences/read` | `desktop-handler.js` | Read bridge prefs |
| `voice/transcribe` | `voice-handler.js` | Transcribe audio |
| `notifications/push/register` | `notifications-handler.js` | Register push token |
| `account/status/read` | `bridge.js` (bridge-managed) | Auth status snapshot |
| `initialize` | `bridge.js` (bridge-managed) | Handshake + version check |

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
| `thread_provider_locked` | Cannot switch runtime mid-thread | Show "This thread uses a different runtime" |
| `runtime_provider_failed` | Generic provider failure | Show error, log details |
| `unsupported_opencode_method` | RPC method not implemented for OpenCode | Show "Feature not available for OpenCode" |
| `ios_app_update_required` | iOS app version too old for bridge | Show App Store update prompt |
| `bridge_update_failed` | Bridge self-update failed | Show error with suggested manual command |
| `auth_status_failed` | Account status read failed | Show degraded state |

### desktop/continueOpenCode

**Routing:** `bridge-local` — `desktop-handler.js` (entry) delegates to `runtime-provider-router.js` / `opencode-handoff.js`. macOS only.

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
