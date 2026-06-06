# Engineering Design: iPad OpenCode E2E — Message Duplication, Skills Catalog, Provider Inventory Freshness

**Workspace:** `$REMODEX_WORKSPACE`  
**Active code:** `repos/remodex-opencode/` (phodex-bridge + CodexMobile iOS)  
**Baseline:** commit `1a8e27e` (slash/skills panel layout fixed per prior design PR6)  
**Prior design:** `docs/design/ipad-opencode-e2e-composer-fixes-eedfe10f.md`  
**Author:** design-doc-writer persona  
**Date:** 2026-06-06  
**Status:** Refined (pass 5 — 2026-06-06)

---

## Refinement Audit (pass 4)

Deep audit against live code at `repos/remodex-opencode/`. Each finding lists **problem → correction**.

### Critical (device-blocking)

| ID | Finding | Correction |
|----|---------|------------|
| **A1** | MSG-1 scoped only `hydrateAssistantFromSessionMessages` (`opencode-provider.js:1233–1246`) and `completeTurn` (`:1536–1550`). SDK events also emit `item/completed` via `opencode-client.js` and are **forwarded unchanged** at `executeTurn` subscribe handler `:1432` (`emit(method, enriched)`). Up to **three** bridge emit paths per turn. | Add shared `emitAssistantCompletedOnce(active, payload, source)`; gate SSE forward (`method === "item/completed"`), hydrate, and `completeTurn`. MSG-1 tests must count `item/completed` across all paths. |
| **A2** | Design proposed `assistantItem.finalized = true` on `item/agentMessage/delta` stream path. Deltas are incremental text, not terminal completion. | **Removed.** `finalized` is set only when emitting or forwarding the first `item/completed`. |
| **A3** | `handleTurnStarted` (`CodexService+Incoming.swift:567–599`) calls `markThreadAsRunning` + `setActiveTurnID` **before** sync. After that, `threadHasActiveOrRunningTurn(threadId)` is always true (`CodexService+Sync.swift:902–907`). Conditional `if threadHasActiveOrRunningTurn → deferred else immediate` makes the `else` branch **dead code** on every `turn/started`. | `handleTurnStarted` uses **unconditional** `requestDeferredSync(threadId:)` (when `threadId` known). Keep conditional pattern only for other call sites if needed later. |
| **A4** | CAT push + `catalogRevision` assigned to `opencode-provider.js:660–661`, but `computeCatalogRevision` / `shortHash` / `countAuthenticated` **do not exist** in provider; inventory fingerprint is a router concern. | Warm inventory, `computeCatalogRevision`, fingerprint-diff push, and `runtime_catalog_warm_inventory` log live in **`runtime-provider-router.js`**. Provider unchanged except inventory populated by existing `listModels()`. |
| **A5** | Design claimed Settings workaround is `fetchRuntimeCatalog()` on appear. Actual `OpenCodeProvidersSettingsView.task` (`:45–49`) runs **`fetchRuntimeCatalog()` then `listModels()`** — catalog first, so first paint can still be stale; workaround relies on user dwell time + other refreshes. | `refreshRuntimeMetadataSequential()` = **`listModels(refreshProviders: true)` then `fetchRuntimeCatalog()`** at Connection, composer model menu, Settings, and OpenCode providers view. |

### Factual / scope corrections

| ID | Finding | Correction |
|----|---------|------------|
| **B1** | `uniquePendingUserHistoryMergeIndex` already used in `mergeHistoryMessages` at `CodexService+History.swift:749–756`. Design implied greenfield user dedupe. | MSG-3 extends **running-thread** guards: prefer live **`.confirmed`** user row over `thread/read` duplicate when `turnId` matches (`uniqueUserHistoryMergeIndex` + `historyTextsMatch`). Pending merge path remains for pre-`turn/started` rows only. |
| **B2** | `assistantCompletionFingerprintByThread` already on `CodexService.swift:590`, used in `completeAssistantMessage` (`CodexService+Messages.swift:3158+`). Design invented `lastAssistantCompletionByTurn` without referencing existing store. | Add `assistantCompletionFingerprintByTurn: [String: (textHash: String, itemId: String?, timestamp: Date)]` on `CodexService.swift`; 30s TTL dedupe in `completeAssistantMessage`. **Precedence:** per-turn store checked first when `turnId` present; both stores updated on successful completion; per-turn entry cleared on `turn/completed` / `noteTurnFinished`. |
| **B3** | `handleErrorNotification` (`CodexService+Incoming.swift:673–708`) does **not** call `requestImmediateSync` / `requestThreadHistoryReconcile` (unlike `handleTurnCompleted`). | MSG-3 adds only `cancelDeferredSync(threadId:)` on `turn/failed` path — do not add spurious immediate sync on generic errors. |
| **B4** | `logBridgeNotifyForward` (`bridge.js:658–673`) allowlists only `turn/started`, `item/agentMessage/delta`, `turn/completed`. `runtime/catalog/updated` would be silently omitted from device grep. | CAT-1 adds `runtime/catalog/updated` to `NOTIFY_FORWARD_METHODS`. |
| **B5** | `CodexSkillMetadata` (`CodexSkillMetadata.swift`) has no `providers` field; `CodingKeys` omits it. `cachedSkillSearchIndexByRoot` in `TurnViewModel.swift:380` can serve stale single-provider rows after SKILL-1 ships. | SKILL-2 adds `providers` + `CodingKeys`; compute per-root `providersSignature` (sorted joined provider ids per skill); invalidate cache entry when signature differs from cached index or on `forceReload`. |
| **B6** | `dedupeSkillsByName` (`runtime-provider-router.js:1021–1035`) is **case-sensitive** (`Map` keyed by raw `name`). Contract (`bridge-rpc.md:465`) claims cross-provider dedup — **code does not** (comment at `:1099` confirms). | SKILL-1 `mergeSkillsAcrossProviders` uses `name.trim().toLowerCase()` key; update contract. |
| **B7** | `hydratedTurnIds` Set (5 min TTL) redundant if `finalized` gates all `item/completed` paths correctly. | Demoted to **optional** hydrate-call tracing only (`opencode_turn_hydrate_suppressed`); not a second completion owner. |
| **B8** | `secure-transport.test.js:667` tests `turn/completed` retention but **without** competing lifecycle/delta/RPC pressure. Pass-3 note on misread is correct. | MSG-2 tests must add cap-pressure scenarios per PR plan. |
| **B9** | `npm test` in `phodex-bridge`: **645 pass, 0 fail** (verified 2026-06-06). `opencode-provider.test.js:1203` guards duplicate **delta** only — not `item/completed`. | MSG-1 test matrix extended as specified in PR plan. |

