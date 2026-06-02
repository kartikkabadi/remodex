# Release Compatibility

## Version Matrix

| Component | Min Version | Current | Notes |
|-----------|-------------|---------|-------|
| Bridge (npm) | 2.0.0 | 2.0.0 | `remodex` npm package |
| iOS App | 1.5 | 2.0 | Enforced by `ios-app-compatibility.js` |
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
| OpenCode agent row | n/a | partial | Per-thread override + `thread/start`/`turn/start` `agent` param; device E2E required |
| Provider display | n/a (flat models) | enabled | upstream provider name as subtitle |
| Model list | enabled | enabled | Merged in model/list |
| Reasoning/effort | enabled per model | enabled/greyed per model | Greyed if no effort levels |
| Fast mode | enabled per model | enabled/greyed per model | Greyed if unsupported |
| Codex Plan mode (+) | enabled | n/a | Hidden on OpenCode threads |
| Slash commands | enabled | partial | Bridge `command/list` works; iOS still Codex-hardcoded enum until PR3 |
| Skills /$ | enabled | partial | Bridge merges `skills/list` with OpenCode `app.skills()` when SDK returns data; device E2E required |
| MCP settings | enabled | enabled | MCP supported by OpenCode runtime |
| Git actions | enabled | enabled | Bridge-local, works on all threads |
| Workspace preview | enabled | enabled | Bridge-local, works on all threads |
| Streaming timeline | enabled | enabled | SDK event stream mapped to timeline |
| Tool call cards | enabled | enabled | Tool calls rendered from SDK events |
| Voice mode | enabled | n/a | Hidden on OpenCode |
| Desktop handoff | enabled | n/a | Hidden on OpenCode |
| Approvals/perms | enabled | enabled | SDK permission reply channel |
| Fork thread | enabled | enabled | `thread/fork` via OpenCode provider |
| Steer | enabled | greyed | No OpenCode SDK steer API |
| Queue (iOS-local) | enabled | enabled | Local draft queue; steer greyed when `supportsSteer` false |
| Pairing/E2EE | enabled | enabled | Unchanged from Codex |
| Thread history | enabled | enabled | SDK session.messages for OpenCode |
| Composer capability grey-out | enabled | simulator-only | `ComposerDisabledAppearance` + `ComposerCapabilityCopy`; simulator build verified |
| Runtime unavailable banner | enabled | simulator-only | Catalog-driven disabled providers; device proof pending |
| Sidebar provider badge | enabled | simulator-only | `SidebarProviderBadge`; device proof pending |
| OpenCode beta label | n/a | simulator-only | `RuntimeInfo.showsBetaLabel` from catalog; `OpenCodeBetaCapsule` in Shared |
| Settings default OpenCode agent | n/a | simulator-only | Default for new chats only; per-thread override on composer |

*Cells are `enabled` | `greyed` | `partial` | `simulator-only` | `n/a`. Only mark `enabled` after the device E2E checklist below passes.*

## Device E2E checklist (iPhone + Mac)

Full step-by-step (relay health, Forget, catalog): [device-e2e-checklist.md](device-e2e-checklist.md).

Dev pairing (detached relay, survives shell exit): `repos/remodex-opencode/scripts/remodex-dev-pairing.sh <LAN-IP>`. Handshake smoke: `node phodex-bridge/scripts/test-relay-handshake.js ws://<LAN-IP>:9000/relay`.

Run before parity sign-off. Bridge: `cd phodex-bridge && npm start` (OpenCode is on by default; set `REMODEX_DISABLE_OPENCODE=1` for Codex-only regression). Pair via QR in CodexMobile.

1. Model picker shows Codex and OpenCode groups with provider logos.
2. OpenCode thread: agent submenu changes agent; turn sends with selected agent; greyed voice/plan where capabilities false.
3. Send a turn on OpenCode; streaming text and tool cards render.
4. Stop button works mid-turn.
5. Fork and desktop handoff hidden on OpenCode threads.
6. Disable OpenCode on Mac; composer shows unavailable banner with mapped copy.
7. Bridge restart; OpenCode thread still routes correctly (thread ownership).
8. Codex regression: `REMODEX_DISABLE_OPENCODE=1` on Mac — composer unchanged for Codex threads.
9. Settings: default OpenCode agent persists across relaunch.
10. Sidebar: provider badge and Beta capsule on OpenCode threads.
