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
`opencode_not_installed`, `opencode_version_too_old`, `opencode_server_failed`, `opencode_server_not_healthy`, `opencode_sdk_error`, `opencode_timeout`

### Layer 2: Bridge/Router Errors

Domain errors that originate in the bridge or router:

`thread_not_found`, `thread_turn_active`, `thread_provider_locked`, `unsupported_opencode_method`, `runtime_provider_failed`, `opencode_input_required`, `opencode_session_expired`

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

### Error Flow

```
OpenCode SDK  ──throws──▶  opencode-client.js  ──wraps──▶  Domain Error { errorCode: "opencode_sdk_error" }
Domain Error  ──caught──▶  opencode-provider.js  ──maps──▶  JSON-RPC Error { message: "...", data: { errorCode: "..." } }
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
