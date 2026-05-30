# Remodex multi-agent research

Verified 2026-05-29 against clones under `repos/` in workspace `$REMODEX_WORKSPACE`.

## Repositories studied

| Repo | Remote | Clone path | Notes |
|------|--------|------------|-------|
| Remodex | `github.com/Emanuele-web04/remodex` | `repos/remodex` | Shallow clone + `git fetch` all remote heads |
| OpenCode | `github.com/anomalyco/opencode` | `repos/opencode` | Shallow clone |
| dpcode | `github.com/Emanuele-web04/dpcode` | `repos/dpcode` | Shallow clone |
| litter | `github.com/dnakov/litter` | `repos/litter` | Shallow clone |

## Remodex branch inventory

| Branch | vs `main` (stat) | Role |
|--------|------------------|------|
| `main` | baseline | Codex-only product; bridge + iOS + relay |
| `origin/codex/add-opencode-provider` | 197 files, +6398 / −14125 lines | OpenCode provider, runtime router, project registry, iOS runtime UI |
| `origin/dpcode/add-opencode-provider` | 333 files, +6141 / −38559 lines | Separate large branch on same remote (not same diff as codex branch) |
| `origin/codex/add-cursor-provider` | not fully diffed | Cursor provider experiment |
| `origin/dpcode/study-providers-ssh-terminal` | not fully diffed | Provider study work |
| Other `codex/*`, `dpcode/*` | various | Pairing, SSH terminal, mirroring, voice, iPad, etc. |

Head of `codex/add-opencode-provider`: `20b01b4` — "Add OpenCode provider support and thread routing".

### What the OpenCode branch actually adds (new paths only)

13 added paths total. Core bridge additions:

- `phodex-bridge/src/runtime-provider-router.js`
- `phodex-bridge/src/opencode-provider.js`
- `phodex-bridge/src/opencode-models.js`
- `phodex-bridge/src/project-registry.js`
- Matching tests under `phodex-bridge/test/`

iOS additions:

- `RuntimeProviderLogo.swift`, provider logo assets
- Runtime/composer UI touches (`CodexService+RuntimeConfig.swift`, composer runtime menus, settings card, project section header)

The branch also **modifies** ~184 existing files. It is not a small additive patch.

## Remodex architecture (main)

### Components

```
iOS (CodexMobile)  --encrypted WS-->  relay  --encrypted WS-->  phodex-bridge (Mac)
                                                              |
                                                              +-- stdin/stdout JSON-RPC --> codex app-server
                                                              +-- optional WS to existing codex endpoint
                                                              +-- git/workspace/desktop/voice handlers
                                                              +-- Codex.app refresh via AppleScript (optional)
```

### phodex-bridge

- Entry: `phodex-bridge/bin/remodex.js` → `phodex-bridge/src/bridge.js` (`startBridge`).
- **Codex transport** (`codex-transport.js`): spawns `codex app-server` (or connects to `CODEX_ENDPOINT` WebSocket). Newline-delimited JSON-RPC on stdio.
- **Relay client**: WebSocket to `{relayUrl}/{sessionId}` with role `mac`. Pairing via QR (`qr.js`, `secure-device-state.js`).
- **Secure transport** (`secure-transport.js`): X25519-style pairing handshake, encrypted envelopes after trust. Mobile must use compatible app version (`ios-app-compatibility.js`).
- **Application routing** (`bridge.js` `handleApplicationMessage`): decrypt → handlers (git, workspace, desktop, voice, thread context, projects on branch) → forward Codex-shaped JSON-RPC to `codex.send()`.
- **Side channels**: rollout JSONL mirror, desktop IPC follower, push notifications, macOS launchd service (`macos-launch-agent.js`).

### relay

- `relay/server.js` + `relay/relay.js`: dumb encrypted forwarder. One Mac + one mobile per session. Trusted reconnect and short pairing codes. Not an agent runtime.

### CodexMobile (iOS)