### Rejected additions

| Proposal | Rationale |
|----------|-----------|
| Separate PR for `bridge-rpc.md` | Folded into SKILL-1 (same RPC surface). |
| Separate PR for `bridge.js` notify allowlist | Folded into CAT-1 (same notification surface). |
| MSG-4 iOS-only bridge emit fix | Absorbed into expanded MSG-1 scope (A1). |

---

## Overview

Three P0/P1 reliability issues remain after the composer layout fix (`1a8e27e`). Device logs (`/tmp/remodex-local.log`) show **message duplication** via a multi-path failure chain: bridge outbound buffer overflow during reconnect storms, OpenCode **triple `item/completed` exposure** (SSE forward + hydrate + `completeTurn`), and iOS `thread/read` reconciliation racing live notifications. The **skills `$` panel** shows a capped/wrong catalog because iOS dedupes cross-provider skills to a single `provider` string and wires "See all" to the already-truncated autocomplete list. **OpenCode providers UI** shows only Go + Zen on first open because `runtime/catalog` snapshots `providerInventory` before async auth discovery completes (`authenticated:0` → `authenticated:8` in logs).

This design proposes three independently mergeable fix stacks: **MSG** (transport + hydrate + iOS reconcile), **SKILL** (unified bridge merge + dual-logo UI), and **CAT** (catalog freshness with version token + push).

---

## Background & Motivation

### Architecture (relevant slice)

| Layer | Role |
|-------|------|
| **phodex-bridge** | Composition root; `secure-transport.js` E2EE replay buffer; `opencode-provider.js` turn lifecycle + hydration; `runtime-provider-router.js` catalog + skills merge |
| **CodexMobile** | `CodexService+Incoming` notification dispatch; `CodexService+History` thread/read merge; `TurnTimelineReducer` render dedupe; `TurnViewModel` skills autocomplete |
| **Relay** | WebSocket transport; closeCode 1006 reconnect storms observed in device logs |

### Verified root causes (code + logs)

#### Issue 1 — Message duplication (P0)

| Path | Evidence |
|------|----------|
| **Buffer overflow drops RPC + notifications** | `MAX_BRIDGE_OUTBOUND_MESSAGES = 100` (`secure-transport.js:33`); `trimOutboundBuffer()` drops **oldest FIFO** (`495–524`); logs show `bridge_outbound_dropped` `reason: "overflow"` |
| **Triple `item/completed` emit** | (1) SSE forward `emit(method, enriched)` (`opencode-provider.js:1432`) when `opencode-client.js` fires `item/completed`; (2) `hydrateAssistantFromSessionMessages` (`:1233–1246`) always emits; (3) `completeTurn` (`:1536–1550`) unconditionally emits when `assistantItem.text` set. Poll path: `pollForAssistantCompletion` → hydrate → `completeTurn` (`:1268–1270`). Logs: `opencode_turn_hydrated` **twice** per turn, then `opencode_turn_completed` `source:"poll_messages"` |
| **turn/started triggers history sync** | `handleTurnStarted` → `requestImmediateSync` (`CodexService+Incoming.swift:599`) races live pending user row vs `thread/read` |
| **iOS render dedupe partial** | `TurnTimelineReducer.shouldMergeExactAssistantReplay` (`:967–981`) merges same `(threadId, turnId)` assistant text ≥24 bytes regardless of `itemId` — render safety net only; service layer still appends twice |

Existing bridge test `hydrate after streamed assistant text does not emit duplicate delta` (`opencode-provider.test.js:1203`) guards deltas only — **not** duplicate `item/completed`.

#### Issue 2 — Skills `$` panel (P1)

| Path | Evidence |
|------|----------|
| **Inline cap = 12** | `TurnViewModel.maxSkillAutocompleteItems = 12`; `filteredSkillAutocompleteItems` `.prefix(12)` (`TurnViewModel.swift:389, 2679`) |
| **"See all" bug** | `BridgeSkillsFullListSheet` receives `viewModel.skillAutocompleteItems` — capped (`TurnComposerHostView.swift:392–393`) |
| **iOS cross-provider collapse** | `listSkills()` `Dictionary(grouping:)` keeps first enabled (`CodexService+ThreadsTurns.swift:778–781`) |
| **Bridge no cross-provider dedup** | `mergeSkillsBuckets` comment `:1099`; concatenates per cwd |
| **Contract drift** | `bridge-rpc.md:465` claims dedup — code does not |

**User requirement (Jun 6):** ~10–15 skills (Codex-primary after unified dedup); dual logos on overlap; "See all" = full unified list.

#### Issue 3 — OpenCode providers UI stale on first open (P1)

| Path | Evidence |
|------|----------|
| **Catalog reads stale snapshot** | `buildCatalogOpenCodeRuntime` calls `getRuntimeStatus()` only (`runtime-provider-router.js:891–894`) |
| **Inventory populated async** | `lastProviderInventory` set in `listModels()` (`opencode-provider.js:660–661`) |
| **Parallel refresh race** | `scheduleRuntimeOptionRefresh` parallel `fetchRuntimeCatalog` ∥ `listModels()` (`CodexService+Connection.swift:650–653`) |
| **Settings partial workaround** | `OpenCodeProvidersSettingsView.task` (`:45–49`) — catalog **before** listModels; not sufficient alone |

---

## Goals

1. **P0:** Eliminate duplicate user/assistant bubbles on OpenCode turns.
   - **(A) Same-session bridge emit:** ≤1 `item/completed` per turn from bridge (SSE + hydrate + `completeTurn` coordinated).
   - **(B) Post-reconnect transport:** lifecycle/stream retained during buffer storm; iOS reconciles after catch-up.
