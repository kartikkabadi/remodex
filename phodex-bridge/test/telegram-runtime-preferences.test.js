// FILE: telegram-runtime-preferences.test.js
// Purpose: Verifies Telegram runtime preference normalization and labels.
// Layer: Unit Test

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TELEGRAM_DEFAULT_ACCESS_MODE,
  TELEGRAM_DEFAULT_MODEL,
  TELEGRAM_DEFAULT_REASONING_EFFORT,
  normalizeTelegramAccessMode,
  normalizeTelegramModel,
  normalizeTelegramReasoningEffort,
  normalizeTelegramRuntimePreferences,
  normalizeTelegramServiceTier,
  telegramAccessModeLabel,
  telegramModelLabel,
  telegramReasoningEffortLabel,
  telegramServiceTierLabel,
} = require("../src/telegram-runtime-preferences");

test("telegram runtime preferences normalize defaults", () => {
  assert.deepEqual(normalizeTelegramRuntimePreferences({}), {
    model: TELEGRAM_DEFAULT_MODEL,
    reasoningEffort: TELEGRAM_DEFAULT_REASONING_EFFORT,
    serviceTier: "",
  });
});

test("telegram runtime preferences accept linked chat runtime fields", () => {
  assert.deepEqual(normalizeTelegramRuntimePreferences({
    runtimeModel: "gpt-5.4-mini",
    reasoningEffort: "high",
    runtimeServiceTier: "fast",
  }), {
    model: "gpt-5.4-mini",
    reasoningEffort: "high",
    serviceTier: "fast",
  });
});

test("telegram runtime preferences reject unknown model and effort", () => {
  assert.equal(normalizeTelegramModel("not-a-model"), "");
  assert.equal(normalizeTelegramReasoningEffort("turbo"), "");
});

test("telegram runtime preferences normalize access mode and service tier aliases", () => {
  assert.equal(normalizeTelegramAccessMode("full"), "full-access");
  assert.equal(normalizeTelegramAccessMode("ask"), "on-request");
  assert.equal(normalizeTelegramServiceTier("normal"), "");
  assert.equal(normalizeTelegramServiceTier("faster"), "fast");
});

test("telegram runtime preference labels stay stable", () => {
  assert.equal(telegramModelLabel("gpt-5.4-mini"), "GPT-5.4 Mini");
  assert.equal(telegramReasoningEffortLabel("high"), "High");
  assert.equal(telegramServiceTierLabel("fast"), "Fast");
  assert.equal(telegramAccessModeLabel(TELEGRAM_DEFAULT_ACCESS_MODE), "On-Request");
});
