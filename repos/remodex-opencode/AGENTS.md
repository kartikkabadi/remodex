# AGENTS.md (Local-First)

Keep this file and `CLAUDE.md` aligned.

This repo is local-first now. Do not reintroduce hosted-service assumptions, remote deployment runbooks, or hardcoded production domains.

## Core guardrails

- Prefer local Mac runtime, local bridge, QR pairing, and daemon workflows.
- Be an intraprendente agent: proactively inspect local code, protocol/schema, and official sources to confirm facts before replying; do not repeatedly stop to ask for confirmation when the next verification step is safe and obvious.
- Keep repo isolation by thread/project metadata and local `cwd`.
- Do not reintroduce filtering by selected repo in sidebar/content.
- Keep cross-repo open/create flow with automatic local context switch.
- Preserve single responsibility: shared logic belongs in services/coordinators, not duplicated in views.
- Treat this repo as open source: avoid junk code, placeholder hacks, noisy one-off workarounds, and low-signal docs.
- If you touch docs, keep them local-only and remove stale hosted-service notes instead of adding compatibility layers.
- Do not create one-off report markdown files in the repo root (security reports, audit notes, scratch summaries, etc.) unless the user explicitly asks for a file. Keep ad-hoc analysis in the chat.
- For open-source/self-hosted safety, do not log live relay `sessionId` values or other bearer-like pairing identifiers in server logs; redact or hash them instead.
- Keep user-facing answers compact by default unless the user explicitly asks for more detail.

## iOS runtime + timeline guardrails

- `turn/started` may not include a usable `turnId`: keep the per-thread running fallback.
- If Stop is tapped and `activeTurnIdByThread` is missing, resolve via `thread/read` before interrupting.
- On reconnect/background recover, rehydrate active turn state so Stop remains visible.
- Suppress benign background disconnect noise (`NWError.posix(.ECONNABORTED)`) and retry on foreground.
- Keep assistant rows item-scoped to avoid timeline flattening/reordering.
- Merge late reasoning deltas into existing rows; do not spawn fake extra "Thinking..." rows.
- Ignore late turn-less activity events when the turn is already inactive.
- Preserve item-aware history reconciliation instead of falling back to `turnId`-only matching.

## Local connection guardrails

- Prefer saved relay pairing and local connection state as the source of truth.
- Avoid hardcoded remote domains; default to local values or explicit user config.
- Keep pairing/auth UX stable: do not clear saved relay info too early during reconnect flows.
- Preserve reconnect behavior across relaunch when the local host session is still valid.
- Preserve the QR/local-relay pairing path: do not regress the scanner -> saved pairing -> connect flow by letting onboarding/auto-reconnect race manual scan control.
- For local relay recovery, keep resumed desktop-thread live mirroring and rollout fallback logic intact so reopened/running threads still recover state even when the rollout file is older than the recent-candidate window.

## Build guardrails

- Do not run Xcode tests unless the user explicitly asks. Do not decide to run them on your own.
- Markdown files inside Xcode-synced groups can still produce harmless warnings.
- For small iOS/mobile fixes, prefer inspection and targeted edits over simulator runs by default.

## Local quick runbook

```bash
cd phodex-bridge
npm ci
npm test              # default: REMODEX_DISABLE_OPENCODE=1 via test/test-env.js (~40s)
npm run test:opencode # OpenCode suites (live provider mocks; no opencode serve in default test)
npm run test:coverage # same as npm test with Node coverage report
npm start
```

Bridge tests use `node -r ./test/test-env.js --test --test-force-exit` only. Do not run per-file profiler loops.

## iOS OpenCode (PR0b)

- `ProviderCapabilities.swift`, `RuntimeInfo.swift`, `CodexModelOption` provider fields, `CodexService+SlashCommands`, `CodexService+OpenCodeAgentConfig`, `CodexService+DesktopHandoff` must be present.
- Xcode target uses `PBXFileSystemSynchronizedRootGroup` — new Swift files under `CodexMobile/` are picked up automatically.
- Build (simulator, no signing): `cd CodexMobile && xcodebuild -scheme CodexMobile -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO build`

## Known commit scope

- **`2fd364a`** bundles PR0b iOS compile fixes with a large `phodex-bridge` OpenCode stack sync (router, provider, handoff modules). Treat that bridge delta as intentional baseline — do not revert wholesale when doing Phase 1 follow-ups; use targeted tests and capability flags instead.

## Phase 1 (done — PR8 catalog flip blocked on device E2E)

| Slice | Status |
|-------|--------|
| PR1 `bridge-rpc.md` + catalog snapshot test | Done — OpenCode example matches `OPENCODE_CAPABILITIES` |
| PR3 slash `command/list` | Done — bridge router + iOS `CodexService+SlashCommands`; Codex threads use enum only |
| PR4 structured skills | Done — `supportsStructuredSkillInput: false` for OpenCode; iOS gated via `supportsStructuredSkillInput(forThreadId:)` |
| PR5 handoff regression | Done — `opencode-handoff.test.js` + `desktop-handler.test.js` negatives; `005-error-taxonomy.md` aligned |
| PR6 handoff iOS routing | Done — `DesktopHandoffService` / `TurnViewModel+DesktopHandoff` / toolbar capability gate |
| PR8 `supportsDesktopHandoff` | **Blocked** — catalog stays `false`; flip after device E2E checklist 8c |

## Phase 2 (done — base `38ad72b`)

| PR | Status | Notes |
|----|--------|-------|
| PR9 push | Done | `push-notification-opencode.test.js`; observability push path |
| PR10 SSE | Done | `session.next.*` in `opencode-client.js`; idle dedupe in provider |
| PR11 multimodal | Done | file URL parts; composer attach grey-out; `opencode-sdk.md` |
| PR12 MCP | Done | Settings + `ComposerCapabilityCopy` honesty |
| PR13 auth | Done | `authConfigured` probe; catalog `opencode` block; Settings summary |
| PR17 access | Done | Access bar hidden on OpenCode; no sandbox on `turn/start` |
| PR15 bridge-status | Done | `publishBridgeStatus` + menu bar OpenCode row |
| PR16 version skew | Done | TurnView banner; `opencode_version_below_minimum` |
| PR14 launchd | Done | `docs/operations/launchd-opencode-env.md` |
| PR18 git writer | Done | Codex-only git writer picker models |
| PR19a plugins | Done | `opencode-sdk.md` spike; no `plugin/list` |
| PR19 plugin UI | Done | `@plugin` autocomplete gated for OpenCode |
| PR20 slash | Done | `openCodeExcludedTokens`; `availableCommandsForProvider` test |

**Device E2E prep:** Branch `wip/local-2026-06-03` holds local WIP (widgets, relay, iOS test edits, assets). **`main` must stay clean** at integration commits for Kartik device sign-off — see `docs/operations/device-e2e-opencode.md` pre-flight.
