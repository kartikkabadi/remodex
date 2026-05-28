// FILE: cursor-models.js
// Purpose: Converts Cursor ACP model config options into Remodex model/list entries.
// Layer: Bridge runtime provider helper
// Exports: Cursor provider constants plus ACP model parsing helpers.
// Depends on: ./runtime-provider-models

const {
  CURSOR_PROVIDER_ID,
  buildRuntimeModelOption,
} = require("./runtime-provider-models");

const DEFAULT_CURSOR_MODEL = "composer-2.5";

function parseCursorModelsFromSessionResult(sessionResult = {}) {
  const modelConfig = readModelConfigOption(sessionResult.configOptions);
  if (!modelConfig) {
    return [buildCursorModelOption(DEFAULT_CURSOR_MODEL, { name: "Composer 2.5" }, true)].filter(Boolean);
  }

  const currentValue = readString(modelConfig.currentValue);
  const options = flattenModelOptions(modelConfig.options);
  const seen = new Set();
  const models = [];

  for (const option of options) {
    const modelId = readString(option.value || option.modelId || option.id);
    if (!modelId || seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    const model = buildCursorModelOption(modelId, option, modelId === currentValue);
    if (model) {
      models.push(model);
    }
  }

  return models.length
    ? models
    : [buildCursorModelOption(currentValue || DEFAULT_CURSOR_MODEL, { name: "Cursor" }, true)].filter(Boolean);
}

function readModelConfigOption(configOptions) {
  const options = Array.isArray(configOptions) ? configOptions : [];
  return options.find((option) => {
    const category = readString(option?.category).toLowerCase();
    const id = readString(option?.id).toLowerCase();
    return category === "model" || id === "model";
  }) || null;
}

function flattenModelOptions(options) {
  if (!Array.isArray(options)) {
    return [];
  }

  const flattened = [];
  for (const option of options) {
    if (Array.isArray(option?.options)) {
      flattened.push(...flattenModelOptions(option.options));
    } else if (option && typeof option === "object") {
      flattened.push(option);
    }
  }
  return flattened;
}

function buildCursorModelOption(modelReference, option = {}, isDefault = false) {
  const normalizedReference = normalizeCursorModelReference(modelReference);
  if (!normalizedReference) {
    return null;
  }

  return buildRuntimeModelOption({
    provider: CURSOR_PROVIDER_ID,
    id: normalizedReference,
    model: normalizedReference,
    displayName: readString(option.name) || displayNameForCursorModel(normalizedReference),
    description: readString(option.description) || `Cursor ACP model (${normalizedReference})`,
    isDefault,
    supportsFastMode: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
  });
}

function normalizeCursorModelReference(value) {
  const normalized = readString(value);
  if (!normalized || normalized.startsWith("{") || normalized.startsWith("[")) {
    return "";
  }
  if (!/^[A-Za-z0-9._:-]+(?:\[[^\]\r\n]*\])?$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function displayNameForCursorModel(modelReference) {
  const normalized = normalizeCursorModelReference(modelReference);
  const base = normalized.split("[")[0] || normalized;
  const lowered = base.toLowerCase();

  if (lowered === "default") {
    return "Auto";
  }
  if (lowered.startsWith("gpt-")) {
    return `GPT-${base.slice(4)}`;
  }
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map(titleCase)
    .join(" ");
}

function titleCase(value) {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  CURSOR_PROVIDER_ID,
  DEFAULT_CURSOR_MODEL,
  buildCursorModelOption,
  displayNameForCursorModel,
  normalizeCursorModelReference,
  parseCursorModelsFromSessionResult,
  readModelConfigOption,
};
