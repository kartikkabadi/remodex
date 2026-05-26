# Plan: OpenCode runtime integration in Remodex (T1 + T2 + T3)

**Branch.** `multi-agents/opencode` (based on upstream `Emanuele-web04/remodex` `main`).
**Tracer.** https://github.com/kartikkabadi/remodex/issues/53.
**Owner.** Kartik (acceptance + direction). Agent stack (execution + review).
**Status.** Locked 2026-05-26. Ready for agent execution.
**ADR.** `Docs/adr/001-opencode-runtime-shape.md` (HTTP+SSE adapter, monolithic transport, single-runtime-per-bridge).

This is one self-contained document. An agent picking it up should be able to execute T1 commit-by-commit without re-asking architectural questions.

---

## 1. Mission

Add OpenCode (`opencode serve` HTTP + SSE) as a second agent runtime inside Remodex. iOS keeps speaking Codex-shaped JSON-RPC. The bridge translates. The user can pick provider, model, variant, and agent on iOS exactly as they would for Codex, with Codex-specific affordances (reasoning effort, service tier, reasoning summary, ChatGPT account) honestly hidden or refused for OpenCode threads.

Three tiers ship sequentially.

- **T1.** Bridge core completeness and capability honesty. No iOS UI changes. Behind `REMODEX_PROVIDER=opencode`.
- **T2.** iOS pickers and the agent dimension. Provider, model, variant, agent surfaces appear in the composer and Settings.
- **T3.** Long-tail iOS RPC coverage. Slash actions present in `TurnComposerCommandState` (`/fork`, `/compact`, `/review`, `/status`), thread archive, `@` autocomplete (skills, files, plugins), token usage ring, rich bus mapping (diffs, file changes, shell output, plan deltas, legacy `codex/event/*` aliases).

Quality bar across all tiers. No slop. No fake notifications iOS will silently swallow as garbage. No methods returning vague generic errors when a real refusal code applies. Every behavior verified against the real `opencode serve` (`OPENCODE_E2E=1`) and a paired iPhone 17 sim before merge.

---

## 2. Tier summary

| Tier | Deliverable | Bridge LOC | iOS LOC | PR posture |
|---|---|---|---|---|
| Pre-T1 | Error-message string coercion (4 sites) + `model/list` providerId-per-entry + `supportedVariants[]` catalog entries | ~80 to 120 | 0 | Single fork PR; merged before T1 starts |
| T1 (8 commits) | Bridge core: variant catalog, fast-tier model entries, `collaborationMode/list` synthesizer, truthful `initialize` capabilities, SSE reconnect hardening + max-attempts, formalized account refusals (including `account/login/complete`), Codex rollout path block for OpenCode threads, `thread/name/set` git-handler bypass | ~350 to 550 | 0 | Fork PR stack; review per commit |
| T2 (11 commits) | iOS pickers (provider / model / variant / agent) + ADR-aligned Settings card (preferred runtime, no in-app switch) + per-thread overrides + bridge `agent/list` + bridge emits `agentRuntime` on every thread payload + sidebar runtime logo + iOS `CodexModelOption` extension | ~250 to 400 | ~750 to 1100 | Fork PR stack; iOS commits separately |
| T3 (17 commits) | Long-tail completeness across the 76-method contract + rich bus mapping (plan delta, file change, shell, legacy aliases) + optional `session.next.*` EventV2 path + iOS `/status` gating | ~800 to 1300 | ~250 to 450 | Fork PR stack; can land iteratively |
| Upstream PR | Lands only after T1 is solid on real hardware. T2 + T3 may follow as separate upstream PRs. | n/a | n/a | Maintainer decides cadence |

LOC totals are honest ranges, not promises. The "least amount of code, cleanest code" goal still applies; if a commit comes in below the range, that is the better outcome.

---

## 3. Locked decisions

These are settled. An agent executing this plan does not relitigate them.

### Architecture

| ID | Decision | Source |
|---|---|---|
| L1 | OpenCode reached via `opencode serve` HTTP + SSE, not CLI per-turn | ADR 001 |
| L2 | Single file `phodex-bridge/src/opencode-transport.js` until a second non-Codex runtime exists | ADR 001 |
| L3 | Single runtime per bridge instance; `REMODEX_PROVIDER` set at startup | ADR 001 |
| L4 | No new npm dependencies; raw `fetch` and hand-rolled SSE | Existing branch guardrail |
| L5 | Bindings persistence at `~/.remodex/opencode-bindings.json` mode 0600 | Existing branch guardrail |
| L6 | All `message` fields on JSON-RPC errors and notifications are strings; never raw objects | Investigation; iOS `[object Object]` root cause |

### Scope

