# WORKTREE_HANDOFF — opencode/wt-ios-fixes (WT-3)

| Field | Value |
|-------|--------|
| Branch | `opencode/wt-ios-fixes` |
| Base | `opencode/integration` (post WT-2) |
| Scope | WT-3 Swift-only P1/P2 fixes |

## Changes

| Fix | File |
|-----|------|
| `CodexThreadRuntimeOverride` custom `Decodable` + legacy migration | `CodexService.swift` |
| Stale variant prune | `CodexService+RuntimeConfig.swift` |
| Skill autocomplete miss markers | `TurnViewModel.swift` |
| Timeline collapse phases | `TurnTimelineRenderProjection.swift` |
| Keep-awake footer disconnected hint | `SettingsConnectionCard.swift` |
| Queued drafts Dynamic Type | `QueuedDraftsPanel.swift`, `TurnComposerView.swift` |
| Connection recovery dismiss hit target | `ConnectionRecoveryCard.swift` |

No bridge / relay files touched.

## Integrator

Merge **before** WT-4. Parent integrator rebases + runs gate. Do not merge from this worktree.
