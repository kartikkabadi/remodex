# Testing Strategy

## Test Layers

### Bridge Unit Tests

**Tool:** `node:test` + `node:assert/strict`
**Location:** `repos/remodex-opencode/phodex-bridge/test/`
**Command:** `node --test ./test/*.test.js`

**Pattern:**
- 1:1 source-to-test mapping — every `src/foo.js` has a corresponding `test/foo.test.js`
- Zero devDependencies — only Node built-in test runner
- Every test file is self-contained (defines its own fakes, no shared helpers directory)
- Three-tier mock taxonomy: DI injection overrides → Fake classes → Monkey-patching (last resort)

**Done bar:** All test files pass. Codex path tests pass when `REMODEX_ENABLE_OPENCODE` unset. OpenCode path tests pass with mocked SDK client.

### OpenCode bridge tests

**Harness:** `test/test-env.js` preloads `REMODEX_TEST=1` and sets `REMODEX_DISABLE_OPENCODE=1` by default so the full suite does not spawn `opencode serve`. Tests that exercise OpenCode unset that flag or inject mocked providers.

**Focused command:** `cd repos/remodex-opencode/phodex-bridge && npm run test:opencode`

| File | What it guards |
|------|----------------|
| `test/opencode-regression.test.js` | Codex-only regression when OpenCode is disabled; router `command/list`, `skills/list`, and `desktop/continueOpenCode` handoff env gate (`REMODEX_OPENCODE_HANDOFF`) |
| `test/opencode-restart-rehydrate.test.js` | Persisted `opencode-sessions.json` rehydration after a new provider instance (`thread/read`, `thread/turns/list`, `turn/start`) |
| `test/opencode-handoff.test.js` | Handoff payload building, TUI selection, desktop-app fallback |
| `test/opencode-session-lifecycle.test.js` | In-process thread/turn lifecycle with mocked SDK |
| `test/runtime-provider-router.test.js` | Provider routing and merged catalog/model/command/skills paths |

**Env knobs used in tests:**

- `REMODEX_DISABLE_OPENCODE=1` — omit OpenCode from `runtime/catalog` and skip provider registration (Codex regression).
- `REMODEX_ENABLE_OPENCODE=1` — opt-in for provider unit tests with mocked `serverFactory` / `clientFactory`.
- `REMODEX_OPENCODE_HANDOFF=1` — allow `desktop/continueOpenCode`; default off returns `opencode_handoff_disabled`.

**Done bar:** `npm run test:opencode` passes without a live `opencode` binary. Restart rehydration and handoff regressions stay mocked; integration tests that spawn real `opencode serve` remain optional (`test.skip` when binary missing).

### Bridge Integration Tests

**Tool:** `node:test`
**Location:** `repos/remodex-opencode/phodex-bridge/test/`

**Pattern:**
- Spawn real `opencode serve` on ephemeral port
- Create real `OpencodeClient` from `@opencode-ai/sdk/v2`
- Test actual API round-trips: create session, send prompt, consume event stream, get messages

**Done bar:** Real `opencode serve` process starts, SDK calls succeed, events stream correctly.

### iOS Unit Tests

**Tool:** XCTest
**Location:** `repos/remodex-opencode/CodexMobile/CodexMobileTests/`

**Pattern:**
- Mock `CodexService` with canned responses
- Test composer state transitions
- Test capability-driven row visibility
- Test thread affinity enforcement

**Done bar:** All existing CodexMobileTests pass (regression). New composer tests pass.

### iOS Snapshot Tests

**Tool:** XCTest snapshot assertions
**Location:** `repos/remodex-opencode/CodexMobile/CodexMobileTests/`

**Pattern:**
- Capture composer picker in all states: Codex selected, OpenCode selected, agent picker visible, greyed-out rows
- Capture sidebar with provider badges

**Done bar:** Snapshots match expected state. Regenerated when UI changes intentionally.

### Device E2E

**Tool:** Manual testing on real iPhone + Mac
**Location:** Not in CI — developer workstation only

**Pattern:**
- Pair iPhone to bridge (existing QR flow)
- Create Codex thread, start turn, verify streaming
- Create OpenCode thread: unified picker → select model → select agent → send turn → verify streaming
- Verify git actions on both Codex and OpenCode threads
- Verify bridge restart preserves thread ownership
- Verify Codex-only path regression

**Done bar:** Signed off by Kartik. Parity matrix filled with verified cells.

## What Is NOT Tested

- AppleScript desktop refresh (not testable in Node.js)
- macOS launchd integration (platform-specific, tested on real Mac)
- Push notification delivery (APNs sandbox testing)
- Voice transcription quality (manual QA)

## CI Requirements

- Bridge tests: `node --test` must pass on any Node.js 18+ machine with `opencode` on PATH
- Flag-off path: `REMODEX_ENABLE_OPENCODE=0` must produce identical behavior to today
- OpenCode optional: tests with OpenCode are skipped if binary is not installed (use `test.skip`)
- iOS tests: not run in CI (Xcode test runner is too slow for feedback loop)

## Parity Matrix

Maintained in `docs/operations/release-compatibility.md`. Every cell is:
- `enabled` — works, tested, verified
- `greyed` (+ reason string) — not supported, honest about it
- `n/a` — feature doesn't apply to this runtime

**Rule:** No `enabled` claims without device proof.
