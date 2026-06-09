# remodex:opencode

Meta-workspace for integrating OpenCode as a first-class runtime into
Remodex (the iPhone app that controls AI coding agents from your phone).

## What This Is

A multi-repo workspace containing:

| Path | Role |
|------|------|
| `repos/remodex-opencode/` | The Remodex bridge (phodex-bridge) + CodexMobile iOS app |
| `repos/opencode/` | Vendored OpenCode CLI (reference, not modified) |
| `repos/dpcode/` | Reference — Electron/React multi-provider desktop app |
| `repos/litter/` | Reference — Rust-cored native iOS+Android Codex client |

## Absolute Non-Negotiables

1. **Device E2E signed off on `main`** — see `docs/operations/device-e2e-signoff.md`. Core OpenCode + Codex parity on physical iPhone + Mac is complete for phone-originated threads and catalog/composer features. **Mac-started OpenCode folder/session sync** (class (e) external discovery) is driven by the Remodex iOS app via `thread/list` params (`discoverOpenCodeSessions` / `discoverOpenCodeProjects`, default **on**). Mac env overrides (`REMODEX_OPENCODE_DISCOVER_*=0`) remain for regression. Device matrix O18–O20 (`docs/operations/device-e2e-opencode.md`) still gates full Mac→iPhone parity sign-off. Upstream PRs still need explicit release approval; legal clearance still blocks branded assets.
2. **Codex regression**: the existing Codex-only path MUST work identically when `REMODEX_DISABLE_OPENCODE=1` (or legacy `REMODEX_ENABLE_OPENCODE=0`). Every Codex feature that works today must keep working. OpenCode is enabled by default otherwise.
3. **Capability-driven UI**: never show an enabled control that isn't backed by `runtime/catalog` proof. Grey out with reason string for anything unsupported. No fake-enabled picker rows.
4. **Bridge is the composition root**: all subsystem wiring happens in `bridge.js`. No service locators, no DI containers, no dynamic module loading.
5. **Tests pass before claiming complete**: run `npm test`, verify output, don't skip quality gates for expediency.

## Architecture Invariants

- **Thread ownership is durable**: `~/.remodex/thread-ownership.json` persists thread→provider mapping across bridge restarts. Set on `thread/start`, checked on every subsequent route.
- **Provider isolation**: OpenCode providers never leak into Codex paths. `stripRuntimeProviderFieldsForCodex()` removes provider fields before forwarding to Codex app-server.
- **Capability flags drive UI exclusively**: the **20** capability flags in `runtime/catalog` (`provider-capabilities.js` / ADR-002) are the only source of truth for what the iOS composer shows, hides, or greys out. Provider identity is never checked in UI code for visibility. Live parity: `docs/operations/release-compatibility.md`; archival plan: `docs/design/master-opencode-integration.md`.
- **Secure transport is unchanged**: E2EE encryption, relay protocol, pairing flow, and trusted reconnect are NOT modified by provider work.
- **Handler cascade order is load-bearing**: the if/else chain in `bridge.js:handleApplicationMessage()` has a fixed order. Insert new handlers at the documented position, not at the end.

## Key Design Decisions

See `docs/architecture/` for full decision records with context and rejected alternatives.

| ADR | Topic | Decision |
|-----|-------|----------|
| 001 | Provider interface | `ProviderHarness` interface — one file + one registration per new runtime |
| 002 | Capability model | 20 flags per model, catalog is source of truth, grey-out mechanics |
| 003 | Thread ownership | Durable JSON file, strict providers (no mid-thread harness switching) |
| 004 | Transport protocol | `opencode serve` HTTP + `@opencode-ai/sdk/v2` as primary |
| 005 | Error taxonomy | 3-layer model: SDK→Bridge→iOS, structured error codes, no raw stack traces |
| 006 | Session lifecycle | Lazy creation, persisted session IDs, idle shutdown after 10 min |

## Where Everything Lives

