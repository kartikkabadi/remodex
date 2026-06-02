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

## Phase 1 (in progress)

| Slice | Status |
|-------|--------|
| PR1 `bridge-rpc.md` + catalog snapshot test | Done — OpenCode example matches `OPENCODE_CAPABILITIES` |
| PR3 slash `command/list` | Already wired (`CodexService+SlashCommands`, `TurnViewModel.loadBridgeSlashCommandsIfNeeded`) |
| PR4 structured skills | Done — 16th flag on `ProviderCapabilities`; OpenCode turns gated via `supportsStructuredSkillInput(forThreadId:)` |
| PR5–6 handoff iOS | Pending device E2E — bridge RPC exists; catalog still `supportsDesktopHandoff: false` until PR8 |
