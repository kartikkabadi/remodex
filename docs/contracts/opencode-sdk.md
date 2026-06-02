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

| iOS / Codex input item | Bridge → OpenCode `parts` |
|------------------------|---------------------------|
| `{ type: "text", text: "…" }` | `{ type: "text", text: "…" }` |
| `{ type: "skill", id, name?, path? }` with `path` | `{ type: "file", mime: "text/markdown", url: file://…, filename: name\|id }` |
| `{ type: "skill", … }` without `path` | `{ type: "text", text: "$name" }` (text fallback) |
| `{ type: "mention", name, path }` | `{ type: "file", mime: "text/plain", url: file://…, filename: name }` |
| Image attachment items | `{ type: "file", … }` when a path/URL is present, else `[image attached]` text placeholder |

Skill-only turns include a minimal leading `{ type: "text", text: " " }` part so the SDK always receives at least one text part alongside skill file attachments.

**Bridge subscribes to events BEFORE calling prompt** to avoid missing early events.

**Config before prompt:** Bridge calls these before `prompt()`:
- `client.session.setConfig({ sessionID, configId: "model", value: "openai/gpt-5.5" })`
- `client.session.setConfig({ sessionID, configId: "mode", value: "build" })`
- `client.session.setConfig({ sessionID, configId: "effort", value: "high" })` (if reasoning supported)

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

## Reference Implementation

dpcode's `apps/server/src/provider/Layers/OpenCodeAdapter.ts` is the reference for all SDK usage patterns. The Remodex bridge adapts these patterns to CommonJS without Effect-TS dependency injection.

Key differences from dpcode:
- dpcode uses Effect-TS `.provide()` for DI; Remodex uses closure-based injection
- dpcode spawns one server per project; Remodex shares one server across all threads
- dpcode uses TypeScript; Remodex uses plain CommonJS
- dpcode has per-message session creation; Remodex has lazy per-thread session creation
