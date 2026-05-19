// FILE: telegram-runtime-preferences.js
// Purpose: Owns Remodex Telegram runtime model, reasoning-effort, and speed choices.
// Layer: CLI helper
// Exports: Telegram runtime defaults, choices, and normalization helpers.

const TELEGRAM_DEFAULT_MODEL = "gpt-5.5";
const TELEGRAM_DEFAULT_REASONING_EFFORT = "medium";
const TELEGRAM_DEFAULT_SERVICE_TIER = "";
const TELEGRAM_DEFAULT_ACCESS_MODE = "on-request";

const TELEGRAM_MODEL_CHOICES = [
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.3-codex-spark", label: "Codex Spark" },
];

const TELEGRAM_REASONING_EFFORT_CHOICES = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "XHigh" },
];

const TELEGRAM_SERVICE_TIER_CHOICES = [
  { id: "normal", value: "", label: "Normal" },
  { id: "fast", value: "fast", label: "Fast" },
];

const TELEGRAM_ACCESS_MODE_CHOICES = [
  { id: "on-request", label: "On-Request" },
  { id: "full-access", label: "Full Access" },
];

function normalizeTelegramRuntimePreferences(value = {}, fallback = {}) {
  const model = normalizeTelegramModel(value.model || value.runtimeModel)
    || normalizeTelegramModel(fallback.model || fallback.runtimeModel)
    || TELEGRAM_DEFAULT_MODEL;
  const reasoningEffort = normalizeTelegramReasoningEffort(value.reasoningEffort || value.effort)
    || normalizeTelegramReasoningEffort(fallback.reasoningEffort || fallback.effort)
    || TELEGRAM_DEFAULT_REASONING_EFFORT;
  const serviceTierValue = firstRuntimePreferenceValue(value.serviceTier, value.runtimeServiceTier, value.speed);
  const fallbackServiceTierValue = firstRuntimePreferenceValue(fallback.serviceTier, fallback.runtimeServiceTier, fallback.speed);
  const serviceTier = serviceTierValue !== undefined
    ? normalizeTelegramServiceTier(serviceTierValue)
    : normalizeTelegramServiceTier(fallbackServiceTierValue) || TELEGRAM_DEFAULT_SERVICE_TIER;
  return { model, reasoningEffort, serviceTier };
}

function normalizeTelegramModel(value) {
  const normalized = normalizeNonEmptyString(value).toLowerCase();
  return TELEGRAM_MODEL_CHOICES.some((choice) => choice.id === normalized) ? normalized : "";
}

function normalizeTelegramReasoningEffort(value) {
  const normalized = normalizeNonEmptyString(value).toLowerCase();
  return TELEGRAM_REASONING_EFFORT_CHOICES.some((choice) => choice.id === normalized) ? normalized : "";
}

function normalizeTelegramServiceTier(value) {
  const normalized = normalizeNonEmptyString(value).toLowerCase().replaceAll("_", "-");
  if (["", "normal", "default", "standard", "off", "none"].includes(normalized)) {
    return TELEGRAM_DEFAULT_SERVICE_TIER;
  }
  if (["fast", "speed", "faster", "fast-mode", "fastmode"].includes(normalized)) {
    return "fast";
  }
  return "";
}

function normalizeTelegramAccessMode(value) {
  const normalized = normalizeNonEmptyString(value).toLowerCase().replaceAll("_", "-");
  if (["ask", "onrequest", "on-request"].includes(normalized)) {
    return "on-request";
  }
  if (["full", "fullaccess", "full-access"].includes(normalized)) {
    return "full-access";
  }
  return "";
}

function telegramModelLabel(model) {
  const normalized = normalizeTelegramModel(model);
  return TELEGRAM_MODEL_CHOICES.find((choice) => choice.id === normalized)?.label || TELEGRAM_MODEL_CHOICES[0].label;
}

function telegramReasoningEffortLabel(reasoningEffort) {
  const normalized = normalizeTelegramReasoningEffort(reasoningEffort);
  return TELEGRAM_REASONING_EFFORT_CHOICES.find((choice) => choice.id === normalized)?.label || TELEGRAM_REASONING_EFFORT_CHOICES[1].label;
}

function telegramServiceTierLabel(serviceTier) {
  const normalized = normalizeTelegramServiceTier(serviceTier);
  return TELEGRAM_SERVICE_TIER_CHOICES.find((choice) => choice.value === normalized)?.label || TELEGRAM_SERVICE_TIER_CHOICES[0].label;
}

function telegramAccessModeLabel(accessMode) {
  const normalized = normalizeTelegramAccessMode(accessMode) || TELEGRAM_DEFAULT_ACCESS_MODE;
  return TELEGRAM_ACCESS_MODE_CHOICES.find((choice) => choice.id === normalized)?.label || TELEGRAM_ACCESS_MODE_CHOICES[0].label;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : String(value ?? "").trim();
}

function firstRuntimePreferenceValue(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

module.exports = {
  TELEGRAM_DEFAULT_MODEL,
  TELEGRAM_DEFAULT_REASONING_EFFORT,
  TELEGRAM_DEFAULT_SERVICE_TIER,
  TELEGRAM_DEFAULT_ACCESS_MODE,
  TELEGRAM_ACCESS_MODE_CHOICES,
  TELEGRAM_MODEL_CHOICES,
  TELEGRAM_REASONING_EFFORT_CHOICES,
  TELEGRAM_SERVICE_TIER_CHOICES,
  normalizeTelegramAccessMode,
  normalizeTelegramModel,
  normalizeTelegramReasoningEffort,
  normalizeTelegramRuntimePreferences,
  normalizeTelegramServiceTier,
  telegramAccessModeLabel,
  telegramModelLabel,
  telegramReasoningEffortLabel,
  telegramServiceTierLabel,
};
