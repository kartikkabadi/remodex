# Where to work (Remodex)

**Read this before editing any Remodex files.**

## Canonical development surface

| What | Path | Branch |
|------|------|--------|
| **All multi-agent work** | `/Users/user/Documents/projects/remodex-build` | `feat/multi-agent-runtime` |
| **GitHub fork** | https://github.com/kartikkabadi/remodex | same branch for PRs |
| **Upstream** | https://github.com/Emanuele-web04/remodex | `origin/main` for sync reference only |

## Do not use

| Path | Why |
|------|-----|
| `/Users/user/Documents/projects/remodex` | Stale snapshot on `main` — Codex-only code, no runtime registry/adapters. Historical reference only. |

## Read order for agents

1. [AGENTS.md](../AGENTS.md)
2. [CONTEXT.md](../CONTEXT.md)
3. [Docs/plans/multi-agent-runtime.md](plans/multi-agent-runtime.md)
4. GitHub epic [#16](https://github.com/kartikkabadi/remodex/issues/16)

## Verify before claiming done

```bash
cd phodex-bridge && npm test   # expect 448 pass
cd ../relay && npm test        # expect 39 pass
```

After Swift changes: `xcodebuild` per AGENTS.md.

## Issue tracks

- **Code (delegable):** #39 → #40 → #41 → #42 (dynamic provider/model discovery)
- **Blocked on Kartik device smoke:** #24, #27, #28, #43, #29 — do not close without physical proof
- **Closed (do not reopen):** #18 (registry), #17 (CI), #31–#37 (superseded by #38–#43)

## Kartik's fork vs upstream

This fork adds OpenCode + Cursor on top of Emanuele's Codex remote-control stack. OpenAI's official Codex-in-ChatGPT mobile feature does not replace this lane: Remodex still targets multi-runtime control, self-hosted relay, and Telegram (separate branch). Upstream PR prep stays blocked on #29 until device proof exists.
