# Amendment: Class (e) External OpenCode Session Discovery

**Run ID:** ee01e091  
**Status:** Implemented (PR-3 session merge + adopt, PR-4 hot-path project discover, PR-6 docs/device matrix)  
**Supersedes:** `docs/design/ipad-opencode-e2e-composer-fixes-eedfe10f.md` anti-ghost rule for class (e) only  
**Canonical design:** `/tmp/grok-brownfield-design-ee01e091.md`

---

## Summary

Mac-started OpenCode sessions (CLI/TUI/desktop `opencode`) were invisible on iPhone because the bridge never called SDK `session.list` and `listThreads` filtered to bridge-owned rows only. This amendment introduces **class (e)** externally discovered sessions: metadata-only list rows with adopt-on-explicit-open semantics matching Codex Mac→iPhone UX.

---

## Class (e) rules

| Property | Value |
|----------|-------|
| Thread ID | `opencode-session-{sessionId}` |
| Ownership | None until `thread/read` or `thread/resume` |
| `metadata.discoveredExternally` | `true` |
| `metadata.sessionId` | serve-native ID |
| List validation | Metadata-only; no `getMessages` on hot path |
| Archived | Excluded when `time.archived` set (IQ-3) |
| Child sessions | Excluded when `parentID` set |
| Inclusion | Non-empty `title` OR `time.updated` OR `time.created` |
| Dedup | Skip stub when `sessionId` already mapped to owned `opencode-thread-*` |

---

## Adopt atomicity (§6.4)

`adoptDiscoveredSession(threadId)` runs **only** from `threadRead` entry in `opencode-provider.js`:

1. Parse `sessionId` from `opencode-session-{sessionId}` pattern
2. Idempotent if already owned
3. Link to existing owned thread if same `sessionId` (D-9)
4. Atomic: session store write before ownership write; rollback on failure
5. `requireThread` / `turnStart` **never** call adopt

Pre-adopt `turn/start` → `thread_not_found`. Post-adopt `turn/start` succeeds.

---

## Background-read boundary (§6.5)

| Path | Rule |
|------|------|
| `thread/list` | Allowed — metadata only |
| `thread/read` / `thread/resume` | Adopt trigger — user tap only |
| `turn/start` | Requires prior adopt |
| iOS sync watch / catch-up | **Must skip** `discoveredExternally` rows |
| iOS prefetch | No `thread/read` until navigation tap |

Bridge does not distinguish `thread/read` vs `thread/resume`. iOS `CodexService+Sync.swift` guards `syncActiveThreadState`, `refreshInactiveRunningBadgeThreads`, `catchUpRunningThreadIfNeeded`, and `syncThreadHistory`.

---

## Feature flags (default off until O18–O20)

| Flag | Purpose |
|------|---------|
| `REMODEX_OPENCODE_DISCOVER_SESSIONS=1` | Enable class (e) `session.list` merge |
| `REMODEX_OPENCODE_DISCOVER_PROJECTS=1` | Enable debounced `project/discover` on `thread/list` |

`REMODEX_DISABLE_OPENCODE=1` preserves Codex-only regression path.

---

## Relationship to anti-ghost policy

`ipad-opencode-e2e-composer-fixes-eedfe10f.md` mandates not materializing device-unstarted conversations. **This amendment is the explicit exception for class (e):** list metadata from `session.list` is allowed without ownership; materialization (session store + ownership) happens only on user open via adopt.

Bridge-owned rows (classes a–d) retain full anti-ghost validation.

---

## References

| Artifact | Path |
|----------|------|
| Bridge RPC contract | `docs/contracts/bridge-rpc.md` |
| SDK `session.list` | `docs/contracts/opencode-sdk.md` |
| Device matrix O18–O20 | `docs/operations/device-e2e-opencode.md` |
| Session mapper | `phodex-bridge/src/opencode-models.js` |
| Discovery + adopt | `phodex-bridge/src/opencode-provider.js` |
| Hot-path project discover | `phodex-bridge/src/runtime-provider-router.js` |