# ADR-002: Capability Model

**Date:** 2026-05-30  
**Status:** Accepted (updated 2026-06-02 — 15 flags + optional 16th)

## Context

Different coding runtimes support different features. Codex supports voice, plan mode, desktop handoff, worktree forking — OpenCode supports agent selection but not voice or plan mode. The iOS composer shows rows for model selection, agent selection, reasoning effort, and fast mode. Some rows should be hidden on OpenCode threads. Others should show as available but greyed out with an explanation.

The iOS app must not make runtime-specific decisions for **visibility** ("if provider is OpenCode, hide plan mode"). It must be driven by capability flags from the bridge. **Orchestration** (which RPC or command list to call) may use `modelProvider` — see `docs/design/master-opencode-integration.md`.

## Decision

Use **15 capability flags** (plus optional **16th** `supportsStructuredSkillInput`) as the source of truth for what the iOS composer shows, hides, or greys out.

Authoritative list: `repos/remodex-opencode/phodex-bridge/src/provider-capabilities.js`.

### The 15 Flags

| Flag | What it controls |
|------|-----------------|
| `supportsAgentSelection` | OpenCode agent submenu (build/plan/custom) |
| `supportsReasoningEffort` | Intelligence / reasoning picker |
| `supportsFastMode` | Fast mode toggle |
| `supportsPlanMode` | Codex Plan mode (+) toggle |
| `supportsVoice` | Voice recording |
| `supportsDesktopHandoff` | "Hand off to Desktop" menu row |
| `supportsWorktree` | Worktree operations in git panel |
| `supportsFork` | Thread forking |
| `supportsApprovals` | Tool approval UI |
| `supportsStreamingTools` | Tool call cards in timeline |
| `supportsSlashCommands` | Slash command autocomplete |
| `supportsMCP` | MCP settings row |
| `supportsSkillAutocomplete` | `$` skill autocomplete |
| `supportsSteer` | Steer on queued drafts |
| `supportsQueue` | Local draft queue |

### 16th flag (structured skills)

| Flag | Codex default | OpenCode default |
|------|---------------|------------------|
| `supportsStructuredSkillInput` | `true` | `false` |

Do not overload `supportsSkillAutocomplete` — autocomplete ≠ structured turn payload.

### Capability cascade

```
1. Runtime defaults    →  OPENCODE_CAPABILITIES / CODEX_CAPABILITIES
2. Agent overrides     →  runtime/catalog agents (future)
3. Model overrides     →  model/list per-model fields
```

### Grey-out vs hidden

| State | When |
|-------|------|
| **enabled** | Flag true and model/runtime supports feature |
| **greyed** | Flag false at runtime, or unsupported — show disabled row + reason (e.g. OpenCode handoff: `TurnToolbarContent.swift`) |
| **hidden** | Feature is n/a for runtime (e.g. plan mode on OpenCode) |

Never fake-enabled controls.

## Consequences

- iOS composer is a capability renderer, not a feature decider for visibility.
- Bridge owns capability truth via `runtime/catalog` and `model/list`.
- Parity matrix v2 in `docs/operations/release-compatibility.md` tracks user-facing status.