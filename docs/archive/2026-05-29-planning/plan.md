# Implementation plan — Full OpenCode in Remodex

**Goal:** Integrate OpenCode as a first-class runtime in Remodex with as much OpenCode capability as the harness and UI can honestly expose — not incremental cherry-picks from `codex/add-opencode-provider`.

**Workspace:** `$REMODEX_WORKSPACE` only. **No upstream PR** until Kartik confirms device E2E (Codex regression + OpenCode session). Aligned with Emanuele — no “open issue first” gate.

**UX spec:** `.scratch/remodex-multi-agent/ux-spec.md` (composer hierarchy, capability-driven grey-out).  
**Short plan:** `.scratch/remodex-multi-agent/PLAN-SUMMARY.md`.

## Non-negotiables

| # | Rule |
|---|------|
| 1 | **Full integration** — router, harness, iOS composer, catalog, ownership, slash/skills that matter; fix forward on branch base. |
| 2 | **Composer pill hierarchy unchanged:** runtime → OpenCode agent → provider → model → reasoning → fast. OpenCode cannot do X → **greyed / unavailable + reason** on OpenCode threads. Never silent failure or fake-enabled controls. |
| 3 | **Harness:** ACP stdio (`opencode acp`) **primary**; CLI (`opencode run`) **fallback only** where ACP cannot satisfy a capability — both reflected in `runtime/catalog`. |
| 4 | **Branch strategy:** Use `codex/add-opencode-provider` as integration base **or** merge that work holistically and fix forward — **not** file-by-file cherry-pick onto `main`. |
| 5 | **Done bar:** Device E2E + bridge tests green + published **parity matrix** (feature × codex × opencode → enabled \| greyed \| n/a). |

## Branch-as-base workflow

1. **Integration line:** Start from `codex/add-opencode-provider` (or equivalent holistic merge into this workspace).
2. **Fix forward:** Rebase or merge `main` only when needed for conflicts; resolve in place — do not re-slice into tiny upstream PRs.
3. **ACP uplift:** Replace branch’s per-turn CLI primary path with `opencode-acp-harness.js`; keep `REMODEX_OPENCODE_TRANSPORT=cli` for CI and documented gaps.
4. **Catalog-first UI:** Land `runtime/catalog` + capability flags before polishing edge UX.
5. **Local verification:** `sfw npm test` in `phodex-bridge`; iOS unit/snapshot tests; device matrix below.
6. **Upstream:** Blocked until Kartik signs device checklist — then single coordinated PR series if maintainer wants it.

## Implementation milestones (ordered)

### M1 — Integration base + router truth

- Holistic branch base in this workspace: `runtime-provider-router`, `opencode-models`, `project-registry`, `thread-ownership-store` (durable), Codex passthrough unchanged.
- `runtime/catalog` stub → full: runtimes, agents (`opencode agent list`), transport mode (`acp` \| `cli`), `enabled` + `unavailableReason`.
- `stripRuntimeProviderFieldsForCodex`; OpenCode threads excluded from desktop mirror.
- **Exit:** Bridge tests green; Codex-only path identical to today when `REMODEX_ENABLE_OPENCODE` unset.

### M2 — ACP harness (primary)

- `opencode-acp-harness.js`: long-lived stdio child, same `ProviderHarness` surface as branch CLI provider.
- Map ACP session/turn notifications into existing `sendApplicationMessage` delta path where upstream supports; document gaps in parity matrix.
- CLI fallback behind `REMODEX_OPENCODE_TRANSPORT=cli` + catalog flag `capabilities.transportFallback`.
- **Exit:** One OpenCode turn on device via ACP; CLI path still passes mocked integration tests.

### M3 — iOS composer + `SessionRuntimeSelection`

- Full composer hierarchy in `TurnComposerRuntimeUIKitMenu.swift` (runtime row, OpenCode agent, provider-grouped models, intelligence, speed).
- `SessionRuntimeSelection` discriminated union; flat RPC on `thread/start` / `turn/start` (`modelProvider`, `model`, `agent`, `effort`, `serviceTier`).
- Capability-driven enable/grey (ux-spec § Capability-driven UI); thread affinity + strict providers.
- **Exit:** Device: pick Codex → send; pick OpenCode → agent → model → send; greyed rows show reason when catalog says unsupported.

### M4 — Parity: modes, slash, skills, git/workspace

- Enrich OpenCode model metadata for reasoning/fast (hide or grey — never fake).
- Audit `handleApplicationMessage`: bridge-local git/workspace/desktop; forward skill/slash into OpenCode session where ACP allows; Codex-only actions → structured errors + iOS copy.
- Merge `thread/list`, history/export paths, ownership resume after bridge restart.
- **Exit:** Parity matrix filled for composer + bridge-local features; Slice-level gaps in `gaps.md` tracked to **closed** or **greyed** with reason.

