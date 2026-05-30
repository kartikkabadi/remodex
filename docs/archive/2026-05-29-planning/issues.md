# AFK/HITL issues — Remodex multi-agent (draft)

Tracer-bullet vertical slices. Not published to GitHub. Parent: (create after PRD issue exists).

---

## Issue 1 — Project registry on main

**Label:** AFK  
**Blocked by:** Maintainer issue ACK (HITL)

### What to build

Port `phodex-bridge/src/project-registry.js` and tests from `origin/codex/add-opencode-provider` onto current `main`. Wire registry into existing Codex thread list/start paths in `bridge.js` and `project-handler.js` without OpenCode harness.

### Acceptance criteria

- [ ] `sfw npm test` passes in `phodex-bridge`
- [ ] `known-projects.json` created under Codex home after simulated thread list
- [ ] No change to default iOS behavior when project UI unused
- [ ] PR under 400 lines diff vs `main`

---

## Issue 2 — Runtime router passthrough

**Label:** AFK  
**Blocked by:** Issue 1 merged or stacked

### What to build

Add `runtime-provider-router.js` and `opencode-models.js` with **zero** secondary harnesses registered. Integrate `stripRuntimeProviderFieldsForCodex` before `codex.send`. Tests for merge helpers and "no provider match → forward Codex".

### Acceptance criteria

- [ ] All existing bridge tests pass unchanged
- [ ] Router unit tests cover `model/list` and `thread/list` passthrough
- [ ] No OpenCode binary invoked in CI

---

## Issue 3 — OpenCode CLI harness behind flag

**Label:** AFK  
**Blocked by:** Issue 2

### What to build

Port `opencode-provider.js` + tests. Register when `REMODEX_ENABLE_OPENCODE=1`. Document env in `phodex-bridge/README` or root README.

### Acceptance criteria

- [ ] `opencode-provider.test.js` and `runtime-provider-router.test.js` pass
- [ ] Flag off → identical behavior to Issue 2
- [ ] Flag on + mocked spawn → turn lifecycle emits `turn/started` and completion
- [ ] README states OpenCode install requirement

---

## Issue 4 — iOS runtime picker (minimal)

**Label:** HITL (screenshot/video for maintainer)  
**Blocked by:** Issue 3

### What to build

Port `RuntimeProviderLogo`, provider assets, `CodexService+RuntimeConfig` strict provider policy, composer runtime menu files, settings runtime defaults card from branch. Avoid unrelated sidebar refactors from the 197-file diff.

### Acceptance criteria

- [ ] Default runtime remains Codex on fresh install
- [ ] User can select OpenCode model and start thread (device QA)
- [ ] Screenshot or screen recording attached to PR
- [ ] `CodexMobileTests` relevant runtime tests pass in Xcode CI if available

---

## Issue 5 — Durable thread ownership

**Label:** AFK  
**Blocked by:** Issue 3

### What to build

Add `thread-ownership-store.js`. Persist on thread/start and provider adoption. Router and OpenCode harness use store instead of only in-memory Maps.

### Acceptance criteria

- [ ] Restart bridge, resume OpenCode thread by id succeeds in manual test
- [ ] Unit tests cover load/save corruption handling
- [ ] Codex threads recorded with `provider: codex`

---

## Issue 6 — Restore relay pairing regression test

**Label:** AFK  
**Blocked by:** none (can parallel Issue 1)

### What to build

Ensure `relay/simulated-pairing-reconnect.test.js` exists on integration branch (file deleted on `codex/add-opencode-provider`). Fix any failures from router work.

### Acceptance criteria

- [ ] `npm test` in `relay/` passes
- [ ] Test documents expected reconnect behavior

---

## Issue 7 — Maintainer issue and PR #1 submission

**Label:** HITL  
**Blocked by:** none

### What to build

File upstream GitHub issue summarizing multi-agent intent. Open PR for Issue 1 only with test plan in description.

### Acceptance criteria

- [ ] Issue URL recorded
- [ ] PR links issue, under 400 lines, no OpenCode yet
- [ ] CI green on fork

---

## Issue 8 — OpenCode ACP spike (optional)

**Label:** AFK  
**Blocked by:** Issue 3 merged, maintainer agrees in issue

### What to build

Prototype `opencode acp` child process adapter behind `REMODEX_OPENCODE_TRANSPORT=acp`. Compare latency and streaming to CLI harness in a short doc in `.scratch/`.

### Acceptance criteria

- [ ] Spike doc with measured initialize + one prompt
- [ ] No production wiring until streaming gap assessed
- [ ] Recommendation ACP vs CLI in doc

---

## Suggested execution order

1. Issue 7 (HITL)  
2. Issue 6 (parallel)  
3. Issue 1 → 2 → 3 → 5  
4. Issue 4 (after 3, device)  
5. Issue 8 if v2 approved
