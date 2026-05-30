# Release Compatibility

## Version Matrix

| Component | Min Version | Current | Notes |
|-----------|-------------|---------|-------|
| Bridge (npm) | 1.5.6 | 1.5.6 | `remodex` npm package |
| iOS App | 1.5 | Latest | Enforced by `ios-app-compatibility.js` |
| OpenCode CLI | 2.0.0 | 1.15.12 | Must support `opencode serve` and `@opencode-ai/sdk/v2` |
| Node.js | 18+ | — | Bridge requires Node 18 for `node:test` and `fetch` |
| macOS | 14+ | — | Required for AppleScript and launchd |

## Upgrade Paths

**Bridge update:** `npm install -g remodex@latest` or in-app update (macOS only). Bridge restarts after update.

**OpenCode update:** User-managed. Bridge probes version on startup. If version is too old, OpenCode runtime shows unavailable with `minVersion` in error.

**iOS update:** App Store. Bridge rejects connections from iOS versions below minimum (`ios_app_update_required` error).

## Breaking Change Policy

- Bridge: additive RPC fields only. New required fields trigger `ios_app_update_required`.
- iOS: backwards-compatible with older bridge (missing fields default to Codex behavior).
- OpenCode: min version bump if new SDK methods are required.

## Parity Matrix

| Feature | Codex | OpenCode | Notes |
|---------|-------|----------|-------|
| Agent/picker | enabled | enabled | Unified model picker groups by provider |
| OpenCode agent row | n/a | enabled | build, plan, custom from catalog |
| Provider display | n/a (flat models) | enabled | upstream provider name as subtitle |
| Model list | enabled | enabled | Merged in model/list |
| Reasoning/effort | enabled per model | enabled/greyed per model | Greyed if no effort levels |
| Fast mode | enabled per model | enabled/greyed per model | Greyed if unsupported |
| Codex Plan mode (+) | enabled | n/a | Hidden on OpenCode threads |
| Slash commands | enabled | enabled | Slash commands supported by OpenCode runtime |
| Skills /$ | enabled | greyed | "OpenCode uses its own skill system" |
| MCP settings | enabled | enabled | MCP supported by OpenCode runtime |
| Git actions | enabled | enabled | Bridge-local, works on all threads |
| Workspace preview | enabled | enabled | Bridge-local, works on all threads |
| Streaming timeline | enabled | enabled | SDK event stream mapped to timeline |
| Tool call cards | enabled | enabled | Tool calls rendered from SDK events |
| Voice mode | enabled | n/a | Hidden on OpenCode |
| Desktop handoff | enabled | n/a | Hidden on OpenCode |
| Approvals/perms | enabled | enabled | SDK permission reply channel |
| Fork thread | enabled | enabled | Capability flag set; session.fork mapping pending |
| Steer/queue | enabled | greyed | Not yet implemented for OpenCode |
| Pairing/E2EE | enabled | enabled | Unchanged from Codex |
| Thread history | enabled | enabled | SDK session.messages for OpenCode |

*Cells are `enabled` | `greyed` (+ reason) | `n/a`. Only mark `enabled` with device proof.*
