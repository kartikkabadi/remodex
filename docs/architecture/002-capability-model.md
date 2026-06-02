# ADR-002: Capability Model

**Date:** 2026-05-30
**Status:** Accepted

## Context

Different coding runtimes support different features. Codex supports voice, plan mode, desktop handoff, worktree forking — OpenCode supports agent selection but not voice or plan mode. The iOS composer shows rows for model selection, agent selection, reasoning effort, and fast mode. Some rows should be hidden on OpenCode threads. Others should show as available but greyed out with an explanation.

The iOS app must not make runtime-specific decisions ("if provider is OpenCode, hide plan mode"). It must be driven by capability flags from the bridge. This ensures adding a new runtime never requires iOS code changes — if a new runtime advertises `supportsVoice: true`, voice appears automatically.

## Decision

Use **15 capability flags** as the single source of truth for what the iOS composer shows, hides, or greys out. The authoritative list and per-runtime defaults live in `phodex-bridge/src/provider-capabilities.js` (`CAPABILITIES`, `CODEX_CAPABILITIES`, `OPENCODE_CAPABILITIES`).

### The 15 Flags

| Flag | What it controls | Codex default | OpenCode default |
|------|-----------------|---------------|------------------|
| `supportsAgentSelection` | Show/hide the OpenCode agent submenu (build/plan/custom) | false | true |
| `supportsReasoningEffort` | Show/hide/grey the Intelligence/Reasoning picker row | true | false* |
| `supportsFastMode` | Show/hide/grey the Fast mode toggle | true | false* |
| `supportsPlanMode` | Show/hide the Codex Plan mode (+) toggle | true | false |
| `supportsVoice` | Show/hide the Voice recording button | true | false |
| `supportsDesktopHandoff` | Show/hide "Hand off to Mac" button | true | false |
| `supportsWorktree` | Enable/disable worktree operations in git panel | true | false |
| `supportsFork` | Enable/disable thread forking | true | true |
| `supportsApprovals` | Enable/disable approval UI on tool calls | true | true |
| `supportsStreamingTools` | Enable/render-beta tool call blocks in timeline | true | true |
| `supportsSlashCommands` | Enable/disable slash command autocomplete | true | true |
| `supportsMCP` | Show/grey MCP settings row | true | true |
| `supportsSkillAutocomplete` | Enable/disable `$skill` autocomplete in composer | true | true |
| `supportsSteer` | Enable/disable mid-turn steer | true | false |
| `supportsQueue` | Enable/disable iOS-local draft queue | true | true |

\*OpenCode per-model overrides: `resolveModelCapabilities()` sets `supportsReasoningEffort` / `supportsFastMode` to `true` when the SDK lists efforts or fast mode for that model.

### OpenCode runtime enablement

OpenCode is **enabled by default** when the bridge starts. Operators opt out for Codex-only regression:

| Env var | Effect |
|---------|--------|
| *(default)* | OpenCode runtime registered and advertised in `runtime/catalog` |
| `REMODEX_DISABLE_OPENCODE=1` (or `true`) | OpenCode omitted from `runtime/catalog` — Codex-only regression |
| `REMODEX_ENABLE_OPENCODE=0` (legacy) | Same as disable (backward compat) |

Policy implementation: `phodex-bridge/src/opencode-runtime-policy.js`. Tests: `phodex-bridge/test/opencode-runtime-policy.test.js`.

### Capability Cascade

Capabilities are resolved at three levels, narrower taking precedence:

```
1. Runtime defaults    →  e.g. OpenCode: supportsVoice: false
2. Agent overrides     →  e.g. plan agent: supportsReasoningEffort: false
3. Model overrides     →  e.g. claude-opus-4-7: supportsReasoningEffort: true
```

`runtime/catalog` returns the runtime-level and agent-level capabilities. `model/list` returns per-model capabilities (merged from runtime defaults + model overrides).

### Grey-Out Mechanics

Every UI row has exactly three states:

| State | Visual | When |
|-------|--------|------|
| **enabled** | Normal, interactive | Flag is `true` AND model supports it |
| **greyed** | Shown but disabled, shows reason string | Flag is `false` at runtime level, OR model doesn't support |
| **hidden** | Not rendered at all | Feature is runtime-specific (e.g. plan mode only for Codex) |

**Never:** silently absent, fake-enabled, or enabled-then-errors.

## Consequences

**The iOS composer acts as a capability renderer, not a feature decider.** It reads flags from the bridge and renders rows. If a flag changes, the UI updates. No iOS code contains a provider name check.

**The bridge owns capability truth.** `runtime/catalog` is the authoritative endpoint. Any capability change in the bridge (e.g. OpenCode gains voice support) automatically propagates to iOS without an app update.

**New runtimes self-document.** A new runtime's capability map tells the iOS composer exactly what to show. No coordination needed between bridge and iOS teams.

**The parity matrix is maintainable.** `docs/operations/release-compatibility.md` tracks a matrix of feature × runtime → enabled/greyed/partial/n/a. This is the user-facing view of the capability system.
