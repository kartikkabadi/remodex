# Remodex Telegram excellence — PRD (short)

## Goal

Ship Remodex Telegram as a **first-class Client Surface**: iOS-grade turn reliability, conversation-first streaming, and Telegram-native remote control — without competing with the Native App on visual bandwidth.

## Release

- **npm package:** bump to **1.6.0** when Telegram ships to upstream (coordinate with Emanuel).
- **Branch:** `feat/telegram-bridge` → staged PRs per [upstream ship plan](file:///Users/user/.cursor/plans/telegram_upstream_ship_plan_dd58e26c.plan.md).

## Done in this branch (L0–L3 subset)

| Area | Status |
|------|--------|
| Timeline projector, late-event guards, stop fallbacks | Done |
| Rich `/status`, `/menu`, file summary, `/activity`, outbound queue | Done |
| Implicit steer + `/queue`, approval context, deep-link stub | Done (this slice) |
| `telegram-codex-envelope.js`, coordinator stub | Done (this slice) |

## Remaining (see `issues/`)

1. L0 ship-ready (CI, deleteWebhook, upstream issue filed)
2. Adapter split + coordinator wiring
3. L3 remainder (pinned session bar, `/files` picker, subagent cards)
4. Reconnect rehydrate hardening + multi-item turn tests
5. Rate-limit user-visible copy + pinned session bar design
6. Product acceptance matrix vs iOS

## Non-goals

- Pixel Liquid Glass UI, terminal, pets, RevenueCat in Telegram
- Android relay client work in-repo