- SwiftUI app. `CodexService` speaks JSON-RPC to bridge over secure relay.
- Thread model: `CodexThread` with `modelProvider` already on main (used for Codex models).
- Heavy test surface under `CodexMobile/CodexMobileTests/`.

## OpenCode branch behavior (verified)

### runtime-provider-router

Intercepts **application** JSON-RPC before Codex when:

- `model/list` — merges Codex models with provider models
- `thread/list` — merges Codex threads with provider threads
- Routable thread methods: `thread/start`, `thread/resume`, `thread/read`, `thread/turns/list`, `thread/name/set`, `thread/archive`, `thread/unarchive`, `turn/start`, `turn/interrupt`

Provider selection reads `modelProvider`, `provider`, `runtimeProvider`, `harness`, and collaboration mode settings.

`stripRuntimeProviderFieldsForCodex()` removes provider-only fields before forwarding to Codex.

### opencode-provider

- **Not ACP**. Uses CLI subprocesses:
  - `opencode models` — model list (cached 60s)
  - `opencode session list --format json`
  - `opencode run --format json --model … --dir … [--session …] <prompt>` — turn execution, stdout parsed as JSON events
  - `opencode export <sessionId>` — history hydration
- In-memory thread/turn maps. Synthetic IDs: `opencode-thread-*`, `opencode-turn-*`. Adopts `ses_*` session IDs from OpenCode.
- Emits Codex-shaped notifications (`turn/started`, item deltas) to the same `sendApplicationMessage` path as Codex.

### project-registry

Persists `~/.codex/remodex/known-projects.json` (via `resolveCodexHome`). Threads from list/start register cwd metadata for iOS project picker.

### iOS (branch)

- `RuntimeProviderPolicy.strictThreadProviders` includes `"opencode"` (thread provider cannot drift after creation).
- Default runtime selection remains Codex (`gpt-5.5`).
- Provider logos and composer runtime menus for picking harness.

### Tests on branch

Ran in worktree `repos/remodex-opencode/phodex-bridge`: **389 tests, 0 failures** (`sfw npm ci` + `sfw npm test`).

Deleted on branch (whole files): `relay/simulated-pairing-reconnect.test.js`, `CodexMobile/scripts/test-performance-script-usage.sh`. Many other test **files** were heavily edited (large line removals in diff stat, e.g. `session-jsonl-history.test.js`).

## User report validation (May 28 2026 hypothesis)

| Claim | Verdict | Evidence |
|-------|---------|----------|
| OpenCode branch is "production-ready" | **Refute** | Upstream `CONTRIBUTING.md` rejects large PRs; branch touches 197 files with 14k deletions; OpenCode path uses one-shot `opencode run` not long-lived ACP; no E2E proof in repo |
| "~39 files" for the feature | **Refute / clarify** | **13** new files; **197** files changed in diff; ~39 may mean "core feature files" but git shows much wider churn |
| `runtime-provider-router` exists | **Confirm** | New on branch, wired in `bridge.js` before `codex.send` |
| `opencode-provider` exists | **Confirm** | CLI adapter, 275+ lines of new tests |
| `project-registry` exists | **Confirm** | `known-projects.json` registry |
| iOS UI for providers | **Confirm** | Runtime logos, `CodexService+RuntimeConfig`, composer runtime actions |
| Ready to merge upstream as-is | **Refute** | Size, deletion churn, owner contribution policy, needs issue + split PRs |

## OpenCode (anomalyco/opencode)

### Layout (monorepo)

- `packages/opencode` — CLI, ACP server, HTTP API, session engine
- `packages/sdk/js` — `createOpencodeServer()` spawns `opencode serve`, `@opencode-ai/sdk` client
- Core session model: `Session`, `MessageV2`, durable session dirs under user config

### Integration surfaces

