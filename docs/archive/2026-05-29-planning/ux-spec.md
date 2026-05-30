# Remodex multi-agent — UX-first minimal design

Verified 2026-05-29 against `repos/remodex` (main), `repos/remodex-opencode` (`codex/add-opencode-provider` worktree), and `repos/opencode` (ACP docs).

**Product contract (Kartik):** One composer entry point — the runtime pill immediately left of stop/send — with a single hierarchical picker. Codex and OpenCode are first-class; bridge stays lean (**ACP stdio primary**, CLI fallback only where catalog says ACP cannot satisfy).

**Plan reset (2026-05-29):** Full OpenCode integration on branch-as-base — see `PLAN-SUMMARY.md`. Slices A–D below are **milestone shorthand** (map to M1–M4 in `plan.md`), not tiny upstream PRs.

---

## Capability-driven UI

Composer rows are driven by **`runtime/catalog`** + per-model flags from merged **`model/list`**. iOS never infers capability from empty lists or hard-coded runtime.

### Sources of truth

| Source | Fields | Consumer |
|--------|--------|----------|
| `runtime/catalog` | `runtimes[].enabled`, `unavailableReason`, `agents[]`, `capabilities` (transport, slash, approvals, …) | Runtime row, OpenCode agent submenu |
| `model/list` (merged) | `modelProvider`, `supportedReasoningEfforts`, `supportsFastMode`, per-model `unavailableReason` | Model, Intelligence, Speed rows |
| Thread decode | `thread.modelProvider`, `thread.opencodeAgent` | Disable runtime/agent changes on strict threads |

Bridge builds catalog at request time (cache ≤60s). **No second selection state on Mac** — iOS sends flat `thread/start` / `turn/start` fields; bridge validates against catalog before harness.

### Enabled vs greyed vs hidden

| State | When | UI |
|-------|------|-----|
| **enabled** | Catalog/model flags say supported; harness available | Normal menu row, checkmark selection |
| **greyed** | Known feature, not available for this runtime/model/transport | Row visible, `disabled`, subtitle = reason |
| **hidden** | Not applicable (e.g. OpenCode agent row on Codex thread) | Section omitted |
| **Forbidden** | Never show enabled without proof | No silent omit of row that Codex shows enabled |

**OpenCode threads:** Any control Codex would show as enabled but OpenCode cannot perform → **greyed + reason**, not hidden (unless n/a on all threads).

### Reason strings (copy patterns)

Use short, actionable subtitles (≤1 line under row title):

| Code | User-facing pattern |
|------|---------------------|
| `opencode_not_installed` | OpenCode isn’t installed on your Mac |
| `opencode_disabled` | OpenCode is off — enable on Mac bridge |
| `acp_gap` | Not available in OpenCode yet (ACP) |
| `cli_only` | Available via CLI fallback only — … |
| `codex_only` | Codex only |
| `model_unsupported` | This model doesn’t support … |
| `thread_locked` | Locked for this chat’s runtime |
| `relay_offline` | Connect to Mac to change runtime |

Bridge returns machine-readable `reason` + optional `reasonDetail` in catalog; iOS maps to localized string keys in `TurnComposerMetaMapper`.

### Errors (not greyed)

- **Attempted action while greyed:** No-op in UI; if forced via stale state, bridge returns JSON-RPC error with same `reason` code → toast.
- **Turn failure:** Existing turn failed path; include provider id in message (*OpenCode couldn’t complete this turn*).
- **Codex-only bridge handler on OpenCode thread:** `application/error` with `codex_only` → iOS toast, not crash.

### Beta label

OpenCode threads may show **beta** on pill/thread list while parity matrix marks streaming/tools **partial** — beta is honest labeling, not a substitute for greying unsupported rows.

---

## 1. Gap analysis (picker rows)

