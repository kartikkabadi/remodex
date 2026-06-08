# Performance limits (Remodex bridge + iOS)

Operational SLOs and env knobs for hot-path RPC latency. Full contract detail lives in [`docs/contracts/bridge-rpc.md`](../contracts/bridge-rpc.md).

## `thread/list`

| Metric | Budget | Notes |
|--------|--------|-------|
| Wall (`thread_list_wall_ms`) p95 cache hit | **< 3s** | Steady-state sidebar poll |
| Wall p95 cache miss (discover on) | **< 8s** | O18 contract case |
| Wall p99 (any) | **< 11s** | Must stay under 12s secure-transport timeout |
| Codex leg (`thread_list_codex_ms`) | `REMODEX_THREAD_LIST_CODEX_BUDGET_MS` (default **10s**) | Per-leg race budget |
| OpenCode leg (`thread_list_opencode_ms`) | `REMODEX_THREAD_LIST_OPENCODE_BUDGET_MS` (default **10s**) | Per-leg race budget |
| `ensureStarted` on discover / owned wake | `REMODEX_OPENCODE_ENSURE_STARTED_MS` (default **4s**) | On timeout: stale discovery cache + async refresh |

Router runs Codex and OpenCode legs in **parallel** (`Promise.all`). Leg telemetry is emitted as `thread_list_codex_ms`, `thread_list_opencode_ms`, and `thread_list_wall_ms`.

## `model/list`

See `REMODEX_MODEL_LIST_OPENCODE_BUDGET_MS` and `CODEX_MODEL_LIST_BUDGET_MS` in `runtime-provider-router.js`.

## Regression

`REMODEX_DISABLE_OPENCODE=1` must match Codex-only `thread/list` (no OpenCode leg, no hot-path project discover).