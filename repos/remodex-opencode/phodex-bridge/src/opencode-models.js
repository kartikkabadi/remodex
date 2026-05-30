// FILE: opencode-models.js
// Purpose: Normalizes OpenCode CLI model metadata into Remodex provider-aware model entries.
// Layer: Bridge runtime provider helper
// Exports: OpenCode provider constants plus model/provider parsing helpers.
// Depends on: none

const CODEX_PROVIDER_ID = "codex";
const OPENCODE_PROVIDER_ID = "opencode";
const DEFAULT_OPENCODE_MODEL = "opencode/gpt-5.5";

function normalizeRuntimeProvider(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "":
      return CODEX_PROVIDER_ID;
    case "open-code":
    case "open_code":
      return OPENCODE_PROVIDER_ID;
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

function isOpenCodeProvider(value) {
  return normalizeRuntimeProvider(value) === OPENCODE_PROVIDER_ID;
}

function isCodexProvider(value) {
  return normalizeRuntimeProvider(value) === CODEX_PROVIDER_ID;
}

function buildOpenCodeModelOption(modelReference, { isDefault = false } = {}) {
  const normalizedReference = normalizeOpenCodeModelReference(modelReference);
  if (!normalizedReference) {
    return null;
  }

  return {
    id: normalizedReference,
    model: normalizedReference,
    modelProvider: OPENCODE_PROVIDER_ID,
    provider: OPENCODE_PROVIDER_ID,
    displayName: displayNameForOpenCodeModel(normalizedReference),
    description: `OpenCode local provider model (${normalizedReference})`,
    isDefault,
    supportsFastMode: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
  };
}

function parseOpenCodeModelsOutput(output) {
  const seen = new Set();
  const models = [];
  const lines = String(output || "").split(/\r?\n/);

  for (const line of lines) {
    const modelReference = normalizeOpenCodeModelReference(line);
    if (!modelReference || seen.has(modelReference)) {
      continue;
    }

    seen.add(modelReference);
    models.push(buildOpenCodeModelOption(modelReference, {
      isDefault: modelReference === DEFAULT_OPENCODE_MODEL,
    }));
  }

  return models.filter(Boolean);
}

function normalizeOpenCodeModelReference(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.startsWith("{") || normalized.startsWith("[")) {
    return "";
  }
  if (!/^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function displayNameForOpenCodeModel(modelReference) {
  const normalized = normalizeOpenCodeModelReference(modelReference);
  const modelId = normalized.split("/").pop() || normalized;
  const lowered = modelId.toLowerCase();

  if (lowered.startsWith("gpt-")) {
    return `GPT-${modelId.slice(4)}`;
  }
  if (lowered.startsWith("claude-")) {
    return modelId
      .split("-")
      .map((part) => (part.length <= 2 ? part.toUpperCase() : titleCase(part)))
      .join(" ");
  }

  return modelId
    .split(/[-_]/)
    .map(titleCase)
    .join(" ");
}

function titleCase(value) {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

module.exports = {
  CODEX_PROVIDER_ID,
  DEFAULT_OPENCODE_MODEL,
  OPENCODE_PROVIDER_ID,
  buildOpenCodeModelOption,
  displayNameForOpenCodeModel,
  isCodexProvider,
  isOpenCodeProvider,
  normalizeOpenCodeModelReference,
  normalizeRuntimeProvider,
  parseOpenCodeModelsOutput,
  readModelProvider,
};
