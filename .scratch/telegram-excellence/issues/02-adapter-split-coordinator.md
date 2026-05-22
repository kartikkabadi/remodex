# Issue 02 — Adapter split + coordinator wiring

## Outcome

`telegram-adapter.js` shrinks to transport wiring; timeline truth stays in projector + coordinator.

## Tasks

- [ ] Wire `createTelegramBridgeCoordinator` between inbound router and projector
- [ ] Extract inbound routing to `telegram-inbound-router.js` (if not present)
- [ ] Move approval/pending/session orchestration behind coordinator API
- [ ] Keep `telegram-codex-envelope.js` as shared parse helper (done)
- [ ] Target ~1,500 lines in adapter (stretch)

## Exit

Adapter tests pass; no duplicate envelope helpers; coordinator owns action dispatch plan.
