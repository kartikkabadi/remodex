// FILE: opencode-usage-mapper.js
// Purpose: Maps OpenCode session token counters into Remodex context-window usage shape.
// Layer: Bridge helper
// Exports: mapOpenCodeSessionToContextUsage, resolveOpenCodeSessionPayload
// Depends on: ./normalize

const { readString } = require("./normalize");

function resolveOpenCodeSessionPayload(response) {
  if (!response || typeof response !== "object") {
    return null;
  }
  if (response.data && typeof response.data === "object" && !Array.isArray(response.data)) {
    return response.data;
  }
  return response;
}

function readTokenCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

// Converts OpenCode session token counters into the iOS ContextWindowUsage wire shape.
function mapOpenCodeSessionToContextUsage(session, { tokenLimit = 0 } = {}) {
  const payload = resolveOpenCodeSessionPayload(session);
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const tokens = payload.tokens && typeof payload.tokens === "object" ? payload.tokens : {};
  const cache = tokens.cache && typeof tokens.cache === "object" ? tokens.cache : {};
  const tokensUsed =
    readTokenCount(tokens.total) ||
    readTokenCount(tokens.input) +
      readTokenCount(tokens.output) +
      readTokenCount(tokens.reasoning) +
      readTokenCount(cache.read) +
      readTokenCount(cache.write);

  const resolvedLimit =
    readTokenCount(tokenLimit) ||
    readTokenCount(payload.contextWindow) ||
    readTokenCount(payload.context_window) ||
    readTokenCount(payload.modelContextWindow) ||
    readTokenCount(payload.model_context_window);

  if (!resolvedLimit) {
    return null;
  }

  return {
    tokensUsed: Math.min(tokensUsed, resolvedLimit),
    tokenLimit: resolvedLimit,
  };
}

function isProviderAuthErrorPayload(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const name = readString(error.name || error.type || error.errorCode);
  if (name === "ProviderAuthError" || name === "provider_auth_error") {
    return true;
  }

  const message = readString(error.message).toLowerCase();
  return (
    message.includes("provider auth") ||
    message.includes("authentication failed") ||
    message.includes("invalid api key") ||
    message.includes("unauthorized")
  );
}

module.exports = {
  mapOpenCodeSessionToContextUsage,
  resolveOpenCodeSessionPayload,
  isProviderAuthErrorPayload,
};
