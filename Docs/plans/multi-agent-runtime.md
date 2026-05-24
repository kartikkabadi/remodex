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

## Current Reality (as of stabilization work start, post user answers 2026)

**Brownfield state on this branch (hybrid partial impl + docs/plans ahead of full cutover):**
- Substantial real foundation present (bridge: full `agent-runtime-registry.js` + `agent-runtime-capabilities.js` + `canonical-events.js` + `thread-agent-state.js` + codex/opencode/cursor adapters + `opencode-server.js` (exact spawn + security per blueprint) + `cursor-acp-client.js` (robust discovery with local paths); iOS: `CodexService+RemodexEventAdapter.swift` wired in Incoming, `CodexThread` has `agentRuntime`/`agentSessionId`/`opencode*AgentName` fields + merge, `TurnComposerRuntimeState` + gating + Agent pill, `CodexServiceRemodexEventAdapterTests` + service descriptors; all per ADR 002/003 + implementation blueprint tables).
- **Gaps vs. locked decisions** (spawn audit + GitHub issues #16–#29 still OPEN/"blocked"): Codex-to-canonical not wired in prod paths (big-bang #19/#23 incomplete; raw `codex/event/*` dominant for Codex + sidecars); warm/cached initialize has stale "spawn support lands in a later update" fallbacks (even for Cursor with full ACP); fork/continue lacks runtime metadata inheritance (CodexService+ThreadFork + Helpers); permission/plan event mappings partial + iOS adapter "cursor" default bug; tests cover happy paths but not full matrix/warm/reconnect per AGENTS; resume not uniform.
- **GitHub issues** (kartikkabadi/remodex, via MCP): All slices #21–#29 OPEN, "enhancement"/"blocked"/"ready-for-human", bodies match plans 1:1 (acceptance requires agent verification + Kartik physical smoke). No slices closed yet. Local code has partial progress on many "suggested files".
- **Docs drift**: README heavily Codex-only (being stabilized in Phase 1 with CONTEXT terms + V1/partial/Core notes + links). Plans/ADRs use correct language. modelProvider still in legacy iOS models (kept separate per plans; not overloaded for Agent Runtime).
- **Cleanup debt**: 12 P0 god objects in Swift (CLEANUP-AUDIT May 11; many still TODO per TRACKER). Narrow scope: only intersecting files (CodexThread, Helpers, Incoming, ThreadFork, RemodexEventAdapter) in Phase 3.
- **Artifacts (user rules strictly followed)**: tmp-vps-live/ (Emanuele upstream live relay bits) fully protected — zero touch. cleanup/plans/ (270 local per-file plans) treated as user-local; no bulk action (narrow scope + "review details first... very selective... do not delete anything that belongs to Emanuele").
- **User intent (ask_user_question answers)**: Hybrid (local partial as solo base + selective safe cherry-picks from Emanuele codex/add-* in parallel); narrow scope; push higher practical parity where safe/fixture-backed; keep selectively + extremely conservative on artifacts (nothing Emanuele-owned); actively update GitHub issues with reality/progress during work.

**Stabilization in progress (Phase 1 docs first, then 7 gaps per blueprint order, narrow intersecting cleanup, higher-parity polish).** See plan.md (session 019e5a13-...) + README updates for Reality vs. Plan. All work follows AGENTS.md guardrails (local-first, read this plan first, kartikkabadi issues, xcodebuild after Swift, no junk reports, preserve iOS timeline rules).

Do not merge upstream `modelProvider` router branches wholesale. Mine patterns; implement ADR shape.

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
| Merge gate | `#17` CI must run real bridge + relay tests before merging `#18+` |
| Initialize contract | Warm reconnect returns full runtime payload, not `{ bridgeManaged: true }` only |
| iOS naming | **Agent Runtime** (transport) vs existing **Codex model runtime** types stay separate |
| Thread sync | Bridge `thread-agent-state.json` is source of truth; `thread/list` projects agent fields |
| Runtime models | Provider/model identity belongs to runtime-owned model discovery, not a static app catalog |

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

## Runtime model discovery addendum (2026-05-25)

Physical iPad smoke proved the first runtime-scoped model catalog pass was a useful tracer bullet but not the final product shape. OpenCode cannot be represented by two hardcoded model entries. Remodex must discover provider/model choices from the user's actual OpenCode setup, keep provider identity separate from model identity, and keep iPad turn state stable through OpenCode response gaps.

The superseded model-catalog issues are #31-#37. Replacement plan:

| Slice | GitHub issue |
|-------|----------------|
| Dynamic provider/model PRD | [#38](https://github.com/kartikkabadi/remodex/issues/38) |
| Runtime Model Discovery contract | [#39](https://github.com/kartikkabadi/remodex/issues/39) |
| OpenCode dynamic discovery + dispatch | [#40](https://github.com/kartikkabadi/remodex/issues/40) |
| Native provider/model picker | [#41](https://github.com/kartikkabadi/remodex/issues/41) |
| OpenCode Running Turn lifecycle stability | [#42](https://github.com/kartikkabadi/remodex/issues/42) |
| Physical iPad dynamic model smoke | [#43](https://github.com/kartikkabadi/remodex/issues/43) |

---

## Verification (agents)

- `cd phodex-bridge && npm test`
- `cd relay && npm test` (CI when added)
- `./run-local-remodex.sh` Mac smoke
- `xcodebuild` compile after iOS changes
- Kartik: physical iPhone (PR1/PR2) and iPad (PR3) smoke

Not required for agent "done": simulator QR E2E, full XCTest suite every commit.