2. **P1:** Skills `$` panel: unified Codex-primary catalog (~10–15) with dual-provider logos; "See all" uncapped.
3. **P1:** OpenCode providers complete on first open without visiting Settings.
4. Preserve **capability-driven UI** (AGENTS.md); no `if provider == opencode` in views.
5. **Codex regression:** `REMODEX_DISABLE_OPENCODE=1`.

## Non-Goals

- Rewriting OpenCode CLI/SDK event model.
- Full timeline reducer refactor.
- Changing fixed slash/skills panel layout from `1a8e27e`.
- Excluding OpenCode skills entirely.

---

## Proposed Design

### 1. Message duplication fix (MSG stack)

#### 1a. Bridge secure-transport: priority retention + RPC isolation (MSG-2)

**Problem:** FIFO `trimOutboundBuffer()` (`secure-transport.js:495–524`) drops lifecycle, stream, and RPC indiscriminately.

**Design:** Priority tiers (`LIFECYCLE` < `STREAM` < `NOTIFY` < `RPC_RESPONSE`); drop lowest priority first; pin newest `turn/completed` **and** `item/completed` per `(threadId, turnId)` via `extractTurnPinKey`; reserve 30% byte budget for lifecycle+stream.

**`classifyOutboundPriority` (explicit):**

| Method | Tier | Rationale |
|--------|------|-----------|
| `turn/started`, `turn/completed`, `turn/failed` | `LIFECYCLE` | Terminal lifecycle |
| `item/completed`, `item/agentMessage/delta` | `STREAM` | Assistant body must survive cap pressure alongside lifecycle |
| Other notifications | `NOTIFY` | Default tier |
| RPC responses | `RPC_RESPONSE` | Dropped first under pressure |

`extractTurnPinKey` returns `(threadId, turnId)` for `turn/completed`, `turn/failed`, **and** `item/completed` (flat `params.threadId` / `params.turnId` with nested `item` fallback). Under overflow, retain pinned `item/completed` + `turn/completed` pair per turn — prevents iOS finalizing lifecycle without canonical assistant body (D2).

**Env vars:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `REMODEX_BRIDGE_PRIORITY_OUTBOUND` | `1` (on after MSG-2) | Enable priority trim |
| `REMODEX_BRIDGE_OUTBOUND_LEGACY_TRIM` | `0` | `1` = FIFO rollback |
| `REMODEX_BRIDGE_OUTBOUND_CAP` | `100` | Message-count override |

`extractTurnPinKey` parses flat `params.threadId` / `params.turnId` with nested fallback. Extend existing `bridge_outbound_dropped` log with `priority`, `method`, `bridgeOutboundSeq`, `lowestPriorityDropped`.

#### 1b. OpenCode `item/completed` idempotency — all emit paths (MSG-1)

**Problem:** Three independent bridge paths to iOS (see audit A1).

**Shared owner:** `assistantItem.finalized: boolean` + `emitAssistantCompletedOnce(active, params, source)`.

```javascript
function readString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function emitAssistantCompletedOnce(active, params, source) {
  const assistantItem = active.turn.items.find((item) => item.type === "agentMessage");
  if (!assistantItem) return false;
  if (assistantItem.finalized === true) {
    console.log(JSON.stringify({
      event: "opencode_item_completed_skipped",
      threadId: active.thread.id,
      turnId: active.turn.id,
      source,
      reason: "already_finalized",
    }));
    return false;
  }

  // Canonical bridge identity — never forward foreign OpenCode part.id to iOS.
  const text = readString(params?.message) || readString(params?.item?.text) || assistantItem.text || "";
  if (text) assistantItem.text = text;

  const canonicalParams = {
    ...params,
    threadId: active.thread.id,
    turnId: active.turn.id,
    itemId: assistantItem.id,
    message: text,
    item: {
      ...(params?.item ?? {}),
      id: assistantItem.id,
      turnId: active.turn.id,
      type: "agentMessage",
      phase: "final",
      text,
    },
  };

  assistantItem.finalized = true;
  emit("item/completed", canonicalParams);
  return true;
}
```

**Canonical param rules (required):**

1. **Normalize `itemId`:** Always `assistantItem.id` (`${OPENCODE_PROVIDER_ID}-agent-${turnId}` at `:1121–1138`), never OpenCode SSE `part.id`.
2. **Hydrate text:** `text = readString(params.message) || readString(params.item?.text) || assistantItem.text`; set `assistantItem.text = text` before `finalized = true` (SSE may complete before deltas).
3. **Consistent `item` payload:** Nested `item.id`, `item.turnId`, `item.type`, `item.phase: "final"`, `item.text` always match top-level fields.
4. **Test:** SSE `item/completed` with foreign `itemId` fires first → exactly one outbound emit, always bridge `itemId`.

**Call sites:**

| Site | Change |
|------|--------|
| `hydrateAssistantFromSessionMessages` (`:1233–1246`) | Replace raw `emit("item/completed")` with `emitAssistantCompletedOnce(..., "hydrate")` |
| `completeTurn` (`:1536–1550`) | Same with `source: "completeTurn"` |
| `subscribeToEvents` handler (`:1432`) | **Before** `emit(method, enriched)`: if `method === "item/completed"`, route through `emitAssistantCompletedOnce`; skip forward when already finalized |

**Optional:** `hydratedTurnIds` Set (5 min TTL) logs `opencode_turn_hydrate_suppressed` for repeated hydrate **calls** — does not gate completion.

**`turn/completed` session.idle path (`:1411–1415`):** Keep existing gate; if hydrate returns false, do not call `completeTurn` (avoids empty completion).

#### 1c. iOS incoming + history hardening (MSG-3)

**Files:** `CodexService+Incoming.swift`, `CodexService+History.swift`, `CodexService+Messages.swift`, `CodexService+Sync.swift`, `CodexService.swift`, `TurnTimelineReducer.swift`

