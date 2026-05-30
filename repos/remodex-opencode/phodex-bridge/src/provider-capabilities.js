// FILE: provider-capabilities.js
// Purpose: Defines capability flags for the composer UI and model-level capability resolution
//          so rows render from capabilities rather than provider identity checks.
// Layer: Bridge runtime provider helper
// Exports: resolveModelCapabilities, CAPABILITIES, CODEX_CAPABILITIES, OPENCODE_CAPABILITIES
// Depends on: none

const CAPABILITIES = {
  SUPPORTS_AGENT_SELECTION: "supportsAgentSelection",
  SUPPORTS_REASONING_EFFORT: "supportsReasoningEffort",
  SUPPORTS_FAST_MODE: "supportsFastMode",
  SUPPORTS_PLAN_MODE: "supportsPlanMode",
  SUPPORTS_STREAMING_TOOLS: "supportsStreamingTools",
  SUPPORTS_APPROVALS: "supportsApprovals",
  SUPPORTS_FORK: "supportsFork",
  SUPPORTS_VOICE: "supportsVoice",
  SUPPORTS_DESKTOP_HANDOFF: "supportsDesktopHandoff",
  SUPPORTS_SLASH_COMMANDS: "supportsSlashCommands",
  SUPPORTS_MCP: "supportsMCP",
  SUPPORTS_WORKTREE: "supportsWorktree",
};

const CODEX_CAPABILITIES = {
  [CAPABILITIES.SUPPORTS_AGENT_SELECTION]: false,
  [CAPABILITIES.SUPPORTS_FAST_MODE]: true,
  [CAPABILITIES.SUPPORTS_PLAN_MODE]: true,
  [CAPABILITIES.SUPPORTS_VOICE]: true,
  [CAPABILITIES.SUPPORTS_DESKTOP_HANDOFF]: true,
  [CAPABILITIES.SUPPORTS_WORKTREE]: true,
  [CAPABILITIES.SUPPORTS_FORK]: true,
  [CAPABILITIES.SUPPORTS_APPROVALS]: true,
  [CAPABILITIES.SUPPORTS_STREAMING_TOOLS]: true,
  [CAPABILITIES.SUPPORTS_SLASH_COMMANDS]: true,
  [CAPABILITIES.SUPPORTS_MCP]: true,
};

const OPENCODE_CAPABILITIES = {
  [CAPABILITIES.SUPPORTS_AGENT_SELECTION]: true,
  [CAPABILITIES.SUPPORTS_FAST_MODE]: false,
  [CAPABILITIES.SUPPORTS_PLAN_MODE]: false,
  [CAPABILITIES.SUPPORTS_VOICE]: false,
  [CAPABILITIES.SUPPORTS_DESKTOP_HANDOFF]: false,
  [CAPABILITIES.SUPPORTS_WORKTREE]: false,
  [CAPABILITIES.SUPPORTS_FORK]: true,
  [CAPABILITIES.SUPPORTS_APPROVALS]: true,
  [CAPABILITIES.SUPPORTS_STREAMING_TOOLS]: true,
  [CAPABILITIES.SUPPORTS_SLASH_COMMANDS]: true,
  [CAPABILITIES.SUPPORTS_MCP]: false,
};

function resolveModelCapabilities(providerId, modelData) {
  const base = readString(providerId) === "opencode"
    ? { ...OPENCODE_CAPABILITIES }
    : { ...CODEX_CAPABILITIES };

  return {
    ...base,
    [CAPABILITIES.SUPPORTS_REASONING_EFFORT]: hasReasoningEffort(modelData),
  };
}

function hasReasoningEffort(modelData) {
  if (!modelData || typeof modelData !== "object") {
    return false;
  }

  if (Array.isArray(modelData.supportedReasoningEfforts)) {
    return modelData.supportedReasoningEfforts.length > 0;
  }

  if (Array.isArray(modelData.reasoningEfforts)) {
    return modelData.reasoningEfforts.length > 0;
  }

  return modelData.hasReasoning === true
    || modelData.supportsReasoning === true
    || modelData.reasoning === true;
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  CAPABILITIES,
  CODEX_CAPABILITIES,
  OPENCODE_CAPABILITIES,
  resolveModelCapabilities,
  hasReasoningEffort,
};
