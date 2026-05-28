# Architect contract — WT-2 bridge routing (OpenCode vs Codex)

**Entry:** `bridge.js` → `handleInboundPhoneMessage` (order matters; first match wins).

## Runtime flag

- `isOpenCodeRuntimeActive` ← `REMODEX_PROVIDER=opencode` (`opencode-runtime-policy.js`)

## Routing table (phone → bridge)

| Method pattern | OpenCode active | Codex active | Handler |
|----------------|-----------------|--------------|---------|
| `account/status/read`, `getAuthStatus` | Bridge-managed snapshot (no Codex token) | `readSanitizedAuthStatus` → `sendCodexRequest` | `handleBridgeManagedAccountRequest` |
| `account/login/start`, `cancel`, `complete`, `openOnMac` | Refusal (`lookupOpenCodeAccountRefusal`) — **WT-2:** Codex should forward to `sendCodexRequest` | Forward/login flows | `handleBridgeManagedAccountRequest` (today partial) |
| `account/logout`, `account/rateLimits/read` | Refusal | **WT-2:** forward to Codex | Same |
| `voice/*` (non-auth) | Skipped when OpenCode | `voiceHandler` | Early gate |
| Codex-only set (`thread/generateTitle`, `git/generateCommitMessage`, `git/generatePullRequestDraft`) | `createOpenCodeRefusalResponse` | Pass through | `isCodexOnlyBridgeMethod` |
| `desktop/continueOnDesktop`, `desktop/continueOnMac` | Blocked refusal | Desktop handler | `isOpenCodeBlockedDesktopMethod` |
| `thread/contextWindow/read`, `voice/transcribe`, `turn/steer`, … | Transport refusal inside OpenCode runtime | Codex transport | `lookupOpenCodeTransportRefusal` (transport) |
| `git/*`, `thread/generateTitle`, `thread/name/set` | **Today:** skipped (`!isOpenCodeRuntimeActive && handleGitRequest`) → falls through to transport | `handleGitRequest` (local git) | **WT-2:** method-level gate — OpenCode runs git handler for `git/*` + `thread/generateTitle`; **`thread/name/set` → transport only** |
| `thread/name/set` | **Today:** OpenCode transport (`handleThreadNameSetRequest`) | Git handler (local rename + notification) | **WT-2:** explicit transport route under OpenCode |
| Workspace / project / pet / notifications / desktop prefs | Both (where not blocked) | Both | respective `handle*Request` |
| Default JSON-RPC | `runtime.send` → `opencode-transport.js` | `codex.send` → Codex app | end of chain |

## WT-2 intended changes (P1)

1. **Git gate:** Replace runtime blanket `!isOpenCodeRuntimeActive && handleGitRequest` with:
   - If method is `git/*` or `thread/generateTitle` → `handleGitRequest` regardless of runtime (except codex-only AI git methods already refused).
   - If method is `thread/name/set` → **do not** call `handleGitRequest`; let transport handle.
2. **Account RPC:** When `!isOpenCodeRuntimeActive`, `account/login/*`, `logout`, `account/rateLimits/read` should reach Codex via `sendCodexRequest` instead of stopping at bridge-managed stub.

## Policy source files

| Concern | Module |
|---------|--------|
| Codex-only bridge methods | `opencode-runtime-policy.js` → `CODEX_ONLY_BRIDGE_METHODS` |
| OpenCode account refusals | `OPENCODE_ACCOUNT_REFUSALS` |
| OpenCode transport refusals | `REFUSED_OPENCODE_TRANSPORT_METHODS` |
| Git local execution | `git-handler.js` |

## Test contract (WT-2)

- `bridge-opencode-git-routing.test.js`: `git/status` under OpenCode; `thread/name/set` → transport mock; Codex login forward; OpenCode account refusal matrix.