| Change | Detail |
|--------|--------|
| **Defer sync on turn/started** | Replace line `:599` unconditional `requestImmediateSync` with **unconditional** `requestDeferredSync(threadId:)` when `threadId != nil`; else `requestImmediateSync(threadId: activeThreadId)`. **Codex safety:** handler is provider-agnostic; for desktop-mirrored turns (`isDesktopMirroredTurn` at `:570–577`), also call `requestImmediateSync(threadId:)` once so `markMirroredRunningCatchupNeeded` threads get an immediate `syncActiveThreadState` burst — deferred sync still cancels on `turn/completed`. |
| **cancelDeferredSync** | `handleTurnCompleted` (`:643` before sync); `handleErrorNotification` when `turn/failed` resolves `threadId` |
| **Per-turn completion fingerprint** | `assistantCompletionFingerprintByTurn` on `CodexService.swift`; 30s TTL in `completeAssistantMessage`. **Precedence vs `assistantCompletionFingerprintByThread`:** when `turnId` present, check per-turn store first; on successful completion update **both** stores; clear per-turn entry on `turn/completed` / `noteTurnFinished`. Thread store (45s TTL) remains for turn-less completions. |
| **User-message dedupe** | Extend running-thread merge: when `thread/read` user row matches live **`.confirmed`** row (same `turnId` + `historyTextsMatch`), reconcile via `uniqueUserHistoryMergeIndex` (`:622–630`) — do **not** append duplicate bubble. `uniquePendingUserHistoryMergeIndex` (`:749–756`) only for pre-confirm `.pending` rows. |
| **Assistant history** | Extend closed-thread assistant guard (`CodexService+History.swift:588`) to running threads where live non-streaming assistant exists with same normalized text — **primary MSG-3 deliverable** |
| **Reducer** | **No new `removeDuplicateAssistantMessages` extension** — existing `shouldMergeExactAssistantReplay` (`TurnTimelineReducer.swift:967–981`) already merges same `(threadId, turnId)` assistant text ≥24 bytes regardless of `itemId`. PR MSG-3 references existing reducer; effort stays in `CodexService+History.swift` service-layer guards. Optional follow-up: sub-24-byte short replies only if device matrix shows gaps. |

**`requestDeferredSync` API** — stored state on `CodexService.swift` (extensions cannot add stored properties):

```swift
@ObservationIgnored var deferredSyncTasks: [String: Task<Void, Never>] = [:]
@ObservationIgnored var assistantCompletionFingerprintByTurn: [String: (textHash: String, itemId: String?, timestamp: Date)] = [:]
```

```swift
// CodexService+Sync.swift
func requestDeferredSync(threadId: String, delayNanoseconds: UInt64 = 2_000_000_000) {
    guard canRunRealtimeSyncLoop else { return }
    deferredSyncTasks[threadId]?.cancel()
    deferredSyncTasks[threadId] = Task { @MainActor [weak self] in
        defer { self?.deferredSyncTasks.removeValue(forKey: threadId) }
        try? await Task.sleep(nanoseconds: delayNanoseconds)
        guard let self, !Task.isCancelled, self.isConnected, self.isInitialized else { return }
        if self.threadHasActiveOrRunningTurn(threadId) { return }
        await self.syncActiveThreadState(threadId: threadId)
    }
}
```

Coalesce: multiple `turn/started` within 2s per thread cancels prior task. Terminal handlers cancel deferred; immediate reconcile via existing `requestImmediateSync` + `requestThreadHistoryReconcile` on `turn/completed`.

**`completeAssistantMessage` fingerprint pseudocode (MSG-3 PR):**

```swift
func shouldDedupeAssistantCompletion(threadId: String, turnId: String?, text: String, itemId: String?) -> Bool {
    let now = Date()
    if let turnId,
       let fp = assistantCompletionFingerprintByTurn[turnId],
       now.timeIntervalSince(fp.timestamp) < 30,
       fp.textHash == text.hashValue.description,
       fp.itemId == itemId || fp.itemId == nil || itemId == nil {
        return true  // per-turn wins when turnId present
    }
    if let fp = assistantCompletionFingerprintByThread[threadId],
       now.timeIntervalSince(fp.timestamp) < 45,
       fp.text == text.trimmingCharacters(in: .whitespacesAndNewlines) {
        return true  // turn-less / fallback path
    }
    return false
}

func recordAssistantCompletion(threadId: String, turnId: String?, text: String, itemId: String?) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let now = Date()
    assistantCompletionFingerprintByThread[threadId] = (text: trimmed, timestamp: now)
    if let turnId {
        assistantCompletionFingerprintByTurn[turnId] = (textHash: trimmed.hashValue.description, itemId: itemId, timestamp: now)
    }
}

// On turn/completed or noteTurnFinished(turnId:):
assistantCompletionFingerprintByTurn.removeValue(forKey: turnId)
```

---

### 2. Skills catalog fix (SKILL stack)

#### 2a. Bridge: cross-provider merge with `providers: string[]` (SKILL-1)

Replace `mergeSkillsBuckets` concatenation with `mergeSkillsAcrossProviders` (case-fold key `name.trim().toLowerCase()`; `resolvePrimaryProvider` prefers `codex`).

**Flat `skills[]` path (`runtime-provider-router.js:1058–1061`):** Replace `dedupeSkillsByName(mergedBuckets.flatMap(...))` with cross-provider merge output — **both** `data[]` and flat `skills[]` shapes.

**Schema per skill:**

| Field | Type | Notes |
|-------|------|-------|
| `provider` | string | Primary (backward compat) |
| `providers` | `string[]` | **new** — e.g. `["codex", "opencode"]` |

Update `docs/contracts/bridge-rpc.md` §skills/list.

#### 2b. iOS: decode, dual logos, uncapped "See all" (SKILL-2)

**`CodexSkillMetadata.swift`:**

```swift
let providers: [String]?

var providerIds: [String] {
    let ids = (providers?.isEmpty == false ? providers! : [provider ?? "codex"])
    return ids.sorted()
}
```

Add `providers` to `CodingKeys`; custom `Hashable` includes `providerIds`.

**`listSkills()`:** Remove `Dictionary(grouping:)` collapse (`CodexService+ThreadsTurns.swift:778–781`); bridge authoritative.

**`TurnViewModel`:**

