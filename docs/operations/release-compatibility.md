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
| Composer capability grey-out | enabled | enabled | iOS 2026-05-30: shared `ComposerDisabledAppearance` + mapper copy; simulator build verified |
| Runtime unavailable banner | enabled | enabled | iOS 2026-05-30: glass banner + bridge reason mapping; simulator build verified |
| Sidebar provider badge | enabled | enabled | iOS 2026-05-30: `SidebarProviderBadge` on thread rows; simulator build verified |
| OpenCode beta label | n/a | enabled | iOS 2026-05-30: sidebar + composer pill; device taste review pending |
| Settings default OpenCode agent | n/a | enabled | iOS 2026-05-30: `SettingsRuntimeDefaultsCard` picker + UserDefaults; device proof pending |

*Cells are `enabled` | `greyed` (+ reason) | `n/a`. Only mark `enabled` with device proof.*

## Device E2E checklist (iPhone + Mac)

Run before parity sign-off. Bridge: `cd phodex-bridge && REMODEX_ENABLE_OPENCODE=1 npm start`. Pair via QR in CodexMobile.

1. Model picker shows Codex and OpenCode groups with provider logos.
2. OpenCode thread: agent submenu, greyed voice/plan/fast where capabilities false.
3. Send a turn on OpenCode; streaming text and tool cards render.
4. Stop button works mid-turn.
5. Fork and desktop handoff hidden on OpenCode threads.
6. Disable OpenCode on Mac; composer shows unavailable banner with mapped copy.
7. Bridge restart; OpenCode thread still routes correctly (thread ownership).
8. Codex regression: bridge without `REMODEX_ENABLE_OPENCODE` — composer unchanged.
9. Settings: default OpenCode agent persists across relaunch.
10. Sidebar: provider badge and Beta capsule on OpenCode threads.
