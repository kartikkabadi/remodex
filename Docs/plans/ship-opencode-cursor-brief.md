# Ship OpenCode + Cursor — Phase 1 brief

**Date:** 2026-05-24
**Branch:** `feat/multi-agent-runtime`
**Plan:** Cursor plan `ship_opencode_cursor_ipad` (do not edit plan file)

---

## Phase 0 audit (machine-verified)

| Check | Result |
|-------|--------|
| `phodex-bridge` tests | 436 tests; desktop IPC delta test updated for canonical wire |
| `relay` tests | 39/39 pass |
| OpenCode | `opencode --version` → 1.15.7 |
| Cursor ACP | `~/.local/bin/agent acp --help` works; `~/.grok/bin/agent` is not Cursor |
| Xcode signing (repo) | Team `HR24WHR326`; bundles `com.emanueledipietro.Remodex` / `com.emanueledipietro.RemodexPad` |
| Wired iPad | UDID `00008020-001018443604402E` (iPad, iOS 26.5) |

**Human gate (record on [#28](https://github.com/kartikkabadi/remodex/issues/28)):** Confirm installed RemodexPad bundle + team match before changing `DEVELOPMENT_TEAM`. Baseline Codex smoke on iPad (pair → thread → turn → Stop → reconnect) pending Kartik.

---

## 1. Ingress inventory (production paths)

| Producer | Event shape | Consumer |
|----------|-------------|----------|
| Bridge `sanitizeRelayBoundCodexMessage` | Codex notifications → `remodex/event/*` (default; rollback `REMODEX_CANONICAL_CODEX_EVENTS=0`) | iOS `remodexAdaptedRPCMessage` |
| OpenCode / Cursor adapters | `remodex/event/*`, `remodex/request/permission` | iOS adapter |
| Desktop IPC follower | `item/agentMessage/delta` → sanitized to `remodex/event/assistant_delta` | iOS adapter |
| Rollout live mirror | `codex/event/*` notifications → sanitized to canonical at relay edge | iOS adapter |
| Push notification tracker | Parses `remodex/event/*` + legacy item/* | Bridge only |
| iOS `handleIncomingRPCMessage` | **Drops** raw `codex/event/*` wire; accepts `remodex/event/*` only | Timeline handlers |

---

## 2. Deletion list (Milestone B)

| Area | Action | Owner |
|------|--------|-------|
| iOS wire | Drop raw `codex/event/*` at `handleIncomingRPCMessage` ingress | `CodexService+Incoming.swift` |
| iOS adapter | `timeline/user_message` internal dispatch (not wire) | `CodexService+RemodexEventAdapter.swift` |
| Bridge | Default canonical conversion in `sanitizeRelayBoundCodexMessage` | `bridge.js` |
| Tests | Desktop IPC expects `remodex/event/assistant_delta` | `bridge-desktop-ipc-integration.test.js` |
| Follow-up | Split `CodexService+Incoming` / retire `handleLegacyCodexNamedEvent` switch cluster | Issue decomposition (Messages freeze) |

---

## 3. Cherry-pick matrix (upstream → fork)

| Branch | Take (after B green) | Skip |
|--------|----------------------|------|
| `codex/add-opencode-provider` | Logos, settings runtime card, composer menus | `modelProvider` router, `opencode run --format json` |
| `codex/add-cursor-provider` | Icons, ACP test ideas | `cursor-provider.js` replacing registry |
| `codex/ipad-os` | `PadPresentationStyle`, QR pad layout, scheme/xcconfig | Bulk asset deletes, Incoming/Messages, `bridge.js` |

---

## 4. God-file LOC budget (pre-B snapshot)

| File | ~LOC |
|------|------|
| `CodexService+Incoming.swift` | 3300 |
| `CodexService+Messages.swift` | 5300 |
| `bridge.js` | 3500 |

**Post-B gate:** No net growth on touched files without split; Incoming cluster target ≤2k or split files ≤1k each.

---

## Milestone status (implementation)

| Milestone | Status |
|-----------|--------|
| A (#18) | Warm `initialize` awaits `refreshInitializeCache`; `thread-agent-state.test.js`; fork `inherit` + iOS ThreadFork |
| B (#19+#23) | Canonical default; iOS wire drop `codex/event/*`; desktop IPC test |
| C/D | OpenCode `needs_auth`; Cursor `handleRuntimeResponse` |
| E (#28) | Blocked on iPad signing audit + physical smoke |
| #29 | See [upstream-pr-stack.md](upstream-pr-stack.md) |
