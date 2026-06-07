## Design Document Review: Remodex OpenCode Integration — Implementation-Ready Execution Plan (v1.2 Final)

### Summary

**APPROVED FOR IMPLEMENTATION.**

Design doc v1.2 (`/tmp/grok-design-doc-a65ae84c.md`) and workspace execution plan v1.2 (`.cursor/plans/remodex-opencode-execution.plan.md`) resolve **all 15 review issues** from the original and re-review cycles. **0 open issues.**

Independent code verification at baseline `a5c2c5fb` confirms the v1.2 A1 diagnosis matches live `CodexService+Connection.disconnect()` and `finalizeAllStreamingState()` behavior. GATE-4b and WP-15 dependencies correctly ship-gate Track B P0 (skills + images) before device sign-off.

**Start:** PR-01 (G0 baseline) → PR-02 (WP-01 transport teardown).

**Verified:** `npm test` 690/690, `npm run test:opencode` 278/278. Ops docs root: `<workspace>/docs/operations/`.

---

## v1.2 Fix Verification

### Issue 2 — `finalizeAllStreamingState()` in `disconnect()` ✅

| Claim (v1.2) | Code verification |
|--------------|-------------------|
| `disconnect()` line 167 calls `finalizeAllStreamingState()` | ✅ `CodexService+Connection.swift:167` |
| `finalizeAllStreamingState()` clears `activeTurnIdByThread` | ✅ `CodexService+Messages.swift:4324–4327` |
| Also calls `clearAllRunningState()` inside finalize | ✅ `Messages.swift:4327` |
| Direct `clearAllRunningState()` at line 191 (double wipe) | ✅ `Connection.swift:191` |
| No turn-related state survives transport disconnect today | ✅ Consistent with above |

**Doc alignment verified:**
- §Bug A1 table lists `finalizeAllStreamingState()` as primary wipe path
- D10: preserve `activeTurnIdByThread` + markers + timeline + queues; skip/scoped finalize on transport teardown
- WP-01: `teardownTransportOnly()` must not call full `finalizeAllStreamingState()`; proposes `finalizeStreamingPresentationOnly()`
- Grep-audit + GATE-1 include `finalizeAllStreamingState` and `activeTurnIdByThread.removeAll`
- Execution plan §Bug A1 and WP-01 acceptance mirror design doc

### Issue 15 — GATE-4b Track B P0 ship-gate ✅

| Claim (v1.2) | Doc verification |
|--------------|------------------|
| Track B P0 (WP-03, WP-06) ship-blocking for GATE-FINAL | ✅ §Overview lines 47–50 |
| GATE-4b: PR-08 + PR-13/14 merged; O9 skills criteria | ✅ Gate Checkpoints table line 611 |
| WP-15 depends on WP-03 + WP-06 + WP-14 | ✅ WP-15 line 519; GATE-FINAL line 612 |
| Execution plan todos tagged `[TRACK-B P0 SHIP-GATE]` | ✅ wp-03, wp-06, wp-15 todos |
| Critical path diagram shows WP-03/WP-06 merging before WP-15 | ✅ §Overview lines 45–49 |

---

## Resolved Issues (complete history — none open)

| # | Topic | Resolved in | Status |
|---|-------|-------------|--------|
| 1 | WP/PR numbering inconsistency | v1.1 | ✅ |
| 2 | A1 root cause (`finalizeAllStreamingState`) | **v1.2** | ✅ |
| 3 | Permission iOS data model | v1.1 | ✅ |
| 4 | Phase ordering / AGENTS PR10 scope | v1.1 | ✅ |
| 5 | PR revertibility / parallel tracks | v1.1 | ✅ |
| 6 | D6 branding doc policy | v1.1 | ✅ |
| 7 | Acceptance criteria / gates / DoD | v1.1 | ✅ |
| 8 | Security / observability / rollout | v1.1 | ✅ |
| 9 | `model/list` full fetch (D15) | v1.1 | ✅ |
| 10 | Documentation path canonical root | v1.1 | ✅ |
| 11 | WP-01/WP-02 approval queue interaction (D16) | v1.1 | ✅ |
| 12 | Env provider mixed-inventory wording | v1.1 | ✅ |
| 13 | iOS test minimums per P0 WP | v1.1 | ✅ |
| 14 | Handoff scope demotion (Track C) | v1.1 | ✅ |
| 15 | Track B P0 not gated before WP-15 | **v1.2** | ✅ |

---

### Strengths

1. **Code-accurate A1 diagnosis** — `finalizeAllStreamingState()` correctly identified as the turn-map wipe path; WP-01 implementation spec is actionable.
2. **Complete ship gate chain** — GATE-0 through GATE-6 + GATE-4b + GATE-FINAL with no path to G4 without skills, images, permissions, push, and CI.
3. **Permission State Model** — separate `pendingOpenCodePermissions` queue (D16), reply validation, grant semantics, redaction, fail-safe flag.
4. **26-PR plan** — revertible PR-06/07 split; Track A/B/C documented; dependencies respect reconnect → permissions → SSE ordering.
5. **Production bar** — DoD 14 items, rollback smoke table, staged rollout, version-skew notes, observability wiring spec.
6. **Execution plan sync** — `.cursor/plans/remodex-opencode-execution.plan.md` v1.2 mirrors design with agent-executable todos and gate checkpoints.

---

### Implementation Entry Points

| Step | Action | Gate |
|------|--------|------|
| 1 | PR-01: baseline doc at `<workspace>/docs/operations/recovery-baseline-2026-06-08.md` | GATE-0 (G0 sign-off) |
| 2 | PR-02 → PR-03: `teardownTransportOnly()` — skip `finalizeAllStreamingState` | GATE-1 |
| 3 | PR-04 → PR-07: permission routing + UI | GATE-2 (O6b + G1) |
| 4 | PR-08 (parallel) + PR-13 → PR-14 (parallel) | GATE-4b |
| 5 | PR-09 → PR-26: SSE, push, multi-provider, CI | GATE-3–6 |
| 6 | WP-15 device matrix O0–O17 + O6b | GATE-FINAL → G4 → G3 |

---

*Final review: design v1.2, execution plan v1.2, codebase @ `a5c2c5fb`. 0 open issues. Approved 2026-06-08.*