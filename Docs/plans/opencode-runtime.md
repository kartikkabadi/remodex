# OpenCode runtime — specification

**Branch:** `multi-agents/opencode` (fork `kartikkabadi/remodex`)  
**Tracer:** [#53](https://github.com/kartikkabadi/remodex/issues/53) · **PR:** [#54](https://github.com/kartikkabadi/remodex/pull/54)  
**ADR:** [001-opencode-runtime-shape.md](../adr/001-opencode-runtime-shape.md)  
**Status (living):** [opencode-runtime-status.md](./opencode-runtime-status.md)

## Mission

Ship OpenCode as a second agent runtime on the existing Remodex iOS + bridge stack: same relay pairing, same JSON-RPC contract, honest capability flags, and simulator/device QA before merge-ready language.

## Tier definitions

| Tier | Scope | Ship bar |
|------|--------|----------|
| **T1** | Bridge transport, spawn, SSE mapping, refusals, `initialize`, thread/turn core | Unit tests + policy gates |
| **T2** | iOS runtime detection, composer (model/variant/agent), Settings, sidebar logo, `agent/list`, binding persistence | Unit tests + **sim evidence** (PR #54 matrix) |
| **T3** | Slash extras, autocomplete, rich bus, transport split | Post-merge tracker issues (Wave 4) |

## Locked decisions (IDs)

| ID | Decision |
|----|----------|
| L1 | `REMODEX_PROVIDER=opencode` selects OpenCode transport |
| L2 | One `opencode serve` child per bridge; shared loopback server |
| L3 | Bindings file `~/.remodex/opencode-bindings.json` (mode 0600) |
| L4 | Codex-shaped JSON-RPC; no parallel iOS protocol |
| L5 | Refusals centralized in `opencode-runtime-policy.js` |
| L6 | `agent/list` maps OpenCode `GET /agent` to picker entries |
| L7 | `turn/start` passes agent + variant to `prompt_async` |
| L8 | iOS hides `/status` when connected runtime is OpenCode |
| L9 | Default relay bind `127.0.0.1`; LAN/Tailscale explicit |
| L10 | `./run-local-remodex.sh --opencode` sets provider on child bridge |
| L11 | Sim uses `PrivateOverrides.xcconfig` → `ws://127.0.0.1:9000/relay` |
| L12 | Subagents on this lane: **`composer-2.5` only** (never fast tier) |
| L13 | No second bridge terminal while launcher runs |
| L14 | `thread/name/set` → OpenCode session PATCH (not git-handler title) |
| L15 | ADR defers splitting `opencode-transport.js` |
| L16 | Physical iPhone matrix = Kartik **DEVICE_SIGNOFF** |
| L17 | T3 work tracked on fork issues, not blocking P0 merge |
| L18 | Do not push to `Emanuele-web04/remodex` without explicit ask |
| L19 | `npm test` in `phodex-bridge` required after bridge changes |
| L20 | Scoped `test_sim` filters only—no full UITest suite unless asked |
| L21 | Evidence under `.qa-screenshots/opencode-sim/` (gitignored) |
| L22 | Success tiers: P0_CODE → P0_DOCS → SIM_EVIDENCE → DEVICE_SIGNOFF → SHIP_WORDING |

## Implementation map (commits on branch)

Spec reference only—not a checkbox list.

| Area | Representative commits |
|------|-------------------------|
| Transport + tests | `3f696e17`, `39cc6313`, `0b5932e2` |
| Policy + provider switch | `2c68ee73`, `0e4830b8` |
| T1 completeness | `6864f930`, `e1e98b9e` |
| T2 bridge payloads | `de302d9f`, `3f9fab6c` |
| T2 iOS | `35677f6f`, `c8256249` |
| Launcher loopback + `--opencode` | `bf8e1f11` |

## Out of scope (T3 — see Wave 4 issues)

- OpenCode slash: `/fork`, `/compact`, `/review`
- Composer autocomplete parity
- Full EventV2 / rich bus alignment
- Optional `session-jsonl-history` cherry-pick from `codex/ipad-os`
- Refactor split of `opencode-transport.js`

## Related docs

- [opencode-local-dev.md](./opencode-local-dev.md) — relay profiles, pairing
- [opencode-sim-qa-runbook.md](./opencode-sim-qa-runbook.md) — simulator QA orchestration
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — contributor entry
