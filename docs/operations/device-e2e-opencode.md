# Device E2E — OpenCode parity sign-off

## Pre-flight (automated)

Before Kartik runs steps O0–O17 on device:

| Check | Requirement |
|-------|-------------|
| Git `main` | Meta workspace `remodex:opencode` on `main` — working tree **clean** (single git root; no nested `.git` under `repos/remodex-opencode/`). Requires commit **`4546c7b` or later** for iOS simulator build (slash-command cache compile fix). |
| Bridge tests | `cd repos/remodex-opencode/phodex-bridge && npm test` — **696/696** green |
| OpenCode suite | `cd repos/remodex-opencode/phodex-bridge && npm run test:opencode` — **283/283** green (CI gate on `opencode-*` touches) |
| Bridge coverage (optional) | `npm run test:coverage` — same re-run rule if **547/548** once. |
| iOS compile (simulator) | `cd repos/remodex-opencode/CodexMobile && xcodebuild -scheme CodexMobile -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO build` — **required** |
| iOS unit tests (`CodexMobileTests`) | **Not gating** device E2E. Simulator **build** is required; `xcodebuild test` may show **~147 failures** on clean `main` (queue/steer tests) — do not block Kartik sign-off on XCTest green. |

**Handoff vs PR8 (ordering):**

| Step | When |
|------|------|
| **O12** (toolbar “Continue on Desktop”) | **Unblocked** — catalog advertises `supportsDesktopHandoff: true`; verify on device with `REMODEX_OPENCODE_HANDOFF=1`. |
| **O13**, **O16** (handoff RPC + env-off regression) | Can run **before** PR8 with `REMODEX_OPENCODE_HANDOFF=1` on Mac — validates bridge RPC and error taxonomy without catalog advertisement. |
| **O14–O15** | After O13; O15 anytime on Codex-only thread |

**Environment (full checklist):**

| Variable | When |
|----------|------|
| *(unset)* `REMODEX_DISABLE_OPENCODE` | Default — OpenCode enabled (step O1) |
| `REMODEX_OPENCODE_HANDOFF=1` | Mac bridge: **O13/O16** RPC QA anytime; **O12/O14** UI/TUI after PR8 flip; required on operator Macs once handoff is promoted |
| `REMODEX_DISABLE_OPENCODE=1` | Codex regression only (step O17) |

**Start bridge (from remodex-opencode repo):**

```bash
cd repos/remodex-opencode
./run-local-remodex.sh --hostname <LAN-IP>
# or pairing helper if present in your checkout
```

Relay + bridge must stay up **≥10 min** (see [device-e2e-checklist.md](device-e2e-checklist.md)).

**Parity matrix:** [release-compatibility.md](release-compatibility.md) — promote rows only after this checklist passes.

---

Run this checklist **after** PR3 (slash), PR4 (skills), PR5/PR6 (handoff), and PR7 (regression tests) are merged. Use it to promote OpenCode rows in [release-compatibility.md](release-compatibility.md) from `partial` / `simulator-only` to `enabled`.

**Prerequisites:** Complete the transport and pairing steps in [device-e2e-checklist.md](device-e2e-checklist.md) (relay health, Forget + QR, `test-relay-handshake.js`).

## Mac bridge setup

| Step | Action | Pass |
|------|--------|------|
| O0 | Start stack in **Terminal.app** | `./run-local-remodex.sh --hostname <LAN-IP>` or `./scripts/remodex-dev-pairing.sh <LAN-IP>` — relay stays up **≥10 min** |
| O1 | OpenCode enabled (default) | Do **not** set `REMODEX_DISABLE_OPENCODE=1` |
| O2 | Handoff env for production QA | `export REMODEX_OPENCODE_HANDOFF=1` before starting the bridge (required for `desktop/continueOpenCode`; catalog advertises handoff after PR8) |
| O3 | Bridge tests | `cd repos/remodex-opencode/phodex-bridge && npm test` — all green |

## iPhone — catalog and session

| Step | Check | Pass criterion |
|------|--------|----------------|
| O4 | `runtime/catalog` | OpenCode runtime `enabled: true`, agents listed, `capabilities.supportsSlashCommands` true; `supportsDesktopHandoff` false until step **8c** passes |
| O5 | Model picker | Codex and OpenCode groups; select OpenCode model; agent submenu visible |
| O6 | New thread + turn | Send prompt; streaming text and tool cards render; Stop works mid-turn |
| **O6b** | Permission sheet | Tool turn triggers OpenCode permission sheet < 3s; Allow now / Allow always / Deny all work; turn resumes or fails clearly |
| O7 | Bridge restart | Stop/start bridge; resume same OpenCode thread; send another turn (rehydration) |

