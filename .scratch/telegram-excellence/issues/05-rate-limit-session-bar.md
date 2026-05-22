# Issue 05 — Rate-limit UX + pinned session bar

## Outcome

Operators understand Telegram backpressure; optional glanceable session identity.

## Tasks

- [ ] Surface outbound queue delay in chat when `retry_after` > 2s
- [ ] Design pinned session bar copy (thread · branch · model · ctx%)
- [ ] Implement edit-in-place status message per linked chat (opt-in)
- [ ] Document rate limits in `Docs/telegram-ux.md`

## Exit

No silent message loss during flood; session bar updates without spamming new messages.
