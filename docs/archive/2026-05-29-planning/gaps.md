# Remodex multi-agent + OpenCode + composer picker — gap checklist

> **Plan reset (2026-05-29):** Gaps close via **full-integration milestones M1–M5** on branch-as-base (`codex/add-opencode-provider` + fix forward + ACP primary) — **not** by cherry-pick slices or tiny upstream PRs. Each gap resolves to **enabled**, **greyed (+ reason)**, or **n/a** in the parity matrix (`PLAN-SUMMARY.md`). Until a milestone lands, treat open gaps as blocking **enabled** claims in UI.

Verified 2026-05-29 against `repos/remodex` **main** (`28f7d3c`), reference branch `repos/remodex-opencode` (`origin/codex/add-opencode-provider`), scratch specs, and `repos/opencode` ACP docs.

**Milestone map:** **A** ≈ M1/M3 runtime row; **B** ≈ M2/M3 harness + models; **C** ≈ M3/M4 capability flags; **D** ≈ M4 slash/skills/matrix; **M5** = device done bar. **post-v1** = after full integration sign-off or explicitly deferred.

---

## 1. Product / UX

| Gap | Why it matters | Slice |
|-----|----------------|-------|
| **Agent runtime row** (Codex \| OpenCode) at top of composer pill — missing on main; missing on branch (branch only groups models by provider, no explicit runtime submenu). | Kartik contract: one hierarchy; users cannot pick harness without inferring from model list. | **A** |
| **OpenCode agent submenu** (build / plan / custom from config) — not in branch UI or `opencode run` args (`--agent`). | Plan vs build is a first-class OpenCode concept; conflating with Codex Plan toggle breaks semantics. | **B** |
| **`SessionRuntimeSelection` discriminated union** on iOS (Codex vs OpenCode fields) — not implemented; branch uses `selectionKey` + `modelProvider` only. | Prevents wrong RPC projection (`effort` on OpenCode, `agent` missing). | **A** (types) / **B** (OpenCode fields) |
| **Runtime row disabled / read-only** on existing OpenCode threads (`strictThreadProviders`) — policy exists on branch (`opencode` in set) but no dedicated runtime UI to disable. | Users could think they switched harness mid-thread. | **A** |
| **OpenCode unavailable empty state** in picker (binary missing, flag off, catalog empty) — branch logs `OpenCode unavailable`; Slice A spec says show disabled/unavailable until B. | Avoid silent empty model list or failed starts. | **A** (copy) / **B** (real enablement) |
| **Beta / experimental label** on OpenCode threads in pill or thread list — planned in architecture/plan, not on branch. | Sets expectations while ACP streaming lags Codex. | **B** |
| **Default runtime + default OpenCode agent** in Settings — main `SettingsRuntimeDefaultsCard` is Codex model/reasoning/speed only; branch adds provider-grouped model picker but not default runtime/agent rows. | New chats should respect Kartik defaults without re-picking every time. | **A** / **B** |
| **Per-thread vs global selection** when opening existing thread — branch has `CodexThreadRuntimeOverride` for Codex fields; OpenCode `opencodeAgent` not on `CodexThread` decode. | Wrong model/agent sent on resume. | **A** / **B** |
| **Codex Plan mode (+ menu) vs OpenCode plan agent** — must stay separate (ux-spec non-goals); no UX doc on thread when both apply. | User confusion if plan toggle affects OpenCode harness. | **B** (docs/copy) |
| **Error copy for Codex-only composer actions** on OpenCode threads (Slice D) — not implemented. | Prevents “broken” taps on skills/MCP/plan features. | **D** |
| **Thread list provider badge** (`RuntimeProviderLogo`) — branch has assets; main does not. | Glanceable harness in sidebar. | **B** |
| **“Other models…” sheet** vs hierarchical provider submenus — main keeps featured + sheet; branch uses inline provider submenus only. | Regression risk when porting B; verify long lists on phone. | **B** |
| **Maintainer device E2E + video** before “works” claim — required in plan/ux-spec; not in repo. | Kartik: **no upstream PR** until device E2E (M5). | **M5** |
| **Phase 0 upstream issue ACK** — old plan blocker; **waived** (Emanuele aligned). | Upstream packaging after local E2E only. | **n/a** (process) |

---

## 2. Protocol / RPC

