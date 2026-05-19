# Remodex

Remodex is a local-first control surface for running Codex from a Mac and companion clients.

## Language

**Client Surface**:
A user-facing Remodex interface that controls Codex through the local Remodex bridge.
_Avoid_: Frontend, bot, channel

**Remodex Telegram**:
A Telegram chat interface for controlling Remodex through the user's local Mac bridge.
_Avoid_: Telegram Mini App, hosted bot backend

**Native Remodex App**:
The high-bandwidth Remodex client for rich timeline inspection, sensitive payloads, visual review, and attachment-heavy work.
_Avoid_: Main app, iOS only

**Secondary Client**:
A Remodex client that can control and summarize local Codex work without replacing the Native Remodex App.
_Avoid_: Notification channel, companion alert

**Linked Chat**:
A Telegram chat that has been explicitly paired with a local Remodex installation.
_Avoid_: Account, Telegram user

**Control Command**:
A slash command or button action that controls Remodex without becoming model input.
_Avoid_: Prompt, message

**Codex Input**:
User content from a Client Surface that may be routed into Codex as a new turn or steering input.
_Avoid_: Prompt Message, chat instruction

**Active Thread**:
The Remodex thread currently selected for a linked chat.
_Avoid_: Current chat, session

**Thread Choice**:
A user action that selects which Remodex thread a Linked Chat will control.
_Avoid_: Navigation, browsing

**Running Turn**:
A Codex turn that is currently active and can still be stopped or receive live updates.
_Avoid_: Job, task

**Runtime Access Mode**:
The per-client runtime permission setting that controls whether Codex asks before sensitive actions or runs with full local access.
_Avoid_: Trust level, admin mode

## Relationships

- A **Linked Chat** belongs to one local Remodex installation.
- One local Remodex installation may have multiple **Linked Chats**.
- A **Linked Chat** may have zero or one **Active Thread**.
- A **Linked Chat** cannot control multiple local Remodex installations at the same time.
- The **Native Remodex App** and **Remodex Telegram** are **Client Surfaces**.
- **Remodex Telegram** is a **Secondary Client**.
- A **Linked Chat** has its own **Active Thread**, independent from the Native Remodex App's selected thread.
- A **Thread Choice** can be made through numbered recent threads or explicit thread identifiers.
- A **Control Command** can select or change the **Active Thread**.
- **Codex Input** can only reach Codex when it has an intentional thread context.
- A Linked Chat's first plain text **Codex Input** may create a new **Active Thread** before being sent to Codex.
- **Codex Input** starts a new Codex turn when the **Active Thread** is idle.
- **Codex Input** steers the **Running Turn** when the **Active Thread** has a steerable turn.
- A **Running Turn** belongs to one Remodex thread and is the target of stop controls for that thread.
- A **Linked Chat** may choose its own **Runtime Access Mode** without changing the Native Remodex App's current setting.

## Example dialogue

> **Dev:** "If someone texts Remodex Telegram 'fix the tests', is that a command?"
> **Domain expert:** "No. It is **Codex Input**. If the **Linked Chat** has no **Active Thread** yet, Remodex Telegram creates one first."

## Flagged ambiguities

- "Telegram message" was used to mean both **Control Command** and **Codex Input** — resolved: slash commands and button callbacks are **Control Commands**; plain text can become **Codex Input** only within an intentional thread context.
- "Telegram app" could mean a Mini App or a normal chat bot — resolved: **Remodex Telegram** is a normal Telegram chat interface, not a Telegram Mini App.
- "User" could mean a Telegram user or a Telegram chat — resolved: pairing is scoped to **Linked Chat**.
- "Continue" could mean selecting a thread or submitting model input — resolved: thread selection is a **Thread Choice**; model input is **Codex Input**, and a first plain text message may create the initial **Active Thread**.
