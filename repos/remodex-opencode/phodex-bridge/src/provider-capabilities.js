// FILE: provider-capabilities.js
// Purpose: Defines capability flags for runtimes. Used by runtime/catalog and model/list
//          to drive iOS composer visibility/grey-out without hardcoded provider checks.
// Layer: Bridge runtime utility
// Exports: CAPABILITIES, resolveModelCapabilities, hasReasoningEffort
// Depends on: ./opencode-models

const { CODEX_PROVIDER_ID, OPENCODE_PROVIDER_ID } = require("./opencode-models");

const CAPABILITIES = [
  "supportsAgentSelection",
  "supportsReasoningEffort",
  "supportsFastMode",
  "supportsPlanMode",
  "supportsVoice",
  "supportsDesktopHandoff",
  "supportsWorktree",
  "supportsFork",
  "supportsApprovals",
  "supportsStreamingTools",
  "supportsSlashCommands",
  "supportsMCP",
];

const CODEX_CAPABILITIES = Object.fromEntries(CAPABILITIES.map((key) => [key, true]));

const OPENCODE_CAPABILITIES = {
  supportsAgentSelection: true,
  supportsReasoningEffort: false,
  supportsFastMode: false,
  supportsPlanMode: false,
  supportsVoice: false,
  supportsDesktopHandoff: false,
  supportsWorktree: false,
  supportsFork: true,
  supportsApprovals: true,
  supportsStreamingTools: true,
  supportsSlashCommands: true,
  supportsMCP: true,
};

function resolveModelCapabilities(providerId, modelData = {}) {
  const base = providerId === CODEX_PROVIDER_ID
    ? { ...CODEX_CAPABILITIES }
    : providerId === OPENCODE_PROVIDER_ID
      ? { ...OPENCODE_CAPABILITIES }
      : {};

  const reasoningEfforts = Array.isArray(modelData.supportedReasoningEfforts)
    ? modelData.supportedReasoningEfforts
    : [];
  if (reasoningEfforts.length > 0) {
    base.supportsReasoningEffort = true;
  }

  if (modelData.supportsFastMode === true) {
    base.supportsFastMode = true;
  }

  if (modelData.supportsReasoning !== undefined) {
    base.supportsReasoningEffort = Boolean(modelData.supportsReasoning);
  }

  return base;
}

function hasReasoningEffort(capabilities) {
  return capabilities?.supportsReasoningEffort === true;
}

module.exports = {
  CAPABILITIES,
  CODEX_CAPABILITIES,
  OPENCODE_CAPABILITIES,
  resolveModelCapabilities,
  hasReasoningEffort,
};
