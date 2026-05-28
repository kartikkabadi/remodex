# WORKTREE_HANDOFF — wt-ios-runtime (WT-4)

| Field | Value |
|-------|-------|
| Branch | `opencode/wt-ios-runtime` |
| Base | `opencode/integration` @ `00181bfe` |
| Scope | WT-4 iOS AgentRuntime contract only |

## Deliverables

| Item | Path |
|------|------|
| `AgentRuntime` enum + `normalize` | `CodexMobile/CodexMobile/Models/AgentRuntime.swift` |
| Thread decode trusts `agent_runtime` only | `CodexThread.swift` (removed `modelProvider` heuristic) |
| Bridge capabilities typed runtime | `CodexBridgeRuntimeCapabilities.swift`, `CodexService+Connection.swift` |
| Composer connection rename + variant gate | `TurnComposerRuntimeState.swift`, `TurnComposerRuntimeUIKitMenu.swift` |
| Service rename | `CodexService.isOpenCodeBridgeConnected` (was `isOpenCodeRuntimeConnected`) |

## Tests run

```bash
cd CodexMobile && xcodebuild test -scheme CodexMobile \
  -only-testing:CodexMobileTests/CodexThreadRuntimeOverrideTests \
  -only-testing:CodexMobileTests/TurnComposerReviewModeTests \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

Result: **TEST SUCCEEDED** (48 tests, 0 failures).

## Integrator

Rebase onto latest `opencode/integration`, merge, then Phase 2 gate (npm relay, OPENCODE_E2E if available, filtered xcodebuild, `opencode-sim-preflight.sh --check-only`).
