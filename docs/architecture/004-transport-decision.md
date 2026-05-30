# ADR-004: Transport Protocol — OpenCode SDK over ACP stdio

**Date:** 2026-05-30
**Status:** Accepted

## Context

The bridge needs a protocol to communicate with OpenCode. Two options exist:

1. **ACP stdio** (`opencode acp --acp-next`) — JSON-RPC over stdin/stdout, one long-lived child process
2. **HTTP SDK** (`opencode serve`) — HTTP server on loopback port + `@opencode-ai/sdk/v2` JS client

The current bridge code (as of May 2026) uses ACP stdio. But deep analysis of the ACP protocol and the OpenCode codebase reveals significant gaps.

## Decision

Use **`opencode serve` HTTP + `@opencode-ai/sdk/v2`** as the primary transport.

## Options Considered

### Option A: ACP stdio (`opencode acp --acp-next`)

The ACP protocol uses NDJSON framing over stdio. The bridge spawns `opencode acp --acp-next` as a long-lived child process.

| Capability | ACP Status |
|-----------|------------|
| Session creation | `session/new` — works, but creates sessions just to list models |
| Model discovery | `session/new` configOptions — creates bogus session per discovery call |
| Agent discovery | No ACP method — requires separate `opencode agent list` CLI call |
| Turn execution | `session/prompt` — sends prompt but DOES NOT return result synchronously |
| Turn completion | Relies on `session/update` notifications — documented as **incomplete** in OpenCode README |
| Session history | `session/load` — documented as **not restored** in ACP README |
| Message history | No ACP method |
| Permission handling | `request_permission` notification only — no programmatic reply channel |
| Event streaming | `session/update` notifications with named update types — fragile string matching |

ACP also has documented limitations: "no streaming via `session/update` yet, weak `session/load` history, tool call reporting incomplete."

The bridge's current `opencode-provider.js` reflects these gaps: `executeTurn()` calls `session/prompt` and then passively waits for `session/update` notifications that may never arrive. Turn completion has no guarantee.

### Option B: HTTP SDK (`opencode serve` + `@opencode-ai/sdk/v2`)

Start `opencode serve --hostname=127.0.0.1 --port=<dynamic>` as a child process. Create an `OpencodeClient` from the SDK pointing at the HTTP base URL.

| Capability | SDK Status |
|-----------|------------|
| Model discovery | `client.provider.list()` — flat model list, no session needed |
| Agent discovery | `client.app.agents()` — direct agent list |
| Session creation | `client.session.create({ directory })` — returns session with ID |
| Turn execution | `client.session.prompt(input)` — synchronous or async |
| Turn completion | `client.event.subscribe()` — first-class async iterable with ALL events |
| Session resume | `client.session.get({ sessionID })` — full session restore |
| Message history | `client.session.messages({ sessionID })` — complete history |
| Permission handling | `client.permission.reply({ requestID, reply })` — direct reply channel |
| Session abort | `client.session.abort({ sessionID })` |
| Session fork | `client.session.fork({ sessionID })` — post-v1 |

**Proven in production:** dpcode's `OpenCodeAdapter.ts` (3000+ lines) uses this exact pattern and has full test coverage with mocked SDK clients.

### Why ACP Was Dropped

ACP is a simpler protocol in theory (stdio, no HTTP lifecycle). But in practice:
1. Turn completion has no guarantee — this is a critical reliability gap
2. Model discovery creates bogus sessions — wasteful and technically incorrect
3. No message history API — threads lose all history on bridge restart
4. The protocol is documented as incomplete in OpenCode's own README

## Consequences

**Easier:**
- Session persistence across bridge restarts via `session.get()`
- Reliable event streaming with completion guarantees via `event.subscribe()`
- Proper model/agent discovery without session side effects
- Permission handling with direct reply channels
- Message history that survives any bridge lifecycle event

**Harder:**
- Must manage `opencode serve` process lifecycle (spawn, port detection, health check, shutdown)
- Must configure SDK auth (tokenless local mode)
- Heavier dependency footprint (`@opencode-ai/sdk` in bridge's npm deps)
- More code in bridge.js for HTTP lifecycle vs. stdio lifecycle

**Deferred to post-v1:**
- Multi-provider HTTP daemon (shared `opencode serve` serving multiple clients)
- Token-based auth for remote SDK access
- `client.session.fork()` integration

## Reference

dpcode's `apps/server/src/provider/opencodeRuntime.ts` (1090 lines) and `apps/server/src/provider/Layers/OpenCodeAdapter.ts` (3000+ lines) are the reference implementations for this pattern. The Remodex bridge adapts these patterns into CommonJS without Effect-TS.
