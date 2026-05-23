# Multi-agent runtime — index

**Status:** Active (2026-05-23)  
**Branch:** `feat/multi-agent-runtime` on [kartikkabadi/remodex](https://github.com/kartikkabadi/remodex) from `origin/main`  
**Parent issue:** https://github.com/kartikkabadi/remodex/issues/16  
**Implementation blueprint:** [multi-agent-runtime-implementation.md](multi-agent-runtime-implementation.md)
**Domain language:** [CONTEXT.md](../../CONTEXT.md)  
**Architecture:** [ADR 002](../adr/002-agent-runtime-and-canonical-events.md), [ADR 003](../adr/003-cursor-agent-runtime.md)  
**Agent config:** [docs/agents/](../../docs/agents/)

Execution detail lives in **GitHub issues on the fork** (not local `.scratch/`).

---

## Goal

Remodex hosts multiple **agent runtimes** on the Mac (Codex, OpenCode, Cursor; Grok later). Each thread picks one runtime at creation. The bridge translates all runtimes into **one Remodex event vocabulary**; iOS uses **one** timeline pipeline.

Do not merge upstream `modelProvider` router branches wholesale. Mine patterns; implement ADR shape.

---

## Locked decisions (2026-05-23 grill)

| Topic | Decision |
|-------|----------|
| Routing | `agentRuntime` + `agentSessionId` — not `modelProvider` |
| Wire to phone | `remodex/event/*`, `plan.*`, permission RPC only in production |
| OpenCode | Spawn-only `opencode serve` on loopback |
| Cursor PR2 | **Core only** — hide queue, steer, photos on Cursor threads |
| PR1 Stretch | Hide controls if fixture tests fail; Core must work |
| OpenCode handoff | `desktop/continueOnOpenCode` via `opencode attach` |
| iOS cutover | Big-bang canonical in PR1 (bridge 03 + iOS 06 together) |
| Delivery | Three stacked upstream PRs: PR1 OpenCode → PR2 Cursor → PR3 iPad |
| QA | PR1/PR2 = iPhone (`CodexMobile`); PR3 = iPad (`RemodexPad`) |
| Telegram / Grok | Out of multi-agent V1 |

---

## Upstream PR map

| PR | Scope | Device QA |
|----|--------|-----------|
| **PR1 — OpenCode** | Registry, canonical, OpenCode path, iOS UX + cutover, iPhone E2E | Kartik iPhone |
| **PR2 — Cursor** | Cursor ACP + adapter, iPhone E2E (Core only) | Kartik iPhone |
| **PR3 — iPad** | RemodexPad cherry-pick, re-smoke 07 + 07b | Kartik iPad |

---

## Issue index (fork)

| Slice | GitHub issue |
|-------|----------------|
| **Epic** | [#16](https://github.com/kartikkabadi/remodex/issues/16) |
| Wave 0 — hygiene | [#17](https://github.com/kartikkabadi/remodex/issues/17) |
| 01 — bridge registry | [#18](https://github.com/kartikkabadi/remodex/issues/18) |
| 03 — canonical + Codex adapter | [#19](https://github.com/kartikkabadi/remodex/issues/19) |
| 02 — OpenCode spawn | [#20](https://github.com/kartikkabadi/remodex/issues/20) |
| 04 — OpenCode adapter | [#22](https://github.com/kartikkabadi/remodex/issues/22) |
| 05 — iOS agent UX | [#21](https://github.com/kartikkabadi/remodex/issues/21) |
| 06 — iOS RemodexEventAdapter | [#23](https://github.com/kartikkabadi/remodex/issues/23) |
| 07 — OpenCode E2E iPhone | [#24](https://github.com/kartikkabadi/remodex/issues/24) |
| 10 — Cursor ACP | [#25](https://github.com/kartikkabadi/remodex/issues/25) |
| 11 — Cursor canonical | [#26](https://github.com/kartikkabadi/remodex/issues/26) |
| 07b — Cursor E2E iPhone | [#27](https://github.com/kartikkabadi/remodex/issues/27) |
| 12 — RemodexPad | [#28](https://github.com/kartikkabadi/remodex/issues/28) |
| 09 — upstream PR prep | [#29](https://github.com/kartikkabadi/remodex/issues/29) |

---

## Verification (agents)

- `cd phodex-bridge && npm test`
- `cd relay && npm test` (CI when added)
- `./run-local-remodex.sh` Mac smoke
- `xcodebuild` compile after iOS changes
- Kartik: physical iPhone (PR1/PR2) and iPad (PR3) smoke

Not required for agent "done": simulator QR E2E, full XCTest suite every commit.