| Gap | Why it matters | Slice |
|-----|----------------|-------|
| **`runtime/catalog` bridge method** — specified in ux-spec; absent on main and branch. | iOS needs agent list without duplicating selection state on Mac. | **A** (Codex-only stub) / **B** (OpenCode agents) |
| **`modelProvider` + `agent` on `thread/start` / `turn/start`** — main `makeThreadStartParams` sends `model`, `cwd`, `serviceTier` only; branch sends `modelProvider`, not `agent`. | Router cannot route or run `--agent` without these fields. | **A** (`modelProvider` explicit) / **B** (`agent`) |
| **`runtime-provider-router` on main** — all app JSON-RPC goes to `codex.send` in `bridge.js`; no merge for `model/list` / `thread/list`. | OpenCode cannot exist without router. | **A** (skeleton) / **B** (harness) |
| **Routable method set** — branch handles 9 thread/turn methods; anything else (e.g. `turn/steer`, approvals, fork) still hits Codex or is unhandled for OpenCode threads. | Queue/steer/plan flows break on OpenCode threads. | **D** / **post-v1** |
| **`stripRuntimeProviderFieldsForCodex`** — on branch, not on main. | Codex app-server may reject unknown fields if router misroutes. | **A** |
| **Bidirectional notifications** — Codex app-server pushes `turn/started`, item deltas, approvals; OpenCode CLI synthesizes some; ACP has no `session/update` streaming yet. | Composer and timeline feel “stuck” vs Codex. | **B** (CLI partial) / **post-v1** (ACP streaming) |
| **OpenCode → Codex-shaped item types** (tools, skills, subagents) — branch maps JSON lines; parity incomplete vs Codex notifications. | Timeline renders wrong or missing rows. | **B** / **D** |
| **`thread/turns/list` for OpenCode** — branch implements via export/history; main adds JSONL fallback for **Codex** rollout only. | History gaps after reconnect or bridge restart. | **B** |
| **Approval RPCs** (`item/*/requestApproval`) — Codex + desktop IPC follower; OpenCode provider only maps `approvalPolicy` to `--dangerously-skip-permissions`. | Mobile approval UI may never fire on OpenCode. | **D** / **post-v1** |
| **Account/auth RPCs** — `account/read`, `getAuthStatus` are Codex/OpenAI-centric; OpenCode provider auth not exposed. | “Logged in” UX may lie for OpenCode-only usage. | **post-v1** |
| **Version skew RPC errors** — no structured `opencode_version_too_old` in bridge. | Hard to debug field failures after OpenCode upgrade. | **B** |

---

## 3. Bridge / runtime

