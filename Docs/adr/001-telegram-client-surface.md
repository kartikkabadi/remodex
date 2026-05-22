# ADR 001: Telegram as a Client Surface

**Status:** Accepted (branch `feat/telegram-bridge`)  
**Date:** 2026-05-20  
**Context:** Remodex ships multiple clients on one Mac bridge — Native iOS (relay E2EE), Telegram (Bot API long-poll), future Android relay.

## Decision

Treat **Remodex Telegram** as a **co-equal Client Surface** for remote Codex control:

- Same Codex RPC and trust model as iOS
- Conversation-first UX (streaming bubble, collapsed tool noise)
- Control-mode hubs for structured actions (git, threads, approvals)

“Secondary Client” in domain language means **lower rendering bandwidth**, not lower product priority.

## Pairing

| Concern | Approach |
|---------|----------|
| Trust | Short-lived `/link <code>` from `remodex telegram link` on Mac |
| Scope | **Private DM only** — no groups/supergroups |
| Storage | `telegram-session-state.js` persists linked chats + runtime prefs |
| Entitlement | Reuse `telegram-access.js` (Pro gating) |

Telegram does **not** use relay QR/E2EE; it requires Mac bridge up + Telegram connectivity.

## Conversation vs control mode

| Mode | When | Telegram behavior |
|------|------|-------------------|
| **Conversation** | Codex input, running turn, finalized assistant | Plain text; typing indicator; one streaming bubble; optional activity footer; post-turn file summary |
| **Control** | Hubs, pickers, approvals, plan Q&A, errors | Inline keyboards; `/menu`, `/status`, `/pending` |

Policy modules: `telegram-reply-policy.js`, `telegram-notification-policy.js`.

## Streaming

- **One bubble per turn** via `telegram-streaming-bubble.js` (`editMessageText`, ~400ms coalesce)
- **4096** char cap (Bot API); plain text only (no `parse_mode` on stream)
- **Timeline truth** in `telegram-timeline-projector.js` (dedupe keys, late-event drop, steer/stop semantics)
- **Outbound delivery** via `telegram-outbound-queue.js` (per-chat serialization, `retry_after`)

## Consequences

**Positive**

- Always-on remote control without opening Native App
- Lock-screen approvals via inline keyboards
- Thin-network friendly (long-poll + edit-in-place)

**Negative / risks**

- No full diff terminal, pets, or glass UI
- Telegram rate limits require queue + user-visible backoff (L2/L3)
- Deep links limited to 64-char `start` payload — resume tokens need server validation (not shipped)

## Related

- `Docs/telegram-ux.md`
- `phodex-bridge/src/telegram-bridge-protocol.js` (`buildTelegramCodexInputRequest` steer vs start)
- Upstream coordination: `.scratch/telegram-excellence/issues/00-upstream-issue-draft.md`