| Property | Purpose |
|----------|---------|
| `skillAutocompleteItems` | Inline — `.prefix(12)` |
| `skillFullListItems` | Same filter, **uncapped** |
| `skillTotalCount` | `skillFullListItems.count` (query-filtered) |

**Cache bust (`providersSignature`):** `TurnSkillSearchIndexEntry` stores optional `providersSignature: String?` per cached root. On `listSkills` decode, compute signature per root:

```swift
func providersSignature(for skills: [CodexSkillMetadata]) -> String {
    skills.map { "\($0.name):\($0.providerIds.sorted().joined(separator: ","))" }
          .sorted()
          .joined(separator: "|")
}
```

In autocomplete path (`TurnViewModel.swift:874–885`), when cache key exists, compare incoming signature to cached entry — rebuild index when signatures differ (e.g. cached single-provider `["codex"]` → refreshed `["codex","opencode"]`). `forceReload` always bypasses cache.

**Plumbing:** `TurnComposerAutocompleteState` adds `skillTotalCount`, `skillFullListItems`; `TurnComposerHostView` → `TurnComposerView` → `SkillAutocompletePanel(totalCount:)`; `BridgeSkillsFullListSheet(items: skillFullListItems)`.

**Dual logos:** `ForEach(skill.providerIds, id: \.self) { RuntimeProviderLogoView(provider: $0, size: 14) }` in panel + sheet.

---

### 3. OpenCode providers catalog freshness (CAT stack)

#### 3a. Bridge: warm inventory before catalog snapshot (CAT-1)

In `buildCatalogOpenCodeRuntime` (`runtime-provider-router.js:879+`):

```javascript
if (opencodeProvider?.listModels && shouldWarmProviderInventory(runtimeStatus, env)) {
  await withModelListBudget(
    opencodeProvider.listModels({ refreshProviders: true }),
    opencodeModelListBudgetMs(env),
    null,
  );
  runtimeStatus = opencodeProvider.getRuntimeStatus(env);
  // log runtime_catalog_warm_inventory
}
```

`shouldWarmProviderInventory`: true when inventory empty, `providerInventoryPartial`, or `authDiscoveryReasonCode !== "ok"`. Gated by `REMODEX_CATALOG_WARM_INVENTORY` (default `1`).

#### 3b. Catalog version token

```javascript
function computeCatalogRevision(runtimeStatus) {
  const inventory = runtimeStatus?.providerInventory ?? [];
  const fingerprint = [
    runtimeStatus?.providerInventoryPartial ? "partial:1" : "partial:0",
    runtimeStatus?.authDiscoveryReasonCode ?? "unknown",
    ...inventory.map((p) => `${p.id}:${p.authenticated ? 1 : 0}:${p.connected ? 1 : 0}`).sort(),
  ].join("|");
  return `fp:${shortHash(fingerprint)}`;
}
```

Attach `catalogRevision` to `runtime/catalog` opencode block.

#### 3c. Push on inventory fingerprint change (CAT-1 state machine)

Router-scoped module state (not in `opencode-provider.js`):

```javascript
let lastEmittedCatalogFingerprint = null;

function computeCatalogFingerprint(runtimeStatus) {
  const inventory = runtimeStatus?.providerInventory ?? [];
  return [
    runtimeStatus?.providerInventoryPartial ? "partial:1" : "partial:0",
    runtimeStatus?.authDiscoveryReasonCode ?? "unknown",
    ...inventory.map((p) => `${p.id}:${p.authenticated ? 1 : 0}:${p.connected ? 1 : 0}`).sort(),
  ].join("|");
}

function maybeEmitCatalogUpdated(runtimeStatus, sendRuntimeMessage) {
  const fingerprint = computeCatalogFingerprint(runtimeStatus);
  if (fingerprint === lastEmittedCatalogFingerprint) return false;
  lastEmittedCatalogFingerprint = fingerprint;
  const catalogRevision = `fp:${shortHash(fingerprint)}`;
  sendRuntimeMessage({
    method: "runtime/catalog/updated",
    params: { catalogRevision, providerInventoryPartial: runtimeStatus?.providerInventoryPartial ?? false },
  });
  return true;
}
```

**Hook points (both required):**

| Hook | When | Why |
|------|------|-----|
| (a) End of `buildCatalogOpenCodeRuntime` | After optional warm `listModels` + `getRuntimeStatus()` refresh | First `runtime/catalog` RPC gets full inventory + push |
| (b) End of `listProviderModelsForModelList` OpenCode leg | After `getRuntimeStatus()` when fingerprint differs from `lastEmittedCatalogFingerprint` | Composer `model/list` auth discovery pushes without second catalog RPC |

Add `runtime/catalog/updated` to `bridge.js` `NOTIFY_FORWARD_METHODS` (`:659–663`). Emit **only** on fingerprint change.

**Tests:** warm via `runtime/catalog` emits revision; identical subsequent `model/list` does not push; auth change pushes once.

#### 3d. iOS reactive refresh (CAT-2)

**`OpenCodeRuntimeDetails.swift`:** add `catalogRevision: String?`.

**`CodexService.swift`:** `lastOpenCodeCatalogRevision`, `catalogRefetchDebounceTask`.

**Handler** in `CodexService+Incoming.swift` switch:

```swift
case "runtime/catalog/updated":
    handleRuntimeCatalogUpdated(paramsObject)
```

**Shared helper** (`CodexService+RuntimeConfig.swift` or `+Connection.swift`):

```swift
func refreshRuntimeMetadataSequential() async {
    try? await listModels(refreshProviders: true)  // always refreshProviders: true — including Connection
    try? await fetchRuntimeCatalog()
}
```

**Standardization:** All four sites use `refreshRuntimeMetadataSequential()` verbatim — fixes `flushPendingRuntimeOptionRefreshIfPossible` (`CodexService+Connection.swift:652`) which today calls `listModels()` **without** `refreshProviders: true`.

Replace parallel `TaskGroup` at:
1. `CodexService+Connection.swift` — `flushPendingRuntimeOptionRefreshIfPossible` (`:650–653`)
2. `TurnComposerRuntimeActions.swift` — `refreshModels` (`:55–58`)
3. `SettingsRuntimeDefaultsCard.swift` — `.task` (`:101–104`)
4. `OpenCodeProvidersSettingsView.swift` — `.task` (`:45–49`)

