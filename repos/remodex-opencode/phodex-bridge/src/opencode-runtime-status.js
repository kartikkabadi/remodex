// FILE: opencode-runtime-status.js
// Purpose: Builds OpenCode runtime status snapshots for runtime/catalog and bridge-status.json.
// Layer: Bridge runtime utility
// Exports: buildOpenCodeRuntimeStatus, OPENCODE_MIN_CLI_VERSION
// Depends on: ./normalize

const { readString } = require("./normalize");

const OPENCODE_MIN_CLI_VERSION = "2.0.0";

function parseVersionParts(version) {
  const match = readString(version).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isVersionBelowMinimum(version, minimum = OPENCODE_MIN_CLI_VERSION) {
  const left = parseVersionParts(version);
  const right = parseVersionParts(minimum);
  if (!left || !right) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (left[index] < right[index]) {
      return true;
    }
    if (left[index] > right[index]) {
      return false;
    }
  }
  return false;
}

function buildOpenCodeRuntimeStatus({
  enabled = false,
  serveUrl = "",
  version = "",
  sessionCount = 0,
  lastError = "",
  command = "",
  handoffEnvEnabled = false,
} = {}) {
  const normalizedVersion = readString(version);
  const versionBelowMinimum =
    normalizedVersion.length > 0 && isVersionBelowMinimum(normalizedVersion, OPENCODE_MIN_CLI_VERSION);

  return {
    enabled: Boolean(enabled),
    serveUrl: readString(serveUrl) || null,
    version: normalizedVersion || null,
    minVersion: OPENCODE_MIN_CLI_VERSION,
    versionBelowMinimum,
    sessionCount: Number.isFinite(sessionCount) ? Math.max(0, Math.floor(sessionCount)) : 0,
    lastError: readString(lastError) || null,
    command: readString(command) || "opencode",
    handoffEnvEnabled: Boolean(handoffEnvEnabled),
    authConfigured: null,
  };
}

module.exports = {
  OPENCODE_MIN_CLI_VERSION,
  buildOpenCodeRuntimeStatus,
  isVersionBelowMinimum,
};