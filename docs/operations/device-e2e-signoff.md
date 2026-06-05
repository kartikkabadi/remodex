# Device E2E sign-off status

**Status:** **Signed off** on `main` (OpenCode core parity on physical iPhone + Mac).  
**Canonical base commit:** `12542248efa6b9d99b4d49b177e2b41f45961939` (`1254224`)  
**Last updated:** 2026-06-05

## Why this file exists

Agents and docs repeatedly claimed device E2E was **not done** because:

1. [`device-e2e-evidence-2026-06-02.md`](device-e2e-evidence-2026-06-02.md) was written by an automated session **without a paired iPhone** and says steps 8a–8e are blocked — that file is **not** product sign-off.
2. Commit `98a64d5` (`chore: OpenCode device E2E checklist and parity sign-off`, Kartik, 2026-06-02) recorded sign-off and promoted parity + PR8 catalog flip.
3. Commit `4e3527c` (`chore(remodex-opencode): sync OpenCode stack to remodex da26c30`, 2026-06-03) **reverted** `supportsDesktopHandoff` to `false` while syncing from upstream — re-introducing a “blocked until 8a–8e” message **after** sign-off.
4. Later docs (master integration plan, Grok execute-plan, kstack STATUS) inherited the reverted state and never recorded completion.

**Product owner (Kartik) confirmed:** device E2E on current `main` is complete. This file is the authoritative status for agents.

## Verified in repository (automated)

| Check | Result | Evidence |
|-------|--------|----------|
| `main` tip | `1254224` | `git rev-parse main` |
| Bridge tests | **604/604 pass** | `cd repos/remodex-opencode/phodex-bridge && npm test` (2026-06-05) |
| OpenCode handoff RPC | Env-gated (`REMODEX_OPENCODE_HANDOFF=1`) | `opencode-handoff.js`, `opencode-handoff.test.js` |
| Codex regression gate | `REMODEX_DISABLE_OPENCODE=1` tests in tree | `opencode-regression.test.js` |

## PR8 / catalog promotion

After sign-off, OpenCode **`supportsDesktopHandoff`** in `provider-capabilities.js` should be **`true`** (catalog advertises handoff; RPC still requires `REMODEX_OPENCODE_HANDOFF=1` on the Mac). This matches commit `98a64d5` and was restored in the 2026-06-05 doc/code alignment.

## Supersedes

- [`device-e2e-evidence-2026-06-02.md`](device-e2e-evidence-2026-06-02.md) — incomplete agent run; historical only.
- Stale “device E2E blocked” lines in `AGENTS.md`, recovery docs, and execute-plan gates that treat E2E as incomplete on `main`.

## Still requires human / external verification

These were **not** re-run in the 2026-06-05 alignment session:

- Formal O0–O17 checklist rows with device model, relay uptime >10 min, and screen recording (evidence bar in [device-e2e-opencode.md](device-e2e-opencode.md)).
- Whether every execute-plan follow-on PR (messaging hardening, branding assets, PR-16 bundle) is required before upstream PRs — **separate** from core device E2E sign-off.
- Legal clearance for branded provider assets (PR-12/15) — still blocked independent of E2E.
- Full `xcodebuild test` green (simulator unit tests are explicitly **not** a device E2E gate).

## Agent read order

1. This file — E2E status on `main`
2. [device-e2e-opencode.md](device-e2e-opencode.md) — checklist reference
3. [release-compatibility.md](release-compatibility.md) — parity matrix
4. [AGENTS.md](../../AGENTS.md) — non-negotiables
