# Device E2E checklist (Remodex + OpenCode)

Use this after bridge and iOS changes land. Run Mac steps in **Terminal.app** (not a Cursor/agent shell) so relay `:9000` is not killed by shell `EXIT` traps.

## Prerequisites

| Check | Command / action | Pass |
|-------|------------------|------|
| 0 | Single listener on relay port | `lsof -nP -iTCP:9000 -sTCP:LISTEN` shows **one** owner |
| 0b | Launchd bridge not fighting dev script | `launchctl bootout "gui/$(id -u)/com.remodex.bridge"` if using `run-local-remodex.sh` |

## Mac stack

| Step | Check | Pass criterion |
|------|--------|----------------|
| 1 | Start stack | From `repos/remodex-opencode`: `./run-local-remodex.sh --hostname <LAN-IP>` **or** `./scripts/remodex-dev-pairing.sh <LAN-IP>` — tab stays open **≥10 min** |
| 2 | Health | `curl -sf http://127.0.0.1:9000/health` → OK |
| 2b | LAN reachability (strong) | Same from iPad Safari or second LAN host to `http://<LAN-IP>:9000/health` |
| 3 | E2EE smoke | `node phodex-bridge/scripts/test-relay-handshake.js ws://<LAN-IP>:9000/relay` → `OK serverHello` |

## iPad

| Step | Check | Pass criterion |
|------|--------|----------------|
| 4 | Forget + pair | Settings → **Forget device**; force-quit app; scan **fresh** QR **<5 min**; same Wi‑Fi |
| 5 | Transport vs state | If step 3 passes and iPad fails: log `qr_bootstrap` vs `trusted_reconnect`, relay URL vs QR. If step 3 fails: fix Mac transport before iOS work |

## OpenCode (after step 4)

| Step | Check | Pass criterion |
|------|--------|----------------|
| 6 | Catalog | `runtime/catalog` shows OpenCode enabled with agents; model list includes OpenCode models |
| 7 | Session | Start OpenCode thread, send prompt, receive streaming reply |
| 8 | Composer | Fork, slash commands, queue (if enabled), skills autocomplete match catalog flags |
| 8a | OpenCode slash | On OpenCode thread, `/` lists **dynamic** commands from bridge `command/list`; pick one and send |
| 8b | OpenCode skills | `$` autocomplete inserts a skill; turn completes |
| 8c | OpenCode handoff | With `REMODEX_OPENCODE_HANDOFF=1` on Mac, handoff succeeds; TUI session selected (`handoffMode: tui` preferred) |
| 8d | Rehydration | Stop/start bridge; resume same OpenCode thread; send another turn |
| 8e | Codex-only | `REMODEX_DISABLE_OPENCODE=1` — no OpenCode in catalog; Codex composer unchanged |

Full OpenCode parity sign-off (slash, skills, handoff, rehydration): [device-e2e-opencode.md](device-e2e-opencode.md). After **8a–8e** pass on physical iPhone + Mac, promote parity rows in [release-compatibility.md](release-compatibility.md) and flip `supportsDesktopHandoff` in `provider-capabilities.js` (PR8).

## Regression

| Step | Check | Pass criterion |
|------|--------|----------------|
| 9 | Bridge tests | `cd phodex-bridge && npm test` — all green |
| 10 | Codex-only | `REMODEX_DISABLE_OPENCODE=1` — existing Codex thread flow unchanged |

## Evidence bar (48h)

One paragraph: which step failed, `lsof` during failure, relay uptime >10 min Y/N, handshake mode after Forget.
