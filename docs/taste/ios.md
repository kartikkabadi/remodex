# iOS Code Conventions

How SwiftUI code is written in `CodexMobile/`. These conventions are derived from the existing codebase and enforced for all new code.

## Platform

- **Swift 6**, iOS 18.6 target
- **SwiftUI** with minimal UIKit (only where SwiftUI doesn't provide the primitive — e.g., `UIKitContextMenu`, `UITextView` bridge)
- No SPM dependencies beyond what's already in the project
- No CocoaPods or Carthage

## File Header Convention

Every Swift file begins with:
```swift
// FILE: Filename.swift
// Purpose: One-sentence description.
// Layer: View | Model | Service | Coordinator
// Exports: Class/Struct/Enum name
// Depends on: comma-separated imported types
```

**Why:** Matches the bridge file header convention. Cross-project consistency.

## Architecture

### Single Data Controller

`CodexService` is the canonical data controller. It owns:
- WebSocket transport to the bridge
- JSON-RPC request/response handling
- Model, thread, turn, and status state
- Capability catalog

The service is split across Swift extensions for readability (`CodexService+Transport.swift`, `CodexService+ThreadsTurns.swift`, etc.), but it is one actor.

### Observable State

`AppModel` is the `@Observable` class that wraps `CodexService` state for SwiftUI:
```swift
@Observable
final class AppModel {
    var threads: [CodexThread] = []
    var connectionStatus: CodexConnectionStatus = .disconnected
    var runtimeCatalog: RuntimeCatalog?
    // ...
}
```

**Why:** `@Observable` is the iOS 17+ pattern for reactive state. Views observe `AppModel` and re-render on changes. No `@StateObject`, no `@EnvironmentObject`, no Combine publishers.

### Views Stay Thin

Views should NOT:
- Parse JSON-RPC payloads
- Contain business logic
- Manage their own network connections
- Have `@State` that duplicates `AppModel` state

Views SHOULD:
- Read from `AppModel` via `@Environment(AppModel.self)`
- Call methods on `CodexService` via `AppModel`
- Handle their own presentation state (scroll position, text field focus)

## Naming

| Category | Convention | Example |
|----------|-----------|---------|
| Types | `UpperCamelCase` | `CodexThread`, `TurnComposerRuntimeState` |
| Properties/functions | `lowerCamelCase` | `selectedModel`, `fetchRuntimeCatalog()` |
| Files | `UpperCamelCase` | `CodexService+Transport.swift` |
| Extensions | `Type+Feature.swift` | `CodexService+ThreadsTurns.swift` |

**Why:** Standard Swift conventions. Extensions in separate files keep the main type focused. The `+Feature` naming convention makes it easy to find related code.

## Composer Architecture

The composer has these layers:

| Layer | File | Responsibility |
|-------|------|----------------|
| State | `TurnComposerRuntimeState.swift` | What's selected, what's available, capability flags |
| View State | `TurnComposerViewState.swift` | Text input, attachment pipeline, draft state |
| Host | `TurnComposerHostView.swift` | Layout, toolbar, send button |
| Menu | `TurnComposerRuntimeUIKitMenu.swift` | UIKit context menu for model/agent/effort pickers |
| Actions | `TurnComposerRuntimeActions.swift` | Action handlers (commit, revert, push, fork) |
| Meta | `TurnComposerMetaMapper.swift` | Maps composer state to JSON-RPC params |

**Why:** Each layer has one reason to change. State changes when the capability model changes. View state changes when the UI layout changes. Actions change when new bridge features are added. Mapper changes when the RPC format changes.

## Timeline Architecture

The turn timeline (`TurnTimelineView`) uses these patterns:

- **Reducer pattern:** `TurnTimelineReducer.swift` merges incoming items (streaming deltas, tool calls, completions) into the timeline
- **Item identity:** Items are keyed by `itemId`. Late-arriving deltas merge into existing rows.
- **Scroll state:** `TurnScrollStateTracker.swift` manages auto-scroll behavior separately from rendering
- **Cache:** `TurnMessageCacheCore.swift` caches rendered text blocks to avoid recomputation during streaming

**Guardrails (from existing iOS rules):**
- `turn/started` may not include a usable `turnId` — keep the per-thread running fallback
- Merge late reasoning deltas into existing rows — do not spawn fake extra "Thinking..." rows
- Ignore late turn-less activity events when the turn is already inactive
- Preserve item-aware history reconciliation instead of falling back to `turnId`-only matching

## Design System (Liquid Glass)

- **Background:** `Color.black` for main surfaces
- **Accent:** Green-tinted highlight (`#00FF9C` style)
- **Typography:** System fonts, `SFMono-Regular` for code
- **Glass effect:** `AdaptiveGlassModifier` applies translucent blur
- **Buttons:** `PrimaryCapsuleButton` for primary actions, `HapticButton` wraps with haptic feedback
- **Pills:** `ComposerPillLabel` for the model/agent/effort picker pills

**Why:** Consistent visual language across all screens. New features must match existing quality — never feel "bolted on."

## Error Display

Errors from the bridge arrive as JSON-RPC error responses. iOS handles them:

1. **Parse:** Extract `error.message` (user-facing) and `error.data.errorCode` (machine-readable)
2. **Categorize:** Map `errorCode` to display action:
   - `opencode_not_installed` → Show install instructions card
   - `thread_not_found` → Show "Thread not found" alert
   - Generic → `TurnErrorReportCard` with message and "Copy diagnostic" button
3. **Never show:** Raw stack traces, SDK error names, internal bridge paths

## Testing

- XCTest under `CodexMobileTests/`
- File naming: `FeatureNameTests.swift`
- Snapshot tests for composer picker states
- Not run unless explicitly requested (Xcode tests are slow)

**Why:** Guardrail from AGENTS.md: "Do not run Xcode tests unless the user explicitly asks."
