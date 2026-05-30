# Target multi-agent architecture for Remodex

Design-level only. Data shapes first (Foundational Thinking, Type System Discipline). Three options where integration is contested, then a recommendation.

## Problem

Remodex hard-wires the Mac bridge to **Codex app-server** JSON-RPC. iOS speaks that dialect over an encrypted relay. Multi-agent means multiple **runtime harnesses** behind the same phone UX, with clear thread ownership and safe fallback to Codex.

## Core data shapes

### RuntimeProviderId

```ts
type RuntimeProviderId = "codex" | "opencode" | string; // extensible, normalized lowercase
```

Normalization matches branch `opencode-models.js`: aliases `open-code`, `model_provider`, `harness`, collaboration settings.

### ThreadOwnership

```ts
type ThreadOwnership = {
  threadId: string;
  provider: RuntimeProviderId;
  providerThreadId?: string;   // e.g. ses_* for OpenCode
  cwd: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
};
```

**Invariant:** `threadId` is stable for the iOS UI. Provider may use a different native id (`providerThreadId`). Registry maps both directions.

### TurnOwnership

```ts
type TurnOwnership = {
  turnId: string;
  threadId: string;
  provider: RuntimeProviderId;
  status: "pending" | "running" | "completed" | "failed" | "interrupted";
};
```

### ProviderHarness (bridge seam)

```ts
interface ProviderHarness {
  readonly id: RuntimeProviderId;

  ownsThread(threadId: string): boolean;

  listModels(): Promise<ModelListResult>;
  listThreads(params: ThreadListParams): Promise<ThreadListResult>;

  handleRequest(req: JsonRpcRequest): Promise<JsonRpcResult | void>;
  handleApplicationResponse(res: JsonRpcResponse): boolean;

  shutdown(): Promise<void>;
}
```

**Boundary discipline:** harnesses parse external CLI/SDK output at the edge. Router and iOS see only Codex-shaped JSON-RPC.

### ProjectRegistryEntry

```ts
type ProjectRegistryEntry = {
  path: string;              // absolute normalized cwd
  displayName?: string;
  lastSeenAt: string;
  sources: Array<"codex-thread-list" | "provider-thread-list" | "manual" | "codex-request">;
};
```

Persisted record (branch uses `known-projects.json` under Codex home `remodex/`).

### RouterDecision

```ts
type RouterDecision =
  | { route: "codex"; strippedRequest: JsonRpcRequest }
  | { route: "provider"; provider: RuntimeProviderId; request: JsonRpcRequest }
  | { route: "handled" }; // merged list, local handler
```

## Target system diagram

```
┌─────────────┐     encrypted      ┌───────┐     encrypted      ┌──────────────────────────────────┐
│ CodexMobile │ ◄──────────────────► │ relay │ ◄──────────────────► │ phodex-bridge                     │
└─────────────┘                      └───────┘                      │  secure-transport                 │
                                                                    │  runtime-provider-router          │
                                                                    │    ├─ CodexHarness (app-server)   │
                                                                    │    ├─ OpenCodeHarness (TBD)       │
                                                                    │    └─ … future                    │
                                                                    │  project-registry                 │
                                                                    │  thread-ownership-store (new)     │
                                                                    └──────────────────────────────────┘
```

## Thread ownership rules

1. **Create:** `thread/start` includes `modelProvider`. Router picks harness. Store `ThreadOwnership` before responding.
2. **Resume:** `thread/resume` / `thread/read` route by `ownsThread()` and registry lookup, not by client guess.
3. **List:** `thread/list` merges with stable sort; each row carries `modelProvider` (branch already does for OpenCode models).
4. **Strict providers:** iOS `strictThreadProviders` includes `opencode` so users cannot switch harness mid-thread (branch policy). Codex threads stay flexible where app-server allows.
5. **Codex desktop mirror:** Only Codex-owned threads participate in rollout mirror / desktop IPC. OpenCode threads must not trigger Codex.app handoff.

## Security and pairing

Unchanged: pairing, trust, and encryption stay in `secure-transport` + relay. Multi-agent does not weaken trust boundaries.

New considerations:

- OpenCode `run` may pass `--dangerously-skip-permissions` when iOS sends skip flag (branch). Must map to Remodex access mode explicitly and default safe.
- Provider subprocess env inherits Mac user secrets. Document that OpenCode sessions share Mac filesystem trust model with Codex.

## Caching and persistence

| Data | Store | TTL / rule |
|------|-------|------------|
| OpenCode models | in-memory | 60s (branch) |
| Thread ownership | JSON file next to registry | durable |
| Project registry | `known-projects.json` | durable |
| Codex JSONL history | existing rollout paths | Codex-only |
| ACP session map | in-memory per harness | process lifetime |

**Separate before serializing shared state:** one `thread-ownership.json` writer in bridge process. Harnesses do not write registry directly.

