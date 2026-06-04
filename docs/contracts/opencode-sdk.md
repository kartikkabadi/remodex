# OpenCode SDK Usage

This document specifies exactly how the Remodex bridge uses `@opencode-ai/sdk/v2` to communicate with OpenCode. It is the implementation guide for the `opencode-server.js` and `opencode-client.js` bridge modules.

## Transport: `opencode serve` HTTP

The bridge spawns OpenCode as a child process:

```bash
opencode serve --hostname=127.0.0.1 --port=<dynamic>
```

The bridge manages lifecycle: spawn, health check, shutdown.

### Server Lifecycle

1. **Spawn:** `child_process.spawn("opencode", ["serve", "--hostname=127.0.0.1", "--port", port])`
2. **Port detection:** Parse stdout for `"opencode server listening on http://127.0.0.1:<port>"` to get the actual port
3. **Health check:** `GET http://127.0.0.1:<port>/health` — expect `{ "ok": true }` + optional `{ "version": "1.15.12" }`
4. **Ready:** Bridge creates `OpencodeClient` pointing at the confirmed URL
5. **Shutdown:** SIGTERM → wait 5s → SIGKILL

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `REMODEX_OPENCODE_PORT` | auto (4200-4300) | Explicit port for `opencode serve` |
| `REMODEX_OPENCODE_COMMAND` | `"opencode"` | Override binary path |
| `REMODEX_DIAGNOSTICS` | `0` | Enable verbose SDK logging when `"1"` |

### Timeouts

| Operation | Timeout |
|-----------|---------|
| Server start | 15 seconds |
| Health check | 5 seconds |
| SDK request | 90 seconds |
| Graceful shutdown | 5 seconds |

## SDK Client Creation

```js
const { createOpencodeClient } = require("@opencode-ai/sdk/v2");

const client = createOpencodeClient({
  baseUrl: "http://127.0.0.1:4291",
  // No auth token — local loopback only
});
```

The bridge creates ONE client per `opencode serve` process and reuses it across all threads.

## SDK Methods Used

### Model Discovery: `client.provider.list()`

```
GET /provider/list

→ ProviderListResponse:
{
  providers: [
    {
      id: "openai",
      name: "OpenAI",
      models: [
        { id: "gpt-5.5", name: "GPT-5.5", contextWindow: 128000, ... },
        { id: "gpt-5.5-mini", name: "GPT-5.5 Mini", ... }
      ]
    },
    {
      id: "anthropic",
      name: "Anthropic",
      models: [
        { id: "claude-opus-4-7", name: "Claude Opus 4.7", ... },
        { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", ... }
      ]
    }
  ]
}
```

**Bridge flattens this into ModelOption[]:**
```js
providers.flatMap(p => p.models.map(m => ({
  id: `${p.id}/${m.id}`,
  model: `${p.id}/${m.id}`,
  modelProvider: "opencode",
  upstreamProviderId: p.id,
  upstreamProviderDisplayName: formatProviderName(p.name),
  displayName: m.name || modelDisplayName(m.id),
  description: m.description || "",
  isDefault: m.isDefault || false,
  capabilities: resolveModelCapabilities("opencode", { ... }),
})));
```

**Caching:** 60-second TTL. Cache is invalidated on bridge restart.

### Agent Discovery: `client.app.agents()`

```
GET /app/agents

→ Agent[]
[
  { id: "build", name: "Build", description: "Full-access coding agent" },
  { id: "plan", name: "Plan", description: "Read-only planning agent" }
]
```

**Caching:** 120-second TTL. Agent lists change rarely (only when user edits opencode config).

### Session Creation: `client.session.create()`

```
POST /session/create
Body: { directory: "/path/to/project" }

→ { sessionID: "ses_abc123" }
```

**Bridge records:** `opencode-sessions.json` maps threadId → sessionId.

**Called at:** first `turn/start` for a thread, not at `thread/start`.

### Session Resume: `client.session.get()`

```
POST /session/get
Body: { sessionID: "ses_abc123" }

→ Session object with sessionID, directory, messages
```

**Called at:** bridge restart to rehydrate existing sessions from `opencode-sessions.json`.

**Error handling:** If `sessionID` is no longer valid (server restarted, session expired), create a new session and update the mapping.

### Turn Execution: `client.session.prompt()`

```
POST /session/{sessionID}/prompt?directory=/path/to/project
Body: {
  parts: [
    { "type": "text", "text": "Please review this change" },
    {
      "type": "file",
      "mime": "text/markdown",
      "url": "file:///path/to/project/.agents/skills/review/SKILL.md",
      "filename": "review"
    }
  ]
}

→ { info, parts }    // Returns immediately; streaming via events
```

The SDK requires a `parts` array (`TextPartInput`, `FilePartInput`, `AgentPartInput`, or `SubtaskPartInput`). The bridge no longer sends a bare string `prompt` field.