| Picker row | Current Codex (main) | OpenCode needs | Owner |
|------------|----------------------|----------------|-------|
| **1. Agent runtime** (Codex \| OpenCode) | Implicit: everything is Codex app-server. No runtime row. | Explicit `modelProvider` / harness routing (`runtime-provider-router.js` reads `modelProvider`, `provider`, `harness`). | **iOS:** new top-level menu section in `TurnComposerRuntimeUIKitMenu.swift`. **Bridge:** router + ownership store (already sketched on branch). |
| **2. OpenCode agent role** (plan / build / custom) | Codex uses `collaborationMode` + Plan mode toggle (`ComposerBottomBar` attachment menu), not OpenCode agents. | `opencode run --agent <name>` and `opencode agent list` (see `repos/opencode/packages/opencode/src/cli/cmd/agent.ts`). Custom agents from user OpenCode config. | **Bridge:** list agents via CLI or ACP session metadata; pass `agent` on turn/thread. **iOS:** submenu visible only when runtime = OpenCode. |
| **3. Provider** (within runtime) | Not exposed; models are flat Codex SKUs in `model/list`. | OpenCode models are `provider/model` slugs (`opencode-models.js` parses `opencode models` output). | **Bridge:** merge in `model/list`; tag each item with `modelProvider`. **iOS:** branch already groups by `modelProvider` inside Model submenu (`remodex-opencode` `TurnComposerRuntimeUIKitMenu.providerMenus`). |
| **4. Model** | `ComposerBottomBar` → `ComposerRuntimeMenuControl` → Model / Intelligence / Speed (`TurnComposerRuntimeUIKitMenu.swift`). Selection via `CodexService+RuntimeConfig.listModels()` → `model/list`. | Same RPC; OpenCode entries use `selectionKey` `opencode:provider/model` (branch `CodexModelOption.selectionKey`). | **iOS:** `CodexModelOption.swift` + `TurnComposerRuntimeActions.selectModel`. **Bridge:** `mergeModelListResult` in `runtime-provider-router.js`. |
| **5. Reasoning / intelligence** | Intelligence submenu from `supportedReasoningEfforts` on `CodexModelOption`; sent as `effort` on `turn/start` (`CodexService+ThreadsTurns.buildTurnStartParams`). Per-thread overrides in `CodexThreadRuntimeOverride`. | OpenCode branch sets `supportedReasoningEfforts: []` on OpenCode models (`opencode-models.js`). Need mapping from OpenCode model/agent capabilities when available. | **Bridge:** enrich OpenCode model metadata (CLI/ACP/SDK). **iOS:** hide or disable Intelligence row when empty (already pattern: `intelligenceMenu` returns nil if no options). |
| **6. Fast mode** | Speed submenu + plus-menu bolt (`ComposerBottomBar`); `serviceTier` on `thread/start` / `turn/start` when bridge supports it (`CodexService.supportsServiceTier`). | Branch hard-codes `supportsFastMode: false` for OpenCode. | **Bridge:** truthy flags per model when OpenCode exposes them. **iOS:** gate Speed submenu on `runtimeState.supportsFastMode`. |

**Parity gaps (not picker rows but contract):**

| Capability | Codex today | OpenCode branch | Owner |
|------------|-------------|-----------------|-------|
| Slash commands / skills / MCP | App-server + bridge local handlers in `bridge.js` `handleApplicationMessage` | OpenCode path bypasses Codex; skills/MCP live inside OpenCode process | **Bridge:** route non-thread RPCs to Codex; document OpenCode-only commands. **Slice D.** |
| Git / workspace Remodex features | Bridge handlers (git, workspace, desktop, voice) | Unchanged; must not require Codex thread | **Bridge** (no iOS change). |
| Streaming / tool UX | Codex notifications (`turn/started`, item deltas) | CLI `opencode run` JSON lines → synthetic deltas (`opencode-provider.js`) | **Bridge harness choice** (see §4). |
| Thread affinity | `CodexThread.modelProvider` on main; strict provider policy only on branch | `RuntimeProviderPolicy.strictThreadProviders` includes `opencode` | **iOS** + **bridge** `thread-ownership-store` (durable). |

---

## 2. Data shape: `SessionRuntimeSelection`

Single source of truth on **iOS** (persisted in `UserDefaults` / existing runtime prefs). **Bridge** receives a flattened projection on each `thread/start` and `turn/start` (no duplicate full state on Mac).

### TypeScript (bridge / tests)