---

## API / Interface Changes

### skills/list skill entry (additive)

```json
{
  "name": "review",
  "provider": "codex",
  "providers": ["codex", "opencode"]
}
```

### runtime/catalog opencode block (additive)

| Field | Type | Notes |
|-------|------|-------|
| `catalogRevision` | string | `fp:…` fingerprint |

### New notification

| Method | Params | When |
|--------|--------|------|
| `runtime/catalog/updated` | `{ catalogRevision, providerInventoryPartial? }` | Router detects inventory fingerprint change |

---

## Data Model Changes

| Store | Change |
|-------|--------|
| OpenCode turn `assistantItem` | `finalized: boolean` |
| Bridge outbound buffer entry | `priority: number` |
| iOS `CodexService` | `deferredSyncTasks`, `assistantCompletionFingerprintByTurn`, `lastOpenCodeCatalogRevision`, `catalogRefetchDebounceTask` |
| iOS `CodexSkillMetadata` | `providers: [String]?` |
| iOS `OpenCodeRuntimeDetails` | `catalogRevision: String?` |
| iOS `TurnViewModel` | `skillFullListItems`, `skillTotalCount`; `TurnSkillSearchIndexEntry.providersSignature` |
| iOS `TurnComposerAutocompleteState` | `skillTotalCount`, `skillFullListItems` |

No persistence migration.

---

## Security & Privacy

Unchanged from pass 3. Warm `listModels` uses existing auth probe; no credential ID logging (AGENTS.md). `runtime/catalog/updated` same trust boundary as turn notifications.

---

## Observability

| Event | Layer | Notes |
|-------|-------|-------|
| `opencode_item_completed_skipped` | bridge | `source`, `reason: already_finalized` |
| `opencode_turn_hydrated_skipped` | bridge | hydrate skipped (optional `hydratedTurnIds`) |
| `bridge_outbound_dropped` | bridge | + `priority`, `method`, `bridgeOutboundSeq` |
| `runtime_catalog_warm_inventory` | bridge | `authenticatedBefore/After`, `timedOut` |
| `bridge_notify_forward` | bridge | includes `runtime/catalog/updated` after CAT-1 |
| `ios_assistant_completion_deduped` | iOS | per-turn fingerprint hit |
| `ios_catalog_revision_changed` | iOS | refetch trigger |

**Device grep:**
```bash
grep -E 'bridge_outbound_dropped|opencode_item_completed|opencode_turn_hydrated|provider_inventory_built|runtime_catalog_warm|bridge_notify_forward.*catalog' /tmp/remodex-local.log
```

---

## Rollout Plan

| Phase | PR | Risk | Rollback |
|-------|-----|------|----------|
| 1 | MSG-1 | Low | Revert `opencode-provider.js` |
| 2 | MSG-2 | Med | `REMODEX_BRIDGE_OUTBOUND_LEGACY_TRIM=1` |
| 3 | MSG-3 | Low | Revert Swift sync/incoming |
| 4 | SKILL-1 | Low | iOS ignores unknown `providers` |
| 5 | SKILL-2 | Low | Falls back to single `provider` |
| 6 | CAT-1 | Med | `REMODEX_CATALOG_WARM_INVENTORY=0` |
| 7 | CAT-2 | Low | Manual Settings refresh |

**Staged device sign-off:** MSG stack first (D1–D3), then full matrix.

---

## Open Questions

1. **Inline cap vs header count:** Resolved — header uses `skillTotalCount` (filtered, uncapped).
2. **OpenCode-exclusive sort:** Alphabetical unified (recommendation unchanged).
3. **RPC drop during storm:** Acceptable — iOS catch-up re-fetches (unchanged).

---

## References

| Resource | Path |
|----------|------|
| Secure transport | `phodex-bridge/src/secure-transport.js` |
| OpenCode provider | `phodex-bridge/src/opencode-provider.js` |
| OpenCode client (SSE) | `phodex-bridge/src/opencode-client.js` |
| Skills merge / catalog | `phodex-bridge/src/runtime-provider-router.js` |
| Notify forward | `phodex-bridge/src/bridge.js` |
| iOS incoming | `CodexMobile/.../CodexService+Incoming.swift` |
| iOS history | `CodexMobile/.../CodexService+History.swift` |
| iOS skills | `CodexMobile/.../CodexService+ThreadsTurns.swift` |
| TurnViewModel | `CodexMobile/.../TurnViewModel.swift` |
| Skills UI | `SkillAutocompletePanel.swift`, `BridgeSkillsFullListSheet.swift` |
| Bridge RPC contract | `docs/contracts/bridge-rpc.md` |
| AGENTS.md | `repos/remodex-opencode/AGENTS.md` |

---

## Key Decisions

