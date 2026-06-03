# Design Document: iPad Remodex OpenCode “Hey” Turn — Investigation & Contingent Fix Plan

| Field | Value |
|-------|-------|
| **Artifact ID** | `23b5b552` |
| **Date** | 2026-06-04 (rev 4 — user context) |
| **Repro class (confirmed)** | **CLASS-C** — thinking first, then error footer |
| **Thread metadata (confirmed)** | **Full ownership** on iPad (`opencode` + model, not model-only) |
| **Author** | Systems architecture (investigation-first) |
| **Workspace** | `$REMODEX_WORKSPACE/repos/remodex-opencode` |
| **Canonical hypothesis IDs** | **This document** — map exploration packs via table below |
| **Exploration inputs** | `/tmp/grok-design-explore-bridge-23b5b552.md`, `...-ios-23b5b552.md`, `...-transport-23b5b552.md`, `...-evidence-23b5b552.md` |
| **Primary goal** | **Prove** exact root cause before treating any fix as confirmed |
| **Out of scope** | E2EE protocol / encryption changes; replay **buffer policy** changes unless H7 PROVEN **and** trim observed (see KD3, Branch B) |
| **Schedule dependency** | Dedicated **iPad + Mac LAN pair** owner for ≥3 correlated bundles (~8–14 engineering days Phases 0–3) |

---

## Problem Statement

When a user sends a short message (e.g. **“Hey”**) on **iPad Remodex** using **OpenCode Zen** with model **Big Pickle**, the **Mac-side agent often completes successfully** and the user may receive a **completion notification** showing correct assistant text. On the **iPad chat UI**, one of two failures appears:

1. **RPC error `-32000`** with message: *“This chat is tied to opencode. Start a new chat to switch providers.”*
2. **Stuck “Remodex is thinking”** with **no assistant prose** in the timeline.

**User-confirmed repro (Kartik, 2026-06-04):** On the failing OpenCode Zen / Big Pickle thread, the iPad shows **full ownership** in thread metadata (not model-only). UI sequence is **CLASS-C**: **“Remodex is thinking” first**, then thinking **stops** and the **RPC -32000** footer appears — not footer-only. A correlated log bundle with PR1/PR2 is **committed** on the next repro.

These symptoms are **not yet tied to a single proven root cause** on the wire (H1 PROVEN rule still requires `requestedProvider` + `storedProvider` log lines). Parallel exploration and `/tmp/remodex-local.log` show the Mac bridge can complete and forward lifecycle events in **some** runs while the iPad still errors — **same `threadId` for notification vs chat remains to be confirmed** in the next captured bundle.

**Non-goals for Phase 0:** Shipping a “likely” client or bridge fix without log correlation IDs linking iPad `turn/start` → bridge ownership → relay notifications → iOS UI state.

---

## Evidence from Screenshots

