# ADR-005: Error Taxonomy

**Date:** 2026-05-30
**Status:** Accepted

## Context

Errors flow across four boundaries:
1. OpenCode SDK throws an error (network, protocol, auth)
2. Bridge catches the SDK error and needs to translate it
3. Bridge sends a JSON-RPC error to the iPhone
4. iOS displays a user-facing message (never a raw stack trace)

Without a consistent error model, error handling is ad-hoc. Raw SDK exceptions leak to the phone. Bridge code littered with `catch (error) { sendError(error.message) }` produces unactionable iOS messages.

## Decision

Use a **3-layer error taxonomy** where each boundary owns its error shape.

### Layer 1: SDK/Domain Errors

The SDK wrapper (`opencode-client.js`) catches all SDK exceptions and wraps them in typed domain errors:

```js
function openCodeError(code, message, cause) {
  const error = new Error(message);
  error.errorCode = code;
  error.cause = cause;   // original SDK error for bridge diagnostics
  return error;
}

// Usage:
try {
  await client.session.create({ directory });
} catch (cause) {
  throw openCodeError("opencode_sdk_error", "OpenCode SDK call failed.", cause);
}
```

**Error codes from the SDK layer:**
`opencode_not_installed`, `opencode_version_too_old`, `opencode_server_failed`, `opencode_server_not_healthy`, `opencode_sdk_error`, `opencode_timeout`, `provider_auth_error`

**OpenCode provider auth (`ProviderAuthError`):** The bridge classifies auth failures using structured payload fields in `opencode-usage-mapper.isProviderAuthErrorPayload` — `name: "ProviderAuthError"`, `errorCode: "provider_auth_error"`, nested `data.errorCode`, `providerID` / `authProvider`, and HTTP `401`/`403` paired with a provider id. Message substring heuristics (e.g. bare `"unauthorized"`) are intentionally **not** used. Matching failures are forwarded to iOS as the `runtime/auth/error` notification (see `opencode-auth-error-handler.js`).

### Layer 2: Bridge/Router Errors

Domain errors that originate in the bridge or router:

`thread_not_found`, `thread_turn_active`, `thread_provider_locked`, `unsupported_opencode_method`, `runtime_provider_failed`, `opencode_input_required`, `opencode_session_expired`

**Desktop handoff — OpenCode (`desktop/continueOpenCode`, `opencode-handoff.js`):**

Codex desktop relaunch uses `desktop/continueOnDesktop` / `desktop/continueOnMac` with codes such as `missing_thread_id`, `invalid_thread_id`, `unsupported_platform`, and `handoff_failed` from `desktop-handler.js`.

| `errorCode` | When |
|-------------|------|
| `opencode_handoff_disabled` | `REMODEX_OPENCODE_HANDOFF` unset or not `1`/`true` |
| `unsupported_platform` | Bridge host is not macOS (`darwin`) |
| `missing_thread_id` | `threadId` absent or whitespace-only |
| `invalid_thread_id` | `threadId` fails desktop id validation |
| `wrong_provider` | Thread ownership is not `opencode` |
| `opencode_server_unreachable` | OpenCode provider missing or `getHandoffContext` unavailable |
| `opencode_session_expired` | Mapped session no longer exists on the Mac |
| `thread_not_found` | OpenCode thread/context lookup failed |

### Layer 3: JSON-RPC Error Shape

Every error crossing the encrypted relay uses this shape:

```json
{
  "id": "<request-id>",
  "error": {
    "code": -32000,
    "message": "Human-readable description for iOS display",
    "data": {
      "errorCode": "snake_case_code",
      "sdkMessage": "Optional: raw SDK message for diagnostics",
      "minVersion": "2.0.0"   // Optional: for version_too_old errors
    }
  }
}
```

The `message` field is user-facing on iPhone. The `data.errorCode` is machine-readable for iOS to decide recovery actions. The `data.sdkMessage` and `data.minVersion` are optional diagnostic fields.

### Handler cascade (where errors are produced)

Bridge-local handlers run in a fixed order in `bridge.js:handleApplicationMessage()` before the runtime provider router. Load-bearing positions for error-producing paths:

1. Handshake/account → 2. Voice → 3. `thread/contextWindow/read` → 4. `session/getUsageStats` → 5. Workspace → 6. `project/discover` → 7. Project → 8. Pet → 9. Notifications → 10. Desktop → 11. Git → **12. Runtime provider router** → 13–15. Observers → 16. Thread turns list → 17. Codex passthrough.

Auth and usage errors for OpenCode originate in the provider layer (`opencode-provider.js`) and are either returned as JSON-RPC errors (usage/session handlers) or pushed as `runtime/auth/error` notifications. Full method list: `docs/contracts/bridge-rpc.md`.

### Error Flow

```
OpenCode SDK  ──throws──▶  opencode-client.js  ──wraps──▶  Domain Error { errorCode: "opencode_sdk_error" }
Domain Error  ──caught──▶  opencode-provider.js  ──maps──▶  JSON-RPC Error { message: "...", data: { errorCode: "..." } }
                                                      └──▶  runtime/auth/error notification (provider_auth_error)
JSON-RPC Error ──relay──▶  iPhone  ──renders──▶  SwiftUI alert/error card
```

### What the Phone Never Sees

- Raw stack traces
- SDK error names (`OpenCodeError`, `HTTPError`)
- Internal error codes from OpenCode internals
- File paths or hostnames from bridge diagnostics

## Consequences

**Every error has a machine-readable code and a human-readable message.** iOS can decide: is this retryable? Should I show a full error card or a toast?

**Bridge diagnostics stay on the bridge.** The `cause` chain preserves the full error context for bridge logs (`console.error("[remodex] OpenCode SDK error:", error.cause)`), but the phone only gets the sanitized message.

**New error codes are additive.** Adding a new error case means: one new `errorCode` string, one bridge handler mapping, one iOS message string. No schema changes needed.

**The error taxonomy is auditable.** Every handler's catch block either throws a domain error or wraps a caught error in one. No bare `throw error;` that leaks internal state.
