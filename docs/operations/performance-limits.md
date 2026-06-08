# Performance limits (Remodex bridge + iOS + relay)

Operational SLOs and env knobs for hot-path RPC latency, secure-transport buffering, and relay scale headroom. Full contract detail lives in [`docs/contracts/bridge-rpc.md`](../contracts/bridge-rpc.md). Telemetry cross-reference: [`observability.md`](observability.md).

## `thread/list`

| Metric | Budget | Notes |
|--------|--------|-------|
| Wall (`thread_list_wall_ms`) p95 cache hit | **< 3s** | Steady-state sidebar poll |
| Wall p95 cache miss (discover on) | **< 8s** | O18 contract case |
| Wall p99 (any) | **< 11s** | Must stay under 12s secure-transport timeout |
| Codex leg (`thread_list_codex_ms`) | `REMODEX_THREAD_LIST_CODEX_BUDGET_MS` (default **10s**, max **11s**) | Per-leg race budget |
| OpenCode leg (`thread_list_opencode_ms`) | `REMODEX_THREAD_LIST_OPENCODE_BUDGET_MS` (default **10s**, max **11s**) | Per-leg race budget |
| `ensureStarted` on discover / owned wake | `REMODEX_OPENCODE_ENSURE_STARTED_MS` (default **4s**) | On timeout: stale discovery cache + degraded owned stubs |

Router runs Codex and OpenCode legs in **parallel** (`Promise.all`). Leg telemetry is emitted as `thread_list_codex_ms`, `thread_list_opencode_ms`, and `thread_list_wall_ms`.

### Stacked caps inside the OpenCode leg

The single OpenCode leg budget races the entire `provider.listThreads()` call. Inside that call, owned-thread wake (`ensureStartedWithCap`, ≤4s) and session discover wake (`ensureStartedWithDiscoverCap`, ≤4s) stack with `listSessions` and SDK validation. Production leg budgets default to **10s** (clamped to **11s** max) so cold discover paths stay under the 12s transport timeout when Codex and OpenCode run in parallel.

On leg budget timeout, the router logs `thread_list_leg_abandoned` and returns the fallback (`{ data: [] }` for that leg). Concurrent polls coalesce per-provider `listThreads` via in-flight dedupe. OpenCode discovery refresh shares one in-flight mutex inside `refreshDiscoveredSessionsCache`.

### Owned stub validation (PR 5 + PR 13)

| Knob | Default | Purpose |
|------|---------|---------|
| `REMODEX_LIST_THREADS_VALIDATE_CAP` | `20` | Max SDK `getSession` / `getMessages(limit:1)` validations per poll |
| `REMODEX_LIST_THREADS_VALIDATE_CACHE_TTL_MS` | `60000` | TTL for cached validation results per `sessionId` |
| `REMODEX_VALIDATION_RPC_LIMIT_PER_MIN` | `120` | Global token bucket for validation RPCs (all paths) |

`thread/list` response `meta.materializationBlocked` surfaces rows omitted by the validation cap, rate limit, or anti-ghost policy (bridge log: `opencode_list_threads_filtered.materialization_blocked`). When `materialization_blocked` or startup prune count **> 50** in one poll, bridge logs `opencode_prune_ops_hint` with `node phodex-bridge/scripts/prune-opencode-ownership.js --apply`.

## Cold-serve / turn wake (PR 13)

| Knob | Default | Purpose |
|------|---------|---------|
| `REMODEX_OPENCODE_SERVE_WAKE_MS` | `8000` | Cap blocking `ensureStarted` on `turn/start` and other serve wakes |
| `REMODEX_OPENCODE_ENSURE_STARTED_MS` | `4000` | Cap blocking `ensureStarted` on `thread/list` / discover paths only |

Post-idle turn start target: **p95 < 8s** serve wake. `turn/started` is emitted only after serve wake succeeds (`opencode_turn_started_after_wake`).

## Secure transport outbound buffer

Bridge-side E2EE catch-up buffer (`secure-transport.js`). iOS persists `lastAppliedBridgeOutboundSeq`; `trusted_reconnect` replays missed entries.

