# iOS Test Triage — 2026-06-08 (WP-13)

## New P0 XCTest coverage (written, not full-suite gating)

| WP | File | Count |
|----|------|-------|
| WP-01 | `ReconnectRunningStateTests.swift` | 6 |
| WP-02 | `OpenCodePermissionQueueTests.swift` | 4 |
| WP-02 | `OpenCodePermissionSheetTests.swift` | 6 |
| WP-04 | `OpenCodeSSECatchupTests.swift` | 3 |
| WP-06 | `TurnComposerAttachmentCapabilityTests.swift` | 3 |
| WP-08 | `OpenCodeAllModelsSheetTests.swift` | 5 |
| WP-03 | `CodexTurnInputPayloadSkillTests.swift` (+1 multi-skill) | 2 new cases |

## Known stale debt (not gating device G4)

- ~147 failures on clean `main` in queue/steer-related tests — documented in `device-e2e-opencode.md`.
- Simulator **build** required; full `xcodebuild test` not gating per D13.

## Operator note

Run targeted new tests via Xcode test navigator or:

```bash
cd repos/remodex-opencode/CodexMobile
xcodebuild -scheme CodexMobile -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:CodexMobileTests/ReconnectRunningStateTests \
  -only-testing:CodexMobileTests/OpenCodePermissionQueueTests \
  CODE_SIGNING_ALLOWED=NO test
```