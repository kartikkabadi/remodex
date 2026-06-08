# TestFlight beta runbook — OpenCode discovery gate (O18–O20)

Manual evidence gate **before PR 7 stage 3** (handoff production-default-on). Requires physical **iPhone + Mac** on the same LAN (iPad A–H optional, non-blocking).

## Pre-flight (automated)

| Check | Requirement |
|-------|-------------|
| Git branch | `brownfield/4a40fcfa-5-discovery-hardening` or later merge tip |
| Bridge tests | `cd repos/remodex-opencode/phodex-bridge && npm test` — **778/778** green |
| OpenCode suite | `npm run test:opencode` — **352/352** green |
| iOS compile (simulator) | `xcodebuild -scheme CodexMobile -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO build` |

## Mac bridge setup

```bash
cd repos/remodex-opencode
# Discovery ON: iOS sends discoverOpenCodeSessions/Projects by default.
# Mac env may remain unset; env =0 hard-kills, env =1 forces on.
./run-local-remodex.sh --hostname <LAN-IP>
```

| Variable | When |
|----------|------|
| *(unset)* `REMODEX_DISABLE_OPENCODE` | Default — OpenCode enabled |
| `REMODEX_OPENCODE_DISCOVER_SESSIONS=1` | Optional Mac override for O18 (client-true is default) |
| `REMODEX_OPENCODE_DISCOVER_PROJECTS=1` | Optional Mac override for O19 |
| `REMODEX_DISABLE_OPENCODE=1` | O20 / O17 Codex regression only |

Relay + bridge must stay up **≥10 min** during capture.

---

## O18 — Mac-started OpenCode session on iPhone

| Field | Capture |
|-------|---------|
| **Device** | iPhone model + iOS build; Mac bridge commit SHA |
| **Mac action** | Start session via `opencode` CLI/TUI in known project folder |
| **Warm path** | Sidebar screenshot ≤10s after Mac session visible in TUI |
| **Cold path** | If `opencode serve` idle >10 min: first poll <12s, fresh row on second poll ≤10s |
| **Row shape** | `modelProvider: opencode`, title, project group from `cwd`, ID `opencode-session-*` |
| **Pre-adopt guard** | No composer history until tap; no auto `turn/start` |
| **Bridge log** | `thread_list_wall_ms` with `codexMs` + `opencodeMs`; p95 cache miss <8s over 5 min |
| **materialization_blocked** | `thread/list` meta `materializationBlocked` (iOS sync log or bridge `opencode_list_threads_filtered`) — expect **0** on clean pairing |

### O18b — Adopt-on-open

| Field | Capture |
|-------|---------|
| **Tap** | Discovered row → `thread/resume` succeeds, history loads |
| **Turn** | Send prompt after adopt — succeeds |
| **Idempotency** | Second open same row — no duplicate sidebar entry |

### O18c — Pre-adopt turn blocked (optional)

| Field | Capture |
|-------|---------|
| **Negative** | Debug `turn/start` before tap → `thread_not_found` |

---

## O19 — OpenCode projects in picker

| Field | Capture |
|-------|---------|
| **Mac state** | OpenCode workspace folder **not** yet in `~/.codex/remodex/known-projects.json` |
| **Picker** | Within **two** `thread/list` cycles, iPhone project picker shows folder |
| **Registry** | `known-projects.json` mode `600` (`ls -l ~/.codex/remodex/known-projects.json`) |
| **Bridge log** | `opencode_discover_on_list` or debounced project discover (non-blocking) |

---

## O20 — Discovery flags off regression

| Field | Capture |
|-------|---------|
| **Mac env** | Unset or `0` both `REMODEX_OPENCODE_DISCOVER_SESSIONS` and `REMODEX_OPENCODE_DISCOVER_PROJECTS`; restart bridge |
| **iOS** | Disable external discovery in app settings (or verify client false path) |
| **Expected** | Mac-started sessions **not** listed; picker unchanged from pre-discover baseline |
| **Codex regression** | `REMODEX_DISABLE_OPENCODE=1` still yields Codex-only (O17) |

---

## Evidence bundle (attach to PR / release notes)

1. Device model + iOS build; Mac bridge commit SHA.
2. `lsof -nP -iTCP:9000 -sTCP:LISTEN` — single listener during successful run.
3. Relay uptime >10 min: **Y/N**.
4. O18 warm screenshot + `thread_list_wall_ms` log excerpt.
5. O18b screen recording (tap → adopt → turn).
6. O19 picker screenshot + `known-projects.json` permissions.
7. O20 screenshot (no external rows).
8. Any failed step number + first error string (relay vs catalog vs composer).

When O18–O20 pass, update [release-compatibility.md](release-compatibility.md) external-discovery rows and proceed to PR 7 stage 3.