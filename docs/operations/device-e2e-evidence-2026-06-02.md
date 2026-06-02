# Device E2E evidence — 2026-06-02

Automated runner: Cursor agent (no paired iPhone in this session).

## Automated (pass)

| Step | Result |
|------|--------|
| 9 Bridge tests | `cd repos/remodex-opencode/phodex-bridge && npm test` — **all green** |
| Git `repos/remodex-opencode` | Repaired: standalone repo with `origin` → `github.com/Emanuele-web04/remodex`, local changes on `main` |

## Mac stack (not run — relay down)

| Step | Result |
|------|--------|
| 0 `lsof :9000` | No listener |
| 1–3 Stack / health / handshake | **Skipped** — start `./run-local-remodex.sh --hostname <LAN-IP>` in Terminal.app with `export REMODEX_OPENCODE_HANDOFF=1` for handoff QA |
| 8a–8e iPhone checks | **Blocked** — requires physical iPhone + paired QR |

## Catalog / parity (honest state)

Until steps **8a–8e** pass on hardware:

- `OPENCODE_CAPABILITIES.supportsDesktopHandoff` remains **`false`**
- Parity matrix: handoff **greyed**, MCP **greyed** ([release-compatibility.md](release-compatibility.md))

## Handoff promotion checklist (Kartik)

1. Mac: `export REMODEX_OPENCODE_HANDOFF=1`; start bridge (step 1).
2. iPhone: complete **8a–8e** in [device-e2e-checklist.md](device-e2e-checklist.md).
3. Record `handoffMode` + TUI session Y/N in [device-e2e-opencode.md](device-e2e-opencode.md) evidence bar.
4. Flip `supportsDesktopHandoff: true` in `provider-capabilities.js` and update parity matrix handoff row to **enabled**.