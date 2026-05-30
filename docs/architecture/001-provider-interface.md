# ADR-001: Provider Interface Contract

**Date:** 2026-05-30
**Status:** Accepted

## Context

The Remodex bridge forwards encrypted JSON-RPC messages between the iPhone and a local coding agent. Today it supports only Codex (via `codex app-server`). Adding OpenCode requires a routing layer that dispatches requests to the correct runtime without hardcoding provider-specific checks throughout the codebase.

The bridge's architecture — flat CommonJS modules wired together in `bridge.js` — means we cannot introduce DI containers, plugin systems, or dynamic module loading. The solution must fit the existing pattern: factory functions, dependency injection by closure, and a linear handler cascade.

## Decision

Use a **`ProviderHarness` interface** as the contract between the router and each runtime. Every new runtime implements one file that conforms to this interface, then registers itself via a single call in `bridge.js`.

```js
interface ProviderHarness {
  readonly id: string;                          // e.g. "codex", "opencode"

  ownsThread(threadId: string): boolean;        // Check thread ownership
  listModels(): Promise<ModelOption[]>;         // Provider's available models
  listThreads(params: ThreadListParams): Promise<ThreadListResult>;  // Provider's threads
  listAgents(): Promise<AgentOption[]>;         // Provider's agents (optional)

  handleRequest(request: JsonRpcRequest): Promise<JsonRpcResult>;  // Thread/turn RPC
  handleApplicationResponse(response: JsonRpcResponse): boolean;   // Response dispatch

  shutdown(): Promise<void>;                    // Clean shutdown
}
```

The **`runtime-provider-router.js`** is the single dispatch point. It:
1. Intercepts `model/list`, `thread/list`, `runtime/catalog` — merges results across providers
2. Intercepts thread/turn RPCs — routes by `modelProvider` field or thread ownership lookup
3. Strips provider-specific fields before forwarding to Codex

Adding a new runtime means:
- One new file implementing `ProviderHarness`
- One `create()` call registered in `bridge.js`
- No changes to the router, bridge cascade, or iOS app

## Options Considered

### Option A: Hardcoded Provider Checks (Rejected)

Checking `if (modelProvider === "opencode")` scattered across handlers.

- ✓ Minimal abstraction, zero new files
- ✗ Every new provider touches every handler
- ✗ Cannot test providers in isolation
- ✗ Violates open/closed principle

### Option B: Plugin System / Service Locator (Rejected)

A registry with dynamic module loading, discovery via file scanning, or a DI container.

- ✓ "Pluggable" design
- ✗ Violates "no service locators" invariant
- ✗ Adds hidden wiring that contradicts bridge.js composition root pattern
- ✗ Over-engineered for two providers (Codex + OpenCode)

### Option C: ProviderHarness Interface (Chosen)

A thin interface contract with explicit factory registration.

- ✓ Fits existing factory + DI pattern
- ✓ Testable in isolation (inject fake harness)
- ✓ Simple: one interface, one file per provider
- ✓ Router stays thin — no provider-specific logic

## Consequences

**Easier:**
- New runtimes are additive: one file, one registration, zero router changes
- Tests can inject a fake `ProviderHarness` without starting real processes
- Contract is small enough to document completely in one ADR

**Harder:**
- Router must handle RPC methods that Codex understands but OpenCode doesn't (triggers structured errors)
- Thread list merging requires stable sort and deduplication across providers
- Provider lifecycle (startup/shutdown/restart) differs per runtime — harness must handle its own lifecycle

**What the router does NOT do:**
- Start/stop provider processes (each harness manages its own lifecycle)
- Cache models or threads across providers (each harness caches independently)
- Transform provider shapes into iOS shapes (each harness emits Codex-compatible JSON-RPC)
