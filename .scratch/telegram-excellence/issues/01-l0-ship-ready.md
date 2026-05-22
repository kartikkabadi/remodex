# Issue 01 — L0 ship-ready foundation

## Outcome

Safe to merge `feat/telegram-bridge`; honest ops docs; CI truth.

## Tasks

- [ ] Remove any debug ingest (`127.0.0.1:7363` or similar)
- [ ] `deleteWebhook` on adapter start (webhook vs long-poll exclusivity)
- [ ] Unify assistant text cap to **4096** (remove 1400 shrink-on-finalize)
- [ ] CI runs `npm test` in bridge-check workflow
- [ ] README: daemon-config, `remodex telegram`, private-DM-only, media limits
- [ ] Rootless `/new` behavior documented or retracted in docs
- [ ] Commit/push WIP; open upstream issue from `00-upstream-issue-draft.md`

## Exit

583+ tests green in CI; Emanuel can enable bot from README; no debug code.