**Structured skills from iOS (`turn/start` input items):**

**Capability gate:** iOS emits `type: "skill"` input items only when `supportsStructuredSkillInput` is `true` on `runtime/catalog` / `model/list` for that thread's provider. OpenCode catalog sets this flag to `false` (gated pending upstream SDK support for `skills:[]` in prompt input; see RP-SKILL-3 verification below); the bridge still maps skill items when present (future flag flip or Codex passthrough) and now includes `skills[]` conditionally.

| iOS / Codex input item | Bridge → OpenCode `parts` |
|------------------------|---------------------------|
| `{ type: "text", text: "…" }` | `{ type: "text", text: "…" }` |
| `{ type: "skill", id, name?, path? }` with `path` | `{ type: "file", mime: "text/markdown", url: file://…, filename: name\|id }` |
| `{ type: "skill", … }` without `path` | `{ type: "text", text: "$name" }` (text fallback) |
| `{ type: "mention", name, path }` | `{ type: "file", mime: "text/plain", url: file://…, filename: name }` |
| Image attachment items | `{ type: "file", … }` when a path/URL is present, else `[image attached]` text placeholder |

Skill-only turns include a minimal leading `{ type: "text", text: " " }` part so the SDK always receives at least one text part alongside skill file attachments.

**RP-SKILL-3 structured skills payload (PR14):** As of this PR, when iOS sends structured `type: "skill"` items in `turn/start` input (gated by `supportsStructuredSkillInput` cap from catalog), the bridge (in `buildPromptFromTurnInput` + `turnStart` + `client.prompt`) now *conditionally* populates a top-level `skills: [{id, name?, path?}, ...]` array in the `session.prompt()` body passed to SDK (in addition to the mapped `parts`). This is the "skills[] in turn/start payload".

**SDK support verification (must precede any flag flip):** Inspected vendored `repos/opencode/packages/opencode/src/session/prompt.ts` (PromptInput schema: only parts union of Text/File/Agent/Subtask; no skills), `acp-next/service.ts` (list only), installed+vendored SDK v2 `dist/v2/gen/types.gen.d.ts` + `gen/types.gen.ts` (SessionPromptData / V2SessionPromptData body has no `skills`; `Prompt` type = `{text, files?, agents?, references?}`; app.skills is list-only at /skill; no `skill` part discriminator). Runtime test: dynamic import of @opencode-ai/sdk/v2 succeeded, no evidence of skills array acceptance in prompt shape. Thus, per master design + PR plan: **OPENCODE_CAPABILITIES.supportsStructuredSkillInput remains `false`** (iOS will not emit structured skill items for OC threads; falls back to legacy $name text in input); "gated pending upstream". Do not force. When upstream SDK adds `skills` support in prompt (or skill part), re-verify (client.app.skills + structured attempt), flip flag in provider-capabilities.js, update this note + tests, run full gates. Codex regression under DISABLE_OPENCODE=1 unaffected (no OC path).

**Bridge subscribes to events BEFORE calling prompt** to avoid missing early events.

**Prompt-time session config (Session2):** Bridge passes model, agent, and optional variant on a single `session.prompt()` call. `session.setConfig` is **not** used (removed from SDK Session2).

```js
client.session.prompt({
  sessionID,
  directory,
  model: { providerID: "opencode-go", modelID: "deepseek-v4-flash" },
  agent: "build",
  variant: "max", // optional; only when effort matches a catalog variant key (KD-9)
  parts: [...],
});
```

### Event Streaming: `client.event.subscribe()`

```
Async iterable of events:
for await (const event of client.event.subscribe()) {
  // event.type determines dispatch
}
```

**Event types and their bridge notification mapping:**

| SDK Event Type | Bridge Notification Method | Key Fields |
|----------------|---------------------------|------------|
| `turn.started` | `turn/started` | `turnID`, `sessionID` |
| `message.part.added` | (internal tracking) | `partID`, `type`, `messageID` |
| `message.part.delta` (text) | `item/agentMessage/delta` | `delta`, `partID`, `turnID` |
| `message.part.delta` (reasoning) | `item/reasoning/textDelta` | `delta`, `partID` |
| `message.part.updated` (tool start) | `item/toolCall` | `toolName`, `toolCallID`, `status: "pending"` |
| `message.part.updated` (tool result) | `item/toolCallUpdate` | `toolCallID`, `status: "completed"` |
| `message.part.updated` (tool error) | `item/toolCallUpdate` | `toolCallID`, `status: "failed"` |
| `message.completed` | `item/completed` | `message`, `turnID` |
| `turn.completed` | `turn/completed` | `turnID`, `status` |
| `permission.asked` | `permission/request` | `requestID`, `tool`, `args` |