```ts
/** Discriminated by agent runtime (harness). */
type SessionRuntimeSelection =
  | CodexRuntimeSelection
  | OpenCodeRuntimeSelection;

type CodexRuntimeSelection = {
  runtime: "codex";
  model: string;                    // e.g. "gpt-5.5"
  reasoningEffort?: string;         // e.g. "medium"
  fastMode: boolean;                // maps to serviceTier "fast" | omitted
};

type OpenCodeRuntimeSelection = {
  runtime: "opencode";
  opencodeAgent: string;            // e.g. "build" | "plan" | user-defined
  provider: string;                 // segment before "/" in model slug
  model: string;                    // full slug e.g. "anthropic/claude-sonnet-4"
  reasoningEffort?: string;         // optional, when catalog says supported
  fastMode: boolean;                // usually false until OpenCode exposes tier
};
```

### Swift (iOS)

```swift
enum AgentRuntime: String, Codable, CaseIterable {
    case codex
    case opencode
}

struct SessionRuntimeSelection: Codable, Equatable {
    var runtime: AgentRuntime
    var opencodeAgent: String?       // required when runtime == .opencode
    var provider: String             // "codex" | "opencode" | upstream id
    var model: String                // Codex model id OR opencode/provider/model
    var reasoningEffort: String?
    var fastMode: Bool

    var selectionKey: String {
        CodexModelOption.selectionKey(provider: provider, modelId: model)
    }
}
```

### Map to existing RPC params

| Field | `thread/start` | `turn/start` | Notes |
|-------|----------------|--------------|-------|
| `runtime` | `modelProvider` | `modelProvider` | Already read by `readModelProvider()` in `opencode-models.js`. Values: `codex`, `opencode`. |
| `model` | `model` | `model` | Codex: bare id. OpenCode: `provider/model` slug. |
| `opencodeAgent` | `agent` (new) | `agent` (new) | Not on branch today; add to `opencode-provider` `run` args (`--agent`). |
| `reasoningEffort` | — | `effort` | Codex path only today; strip for Codex forward via `stripRuntimeProviderFieldsForCodex`. |
| `fastMode` | `serviceTier: "fast"` | `serviceTier` | Codex only when `supportsServiceTier`; strip for OpenCode. |
| Plan mode (Codex) | — | `collaborationMode` | Keep separate from OpenCode `plan` agent; do not conflate. |

**iOS persistence:** Store encoded `SessionRuntimeSelection` (or reuse `selectedModelId` = `selectionKey` + new keys `selectedAgentRuntime`, `selectedOpenCodeAgent`). Branch already uses `codex:gpt-5.5` vs `opencode:anthropic/...` selection keys.

**Thread affinity:** On `thread/start` response, persist `thread.modelProvider` + optional `thread.opencodeAgent` on `CodexThread`. Enforce `strictThreadProviders` so runtime row is disabled or read-only when viewing an OpenCode thread.

---

## 3. Minimal architecture

The **runtime-provider router stays in `phodex-bridge`** (`bridge.js` calls `runtimeProviderRouter.handleApplicationMessage` before `codex.send`, with `stripRuntimeProviderFieldsForCodex`). iOS continues to speak **Codex-shaped JSON-RPC** over the relay; it never spawns OpenCode.

**One new bridge method (v1):** `runtime/catalog` (application JSON-RPC, handled only in bridge — not forwarded to Codex).

```json
{
  "runtimes": [
    { "id": "codex", "label": "Codex" },
    {
      "id": "opencode",
      "label": "OpenCode",
      "enabled": true,
      "agents": [{ "id": "build", "label": "Build" }, { "id": "plan", "label": "Plan" }],
      "defaultAgent": "build"
    }
  ]
}
```

Populated by: Codex runtime always present; OpenCode agents from `opencode agent list` (cached); models still from merged `model/list`. **Avoid** a second mutable selection state on the bridge — iOS sends the flattened fields above; bridge only caches catalog + thread ownership.

**Why router on Mac:** Thread routing, `ownsThread()`, subprocess/ACP lifecycle, and Remodex-local handlers (git, workspace) already live in `phodex-bridge/src/bridge.js`. Duplicating routing on iOS would split affinity rules and break desktop mirror safety (OpenCode threads must not hit `codex-desktop-refresher.js`).

---

## 4. ACP vs CLI for this UX (v1 recommendation)