| Gap | Why it matters | Slice |
|-----|----------------|-------|
| **Entire OpenCode stack absent on main** — no `opencode-provider.js`, `opencode-models.js`, `runtime-provider-router.js`, `project-registry.js`. | Land via **branch-as-base merge** in workspace (M1), not cherry-pick. | **M1** |
| **ACP stdio harness** (`opencode-acp-harness.js`) — ux-spec/plan recommend primary; branch is CLI `opencode run` per turn only. | Long-lived process + session-scoped slash/MCP; matches Codex transport pattern. | **B** (primary) |
| **`REMODEX_OPENCODE_TRANSPORT=cli` fallback** — not in branch; plan requires it for CI/emergency. | CI cannot rely on full ACP; devs need escape hatch. | **B** |
| **`REMODEX_ENABLE_OPENCODE=1` gating** — branch always registers OpenCode provider in `bridge.js`; plan wants flag. | Codex-only users must not spawn `opencode` accidentally. | **B** |
| **`opencode` on PATH / binary discovery** — branch uses `resolveOpenCodeCommand`; no install probe in bridge status or `runtime/catalog.enabled`. | Clear setup errors on fresh Mac. | **B** |
| **`thread-ownership-store.js` durable persistence** — branch keeps `threads` in memory Map; restart loses routing. | Resume OpenCode thread after bridge restart fails. | **A** / **B** (PR #5 in plan) |
| **`project-registry.js` + `known-projects.json`** — on branch, not main; main has `project-handler` for listDirectory only. | Project picker cwd metadata for multi-harness threads. | **A** (port, Codex paths) |
| **Router before `codex-desktop-refresher` / rollout mirror** — OpenCode threads must not trigger Codex.app handoff (architecture invariant); not enforced on main. | Wrong desktop focus or corrupted mirror state. | **A** |
| **Multi-provider shutdown** — `runtimeProviderRouter.shutdown()` on branch; must kill OpenCode children on relay disconnect. | Zombie `opencode` processes. | **B** |
| **launchd / `macos-launch-agent.js` env** — must pass `PATH`, `REMODEX_*`, OpenCode-related vars to daemon bridge. | Works in terminal, fails as service. | **B** |
| **Multi-provider memory** — separate caches (models 60s, sessions, turns); no unified eviction policy. | Memory growth on long-running bridge. | **post-v1** |
| **`CODEX_ENDPOINT` WS vs stdio** — Codex can use remote endpoint; OpenCode has no equivalent in Remodex. | Multi-Mac / remote dev workflows asymmetry. | **post-v1** |
| **Bridge status surface** — include active harness, OpenCode version, transport mode (cli/acp). | Support/debug without logs. | **B** |

---

## 4. iOS app

| Gap | Why it matters | Slice |
|-----|----------------|-------|
| **`CodexModelOption.modelProvider` + `selectionKey`** — main uses bare `id`; branch has both. | Colliding model ids across harnesses. | **B** |
| **`CodexService+RuntimeConfig` provider helpers** — branch; absent on main. | Grouping, strict policy, default keys. | **B** |
| **Fetch `runtime/catalog`** and loading flags in composer state — not implemented. | Agent submenu empty without catalog RPC. | **A** / **B** |
| **Persist `SessionRuntimeSelection`** (UserDefaults) — branch persists selection keys partially; no unified type. | App relaunch loses runtime/agent choice. | **A** |
| **`CodexThread.opencodeAgent` (or equivalent)** — not decoded on main or branch. | Thread affinity incomplete for agent row. | **B** |
| **Keychain vs UserDefaults** for runtime prefs — no Keychain migration for harness secrets (OpenCode may use separate auth on Mac). | Security model unclear for provider tokens. | **post-v1** |
| **Offline / relay disconnected** — picker should not promise OpenCode models; queued sends need harness-aware errors. | Confusing UX on airplane mode. | **A** (disable) / **B** (errors) |
| **UI when provider unavailable** — disable runtime row or show “Install OpenCode on Mac” with bridge hint. | Support burden. | **A** / **B** |
| **`ios-app-compatibility.js` gate** — may need bump when new RPC fields required. | Old app against new bridge breaks silently. | **B** |
| **`SessionRuntimeSelectionTests.swift`** — listed in ux-spec; not present. | Encoding/RPC projection regressions. | **A** |
| **Git writer / commit model defaults** — settings card on main is Codex-only; must not apply OpenCode slugs to git writer. | Wrong model for PR/commit generation. | **B** |

---

## 5. Security / pairing

| Gap | Why it matters | Slice |
|-----|----------------|-------|
| **E2E relay + `secure-transport.js` unchanged** — correct per non-goals; verify no plaintext provider fields in logs. | Regression would break trust story. | **A** (audit) |
| **`--dangerously-skip-permissions` mapping** — branch ties to Remodex `approvalPolicy`; must align with iOS access mode defaults (safe default). | Over-permissive OpenCode on phone-driven turns. | **B** |
| **OpenCode inherits Mac user secrets / filesystem** — document in README; same as Codex subprocess trust. | Users must understand host trust boundary. | **B** (docs) |
| **Per-provider auth trust model** — Codex uses OpenAI login; OpenCode uses its own provider API keys on Mac; no bridge sanitization like `account/read`. | Phone cannot show accurate “connected” for Anthropic via OpenCode. | **post-v1** |
| **Pairing flow** — unchanged; re-run `relay/simulated-pairing-reconnect.test.js` after router (deleted on branch). | Multi-agent must not break reconnect. | **A** (test restore) |

---

## 6. Git / workspace

| Gap | Why it matters | Slice |
|-----|----------------|-------|
| **`cwd` / project binding on `thread/start`** — main has `CodexThreadStartProjectBinding`; must pass same `cwd` to OpenCode `--dir`. | Wrong repo checked out for OpenCode turn. | **B** |
| **Per-provider cwd in ownership store** — branch stores cwd on thread object; not durable across restart. | Resume in wrong directory. | **A** / **B** |
| **Git/workspace/desktop handlers** — stay bridge-local (good); must not require Codex thread id for OpenCode-owned threads. | Git panel breaks when `codex.send` assumed. | **D** (audit) |
| **OpenCode project root vs Codex home** — OpenCode sessions live under OpenCode config dirs; registry uses `~/.codex/remodex/known-projects.json`. | Two sources of truth for “project”. | **B** |
| **Worktree / fork threads** — `thread/fork` Codex-only; OpenCode thread fork undefined. | Feature gap for OpenCode chats. | **post-v1** |

---

## 7. Tools / MCP / skills / slash

| Gap | Why it matters | Slice |
|-----|----------------|-------|
| **Parity matrix doc** (bridge README) — Slice D deliverable; does not exist. | Team forgets what works per runtime. | **D** |
| **Remodex slash / skill mentions** — handled in Codex path + JSONL history; OpenCode `run` single shot may not load same skill context. | `$skill` mentions noop or error on OpenCode. | **D** |
| **MCP settings UX on iOS** — assumes Codex app-server MCP; OpenCode MCP is inside OpenCode process (ACP session config). | Settings UI misleading. | **D** / **post-v1** |
| **Bridge-local handlers** (git, workspace, voice, pet, desktop) — should keep working; audit that router returns `handled` vs forwarding OpenCode threads to Codex. | Subtle breakage when router matures. | **D** |
| **Subagent / collaboration UI** — Codex `collaborationMode`, subagent views; OpenCode has its own agent/subagent model. | Timeline cards wrong for OpenCode. | **D** / **post-v1** |
| **Voice mode** — `voice-handler` uses `sendCodexRequest`; not routed to OpenCode. | Voice stays Codex-only. | **post-v1** |
| **Terminal / SSH surfaces** — Codex thread assumptions; OpenCode terminal via ACP is stub. | Feature asymmetry. | **post-v1** |

---

## 8. Modes

| Gap | Why it matters | Slice |
|-----|----------------|-------|
| **Codex Plan mode (`collaborationMode`)** — iOS sends on `turn/start` / `turn/steer`; stripped for Codex forward only when router exists; OpenCode must ignore. | Double-plan semantics if conflated with OpenCode plan agent. | **B** (ignore) / **D** (copy) |
| **OpenCode build vs plan agent** — CLI `opencode agent list` not wired; ACP “session modes” not implemented upstream. | Composer agent row non-functional without B. | **B** |
| **Intelligence / `effort` mapping for OpenCode** — branch sets `supportedReasoningEfforts: []`; Slice C needs catalog enrichment. | Empty or fake Intelligence row. | **C** |
| **Fast mode / `serviceTier`** — branch `supportsFastMode: false` for OpenCode; Slice C. | Speed submenu should hide, not show broken fast. | **C** |
| **Access mode / sandbox / approval policy** — iOS `CodexAccessMode` maps to Codex; OpenCode uses skip-permissions flag only. | “Read-only” on phone may not match OpenCode behavior. | **D** / **post-v1** |
| **Composer “fast” bolt in + menu** — Codex-only paths in `ComposerBottomBar`; gate on `supportsFastMode` per runtime. | UI shows fast for OpenCode incorrectly today on branch if model list wrong. | **C** |

---

## 9. Session / history

| Gap | Why it matters | Slice |
|-----|----------------|-------|
| **Merged `thread/list`** — branch merges Codex + OpenCode; main single source. | Sidebar shows only Codex threads. | **B** |
| **Stable sort + dedupe rules** for merged list — branch merges; edge cases (archived, cursor pagination) need tests. | Duplicate or missing threads. | **B** |
| **Synthetic IDs (`opencode-thread-*`) vs `ses_*`** — branch adopts session ids; mapping must survive ownership store. | Resume by wrong id breaks harness. | **B** / **A** |
| **Rollout JSONL mirror / `session-jsonl-history.js`** — Codex-only; OpenCode history via `opencode export`. | `thread/turns/list` empty without export path. | **B** |
| **Resume after bridge kill** — in-memory Maps lost; ownership file not implemented. | “Thread unavailable” after Mac sleep/restart. | **A** |
| **OpenCode `session/load` ACP gap** — README: history not restored. | Full history parity deferred. | **post-v1** |
| **Thread archive/unarchive** — routed on branch; verify iOS UI syncs for OpenCode threads. | Archived threads reappear. | **B** |

---

## 10. Testing / ops

| Gap | Why it matters | Slice |
|-----|----------------|-------|
| **Nothing merged to main yet** — all harness work is reference branch / scratch. | Kartik works in opencode workspace until upstream slices land. | **A**+ |
| **Device E2E checklist** — one Codex + one OpenCode thread, pairing unchanged, streaming acceptable beta. | Required before PR claim. | **B** |
| **CI: OpenCode not installed** — tests must mock spawn; flag off path identical to today. | Upstream CI cannot require `opencode` binary. | **A** / **B** |
| **Restore `relay/simulated-pairing-reconnect.test.js`** — present on main, removed on branch. | Regressions in pairing during router work. | **A** |
| **ACP mocked stdio tests** — planned for harness PR; only CLI tests on branch today. | ACP adapter unproven. | **B** |
| **iOS runtime menu snapshots** — ux-spec mentions; not added. | UI regressions in picker hierarchy. | **A** / **B** |
| **OpenCode min version pin** — docs only in plan risks table. | CLI flag drift breaks parse. | **B** |
| **Branch bitrot** — 197-file branch vs fresh `main`; cherry-pick strategy required. | Wrong merge breaks main tests. | **process** |
| **389 bridge tests on branch vs main** — run on each slice PR. | Confidence per PR. | **each PR** |

---

## 11. Desktop / macOS

| Gap | Why it matters | Slice |
|-----|----------------|-------|
| **`codex-desktop-refresher.js` + AppleScript** — OpenCode threads must be excluded from Codex.app refresh/handoff. | Opens wrong app for OpenCode chat. | **A** |
| **`desktop-ipc-action-follower`** — follows Codex desktop IPC; irrelevant for OpenCode. | No OpenCode desktop mirror today. | **post-v1** |
| **OpenCode desktop / menu bar** — non-goal for v1 (`opencode serve` / dpcode pattern). | No Remodex-driven OpenCode.app UX. | **post-v1** |
| **`REMODEX_CODEX_ENDPOINT` / Codex.app path** — bridge prefs Codex-specific; document no OpenCode equivalent. | Config confusion. | **B** (docs) |

---

## 12. Future

| Gap | Why it matters | Slice |
|-----|----------------|-------|
| **Cursor, Gemini, pi, Claude Code runtimes** — ux-spec non-goals. | Scope control. | **post-v1** |
| **`opencode serve` HTTP + SDK (dpcode)** — architecture defers Option C. | Heavier daemon lifecycle. | **post-v1** |
| **litter Rust mobile core** — non-goal. | Different stack. | **post-v1** |
| **Android** — shares relay concept; no OpenCode picker unless iOS RPC parity ported. | Platform expansion. | **post-v1** |
| **Self-hosted / custom relay** — unchanged; multi-agent adds no new relay methods. | Ops for teams. | **post-v1** |
| **More providers via `ProviderHarness`** — extensibility after OpenCode proves router. | Long-term architecture. | **post-v1** |
| **OpenCode custom agent editor on iOS** — non-goal; pick from list only. | UX scope. | **post-v1** |
| **ACP streaming Phase 6** — remove beta when `session/update` lands upstream. | True composer parity. | **post-v1** |

---

## Branch vs main vs target (summary)

| Area | `main` | `codex/add-opencode-provider` branch | Target (ux-spec) |
|------|--------|-----------------------------------|------------------|
| Router + OpenCode | No | Yes (CLI only) | ACP primary + CLI fallback |
| Composer runtime row | No | No | Yes (Slice A) |
| OpenCode agent row | No | No | Yes (Slice B) |
| `runtime/catalog` | No | No | Yes |
| Thread ownership file | No | In-memory only | Durable (Slice A/5) |
| `REMODEX_ENABLE_OPENCODE` | N/A | No (always on) | Yes |
| Provider-grouped models | No | Yes | Yes (Slice B) |
| Reasoning/fast OpenCode | N/A | Empty/false | Slice C |
| Slash/skills matrix | No | No | Slice D |

---

## Maintainer / process (easy to forget)

- **Workspace only** until M5 device sign-off; then upstream PR is Kartik’s call.
- **Branch-as-base** holistic integration — not cherry-pick onto `main`.
- **ACP primary, CLI fallback** — catalog reflects transport and gaps (no silent CLI-only features).
- Parity matrix must be updated when closing gaps — no **enabled** without proof.
