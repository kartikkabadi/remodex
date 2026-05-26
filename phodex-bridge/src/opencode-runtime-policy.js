// FILE: opencode-runtime-policy.js
// Purpose: Shared OpenCode runtime gates and refusal tables for bridge + transport.
// Layer: CLI helper
// Exports: isOpenCodeRuntime, resolveRuntimeTransportFactory, refusal lookups
// Depends on: none (lazy-requires transport modules in factory helper)

const BUS_EVENT_ID_CACHE_LIMIT = 512;
const CWD_LOCK_TTL_MS = 4 * 60 * 60 * 1000;
const BINDINGS_PERSIST_DEBOUNCE_MS = 250;

const REFUSED_OPENCODE_TRANSPORT_METHODS = {
  "thread/contextWindow/read": {
    errorCode: "context_not_supported",
    message: "Context window usage is not available from Codex rollout for OpenCode threads.",
  },
  "voice/transcribe": {
    errorCode: "voice_not_supported",
    message: "Voice transcription is not available with the OpenCode runtime.",
  },
  "turn/steer": {
    errorCode: "turn_steer_not_supported",
    message: "Turn steering is not supported with the OpenCode runtime.",
  },
  "desktop/continueOnDesktop": {
    errorCode: "desktop_continue_not_supported",
    message: "Continue on Desktop is not available with the OpenCode runtime.",
  },
};

const CODEX_ONLY_BRIDGE_METHODS = new Set([
  "thread/generateTitle",
  "git/generateCommitMessage",
  "git/generatePullRequestDraft",
]);

const OPENCODE_BLOCKED_DESKTOP_METHODS = new Set([
  "desktop/continueOnDesktop",
  "desktop/continueOnMac",
]);

const OPENCODE_ACCOUNT_REFUSALS = {
  "account/login/start": {
    errorCode: "auth_not_supported",
    message: "ChatGPT account login is not available with the OpenCode runtime.",
  },
  "account/login/cancel": {
    errorCode: "auth_not_supported",
    message: "ChatGPT account login is not available with the OpenCode runtime.",
  },
  "account/login/complete": {
    errorCode: "auth_not_supported",
    message: "ChatGPT account login is not available with the OpenCode runtime.",
  },
  "account/login/openOnMac": {
    errorCode: "auth_not_supported",
    message: "ChatGPT sign-in is not available with the OpenCode runtime.",
  },
  "account/logout": {
    errorCode: "auth_not_supported",
    message: "ChatGPT account logout is not available with the OpenCode runtime.",
  },
  "voice/resolveAuth": {
    errorCode: "voice_not_supported",
    message: "Voice authentication is not available with the OpenCode runtime.",
  },
  "account/rateLimits/read": {
    errorCode: "rate_limits_not_supported",
    message: "Rate limit status is not available with the OpenCode runtime.",
  },
};

const CODEX_ONLY_BRIDGE_REFUSALS = {
  "thread/generateTitle": {
    errorCode: "codex_only_feature",
    message: "AI title generation is not available with the OpenCode runtime.",
  },
  "git/generateCommitMessage": {
    errorCode: "codex_only_feature",
    message: "AI git generation is not available with the OpenCode runtime.",
  },
  "git/generatePullRequestDraft": {
    errorCode: "codex_only_feature",
    message: "AI git generation is not available with the OpenCode runtime.",
  },
};

function resolveRuntimeProvider(env = process.env) {
  return (env.REMODEX_PROVIDER || "codex").toLowerCase();
}

function isOpenCodeRuntime(env = process.env) {
  return resolveRuntimeProvider(env) === "opencode";
}

function lookupOpenCodeTransportRefusal(methodName) {
  const normalized = typeof methodName === "string" ? methodName.trim() : "";
  return REFUSED_OPENCODE_TRANSPORT_METHODS[normalized] || null;
}

function lookupCodexOnlyBridgeRefusal(methodName) {
  const normalized = typeof methodName === "string" ? methodName.trim() : "";
  return CODEX_ONLY_BRIDGE_REFUSALS[normalized] || null;
}

function lookupOpenCodeAccountRefusal(methodName) {
  const normalized = typeof methodName === "string" ? methodName.trim() : "";
  return OPENCODE_ACCOUNT_REFUSALS[normalized] || null;
}

function isCodexOnlyBridgeMethodName(methodName) {
  const normalized = typeof methodName === "string" ? methodName.trim() : "";
  return CODEX_ONLY_BRIDGE_METHODS.has(normalized);
}

function isOpenCodeBlockedDesktopMethodName(methodName) {
  const normalized = typeof methodName === "string" ? methodName.trim() : "";
  return OPENCODE_BLOCKED_DESKTOP_METHODS.has(normalized);
}

function resolveRuntimeTransportFactory(env = process.env) {
  if (isOpenCodeRuntime(env)) {
    return require("./opencode-transport").createOpenCodeTransport;
  }
  return require("./codex-transport").createCodexTransport;
}

module.exports = {
  BINDINGS_PERSIST_DEBOUNCE_MS,
  BUS_EVENT_ID_CACHE_LIMIT,
  CWD_LOCK_TTL_MS,
  OPENCODE_ACCOUNT_REFUSALS,
  CODEX_ONLY_BRIDGE_METHODS,
  OPENCODE_BLOCKED_DESKTOP_METHODS,
  REFUSED_OPENCODE_TRANSPORT_METHODS,
  isCodexOnlyBridgeMethodName,
  isOpenCodeBlockedDesktopMethodName,
  isOpenCodeRuntime,
  lookupCodexOnlyBridgeRefusal,
  lookupOpenCodeAccountRefusal,
  lookupOpenCodeTransportRefusal,
  resolveRuntimeProvider,
  resolveRuntimeTransportFactory,
};
