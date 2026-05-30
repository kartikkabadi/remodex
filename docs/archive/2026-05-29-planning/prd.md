# PRD — Remodex multi-agent runtimes (OpenCode v1)

Draft only. Not published to GitHub.

## Problem statement

Remodex users are locked to Codex on the Mac. They want to start and continue agent threads from iPhone against **OpenCode** (and eventually other harnesses) using the same pairing, encryption, and thread UX they already trust.

## Solution

Introduce a **runtime provider router** in `phodex-bridge` that keeps the existing Codex JSON-RPC contract toward iOS. Add an **OpenCode harness** that adapts local OpenCode CLI output into that contract. Persist **project folders** and **thread ownership** so list/resume routes correctly. Add iOS UI to pick default runtime and show per-thread provider.

v1 uses **CLI `opencode run`** (proven on branch `codex/add-opencode-provider`). v2 may move to **ACP stdio**.

## Users

- Remodex iPhone user with OpenCode installed on paired Mac
- Self-hosters running private relay
- Maintainer (Emanuele) reviewing small incremental PRs

## User stories

1. As a user, I see Codex and OpenCode models in the model list when OpenCode is installed.
2. As a user, I start a new chat choosing OpenCode and a model slug without breaking Codex chats.
3. As a user, I resume an OpenCode thread after bridge restart and still see history.
4. As a user, my project folders from both runtimes appear in the sidebar project section.
5. As a user, I cannot accidentally switch a strict OpenCode thread to Codex mid-conversation.
6. As a user, pairing and encryption behave exactly as before for Codex-only usage.
7. As a maintainer, I can disable OpenCode with an env flag without removing router code.
8. As a maintainer, I receive PRs under ~500 lines each with tests.
9. As a user, when OpenCode is missing, I get a clear error instead of a silent empty list.
10. As a user, turn failures surface as failed turns with a message, not a dropped connection.
11. As a user, archived OpenCode threads stay hidden unless I show archived.
12. As a user, interrupting a turn stops the OpenCode child process.
13. As a developer, I can run bridge tests without OpenCode installed (mocked spawn).
14. As a user, Codex desktop mirror features do not run for OpenCode threads.
15. As a maintainer, relay pairing tests remain in CI.

## Implementation decisions

- **Router placement:** After domain handlers, before `codex.send` (matches branch).
- **Provider ID field:** `modelProvider` primary; accept snake_case aliases.
- **OpenCode v1 transport:** subprocess `opencode run --format json`, not HTTP.
- **Feature flag:** `REMODEX_ENABLE_OPENCODE=1` required until stable.
- **Persistence:** `known-projects.json` (branch) + new `thread-ownership.json` (planned).
- **iOS default:** Codex remains default runtime.
- **Strict threads:** `opencode` in strict set (branch behavior).

## Testing decisions

- Behavior tests through public bridge handlers and JSON-RPC fixtures, not private class methods.
- Mock `child_process.spawn` for OpenCode tests.
- No dependency on live relay in unit tests.
- Manual QA checklist for real OpenCode binary before claiming beta-ready.

## Out of scope

- Additional providers (Cursor, Claude Code, Pi)
- Rewriting iOS in Rust
- Replacing relay
- OpenCode HTTP server mode in v1
- Android-specific runtime UI (unless shared)

## Further notes

- Upstream contribution policy favors **issue-first, tiny PRs**. Kartik should not land the existing 197-file branch as one PR.
- dpcode is a **reference** for contracts and HTTP adapter patterns, not a copy source for the Node bridge.
- litter informs long-term mobile architecture only.

## Assumptions

| Item | Status |
|------|--------|
| Maintainer open to OpenCode | Needs user |
| OpenCode CLI stable enough for `run --format json` | Assumed |
| iOS App Store build cadence separate from bridge | Confirmed |
