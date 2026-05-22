# Issue 04 — Reconnect + multi-item turn hardening

## Outcome

Same reliability contract as `CodexService` after bridge restart or multi-item turns.

## Tasks

- [ ] Rehydrate active turn for linked chats on bridge restart
- [ ] Projector tests for multi-item turns (no lost finals / overwrites)
- [ ] Port additional scenarios from `TurnTimelineReducerTests` / `CodexServiceCatchupRecoveryTests`
- [ ] Verify late deltas after `turn/completed` are dropped or patched only

## Exit

Scenario table passes; no duplicate finals after reconnect; Stop works without `turnId`.