| Criterion | CLI (`opencode run`, branch today) | ACP stdio (`opencode acp`) |
|-----------|-----------------------------------|----------------------------|
| Process shape | **Per-turn subprocess** | **Long-lived child** (matches `codex-transport.js`) |
| Streaming | Parsed JSON lines; partial deltas emulated | ACP README: **no `session/update` streaming yet** (`packages/opencode/src/acp/README.md`) |
| Slash / subagents | Whatever OpenCode CLI runs in one shot | `session/prompt` + agent config; closer to IDE parity |
| `/commands`, skills, MCP | Limited to single `run` invocation | Session-scoped; aligns with “full OpenCode parity” goal |
| Testability | Branch has 275+ lines of provider tests | New adapter; mock stdio like Codex tests |
| Risk | Known green tests on branch | ACP gaps; more mapping work upfront |

**Decision (reset plan):** **ACP stdio primary** (`opencode-acp-harness.js`, same `ProviderHarness` surface as branch CLI provider). **`REMODEX_OPENCODE_TRANSPORT=cli` fallback only** for capabilities ACP cannot satisfy — must appear in `runtime/catalog.capabilities` so UI can grey with `acp_gap` / `cli_only` reasons. Per-turn CLI is **not** the primary UX path. Label OpenCode threads **beta** while parity matrix marks streaming/tools partial; grey unsupported rows regardless of beta.

**Evidence:** Branch `opencode-provider.js` `runTurn` spawns `opencode run` per message (lines 296–316). Codex uses persistent `codex app-server`. ACP uses the same stdio JSON-RPC pattern as Codex (`opencode acp` README Architecture).

---

## 5. Phased slices (milestone map → plan M1–M4)

Not upstream PR order. Full integration on branch-as-base.

### Slice A — Runtime row + thread affinity (Codex default unchanged) → **M1 / M3**

**Goal:** User sees **Agent runtime** at top of composer menu; default Codex; threads remember harness.

| Layer | Work |
|-------|------|
| Bridge | Land router skeleton (Codex-only) + `thread-ownership-store.js`; `runtime/catalog` returns `{ codex }` only. |
| iOS | Add runtime section to `TurnComposerRuntimeUIKitMenu.swift`; wire `SessionRuntimeSelection.runtime`; send `modelProvider: "codex"` on start (explicit). |
| Tests | Router ownership tests; iOS runtime menu snapshot / unit tests. |

**Exit:** Fresh install behaves like today; OpenCode runtime **greyed** with `unavailableReason` until harness + catalog enable (Slice B).

### Slice B — OpenCode models + plan/build agents → **M2 / M3**

**Goal:** OpenCode runtime selectable; models grouped by provider; plan/build agent submenu.

| Layer | Work |
|-------|------|
| Bridge | Register OpenCode harness (**ACP primary**, CLI fallback); `runtime/catalog` agents from `opencode agent list`; merge OpenCode models in `model/list`. |
| iOS | Port branch pieces: `CodexModelOption.modelProvider`, `selectionKey`, `RuntimeProviderLogo`, `CodexService+RuntimeConfig` provider helpers, provider-grouped model menu. |
| Env | `REMODEX_ENABLE_OPENCODE=1` on Mac. |

**Exit:** One OpenCode thread on device: pick runtime → agent → model → send; streaming acceptable as beta.

### Slice C — Reasoning + fast mode parity → **M3 / M4**

**Goal:** Intelligence and Speed rows reflect real capabilities per runtime/model.

| Layer | Work |
|-------|------|
| Bridge | Populate `supportedReasoningEfforts` / `supportsFastMode` for OpenCode when catalog provides them; pass `effort` / `serviceTier` only on Codex forward path. |
| iOS | No new UI; Intelligence/Speed gate on catalog — **greyed + reason** when unsupported, not fake-enabled. |

**Exit:** Codex fast/reasoning unchanged; OpenCode rows enabled or greyed per catalog (see § Capability-driven UI).

### Slice D — Slash / skills / MCP parity gaps → **M4**

**Goal:** Remodex slash commands and bridge-local tools keep working; document OpenCode-native commands.

| Layer | Work |
|-------|------|
| Bridge | Audit `handleApplicationMessage` for methods that must not be stripped; optional forward of skill/slash payloads into OpenCode session when on OpenCode thread. |
| iOS | Skill mentions, MCP settings UX unchanged; error copy when action is Codex-only on OpenCode thread. |

