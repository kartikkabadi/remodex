# Remodex OpenCode — Corrected Architecture Plan

## Key Discovery: OpenCode Already Computes Everything

Deep exploration of `repos/opencode/packages/llm`, `repos/opencode/packages/opencode/src/provider/` revealed:

- **`parsed.name`** ("Claude Sonnet 4.5") exists in verbose CLI output — bridge ignores it
- **`ProviderTransform.variants()`** computes reasoning effort variants per model — bridge duplicates inference
- **`Provider.Info.name`** exists per upstream provider — bridge uses hardcoded map instead
- **`ProviderHarness` interface** is the extensibility seam, not a hardcoded registry

## Correct Approach: Flow Data, Don't Hardcode

| Current (anti-pattern) | Fixed (data-flow) |
|---|---|
| `displayNameForOpenCodeModel()` derives name from model ID string | Read `parsed.name` from verbose output first, fall back |
| `inferDefaultReasoningEffort()` uses `includes("anthropic")` cascade | Pick from actual available efforts: prefer "high", else "medium", else first |
| `formatProviderDisplayName()` static 13-name map | Keep as normalizer (stable, finite set from OpenCode catalog), but check `parsed.providerName` if available |
| Hardcoded `createOpenCodeProvider()` in router | Already generic via `providers[]` array — just add env flag |
| No `runtime/catalog` RPC | Implement as bridge handler, sourcing agents from OpenCode CLI |

## Bridge changes (5 files)

### 1. `opencode-catalog.js` — use `parsed.name` for display

In `buildRichModelOption()`, change:
```js
displayName: displayNameForOpenCodeModel(modelReference),
```
To:
```js
displayName: modelData?.name || displayNameForOpenCodeModel(modelReference),
```

Also in `formatProviderDisplayName()`, add a check for `parsed.providerName` from verbose output if available (the upstream provider JSON blob may contain a `provider` field with the name). But the static map + titleCase fallback is adequate since upstream provider IDs from OpenCode's catalog are a finite, stable set.

### 2. `opencode-reasoning.js` — simplify default selection

Replace the `inferDefaultReasoningEffort()` body:
```js
// OLD: checks provider.includes("anthropic") → "high", provider.includes("openai") → "medium"
// NEW: preference-ordered from actual available efforts
const ordering = ["high", "medium", "low", "minimal"];
for (const pref of ordering) {
  if (values.includes(pref)) return pref;
}
return values[0];
```

This is provider-agnostic. It uses the model's actual available reasoning efforts, preferring "high" for better quality, falling back to "medium" → "low" → "minimal" → anything available.

### 3. `runtime-provider-router.js` — flag gating + `runtime/catalog`

**Flag gating**: When `providers` is null, check `process.env.REMODEX_ENABLE_OPENCODE`:
- Set → create OpenCode provider as default
- Unset → empty providers array (Codex-only passthrough)

**`runtime/catalog` RPC**: Intercept in `handleApplicationMessage()`:
```js
if (method === "runtime/catalog") {
  const catalog = buildRuntimeCatalog(runtimeProviders, process.env);
  sendApplicationResponse(JSON.stringify({ id: parsed.id, result: catalog }));
  return true;
}
```

`buildRuntimeCatalog()` returns:
```json
{
  "runtimes": [
    {
      "id": "codex",
      "label": "Codex",
      "enabled": true,
      "agents": [],
      "capabilities": { "supportsFastMode": true, ... }
    },
    {
      "id": "opencode", 
      "label": "OpenCode",
      "enabled": true,
      "unavailableReason": null,
      "agents": [
        { "id": "build", "label": "Build" },
        { "id": "plan", "label": "Plan" }
      ],
      "capabilities": { "supportsAgentSelection": true, "transport": "acp", ... }
    }
  ]
}
```

### 4. `bridge.js` — env flag wiring

One-line change at line 254:
```js
providers: process.env.REMODEX_ENABLE_OPENCODE === "1" ? undefined : [],
```

### 5. `runtime-provider-router.test.js` — new tests

- Flag-off: empty providers → Codex-only passthrough
- Flag-on: auto-creates OpenCode provider  
- `runtime/catalog` returns runtimes array with Codex always present

---

## Test restoration

### 6. `relay/simulated-pairing-reconnect.test.js`

Copy from `repos/remodex/relay/simulated-pairing-reconnect.test.js` → `repos/remodex-opencode/relay/`. Exists on main, deleted on branch.

---

## iOS changes (5 files)

### 7. `TurnComposerRuntimeUIKitMenu.swift` — implement `agentMenu()`

`agentMenu()` is called but has no body. Implementation:
- Read `input.runtimeState.availableAgents` (new field)
- If empty → return nil
- Map to UIAction with singleSelection → checkmark on selected
- Wire `input.runtimeActions.selectAgent(agent.id)` on tap

### 8. `ComposerBottomBar.swift` — RuntimeProviderLogo in pill

In `ComposerRuntimeMenuControl.composerMenuLabel()`, prepend `RuntimeProviderLogoView(provider: selectedModelProvider, size: 14)`.

### 9. `TurnComposerRuntimeState.swift` — add agent fields

`availableAgents: [AgentOption]`, `selectedAgent: String?`, computed `selectedAgentDisplayName`. New `AgentOption` struct.

### 10. `CodexService+RuntimeConfig.swift` — agent override + catalog fetch

`setSelectedAgentOverride()`, `fetchRuntimeCatalog()` calling `runtime/catalog` RPC.

### 11. `CodexThread.swift` — add `opencodeAgent` field

New property `var opencodeAgent: String?` with snake_case alias.

---

## Files touched

| # | File | Action | Loc |
|---|------|--------|-----|
| 1 | `opencode-catalog.js` | Use `parsed.name` for displayName | 1 line |
| 2 | `opencode-reasoning.js` | Simplify default selection (no includes()) | 5 lines |
| 3 | `runtime-provider-router.js` | Flag gating + `runtime/catalog` | ~40 lines |
| 4 | `bridge.js` | Env flag | 1 line |
| 5 | `runtime-provider-router.test.js` | Flag-off + catalog tests | ~30 lines |
| 6 | `relay/simulated-pairing-reconnect.test.js` | Restore from main | 636 lines (copy) |
| 7 | `TurnComposerRuntimeUIKitMenu.swift` | `agentMenu()` body | ~25 lines |
| 8 | `ComposerBottomBar.swift` | RuntimeProviderLogo in pill | ~10 lines |
| 9 | `TurnComposerRuntimeState.swift` | Agent fields | ~15 lines |
| 10 | `CodexService+RuntimeConfig.swift` | Override + catalog fetch | ~30 lines |
| 11 | `CodexThread.swift` | `opencodeAgent` field | ~8 lines |

---

## Execution order

1. Bridge fixes (files 1-4) — subagent 1
2. Router tests (file 5) — subagent 1
3. Relay test restore (file 6) — subagent 1
4. Run full test suite — subagent 1
5. iOS changes (files 7-11) — subagent 2
