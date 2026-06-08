# Performance limits (Remodex bridge + iOS)

Operational SLOs and env knobs for hot-path RPC latency. Full contract detail lives in [`docs/contracts/bridge-rpc.md`](../contracts/bridge-rpc.md). Telemetry cross-reference: [`observability.md`](observability.md) § `thread/list`.

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

### Owned stub validation cache (PR 5)

| Knob | Default | Purpose |
|------|---------|---------|
| `REMODEX_LIST_THREADS_VALIDATE_CACHE_TTL_MS` | `60000` | TTL for cached `getSession` / `getMessages(limit:1)` validation results per `sessionId` |

`thread/list` response `meta.materializationBlocked` surfaces rows omitted by the validation cap or anti-ghost policy (bridge log: `opencode_list_threads_filtered.materialization_blocked`).

## `model/list`

See `REMODEX_MODEL_LIST_OPENCODE_BUDGET_MS` and `CODEX_MODEL_LIST_BUDGET_MS` in `runtime-provider-router.js`.

## Regression

`REMODEX_DISABLE_OPENCODE=1` must match Codex-only `thread/list` (no OpenCode leg, no hot-path project discover) even when iOS sends `discoverOpenCodeSessions` / `discoverOpenCodeProjects`.