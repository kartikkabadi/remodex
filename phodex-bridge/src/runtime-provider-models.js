// FILE: runtime-provider-models.js
// Purpose: Normalizes provider-aware model/thread metadata shared by local runtime providers.
// Layer: Bridge runtime provider helper
// Exports: provider constants plus model/provider parsing helpers.
// Depends on: none

const CODEX_PROVIDER_ID = "codex";
const CURSOR_PROVIDER_ID = "cursor";

const PROVIDER_FIELD_KEYS = [
  "modelProvider",
  "model_provider",
  "provider",
  "runtimeProvider",
  "runtime_provider",
  "harness",
];

function normalizeRuntimeProvider(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "":
      return CODEX_PROVIDER_ID;
    case "cursor-agent":
    case "cursor_cli":
    case "cursor-cli":
      return CURSOR_PROVIDER_ID;
    case "open-code":
    case "open_code":
      return "opencode";
    case "claude-code":
    case "claudecode":
      return "claude";
    default:
      return normalized;
  }
}

function readModelProvider(value = {}) {
  if (!value || typeof value !== "object") {
    return CODEX_PROVIDER_ID;
  }

  return normalizeRuntimeProvider(
    value.modelProvider
      || value.model_provider
      || value.provider
      || value.runtimeProvider
      || value.runtime_provider
      || value.harness
      || value.collaborationMode?.settings?.modelProvider
      || value.collaborationMode?.settings?.model_provider
      || value.collaborationMode?.settings?.provider
      || value.collaboration_mode?.settings?.modelProvider
      || value.collaboration_mode?.settings?.model_provider
      || value.collaboration_mode?.settings?.provider
  );
}

function hasExplicitProviderField(value = {}) {
  if (!value || typeof value !== "object") {
    return false;
  }

  return hasOwnProviderField(value)
    || hasOwnProviderField(value.collaborationMode?.settings)
    || hasOwnProviderField(value.collaboration_mode?.settings);
}

function isCodexProvider(value) {
  return normalizeRuntimeProvider(value) === CODEX_PROVIDER_ID;
}

function isCursorProvider(value) {
  return normalizeRuntimeProvider(value) === CURSOR_PROVIDER_ID;
}

function buildRuntimeModelOption({
  provider,
  id,
  model = id,
  displayName,
  description = "",
  isDefault = false,
  supportsFastMode = false,
  supportedReasoningEfforts = [],
  defaultReasoningEffort = null,
}) {
  const normalizedProvider = normalizeRuntimeProvider(provider);
  const normalizedId = readString(id || model);
  const normalizedModel = readString(model || id);
  if (!normalizedProvider || !normalizedId || !normalizedModel) {
    return null;
  }

  return {
    id: normalizedId,
    model: normalizedModel,
    modelProvider: normalizedProvider,
    provider: normalizedProvider,
    displayName: readString(displayName) || normalizedModel,
    description: readString(description),
    isDefault,
    supportsFastMode,
    supportedReasoningEfforts,
    defaultReasoningEffort,
  };
}

function stripProviderFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const clone = { ...value };
  for (const key of PROVIDER_FIELD_KEYS) {
    delete clone[key];
  }

  if (clone.collaborationMode?.settings) {
    clone.collaborationMode = {
      ...clone.collaborationMode,
      settings: stripProviderFields(clone.collaborationMode.settings),
    };
  }
  if (clone.collaboration_mode?.settings) {
    clone.collaboration_mode = {
      ...clone.collaboration_mode,
      settings: stripProviderFields(clone.collaboration_mode.settings),
    };
  }
  return clone;
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function hasOwnProviderField(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return PROVIDER_FIELD_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

module.exports = {
  CODEX_PROVIDER_ID,
  CURSOR_PROVIDER_ID,
  PROVIDER_FIELD_KEYS,
  buildRuntimeModelOption,
  hasExplicitProviderField,
  isCodexProvider,
  isCursorProvider,
  normalizeRuntimeProvider,
  readModelProvider,
  stripProviderFields,
};