| ID | Decision | Detail |
|---|---|---|
| L7 | Tiers T1 + T2 + T3 sequenced | User confirmed |
| L8 | Agent vocabulary includes native (build, plan, general, explore, scout) plus custom from `opencode.json`; hidden agents (`compaction`, `title`, `summary`) filtered out of the iOS picker | User confirmed |
| L9 | Sidebar grouping stays project-keyed; runtime logo on each thread row signals Codex vs OpenCode. Implementing commit is T2-11 | Assumed default |
| L10 | Reasoning summary card stays empty for OpenCode threads; no bridge-side fake synthesis | Assumed default; no-slop bar |
| L11 | `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` off by default; T3 gates EventV2 behind a transport option for features that need it (token counts, per-reasoning IDs) | Assumed default |
| L12 | In-flight turn recovery on bridge restart marks running turns as failed via `markInFlightTurnsFailedOnBoot`; T3 optionally polls for partial-item rebuild | Assumed default |
| L13 | Single thread per cwd. Bridge returns `workspace_busy` with holder thread id | Assumed default |
| L14 | One bridge runs one runtime per ADR Decision 3. T1 ships behind `REMODEX_PROVIDER` env var (no iOS toggle). T2 adds iOS Settings field for the **preferred runtime at next bridge pairing** (does not change the connected bridge's runtime). When the connected bridge's runtime differs from the user's preferred runtime, iOS shows a non-blocking hint. Per-thread `agentRuntime` is informational only; it reflects which runtime the thread was created against | Assumed default; aligned with ADR 001 Decision 3 |
| L15 | Test plan is unit fixtures + `OPENCODE_E2E=1` canary + manual iPhone 17 sim QA. No XCUITest investment in this work | Assumed default |
| L16 | Per-tier fork PR stack. Upstream PR only after T1 is solid on real hardware | Assumed default |
| L17 | iOS surfaces specifically refused for OpenCode threads: voice transcription, turn steering, desktop continue, ChatGPT account, AI title generation, AI commit / PR message generation, rate-limit read, Codex rollout `thread/contextWindow/read` | Refusal table |

### Out of scope (all tiers)

| ID | Item |
|---|---|
| L18 | Cursor runtime, Grok, Gemini, Telegram OpenCode |
| L19 | iPad-first delivery |
| L20 | Voice transcription, turn steering, desktop continue (refused) |
| L21 | ChatGPT account UI (refused) |
| L22 | Image generation tool (no OpenCode equivalent) |
| L23 | Browser-based MCP install in iOS (stays Mac-side) |
| L24 | Dual-runtime parallel routing per thread (deferred past T3) |
| L25 | LSP UI, worktree UI |
| L26 | Interactive PTY / terminal UI for OpenCode tool output (timeline streaming only) |

---

## 4. Domain vocabulary

All terms an executing agent will encounter. Use these exactly.

| Term | Definition |
|---|---|
| `agentRuntime` | Per-thread runtime identity. Values `"codex"` or `"opencode"`. Drives iOS picker visibility and bridge routing decisions where they exist. iOS adds this field on `CodexThread` in T2. |
| `supportedVariants` | Catalog field on each model entry. Shape `{ id: string, displayName: string }[]`. Populated from OpenCode provider config `variants` map. Replaces Codex `supportedReasoningEfforts` for OpenCode threads. |
| `model.variant` | Selected variant id sent on `prompt_async`. Maps from iOS variant picker. |
| `providerId` | Upstream LLM provider key (`anthropic`, `openai`, `groq`, etc.) on each catalog entry. Distinct from the Remodex runtime id. |
| `modelProvider` | Legacy Remodex runtime bucket on threads. Today `"codex"` or `"opencode"`. Kept for compatibility; paired with `providerId` for upstream identity. |
| `ThreadBinding` | Bridge-owned record mapping `remodexThreadId` to `opencodeSessionId`, plus cwd, model, variant, agent, turn phase. Persisted at `~/.remodex/opencode-bindings.json`. |
| `activeRemodexTurnId` | Bridge-synthesized turn id. OpenCode has session ids and message ids but no Codex-shaped turn id. The bridge synthesizes one per `turn/start`. |
| `turnPhase` | Bridge authority for Stop UI across reconnects. Values `idle`, `running`, `failed`, `interrupted`. |
| `serviceTier` | Codex-only. OpenCode equivalent surfaces as separate `*-fast` catalog entries with `model.options.serviceTier` baked in. |
| `reasoningEffort` | Codex enum. Not reused for OpenCode. OpenCode uses `variant` instead. |
| `collaborationMode` | Codex plan-mode object. OpenCode maps `{ mode: "plan" }` to `agent: "plan"`. |
| `agent` | OpenCode agent id sent on `prompt_async`. Values from native set + custom agents from `opencode.json`. |
| `pendingApprovalsById` | Bridge map from JSON-RPC request id to OpenCode permission / question id. |
| `errorCode` | Stable refusal or feature-gate string in JSON-RPC `error.data.errorCode`. Set in `opencode-runtime-policy.js`. |
| `OpenCodeTransportState` | Aggregate state typedef. One per `createOpenCodeTransport` call. Holds server, bindings, locks, pending approvals, SSE state, listeners, options. |
| `INBOUND_REQUEST_HANDLERS` | Dispatch table at the top of `opencode-transport.js` ingress section. Maps method name to handler function. New T1 / T2 / T3 handlers append here. |

---

## 5. Pre-T1 work (two commits)

[VERIFIED 2026-05-26: PT-1 and PT-2 already implemented in existing 6 commits on branch.] The `coerceMessageString` helper exists at L1909-1927 (used at 7 sites) and `mapProvidersConfigToModelList` at L2323-2355 already emits per-entry `providerId`, composite IDs, `supportedVariants`, and `supportsFastMode`. These sections are retained for reference and verification only. No new implementation needed.

### PT-1: String coercion at all JSON-RPC error and notification message sites

**Why.** Several call sites in `opencode-transport.js` pass `error?.message` or downstream object values directly into JSON-RPC `error.message` or notification `message` fields. iOS Swift mappers fall through to `localizedDescription`, which renders Error objects as `"[object Object]"`. Locked decision L6 requires every message field to be a string.

**Files touched.**

- `phodex-bridge/src/opencode-transport.js`

**Concrete changes.**

- Add a `coerceMessageString(value)` helper near `makeJsonRpcError` (currently around L1883-1888). Wraps `value` so that strings pass through, Errors yield `.message`, objects yield `JSON.stringify`, primitives yield `String(value)`, and missing values yield a stable fallback.
- Apply at `routeInboundJsonRpc` catch around L880-885. Replace `error?.message` with `coerceMessageString(error)`.
- Apply at `emitTurnFailed` around L1659-1664. Wrap the `message` field on the `turn/completed` notification.
- Apply at `makeJsonRpcError` around L1883-1888. Wrap the inbound `message`.
- Apply at `resolveTurnAgent` around L2431-2437 where `params.collaborationMode` or `params.model` may be objects.

**Acceptance criteria.**

1. `rg -n "error\?\.message" phodex-bridge/src/opencode-transport.js` returns zero matches.
2. `rg -n "JSON\.stringify\(error" phodex-bridge/src/opencode-transport.js` either zero or only inside `coerceMessageString`.
3. New unit test: a thrown `Error("boom")` propagating through `routeInboundJsonRpc` produces an error JSON-RPC line whose `message` field type is `"string"` and value equals `"boom"`.
4. New unit test: an object passed as `message` produces a JSON-stringified value, not the literal string `"[object Object]"`.
5. Existing `npm test` passes; `OPENCODE_E2E=1 npm test` passes.

**Tests.**

- `phodex-bridge/test/opencode-transport.test.js` adds three cases under a new describe block `"PT-1 message coercion"`.

**Estimated LOC.** ~40 to 60.

**Depends on.** Nothing.

**Reviewer pass.** Quick. Unslop pass only; no architecture review needed for a coercion helper.

### PT-2: `model/list` per-entry `providerId` + `supportedVariants[]` + fast-tier entries

**Why.** The current `mapProvidersConfigToModelList` at `opencode-transport.js:2285-2316` flattens every catalog entry to `modelProvider: "opencode"`, drops the upstream `providerId`, and never enumerates `variants` or fast-tier siblings. iOS can't render a provider-grouped menu without per-entry `providerId`. T2 picker work depends on this.

**Files touched.**

- `phodex-bridge/src/opencode-transport.js`

**Concrete changes.**

- Rewrite `mapProvidersConfigToModelList` so each emitted catalog entry has:
  - `id`: composite `${providerId}/${modelId}` for uniqueness across providers
  - `providerId`: upstream provider id (`anthropic`, `openai`, etc.)
  - `modelProvider`: still `"opencode"` for compat with iOS legacy bucket
  - `modelId`: bare model id within the provider
  - `displayName`: human label
  - `supportedVariants`: `Object.keys(model.variants ?? {}).map(id => ({ id, displayName: id }))`
  - `supportsFastMode`: `true` iff a sibling entry with `model.options.serviceTier` exists, `false` otherwise
  - `defaultVariant`: provider config's default if present
- Enumerate `experimental.modes` from provider config so `*-fast` siblings appear as distinct catalog entries with `model.options.serviceTier` baked in.
- Keep existing `model/list` JSON-RPC envelope shape; only the entry shape changes.

**Acceptance criteria.**

1. `model/list` for an OpenCode provider returning Anthropic + OpenAI returns at least 2 distinct `providerId` values.
2. Each entry that has variants surfaces them in `supportedVariants`.
3. If the live OpenCode catalog has a `*-fast` model, it appears as a separate entry with `supportsFastMode: true`.
4. Existing iOS clients receiving the old flat shape do not crash. Verified by inspecting `CodexService+RuntimeConfig.swift` model decoding.
5. New unit test against a fixture provider config produces the expected expanded entry shape.

**Tests.**

- `phodex-bridge/test/opencode-transport.test.js` adds a `"PT-2 catalog shape"` describe block with at least three fixtures: provider with variants, provider without variants, provider with fast tier.

**Estimated LOC.** ~80 to 120.

**Depends on.** PT-1 (uses `coerceMessageString` for any error paths).

**Reviewer pass.** Architecture + unslop. Catalog shape is the foundation for T2 pickers.

---

## 6. T1: bridge core + capability honesty

Eight commits. Each lands separately, each gets a full thermo-nuclear + architecture + unslop review.

### T1-1: `initialize` capabilities truthful [Done: 28b0894]

**Status.** Already implemented in the existing 6 commits. `handleInitializeRequest` at L899-917 returns the exact capabilities object with `experimentalApi: false`, `agentRuntime: "opencode"`, `supportsCollaborationMode: true`, etc. Verified against live code. No further implementation needed — retained in T1 for traceability.

**LOC.** ~30 (already committed).

### T1-2: `collaborationMode/list` synthesizer

**Why.** iOS probes `collaborationMode/list` to discover plan mode availability (`CodexService+Connection.swift:886`). Without a response, iOS hides plan mode for OpenCode threads. The OpenCode plan agent exists; iOS plan UI should hydrate from it.

**File.** `phodex-bridge/src/opencode-transport.js`.

**Change.**

- Add `handleCollaborationModeListRequest(transport, request, emit)`. Fetches `GET /agent` from OpenCode (cached). Returns a Codex-shaped response declaring plan mode supported iff a `plan` agent is visible.
- Append handler to `INBOUND_REQUEST_HANDLERS` at L824 (verified location, not the earlier L309-320 the prior draft cited).
- Cache the agent list in `OpenCodeTransportState.agentsCache` with a short TTL (60s) to avoid hammering `/agent` on every probe.

**Acceptance.** iOS plan-mode toggle is enabled for OpenCode threads when the OpenCode `plan` agent is present. Toggle disabled when the user removed the `plan` agent from config.

**Tests.** Unit: `handleCollaborationModeListRequest` returns plan-supported response given a fixture agent list. Canary: live `GET /agent` returns plan, toggle works.

**LOC.** ~50 to 80.

**Depends on.** T1-1.

### T1-3: `thread/status/changed` from `session.status`

**Why.** iOS sidebar shows a running badge per thread, driven by `thread/status/changed`. The bridge currently does not emit this for OpenCode threads. OpenCode emits `session.status` with `busy` / `idle` / `retry`.

**File.** `phodex-bridge/src/opencode-transport.js` in `mapBusEventToCodexLines` at L1420.

**Change.**

- Add a case in the `session.status` arm of `mapBusEventToCodexLines` that emits a `thread/status/changed` notification line.
- Map `busy` to `{ status: "running" }`, `idle` to `{ status: "idle" }`, `retry` to `{ status: "retrying" }`.
- Add `emitThreadStatusChanged(transport, payload)` helper near `emitTurnFailed` at L1653.

**Acceptance.** iOS sidebar shows the running badge appearing and clearing as turns start and finish. Manual sim QA confirms.

**Tests.** Unit: bus event with `session.status: busy` produces a `thread/status/changed` line with `running`.

**LOC.** ~40 to 60.

**Depends on.** T1-1.

### T1-4: SSE reconnect hardening during active turn

**Why.** SSE drops happen. When they do mid-turn, the current adapter reconnects and resumes the stream but may not catch up on missed deltas. iOS may show a half-finished response with no completion.

**Files.**

- `phodex-bridge/src/opencode-transport.js`: `attachOpenCodeSse` at L2461, `scheduleOpenCodeSseReconnect` at L2481, and the existing `scheduleSseReconnect` backoff helper at L649.
- `phodex-bridge/test/opencode-transport.test.js`: update the existing reconnect cap test at L180-186.

**Change.**

- Keep the existing exponential backoff with 8s cap (`scheduleSseReconnect` at L649-652). Add a max-attempts ceiling (20) so a permanently-dead server eventually surfaces a `turn/failed` instead of looping forever.
- Add the catch-up flow on reconnect (separate from backoff): when SSE reattaches during an active turn for a bound thread, fetch `GET /session/{id}/message`, compare against `lastEmittedItemIdByThread`, and emit `message.part.updated` snapshots for any item the bridge has not yet emitted as completed. **IMPORTANT: Messages are assumed returned in chronological order (oldest first). If OpenCode returns newest-first, the bridge MUST reverse the array before catch-up. Verify the ordering contract during implementation.**
- Add `lastEmittedItemIdByThread` to `OpenCodeTransportState` and write it on every successful emit.
- Update the existing reconnect-cap unit test to assert the new max-attempts behavior.

**Acceptance.**

1. Unit test: simulated SSE disconnect mid-turn -> reconnect handler reads a fixture message catch-up and emits the missing delta lines.
2. Unit test: 20 failed reconnect attempts -> bridge emits exactly one `turn/failed` with a structured message.
3. Existing reconnect-cap test still passes (8s ceiling preserved).
4. Manual: kill `opencode serve`, restart it during a streaming turn; iOS shows the assistant message complete.

**Tests.** Updates the existing flat test for reconnect; adds two new flat tests for catch-up and max-attempts. Manual: scripted kill flagged in the manual sim QA section, not in the canary suite.

**LOC.** ~80 to 120.

**Depends on.** T1-3.

### T1-5: Formalize account refusals in policy

**Why.** Today `bridge.js` has two parallel paths. `handleBridgeManagedAccountRequest` at L824 handles `account/login/start`, `account/login/cancel`, `account/login/openOnMac` directly. `account/login/complete` is NOT in that allowlist (verified: L835-837 explicitly skip it), so it falls through to transport, then to `handleUnsupportedMethod` at L1391, then to a generic `method_not_supported` error rather than a runtime-specific refusal. `voice/resolveAuth` and `account/rateLimits/read` need the same treatment. Each refusal must live in `opencode-runtime-policy.js` as the single source of truth, then both bridge.js and the transport should consult it.

**Files.**

- `phodex-bridge/src/opencode-runtime-policy.js`
- `phodex-bridge/src/bridge.js` (`handleBridgeManagedAccountRequest` at L824)
- `phodex-bridge/src/opencode-transport.js` (`handleUnsupportedMethod` at L1391 already consults `getOpenCodeRefusal`; no change needed if policy entries land first)

**Change.**

- Add to `opencode-runtime-policy.js`: `account/login/start`, `account/login/cancel`, `account/login/complete`, `account/login/openOnMac`, `account/logout`, `voice/resolveAuth`, `account/rateLimits/read`. Codes: `auth_not_supported` for account methods, `voice_not_supported` for `voice/resolveAuth`, `rate_limits_not_supported` for `account/rateLimits/read`.
- In `bridge.js` `handleBridgeManagedAccountRequest`: when `process.env.REMODEX_PROVIDER === "opencode"`, short-circuit every account method (including `account/login/complete`) by consulting the policy table and returning the structured refusal. Do not let any account method fall through to its Codex-driven completion path on OpenCode bridges.
- The transport-side fall-through stays intact as a safety net for any method the bridge.js short-circuit misses.

**Acceptance.**

1. Unit test in `phodex-bridge/test/opencode-policy.test.js` (new file or extend existing): each of the seven methods returns the expected `errorCode` + message string when the bridge runs in OpenCode mode.
2. `rg -n "account/login/complete" phodex-bridge/src/bridge.js` confirms the method is now handled inside `handleBridgeManagedAccountRequest` for OpenCode bridges.
3. Manual: from a Codex-mode bridge, account methods still work normally (no regression).

**Tests.** New test file or appended cases. No iOS sim QA required for T1-5.

**LOC.** ~60 to 90.

**Depends on.** PT-1.

### T1-6: Block `thread/contextWindow/read` Codex rollout path for OpenCode threads

**Why.** `thread/contextWindow/read` is handled in `thread-context-handler.js` which reads `~/.codex/sessions`. For OpenCode threads this is nonsense. iOS gets stale or empty data. The bridge should refuse cleanly.

**Files.**

- `phodex-bridge/src/opencode-runtime-policy.js`
- `phodex-bridge/src/bridge.js` and/or `phodex-bridge/src/thread-context-handler.js` entry point (verify exact dispatch line before edit).

**Change.**

- Add `thread/contextWindow/read` to policy with `context_not_supported` error code and string message "Context window usage is not available from Codex rollout for OpenCode threads."
- Guard in `bridge.js` before `thread-context-handler.js` is invoked when `REMODEX_PROVIDER === "opencode"`.
- T3-D.1 will revisit this and wire token usage from `session.next.step.ended` (EventV2 gated).

**Acceptance.** `thread/contextWindow/read` on an OpenCode thread returns `context_not_supported` instead of attempting `~/.codex` reads.

**Tests.** Unit: bridge with `REMODEX_PROVIDER=opencode` receives `thread/contextWindow/read`; response is the expected refusal. Verify `~/.codex` is not read.

**LOC.** ~20 to 40.

**Depends on.** T1-5.

### T1-7: Push notification flow verification

**Why.** Existing `push-notification-tracker.js` is transport-agnostic but written against Codex. T1 verifies that OpenCode `turn/completed` notifications trigger the tracker correctly.

**Files.**

- `phodex-bridge/src/push-notification-tracker.js`
- Potentially `phodex-bridge/src/opencode-transport.js` if it needs to thread a notification id.

**Change.**

- Read the tracker. Confirm it subscribes to `turn/completed` notifications regardless of transport.
- If it special-cases Codex, generalize.
- Add an integration test that emits a fixture OpenCode `turn/completed` and asserts the tracker fires.

**Acceptance.** A turn that completes on an OpenCode thread triggers an iOS push notification (manual sim confirm; programmatic check that the tracker was invoked).

**Tests.** Unit: fake `turn/completed` -> tracker invoked. Manual sim: turn completes, notification arrives.

**LOC.** ~20 to 50.

**Depends on.** T1-3.

### T1-8: `thread/name/set` routes to OpenCode `PATCH /session/{id}` on OpenCode bridges

**Why.** `git-handler.js` intercepts `thread/name/set` at L47 (allowlist) and L70 / L96 (rename branches alongside thread). For OpenCode threads this stops the rename at the bridge; the OpenCode session title never updates. Transport-side handler exists already (verified: `opencode-transport.js` around `PATCH /session/{id}` reachable through `handleThreadNameSetRequest`) but is unreachable because git-handler swallows the request first. Without this fix, every OpenCode thread rename diverges between iOS state and OpenCode session state from T1 onward; the prior plan deferred this to T3-D.2 but the divergence is too visible to defer.

**Files.**

- `phodex-bridge/src/git-handler.js` (L47, L70, L96 -- the `thread/name/set` interception points)
- `phodex-bridge/src/opencode-transport.js` (verify `handleThreadNameSetRequest` exists and is wired into `INBOUND_REQUEST_HANDLERS` at L824)

**Change.**

- Gate the git-handler interception on `process.env.REMODEX_PROVIDER === "codex"`. For OpenCode bridges, let `thread/name/set` pass through to transport.
- Transport handler calls `PATCH /session/{id}` with the new title and updates `ThreadBinding.title`.
- If a worktree-rename side effect is needed for OpenCode threads (`git-handler.js:70`), keep that side effect but skip the title update in git-handler when transport will own it.

**Acceptance.**

1. Unit: with `REMODEX_PROVIDER=opencode`, sending `thread/name/set` to bridge routes to transport and produces `PATCH /session/{id}` against the OpenCode mock.
2. Unit: with `REMODEX_PROVIDER=codex`, behavior is unchanged.
3. Manual: rename an OpenCode thread on iOS; restart the app or reload the thread list; the new title shows. Open the OpenCode CLI separately to confirm the session title matches.

**Tests.** Two new flat tests in `opencode-transport.test.js`. One existing git-handler test may need a guard added for the env branch.

**LOC.** ~50 to 80.

**Depends on.** T1-1 (capabilities so iOS sends to OpenCode bridge in the first place).

---

## 7. T2: iOS pickers + agent dimension

Eleven commits across bridge and iOS. Bridge commits land first so iOS has something to read.

T2 ordering rationale. T2-1 to T2-3 are bridge-only. T2-4 (iOS thread model) lands before any iOS UI that reads `agentRuntime`. T2-5 (iOS model option layer) lands before T2-7 (composer menu) reads `providerId` / `supportedVariants`. T2-6 (Settings) and T2-7 (composer) can land in either order once their prerequisites are in.

### T2-1: Bridge `agent/list` handler with custom agent merge

**Why.** iOS picker needs the full agent list (native + custom from `opencode.json`).

**File.** `phodex-bridge/src/opencode-transport.js`.

**Change.**

- Add `handleAgentListRequest(transport, request, emit)` that fetches `GET /agent`, filters hidden agents (`compaction`, `title`, `summary`), and returns the merged list in Codex-shaped envelope.
- Each entry shape: `{ id, displayName, mode, isCustom, description? }`. `isCustom: true` if the agent is from `opencode.json`; native ids belong to a known set in the code.
- Append handler to `INBOUND_REQUEST_HANDLERS` at L824.
- Cache reuses `agentsCache` from T1-2.

**Acceptance.**

1. Unit: fixture agent list with native + custom + hidden produces the expected filtered shape.
2. Canary (`OPENCODE_E2E=1`): live `GET /agent` returns at least `build` and `plan` as native, plus any custom agents.

**LOC.** ~50 to 80.

**Depends on.** T1-1, T1-2.

### T2-2: `ThreadBinding` agent passthrough + `turn/start` accepts `agent` / `variant`

**Why.** iOS user picks an agent (and variant) per thread or per turn. The selection must ride on `prompt_async`.

**File.** `phodex-bridge/src/opencode-transport.js`.

**Change.**

- `ThreadBinding` typedef at L78-87 already has `model: { provider, model, variant? }`. Add a sibling `agent?: string` field. Do NOT duplicate `variant` at the top level; keep it nested inside `model` (verified shape).
- In `handleTurnStartRequest` at L1187, accept `params.agent` and `params.model.variant`, persist on the binding, pass on the `prompt_async` body.
- `resolveTurnAgent` at L2431 prefers `params.agent` over binding default over `collaborationMode` mapping.
- Bump `BINDINGS_SCHEMA_VERSION` at L664 to 2 only if the new `agent` field needs migration logic; otherwise leave at 1 (missing field defaults to undefined, which the resolver handles).

**Acceptance.**

1. Unit: fixture `turn/start` payload with `{ agent: "plan", model: { variant: "thinking" } }` produces an outbound `prompt_async` body with `agent: "plan"` and `variant: "thinking"`.
2. Unit: binding round-trips through serialize / deserialize preserving `agent`.

**LOC.** ~50 to 80.

**Depends on.** T2-1.

### T2-3: Bridge `publicThreadFromBinding` emits `agentRuntime`, `providerId`, `variant`

**Why.** iOS T2-4 reads `agentRuntime` from `thread/read` and `thread/start` responses. Today `publicThreadFromBinding` at L2247-2259 emits only `modelProvider: "opencode"` and a bare `model.model` string. iOS has no way to know the thread is OpenCode-shaped without this field. Without T2-3, T2-4 + T2-7 picker visibility logic never activates on real OpenCode threads.

**File.** `phodex-bridge/src/opencode-transport.js`, `publicThreadFromBinding` at L2247.

**Change.**

- Add to the returned object: `agentRuntime: "opencode"`, `providerId: binding.model?.provider ?? null`, `variant: binding.model?.variant ?? null`, `agent: binding.agent ?? null`.
- Keep `modelProvider: "opencode"` for legacy decode paths.
- Update every call site that emits a thread payload: `thread/started`, `thread/read`, `thread/list` (all already go through `publicThreadFromBinding`; verify).

**Acceptance.**

1. Unit: fixture binding with `model: { provider: "anthropic", model: "claude-opus-4", variant: "thinking" }` and `agent: "plan"` produces a thread payload containing `agentRuntime: "opencode"`, `providerId: "anthropic"`, `variant: "thinking"`, `agent: "plan"`.
2. Unit: missing fields produce `null`, not undefined, so iOS Codable does not stumble.
3. Existing tests on `publicThreadFromBinding` still pass.

**LOC.** ~30 to 50.

**Depends on.** T2-2.

### T2-4: iOS `CodexThread.agentRuntime` field

**Why.** iOS branches picker visibility on `agentRuntime`.

**File.** `CodexMobile/CodexMobile/Models/CodexThread.swift` (in repo, verified).

**Change.**

- Add `agentRuntime: String` (default `"codex"`).
- Hydrate from `thread/start` and `thread/read` responses.
- Decoder backward-compatible (missing field defaults to `"codex"`).

**Acceptance.**

1. Existing Codex thread decode tests pass.
2. New test: thread JSON with `agentRuntime: "opencode"` decodes correctly with the new field set.

**LOC.** ~30 to 50 iOS.

**Depends on.** T2-3.

### T2-5: iOS `CodexModelOption` extension for `providerId` + `supportedVariants`

**Why.** The current `CodexModelOption.swift` in repo holds `supportedReasoningEfforts` but not `providerId` or `supportedVariants` (verified by reading the file). Without these, the T2-7 composer's Provider-grouped menu and Intelligence submenu have nothing to read from.

**File.** `CodexMobile/CodexMobile/Models/CodexModelOption.swift` (in repo, verified).

**Change.**

- Add `providerId: String?`, `supportedVariants: [VariantOption]`, `supportsFastMode: Bool`, `defaultVariant: String?` fields.
- Add a nested `VariantOption { id: String, displayName: String }`.
- Decoder fills these from PT-2's catalog shape; missing fields fall back to empty arrays or nil for backward compatibility.
- Update `CodexService+RuntimeConfig.swift` decoding sites to surface the new fields.

**Acceptance.**

1. Existing model-option decode tests pass.
2. New test: a PT-2-shape catalog entry decodes with the new fields populated.
3. Old Codex-shape catalog entries (no `providerId`, no `supportedVariants`) still decode with nil / empty defaults.

**LOC.** ~80 to 130 iOS.

**Depends on.** PT-2.

### T2-6: iOS Settings card with preferred-runtime field (no in-app switching)

**Why.** Per ADR Decision 3 and L14, one bridge runs one runtime. Settings stores the **preferred runtime for the next bridge pairing**; it does not switch the live bridge runtime. When the connected bridge's runtime differs from the user's preference, iOS shows a non-blocking hint, not an error.

**File.** `CodexMobile/CodexMobile/Views/Settings/SettingsRuntimeDefaultsCard.swift` (in repo, verified; edit target, not /tmp port).

**Change.**

- Edit the existing card to add a "Preferred runtime" row (Codex / OpenCode picker).
- Hide ChatGPT account section when capabilities report `requiresOpenaiAuth: false`.
- Hide Reasoning row when the selected model has empty `supportedReasoningEfforts`.
- Hide Speed row when `supportsFastMode: false`.
- Persist preference to `CodexService.preferredAgentRuntime` (UserDefaults).
- When the connected bridge runtime differs from the preference, surface a non-blocking footer: "Connected to a Codex bridge. Switch on this Mac to use OpenCode."

**Acceptance.**

1. Manual sim QA: connected to a Codex bridge, ChatGPT account row visible.
2. Manual sim QA: connected to an OpenCode bridge, ChatGPT account row hidden, OpenCode preferred-runtime UI visible.
3. Manual sim QA: preferred runtime != connected runtime -> hint footer visible; no error.
4. Unit: Settings state machine sets and reads `preferredAgentRuntime`.

**LOC.** ~150 to 200 iOS.

**Depends on.** T2-4 (`agentRuntime` field), T1-1 (capabilities).

### T2-7: iOS composer Model + Intelligence + Speed + Agent submenus

**Why.** The picker the user remembers. Provider-grouped model menu with logos, Intelligence (variant for OpenCode, reasoning effort for Codex), Speed (fast model for OpenCode, service tier for Codex), Agent (OpenCode only).

**Files (all in repo, verified; edit targets, not /tmp ports).**

- `CodexMobile/CodexMobile/Views/Turn/Composer/TurnComposerRuntimeUIKitMenu.swift`
- `CodexMobile/CodexMobile/Views/Turn/Composer/TurnComposerRuntimeState.swift`

**Change.**

- Edit the existing menu structure to expose four submenus: **Model** (provider-grouped using `providerId` from T2-5), **Intelligence** (variant on OpenCode threads, reasoning effort on Codex), **Speed** (fast model id on OpenCode, service tier on Codex), **Agent** (OpenCode only).
- Intelligence and Speed auto-hide when the selected model lacks the capability.
- Agent auto-hides for Codex threads (`agentRuntime == "codex"`).

**Acceptance.**

1. SwiftUI state-machine test for menu structure given a fixture model + agent list across {OpenCode native model, OpenCode model with no variants, Codex thread}.
2. Manual sim QA across Codex and OpenCode threads.

**LOC.** ~150 to 250 iOS (extending existing 225-LOC file).

**Depends on.** T2-1, T2-2, T2-4, T2-5, T2-8.

### T2-8: iOS `CodexService` fetches `agent/list` and caches

**Why.** T2-7 Agent submenu reads from an iOS-side cache. The cache needs a fetcher.

**File.** `CodexMobile/CodexMobile/Services/CodexService+RuntimeConfig.swift`.

**Change.**

- Add `fetchAgentList() async throws -> [AgentOption]` that sends `agent/list` and caches the response keyed by bridge session.
- Refresh on bridge reconnect.
- Expose `availableAgents: [AgentOption]` as an observable property.

**Acceptance.**

1. Unit: mocked RPC returns fixture agent list; service exposes it through `availableAgents`.
2. Manual sim: on reconnect to OpenCode bridge, available agents update.

**LOC.** ~60 to 100 iOS.

**Depends on.** T2-1.

### T2-9: iOS per-thread overrides (model, variant, agent)

**Why.** User picks per-thread.

**Files.**

- `CodexMobile/CodexMobile/Services/CodexService+RuntimeConfig.swift`
- `CodexMobile/CodexMobile/Models/CodexThread.swift`

**Change.**

- Add `threadModelOverride`, `threadVariantOverride`, `threadAgentOverride` per-thread state on `CodexService`.
- Setters and clear functions.
- Composer resolves model / variant / agent in this order: per-thread override -> preferred runtime default (T2-6) -> bridge default.
- `turn/start` payload carries resolved values.

**Acceptance.**

1. Unit on `CodexService` override state.
2. Manual sim QA: switching threads restores per-thread overrides correctly.

**LOC.** ~120 to 180 iOS.

**Depends on.** T2-7.

### T2-10: Bridge persists per-thread overrides

**Why.** Mirror of T2-9. Bridge writes resolved values back to `ThreadBinding` so resumes work.

**File.** `phodex-bridge/src/opencode-transport.js`, `handleTurnStartRequest` at L1187 and binding write path.

**Change.**

- `handleTurnStartRequest` writes resolved `agent` and `model.variant` to `ThreadBinding` on every turn.
- Bindings serializer / deserializer covers the new field (no schema bump if T2-2 already added `agent`).

**Acceptance.**

1. Unit: `turn/start` updates binding fields; bindings serialize / deserialize preserving them.
2. Unit: bridge restart with persisted binding restores `agent` and `variant` on the binding.

**LOC.** ~30 to 50.

**Depends on.** T2-2, T2-9.

### T2-11: iOS sidebar runtime logo on each thread row

**Why.** L9 requires a Codex vs OpenCode signal on every thread row. `RuntimeProviderLogo.swift` exists only in `/tmp/feature-catalog/` cache; the repo does not have it yet.

**Files.**

- `CodexMobile/CodexMobile/Views/Common/RuntimeProviderLogo.swift` (NEW; reference cached `/tmp/feature-catalog/RuntimeProviderLogo.swift` as starting shape, but author fresh)
- Sidebar thread row file (verify by grepping for the existing thread list view)

**Change.**

- New SwiftUI view `RuntimeProviderLogo` that maps `agentRuntime` to a tiny logo (Codex icon, OpenCode icon).
- Inject into the sidebar thread row near the thread title.

**Acceptance.**

1. Snapshot or state test for both logo states.
2. Manual sim QA: sidebar shows correct logo per thread.

**LOC.** ~60 to 100 iOS.

**Depends on.** T2-4.

---

## 8. T3: long-tail completeness across the 76-method contract

Sixteen commits, grouped by theme. T3 lands iteratively; each group can be its own fork PR. Each commit has explicit files, change, acceptance, tests, LOC, and depends.

### T3-A: Slash actions on OpenCode threads

#### T3-A.1: `thread/fork`

**File.** `phodex-bridge/src/opencode-transport.js`. Append `handleThreadForkRequest` to `INBOUND_REQUEST_HANDLERS` at L824.

**Change.** Handler calls `POST /session/{id}/fork` against OpenCode. On success, persist a new `ThreadBinding` for the forked session, emit a `thread/started` notification with the new thread payload (via `publicThreadFromBinding`), and return the new thread id in the JSON-RPC response.

**Acceptance.**

1. Unit: fixture `thread/fork` request -> outbound `POST /session/{id}/fork` -> response includes new `threadId`.
2. Unit: bindings file gets a new entry for the forked session.
3. Manual: user taps Fork on an OpenCode thread; a new thread appears in the sidebar.

**Tests.** Two flat tests in `opencode-transport.test.js`.

**LOC.** ~50 to 80. **Depends on.** T1-1, T2-3 (so `publicThreadFromBinding` emits `agentRuntime`).

#### T3-A.2: `thread/compact/start`

**File.** `phodex-bridge/src/opencode-transport.js`. Append `handleThreadCompactStartRequest` to `INBOUND_REQUEST_HANDLERS`.

**Change.** Primary path: when `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` is set on transport options, call `POST /api/session/{id}/compact`. Fallback: `POST /session/{id}/summarize`. On either result, emit a synthesized summary item via `item/agentMessage/...` lines so iOS shows the compaction.

**Acceptance.**

1. Unit: EventV2 enabled -> outbound `POST /api/session/{id}/compact`; EventV2 disabled -> outbound `POST /session/{id}/summarize`.
2. Manual: user taps Compact; thread compacts in place; iOS shows the summary.

**Tests.** Two flat tests (one per branch).

**LOC.** ~60 to 90. **Depends on.** T1-1.

#### T3-A.3: `thread/archive` / `thread/unarchive`

**File.** `phodex-bridge/src/opencode-transport.js`. Two new handlers in `INBOUND_REQUEST_HANDLERS`. Optional `DELETE /session/{id}` on permanent delete handler (separate user action; out of scope for this commit).

**Change.** Add `archived: boolean` to `ThreadBinding` typedef at L78. `thread/archive` sets it to true; `thread/unarchive` sets it to false. `thread/list` at L1100-1115 (the `publicThreadFromBinding` enumerator) filters archived threads unless `params.includeArchived === true`. Bump `BINDINGS_SCHEMA_VERSION` to 2 with a migration that defaults `archived: false` on existing bindings.

**Acceptance.**

1. Unit: archive then list -> thread absent; list with `includeArchived: true` -> thread present with `archived: true`.
2. Unit: schema migration produces `archived: false` on bindings written under v1.
3. Manual: user archives an OpenCode thread; it disappears from active list, appears in archived view.

**Tests.** Three flat tests.

**LOC.** ~70 to 110. **Depends on.** T2-3.

#### T3-A.4: `review/start`

**File.** `phodex-bridge/src/opencode-transport.js`. New `handleReviewStartRequest` in `INBOUND_REQUEST_HANDLERS`.

**Change.** Review prompts map to `POST /session/{id}/prompt_async` with the standard streaming pipeline. The handler synthesizes a review-shaped user message prefix from `params` (or a default review template) and passes through. SSE deltas stream back as normal `item/agentMessage` lines.

**Acceptance.**

1. Unit: fixture `review/start` -> outbound `prompt_async` with the review prefix.
2. Manual: user initiates a review turn on an OpenCode thread; streams like a normal turn.

**Tests.** One flat test plus existing turn streaming coverage.

**LOC.** ~40 to 60. **Depends on.** T2-2.

### T3-B: `@` autocomplete sources

#### T3-B.1: `fuzzyFileSearch` -> `GET /find/file` + `GET /find/symbol`

**File.** `phodex-bridge/src/opencode-transport.js`. New `handleFuzzyFileSearchRequest` in `INBOUND_REQUEST_HANDLERS`.

**Change.** Handler queries `GET /find/file?query={q}` and `GET /find/symbol?query={q}` against OpenCode for the active thread's cwd. Map results to the Codex `fuzzyFileSearch` envelope (matching the iOS decoder).

**Acceptance.**

1. Unit: fixture query -> outbound `GET /find/file` with the right query; response shape matches Codex envelope.
2. Canary: live request returns matches for a known file path in the test fixture cwd.
3. Manual: composer `@file` autocomplete returns paths for OpenCode threads.

**Tests.** One flat test plus a canary entry.

**LOC.** ~50 to 80. **Depends on.** T1-1.

#### T3-B.2: `skills/list` -> `GET /skill`

**File.** `phodex-bridge/src/opencode-transport.js`. New `handleSkillsListRequest`.

**Change.** Handler calls `GET /skill` and maps to Codex `skills/list` envelope. Cache for 60s.

**Acceptance.**

1. Unit: fixture skill list -> Codex-shaped response.
2. Manual: composer `@` skill autocomplete returns OpenCode skills.

**Tests.** One flat test.

**LOC.** ~30 to 50. **Depends on.** T1-1.

#### T3-B.3: `plugin/list` -> `GET /mcp`

**File.** `phodex-bridge/src/opencode-transport.js`. New `handlePluginListRequest`.

**Change.** Handler calls `GET /mcp` and maps to Codex `plugin/list` envelope (read-only; install stays Mac-side per L23).

**Acceptance.**

1. Unit: fixture MCP list -> Codex-shaped response.
2. Manual: composer `@` plugin autocomplete returns OpenCode MCP servers.

**Tests.** One flat test.

**LOC.** ~30 to 50. **Depends on.** T1-1.

### T3-C: Rich bus event mapping

All T3-C commits extend `mapBusEventToCodexLines` at L1420 and add new `emit*` helpers near `emitTurnFailed` at L1653.

#### T3-C.1: `turn/diff/updated` from `session.diff`

**File.** `phodex-bridge/src/opencode-transport.js`. Add case in `mapBusEventToCodexLines` at L1420 for `session.diff` events. New `emitTurnDiffUpdated` helper near L1653.

**Acceptance.**

1. Unit: fixture `session.diff` event -> `turn/diff/updated` line with correct diff payload.
2. Manual: diff sheet populates for OpenCode threads after an edit.

**Tests.** One flat test.

**LOC.** ~50 to 80. **Depends on.** T1-3.

#### T3-C.2: `item/fileChange/outputDelta` from `file.edited` + tool parts

**File.** `phodex-bridge/src/opencode-transport.js`. New case in `mapBusEventToCodexLines` for `file.edited` and for tool parts with edit / write / apply_patch tool types. New `emitFileChangeOutputDelta` helper.

**Acceptance.**

1. Unit: fixture `file.edited` -> `item/fileChange/outputDelta` line.
2. Unit: fixture tool part for edit / write -> same.
3. Manual: file change cards stream during edit tool calls.

**Tests.** Two flat tests.

**LOC.** ~70 to 100. **Depends on.** T1-3.

#### T3-C.3: `item/commandExecution/outputDelta` from shell tool parts

**File.** `phodex-bridge/src/opencode-transport.js`. New case for shell tool parts. Optional EventV2 path for `session.next.shell.*` gated on the experimental flag.

**Acceptance.**

1. Unit: fixture shell tool part -> `item/commandExecution/outputDelta`.
2. Unit (EventV2 enabled): fixture `session.next.shell.stdout` -> same.
3. Manual: shell rows show streaming output.

**Tests.** Two flat tests.

**LOC.** ~80 to 120. **Depends on.** T1-3.

#### T3-C.4: Legacy `codex/event/*` aliases for tool start, read, search, list_files, patch_apply, user_message

**File.** `phodex-bridge/src/opencode-transport.js`. Extend `mapBusEventToCodexLines` to emit legacy `codex/event/*` envelope lines alongside the modern `item/*` lines, so any iOS fallback paths still receive correct events.

**Acceptance.**

1. Unit: each of (exec_command, read, search, list_files, patch_apply_begin, patch_apply_end, user_message, image_generation_end) gets a fixture that produces the correct `codex/event/*` line shape.
2. Manual: iOS legacy timeline handlers receive correct data.

**Tests.** One flat test per event type (8 total) or a parametrized test if the harness supports it.

**LOC.** ~100 to 150. **Depends on.** T1-3.

#### T3-C.5: `turn/plan/updated` + `item/plan/delta` from plan agent state

**File.** `phodex-bridge/src/opencode-transport.js`. New case in `mapBusEventToCodexLines` for plan-mode events (likely `command.executed` for `plan_enter` / `plan_exit` plus message parts emitted by the plan agent).

**Change.** Synthesize `turn/plan/updated` and `item/plan/delta` lines from the plan agent's structured output. Pattern follows T3-C.1.

**Acceptance.**

1. Unit: fixture plan agent output -> `turn/plan/updated` + `item/plan/delta` lines.
2. Manual: iOS plan-mode card populates and updates during a plan-mode turn.

**Tests.** Two flat tests.

**LOC.** ~80 to 120. **Depends on.** T1-2, T1-3.

### T3-D: Token usage + history + name sync verification

#### T3-D.1: `thread/tokenUsage/updated` from `session.next.step.ended` (EventV2 gated)

**File.** `phodex-bridge/src/opencode-transport.js`. New case in `mapBusEventToCodexLines` for `session.next.step.ended` when EventV2 enabled. Also: block the Codex rollout watcher in `bridge.js` (location to verify before edit) for OpenCode threads so the two paths do not double-emit.

**Acceptance.**

1. Unit (EventV2 enabled): fixture `session.next.step.ended` -> `thread/tokenUsage/updated` line with input / output / reasoning tokens.
2. Unit (EventV2 disabled): no `thread/tokenUsage/updated` emitted; context ring stays empty.
3. Manual: with EventV2 enabled, context ring fills as the turn streams.

**Tests.** Two flat tests.

**LOC.** ~80 to 120. **Depends on.** T1-3, T1-6.

#### T3-D.2: `thread/name/set` verification + dead-code cleanup

**Why.** T1-8 already made `thread/name/set` route through transport for OpenCode bridges. T3-D.2 is a verification commit that the dead-code path in transport is now reachable and that the integration is solid across all rename scenarios (active thread, archived thread, fork).

**File.** `phodex-bridge/src/opencode-transport.js` (verify `handleThreadNameSetRequest` is the wired handler).

**Change.**

- Sweep for any `handleThreadNameSetRequest`-equivalent that is still unreachable post-T1-8; delete or wire it.
- Add an integration test covering rename of an OpenCode thread that has been forked (both binding titles update independently).

**Acceptance.**

1. Unit: rename on the original thread updates the original binding only; rename on the fork updates the fork's binding only.
2. Manual: rename across reboot persists.

**Tests.** Two flat tests.

**LOC.** ~20 to 40. **Depends on.** T1-8, T3-A.1.

#### T3-D.3: History reconstruction with tool + reasoning parts

**File.** `phodex-bridge/src/opencode-transport.js`, `loadTurnsForBinding` at L2319.

**Change.** Extend the message-to-turn mapping to include tool calls and reasoning parts, not just text. iOS timeline should render the full turn history on resume.

**Acceptance.**

1. Unit: fixture message list with tool + reasoning -> turn list including those rows.
2. Manual: resume an OpenCode thread that ran tools; tool rows + reasoning blocks appear in the timeline.

**Tests.** Two flat tests.

**LOC.** ~120 to 200. **Depends on.** T1-3.

### T3-E: `serverRequest/resolved` after approval reply

**File.** `phodex-bridge/src/opencode-transport.js`, `handleInboundClientResponse` at L1328.

**Change.** After a successful approval POST to OpenCode, emit a `serverRequest/resolved` notification so iOS dismisses the approval sheet without waiting for the next event tick.

**Acceptance.**

1. Unit: fixture approval reply -> outbound POST -> emitted `serverRequest/resolved` line.
2. Manual: approval sheet dismisses immediately on user reply.

**Tests.** One flat test.

**LOC.** ~30 to 50. **Depends on.** T1-3.

### T3-F: TODO cards synthesized from `todo.updated`

**File.** `phodex-bridge/src/opencode-transport.js`. New case in `mapBusEventToCodexLines` for `todo.updated`. New `emitAgentSummary` helper.

**Change.** Map OpenCode todo list updates to the Codex `item/agentSummary/...` shape so iOS renders a structured todo card.

**Acceptance.**

1. Unit: fixture `todo.updated` -> `item/agentSummary/*` lines.
2. Manual: OpenCode todo list updates appear as a card in iOS.

**Tests.** One flat test.

**LOC.** ~60 to 100. **Depends on.** T1-3.

### T3-G: iOS gates `/status` slash on OpenCode threads

**Why.** `/status` calls `thread/contextWindow/read` (refused by T1-6) and `account/rateLimits/read` (refused by T1-5). On OpenCode threads, iOS currently fires the requests and renders an error sheet. iOS should hide or degrade `/status` instead.

**File.** `CodexMobile/CodexMobile/Views/Turn/Composer/TurnComposerCommandState.swift` and `CodexMobile/CodexMobile/Views/Status/StatusSheet.swift` (verify exact paths).

**Change.**

- Hide `/status` from the slash command list when `thread.agentRuntime == "opencode"`.
- Alternative (if hiding is too aggressive): show `/status` with a degraded sheet that reports "Status sheet is not available for OpenCode threads. Open the OpenCode CLI for token and rate-limit details."

**Acceptance.**

1. Manual sim QA on OpenCode thread: `/status` is hidden from the slash list (or shows the degraded sheet).
2. Codex thread `/status` unaffected.

**Tests.** SwiftUI state-machine test for slash command visibility.

**LOC.** ~40 to 70 iOS.

**Depends on.** T2-4 (`agentRuntime` on thread model).

---

## 9. Outbound method mapping (full table)

Source: Codebase Cartographer subagent + `codex-feature-surface.md`. Every iOS-sent JSON-RPC method, categorized.

### Handshake and session

| Method | Phase | Handling | Acceptance |
|---|---|---|---|
| `initialize` | T1 | Wired; local answer; truthful capabilities | T1-1 |
| `initialized` | T1 | Bridge-local; swallowed notification | n/a |

### Thread lifecycle

| Method | Phase | Handling | Acceptance |
|---|---|---|---|
| `thread/start` | T1 (today) | Wired; `POST /session` | Already in tree |
| `thread/list` | T1 (today) | Synthesized from persisted bindings | Already in tree |
| `thread/read` | T1 (today) | `GET /session/{id}` + `GET /session/{id}/message` | Already in tree |
| `thread/resume` | T1 (today) | `GET /session/{id}` | Already in tree |
| `thread/turns/list` | T1 (today) | `GET /session/{id}/message` paginated | Already in tree |
| `thread/fork` | T3 | `POST /session/{id}/fork` | T3-A.1 |
| `thread/compact/start` | T3 | `POST /api/session/{id}/compact` or fallback `/summarize` | T3-A.2 |
| `thread/generateTitle` | never | Refused `codex_only_feature` | Refusal table |
| `thread/name/set` | T1 (T1-8) + T3-D.2 verify | T1-8 stops git-handler from intercepting on OpenCode bridges; transport calls `PATCH /session/{id}` | T1-8 |
| `thread/archive` / `thread/unarchive` | T3 | Local binding flag; optional `DELETE /session/{id}` on permanent delete | T3-A.3 |
| `thread/contextWindow/read` | T1 | Refused `context_not_supported` | T1-6 |

### Turn lifecycle

| Method | Phase | Handling | Acceptance |
|---|---|---|---|
| `turn/start` | T1 (extended T2) | `POST /session/{id}/prompt_async`; T2 adds `agent` and `variant` passthrough | T2-2 |
| `turn/steer` | never | Refused `turn_steer_not_supported` | Refusal table |
| `turn/interrupt` | T1 (today) | `POST /session/{id}/abort` | Already in tree |
| `review/start` | T3 | Maps to `prompt_async` with review prefix | T3-A.4 |

### Models, agents, autocomplete

| Method | Phase | Handling | Acceptance |
|---|---|---|---|
| `model/list` | PT-2 / T1 / T2 | Extended catalog with `providerId`, `supportedVariants`, fast siblings | PT-2 |
| `collaborationMode/list` | T1 | Synthesized from `GET /agent` | T1-2 |
| `agent/list` (new) | T2 | `GET /agent` filtered, native + custom merged | T2-1 |
| `fuzzyFileSearch` | T3 | `GET /find/file` + `GET /find/symbol` | T3-B.1 |
| `skills/list` | T3 | `GET /skill` | T3-B.2 |
| `plugin/list` | T3 | `GET /mcp` read-only | T3-B.3 |

### Account / auth (all refused for OpenCode)

| Method | Phase | Handling | Acceptance |
|---|---|---|---|
| `account/status/read` | T1 | Bridge-local; returns OpenCode snapshot | Already in tree |
| `getAuthStatus` | T1 | Bridge-local; same | Already in tree |
| `account/login/start` | T1 | Refused via policy `auth_not_supported` | T1-5 |
| `account/login/cancel` | T1 | Refused via policy | T1-5 |
| `account/login/complete` | T1 | Refused via policy | T1-5 |
| `account/logout` | T1 | Refused via policy | T1-5 |
| `account/login/openOnMac` | T1 | Refused via policy | T1-5 |
| `account/rateLimits/read` | T1 | Refused via policy `rate_limits_not_supported` | T1-5 |
| `voice/resolveAuth` | T1 | Refused via policy `voice_not_supported` | T1-5 |

### Voice (refused)

| Method | Phase | Handling | Acceptance |
|---|---|---|---|
| `voice/transcribe` | never | Refused via policy `voice_not_supported` | Refusal table |

### Git (bridge-local, mostly unchanged for OpenCode)

All git methods stay bridge-local via `git-handler.js`. They work for both runtimes because git is filesystem-level. The two exceptions are AI-driven git operations.

| Method | Phase | Handling | Acceptance |
|---|---|---|---|
| `git/status`, `git/init`, `git/diff`, `git/commit`, `git/push`, `git/pull`, `git/branches`, `git/checkout`, `git/createBranch`, `git/createWorktree`, `git/createManagedWorktree`, `git/transferManagedHandoff`, `git/removeWorktree`, `git/resetToRemote`, `git/remoteUrl`, `git/runStackedAction`, `git/branchesWithStatus` | T1 (today) | Bridge-local; unchanged | Smoke test |
| `git/generateCommitMessage` | never | Refused `codex_only_feature` | Refusal table |
| `git/generatePullRequestDraft` | never | Refused `codex_only_feature` | Refusal table |

### Workspace and project folders

All `workspace/*` and `project/*` methods stay bridge-local and work for OpenCode threads. The `workspace/readImage` path lets through `~/.codex` image paths today; for T1 we verify it does not leak Codex-only state into OpenCode threads, but no change needed if it doesn't.

### Desktop

| Method | Phase | Handling | Acceptance |
|---|---|---|---|
| `desktop/continueOnDesktop` | never | Refused via policy | Refusal table |
| `desktop/continueOnMac` | never | Refused via policy | Refusal table |
| `desktop/wakeDisplay`, `desktop/preferences/update`, `desktop/bridge/updateAndRestart` | T1 (today) | Bridge-local | Smoke test |

### Notifications, pets, misc

`notifications/push/register`, `pet/list`, `pet/read` are bridge-local. T1 verifies push notifications fire for OpenCode `turn/completed` (T1-7).

---

## 10. Inbound notification synthesis (full table)

Source: Codebase Cartographer + `codex-feature-surface.md`. Every iOS-rendered notification, paired with its OpenCode bus event source.

| iOS notification | OpenCode source | Phase | Synthesizer |
|---|---|---|---|
| `thread/started` | `POST /session` response (or `session.created`) | T1 today | `emitThreadStarted` |
| `thread/name/updated` | RPC-driven | T1 / T3 | `handleThreadNameSetRequest` |
| `thread/status/changed` | `session.status` | T1 | `emitThreadStatusChanged` (new T1-3) |
| `turn/started` | `session.status` -> `busy` | T1 today | `emitTurnStarted` |
| `turn/completed` (success) | `session.status` -> `idle` | T1 today | `emitTurnCompleted` |
| `turn/completed` (failed) | `session.error` | T1 today | `emitTurnFailed` |
| `turn/plan/updated` | Plan agent state + `command.executed` for plan_enter/exit | T3 | T3-C.5 |
| `item/agentMessage/delta` | `message.part.delta` field text | T1 today | `emitAgentMessageDelta` |
| `item/reasoning/textDelta` | `message.part.delta` on reasoning parts | T1 today | `emitReasoningDelta` |
| `item/reasoning/summaryTextDelta` | not emitted | never | UI stays empty (no fake) |
| `item/plan/delta` | Plan part deltas | T3 | T3-C.5 |
| `item/fileChange/outputDelta` | `file.edited` + tool parts | T3 | T3-C.2 |
| `item/toolCall/outputDelta` | `message.part.delta` on tool parts | T1 today | `emitToolCallDelta` |
| `item/commandExecution/outputDelta` | Shell tool parts (+ EventV2 `session.next.shell.*`) | T3 | T3-C.3 |
| `item/commandExecution/terminalInteraction` | not emitted | never | UI stays empty (no PTY bridge) |
| `item/commandExecution/requestApproval` | `permission.asked` (bash) | T1 today | `emitApprovalRequest` |
| `item/fileChange/requestApproval` | `permission.asked` (edit / write) | T1 today | same |
| `item/permissions/requestApproval` | `permission.asked` (generic) | T1 today | same |
| `item/tool/requestUserInput` | `question.asked` | T1 today | `emitUserInputRequest` |
| `item/started` / `item/completed` / `item/updated` | `message.part.updated` lifecycle | T1 today | `emitItemLifecycle` |
| `item/agentSummary/...` | `todo.updated` | T3 | T3-F |
| `turn/diff/updated` | `session.diff` | T3 | T3-C.1 |
| `codex/event/exec_command_*`, `read`, `search`, `list_files`, `patch_apply_begin/end`, `user_message`, `image_generation_end`, `codex/event` envelope | varies (legacy aliases) | T3 (only those with sources) | T3-C.4 |
| `codex/event/exec_command_*` (legacy) | Shell tool parts | T3 | T3-C.4 |
| `thread/tokenUsage/updated` | `session.next.step.ended` (EventV2) | T3 | T3-D.1 (gated) |
| `account/updated`, `account/login/completed`, `account/rateLimits/updated` | not emitted | never | Codex-only; OpenCode threads stay empty |
| `serverRequest/resolved` | local; after approval reply | T3 | T3-E |
| `terminal/event` | not emitted | never | OpenCode terminal stays Mac-side |
| `turn/activity` | not emitted | never | Desktop mirror disabled for OpenCode |
| `git/stackedAction/progress` | bridge-local | T1 today | `git-handler.js` |

---

## 11. Refusal table (definitive)

The complete set of methods OpenCode threads refuse. All entries either live in `opencode-runtime-policy.js` today or get moved there in T1.

| Method | Error code | Message | Location |
|---|---|---|---|
| `voice/transcribe` | `voice_not_supported` | Voice transcription is not available with the OpenCode runtime. | `opencode-runtime-policy.js` |
| `voice/resolveAuth` | `voice_not_supported` | Voice authentication is not available with the OpenCode runtime. | T1-5 moves to policy |
| `turn/steer` | `turn_steer_not_supported` | Turn steering is not supported with the OpenCode runtime. | `opencode-runtime-policy.js` |
| `desktop/continueOnDesktop` | `desktop_continue_not_supported` | Continue on Desktop is not available with the OpenCode runtime. | `opencode-runtime-policy.js` |
| `desktop/continueOnMac` | `desktop_continue_not_supported` | Continue on Desktop is not available with the OpenCode runtime. | `opencode-runtime-policy.js` |
| `thread/generateTitle` | `codex_only_feature` | AI title generation is not available with the OpenCode runtime. | `opencode-runtime-policy.js` |
| `git/generateCommitMessage` | `codex_only_feature` | AI git generation is not available with the OpenCode runtime. | `opencode-runtime-policy.js` |
| `git/generatePullRequestDraft` | `codex_only_feature` | AI git generation is not available with the OpenCode runtime. | `opencode-runtime-policy.js` |
| `account/login/start` | `auth_not_supported` | ChatGPT account login is not available with the OpenCode runtime. | T1-5 moves to policy |
| `account/login/cancel` | `auth_not_supported` | (same) | T1-5 |
| `account/login/complete` | `auth_not_supported` | (same) | T1-5 |
| `account/login/openOnMac` | `auth_not_supported` | ChatGPT sign-in is not available with the OpenCode runtime. | T1-5 |
| `account/logout` | `auth_not_supported` | (same) | T1-5 |
| `account/rateLimits/read` | `rate_limits_not_supported` | Rate limit status is not available with the OpenCode runtime. | T1-5 |
| `thread/contextWindow/read` | `context_not_supported` | Context window usage is not available from Codex rollout for OpenCode threads. | T1-6 |
| (fallback) | `method_not_supported` | Method not supported by the OpenCode runtime: {method} | `handleUnsupportedMethod` |

Every error response uses the JSON-RPC error envelope `{ code: -32000, message: <string>, data: { errorCode, runtime: "opencode" } }`. The `message` field is always a string per L6.

---

## 12. Test plan

### Unit tests

Pattern. Each new bridge function gets a fixture-driven unit test in `phodex-bridge/test/opencode-transport.test.js`. The existing file uses flat `test("name", () => { ... })` from `node:test` (not `describe` blocks); follow that convention. Fixtures live inline when small (<50 lines); when larger, put them in `phodex-bridge/test/fixtures/opencode/<commit-id>.json` and require them in the test.

Coverage gates per tier.

- Pre-T1: 100% of new helpers (coercion, catalog shape).
- T1: each new handler and synthesizer.
- T2: each new agent / variant code path; capability filter.
- T3: each new bus mapper case + each new RPC handler.

### Canary tests

`OPENCODE_E2E=1 npm test` runs `phodex-bridge/test/opencode-e2e.test.js` against real `opencode serve`. Add canary assertions for:

- Pre-T1: provider list returns at least one provider with at least one model with at least one variant.
- T1: `collaborationMode/list` returns a non-empty result when `plan` agent exists.
- T1: SSE reconnect catch-up is manual-only (scripted SIGSTOP / SIGCONT against `opencode serve` is flaky in CI); flagged in the per-commit manual sim QA, not in the canary suite.
- T2: `agent/list` returns native agents (build, plan at minimum).
- T3: each new endpoint reachable (one canary per new RPC).

### Manual sim QA per tier

iPhone 17 simulator via `sfw npx --yes xcodebuildmcp@2.5.2 simulator build-and-run`. Pairing recipe from prior handoff. Per tier:

- Pre-T1: turn errors render as readable strings, not `"[object Object]"`.
- T1: capabilities surface; Settings hides ChatGPT account row; sidebar running badge tracks turn state.
- T2: composer opens OpenCode thread, shows Model + Intelligence + Speed + Agent submenus; per-thread overrides persist across thread switches; Settings global default applies to new threads.
- T3: slash actions (fork, archive, compact, share, summarize) work; `@`-autocomplete returns files, skills, plugins; token usage ring fills (EventV2 enabled); diff sheet populates after edit tool.

### Physical iPhone

Required before upstream PR per issue #53. Smoke each tier on real hardware over local relay.

### Regression gates per commit

Before merge:

1. `cd phodex-bridge && npm test` passes (currently 455 / 2-skipped / 457).
2. `OPENCODE_E2E=1 npm test` passes (canary).
3. `cd relay && npm test` passes (41 / 41).
4. `node --check phodex-bridge/src/opencode-transport.js` exits 0.
5. iOS build succeeds (no test run required for bridge-only commits).
6. Sim QA pass for any commit affecting iOS UX.

---

## 13. PR strategy

### Per-tier stacks on the fork

`multi-agents/opencode` is the working branch. Each tier lands as its own commit stack with a fork-level PR for review:

- Fork PR per tier (Pre-T1, T1, T2, T3).
- Each commit gets a three-reviewer pass (thermo-nuclear + architecture + unslop) before merge into the tier PR.
- Tier PR gets a final review pass against the locked acceptance criteria before merging into `multi-agents/opencode`.

### Upstream PR

Upstream PR (`Emanuele-web04/remodex`) only opens after T1 is solid on real hardware. T2 and T3 may follow as separate upstream PRs in order. The maintainer decides cadence.

### Review focus per phase

- Pre-T1: unslop (small surface, low architectural impact).
- T1: thermo-nuclear + architecture + unslop (foundation of the rest).
- T2: thermo-nuclear + architecture + unslop + iOS UX review.
- T3: thermo-nuclear + architecture + unslop per group, iOS UX review where applicable.

---

## 14. Risk register

| Risk | Mitigation phase | Mitigation detail |
|---|---|---|
| SSE reconnect during streaming loses deltas | T1-4 | Reconnect + catch-up via `GET /session/{id}/message` |
| `session.next.*` requires experimental flag and is dual-write | T3 | Gate behind transport option; default off; legacy bus everywhere else |
| In-flight turn recovery after bridge restart | T1 today + T3-D.3 | `markInFlightTurnsFailedOnBoot` + optional message poll on resume |
| `collaborationMode` object reaching string sinks | Pre-T1 | `coerceMessageString` + `resolveTurnAgent` coercion |
| `thread/name/set` not synced to OpenCode | T1-8 | Gate `git-handler.js` so OpenCode bridges route rename through transport (`PATCH /session/{id}`) |
| `thread/contextWindow/read` hits Codex rollout for OpenCode threads | T1-6 | Refuse cleanly via policy |
| Custom agent reload requires OpenCode restart | T2 | Document in iOS Agent submenu (small footnote) |
| MCP install lifecycle out of scope for iOS | T3 | `plugin/list` read-only; install stays Mac-side |
| Model id collisions across providers | Pre-T1 | Composite `providerId/modelId` ids |
| No OpenCode service tier API | T2 | Surface fast as separate catalog entries with baked `serviceTier`; iOS hides Speed submenu for non-fast models |
| Monolithic transport file maintainability | Accepted | ADR 001; section headers + state typedef + dispatch table |
| Provider OAuth on Mac invisible to iOS | T3 | Document in Settings; no iOS login RPC; OAuth is Mac-side `PUT /auth/{providerID}` |
| Worktree / git paths still Codex-layout | Accepted | Functional for OpenCode cwd; OpenCode experimental worktree API out of scope |
| Push notifications on turn complete | T1-7 | Verify tracker fires from OpenCode `turn/completed` |
| Single-runtime-per-bridge means users run two bridges to use both | Accepted | ADR 001; revisit post-T3 |
| 2598-line file growing further | Accepted | Section headers + dispatch table + state typedef keep it navigable; split deferred per ADR 001 |
| Provider OAuth revoked mid-turn | T3 | Surface `provider_unauthorized` error on next prompt; iOS shows actionable refusal |
| `git-handler.js` shadowing `thread/name/set` for OpenCode threads | T1-8 | Gate git-handler interception on `REMODEX_PROVIDER === "codex"`; OpenCode threads route through transport |
| User confusion when preferred runtime != connected bridge runtime | T2-6 | Non-blocking hint in Settings: "Connected to a Codex bridge. Switch on this Mac to use OpenCode." No silent fallback |
| Composite model id migration breaks resumed threads | PT-2 + T2-10 | PT-2 keeps composite id format; bindings serializer round-trips. Verify on every loaded binding during T2-10 |
| `/status` slash hits refused RPCs on OpenCode threads | T3-G | Hide `/status` from slash list for OpenCode threads; honest absence beats error sheet |
| Plan-mode card stays empty if T3-C.5 ships without T1-2 | T3-C.5 depends on T1-2 | Locked dependency in T3-C.5; T1-2 ships first |

---

## 15. Open architectural questions (deferred)

These get revisited only when a real user signal demands them.

1. **Dual-runtime parallel routing per thread.** Revisit after T3 ships. Demand signal: users complaining about restarting the bridge to switch.
2. **Splitting `opencode-transport.js`.** Revisit when a second non-Codex runtime adapter exists (Cursor, Gemini, etc.).
3. **`OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` as default.** Revisit when the OpenCode dev branch declares EventV2 stable.
4. **Direct OpenCode HTTP/SSE proxy to phone.** Revisit only if relay+adapter latency becomes a real complaint.
5. **OpenCode-native worktree API integration.** Revisit if Codex-layout worktrees become a problem for OpenCode users.

---

## 16. How an agent executes this plan

For a fresh agent picking up this document.

### Required reading order

1. This file in full.
2. `Docs/adr/001-opencode-runtime-shape.md`.
3. `phodex-bridge/src/opencode-transport.js` (current state; 2598 LOC).
4. `phodex-bridge/src/opencode-runtime-policy.js` (refusal table).
5. `phodex-bridge/src/bridge.js` around L259-275 (sidecar gates), L582-632 (dispatch), L824-891 (account stub).
6. `Docs/multi-provider-standalone-architecture.md` (load-bearing; sections on seam and wire mapping).
7. `/tmp/feature-catalog/codex-feature-surface.md` (76-method inventory; reference only if needed).
8. `/tmp/feature-catalog/opencode-capability-surface.md` (OpenCode HTTP / SSE inventory).

### Skills to invoke (read each in full before using)

Skills the executing agent should consult. Full paths so the agent can find them without guessing.

- `/Users/user/.agents/skills/repo-inspection/SKILL.md` for pre-implementation audits.
- `/Users/user/.claude/skills/how-to-code/SKILL.md` before writing or editing code.
- `/Users/user/.agents/skills/agent-verification-discipline/SKILL.md` for fact-checking claims about code state.
- `/Users/user/.agents/skills/verification-before-completion/SKILL.md` before claiming any commit is green.
- `/Users/user/.codex/skills/opensrc/SKILL.md` for verifying OpenCode-side claims against the `anomalyco/opencode` source.
- `/Users/user/.cursor/plugins/cache/cursor-public/pstack/21327bee99f30a73758c99f6c6459571bc9f6e98/skills/unslop/SKILL.md` for the prose pass before committing.
- `/Users/user/.agents/skills/improve-codebase-architecture/SKILL.md` for architectural review of diffs touching the dispatch table or state shape.

Reviewer subagent skills (dispatched via `Task` tool, not invoked directly):

- `thermo-nuclear-code-quality-review` subagent type (see `Task` tool's subagent registry).
- `generalPurpose` subagent type with a prompt pointing at `improve-codebase-architecture` for the architecture pass.
- `generalPurpose` subagent type with a prompt pointing at `unslop` for the prose pass.

### Execution cadence

For each commit (PT-1, PT-2, T1-1, ...):

1. Open the section in this plan. Read the change, acceptance, tests.
2. Read the cited file ranges in `opencode-transport.js`.
3. Implement the change.
4. Run unit tests; run `OPENCODE_E2E=1` if relevant; run `node --check`.
5. Dispatch three reviewer subagents in parallel per the protocol below.
6. Apply blocking review feedback before commit; document non-blocking feedback in the commit message as `Deferred: <one-line reason>`.
7. Re-run tests after applying feedback.
8. Commit. Move to next.

### Reviewer protocol (mandatory per commit, T1 onward)

For each commit, dispatch three subagents in parallel via `Task`:

- **Thermo-nuclear code review.** `subagent_type: "thermo-nuclear-code-quality-review"`, model `composer-2.5-fast`. Prompt: "Review the diff at <commit SHA> against `phodex-bridge/src/opencode-transport.js`. Report blocking findings on correctness, security, persistence safety, and refusal-table integrity."
- **Architecture review.** `subagent_type: "generalPurpose"`, model `composer-2.5-fast`. Prompt the agent to read `/Users/user/.agents/skills/improve-codebase-architecture/SKILL.md` first, then review the diff for state-shape changes, dispatch-table consistency, and unintended coupling across `OpenCodeTransportState`.
- **Unslop.** `subagent_type: "generalPurpose"`, model `composer-2.5-fast`. Prompt the agent to read `/Users/user/.cursor/plugins/cache/cursor-public/pstack/21327bee99f30a73758c99f6c6459571bc9f6e98/skills/unslop/SKILL.md` first, then audit the diff's comments, JSDoc, and any prose for AI-cliche language, mid-sentence colons, and em-dashes.

Blocking criteria. Any finding tagged Correctness, Security, Persistence, or Refusal-table is blocking and must be fixed before commit. Findings tagged Style or Optional may be deferred with a one-line note in the commit message.

### Models for subagents

Per `/Users/user/.cursor/rules/composer-2.5-subagents-only.mdc`: `composer-2.5` or `composer-2.5-fast`. Default to `composer-2.5-fast` for code edits, inspection, and review. Use `composer-2.5` only when the user explicitly requests it for prose-heavy synthesis. Never use Opus, Sonnet, GPT, or Grok subagents.

### Test commands

```bash
cd phodex-bridge && npm test
OPENCODE_E2E=1 npm test
cd ../relay && npm test
node --check phodex-bridge/src/opencode-transport.js
sfw npx --yes xcodebuildmcp@2.5.2 simulator build-and-run
```

### When to ask the user

Never block on the user for reversible work. Ask only when:

- A locked decision in section 3 conflicts with what the code reveals (decision was wrong; surface the conflict).
- A new architectural question emerges that this plan does not cover.
- Acceptance criteria are met but the user expected something different (clarify intent).

### When to update this plan

Update this file (`.scratch/autoplan/opencode-runtime/plan.md`) when:

- A locked decision changes (with a note in the row and the date).
- A new risk surfaces (add to the risk register).
- A commit ID changes shape materially (revise its section).

Do not delete completed sections; mark them done with a tag like `[Done: <SHA>]`.

---

## 16.5. Appendix: local pairing runbook for sim QA

Self-contained recipe so the executing agent can run iPhone 17 sim QA without re-deriving setup.

### One-time setup (host machine)

1. Build the bridge: `cd phodex-bridge && npm install`.
2. Build the relay: `cd relay && npm install`.
3. Build the iOS app for sim: `sfw npx --yes xcodebuildmcp@2.5.2 simulator build-and-run`.
4. Confirm `~/.remodex/opencode-bindings.json` exists at mode 0600 (gets created on first OpenCode bridge run).

### Per-session run (OpenCode mode)

1. Start the relay locally. Open a terminal: `cd relay && npm start`. Note the relay port (default 8080).
2. Start the bridge in OpenCode mode. Open another terminal: `cd phodex-bridge && REMODEX_PROVIDER=opencode npm start`. Confirm the bridge logs `OpenCode transport ready` (or equivalent).
3. The bridge prints a pairing URL or QR code in the relay console; visit it in a browser to confirm relay registration.
4. Open the iOS app in the sim. From the pairing screen, tap "Paste pairing code" (sim cannot scan QR). The pairing code is the long string in the bridge console output.
5. Confirm iOS reports "Connected to OpenCode bridge" in the Settings card.

### Per-session run (Codex mode)

Same as above with `REMODEX_PROVIDER=codex` (or unset, since Codex is the default).

### Sim QA acceptance for OpenCode threads

Before declaring a T1 / T2 / T3 commit done that requires sim QA:

1. Create a new thread in the sim. Confirm the sidebar shows the OpenCode runtime logo (T2-11).
2. Send a turn. Confirm streaming completes; the message renders with no `"[object Object]"` artifacts (PT-1).
3. Inspect Settings. Confirm ChatGPT account row is hidden (T2-6).
4. If the commit involves a slash action, picker, or sheet, exercise it and confirm behavior matches the commit's acceptance criteria.

### Real-hardware switch

iPhone 17 hardware paired via local network. Same pairing recipe except the relay must be reachable from the phone (loopback won't work; use the Mac's LAN IP or a tunnel). Required before upstream PR per issue #53.

---

## 17. Pointer to ADR

`Docs/adr/001-opencode-runtime-shape.md` documents the three coupled architectural decisions backing this plan:

1. HTTP + SSE adapter (not CLI per-turn).
2. Monolithic `opencode-transport.js` until a second non-Codex runtime exists.
3. Single runtime per bridge instance.

Read it before relitigating any of those choices.

---

## 18. Status checklist

Updated as commits land.

- [x] Pre-T1 (verified-existing; no new implementation)
  - [x] PT-1 string coercion [Done: 28b0894, verified 2026-05-26]
  - [x] PT-2 catalog shape [Done: 28b0894, verified 2026-05-26]
- [x] T1 bridge core [Done: 2026-05-26, all 8 commits implemented]
  - [x] T1-1 initialize capabilities [Done: 28b0894, verified 2026-05-26]
  - [x] T1-2 collaborationMode/list [Done: 2026-05-26]
  - [x] T1-3 thread/status/changed [Done: 2026-05-26]
  - [x] T1-4 SSE reconnect hardening [Done: 2026-05-26]
  - [x] T1-5 account refusals in policy [Done: 2026-05-26]
  - [x] T1-6 thread/contextWindow/read refusal [Done: 2026-05-26]
  - [x] T1-7 push notification verification [Done: 2026-05-26, verified transport-agnostic]
  - [x] T1-8 thread/name/set OpenCode sync [Done: 2026-05-26]
- [ ] T2 iOS pickers
  - [ ] T2-1 bridge agent/list handler
  - [ ] T2-2 ThreadBinding.agent + turn/start passthrough
  - [ ] T2-3 publicThreadFromBinding emits agentRuntime / providerId / variant / agent
  - [ ] T2-4 iOS CodexThread.agentRuntime
  - [ ] T2-5 iOS CodexModelOption providerId + supportedVariants
  - [ ] T2-6 iOS Settings card (preferred runtime, ADR-aligned)
  - [ ] T2-7 iOS composer submenus
  - [ ] T2-8 iOS CodexService fetchAgentList
  - [ ] T2-9 iOS per-thread overrides
  - [ ] T2-10 bridge persists per-thread overrides
  - [ ] T2-11 iOS sidebar runtime logo
- [ ] T3 long tail
  - [ ] T3-A.1 thread/fork
  - [ ] T3-A.2 thread/compact/start
  - [ ] T3-A.3 thread/archive
  - [ ] T3-A.4 review/start
  - [ ] T3-B.1 fuzzyFileSearch
  - [ ] T3-B.2 skills/list
  - [ ] T3-B.3 plugin/list
  - [ ] T3-C.1 turn/diff/updated
  - [ ] T3-C.2 item/fileChange
  - [ ] T3-C.3 item/commandExecution
  - [ ] T3-C.4 legacy codex/event aliases
  - [ ] T3-C.5 turn/plan/updated + item/plan/delta
  - [ ] T3-D.1 thread/tokenUsage/updated (EventV2 gated)
  - [ ] T3-D.2 thread/name/set verification
  - [ ] T3-D.3 history reconstruction
  - [ ] T3-E serverRequest/resolved
  - [ ] T3-F TODO cards
  - [ ] T3-G iOS /status gating on OpenCode threads
- [ ] Fork PR per tier
- [ ] Hardware smoke per tier
- [ ] Upstream PR (after T1 hardware-green)

---

## 19. Revision history

| Date | Change | Reason |
|---|---|---|
| 2026-05-26 | Initial draft | Author |
| 2026-05-26 | Aligned L14 + T2-6 with ADR Decision 3 (single runtime per bridge; iOS Settings stores preferred runtime, does not switch live bridge) | Edge-Case Adversary H1 |
| 2026-05-26 | Added T2-3 (bridge `publicThreadFromBinding` emits `agentRuntime`, `providerId`, `variant`) and renumbered T2-4 through T2-11 | Edge-Case Adversary H2 |
| 2026-05-26 | Rewrote T1-1 acceptance to be bridge-only verifiable (Settings UX moved to T2-6) | Edge-Case Adversary H3 / Agent-Readiness C1 |
| 2026-05-26 | Added T1-8 (`thread/name/set` git-handler bypass for OpenCode bridges) so titles sync from T1, not T3 | Edge-Case Adversary H4 |
| 2026-05-26 | Removed `/share` and `/summarize` slash actions (do not exist in `TurnComposerCommandState`); mission and QA list cleaned up | Edge-Case Adversary H5 |
| 2026-05-26 | Expanded T1-5 scope to cover the bridge.js `handleBridgeManagedAccountRequest` short-circuit path plus the policy table | Edge-Case Adversary M1 |
| 2026-05-26 | Added T2-11 (sidebar runtime logo) implementing L9 | Edge-Case Adversary M3 |
| 2026-05-26 | Added T3-G (iOS `/status` gating on OpenCode threads) | Edge-Case Adversary M4 |
| 2026-05-26 | Implemented T1-2 through T1-8 (all 8 commits). Verified PT-1/PT-2/T1-1 already done in existing commits. 483 tests, 482 pass, 0 fail, OPENCODE_E2E=1 green. Corrected Pre-T1 framing (existing code, not bug fixes). Added T1-4 SSE catch-up ordering assumption. | Sisyphus execution wave |
| 2026-05-26 | Added T2-8 (iOS `CodexService.fetchAgentList`) | Edge-Case Adversary L6 |
| 2026-05-26 | Aligned T1-4 SSE spec with existing 8s backoff cap; added max-attempts ceiling; clarified catch-up as separate from backoff | Edge-Case Adversary M8 |
| 2026-05-26 | Added migration / persistence safety notes (composite model id round-trip, archived binding migration with `BINDINGS_SCHEMA_VERSION` bump to 2 in T3-A.3) | Edge-Case Adversary M7 |
| 2026-05-26 | Fixed stale line refs throughout (`INBOUND_REQUEST_HANDLERS` at L824, not L309; `mapBusEventToCodexLines` at L1420; emit helpers near `emitTurnFailed` at L1653) | Agent-Readiness C3 |
| 2026-05-26 | Replaced nonexistent skill references with full paths to real skills | Agent-Readiness C4 |
| 2026-05-26 | Reframed T2-6 and T2-7 as edits to existing in-repo files; demoted `/tmp/feature-catalog/` references to reference-only | Agent-Readiness C5 |
| 2026-05-26 | Expanded T3 commits to PT-1 depth (files, depends, acceptance, tests, LOC per commit) | Agent-Readiness C2 |
| 2026-05-26 | Added Reviewer protocol section with subagent types, model slugs, blocking criteria | Agent-Readiness Friction 7 |
| 2026-05-26 | Added Appendix (Section 16.5): local pairing runbook for sim QA | Agent-Readiness Friction 1 |
| 2026-05-26 | Aligned test pattern (flat `test()`, not `describe`) with existing `opencode-transport.test.js` convention | Agent-Readiness Friction 5 |
| 2026-05-26 | Added risk register rows (git-handler shadowing, ADR/Settings tension, composite id migration, `/status` gating, plan-mode dependency) | Edge-Case Adversary L8 |
| 2026-05-26 | PT-2 note: `/config/providers` returns `providers` as an array; mapper must use `provider.id`, not array indices | Repo cross-check |
| 2026-05-26 | Fixed T1 commit count (8) and risk row for `thread/name/set` (T1-8, not T3-D.2) | Poteto alignment pass |
