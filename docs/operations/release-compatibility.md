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
| OpenCode agent row | n/a | enabled | Per-thread override + `thread/start`/`turn/start` `agent` param |
| Provider display | n/a (flat models) | enabled | upstream provider name as subtitle |
| Model list | enabled | enabled | Merged in model/list |
| Reasoning/effort | enabled per model | enabled/greyed per model | Greyed if no effort levels |
| Fast mode | enabled per model | enabled/greyed per model | Greyed if unsupported |
| Codex Plan mode (+) | enabled | n/a | Hidden on OpenCode threads |
| Slash commands | enabled | enabled | `command/list` on OpenCode threads (PR3); device proof: [device-e2e-opencode.md](device-e2e-opencode.md) O8 |
| Skills /$ | enabled | enabled | Bridge merges `skills/list` with OpenCode `app.skills()`; device proof: O9 |
| MCP settings | enabled | enabled | MCP supported by OpenCode runtime |
| Git actions | enabled | enabled | Bridge-local, works on all threads |
| Workspace preview | enabled | enabled | Bridge-local, works on all threads |
| Streaming timeline | enabled | enabled | SDK event stream mapped to timeline |
| Tool call cards | enabled | enabled | Tool calls rendered from SDK events |
| Voice mode | enabled | n/a | Hidden on OpenCode |
| Desktop handoff | enabled | enabled | Catalog `supportsDesktopHandoff: true`; Mac bridge requires `REMODEX_OPENCODE_HANDOFF=1` for RPC; device proof: O12–O16 |
| Approvals/perms | enabled | enabled | SDK permission reply channel |
| Fork thread | enabled | enabled | `thread/fork` via OpenCode provider |
| Steer | enabled | greyed | No OpenCode SDK steer API |
| Queue (iOS-local) | enabled | enabled | Local draft queue; steer greyed when `supportsSteer` false |
| Pairing/E2EE | enabled | enabled | Unchanged from Codex |
| Thread history | enabled | enabled | SDK session.messages for OpenCode |
| Composer capability grey-out | enabled | enabled | `ComposerDisabledAppearance` + `ComposerCapabilityCopy` |
| Runtime unavailable banner | enabled | enabled | Catalog-driven disabled providers |
| Sidebar provider badge | enabled | enabled | `SidebarProviderBadge` on OpenCode threads |
| OpenCode beta label | n/a | enabled | `RuntimeInfo.showsBetaLabel` from catalog; `OpenCodeBetaCapsule` in Shared |
| Settings default OpenCode agent | n/a | enabled | Default for new chats; per-thread override on composer |

*Cells are `enabled` | `greyed` | `partial` | `simulator-only` | `n/a`. OpenCode `enabled` rows above assume [device-e2e-opencode.md](device-e2e-opencode.md) has passed on iPhone + Mac.*

## Device E2E checklist (iPhone + Mac)

Transport and pairing: [device-e2e-checklist.md](device-e2e-checklist.md).

**OpenCode parity sign-off:** [device-e2e-opencode.md](device-e2e-opencode.md) (slash, skills, handoff, rehydration).

Dev pairing (detached relay, survives shell exit): `repos/remodex-opencode/scripts/remodex-dev-pairing.sh <LAN-IP>`. Handshake smoke: `node phodex-bridge/scripts/test-relay-handshake.js ws://<LAN-IP>:9000/relay`.

Run before release. Bridge: `cd phodex-bridge && npm start` (OpenCode on by default). For handoff QA set `REMODEX_OPENCODE_HANDOFF=1`. Pair via QR in CodexMobile.

1. Model picker shows Codex and OpenCode groups with provider logos.
2. OpenCode thread: agent submenu changes agent; turn sends with selected agent; greyed voice/plan where capabilities false.
3. Send a turn on OpenCode; streaming text and tool cards render.
4. Stop button works mid-turn.
5. OpenCode thread: fork enabled; desktop handoff visible when Mac has `REMODEX_OPENCODE_HANDOFF=1`.
6. Disable OpenCode on Mac (`REMODEX_DISABLE_OPENCODE=1`); `runtime/catalog` is Codex-only (no OpenCode row) — model picker has no OpenCode group; no unavailable banner for a missing OpenCode catalog entry.
7. Bridge restart; OpenCode thread still routes correctly (thread ownership / rehydration).
8. Codex regression: `REMODEX_DISABLE_OPENCODE=1` on Mac — composer unchanged for Codex threads.
9. Settings: default OpenCode agent persists across relaunch.
10. Sidebar: provider badge and Beta capsule on OpenCode threads.
11. OpenCode slash (`command/list`) and skills (`$`) per [device-e2e-opencode.md](device-e2e-opencode.md) O8–O9.
12. OpenCode handoff per O12–O14 with `REMODEX_OPENCODE_HANDOFF=1`.

## Production: OpenCode handoff

| Variable | When | Effect |
|----------|------|--------|
| `REMODEX_OPENCODE_HANDOFF=1` (or `true`) | Operator Mac bridges that offer handoff | `desktop/continueOpenCode` runs; iOS shows handoff when catalog `supportsDesktopHandoff` is true |
| unset / `0` / `false` | Default safe rollout | RPC returns `opencode_handoff_disabled`; iOS may still show control if an old catalog is cached — prefer matching env with catalog promotion |

Catalog and `model/list` advertise `supportsDesktopHandoff: true` for OpenCode after PR8. **Always** set `REMODEX_OPENCODE_HANDOFF=1` on production Mac bridges where handoff should work.