### M5 — Device done bar + regression

- **Codex regression:** existing flows (pairing, thread, turn, plan mode, model/reasoning/fast, git panel) unchanged.
- **OpenCode session:** agent, model, turn complete, git/workspace on OpenCode thread, slash/skills that matter per matrix.
- Bridge: restore/run relay reconnect test; ACP mocked stdio + CLI fallback tests.
- **Exit:** Kartik device sign-off; parity matrix committed in scratch + bridge README snippet.

## Parity matrix (living doc)

Maintain in `PLAN-SUMMARY.md` and `gaps.md` § matrix; update on every milestone.

| Feature | Codex | OpenCode | UI |
|---------|-------|----------|-----|
| Agent runtime pick | enabled | enabled when binary + flag | enabled |
| OpenCode agent (plan/build/custom) | n/a | enabled when catalog lists agents | hidden on Codex threads |
| Provider submenu | n/a (flat models) | enabled | enabled |
| Model list | enabled | enabled | enabled |
| Reasoning / intelligence | enabled per model | enabled \| greyed per catalog | greyed + reason if unsupported |
| Fast / service tier | enabled per model | enabled \| greyed per catalog | greyed + reason if unsupported |
| Codex Plan mode (+ menu) | enabled | n/a | hidden on OpenCode threads |
| Remodex slash / skills | enabled | enabled \| greyed per matrix | greyed + reason |
| MCP (iOS settings) | enabled | greyed (in-process OpenCode) | greyed + reason |
| Git / workspace handlers | enabled | enabled (bridge-local) | enabled |
| Streaming / tool timeline | enabled | enabled \| partial (ACP gaps) | beta label until parity |
| Voice mode | enabled | n/a | greyed on OpenCode |
| Approvals UI | enabled | greyed \| partial | greyed + reason |
| Thread fork / steer / queue | enabled | greyed \| partial | greyed + reason |

*Cells are **enabled** | **greyed** (+ reason string) | **n/a**. Implementation must not claim **enabled** without device or test proof.*

## Done checklist (device + CI)

- [ ] Pairing unchanged (relay + secure transport).
- [ ] Codex thread: start, turn, model, reasoning, fast, plan mode, git action smoke.
- [ ] OpenCode thread: runtime → agent → model → turn completes (ACP).
- [ ] OpenCode thread: git/workspace bridge-local action works.
- [ ] Slash/skill that matters: works or greyed with visible reason on OpenCode thread.
- [ ] Bridge `sfw npm test` green (ACP mock + CLI fallback + router).
- [ ] Parity matrix reviewed with Kartik; no fake-enabled picker rows.
- [ ] Kartik explicit OK to open upstream PR(s).

## Test strategy

| Layer | What |
|-------|------|
| Unit | Router merge, ownership store, catalog builder, ACP adapter (mocked stdio), CLI fallback |
| Integration | `bridge.test.js`; relay reconnect when touched |
| iOS | `SessionRuntimeSelectionTests`, runtime menu snapshots, existing CodexMobileTests |
| Manual | Same Mac: one Codex + one OpenCode thread; screenshot parity matrix rows |
| CI | OpenCode optional (mocked); flag-off path = today’s behavior |

## What we are NOT doing

- Tiny upstream PR sequence (“PR #1 registry only” as primary path).
- File-by-file cherry-pick from branch onto `main` in this effort.
- Upstream PR before device E2E sign-off.
- Phase 0 “open issue first” as a blocker (Emanuele aligned).
- Per-turn CLI as **primary** harness (CLI = fallback only).
- Silent disable or enabled controls without catalog backing.
- Cursor/Gemini/pi providers; `opencode serve` HTTP; litter Rust core; relay protocol changes.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Branch bitrot vs `main` | Holistic base in workspace; periodic merge fix-forward |
| ACP streaming/tool gaps | Parity matrix + beta label; CLI fallback only for catalog-listed gaps |
| OpenCode CLI breaking changes | Min version in catalog error; version in bridge status |
| Over-scoped 197-file merge | Milestones M1–M5 with explicit exits; delete dead branch paths when ACP lands |
| Security (`skip-permissions`) | Map to Remodex access mode; safe defaults |

## First action for agents

1. Confirm workspace is on branch-as-base (or merged equivalent).
2. Execute **M1** → **M2** → **M3** with catalog + tests before device polish.
3. Fill parity matrix as features land; grey out before claiming enabled.
