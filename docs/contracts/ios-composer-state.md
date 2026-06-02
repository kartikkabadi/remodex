# iOS Composer State

This document defines the unified model picker state machine and capability-driven UI behavior for the iOS composer. It is the implementation guide for the SwiftUI composer views.

## Design Principle

**Model selection IS runtime selection.** The user picks a model, and the runtime is implicit. There is no separate "Runtime" row in the composer. The model picker groups models by provider, and each provider's models carry capability flags that determine which secondary controls (agent, reasoning, fast mode) appear.

## Picker Hierarchy

```
┌─────────────────────────────────┐
│ Model: GPT-5.5          ▾      │  ← Single row, groups by provider
│        ── Codex ──              │
│        • GPT-5.5                │
│        • GPT-5.5-mini           │
│        • GPT-5.5-codex-spark    │
│        ── OpenCode ──           │
│        • GPT-5.5    (OpenAI)    │
│        • Claude Opus (Anthropic)│
│        • Gemini 2.5 (Google)    │
├─────────────────────────────────┤
│ Agent: Build             ▾      │  ← Shown only for OpenCode models
│        • Build                  │     when supportsAgentSelection: true
│        • Plan                   │
├─────────────────────────────────┤
│ Intelligence: High       ▾      │  ← Shown only when model has
│        • Low                    │     supportsReasoningEffort: true
│        • Medium                 │     AND model has reasoningEfforts
│        • High                   │
├─────────────────────────────────┤
│ Fast mode              ◯       │  ← Toggle, shown when supportsFastMode
└─────────────────────────────────┘
```

## State Shape

```swift
struct ComposerSelectionState {
    // Selected model — this is the primary state
    var selectedModel: CodexModelOption

    // Derived from selectedModel
    var selectedProviderId: String  // "codex" or "opencode"
    var isOpenCode: Bool
    var isCodex: Bool

    // Optional for OpenCode only
    var selectedAgentId: String?  // nil for Codex, agent ID for OpenCode

    // Optional — only for models that support reasoning
    var selectedEffort: CodexReasoningEffortOption?

    // Optional — only for models that support fast mode
    var selectedServiceTier: CodexServiceTier?

    // Thread affinity: locked provider for existing threads
    var lockedProviderId: String?
    var isThreadLocked: Bool
}
```

## Composer Row States

Each row in the composer has three visibility states:

| State | Behavior | When |
|-------|----------|------|
| **visible + enabled** | Normal, interactive | Capability flag is true AND model supports it |
| **visible + greyed** | Shown but disabled, reason string tappable for explanation | Capability flag is false or model doesn't support |
| **hidden** | Not rendered at all | Feature is runtime-specific (Codex-only or OpenCode-only) |

### Model Row

- **Always visible.** Always enabled (unless thread is locked to a different provider).
- Groups models by `modelProvider`. Provider sections show provider badge/icon.
- When an OpenCode model is selected, the model row shows the upstream provider name (e.g., "OpenAI", "Anthropic") as a subtitle.
- Unavailable providers: "OpenCode not installed" with install instructions.

### Agent Row

- **Visible when:** `selectedModel.capabilities.supportsAgentSelection == true`
- **Hidden when:** `selectedModel.capabilities.supportsAgentSelection == false`
- **Hidden when:** Codex model selected (Codex has no agent concept)
- Agents from `runtime/catalog → runtimes.find("opencode").agents`
- **Effective agent resolution** (`CodexService.effectiveOpenCodeAgent(threadId:)`), in order:
  1. Per-thread override: `CodexThreadRuntimeOverride.opencodeAgentId` when `overridesAgent == true`
  2. Thread metadata: `CodexThread.opencodeAgent` from bridge
  3. Settings default: `defaultOpenCodeAgentId` (UserDefaults)
  4. First catalog agent id, else `"build"`
- Settings picker sets **default only**; it does not mutate existing thread overrides.
- `thread/start` and `turn/start` include `params.agent` when `modelProvider != "codex"`.
- User-facing grey-out copy lives in `ComposerCapabilityCopy` (not `TurnComposerMetaMapper`).

### Intelligence (Reasoning Effort) Row

- **Visible + enabled when:** `selectedModel.capabilities.supportsReasoningEffort == true` AND `selectedModel.supportedReasoningEfforts` is non-empty
- **Visible + greyed when:** `selectedModel.capabilities.supportsReasoningEffort == true` BUT `selectedModel.supportedReasoningEfforts` is empty (model supports the concept but has no effort levels)
- **Hidden when:** `selectedModel.capabilities.supportsReasoningEffort == false`
- Greyed reason: "This model does not support reasoning effort levels"
- Effort options: low, medium, high (from `supportedReasoningEfforts`)
- Default effort: `selectedModel.defaultReasoningEffort`

### Fast Mode Row

- **Visible + enabled when:** `selectedModel.capabilities.supportsFastMode == true`
- **Visible + greyed when:** `selectedModel.capabilities.supportsFastMode == true` BUT model doesn't actually support fast (unlikely — flag should be false)
- **Hidden when:** `selectedModel.capabilities.supportsFastMode == false`
- Toggle control (on/off)
- Values: "default" (off), "low" (on — fast mode)

### Plan Mode (+) Row

- **Visible only on Codex threads.** Controlled by `collaborationMode`.
- **Hidden on OpenCode threads entirely.**
- This is NOT the same as the OpenCode "plan" agent. Codex Plan mode is a different feature.

### Slash commands

Slash UI visibility is **capability-driven** (`supportsSlashCommands`). Which command list is shown is **provider-driven** (`modelProvider` from the selected model or locked thread).