| Surface | Transport | Protocol | Fit for Remodex bridge |
|---------|-----------|----------|------------------------|
| `opencode acp` | stdio | JSON-RPC (ACP v1) | **Best long-term** — mirrors `codex app-server` pattern; session/new, session/prompt; streaming gaps documented in `packages/opencode/src/acp/README.md` |
| `opencode serve` | HTTP (default 4096) | OpenCode HTTP API + JS SDK | **Best for dpcode-style** desktop server; needs auth, session pinning, process lifecycle on Mac |
| `opencode run` | subprocess stdout | JSON lines | **What Remodex branch uses today** — simple, testable, weak streaming/tool parity |
| Embed `@opencode-ai/core` | in-process | internal | Heavy dep for Node bridge; wrong runtime boundary |

ACP README limitations (verified): no streaming via `session/update` yet, weak `session/load` history, tool call reporting incomplete.

### Session / thread model

- Internal sessions have IDs like `ses_*`.
- CLI: `session list`, `export`, `run --session`.
- ACP: `session/new`, `session/prompt` map to internal sessions (`session.ts`).

## dpcode

Desktop/web coding environment (Effect-TS, Turbo monorepo). Relevant packages:

- `packages/contracts` — `providerDiscovery`, `providerRuntime`, `provider`, `orchestration` (kinds: codex, claude, cursor, gemini, grok, kilo, **opencode**, pi)
- `packages/effect-acp` — ACP JSON-RPC client over stdio (`client.ts`, `protocol.ts`)
- `apps/server/src/provider/` — `OpenCodeAdapter`, `opencodeRuntime.ts` spawns **`opencode serve`** and uses **`@opencode-ai/sdk/v2`**

dpcode pattern: long-lived HTTP server per provider + canonical runtime events (`opencode.sdk.event`). Not directly portable to Remodex's Node bridge without pulling Effect runtime.

Reusable ideas for Remodex (not code copy):

- Provider discovery contracts and capability flags (`supportsRuntimeModelList`, skills, commands)
- Provider-neutral runtime event normalization
- Binary discovery / upgrade paths (`providerMaintenance.test.ts` for opencode)

## litter

Native iOS/Android Codex client (Rust core `codex-mobile-client` via UniFFI).

- Transport: WebSocket to remote or local Codex app-server; `codex-slingshot` wraps JSON-RPC in relay envelopes (similar problem domain to Remodex relay).
- **Not** a template for near-term Remodex bridge (different stack, Codex-only today).
- Informs long-term mobile architecture if Remodex ever moves thread/session logic off Node into Rust for parity with litter.

## Protocol comparison

| Layer | Remodex today | OpenCode branch | dpcode | litter |
|-------|---------------|-----------------|--------|--------|
| Phone ↔ Mac | Encrypted relay WS | Same | WS/native API to local server | WS + slingshot envelope |
| Mac agent IPC | Codex JSON-RPC stdio | + CLI `opencode run` | HTTP SDK + Effect adapters | Rust → app-server |
| Thread ID ownership | Codex thread IDs | Synthetic + `ses_*` for OpenCode | Provider refs in contracts | Rust session state |
| Model list | `model/list` → Codex | Merged Codex + `opencode models` | Per-provider discovery | Codex models |

## Merge readiness (upstream PR)

**Blockers**

1. Branch size and churn (197 files, large deletions) vs upstream "small PRs only".
2. No maintainer issue or approval (CONTRIBUTING requires issue first).
3. OpenCode integration is CLI batch mode, not parity with Codex streaming/tool UX.
4. `relay/simulated-pairing-reconnect.test.js` removed on branch.
5. Possible iOS/runtime behavior regressions hidden in 27 CodexMobile changed files without device E2E in repo.

**Strengths**

1. Focused new modules with dedicated tests (router, provider, registry).
2. `phodex-bridge` test suite green on branch (389 tests).
3. Router design keeps Codex path as default fallback.

**Recommendation:** Treat branch as **reference implementation**, not merge-ready. Extract vertical slices onto fresh branches from current `main`.