1. **Duplication is three-layer:** transport drops + **triple** bridge `item/completed` (SSE + hydrate + completeTurn) + iOS sync race — fix all three.
2. **Single completion owner:** `emitAssistantCompletedOnce` + `assistantItem.finalized` gates **every** bridge `item/completed` path including SSE forward.
3. **No `finalized` on deltas:** Terminal flag only on `item/completed`.
4. **`handleTurnStarted`:** Unconditional `requestDeferredSync` (conditional pattern is dead code after `markThreadAsRunning`); **plus** immediate `requestImmediateSync` for desktop-mirrored turns to preserve Codex catch-up timing.
5. **Skills merge at bridge:** `providers: string[]`; iOS stops `Dictionary(grouping:)` collapse.
6. **"See all" + header:** `skillFullListItems` uncapped; header `skillTotalCount`; plumb via `TurnComposerAutocompleteState`.
7. **Catalog warm in router:** `listModels` before `getRuntimeStatus` snapshot in `buildCatalogOpenCodeRuntime`.
8. **Push + revision in router:** Fingerprint diff drives `runtime/catalog/updated`; not in `opencode-provider.js`.
9. **iOS refresh order:** `listModels` then `fetchRuntimeCatalog` everywhere (fixes Settings `.task` order bug).
10. **MSG-1 blocks D1/D2/D3:** MSG-3 alone insufficient for P0.
11. **Leverage existing iOS dedupe:** Extend `uniqueUserHistoryMergeIndex` for `.confirmed` rows + per-turn fingerprint; pending path for pre-confirm only.
12. **Skill cache bust:** `providersSignature` per root; invalidate cached `TurnSkillSearchIndexEntry` when signature differs.
13. **`item/completed` canonical params:** `emitAssistantCompletedOnce` always emits bridge `assistantItem.id` + hydrated text — never foreign SSE `part.id`.
14. **`item/completed` transport tier:** Classify as `STREAM`; pin per `(threadId, turnId)` alongside `turn/completed`.
15. **Completion fingerprint precedence:** Per-turn store first when `turnId` present; both stores updated; per-turn cleared on turn finish.
16. **CAT push state machine:** Router `lastEmittedCatalogFingerprint` + `maybeEmitCatalogUpdated` at catalog warm **and** `listProviderModelsForModelList`.
17. **Reducer scope:** Service-layer History guards are MSG-3 primary; existing `shouldMergeExactAssistantReplay` is sufficient render safety net.

---

## PR Plan

| PR | Title | Depends | Tests |
|----|-------|---------|-------|
| **MSG-1** | Bridge: `item/completed` idempotency + canonical params (all paths) | — | `opencode-provider.test.js` |
| **MSG-2** | Bridge: priority outbound buffer + `item/completed` STREAM pin | — | `secure-transport.test.js` |
| **MSG-3** | iOS: deferred sync + completion/history dedupe + Codex regression | MSG-1 (P0 sign-off) | `CodexServiceImmediateSyncTests`, `CodexServiceIncomingRunIndicatorTests`, `CodexServiceHistoryMergeTests` |
| **SKILL-1** | Bridge: unified skills merge + contract | — | `runtime-provider-router.test.js` |
| **SKILL-2** | iOS: full list + dual logos + header count | SKILL-1 | `CodexSkillsListDecodeTests`, new `TurnViewModelSkillsAutocompleteTests` |
| **CAT-1** | Bridge: warm inventory + revision + push | — | `runtime-provider-router.test.js` |
| **CAT-2** | iOS: sequential refresh + push handler | CAT-1 | `OpenCodeProviderInventoryTests` |

**Merge order:** `MSG-1 → MSG-2 → MSG-3` ‖ `SKILL-1 → SKILL-2` ‖ `CAT-1 → CAT-2` (parallel tracks).

### Exact file lists per PR

#### MSG-1 — Bridge: `item/completed` idempotency (all paths)

| File | Change |
|------|--------|
| `phodex-bridge/src/opencode-provider.js` | `emitAssistantCompletedOnce` with canonical param normalization; `finalized` on `assistantItem`; gate hydrate, completeTurn, SSE `item/completed` forward, `executeTurn` `finally` hydrate (`:1477–1479`) |
| `phodex-bridge/test/opencode-provider.test.js` | Parametrized: SSE (foreign `itemId`) + hydrate + poll + `turn/completed` session.idle + `finally` → exactly 1 `item/completed` per turn, always bridge `itemId` |

#### MSG-2 — Bridge: priority outbound buffer

| File | Change |
|------|--------|
| `phodex-bridge/src/secure-transport.js` | `classifyOutboundPriority` (`item/completed` → `STREAM`), `extractTurnPinKey` (includes `item/completed`), tiered trim, per-turn pin for `item/completed` + `turn/completed`, env guards, extended drop log |
| `phodex-bridge/test/secure-transport.test.js` | Cap pressure: RPC dropped first; `item/completed` + `turn/completed` pair retained per turn; pin parsing flat/nested |

#### MSG-3 — iOS: timeline sync dedupe

| File | Change |
|------|--------|
| `CodexMobile/CodexMobile/Services/CodexService.swift` | `deferredSyncTasks`, `assistantCompletionFingerprintByTurn` |
| `CodexMobile/CodexMobile/Services/CodexService+Sync.swift` | `requestDeferredSync`, `cancelDeferredSync` |
| `CodexMobile/CodexMobile/Services/CodexService+Incoming.swift` | `handleTurnStarted`: deferred sync + immediate sync for `isDesktopMirroredTurn`; `handleTurnCompleted` + `handleErrorNotification` cancel; `runtime/catalog/updated` stub deferred to CAT-2 |
| `CodexMobile/CodexMobile/Services/CodexService+Messages.swift` | Per-turn completion fingerprint with thread-store precedence in `completeAssistantMessage`; clear per-turn on `noteTurnFinished` |
| `CodexMobile/CodexMobile/Services/CodexService+History.swift` | Running-thread `.confirmed` user merge (`uniqueUserHistoryMergeIndex`) + assistant merge guards — **primary deliverable** |
| `CodexMobile/CodexMobileTests/CodexServiceImmediateSyncTests.swift` | Deferred sync coalesce + cancel-on-complete; Codex `turn/started` → no immediate `syncThreadHistory`, deferred cancelled on `turn/completed` (`REMODEX_DISABLE_OPENCODE=1`) |
| `CodexMobile/CodexMobileTests/CodexServiceIncomingRunIndicatorTests.swift` | Post-`confirmLatestPendingUserMessage` history merge does not append second user bubble; duplicate completion race |
| `CodexMobile/CodexMobileTests/CodexServiceHistoryMergeTests.swift` | **new** — running-thread `.confirmed` user reconcile; running-thread assistant guard |

#### SKILL-1 — Bridge: unified skills merge

| File | Change |
|------|--------|
| `phodex-bridge/src/runtime-provider-router.js` | `mergeSkillsAcrossProviders`; flat `skills[]` path; export for tests |
| `docs/contracts/bridge-rpc.md` | Document `providers[]`, case-fold, primary provider |
| `phodex-bridge/test/runtime-provider-router.test.js` | Overlap → `providers: ["codex","opencode"]`; both response shapes; OpenCode disabled regression |

#### SKILL-2 — iOS: skills full list + dual logos

