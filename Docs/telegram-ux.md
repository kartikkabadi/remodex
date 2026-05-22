# Remodex Telegram UX

Remodex Telegram is a **first-class Client Surface** — the full Mac Codex runtime in your pocket, with iOS-grade reliability goals, expressed through conversation-first chat UX plus structured control hubs. It is not a hosted Mini App, a degraded offline mode, or a notification-only channel.

**Secondary Client** in [CONTEXT.md](../CONTEXT.md) means lower rendering bandwidth than the Native Remodex App (no Liquid Glass timeline, terminal, or diff sheets). It does **not** mean lower product priority. For remote control, treat Telegram as a **co-equal Client Surface**.

## Private DM only

- Create the bot with [@BotFather](https://t.me/BotFather) and use it only in a **private chat** with that bot.
- Run `remodex telegram link` on the Mac and paste `/link <code>` in that DM.
- Do **not** add the bot to groups, supergroups, or channels — linked-chat ACL assumes a single trusted DM per pairing.
- Treat link codes like short-lived secrets; anyone with the code can pair that chat to your Mac bridge.

## Conversation mode vs Control mode

**Conversation mode** is the default for **Codex Input** and **Running Turn** updates:

- Plain text runs Codex without per-turn control keyboards.
- A typing indicator replaces the old "working on…" banner.
- Assistant replies stream into **one live bubble** edited in place (`editMessageText`, ~400ms coalesce).
- Use `/stop` or the optional Stop row on a live bubble to interrupt a **Running Turn**.

**Control mode** covers **Control Commands**, hubs, pickers, approvals, and errors:

- `/menu`, `/status`, `/threads`, and related slash commands.
- Inline keyboards on hubs, pickers, approvals, and missing-thread hints.
- `/start` on a **Linked Chat** shows short onboarding text only — open `/menu` when you want buttons.

Buttons are intentionally absent from implicit **Codex Input** acks and post-turn assistant replies.

### Conversation mode spec (target UX)

```
[User] fix the login bug

…  (typing indicator)
…  (live bubble edits — final answer streams here)
     optional footer: ↳ running tests in auth/

[Assistant bubble finalized]

Edited 2 files:
• src/auth.ts  +18 / -3
• tests/auth.test.ts  +42 / -0
```

**Rules:**

1. **During turn:** typing + **one** streaming bubble; optional single-line activity footer inside the bubble (not new messages).
2. **After turn:** one **file-change summary** message when diffs exist (plain text, mirroring iOS `FileChangeSummaryBox` intent).
3. **Thinking / tools / commands:** suppressed in stream; available via **`/activity`** (control mode) — same progressive-disclosure philosophy as iOS collapsed history.
4. **Approvals / plan Q&A:** control mode keyboards only.
5. **No keyboards** on implicit acks or post-turn assistant text (see `telegram-reply-policy.js`).

## Excellence ladder (summary)

| Level | Goal |
|-------|------|
| **L0 — Ship-ready** | No debug ingest; CI tests; `deleteWebhook` on start; 4096-char assistant cap; honest README; rootless `/new`; private-DM docs |
| **L1 — Engineering parity** | `telegram-timeline-projector`; turn-less fallbacks; Stop via `thread/read`; dedupe keys; late-event guards; reconnect rehydrate |
| **L2 — Experience parity** | Rich `/status` + `/menu`; post-turn file summary; `/activity`; outbound flood queue; trusted pairing copy |
| **L3 — Telegram wins** | Steer queue, lock-screen approve, voice/photo from any client, `/ship` stash, deep status, optional pinned session bar |

## Steer while running

When a turn is already running, plain-text **Codex Input** is sent to Codex as **`turn/steer`** (same contract as iOS queueing). Remodex does not post a separate ack bubble for implicit input — the live streaming bubble keeps updating.

- **`/queue`** (or **Chat → Queue**) shows turn state, steered messages sent during the run, pending approvals/prompts, and outbound Telegram delivery backlog.
- Steer history clears when the turn finishes.

## Approvals from Telegram

Dangerous commands, file changes, and permission grants surface as control-mode messages with **Approve** / **Decline** buttons. Copy includes thread title and git branch when available so you can decide from the lock screen without opening the Native App.

Use **`/pending`** to reopen the latest prompt or approval.

## Deep links (limitation)

Telegram deep links use `t.me/<bot>?start=<payload>` with a **64-character** `start` payload limit. Remodex does not yet validate opaque resume tokens server-side.

- **`/start resume_*`** today shows guidance to use **`/threads`** or **`/resume`** instead of auto-resuming.
- Future: server-validated opaque tokens mapping to `threadId` (within Telegram’s size cap).

## Hub navigation

Use `/menu` or `/status` to open the **Home hub**:

- **Chat** — stop, queue, pending, activity
- **Threads** — list, resume, new, archived
- **Git** — diff, branches, draft, push, stash
- **Settings** — model, access, account, prefs, Advanced (Mac)
- **Help** — command help

`/status` shows the status summary with the same Home hub keyboard as `/menu`.

## Keyboard policy

| Rule | Value |
|------|-------|
| Standard hub screens | Max **4** rows |
| Buttons per row | Max **2** on hubs |
| List pickers | **5** items per page with `Prev` / `Next` / `Menu` |
| Global nav | One row: `Menu` + `Status` |

Implementation: `phodex-bridge/src/telegram-keyboards.js`.

## Pro entitlement

Telegram access still follows `telegram-access.js`. `/upgrade` explains Mac-side Pro purchase only; there are no payment buttons in chat.

## Rootless threads

Upstream bridge **1.5.5** supports projectless (rootless) chats. From Telegram:

- `/new` without a project cwd creates a rootless thread folder under `~/Documents/Codex/<date>/<slug>` when no recent thread cwd is available
- `/projects` and **Threads → New** remain the explicit project-picker paths
- First plain-text **Codex Input** may create the initial **Active Thread** when none is selected

Prefer `/projects` when you need a specific repo cwd; use `/new` for a quick chat without choosing a folder first.

## Live assistant bubble (streaming)

During a **Running Turn**, Remodex Telegram streams assistant text into one message via `editMessageText`:

- First output creates the bubble; later deltas coalesce with ~400ms throttling.
- Telegram caps messages at **4096** characters; very long replies truncate with `[truncated by Remodex Telegram]`.
- Edit rate limits apply — the bridge coalesces updates and ignores benign `MESSAGE_NOT_MODIFIED` responses.
- When streaming is active, the final `agent_message` snapshot finalizes the same bubble instead of sending a duplicate message.

**Polling:** `getUpdates` uses `timeout: 20` (seconds) per Telegram long-poll semantics. `REMODEX_TELEGRAM_POLL_INTERVAL_MS` (default **1000**) is the delay **between** poll rounds when idle — not the long-poll timeout. Lower values (for example `500`) make inbound chat handling feel snappier; higher values reduce load on the Mac.
