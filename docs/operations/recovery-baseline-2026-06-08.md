# Recovery Baseline — 2026-06-08

**Document ID:** recovery-baseline-2026-06-08  
**Baseline commit:** `a5c2c5fb` (`repos/remodex-opencode/`)  
**Test snapshot:** `npm test` 690/690, `npm run test:opencode` 278/278  
**Canonical docs root:** `<workspace>/docs/operations/` (parent of `repos/remodex-opencode/`)  
**G0 status:** Pending user sign-off  

---

## Symptom → Root Cause Map

| Symptom | Root cause (file:line) | WP |
|---------|------------------------|-----|
| Permissions hang / turns stall | `permission/request` emitted (`opencode-client.js:840–845`) but iOS has no handler; `permission/reply` not top-level routed (`runtime-provider-router.js:42–53` excludes it) | WP-02 |
| Skills via `$` don't apply | `supportsStructuredSkillInput: false` (`provider-capabilities.js:71`); iOS skips `type:skill` when flag false (`CodexService+ThreadsTurns.swift:1512`) | WP-03 |
| No images on OpenCode | `TurnViewModel.allowsComposerImageAttachments` hard-blocks `provider == "opencode"` (`TurnViewModel.swift:1484–1490`) | WP-06 |
| Close app → Stop loss / flash-bang | **Bug A1:** `disconnect()` calls `finalizeAllStreamingState()` (`CodexService+Connection.swift:167`) which wipes `activeTurnIdByThread` (`CodexService+Messages.swift:4324–4327`), plus `clearPendingApprovals`, `clearAllRunningState`, `removeAllThreadTimelineState`, `clearHydrationCaches` | WP-01 |
| Thinking-only UI / stream death | SSE `event/streamError` emitted (`opencode-client.js:358`); no resubscribe loop | WP-04 |
| Multi-provider incomplete | Model cap 120 (`opencode-models.js:430`); mixed env+non-env inventory drops env providers (`opencode-provider-inventory.js:87–106`) | WP-08 |
| Handoff docs drift | `device-e2e-opencode.md` O12 still blocked; catalog already `supportsDesktopHandoff: true` | WP-10 |
| Push doesn't work | Relay endpoints exist; permission push + failure banners incomplete | WP-05 |
| Branding missing | `logoAssetId` undefined for generic providers (`opencode-provider-inventory.js:222–229`) | WP-09 |

---

## Bug A1 — Corrected Diagnosis

`CodexService+Connection.disconnect()` does **not** call `activeTurnIdByThread.removeAll()` directly, but **line 167** calls `finalizeAllStreamingState()`, which at `CodexService+Messages.swift:4324–4327` executes:

```swift
activeTurnId = nil
activeTurnIdByThread.removeAll()
clearAllRunningState()
```

**Additional wipe sites on transport disconnect:**

| Call | Line | Effect |
|------|------|--------|
| `finalizeAllStreamingState()` | 167 | Wipes turn map + running markers |
| `clearPendingApprovals()` | 166 | Drops Codex approval queue |
| `clearAllRunningState()` | 191 | Clears `runningThreadIDs` (duplicate) |
| `removeAllThreadTimelineState()` | 178 | Wipes per-thread timeline caches |
| `clearHydrationCaches()` | 209 | Loses catch-up hydration tickets |
| `failAllPendingRequests(.disconnected)` | 214 | RPC failures → flash errors |

**What survives transport disconnect today:** Nothing turn-related.

**Fix (WP-01):** `teardownTransportOnly()` when `preserveReconnectIntent: true` — skip full finalize; use `finalizeStreamingPresentationOnly()`; preserve turn maps, timeline, queues, partial hydration.

---

## Execution Plan Reference

- Plan: `.cursor/plans/remodex-opencode-execution.plan.md` (v1.2)
- Design: `docs/operations/remodex-opencode-execution-design.md` (v1.2)
- Critical path: WP-00 → WP-01 → WP-02 → WP-04 → WP-05 → WP-08 → WP-14 → WP-15

---

## Rollback Flags

| Flag | Degraded behavior |
|------|-------------------|
| `REMODEX_OPENCODE_PERMISSIONS_UI=0` | Auto-deny permissions < 30s |
| `REMODEX_OPENCODE_SSE_RECONNECT=0` | Poll recovery < 10s |
| `REMODEX_OPENCODE_ATTACHMENTS=0` | Image button greyed |
| `REMODEX_DISABLE_OPENCODE=1` | Codex-only regression (O17) |

**Rollback order:** Disable permission UI flag before reverting WP-01.

---

*End of recovery baseline — G0 sign-off required before PR-02 merge.*