## Failure modes

| Failure | Behavior |
|---------|----------|
| OpenCode binary missing | `model/list` still shows Codex; OpenCode models empty; `thread/start` with opencode returns structured RPC error |
| `opencode run` nonzero exit | Turn `failed`, notify iOS, do not crash bridge |
| Codex app-server down | Existing reconnect logic; provider threads still list from registry memory |
| Wrong provider on resume | Router returns error, iOS shows thread unavailable |
| Relay disconnect | Existing watchdog; in-flight turns: OpenCode child killed on shutdown |
| Merge list partial failure | Prefer returning Codex data + logged provider error (degrade, not fail whole list) |

## iOS changes (minimal contract)

1. `model/list` displays grouped providers (branch UI).
2. `thread/start` sends `modelProvider` + `model` slug consistent with router.
3. Settings default harness (branch `SettingsRuntimeDefaultsCard`).
4. Thread row shows `RuntimeProviderLogo`.
5. No change to relay pairing flow.

## Integration options (exhaust design space)

### Option A — CLI `opencode run` (branch today)

**Shape:** Subprocess per turn, JSON lines on stdout.

| Pros | Cons |
|------|------|
| Smallest diff, matches branch tests | Weak streaming, tool events, steer/queue parity |
| No long-lived OpenCode process | Cold start latency per turn |
| Easy to mock in Node tests | Session state split between bridge Map and OpenCode disk |

### Option B — ACP stdio (`opencode acp`)

**Shape:** Long-lived child, newline JSON-RPC like Codex app-server.

| Pros | Cons |
|------|------|
| Same bridge transport pattern as Codex | ACP streaming/tool gaps per OpenCode README |
| One process per Mac bridge | Requires new adapter + request/notification mapping layer |
| Closer to Zed/Cursor integration path | More code than Option A |

### Option C — HTTP `opencode serve` + SDK (dpcode style)

**Shape:** Spawn server on loopback, `@opencode-ai/sdk/v2` from bridge.

| Pros | Cons |
|------|------|
| Richest session API, matches OpenCode direction | Heavier lifecycle (port, auth, upgrade) |
| dpcode proves patterns | Pulls async client complexity into bridge |
| Better for future desktop menu bar | Different failure modes (port bind, server crash) |

## Recommendation (reset 2026-05-29)

**OpenCode harness:** **Option B — ACP stdio (`opencode acp`)** as the **primary** integration. Long-lived child matches `codex-transport.js` and Kartik’s full-integration goal.

**Fallback:** **Option A — CLI `opencode run`** only where ACP cannot satisfy a capability (or `REMODEX_OPENCODE_TRANSPORT=cli` for CI/emergency). Catalog must advertise transport and gaps so iOS greys honestly — never silent CLI-only features.

**Codex:** Unchanged — Codex app-server (stdio or WS via existing bridge paths).

**Defer Option C** (`opencode serve` HTTP + SDK) unless Remodex grows a persistent local agent daemon.

**Rationale:** Boundary Discipline — same stdio JSON-RPC pattern as Codex; session-scoped slash/skills/MCP. Branch CLI provider is a **starting artifact**, not the target architecture.

## Upstream vs local integration base

| Concern | Policy |
|---------|--------|
| **This workspace** | Holistic integration from `codex/add-opencode-provider` **or** equivalent merge; **fix forward** here. |
| **Upstream PR** | **Blocked** until Kartik device E2E (Codex regression + OpenCode session + parity matrix). No “open issue first” gate (Emanuele aligned). |
| **Cherry-pick onto `main`** | **Out of scope** for this effort — avoids bitrot and fake partial parity. |
| **Wholesale upstream merge of 197-file branch** | Also not required as one PR; local workspace may carry the integration until sign-off. |

Distinction: **no premature upstream PR** ≠ **avoid branch work**. Use the branch as integration base locally; upstream is a later packaging decision.

## Architectural deepening candidates

See `architecture-review-20260529.html` in temp dir for seam diagrams. Top candidate: extract **ThreadOwnershipStore** so router stops embedding project+thread memory inside `OpenCodeProvider` class.

## Migration from branch

1. **Integration base:** Check out or merge `codex/add-opencode-provider` holistically into `remodex:opencode` workspace — **not** file-by-file cherry-pick onto `main`.
2. **ACP uplift:** Replace CLI-per-turn primary path with `opencode-acp-harness.js`; retain CLI provider as fallback behind env + catalog.
3. **Fix forward:** Resolve conflicts with `main` in place; delete obsolete paths when ACP covers them.
4. Restore `relay/simulated-pairing-reconnect.test.js` if missing after merge.
5. **Durable** `thread-ownership.json` (branch in-memory Map is insufficient).
6. **Catalog + parity matrix** before claiming composer features enabled (see `ux-spec.md` § Capability-driven UI).