| File | Change |
|------|--------|
| `CodexMobile/CodexMobile/Models/CodexSkillMetadata.swift` | `providers`, `providerIds`, `CodingKeys`, `Hashable` |
| `CodexMobile/CodexMobile/Services/CodexService+ThreadsTurns.swift` | Remove iOS cross-provider collapse in `listSkills()` |
| `CodexMobile/CodexMobile/Views/Turn/Core/TurnViewModel.swift` | `skillFullListItems`, `skillTotalCount`; `providersSignature` on `TurnSkillSearchIndexEntry`; cache invalidation on signature mismatch |
| `CodexMobile/CodexMobile/Views/Turn/Composer/TurnComposerViewState.swift` | Autocomplete state fields |
| `CodexMobile/CodexMobile/Views/Turn/Composer/TurnComposerHostView.swift` | Plumb state; sheet uses `skillFullListItems` |
| `CodexMobile/CodexMobile/Views/Turn/Composer/TurnComposerView.swift` | Pass `totalCount` to panel; DEBUG previews |
| `CodexMobile/CodexMobile/Views/Turn/Composer/SkillAutocompletePanel.swift` | `totalCount` param; dual logos |
| `CodexMobile/CodexMobile/Views/Turn/Composer/BridgeSkillsFullListSheet.swift` | Dual logos |
| `CodexMobile/CodexMobileTests/CodexSkillsListDecodeTests.swift` | `providers[]` decode |
| `CodexMobile/CodexMobileTests/TurnViewModelSkillsAutocompleteTests.swift` | **new** — query-filter count vs inline cap; cached single-provider index → refreshed dual-provider triggers rebuild |

#### CAT-1 — Bridge: catalog warm + revision + push

| File | Change |
|------|--------|
| `phodex-bridge/src/runtime-provider-router.js` | `lastEmittedCatalogFingerprint`, `maybeEmitCatalogUpdated`, `computeCatalogFingerprint`, `computeCatalogRevision`, `shortHash`, `shouldWarmProviderInventory`; hooks in `buildCatalogOpenCodeRuntime` + `listProviderModelsForModelList` |
| `phodex-bridge/src/bridge.js` | Add `runtime/catalog/updated` to `NOTIFY_FORWARD_METHODS` |
| `phodex-bridge/test/runtime-provider-router.test.js` | Empty inventory → warm → full; `REMODEX_CATALOG_WARM_INVENTORY=0`; catalog warm push; identical `model/list` no push; auth change pushes once |

#### CAT-2 — iOS: catalog freshness consumer

| File | Change |
|------|--------|
| `CodexMobile/CodexMobile/Services/CodexService.swift` | `lastOpenCodeCatalogRevision`, `catalogRefetchDebounceTask` |
| `CodexMobile/CodexMobile/Services/CodexService+RuntimeConfig.swift` | `refreshRuntimeMetadataSequential`; revision compare after fetch |
| `CodexMobile/CodexMobile/Services/CodexService+Connection.swift` | Sequential refresh in `flushPendingRuntimeOptionRefreshIfPossible` |
| `CodexMobile/CodexMobile/Services/CodexService+Incoming.swift` | `handleRuntimeCatalogUpdated` |
| `CodexMobile/CodexMobile/Models/OpenCodeRuntimeDetails.swift` | `catalogRevision` |
| `CodexMobile/CodexMobile/Views/Settings/OpenCodeProvidersSettingsView.swift` | Sequential helper in `.task` |
| `CodexMobile/CodexMobile/Views/Turn/Composer/TurnComposerRuntimeActions.swift` | Sequential `refreshModels` |
| `CodexMobile/CodexMobile/Views/Settings/SettingsRuntimeDefaultsCard.swift` | Sequential `.task` |
| `CodexMobile/CodexMobileTests/OpenCodeProviderInventoryTests.swift` | `catalogRevision` decode |

### Device E2E verification

| Step | Action | Pass criterion |
|------|--------|----------------|
| **D1** | OpenCode thread; send "Hey" once | 1 user + 1 assistant bubble |
| **D2** | Airplane mode 5s mid-turn | No duplicates after reconnect |
| **D3** | `grep opencode_item_completed\|opencode_turn_hydrated` | ≤1 `item/completed` per turn from bridge |
| **D4** | Type `$` | Inline ≤12; header = filtered total |
| **D5** | Tap "See all" | Uncapped filtered list (>12 when applicable) |
| **D6** | Overlap skill | Two logos |
| **D7** | Fresh QR → providers | Full count first open |
| **D8** | `grep provider_inventory_built` | First warm catalog `authenticated > 0` |
| **D17** | `REMODEX_DISABLE_OPENCODE=1` | Codex unchanged; Codex thread `turn/started` → deferred sync only (no duplicate user bubble); mirrored desktop turn still catches up within 2s |

---

## Refinement Audit (pass 5 — review response)

Addresses all 9 open issues from `/tmp/grok-design-review-3aee9b15.md`.

| Issue | Severity | Resolution |
|-------|----------|------------|
| 1 | High | `emitAssistantCompletedOnce` canonical param normalization (`itemId`, `item` payload, text merge) + foreign-`itemId` test |
| 2 | High | `item/completed` → `STREAM` tier; pin per `(threadId, turnId)` alongside `turn/completed` |
| 3 | Medium | `.sent` → `.confirmed`; `uniqueUserHistoryMergeIndex` guard for post-confirm rows |
| 4 | Medium | Desktop-mirrored immediate sync + Codex `CodexServiceImmediateSyncTests` + D17 matrix expansion |
| 5 | Medium | `lastEmittedCatalogFingerprint` + `maybeEmitCatalogUpdated` at catalog warm + `listProviderModelsForModelList` |
| 6 | Low | 4 refresh sites; `refreshProviders: true` standardized in shared helper |
| 7 | Low | Reducer PR narrowed — reference existing `shouldMergeExactAssistantReplay`; History.swift primary |
| 8 | Low | `providersSignature` cache bust on `TurnSkillSearchIndexEntry` |
| 9 | Low | Per-turn vs per-thread fingerprint precedence documented in pseudocode |

---

*End of refined design document (pass 5).*