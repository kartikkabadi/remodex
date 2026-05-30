# Bridge Code Conventions

How Node.js bridge code is written in `phodex-bridge/`. These conventions are derived from the existing codebase and enforced for all new code.

## Module System

- **Strictly CommonJS** (`"type": "commonjs"` in package.json)
- Use `require()` for all imports, `module.exports = {}` for all exports
- Never use ES module syntax (`import`, `export`, `await` at top level)
- Export grouped objects, not individual functions: `module.exports = { createThing, helperFn }`

**Why:** The bridge spawns as a Node.js child process via `launchd`. CommonJS is the native module system and avoids ES module compatibility issues with `child_process.fork()` and stack traces.

## File Header Convention

Every source file MUST begin with a 5-line comment header:

```js
// FILE: filename.js
// Purpose: One-sentence description of what this file does.
// Layer: Bridge handler | Transport adapter | CLI entry | Persistence helper | Utility
// Exports: comma-separated list of exported function/class names
// Depends on: comma-separated list of required module names
```

**Why:** Grep-able navigation. `grep -r "Exports:" src/` lists every public surface. `grep -r "Depends on: bridge" src/` finds every consumer. The header answers "what does this file do" and "what do I need to understand before reading this file" before reading a single line.

## Naming

| Category | Convention | Example |
|----------|-----------|---------|
| Functions | `camelCase` | `startBridge()`, `handleGitRequest()` |
| Classes | `PascalCase` | `CodexDesktopRefresher`, `OpenCodeProvider` |
| Constants | `UPPER_SNAKE_CASE` | `GIT_TIMEOUT_MS`, `HEALTH_MAX_RESTARTS` |
| Files | `kebab-case` | `git-handler.js`, `secure-transport.js` |
| Factory functions | `create` + PascalCase | `createBridgeSecureTransport()` |
| Handler functions | `handle` + PascalCase | `handleGitRequest()` |
| Boolean functions | `is`/`has` prefix | `isAuthorizedGitHubCli()` |

**Why:** Consistency makes code searchable. `create*` always returns an object with methods. `handle*` always intercepts JSON-RPC. `is*` always returns a boolean. No guessing.

## Factory Pattern with Dependency Injection

Every module that touches I/O uses a factory function:

```js
function createOpenCodeServer({
  env = process.env,
  spawnImpl = require("child_process").spawn,
  logPrefix = "[remodex]",
} = {}) {
  // ...
}
```

- Factory returns an object with named methods (not a class unless state is complex)
- All external dependencies are injectable: `spawnImpl`, `execFileImpl`, `WebSocketImpl`, `env`, `fsImpl`, `platform`, `nowMs`
- Tests inject fakes instead of mocking modules

**Why:** Testability without mocking libraries. Every I/O boundary is a closure parameter. Tests pass fake implementations through the constructor — no jest.mock, no sinon, no proxyquire.

**Anti-pattern:**
```js
// Bad — cannot test without spawning a real process
function startServer() {
  return spawn("opencode", ["serve"]);
}
```

**Pattern:**
```js
// Good — test injects fake spawn
function createServer({ spawnImpl = spawn } = {}) {
  return {
    start() { return new Promise((resolve) => { spawnImpl("opencode", ["serve"]); }); }
  };
}
```

## Error Handling

Each handler module defines its own error constructor:

```js
function gitError(errorCode, userMessage) {
  const err = new Error(userMessage);
  err.errorCode = errorCode;
  return err;
}
```

All errors crossing the relay use this JSON-RPC shape:

```json
{
  "id": "<request-id>",
  "error": {
    "code": -32000,
    "message": "Human-readable string for iOS display",
    "data": { "errorCode": "snake_case_code" }
  }
}
```

**Why:** iOS parses `data.errorCode` to decide recovery actions. The `message` is shown to the user. Error codes use `snake_case` for consistency with JSON conventions.

## Logging

- Use `console.log()`, `console.warn()`, `console.error()` directly — no logging library
- Prefix is `[remodex]`: `console.log("[remodex] Starting bridge...")`
- Components accept `logPrefix` parameter for contextual logging
- Log at boundaries: startup, connection, disconnection, errors, major state transitions
- Never log session IDs or other bearer-like identifiers — redact or hash them

**Why:** Zero-dependency philosophy. The bridge has no devDependencies. Adding a logging library violates "self-contained by default."

## Flat Directory Structure

All source files in `src/` — no subdirectories. The 45 files are organized conceptually by layer:

| Layer | Files | Role |
|-------|-------|------|
| CLI entry | `index.js`, `bridge-status.js` | Export surface |
| Orchestrator | `bridge.js` | Composition root, handler cascade |
| Transport | `codex-transport.js`, `secure-transport.js`, `qr.js` | Process management, E2EE |
| Handlers | `git-handler.js`, `workspace-handler.js`, `desktop-handler.js`, etc. | Mac-local RPC interceptors |
| Desktop | `codex-desktop-refresher.js`, `desktop-ipc-action-follower.js` | Codex.app integration |
| Provider | `opencode-provider.js`, `runtime-provider-router.js`, `opencode-client.js`, `opencode-server.js`, `provider-capabilities.js`, `opencode-models.js`, `thread-ownership-store.js` | Multi-provider routing |
| State | `session-state.js`, `daemon-state.js`, `project-registry.js` | File-backed persistence |

**Why:** Flat directories remove nesting-as-organization. The file header convention provides the layering information. Adding a subdirectory requires justification: "these files change together and have a shared lifecycle."

## Handler Cascade Order

Incoming messages flow through a fixed-order chain in `bridge.js:handleApplicationMessage()`. Each handler returns `true` (consumed) or `false` (pass through). **Order is load-bearing:**

1. Bridge-managed handshake/account
2. Voice handler
3. Thread context handler
4. Workspace handler
5. Project handler
6. Pet handler
7. Notifications handler
8. Desktop handler
9. Git handler
10. Desktop refresher (observes, does not consume)
11. Rollout live mirror (observes, does not consume)
12. IPC action follower (observes, may consume)
13. **Runtime provider router** (insert new OpenCode handlers HERE)
14. Thread turns list handler (JSONL fallback)
15. **Passthrough** — strip provider fields, forward to Codex

**Why:** Handlers early in the chain (git, workspace) must intercept before the router, so bridge-local operations don't get forwarded to the wrong provider. Handlers after the router (turns list, passthrough) are Codex-specific and must not run on OpenCode threads.

**Do NOT:** add handlers to the end of the chain. Insert at the correct position documented above.

## Testing

- **Zero devDependencies** — `node:test` + `node:assert/strict` only
- No Jest, Mocha, Ava, Vitest, Sinon, Chai
- Run: `node --test ./test/*.test.js`
- Every test file defines its own utilities (no shared test helpers directory)
- Three-tier mock pattern: DI overrides → Fake classes → Monkey-patching (last resort)
- Tests verify behavior, not implementation

**Why:** Self-contained by default. Tests run on any Node.js installation. No `npm install` required for testing. Each test file is fully readable without cross-referencing shared helpers.