**Exit:** Matrix doc in bridge README: which composer actions work per runtime.

---

## 6. iOS mock structure (files to touch)

**Composer picker (primary UX)**

- `CodexMobile/CodexMobile/Views/Turn/Composer/ComposerBottomBar.swift` — pill placement (already `runtimeMenuControl` before stop/send).
- `CodexMobile/CodexMobile/Views/Turn/Composer/TurnComposerRuntimeUIKitMenu.swift` — add **Agent runtime** section above Model; conditional **OpenCode agent** section.
- `CodexMobile/CodexMobile/Views/Turn/Composer/TurnComposerRuntimeState.swift` — expose `selectedRuntime`, `selectedOpenCodeAgent`, catalog loading flags.
- `CodexMobile/CodexMobile/Views/Turn/Composer/TurnComposerRuntimeActions.swift` — `selectRuntime`, `selectOpenCodeAgent`.
- `CodexMobile/CodexMobile/Views/Turn/Composer/TurnComposerMetaMapper.swift` — labels for runtime/agent.
- `CodexMobile/CodexMobile/Views/Shared/RuntimeProviderLogo.swift` — runtime/provider icons (from branch).

**Service / RPC**

- `CodexMobile/CodexMobile/Services/CodexService+RuntimeConfig.swift` — persist `SessionRuntimeSelection`, `runtime/catalog` fetch, `listModels` grouping.
- `CodexMobile/CodexMobile/Services/CodexService+ThreadsTurns.swift` — `makeThreadStartParams` + `turn/start` include `modelProvider`, `agent`.
- `CodexMobile/CodexMobile/Models/CodexModelOption.swift` — `modelProvider`, `selectionKey` (branch delta vs main).
- `CodexMobile/CodexMobile/Models/CodexThread.swift` (or thread decode site) — `modelProvider`, `opencodeAgent` on thread.

**Settings / defaults**

- `CodexMobile/CodexMobile/Views/Settings/SettingsRuntimeDefaultsCard.swift` — default runtime + default OpenCode agent.

**Tests**

- `CodexMobile/CodexMobileTests/CodexThreadStartProjectBindingTests.swift`
- `CodexMobile/CodexMobileTests/CodexThreadRuntimeOverrideTests.swift`
- New: `SessionRuntimeSelectionTests.swift` (encoding + RPC projection).

**Assets**

- `CodexMobile/CodexMobile/Assets.xcassets` — `RuntimeLogoOpenCode`, `RuntimeLogoCodex` (branch asset names).

---

## 7. Explicit non-goals (v1)

- File-by-file cherry-pick onto `main` as the integration strategy (use branch-as-base + fix forward instead).
- Tiny upstream PR-first delivery before device E2E.
- Cursor, Gemini, pi, Claude Code as composer runtimes.
- `opencode serve` HTTP / dpcode Effect server in the bridge.
- litter Rust mobile core or Android-specific RPC forks.
- Changing relay pairing or encryption (`secure-transport.js`).
- Feature parity claims without device E2E on OpenCode + Codex threads.
- OpenCode **custom agent editor** on iOS (pick from config list only).
- Replacing Codex Plan mode toggle with OpenCode plan agent (keep both; different semantics).

---

## Menu hierarchy mock (target)

```
[Composer pill ▾]
├── Agent runtime          → Codex ✓ | OpenCode
├── OpenCode agent         → Build ✓ | Plan | …custom (if runtime=OpenCode)
├── Model                  → (provider submenu) → models…
├── Intelligence           → (if supported)
├── Speed                  → Normal | Fast (if supported)
└── (attachment menu unchanged: Plan mode, photos, etc.)
```

Codex Plan mode stays in the **+** attachment menu (`ComposerBottomBar.attachmentMenu`), not in the OpenCode agent row.

---

## Principles applied

- **Experience First:** One pill, one hierarchy; no settings-only runtime switching.
- **Foundational Thinking / Type System Discipline:** `SessionRuntimeSelection` discriminated union before UI work.
- **Boundary Discipline:** Router + harness on bridge; iOS projects flat RPC fields.
- **Laziness Protocol:** Reuse `model/list` merge and existing Intelligence/Speed menus; one new `runtime/catalog` RPC.
- **Outcome-Oriented Execution:** ACP-primary harness; CLI fallback only.
