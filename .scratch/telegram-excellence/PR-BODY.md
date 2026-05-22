## Summary

This branch elevates **Remodex Telegram** to a **co-equal Client Surface** — same local Mac bridge, Codex runtime, thread/turn semantics, and trust model as the Native Remodex App, expressed through conversation-first chat UX (streaming bubble, steer-while-running, control hubs). It is **not** an offline fallback, notification-only channel, or degraded Mini App.

Highlights:

- **Conversation mode:** typing indicator, single live assistant bubble (`editMessageText` with coalescing), no keyboards on implicit Codex input or finalized replies (`telegram-reply-policy.js`, `telegram-streaming-bubble.js`).
- **Control mode:** `/menu`, `/status`, approvals, pickers, and structured navigation unchanged in spirit but cleaner separation from conversation traffic.
- **Architecture split:** new coordinator / projector / outbound queue / notification policy modules so `telegram-adapter.js` orchestrates instead of owning every concern.
- **Bridge integration:** relay client naming and lifecycle hooks in `bridge.js` when Telegram is enabled.
- **Docs & language:** `CONTEXT.md`, `Docs/telegram-ux.md`, and README Telegram section align product vocabulary (Co-equal Client Surface, Secondary Client ≠ lower priority).
- **611** bridge unit tests pass locally; CI runs `npm ci` + `npm test` in `phodex-bridge` on bridge path changes (`.github/workflows/bridge-check.yml`).

## Test plan

- [ ] `cd phodex-bridge && REMODEX_SKIP_CODEX_BOOTSTRAP=1 npm test` → **611 pass**
- [ ] Stop any existing bridge poller (`remodex stop`; confirm `launchctl list | grep com.remodex.bridge` empty)
- [ ] Foreground branch bridge: `cd phodex-bridge && npm start` (uses `~/.remodex/daemon-config.json` for relay + Telegram token)
- [ ] In Telegram DM: plain text → Codex turn; observe typing + **one** streaming bubble; `/stop` interrupts
- [ ] Steer while running: send second plain-text message during active turn → `turn/steer`; `/queue` shows steer history
- [ ] Control mode: `/menu`, `/status`, `/threads`, approval buttons on dangerous actions
- [ ] Post-turn: file-change summary message when diffs exist (`telegram-file-change-summary.js`)
- [ ] `/activity` shows collapsed tool/thinking detail without polluting the stream
- [ ] Re-link sanity: `node bin/remodex.js telegram status` shows linked chat; `/link` only if testing fresh pairing
- [ ] Restart bridge: linked session + active thread survive (`telegram-session.json` unchanged semantics)
- [ ] Confirm only **one** `getUpdates` consumer (no duplicate-message / 409 conflicts)

## Review guide (hotspots)

Read in this order for fastest context:

| Area | Files | What to verify |
|------|--------|----------------|
| Product contract | `CONTEXT.md`, `Docs/telegram-ux.md`, `README.md` (Telegram section) | Co-equal surface language; conversation vs control mode rules |
| Bridge wiring | `phodex-bridge/src/bridge.js` | Telegram adapter lifecycle, relay client identity, turn/event fan-in |
| Orchestration | `phodex-bridge/src/telegram-adapter.js` | Update routing, steer queue, turn-less guards, policy hooks |
| New modules | `telegram-bridge-coordinator.js`, `telegram-timeline-projector.js`, `telegram-codex-envelope.js` | Separation of concerns; no duplicated iOS timeline logic in adapter |
| UX policies | `telegram-reply-policy.js`, `telegram-notification-policy.js`, `telegram-streaming-bubble.js` | When keyboards/markup appear; streaming coalesce; message-not-modified tolerance |
| Delivery | `telegram-outbound-queue.js`, `telegram-bot-api-client.js` | Flood control, `deleteWebhook` on start, edit/send error handling |
| Summaries | `telegram-file-change-summary.js`, `telegram-renderer.js` | Post-turn diff summary; no secrets in rendered help |
| Commands | `telegram-command-catalog.js`, `telegram-keyboards.js` | Slash/callback parity with catalog |
| Tests | `phodex-bridge/test/telegram-*.test.js` | Behavior locked by unit tests; adapter tests are the integration surface |

**Deep dives (if time is limited):**

1. `telegram-streaming-bubble.test.js` + `telegram-reply-policy.test.js` — conversation-mode invariants.
2. `telegram-adapter.test.js` — end-to-end handler behavior (largest delta).
3. `telegram-timeline-projector.test.js` — event → Telegram presentation mapping.

## What NOT to review

- `.scratch/**` (local planning artifacts)
- `.sisyphus/**`, `.cursor/debug-*.log` (agent/session noise)
- Unrelated iOS / Xcode targets (no mobile code in this PR)
- `phodex-bridge/test/codex-cli-bootstrap.test.js` — trivial env skip unless bootstrap behavior changed
- Full line-by-line `telegram-adapter.test.js` — treat as regression harness; spot-check new cases only
- Operator machine paths in an existing `~/Library/LaunchAgents/com.remodex.bridge.plist` on the author's Mac (not shipped by the PR)

## Notes for Emanuel

- **Telegram is first-class**, not a fallback when the Native App is away. Wording in CONTEXT/README is intentional for downstream agents and contributors.
- Long-polling: `getUpdates` uses Telegram `timeout: 20`; `REMODEX_TELEGRAM_POLL_INTERVAL_MS` only spaces idle loops between rounds.
- Private DM only — linked-chat ACL assumes one trusted DM per Mac install.
- Pro gating unchanged; local dev can use `REMODEX_TELEGRAM_PRO_ENTITLED=1` or `telegramProEntitled` in daemon config.