| Constant / knob | Default | Purpose |
|-----------------|---------|---------|
| `MAX_BRIDGE_OUTBOUND_MESSAGES` | `100` | Message count cap before priority trim |
| `MAX_BRIDGE_OUTBOUND_BYTES` | `10 MiB` | Byte cap before priority trim |
| `REMODEX_BRIDGE_OUTBOUND_CAP` | `100` | Override message count cap |
| `REMODEX_BRIDGE_OUTBOUND_RECENT_TURNS` | `2` | Recent turns whose lifecycle + stream entries are protected |
| `REMODEX_BRIDGE_PRIORITY_OUTBOUND` | `1` | Priority-tier trim (default on); `0` → legacy FIFO |
| `REMODEX_BRIDGE_OUTBOUND_LEGACY_TRIM` | `0` | Force legacy FIFO trim |

**Priority tiers** (lower number = higher retention): `LIFECYCLE` (0) → `STREAM` (1) → `NOTIFY` (2) → `RPC_RESPONSE` (3) → `TOOL` (4). `turn/started`, `turn/completed`, and `item/completed` are protected during reconnect storms; RPC responses drop first under pressure.

**Acceptance:** `bridge_outbound_dropped` should be **zero** during normal turns; non-zero only under forced cap tests or prolonged relay disconnect during heavy streaming.

## Relay scale bounds (FP-12 interim)

Horizontal relay sharding is **deferred post-TestFlight** (OQ-8). Until then, self-hosted relay operators should plan for these interim bounds:

| Dimension | Interim bound | Notes |
|-----------|---------------|-------|
| Concurrent bridge sessions | **500** | One in-memory `sessions` entry per paired Mac↔mobile room (`relay.js`) |
| Push fan-out p95 | **< 3s** at **1k** registered devices | Assumes single relay process + configured APNs credentials |
| HTTP rate limits (`server.js`) | 120/min general, 60/min WS upgrade, 30/min push | Per-client fixed window |
| Mac absence grace | **15s** | Mobile sockets held during brief Mac flap (`MAC_ABSENCE_GRACE_MS`) |
| Heartbeat interval | **30s** | Terminate when pong missing (`REMODEX_RELAY_MESSAGE_LIVENESS=0` disables message-liveness diagnostics) |

**Per-Mac bridge baseline:** ~6–10 RPCs/min idle; validation ceiling **400 RPCs/min** theoretical (capped at **120/min** by token bucket); **15s** cold-start tax on first post-idle turn without warm serve.

## `model/list`

Router runs Codex and OpenCode legs in **parallel** (`Promise.all`), mirroring `thread/list`.

| Metric / knob | Budget | Notes |
|---------------|--------|-------|
| Codex leg | `CODEX_MODEL_LIST_BUDGET_MS` (**3s** internal) | `.catch()` → `{ items: [] }` |
| OpenCode leg | `REMODEX_MODEL_LIST_OPENCODE_BUDGET_MS` (default cold-serve sum) | On timeout → `[]` for OpenCode models |
| `full: true` sheet | `REMODEX_MODEL_LIST_OPENCODE_FULL_BUDGET_MS` (**15s**) | Lazy All Models sheet only |
| Wall p95 (warm picker) | **< 3s** | First-page model picker |
| Wall p95 (`full: true`) | **< 8s** | All Models sheet |

Implementation: `runtime-provider-router.js` (`withModelListBudget`, `listProviderModelsForModelList`).

## Test suite duration

`npm test` in `phodex-bridge` should complete in **~60s** on a modern Mac at ~800 tests (OQ-3). CI gate: all green before merge.

## Regression

`REMODEX_DISABLE_OPENCODE=1` must match Codex-only `thread/list` (no OpenCode leg, no hot-path project discover) even when iOS sends `discoverOpenCodeSessions` / `discoverOpenCodeProjects`.

## Security debt (deferred post-TestFlight)

These items do **not** block TestFlight beta given E2EE transport is unchanged (FP-6). Owner sign-off required before production scale.

| ID | Finding | Status | Mitigation path |
|----|---------|--------|-----------------|
| SEC-08 | Ed25519 identity keys stored as plaintext JSON on disk (`secure-device-state.js`) | **Deferred** | Keychain / OS key store migration spike |
| SEC-09 | Push registration state and `notificationSecret` persisted in plaintext (`push-service.js`) | **Deferred** | Encrypt-at-rest for relay push registry |

Accepted for beta: E2EE application payloads remain opaque to relay; only pairing handshake control messages are plaintext on the wire.