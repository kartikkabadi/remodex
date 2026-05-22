# Upstream issue draft (do not post via automation)

**Title:** Remodex Telegram: first-class Client Surface (co-equal remote control)

## Summary

We want to merge Remodex Telegram as a **first-class Client Surface** on the Mac bridge — not a thin notification relay. It shares Codex RPC with iOS but uses Bot API long-poll locally (no QR/E2EE). Docs: `Docs/telegram-ux.md`.

## Problem

Remote operators need Codex on thin networks in an app they already keep open. Telegram should match iOS turn semantics (steer, stop, approvals) with conversation-first UX, without implying “offline lite mode.”

## Proposal

Staged PRs from `feat/telegram-bridge`:

1. CI + `deleteWebhook` + 4096 assistant cap + README/private-DM docs
2. `telegram-timeline-projector` + tests (iOS scenario ports)
3. Streaming bubble + outbound flood queue + rich `/status`
4. L3: steer queue, approval context, `/queue`, ADR

## Out of scope for initial merge

- Native iOS changes
- Android relay app
- Group/supergroup bot support (DM-only)

## Ask

- Align on “co-equal Client Surface” positioning vs “Secondary Client” bandwidth wording in `CONTEXT.md`
- Review parity matrix before large `phodex-bridge/` merge
- Target **npm 1.6.0** when Telegram ships

## Links

- UX spec: `Docs/telegram-ux.md`
- ADR: `docs/adr/001-telegram-client-surface.md`
- Plan: (internal) telegram upstream ship plan
