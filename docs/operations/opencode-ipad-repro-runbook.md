# OpenCode iPad Repro Runbook (CLASS-A / B / C)

Correlates iPad Remodex OpenCode turns with Mac bridge logs. Design: `docs/design/opencode-ipad-hey-turn-investigation-23b5b552.md`.

## Prerequisites

- Mac bridge + relay running (`repos/remodex-opencode/scripts/remodex-dev-pairing.sh <LAN-IP>`)
- iPad Debug build with `REMODEX_IOS_RPC_TRACE=1` in scheme environment (Debug only)
- Mac log: `/tmp/remodex-local.log`
- Builds: record `git rev-parse HEAD` (bridge) and iPad app build number

## Repro script

1. New OpenCode thread → Zen / Big Pickle
2. Send **Hey**; note wall-clock time
3. Classify: **CLASS-A** (footer only), **CLASS-B** (stuck thinking), **CLASS-C** (thinking → footer)

## Correlated bundle (one run)

| Artifact | Required |
|----------|----------|
| Mac log | `bridge_turn_start_audit`, `bridge_ownership_mismatch`, `bridge_notify_forward`, `opencode_turn_*` with same `threadId`/`turnId` |
| iPad trace | `turn_start_request`, `turn_start_result_*`, `running_snapshot` (Console filter: `com.remodex.codex.rpc-trace`) |
| E2EE seq | `lastAppliedBridgeOutboundSeq` at disconnect; `bridge_outbound_trim_dropped` if any |
| Metadata | `thread.model`, `thread.modelProvider`, `params.modelProvider` on send line |
| Notification | Optional; do not treat push success as chat health |

## H1 PROVEN rule

Requires on same `threadId`:

1. `requestedProvider` ≠ `storedProvider` in `bridge_turn_start_audit`, and
2. `errorCode: thread_provider_mismatch` on that `turn/start`

Footer text alone is insufficient.

## Phase 2 sign-off

- [ ] Repro class documented
- [ ] Hypothesis IDs PROVEN with log citations
- [ ] Primary + companion PRs chosen per design tranche table