# Remodex OpenCode — Full Integration Plan

## Summary

Complete the OpenCode integration in `remodex-opencode` (branch `codex/add-opencode-provider`) by adding a **Provider Registry**, gating behind `REMODEX_ENABLE_OPENCODE`, implementing `runtime/catalog`, extending reasoning to full provider coverage, restoring the relay reconnect test, and wiring the remaining iOS composer gaps.

## Architecture: Provider Registry (taste-driven)

The `.commandcode/taste/architecture/taste.md` rule is:
> Use a Provider Registry pattern rather than hardcoded provider string checks. Register providers with capabilities so adding a new provider means one file + one registration call.

### Current anti-patterns

| File | Anti-pattern |
|------|-------------|
| `runtime-provider-router.js:49` | Hardcodes `createOpenCodeProvider()` — adding a new runtime means editing router |
| `opencode-reasoning.js:103` | `includes("anthropic")` / `includes("openai")` — only 3 families via substring matching |
| `opencode-catalog.js:329` | `formatProviderDisplayName()` static 13-name map |
| `bridge.js:254` | Always creates router, never checks `REMODEX_ENABLE_OPENCODE` |

### New module: `provider-registry.js`

```js
// ProviderRegistry — single source of truth for all runtime provider
// identities, display names, reasoning defaults, and capability defaults.
// Adding a new provider = one registry entry, not cascading if/else.
```

**Registry structure:** Map of `providerId` → `{ displayName, reasoningPreferred, reasoningKeys[] }`. 14 entries covering all known OpenCode upstream providers: anthropic, openai, google, github, amazon-bedrock, openrouter, xai, deepseek, opencode, azure, groq, ollama, vertex, bedrock.

Three exported functions:
- `getProviderInfo(providerId)` — lookup with titleCase fallback for unknowns
- `getReasoningDefault(providerId, efforts)` — returns `reasoningPreferred` from registry if available in efforts, else "medium", else first
- `formatProviderDisplayName(providerId)` — delegates to `getProviderInfo`

### Consumers replaced

- `formatProviderDisplayName(providerId)` in catalog.js → import from registry
- `inferDefaultReasoningEffort(efforts, providerId)` in reasoning.js → `getReasoningDefault(providerId, efforts)`
- Removes the `includes("anthropic")` / `includes("openai")` cascade (only 3 families) — now supports every provider in the registry

---

## Bridge changes

### File 1: `phodex-bridge/src/provider-registry.js` (NEW)

Full `PROVIDER_REGISTRY` with 14 entries. Three exports. Internal `titleCase` helper.

### File 2: `phodex-bridge/test/provider-registry.test.js` (NEW)

Tests: unknown provider fallback, known provider exact match, getReasoningDefault with preferred, fallback to medium, single effort, empty → null, casing normalization.

### File 3: `phodex-bridge/src/opencode-catalog.js` — use registry

Remove static `known` map (lines 330-343). Import `formatProviderDisplayName` from `./provider-registry`. Remove local function.

### File 4: `phodex-bridge/src/opencode-reasoning.js` — use registry