| Condition | Command source |
|-----------|----------------|
| `supportsSlashCommands == false` | Panel hidden / greyed (`ComposerCapabilityCopy.slashCommands`) |
| Provider **opencode** + flag true | Bridge `command/list` → `[BridgeSlashCommand]` |
| Provider **codex** (or default) + flag true | `TurnComposerSlashCommand` enum (six Codex commands) |

**OpenCode RPC:** `command/list` with `{ "directory": "<thread.gitWorkingDirectory>" }` (bridge accepts `cwd` alias).

**`BridgeSlashCommand` decode shape:**

```json
{ "commands": [{ "token": "/build", "title": "Build", "description": "Build the project" }] }
```

**Cache (iOS):** `CodexService.fetchSlashCommands(directory:)` caches per normalized directory for ~60s. Invalidate on relay disconnect (`clearHydrationCaches` → `invalidateSlashCommandCache`) and when `thread.gitWorkingDirectory` changes (ViewModel refetches for the new directory).

**Selection:** Codex commands keep existing behaviors (review targets, fork destinations, compact RPC, etc.). OpenCode bridge commands insert `token` into the draft only; send path includes the `/token` text in `turn/start`.

**Empty OpenCode list:** After a successful fetch with zero commands, show inline hint “No commands for this project” (no `reasonCode` until bridge adds one).

### Other Controls

| Control | Codex Threads | OpenCode Threads |
|---------|--------------|------------------|
| Voice recording | Visible, enabled | Hidden (voice not supported) |
| Slash commands /$ | Visible, enabled | Visible when `supportsSlashCommands` (dynamic `command/list`) |
| Approvals UI | Visible, enabled | Visible, partial |
| Fork thread | Visible, enabled | Visible, greyed (if not supported) |
| Steer/Queue | Visible, enabled | Visible, greyed (if not supported) |
| Desktop handoff | Visible, enabled | Hidden |

## Grey-Out Modifier

```swift
struct CapabilityGreyOutModifier: ViewModifier {
    let isEnabled: Bool
    let reason: String?

    func body(content: Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            content
                .disabled(!isEnabled)
                .opacity(isEnabled ? 1.0 : 0.5)

            if let reason = reason, !isEnabled {
                Text(reason)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }
}
```

## Data Flow

```
1. Bridge connects
2. iOS calls runtime/catalog → gets runtimes + agents + capabilities
3. iOS calls model/list → gets all models with provider tags + capabilities
4. User interacts with composer:
   a. Opens model picker → sees providers grouped, selects model
   b. If OpenCode model: agent picker becomes visible
   c. If model supports reasoning: intelligence picker shows
   d. If model supports fast: fast toggle shows
5. User taps Send:
   a. If Codex: send "model", "serviceTier", "reasoningEffort" in turn/start
   b. If OpenCode: send "modelProvider: opencode", "agent", "model", optionally "effort"
6. Thread is created → threadId returned → stored with provider lock
```

## Thread Affinity

- **New threads:** User picks any model. Thread is created with that provider.
- **Existing threads:** The provider is locked. The model picker only shows models from the locked provider. The agent picker (for OpenCode threads) shows the previously selected agent.
- **Locked indicator:** Composer footer shows small provider badge: "OpenCode" or "Codex".
- **Switching:** The picker explicitly shows "This thread uses OpenCode" and disables Codex models.

## Persistence

- **Last model per provider:** `UserDefaults` stores the last selected model for Codex and OpenCode separately.
- **Default OpenCode agent:** `defaultOpenCodeAgentId` in UserDefaults (Settings → Runtime defaults).
- **Per-thread runtime overrides:** `CodexThreadRuntimeOverride` persisted in `codex.threadRuntimeOverrides` (model, reasoning, service tier, **opencode agent** with `overridesAgent`).
- **Thread-specific state:** `CodexThread.modelProvider` and `CodexThread.opencodeAgent` are stored in the thread model for resume.
- **On bridge reconnect:** `runtime/catalog` and `model/list` are re-fetched. Capabilities may have changed (OpenCode update added voice support). UI updates accordingly.

## Runtime catalog metadata (not capability flags)

- `RuntimeInfo.showsBetaLabel` — bridge `runtime/catalog` boolean per runtime (OpenCode `true`, Codex `false`). Composer and sidebar Beta UI read `CodexService.showsBetaLabel(forProvider:)`; views must not compare `modelProvider == "opencode"` for Beta.
- `TurnComposerRuntimeState` carries `disabledProviderIDs` and `unavailableReasonByProviderID` for the UIKit model submenu (not the full `availableRuntimes` array).

## Multi-Thread State

The composer state is per-thread. Switching threads in the sidebar changes:
- Selected model (restored from thread metadata)
- Selected agent (restored from thread metadata)
- Thread lock (provider is locked to the thread's provider)
- Last-used values are NOT carried across threads

## Edge Cases

1. **OpenCode becomes unavailable mid-session:** Bridge status update triggers `runtime/catalog` re-fetch. OpenCode entry shows `enabled: false`. Threads with locked OpenCode provider show "Provider unavailable" in composer. User can read history but can't send new turns.

2. **Model removed from OpenCode config:** `model/list` no longer includes that model. If it was the thread's model, composer shows "Model unavailable" and user must pick a different model before sending.

3. **Bridge version update adds new capability:** `runtime/catalog` includes new flag. New control becomes visible in composer automatically — no iOS update needed.

4. **Very long agent lists:** Agent picker scrolls. Default agent is pinned to top.

5. **Fast mode + reasoning together:** Both rows can appear simultaneously. No mutual exclusivity.
