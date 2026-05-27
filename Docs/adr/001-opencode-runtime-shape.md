# ADR 001: OpenCode runtime shape

**Status:** Accepted (branch `multi-agents/opencode`)  
**Tracer:** [issue #53](https://github.com/kartikkabadi/remodex/issues/53)  
**PR:** [#54](https://github.com/kartikkabadi/remodex/pull/54)

## Context

Remodex’s iOS app speaks a Codex-shaped JSON-RPC protocol to `phodex-bridge`. OpenCode exposes a different surface (`opencode serve` over HTTP+SSE). We need a second runtime without forking the mobile client or duplicating timeline logic.

## Decision

1. **Single bridge process, provider switch.** `REMODEX_PROVIDER=opencode` (or `./run-local-remodex.sh --opencode`) selects `createOpenCodeTransport` instead of Codex transport. One relay + one bridge per dev session—no second `npm start` terminal.

2. **Monolithic transport adapter.** `phodex-bridge/src/opencode-transport.js` maps Codex-shaped methods to OpenCode HTTP routes and SSE bus events. Policy/refusals live in `opencode-runtime-policy.js`. **Do not split the transport file** until post-merge maintenance justifies it.

3. **One `opencode serve` per bridge.** All threads share one loopback child (`127.0.0.1`, ephemeral port). Per-thread workspace is `x-opencode-directory` on SSE and session APIs. Bindings persist in `~/.remodex/opencode-bindings.json`.

4. **Truthful capabilities.** `initialize` and `server/info` advertise OpenCode-only behavior so iOS gates composer menus, `/status`, ChatGPT auth, and rate-limit UI.

5. **Local relay default is loopback.** Relay listens on `127.0.0.1:9000` unless the operator opts into LAN or Tailscale profiles (see `Docs/plans/opencode-local-dev.md`).

## Consequences

- iOS changes are mostly runtime detection + composer/settings—not a second app target.
- Features that depend on Codex rollout, voice, steer, or desktop handoff are **refused** with stable error codes (see policy module).
- `thread/name/set` on OpenCode routes to OpenCode session PATCH, not the git sidecar title path (T1-8 gate).
- Simulator QA uses `PrivateOverrides.xcconfig` so the app targets `ws://127.0.0.1:9000/relay` while the relay stays on loopback.

## Refusal summary (transport + bridge)

| Area | Codex-only / refused on OpenCode |
|------|----------------------------------|
| Context | `thread/contextWindow/read` |
| Voice | `voice/transcribe`, `voice/resolveAuth` |
| Turn control | `turn/steer` |
| Desktop | `desktop/continueOnDesktop`, `desktop/continueOnMac` |
| Account | ChatGPT login/logout, `account/rateLimits/read` |
| Bridge sidecar | `thread/generateTitle`, AI git message/PR draft |
| iOS UX | `/status` slash hidden when connected runtime is OpenCode |

## Alternatives considered

- **Separate iOS target for OpenCode:** Rejected—duplicates timeline, pairing, and git UX.
- **WebSocket to OpenCode directly from phone:** Rejected—breaks relay pairing, trust, and single-bridge invariant.
- **Default `0.0.0.0` relay bind:** Rejected for OSS safety; explicit LAN/Tailscale profiles only.

## Deferred (not in this ADR)

- T3 slash commands (`/fork`, `/compact`, `/review`) on OpenCode
- Rich EventV2 bus parity, autocomplete
- Splitting `opencode-transport.js` into modules
