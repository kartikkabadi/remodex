# Device E2E evidence — 2026-06-02

> **Superseded.** This was an incomplete automated session (no paired iPhone).  
> **Authoritative status:** [device-e2e-signoff.md](device-e2e-signoff.md) — device E2E on `main` is signed off.

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

## Catalog / parity (historical snapshot — 2026-06-02)

> At the time of this automated run, hardware steps were not executed and catalog still had `supportsDesktopHandoff: false`. **Current `main` state:** see [device-e2e-signoff.md](device-e2e-signoff.md).

Until steps **8a–8e** pass on hardware *(superseded)*:

- `OPENCODE_CAPABILITIES.supportsDesktopHandoff` remains **`false`**
- Parity matrix: handoff **greyed**, MCP **greyed** ([release-compatibility.md](release-compatibility.md))

## Handoff promotion checklist (Kartik)

1. Mac: `export REMODEX_OPENCODE_HANDOFF=1`; start bridge (step 1).
2. iPhone: complete **8a–8e** in [device-e2e-checklist.md](device-e2e-checklist.md).
3. Record `handoffMode` + TUI session Y/N in [device-e2e-opencode.md](device-e2e-opencode.md) evidence bar.
4. Flip `supportsDesktopHandoff: true` in `provider-capabilities.js` and update parity matrix handoff row to **enabled**.