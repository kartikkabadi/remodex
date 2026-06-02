// FILE: provider-capabilities.js
// Purpose: Defines capability flags for runtimes. Used by runtime/catalog and model/list
//          to drive iOS composer visibility/grey-out without hardcoded provider checks.
// Layer: Bridge runtime utility
// Exports: CAPABILITIES, resolveModelCapabilities, resolveOpenCodeCatalogCapabilities, hasReasoningEffort
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
  "supportsSkillAutocomplete",
  "supportsStructuredSkillInput",
  "supportsSteer",
  "supportsQueue",
];

const CODEX_CAPABILITIES = {
  supportsAgentSelection: false,
  supportsReasoningEffort: true,
  supportsFastMode: true,
  supportsPlanMode: true,
  supportsVoice: true,
  supportsDesktopHandoff: true,
  supportsWorktree: true,
  supportsFork: true,
  supportsApprovals: true,
  supportsStreamingTools: true,
  supportsSlashCommands: true,
  supportsMCP: true,
  supportsSkillAutocomplete: true,
  supportsStructuredSkillInput: true,
  supportsSteer: true,
  supportsQueue: true,
};

const OPENCODE_CAPABILITIES = {
  supportsAgentSelection: true,
  supportsReasoningEffort: false,
  supportsFastMode: false,
  supportsPlanMode: false,
  supportsVoice: false,
  supportsDesktopHandoff: true,
  supportsWorktree: false,
  supportsFork: true,
  supportsApprovals: true,
  supportsStreamingTools: true,
  supportsSlashCommands: true,
  supportsMCP: true,
  supportsSkillAutocomplete: true,
  supportsStructuredSkillInput: true,
  supportsSteer: false,
  supportsQueue: true,
};

function resolveOpenCodeCatalogCapabilities(_env = process.env) {
  return { ...OPENCODE_CAPABILITIES };
}

function resolveModelCapabilities(providerId, modelData = {}, env = process.env) {
  modelData = modelData || {};
  const base =
    providerId === CODEX_PROVIDER_ID
      ? { ...CODEX_CAPABILITIES }
      : providerId === OPENCODE_PROVIDER_ID
        ? resolveOpenCodeCatalogCapabilities(env)
        : { ...CODEX_CAPABILITIES };

  if (Array.isArray(modelData.supportedReasoningEfforts)) {
    base.supportsReasoningEffort = modelData.supportedReasoningEfforts.length > 0;
  }

  const reasoningEffortsAlt = Array.isArray(modelData.reasoningEfforts)
    ? modelData.reasoningEfforts
    : [];
  if (reasoningEffortsAlt.length > 0) {
    base.supportsReasoningEffort = true;
  }

  if (modelData.supportsFastMode === true) {
    base.supportsFastMode = true;
  }

  if (modelData.supportsReasoning !== undefined) {
    base.supportsReasoningEffort = Boolean(modelData.supportsReasoning);
  }

  if (modelData.hasReasoning !== undefined) {
    base.supportsReasoningEffort = Boolean(modelData.hasReasoning);
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
  resolveOpenCodeCatalogCapabilities,
  resolveModelCapabilities,
  hasReasoningEffort,
};