| Image | What it proves | What it does **not** prove |
|-------|----------------|----------------------------|
| **image-0b7f59d2** (Notification Centre) | OpenCode push: title “Greeting”, body includes User: **Hey**, Assistant: **Hey. What's up?**; “Agent is ready for input” | iPad received `turn/completed` over relay; iPad `turn/start` succeeded; same `threadId`/`turnId` as error chat |
| **image-4ffad86a** (iPad chat error) | User bubble “Hey” (00:06); **empty assistant area**; footer RPC **-32000** with **thread_provider_mismatch** userMessage; composer shows zen/Beta/**Big Pickle** pills | Whether Mac turn ran on **same** thread; whether notification used **push tracker** vs local `notifyRunCompletionIfNeeded`; whether **composer display** matches **RPC** `modelProvider` |
| **image-459daae9** (stuck thinking) | Same session can show **“Remodex is thinking”** without assistant text (earlier moment) — **CLASS-B** candidate | Whether `turn/start` failed or succeeded; whether mirror/running flags stuck **after** failure |

**Cross-channel inference (HYPOTHESIS):** Notification success + chat failure implies **decoupled channels** (push/APNs or local notification from mirrored `turn/completed` vs failed local `turn/start`). **OPEN** until one correlated log bundle ties channels to one `threadId`.

---

## Repro Classes (RCA taxonomy)

Screenshots may reflect **different moments** on the same thread. Phase 2 labels hypotheses **per class**; a single session may have **two PROVEN labels** if timelines differ.

| Class | Symptom | Example | Primary hypotheses |
|-------|---------|---------|-------------------|
| **CLASS-A** | Footer RPC -32000 (`thread_provider_mismatch`) | image-4ffad86a | H1, H12 (with footer) |
| **CLASS-B** | Stuck “Remodex is thinking”, **no** -32000 footer | image-459daae9 | H2, H3, H5, H6, H7, H11, H12 |
| **CLASS-C** | Both footer and stuck thinking in one session timeline | 4ffad86a + 459daae9 | H1 + H12; bisect **order** by timestamp |
| **CLASS-C (confirmed)** | **Thinking → then error footer** (same send) | User repro 2026-06-04 | **Primary:** H2/H12 during thinking phase, then **H1** (or H1b) at `turn/start` failure; **not** “footer without prior thinking” |

**Confirmed symptom order:** `send` → **thinking** → (no assistant text) → thinking clears or stalls → **-32000 footer**. This rules out CLASS-A-only interpretation of the screenshot pair and prioritizes **timed correlation**: mirror/delta/`turn/started` during thinking, then `thread_provider_mismatch` on the same `threadId`.

**Phase 2 exit (revised):** At least one hypothesis **PROVEN** per **class captured** (not “exactly one” globally). For this repro, expect **up to two PROVEN labels** on one timeline: e.g. **H12 or H2** (thinking phase) + **H1/H1b** (footer phase). Remaining hypotheses **DISPROVEN** or **contributing**.

---

## Hypothesis ID mapping (canonical = this doc)

Exploration packs used different numbering. **Use design-doc IDs in PRs and logs.**

| Design (canonical) | Bridge explore (`...-bridge-23b5b552`) | iOS explore (`...-ios-23b5b552`) |
|--------------------|----------------------------------------|----------------------------------|
| **H1** Provider mismatch | H4 (RPC -32000) | H1 |
| **H2** Stuck thinking / delivery desync | H1/H2 (hydration/SSE) partial | H2 |
| **H3** iOS delta drop (no turnId) | H3 | — |
| **H5** `session.idle` before messages | H2 | — |
| **H6** Sparse SSE / poll hydrate | H1 | — |
| **H7** Transport / replay gap | H7 | — |
| **H8** Push vs chat decoupling | — | H (push) |
| **H12** Post-failure mirror reinstatement | — | H3 |

---

## Observed vs Expected Behavior

| Dimension | Observed (reports + screenshots) | Expected (product) |
|-----------|----------------------------------|---------------------|
| Mac / OpenCode | Turn completes; assistant text exists | Same |
| Notification | User sees assistant snippet | Optional; must not contradict chat |
| iPad timeline | User message visible; assistant empty or missing | Streaming or bulk-hydrated assistant text |
| iPad footer | RPC -32000 provider mismatch **or** none | No error on successful turn |
| Running UI | “Remodex is thinking” may persist | Cleared on `turn/completed`, failed `turn/start`, or authoritative idle |
| Provider | Composer shows OpenCode Zen / Big Pickle | `turn/start` `modelProvider` matches thread ownership (`opencode`) |
| Composer vs RPC | Pills may show OpenCode while RPC sends `codex` | **Same** provider on `visibleSelectedModelIDForComposer` and `buildTurnStartRequestParams` |
| Thread metadata (user) | **Full ownership** visible on failing thread | `turn/start` must use stored `opencode` — if wire still sends `codex`, bug is **send-path / composer split (H1b)**, not missing `modelProvider` on thread list |

**CLASS-C with thinking → error (confirmed):** Phase 1 is unlikely to be “user never had `modelProvider`” (user sees full ownership). Investigate instead: (1) **thinking phase** — Mac mirror/`turn/started`/deltas without iPad assistant rows (H2, H3, H12); (2) **footer phase** — `turn/start` or follow-up RPC rejected with `thread_provider_mismatch` despite UI metadata (H1b: `runtimeModelProviderForTurn` ≠ displayed ownership, or stale `threadId` on wire). `handleTurnStartFailure` clears `desktopMirroredRunning`; **thinking before footer** fits **send in flight + mirror during attempt**, then failure — not footer-only mismatch.

---

## System Context

### Topology

```
iPad (CodexMobile + E2EE) ←→ Relay (opaque WS forward) ←→ Mac Bridge (phodex-bridge) ←→ OpenCode SDK (SSE + HTTP)
                                      ↓
                            Push notification service (optional, independent)
```

### Sequence (happy path vs failure paths)

```mermaid
sequenceDiagram
    participant iPad as iPad CodexMobile
    participant Relay as relay.js
    participant Bridge as phodex-bridge
    participant OC as OpenCode provider
    participant Push as Push tracker / APNs

    iPad->>Relay: E2EE turn/start (modelProvider, model)
    Relay->>Bridge: encrypted JSON-RPC
    Bridge->>Bridge: resolveThreadOwnershipMismatch
    alt H1: provider mismatch
        Bridge-->>iPad: RPC -32000 thread_provider_mismatch
        Note over iPad: Footer; thinking may be isSendInFlight or H12 mirror
    else ownership OK
        Bridge->>OC: turnStart → executeTurn
        OC-->>Bridge: turn/started
        Bridge-->>iPad: notify turn/started
        OC-->>Bridge: SSE deltas (sparse?) + poll hydrate
        Bridge-->>iPad: item/agentMessage/delta
        OC-->>Bridge: turn/completed (poll or SSE)
        Bridge-->>iPad: notify turn/completed
        Bridge->>Push: mirror completion (optional)
        Push-->>iPad: OpenCode push (may succeed if chat failed)
        iPad->>iPad: appendAgentDelta / markTurnCompleted
    end

    alt H7: mobile disconnect mid-turn
        iPad-xRelay: WS close 1006 (no close frame) or heartbeat terminate
        Note over OC,Bridge: Mac continues; secure replay buffers (500 msg / 10 MiB)
        iPad->>Relay: reconnect + resumeState(lastAppliedBridgeOutboundSeq)
        alt replay gap or trim
            iPad->>iPad: empty assistant + stuck running
        end
    end
```

### Key code anchors (verified in tree)

| Component | Path | Role |
|-----------|------|------|
| Ownership store | `phodex-bridge/src/thread-ownership-store.js` | Persists provider per `threadId` |
| Ownership mismatch | `phodex-bridge/src/runtime-provider-router.js` | Emits **-32000** + `thread_provider_mismatch` |
| Turn delivery | `phodex-bridge/src/opencode-provider.js` | SSE, poll (2s), watchdog (120s), `session.idle` early return |
| Thread public shape | `phodex-bridge/src/opencode-models.js` (`publicThread`) | Sets `modelProvider: OPENCODE_PROVIDER_ID` |
| Notify logging | `phodex-bridge/src/bridge.js` | `extractThreadId`/`extractTurnId` omit delta methods |
| Relay | `relay/relay.js` | Fan-out; mobile role from `x-role` / `?role=` |
| E2EE replay | `secure-transport.js`, `CodexService+SecureTransport.swift` | Buffer/replay; trim at 500 msgs / 10 MiB |
| Composer display | `CodexService+RuntimeConfig.swift` (`visibleSelectedModelIDForComposer`) | UI model pills |
| Turn RPC params | `CodexService+ThreadsTurns.swift` (`runtimeModelProviderForTurn`) | Wire `modelProvider` |
| iOS deltas | `CodexService+IncomingAssistant.swift` | `requiresTurnId: true` |
| Thinking UI | `TurnTimelineView.swift`, `CodexService+Sync.swift` | `isSendInFlight` + running sets |

### Investigator onboarding (PROVEN reference facts)

- **P3:** Sample Mac session forwarded lifecycle notifies while mobile connected — **not** the screenshot error session.
- **P5:** Null delta IDs in `bridge_notify_forward` are **logging only**; wire payload enriched in `opencode-provider.js:980-987`.
- **P7:** Push/local notification can succeed without iPad `turn/start` success — do not use notification as chat health signal.

---

## Alternatives Considered

| Option | Description | Why not chosen (now) |
|--------|-------------|----------------------|
| **1 — Instrument only (chosen)** | PR1+PR2, Phase 0–2, then **one** fix PR | KD1: screenshot repro ≠ proven same session as Mac success log; avoids masking H1 with UX-only clears |
| **2 — Hotfix H1 client** | Force `opencode` on `turn/start` immediately | Risk: fixes symptom without proving metadata gap (bridge list vs iOS persistence); may hide PR4 router merge bugs |
| **3 — Bridge-only metadata** | PR4 only | Insufficient if iOS sends `codex` while composer shows OpenCode (composer/RPC split) |
| **4 — Disable mirror on mismatch** | Stop desktop mirror events after `thread_provider_mismatch` | Does not fix H1; could help H12 but needs proof of ordering |
| **5 — Server idempotent `turn/start`** | Dedupe by client token | Branch F only after H10 PROVEN; larger API surface |

**KD1** selects Option 1. Option 2 may be approved **only** after H1 PROVEN per rule below.

---

## Investigation Strategy

Investigation is **phased**. Each phase has **exit criteria**. Do not advance to “confirmed fix” until Phase 2 signs off (checklist at end of Phase 2).

### Phase 0 — Repro matrix & baseline capture (1–2 days)

**Prerequisites:** Dedicated iPad + Mac on same LAN; owner available for ≥3 correlated bundles.

**Actions**

1. Start E2E **immediately** using `docs/operations/device-e2e-checklist.md` (steps 2b, 4–5, 6–7) — does not wait for PR8.
2. Record **build identity:** Mac `git rev-parse HEAD` in `phodex-bridge`; iPad app build number / git SHA from About or CI.
3. Repro script: new OpenCode thread → **Zen / Big Pickle** → **“Hey”** → screenshot + wall-clock time.
4. **Relay role:** Log `x-role` / `?role=` on iPad connect; run **iPhone control** on same network (same checklist).
5. Collect **one correlated bundle** per run:

| Artifact | Required fields |
|----------|-----------------|
| Mac log | `threadId`, `turnId`, `bridge_turn_start_audit`, `bridge_notify_forward`, `opencode_turn_*` |
| Relay | `closeCode`, `closeReason`, heartbeat `terminated` if any |
| iPad trace | PR2 fields when available; else Xcode console |
| **E2EE seq** | iPad persisted `lastAppliedBridgeOutboundSeq` at disconnect + after `resumeState`; bridge `bridgeOutboundSeq` head/tail; any `bridge_outbound_trim_dropped` |
| Metadata audit | Raw `thread/list` JSON at bridge egress; decoded `CodexThread` on iPad (`model`, `modelProvider`) |
| Composer vs RPC | One log line: `visibleSelectedModelIDForComposer`, `runtimeModelProviderForTurn`, `params.modelProvider` |

6. Repro matrix row: **“composer shows opencode + RPC sends codex”** (explicit).

**Exit criteria**

- [ ] ≥3 iPad repros with **matching** `threadId` across Mac log + iPad trace (**next repro committed** with PR1/PR2)
- [x] **CLASS-C** confirmed for primary repro (thinking → error); still collect **CLASS-B** bundle if a stuck-only repro appears without footer
- [ ] Seq + trim events captured for at least one CLASS-B or mid-turn background repro

### Phase 1 — Instrumentation & observability (2–4 days)

**Actions** — see Logging section (PR1, PR2).

**Exit criteria**

- [ ] CLASS-A: `bridge_turn_start_audit` shows `requestedProvider` + `storedProvider` on same `threadId`
- [ ] CLASS-B: running snapshot includes `isSendInFlight`, `protectedRunningFallback`, `activeTurnId`, `desktopMirroredRunning`, **timestamped mirror method** after any failure
- [ ] Composer vs RPC line present on every send

### Phase 2 — Hypothesis bisection (3–5 days)

| Order | Cluster | Bisect method |
|-------|---------|---------------|
| 1 | **H1** | Wire `modelProvider` vs ownership store; **do not** mark PROVEN from footer text alone |
| 2 | **H12** | Ordered logs: `handleTurnStartFailure` → next mirror/delta/`markThreadAsRunning` |
| 3 | **H2/H3/H7** | Notify forward + iOS receive/drop + seq at disconnect |
| 4 | **H5/H6** | `completionSource`, `opencode_turn_hydrated`; CLASS-B iPad without `handleTurnCompleted` |
| 5 | **H4/H10** | `error.data.errorCode` |

**H1 PROVEN rule (mandatory):** Requires **both** log lines on same `threadId`: (a) iPad or bridge `requestedProvider` ≠ `storedProvider`, and (b) `errorCode: thread_provider_mismatch` on that `turn/start` **or** pre-reject audit `mismatch: true`. Footer message alone is **insufficient**.

**H7 bisect note:** Forced background may yield **1006** without close frame; distinguish relay **heartbeat terminate** (server) vs client background (grep relay log `heartbeat terminated` vs `msSinceLastPong`). `simulated-pairing-reconnect.test.js` covers replay, not 1006 specifically.

**Phase 2 sign-off checklist (blocks PR3–PR7)**

- [ ] Repro class(es) documented: CLASS-A / B / C
- [ ] Hypothesis ID(s) marked PROVEN with log line citations
- [ ] Phase 2 owner signature / ticket link
- [ ] Confirmed: **PR merge rules (tranche)** below — primary ≤1, companions per proven hypothesis, PR4 only if audit gap

### Phase 3 — Contingent fix validation (2–3 days)

Apply only the branch matching **PROVEN** hypothesis. Re-run Phase 0 matrix + automated tests.

**Exit criteria**

- [ ] iPad E2E pass per checklist
- [ ] `phodex-bridge && npm test`; targeted XCTest green

---

## Areas to Inspect

### Bridge (`phodex-bridge`)

| Area | Files | Inspect for |
|------|-------|-------------|
| Ownership | `src/runtime-provider-router.js`, `src/thread-ownership-store.js`, `test/thread-ownership-store.test.js` | `turn/start` `codex` vs stored `opencode` |
| OpenCode turns | `src/opencode-provider.js`, `src/opencode-client.js` | `session.idle`; poll 2s; watchdog 120s |
| Thread payload | `src/opencode-models.js` (`publicThread`), router merge in `runtime-provider-router.js` | `modelProvider` at egress vs iPad decode |
| Forwarding | `src/bridge.js` | `bridge_notify_forward` |
| Replay | `src/secure-transport.js` | trim, `resumeState`, `bridge_outbound_trim_dropped` |
| Push | `src/push-notification-tracker.js`, `test/push-notification-opencode.test.js` | H8 decoupling |
| Tests | `test/opencode-provider.test.js`, `relay/simulated-pairing-reconnect.test.js` | idle-before-messages gap |

### iOS (`CodexMobile`)

| Area | Files | Inspect for |
|------|-------|-------------|
| Turn RPC | `CodexService+ThreadsTurns.swift` | `sendTurnStart` before RPC running flags |
| Provider | `CodexService+RuntimeConfig.swift`, `CodexModelOption.swift`, `CodexThread.swift` | nil `modelProvider` → `codex`; composer vs `runtimeModelProviderForTurn` |
| Incoming | `CodexService+Incoming.swift`, `+IncomingAssistant.swift` | H12 ordering after failure |
| Running state | `CodexService+Messages.swift`, `+Sync.swift` | `clearRunningState` clears mirror; `isSendInFlight` in `TurnViewModel` |
| Disconnect | `CodexService+Connection.swift` | `finalizeAllStreamingState`, seq reset |
| UI | `TurnTimelineView.swift`, `TurnView.swift` | footer vs sticky thinking |

### Relay / ops

| Path | Inspect for |
|------|-------------|
| `relay/relay.js` | `closeCode`, role header, heartbeat terminate |
| `docs/operations/device-e2e-checklist.md` | iPad 2b, 4–5 |
| `/tmp/remodex-local.log` | Session `14ca1f62` — not screenshot repro |

---

## Failure Mode Catalog (ranked)

| ID | Hypothesis | Label | Evidence summary | Disprove / prove |
|----|------------|-------|------------------|------------------|
| **H1** | iPad `turn/start` sends non-`opencode` `modelProvider` for `opencode`-owned thread | **HYPOTHESIS** (footer maps to this) | Mismatch **message** PROVEN; `normalizedProvider(nil)→codex` PROVEN; **wire** `codex` on failing turn **OPEN** | H1 PROVEN rule (both providers logged) |
| **H1b** | Composer shows OpenCode (`visibleSelectedModelIDForComposer`) but RPC uses `runtimeModelProviderForTurn` → `codex` | **HYPOTHESIS** | Pills in screenshot; paths differ in code **PROVEN** | PR2 one-line composer vs RPC on send |
| **H2** | Stuck thinking: no `turn/completed` on iPad or running flags not cleared | **HYPOTHESIS** | Mac forward in sample log for other session **PROVEN** | CLASS-B bundle + iOS `handleTurnCompleted` |
| **H3** | iOS drops delta without `turnId` | **HYPOTHESIS** (low) | `requiresTurnId` **PROVEN**; provider enrich **PROVEN** | iOS drop reason log |
| **H4** | Other -32000 (`thread_turn_active`, watchdog, …) | **OPEN** for screenshot | Screenshot text matches **only** H1 | `error.data.errorCode` |
| **H5** | `session.idle` before `getMessages` has text | **HYPOTHESIS** | Early return **PROVEN** `opencode-provider.js:1150-1154` | `completionSource: session.idle` + delayed `turn/completed` |
| **H6** | Sparse SSE; bulk hydrate + `turn/completed` | **HYPOTHESIS** | `poll_messages`, `hadStreamedText:false` in sample **PROVEN** | iPad repro + SSE event log |
| **H7** | 1006 / replay gap / trim | **HYPOTHESIS** | Buffer limits **PROVEN**; mid-turn trim **OPEN** | Phase 0 seq bundle |
| **H8** | Push succeeds while chat RPC failed | **HYPOTHESIS** | Channels independent **PROVEN** (P7) | Push `threadId` vs failed `turn/start` (PR2) |
| **H9** | Null ids in `bridge_notify_forward` only | **PROVEN** (logging) | See P5 | PR1 |
| **H10** | Duplicate `turn/start` while active | **OPEN** | Reject path **PROVEN** in code | `thread_turn_active` on retry |
| **H11** | Canonical reconcile lag | **OPEN** | Reconcile hooks exist | queue depth on stuck iPad |
| **H12** | **Post-failure mirror reinstatement:** after `handleTurnStartFailure` + `clearRunningState`, late `item/agentMessage/delta` / mirror calls `markThreadAsRunning` | **HYPOTHESIS** | `clearRunningState` clears mirror **PROVEN**; iOS explore H3 | Timestamped ordered logs; XCTest inject delta after failure |

### PROVEN facts (do not re-litigate)

| ID | Finding |
|----|---------|
| **P1** | Footer originates in bridge `thread_provider_mismatch` |
| **P2** | Runtime failures use JSON-RPC **-32000** |
| **P3** | Sample Mac session forwarded notifies while mobile connected (**≠ screenshot repro**) |
| **P4** | Sample completion `source: poll_messages` |
| **P5** | Null delta thread/turn in notify log = logging gap; wire enriched |
| **P6** | No `hasMobile` in bridge; use relay client count |
| **P7** | Push can succeed without iPad `turn/start` success |

---

## Logging & Instrumentation Plan

### Correlation ID scheme

| ID | Scope |
|----|-------|
| `relaySessionId` | `session#…` |
| `threadId` / `turnId` | OpenCode ids |
| `rpcRequestId` | JSON-RPC `id` on `turn/start` |
| `bridgeOutboundSeq` | E2EE replay cursor |

### PII / content denylist (PR1 + PR2)

**Do not log:** `input`, `content`, `message`, `delta`, `text`, `textDelta`, `prompt`, user message bodies.  
**Allowed:** ids, providers, models, `errorCode`, `status`, `completionSource`, `hadStreamedText`, seq numbers, flags, method names.

### Bridge (PR1)

1. Fix `extractThreadId`/`extractTurnId` for `item/agentMessage/delta`, `item/completed`.
2. `bridge_turn_start_audit`: `{ event, threadId, rpcRequestId, requestedProvider, storedProvider, mismatch }`.
3. `bridge_ownership_mismatch` on reject.
4. Phase 1 **metadata audit** helper: log hashed length + `modelProvider` field presence on `thread/list` items (no thread titles).

### iOS (PR2) — acceptance spec

| Requirement | Detail |
|-------------|--------|
| Guard | `#if DEBUG` only, or `REMODEX_IOS_RPC_TRACE=1` in **Debug** scheme; **no-op in Release** |
| Trigger | Environment variable read once at launch |
| Log level | `os_log` / `Logger` debug, subsystem `com.remodex.codex.rpc-trace` |
| **turn/start** line | `threadId`, `rpcId`, `visibleComposerModelId`, `runtimeModelProviderForTurn`, `thread.model`, `thread.modelProvider`, `params.modelProvider` |
| **Result** line | `errorCode`, `rpcCode`, `userMessage` (no body) |
| **Delta drop** | `reason`: `missing_turn_id` \| `missing_delta` |
| **Running snapshot** | `isSendInFlight`, `protectedRunningFallback`, `activeTurnId`, `desktopMirroredRunning`, `lastIncomingMethod` + timestamp |
| Redaction | Same denylist as bridge |

### Relay / secure-transport

- Disconnect: `closeCode`, `lastAppliedBridgeOutboundSeq`, buffer depth, `bridge_outbound_trim_dropped`.
- Reconnect: `resumeState` cursor vs replay count.

---

## Root-Cause-Analysis Methodology

### Repro matrix

| Variable | Values |
|----------|--------|
| Device | iPad (primary), iPhone (control, same network) |
| Relay role | `iphone` / `ipad` header (confirm actual) |
| Thread | new OpenCode vs continued |
| Composer vs RPC | opencode/opencode vs opencode/codex vs codex/codex |
| Network | stable LAN vs background (1006) |
| Class target | CLASS-A, CLASS-B, or CLASS-C timeline |

### Bisect decision tree

```
Footer thread_provider_mismatch?
  YES → CLASS-A → H1 (wire proof required) + H12 if also thinking
  NO → CLASS-B → H2, H3, H5, H6, H7, H11, H12
Mac turn/completed forwarded?
  YES + iPad stuck → H2, H3, H7
  NO → H5, H6 (bridge); only if CLASS-B includes Mac-only repro
Push with assistant text?
  YES + chat bad → H8 (+ primary class hypothesis)
```

---

## Validation Strategy

### Device E2E (post-fix)

Per `docs/operations/device-e2e-checklist.md` steps 1–7 + OpenCode section.

### Success metrics

| Metric | Definition |
|--------|------------|
| Provider errors | **0** `thread_provider_mismatch` on legitimate OpenCode threads |
| Assistant text | Non-empty for completed turns on iPad |
| Thinking clearance | Indicator clears within **2s of iOS-received `turn/completed`** or within **2s of `handleTurnStartFailure`** — **not** Mac-side `opencode_turn_completed` (poll may delay Mac forward up to ~2s) |
| CLASS-B | No infinite thinking &gt;30s without terminal event |

---

## Regression-Testing Strategy

### Bridge (`npm test`)

| Suite | Guards |
|-------|--------|
| `runtime-provider-router.test.js` | ownership mismatch |
| `thread-ownership-store.test.js` | store get/set |
| `opencode-provider.test.js` | hydration; **add** `session.idle` before messages (~514 gap) |
| `opencode-client.test.js` | delta fields |
| `relay/simulated-pairing-reconnect.test.js` | mid-turn replay |
| `secure-transport.test.js` | trim edge |
| `push-notification-opencode.test.js` | OpenCode push path; manual script: push `threadId` vs failed RPC trace |

### iOS (XCTest)

| Test | Purpose |
|------|---------|
| `CodexThreadRuntimeOverrideTests` | thread **with** `modelProvider: opencode` |
| **New:** `testNilModelProvider_withoutOwnershipSource_returnsCodex` | **(a) Pre-fix lock:** `model = "big-pickle"`, `modelProvider = nil`, no `thread/read` / ownership mock → `runtimeModelProviderForTurn` and `buildTurnStartRequestParams` use **`codex`** (matches `threadModelIdentity` today) |
| **New:** `testTurnStart_usesThreadReadOwnershipWhenModelProviderNil` | **(b) Post-fix:** same thread shape + mock `thread/read` (or synced ownership) returning `modelProvider: opencode` → wire `modelProvider == "opencode"`; must use **same source as H1 PROVEN logs**, not inference from model id |
| **New:** `testNilModelProvider_modelOnlyAfterPersistenceGap` | **(c) Optional:** only if Phase 0 audit proves iOS lost `modelProvider` while bridge egress OK — assert fix reads ownership from `thread/read`/store, not `"big-pickle"` → `opencode` heuristic |
| **New:** `testTurnStartParamsIncludeThreadModelProvider` | thread with `modelProvider` set → metadata on wire |
| **New:** `testMirrorDeltaAfterTurnStartFailure_runningAndFooter` | Fail `turn/start`, inject `item/agentMessage/delta`; assert footer + thinking per PR6b spec |
| **New:** `testProviderMismatch_clearsRunningFlags` | mismatch error → no `desktopMirroredRunning` |
| `CodexServiceIncomingRunIndicatorTests` | idle vs protected fallback |

### Manual

- Codex-only (`REMODEX_DISABLE_OPENCODE=1`) unchanged
- Push/notification manual correlation script for H8

---

## Risk Analysis

| Risk | Mitigation |
|------|------------|
| Footer-only “H1 proven” | H1 PROVEN rule; Phase 2 sign-off |
| PR6 masks H1 | Gate PR6a/PR6b behind CLASS proof; never merge PR6 before PR1–PR2 |
| PR5 fixes Mac-only stall | PR5 only for CLASS-B + `session.idle` + no iOS `handleTurnCompleted` |
| Replay buffer policy change | **Out of scope** unless H7 PROVEN + trim logged; KD3; security review + rollback plan |
| Over-logging PII | Denylist on PR1/PR2 |
| Schedule slip | Named iPad+Mac pair owner in Phase 0 |

---

## Implementation Plan (contingent on confirmed root cause)

**No product fix until Phase 2 sign-off.**

### Branch A — H1 PROVEN (CLASS-A)

**Confirmed when:** H1 PROVEN rule satisfied.

| Layer | Change |
|-------|--------|
| iOS | If `thread.modelProvider == opencode` or ownership from `thread/read`, force `runtimeModelProviderForTurn`; align `visibleSelectedModelIDForComposer` or block send with CTA |
| iOS | `thread_provider_mismatch` → CTA; **PR6a:** `clearRunningState` on mismatch |
| Bridge | PR4 **only if** Phase 0 audit shows missing `modelProvider` on egress or iOS decode — `publicThread` may already set field; fix router merge / sync persistence |
| Tests | Ownership/`thread/read` XCTest cases **(a)(b)(c)** above; router + `thread-ownership-store` tests; **do not** pass (b) by inferring provider from model id alone |

### Branch B — H2/H7 PROVEN (CLASS-B)

| Layer | Change |
|-------|--------|
| iOS | Reconnect `catchUpRunningThreadIfNeeded`; **PR6b:** suppress mirror `markThreadAsRunning` after local failure until new server `turnId` |
| Bridge | Alert on `bridge_outbound_trim_dropped` |
| Transport | **No buffer resize in Phase 3 by default** (KD3). If H7 PROVEN + trim: separate security-reviewed change with rollback |

### Branch C — H3 PROVEN

| Layer | Change |
|-------|--------|
| iOS | Relax `requiresTurnId` when `threadId` + active turn known; earlier `turn/started` mapping |

### Branch D — H5/H6 PROVEN (CLASS-B, bridge-side)

**Confirmed when:** `session.idle` + no `turn/completed` to iPad within watchdog; **not** sufficient if iPad shows CLASS-A footer only.

| Change | Specification |
|--------|----------------|
| `session.idle` handler | Replace bare `return` at `1152-1154` with **up to 6 hydrate attempts** at **500ms** spacing (3s total) before giving up; then existing 2s poll continues |
| Poll acceleration | On `session.idle`, temporarily set poll interval to **500ms** until `hydrateAssistantFromSessionMessages` succeeds or **10s** elapsed, then restore **2s** |
| Watchdog | Unchanged default **120s** (`REMODEX_OPENCODE_TURN_WATCHDOG_MS`) |
| Log success | `opencode_turn_hydrated`, `completionSource`, `hadStreamedText` |
| Tests | `opencode-provider.test.js` idle-before-messages |

**Do not** ship Branch D for screenshot CLASS-A until CLASS-B repro proves bridge stall on iPad.

### Branch E — H8 PROVEN

PR9 only: gate `notifyRunCompletionIfNeeded` when `lastErrorMessage` set for thread.

### Branch F — H10 PROVEN

Disable send while `thread_turn_active`; optional idempotent `turn/start`.

---

## User-Confirmed Context (2026-06-04)

| # | Question | Answer | Investigation impact |
|---|----------|--------|----------------------|
| U1 | Correlated log bundle (PR1/PR2) on next repro? | **Yes — will capture** | Pending; closes notification vs chat `threadId` (was open Q1) |
| U2 | Thread shows full OpenCode ownership or model-only? | **Full ownership** (`opencode` + model) | **Deprioritize** “nil `modelProvider` → codex” as primary story for this repro; **prioritize H1b** (composer vs `buildTurnStartRequestParams`), wrong `threadId` on wire, or bridge `requestedProvider` ≠ UI |
| U3 | CLASS-A, B, or C? Symptom order? | **CLASS-C** — **thinking first**, then **error footer** | Default tranche after proof: **PR3 + PR6a + PR6b**; Phase 1 must timestamp mirror/delta vs `turn/start` failure |

---

## Open Questions

1. ~~Same `threadId` for notification vs -32000 chat?~~ → **Pending capture (U1)**; user will repro with PR1/PR2
2. ~~Is `modelProvider` missing on bridge egress / iOS persistence?~~ → **Unlikely for this repro (U2)**; audit still required to prove wire `params.modelProvider` vs UI ownership
3. User switched composer without new chat? — still OPEN if footer persists after U2
4. During **thinking phase**, did Mac emit `turn/started` / deltas before iPad `turn/start` failed? — **OPEN**; central for CLASS-C timeline
5. `big-pickle` + `session.idle` ordering? — OPEN (CLASS-B / Mac stall)
6. iPad relay role string vs iPhone control — Phase 0 captures header
7. Mac/iPad builds include `f7bbeac`, `5725731`? → Phase 0 `git rev-parse` + build number
8. **NEW:** Why does `thread_provider_mismatch` fire when iPad thread shows **full opencode ownership**? — wire audit vs `runtimeModelProviderForTurn` / global model override

---

## Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| KD1 | Investigation before fix | No single proven root for screenshot |
| KD2 | **CLASS-A** vs **CLASS-B** tracks | Footer -32000 and stuck-only repro need separate bundles |
| KD3 | No E2EE **protocol** change; buffer policy **out of scope** unless H7+trim | Avoid replay resize without trim proof + security review |
| KD4 | PR1+PR2 before PR3–PR7 | Logging blocked RCA |
| KD5 | Push non-evidence (P7) | H8 |
| KD6 | Branches A–F; **H12** explicit | Mirror-after-failure |
| KD7 | iPad E2E gate | checklist 2b–7 |
| KD8 | **Canonical H-IDs in this doc** | Exploration mapping table |
| KD9 | H1 PROVEN needs wire providers, not footer alone | Footer text maps to H1 but is not sufficient proof |
| KD10 | PR8 runbook skeleton in parallel with Phase 0 | E2E must not wait on observability PRs |
| KD11 | **Tiered PR tranche** (primary + companions) | CLASS-C and Branch A need PR3+PR6a (+PR6b); “one PR only” was too strict |
| KD12 | **User repro = CLASS-C, full ownership** | Default fix tranche after proof: PR3+PR6a+PR6b; investigation targets H1b + H12 before nil-metadata hotfix |

---

## PR Plan

| PR | Title | Files | Deps | Gate |
|----|-------|-------|------|------|
| **PR1** | Bridge notify extractors + turn/start audit | `bridge.js`, `runtime-provider-router.js` | None | **Merge first** |
| **PR2** | iOS RPC trace (DEBUG only) | `+ThreadsTurns.swift`, `+IncomingAssistant.swift`, `+Messages.swift` | None | **Merge first**; spec above |
| **PR8** | Runbook skeleton (correlation template) | `docs/operations/…`, new `opencode-ipad-repro-runbook.md` | None | **Parallel Phase 0**; expand after PR1 fields |
| **PR3** | iOS enforce OpenCode provider on turn/start | `+RuntimeConfig.swift`, `+ThreadsTurns.swift`, tests | Phase 2 **H1 PROVEN** | Branch A |
| **PR4** | Bridge thread metadata (if audit gaps) | `runtime-provider-router.js`, merge paths, `opencode-models.js` | Phase 0 audit + H1 | **Skip if** egress already has `modelProvider` |
| **PR5** | `session.idle` hydrate retry + poll accel | `opencode-provider.js`, tests | **CLASS-B** + H5/H6 PROVEN + no iOS `handleTurnCompleted` | Not for CLASS-A-only repro |
| **PR6a** | Mismatch: clear running + CTA | `+ThreadsTurns.swift`, tests | **H1 PROVEN** | After PR1–PR2 |
| **PR6b** | Mirror-after-failure guard | `+Incoming.swift`, `+Messages.swift`, tests | **H12 PROVEN** | Companion; may ship **with PR6a** when CLASS-C (H1 + H12) |
| **PR7** | Reconnect catch-up | `+Connection.swift`, `+SecureTransport.swift`, `+Sync.swift` | **H7 PROVEN** + Phase 0 seq | Branch B primary |
| **PR9** | Gate completion notification | `+Notifications.swift` | **H8 PROVEN** + PR2 push/`turn/start` correlation | **Last** |

### PR merge rules (tranche)

Applies after Phase 2 sign-off. **PR4 is metadata**, not a primary branch. **PR6a/PR6b are companions**, not primaries.

| Tier | PRs | Rule |
|------|-----|------|
| **Primary (≤1 per tranche)** | **PR3** (H1 / Branch A) **\|** **PR5** (H5–H6 / Branch D) **\|** **PR7** (H7 / Branch B) | Pick the branch matching the **dominant** PROVEN hypothesis for the tranche. Do not merge PR3 + PR5, PR3 + PR7, or PR5 + PR7 in the same tranche. |
| **Metadata (optional)** | **PR4** | Only with **PR3** when Phase 0 audit shows missing `modelProvider` on egress or iOS persistence. Does not count toward the primary limit. |
| **Companions (0–2)** | **PR6a** (H1), **PR6b** (H12) | **PR6a** when H1 PROVEN. **PR6b** when H12 PROVEN. Both allowed when CLASS-C proves both. Companions may ship in the **same tranche** as PR3 (or PR7 if H12 co-proven with H7). |
| **UX (last)** | **PR9** | H8 only; after PR2 correlation. |

**Allowed combinations (examples)**

| Scenario | PROVEN | PRs in tranche |
|----------|--------|----------------|
| CLASS-A | H1 | PR3 + PR6a (+ PR4 if audit gap) |
| CLASS-C | H1 + H12 | PR3 + PR6a + PR6b (+ PR4 if audit gap) |
| CLASS-B delivery | H7 | PR7 (+ PR6b if H12 also proven) |
| CLASS-B bridge stall | H5/H6 (no H1) | **PR5 only** |
| CLASS-B + mismatch footer on retry | H1 + H7 (rare) | **Two tranches:** tranche 1 → PR3+PR6a; tranche 2 → PR7 — do not combine two primaries in one merge |

**Cap per tranche:** **one primary** + optional **PR4** + up to **two companions** (PR6a, PR6b). Maximum practical set: **PR3 + PR4 + PR6a + PR6b** (CLASS-C + audit gap).

**Execution:** PR1 + PR2 (+ PR8 skeleton) → Phase 0/2 on iPad → merge per **tranche rules** above → PR9 last.

**Phase 2 sign-off required** before any PR3–PR7 merge; sign-off checkbox must cite chosen primary + companions.

---

## References

- Exploration (non-canonical H-IDs): `/tmp/grok-design-explore-*.md`
- Review: `/tmp/grok-design-review-23b5b552.md`
- Log: `/tmp/remodex-local.log` (session `14ca1f62`)
- E2E: `$REMODEX_WORKSPACE/docs/operations/device-e2e-checklist.md`

---

*End of design document `23b5b552` rev 4 (user context: U1–U3).*