Replace `inferDefaultReasoningEffort()` body with `getReasoningDefault(upstreamProviderId, efforts)` from registry. Remove 3-family `includes()` cascade. Keep the 7-step `extractReasoningEffort()` cascade (it's generic and handles all provider shapes regardless of identity).

### File 5: `phodex-bridge/src/runtime-provider-router.js` — flag gating + `runtime/catalog`

**Flag gating:** When `providers` is null, check `REMODEX_ENABLE_OPENCODE=1`. If set → auto-create OpenCode provider. If unset → empty providers array (Codex-only passthrough).

**`runtime/catalog` handler:** Intercept in `handleApplicationMessage()` before routable methods. Build `{ runtimes: [{ id, label, enabled, unavailableReason, agents, capabilities }] }`. For OpenCode: enabled only when binary on PATH AND flag is set. Agents populated from `opencode agent list` CLI cache.

Export `buildRuntimeCatalog` for testing.

### File 6: `phodex-bridge/src/bridge.js` — env flag wiring

One-line change at line 254:
```js
providers: process.env.REMODEX_ENABLE_OPENCODE === "1" ? undefined : [],
```

When flag is off (or absent), empty providers means Codex-only passthrough.

### File 7: `phodex-bridge/test/runtime-provider-router.test.js` — new tests

- `runtime/catalog` returns runtimes array with Codex always present
- `runtime/catalog` with OpenCode provider → OpenCode runtime entry
- Flag-off: empty providers → only Codex in catalog, no OpenCode registration

### File 8: `relay/simulated-pairing-reconnect.test.js` — restore

Copy from `repos/remodex/relay/simulated-pairing-reconnect.test.js` → `repos/remodex-opencode/relay/`. File exists on main, deleted on branch. Passes standalone.

---

## iOS changes (5 files)

### File 9: `TurnComposerRuntimeUIKitMenu.swift` — implement `agentMenu()`

The method is called at line 40 but returns nil (bodyless). Implementation:

- Read `input.runtimeState.availableAgents` (new field)
- If empty → return nil (no agent row for Codex threads)
- Map agents to `UIAction` with `singleSelection` → checkmark on selected
- Wire `input.runtimeActions.selectAgent(agent.id)` on tap
- Title: "Agent", subtitle: selected agent display name

Also add to the `Input` struct: `var availableAgents: [AgentOption] = []` and `var selectedAgent: String? = nil`.

### File 10: `TurnComposerRuntimeState.swift` — add agent fields

New fields: `availableAgents: [AgentOption]`, `selectedAgent: String?`. Computed: `selectedAgentDisplayName: String?`.

New struct: `AgentOption: Equatable, Identifiable { let id: String; let displayName: String }`.

### File 11: `TurnComposerRuntimeActions.swift` — already wired

Already has `selectAgent: (String?) -> Void` calling `codex.setSelectedAgentOverride(agent, for: threadId)`. Works once `setSelectedAgentOverride` exists in CodexService.

### File 12: `ComposerBottomBar.swift` — RuntimeProviderLogo in pill

In `ComposerRuntimeMenuControl.composerMenuLabel()`, prepend `RuntimeProviderLogoView(provider: selectedModelProvider, size: 14)` in the HStack before model text.

Add computed `selectedModelProvider: String` — resolves from `orderedModelOptions` matching `selectedModelID`.

### File 13: `CodexService+RuntimeConfig.swift` — agent override + catalog fetch

New methods:
- `setSelectedAgentOverride(_ agent: String?, for threadId: String?)` — stores in `opencodeAgentOverride` property
- `fetchRuntimeCatalog()` — calls `runtime/catalog` RPC, parses `runtimes[].agents[]`, populates `availableAgents`

New stored properties: `opencodeAgentOverride: String?`, `availableAgents: [AgentOption]`.

### File 14: `TurnComposerMetaMapper.swift` — agent title mapping

Add `agentTitle(for agentId: String) -> String` — maps build/plan/general/explore → capitalized display names, fallback splits on `-`.

### File 15: `CodexThread.swift` — add `opencodeAgent` field

New property `var opencodeAgent: String?`. CodingKeys: `case opencodeAgent`, `case opencodeAgentSnake = "opencode_agent"`. Decode from either key. Include in `init` parameters.

---

## Execution order

1. **`provider-registry.js`** + tests — foundation for steps 3-4
2. **`opencode-catalog.js`** + **`opencode-reasoning.js`** — switch to registry
3. **`runtime-provider-router.js`** — flag gating + `runtime/catalog` RPC + test updates
4. **`bridge.js`** — one-line env flag
5. **`relay/`** — restore reconnect test
6. **Run full bridge suite** — 460+ tests must pass
7. **iOS changes** (9-15) — Swift file modifications

---

## Verification

```bash
# Full bridge test suite:
cd phodex-bridge && node --test test/*.test.js
# Expected: >= 460 tests, 0 failures

# Flag-off test:
REMODEX_ENABLE_OPENCODE=0 node --test test/*.test.js
# Expected: same count, Codex-only passthrough

# Relay reconnect test:
cd relay && node --test simulated-pairing-reconnect.test.js
# Expected: 1 test, 0 failures
```
