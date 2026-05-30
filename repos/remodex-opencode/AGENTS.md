# AGENTS.md

See `$REMODEX_WORKSPACE/AGENTS.md` for workspace-wide rules. This file covers repo-specific details only.

## Local Quick Runbook

```bash
cd phodex-bridge
npm start
```

For full bridge tests:
```bash
cd phodex-bridge
npm test
```

## Where Everything Lives

```
repos/remodex-opencode/
├── AGENTS.md                     # ← You are here
├── preload.js                    # Optional preload script
├── phodex-bridge/                # Node.js bridge (remodex npm package)
│   ├── src/                      # 45 source files (CommonJS, flat)
│   ├── test/                     # 38 test files (node:test)
│   ├── bin/                      # CLI entrypoints (remodex, remodex-jsonl-diagnose)
│   ├── scripts/                  # npm lifecycle scripts (prepack/postpack)
│   └── package.json              # npm package config (v1.5.6)
└── CodexMobile/                  # Xcode project (iOS SwiftUI app)
    ├── CodexMobile/              # App source (Services, Views, Models)
    ├── CodexMobileTests/         # Unit tests
    └── CodexMobileUITests/       # UI tests
```

## Build Guardrails

- Do NOT run Xcode tests unless the user explicitly asks
- Markdown files inside Xcode-synced groups can produce harmless warnings
- For small iOS/mobile fixes, prefer inspection and targeted edits over simulator runs

## Key iOS Guardrails

- `turn/started` may not include a usable `turnId`: keep the per-thread running fallback
- Merge late reasoning deltas into existing rows; do not spawn fake extra "Thinking..." rows
- Ignore late turn-less activity events when the turn is already inactive
- Suppress benign background disconnect noise (`NWError.posix(.ECONNABORTED)`)
- On reconnect/background recover, rehydrate active turn state so Stop remains visible

## Key Bridge Guardrails

- Handler cascade order in `bridge.js` is load-bearing. Insert new handlers at the documented position, not at the end.
- `stripRuntimeProviderFieldsForCodex()` must run before any request reaches the Codex app-server.
- Thread ownership is durable — `~/.remodex/thread-ownership.json` must be readable on every route.
- OpenCode threads must not trigger Codex.app desktop refresh or rollout mirroring.