**Completion detection:** When `turn.completed` event arrives, the turn is done. The bridge emits `turn/completed` to iOS and tears down the turn's event subscription.

**Error in stream:** If the event stream errors or closes before `turn.completed`, the bridge emits `turn/completed` with `status: "failed"` and the error message.

### Session Abort: `client.session.abort()`

```
POST /session/abort
Body: { sessionID: "ses_abc123" }

→ { success: true }
```

**Called at:** `turn/interrupt` RPC from iPhone.

### Message History: `client.session.messages()`

```
POST /session/messages
Body: { sessionID: "ses_abc123" }

→ { messages: Message[] }
```

**Bridge converts messages to TurnObject[]:**
- Groups messages by turn
- Extracts user messages, assistant messages, tool calls
- Returns `{ data: TurnObject[], nextCursor: null }`

**Called at:** `thread/turns/list` RPC from iPhone.

### Permission Reply: `client.permission.reply()`

```
POST /permission/reply
Body: { requestID: "perm_abc", reply: { allow: true } }

→ { success: true }
```

**Called at:** When iOS user approves/rejects a permission request.

**Access mode mapping:**
- iOS "Full access" mode: auto-reply `allow: true` to all permission requests
- iOS "On-Request" mode: forward to phone, wait for user reply

### Question Reply: `client.question.reply()`

```
POST /question/reply
Body: { requestID: "q_abc", answers: [...] }

→ { success: true }
```

**Called at:** When iOS user answers a question from the agent.

## Event Subscription Management

The bridge creates one event subscription per active turn. When a turn completes (or is interrupted, or errors), the subscription is closed:

```js
const subscription = client.event.subscribe(); // returns { unsubscribe() }

for await (const event of subscription) {
  if (event.type === "turn.completed") {
    subscription.unsubscribe();
    break;
  }
  // ... handle event
}
```

**Multiple concurrent turns:** Each turn gets its own subscription. Events carry `sessionID` for routing.

## Error Handling

All SDK calls are wrapped in try/catch. The wrapper translates SDK errors into domain errors:

```js
try {
  return await client.session.create({ directory });
} catch (error) {
  if (error.code === "ECONNREFUSED") {
    throw openCodeError("opencode_server_not_healthy", "OpenCode server is not responding.");
  }
  throw openCodeError("opencode_sdk_error", error.message, error);
}
```

## SSE: `session.next.*` (Phase 2)

Newer OpenCode servers emit `session.next.text.delta`, `session.next.tool.called`, `session.next.reasoning.delta`, and related events (including `.1` suffix variants). The bridge `opencode-client.js` maps these to Remodex timeline methods:

| OpenCode event | Bridge method |
|----------------|---------------|
| `session.next.text.delta` | `item/agentMessage/delta` |
| `session.next.text.ended` | `item/agentMessage/delta` + `item/completed` |
| `session.next.reasoning.delta` | `item/reasoning/textDelta` |
| `session.next.tool.called` | `item/toolCall` |
| `session.next.tool.progress` / `success` | `item/toolCallUpdate` |
| `session.idle` | `turn/completed` (deduped in provider if turn already completed) |

Legacy `message.part.*` events remain supported.

## Multimodal honesty (Phase 2)

When the iOS composer has a local file path, `buildPromptFromTurnInput` sends `{ type: "file", url: file://... }` parts. Without a path, a text placeholder is sent. The composer greys out photo/camera attach on OpenCode threads until device E2E verifies multimodal.

## Plugin discovery (Phase 2 spike — PR19a)

- OpenCode SDK exposes `app.agents`, `app.skills`, and `command.list` — **no** `plugin/list` RPC equivalent to Codex `plugin/list`.
- Remodex does not synthesize Codex plugin metadata for OpenCode threads.
- iOS `@plugin` autocomplete is disabled when `runtimeModelProviderForTurn` is `opencode`.
- Future: if OpenCode adds `app.plugins` or similar, bridge can add a merge path; until then, `supportsPluginMentions` stays UI-gated by provider identity (not a 16th catalog flag).

## Provider auth probe (Phase 2)

`runtime/catalog` → `runtimes[].opencode.authConfigured`:
- `true` when `provider.list().connected` is non-empty after server start
- `false` when list succeeds but nothing is connected
- `null` when the probe cannot run (server down or SDK error)

## Reference Implementation

dpcode's `apps/server/src/provider/Layers/OpenCodeAdapter.ts` is the reference for all SDK usage patterns. The Remodex bridge adapts these patterns to CommonJS without Effect-TS dependency injection.

Key differences from dpcode:
- dpcode uses Effect-TS `.provide()` for DI; Remodex uses closure-based injection
- dpcode spawns one server per project; Remodex shares one server across all threads
- dpcode uses TypeScript; Remodex uses plain CommonJS
- dpcode has per-message session creation; Remodex has lazy per-thread session creation
