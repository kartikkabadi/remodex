// FILE: opencode-agent-discovery.js
// Purpose: Discovers installed OpenCode agent names from local config for runtime list payloads.
// Layer: Bridge core
// Exports: discoverOpenCodeAgents
// Depends on: fs, os, path, ./agent-runtime-capabilities

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  OPENCODE_DEFAULT_BUILD_AGENT_NAME,
  OPENCODE_DEFAULT_PLAN_AGENT_NAME,
} = require("./agent-runtime-capabilities");

function discoverOpenCodeAgents({
  fsImpl = fs,
  env = process.env,
  configDir = path.join(env.HOME || os.homedir(), ".config", "opencode"),
} = {}) {
  const ids = new Set([
    OPENCODE_DEFAULT_BUILD_AGENT_NAME,
    OPENCODE_DEFAULT_PLAN_AGENT_NAME,
  ]);

  for (const fileName of ["oh-my-openagent.json", "opencode.json"]) {
    mergeAgentIdsFromConfigFile(ids, path.join(configDir, fileName), fsImpl);
  }

  const ordered = prioritizeOpenCodeAgentIds([...ids]);
  return ordered.map((id) => ({
    id,
    displayName: formatOpenCodeAgentDisplayName(id),
    isDefaultBuild: id === OPENCODE_DEFAULT_BUILD_AGENT_NAME,
    isDefaultPlan: id === OPENCODE_DEFAULT_PLAN_AGENT_NAME,
  }));
}

function mergeAgentIdsFromConfigFile(ids, filePath, fsImpl) {
  try {
    const raw = fsImpl.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const agents = parsed?.agents;
    if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
      return;
    }
    for (const key of Object.keys(agents)) {
      const normalized = readString(key);
      if (normalized) {
        ids.add(normalized);
      }
    }
  } catch {
    // Missing or invalid config is normal on fresh Macs.
  }
}

function prioritizeOpenCodeAgentIds(ids) {
  const preferred = [
    OPENCODE_DEFAULT_BUILD_AGENT_NAME,
    OPENCODE_DEFAULT_PLAN_AGENT_NAME,
  ];
  const rest = ids
    .filter((id) => !preferred.includes(id))
    .sort((left, right) => left.localeCompare(right));
  return [...preferred.filter((id) => ids.includes(id)), ...rest];
}

function formatOpenCodeAgentDisplayName(id) {
  const normalized = readString(id);
  if (!normalized) {
    return "";
  }
  if (normalized === OPENCODE_DEFAULT_BUILD_AGENT_NAME || normalized === OPENCODE_DEFAULT_PLAN_AGENT_NAME) {
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
  return normalized
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  discoverOpenCodeAgents,
  formatOpenCodeAgentDisplayName,
  prioritizeOpenCodeAgentIds,
};