## Composer parity (PR3 / PR4)

| Step | Check | Pass criterion |
|------|--------|----------------|
| O8 | Slash commands | On OpenCode thread, `/` shows commands from bridge `command/list` (not Codex-only enum); pick a command and send |
| O9 | Skills | `$` autocomplete lists merged skills when bridge returns data; insert skill and send turn |
| O10 | Greyed controls | Voice and Plan hidden/greyed per catalog; fork visible and works if `supportsFork` true |
| O11 | Queue | Draft queue works on OpenCode thread; steer remains greyed (`supportsSteer: false`) |

## Desktop handoff (PR5 / PR6)

| Step | Check | Pass criterion |
|------|--------|----------------|
| O12 | Toolbar / composer | “Continue on Desktop” visible on OpenCode thread when catalog `supportsDesktopHandoff` is true |
| O13 | Handoff RPC | Tap handoff with `REMODEX_OPENCODE_HANDOFF=1` on Mac; success payload includes `handoffMode` (`tui` preferred) and `instructions` |
| O14 | TUI selection | Terminal OpenCode TUI shows correct session after handoff (or documented fallback: `tui_only` / `desktop_app` with manual pick) |
| O15 | Wrong provider | Handoff hidden or errors on Codex-only thread (no `desktop/continueOpenCode` on Codex path) |
| O16 | Env off regression | Unset `REMODEX_OPENCODE_HANDOFF`; forced RPC returns `opencode_handoff_disabled` (no silent success) |

## Codex regression

| Step | Check | Pass criterion |
|------|--------|----------------|
| O17 | Codex-only bridge | `REMODEX_DISABLE_OPENCODE=1` — existing Codex thread flow unchanged; OpenCode unavailable banner if user had OpenCode threads |

## Evidence bar (sign-off)

Record in PR or release notes:

1. Device model + iOS build; Mac bridge commit SHA.
2. `lsof -nP -iTCP:9000 -sTCP:LISTEN` during successful run (single listener).
3. Relay uptime >10 min: Y/N.
4. Handoff: `handoffMode` observed; TUI session selected Y/N; screenshot or short screen recording link.
5. Any failed step number + first error string (relay vs catalog vs composer).

When all steps pass, update [release-compatibility.md](release-compatibility.md) parity matrix and ship with `REMODEX_OPENCODE_HANDOFF=1` on operator Mac bridges that offer OpenCode handoff.

---

## WP-15 device sign-off checklist (G4 — Kartik iPhone)

| Step | Check | Evidence to capture |
|------|--------|---------------------|
| O0 | Bridge + relay ≥10 min | Terminal screenshot + `lsof` |
| O1 | OpenCode enabled (no `REMODEX_DISABLE_OPENCODE`) | Settings/runtime catalog |
| O2 | `REMODEX_OPENCODE_HANDOFF=1` on Mac | `launchctl`/`run-local-remodex` env |
| O3 | 696/696 + 283/283 automated | CI log or local run |
| O4 | `runtime/catalog` OpenCode enabled | Screenshot |
| O5 | Model picker + All Models sheet | Find model beyond 120 cap |
| O6 | Streaming + Stop mid-turn | Screen recording |
| **O6b** | Permission sheet UX | Allow now / always / deny |
| O7 | Bridge restart rehydration | Same thread resumes |
| O8 | Slash commands | `/` picker |
| O9 | Skills `$` → SKILL.md files | Multi-skill turn |
| **O9b** | Plugin `@` N/A (DoD 13) | On OpenCode thread, `@` autocomplete does **not** offer Codex `plugin/list` entries — greyed/hidden per `runtimeModelProviderForTurn === opencode`; document N/A in sign-off notes |
| O10 | Greyed voice/plan; fork if enabled | Screenshot |
| O11 | Queue works; steer greyed | Screenshot |
| O12 | Continue on Desktop visible | Screenshot |
| O13 | Handoff RPC success | `handoffMode` in payload |
| O14 | TUI session selected | Screenshot |
| O15 | Codex thread blocks handoff | Error/hidden |
| O16 | Handoff env-off regression | `opencode_handoff_disabled` |
| O17 | `REMODEX_DISABLE_OPENCODE=1` Codex regression | Screenshot |

**Rollback smoke on device (optional but recommended):**

| Flag | Expected |
|------|----------|
| `REMODEX_OPENCODE_PERMISSIONS_UI=0` | Auto-deny < 30s |
| `REMODEX_OPENCODE_SSE_RECONNECT=0` | Turn completes via poll |
| `REMODEX_OPENCODE_ATTACHMENTS=0` | Image button greyed |
| `REMODEX_DISABLE_OPENCODE=1` | O17 pass |