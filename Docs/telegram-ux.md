# Remodex Telegram UX

Remodex Telegram is a normal chat bot on the local Mac bridge. It is not a hosted Mini App and does not add in-chat billing.

## Hub navigation

Use `/menu` or `/status` to open the **Home hub**:

- **Chat** — stop, pending, plan guidance, activity
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

- `/new` without a project cwd creates a rootless thread when the bridge allows it
- `/projects` and **Threads → New** remain the explicit project-picker paths
- First plain-text **Codex Input** may create the initial **Active Thread** when none is selected

Prefer `/projects` when you need a specific repo cwd; use `/new` for a quick chat without choosing a folder first.