```
remodex:opencode/
├── AGENTS.md                          # ← You are here
├── docs/
│   ├── architecture/                  # Immutable Architecture Decision Records (ADRs)
│   ├── contracts/                     # Living API contracts (bridge RPC, SDK usage, iOS state)
│   ├── taste/                         # Implementation conventions (bridge, iOS, cross-project)
│   ├── testing/                       # Testing strategy and done bars
│   ├── operations/                    # Release compatibility, observability, parity matrix, **device-e2e-signoff.md**
│   └── archive/                       # Historical planning docs (superseded)
├── repos/
│   ├── remodex-opencode/             # ← Active development (bridge + iOS app)
│   │   ├── AGENTS.md                 #    Repo-specific quick start
│   │   ├── phodex-bridge/            #    Node.js bridge (remodex npm package)
│   │   └── CodexMobile/              #    Xcode project (iOS SwiftUI app)
│   ├── opencode/                     #    Vendored OpenCode CLI (reference only)
│   ├── dpcode/                       #    Reference multi-provider desktop app
│   └── litter/                       #    Reference Rust-cored mobile client
```

## Phase 2 (OpenCode gaps)

Completed in `repos/remodex-opencode` on base `38ad72b`. See `repos/remodex-opencode/AGENTS.md` Phase 2 table. PR8 catalog handoff flip **done** — see `docs/operations/device-e2e-signoff.md`.

## Execute-plan follow-on (16 PRs — **merged**)

Grok `/execute-plan` `a6c7a11c` (Jun 2026) landed **16/16 PR intents on meta `main`** via four themed merges (Messaging, Composer, Branding, Closeout). Historical Grok worktrees remain for forensic reference only.

| Doc | Purpose |
|-----|---------|
| [`docs/operations/execute-plan-a6c7a11c-INDEX.md`](docs/operations/execute-plan-a6c7a11c-INDEX.md) | Entry point |
| [`docs/operations/execute-plan-a6c7a11c-STATUS.md`](docs/operations/execute-plan-a6c7a11c-STATUS.md) | **Authoritative** done vs not done (16/16 on `main`) |
| [`.cursor/plans/execute-plan-a6c7a11c-integration.plan.md`](.cursor/plans/execute-plan-a6c7a11c-integration.plan.md) | Historical integration plan (complete) |

**Next bar (post execute-plan):** owner device final pass (O0–O17, `REMODEX_DISABLE_OPENCODE=1` regression) → upstream export. Do not resume Grok TUI.

## Workflow

### Branch strategy
- Work in `remodex:opencode` on the `main` branch
- Upstream PRs: allowed after device E2E sign-off (`docs/operations/device-e2e-signoff.md`); coordinate with Kartik for release timing
- Commit conventional-style messages: `type(scope): summary`

### Commit conventions
- `feat:` — new capability
- `fix:` — bug fix
- `docs:` — documentation changes
- `refactor:` — code restructuring without behavior change
- `test:` — test additions or changes
- `chore:` — maintenance (deps, cleanup, config)

### Quality gates
1. Bridge: `cd phodex-bridge && node --test ./test/*.test.js` — all green
2. iOS: existing CodexMobileTests pass (don't run unless explicitly asked — Xcode tests are slow)
3. Code review before merge
4. "It works" is NOT the same as "it's ready"

### Build guardrails
- Do NOT run Xcode tests unless explicitly asked
- For small iOS fixes, prefer inspection and targeted edits over simulator runs
- Bridge tests: `cd repos/remodex-opencode/phodex-bridge && npm test`

## Implementation Conventions

See `docs/taste/` for full conventions. Key highlights:

- **Bridge**: CommonJS, no TypeScript, flat `src/` directory, 5-line file headers, DI by closure, `node:test` with zero devDependencies
- **iOS**: Swift 6, iOS 18.6 target, SwiftUI, `CodexService` as single data controller, `AppModel` as @Observable state, Liquid Glass design system
- **Cross-project**: "Model selection IS runtime selection" — no separate runtime picker UI row

## Reference Implementations

These repos are read-only references. Their code informs architecture but is not copied directly:

- **dpcode** (`repos/dpcode/`): Proves the `opencode serve` + `@opencode-ai/sdk/v2` pattern works. Its `OpenCodeAdapter.ts` (3000+ lines) is the reference for how to use the SDK. Key files: `apps/server/src/provider/Layers/OpenCodeAdapter.ts`, `apps/server/src/provider/opencodeRuntime.ts`.
- **litter** (`repos/litter/`): Proves the Rust-cored mobile architecture. Informs long-term direction if bridge state management moves to Rust. Codex-only, no OpenCode support.
- **opencode** (`repos/opencode/`): The upstream OpenCode CLI. ACP v1 and v2 implementations in `packages/opencode/src/acp/` and `packages/opencode/src/acp-next/`. Not modified — vendored for reference.
