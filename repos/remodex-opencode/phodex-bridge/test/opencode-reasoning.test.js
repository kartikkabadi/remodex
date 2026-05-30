// FILE: opencode-reasoning.test.js
// Purpose: Verifies reasoning effort extraction from OpenCode model variants using real
//          payload shapes from OpenAI, Anthropic, Google Gemini, Bedrock, and OpenRouter.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/opencode-reasoning

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractReasoningEffort,
  inferDefaultReasoningEffort,
  normalizeReasoningEfforts,
} = require("../src/opencode-reasoning");

test("extracts reasoningEffort from OpenAI-style variants", () => {
  const variants = {
    low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
  };
  const efforts = normalizeReasoningEfforts(variants);
  assert.deepEqual(efforts.map((e) => e.reasoningEffort), ["low", "medium", "high"]);
});

test("extracts reasoning_effort from snake_case OpenAI variants", () => {
  const variants = {
    low: { reasoning_effort: "low" },
    high: { reasoning_effort: "high" },
  };
  const efforts = normalizeReasoningEfforts(variants);
  assert.deepEqual(efforts.map((e) => e.reasoningEffort), ["low", "high"]);
});

test("extracts effort field directly", () => {
  const variants = {
    fast: { effort: "low" },
    smart: { effort: "high" },
  };
  const efforts = normalizeReasoningEfforts(variants);
  assert.deepEqual(efforts.map((e) => e.reasoningEffort), ["low", "high"]);
});

test("extracts thinkingConfig.thinkingLevel from Google Gemini variants", () => {
  const variants = {
    low: { thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } },
    high: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
  };
  const efforts = normalizeReasoningEfforts(variants);
  assert.deepEqual(efforts.map((e) => e.reasoningEffort), ["low", "high"]);
});

test("extracts thinking_config.thinking_level from snake_case Gemini variants", () => {
  const variants = {
    med: { thinking_config: { include_thoughts: true, thinking_level: "medium" } },
  };
  const efforts = normalizeReasoningEfforts(variants);
  assert.equal(efforts.length, 1);
  assert.equal(efforts[0].reasoningEffort, "medium");
});

test("extracts reasoning.effort from OpenRouter variants", () => {
  const variants = {
    low: { reasoning: { effort: "low" } },
    high: { reasoning: { effort: "high" } },
  };
  const efforts = normalizeReasoningEfforts(variants);
  assert.deepEqual(efforts.map((e) => e.reasoningEffort), ["low", "high"]);
});

test("extracts reasoningConfig.maxReasoningEffort from Bedrock variants", () => {
  const variants = {
    high: { reasoningConfig: { type: "enabled", maxReasoningEffort: "high" } },
  };
  const efforts = normalizeReasoningEfforts(variants);
  assert.equal(efforts.length, 1);
  assert.equal(efforts[0].reasoningEffort, "high");
});

test("extracts reasoning_config.max_reasoning_effort from snake_case Bedrock variants", () => {
  const variants = {
    med: { reasoning_config: { type: "enabled", max_reasoning_effort: "medium" } },
  };
  const efforts = normalizeReasoningEfforts(variants);
  assert.equal(efforts.length, 1);
  assert.equal(efforts[0].reasoningEffort, "medium");
});

test("extracts thinking object exists (Anthropic) — uses variant key as effort", () => {
  const variants = {
    high: { thinking: { type: "enabled", budgetTokens: 16000 } },
    max: { thinking: { type: "enabled", budgetTokens: 32000 } },
  };
  const efforts = normalizeReasoningEfforts(variants);
  assert.deepEqual(efforts.map((e) => e.reasoningEffort), ["high", "max"]);
});

test("extracts thinking.effort from Anthropic adaptive variants", () => {
  const variants = {
    high: { thinking: { type: "adaptive" }, effort: "high" },
  };
  const efforts = normalizeReasoningEfforts(variants);
  assert.equal(efforts.length, 1);
  assert.equal(efforts[0].reasoningEffort, "high");
});

test("empty variant uses variant key as effort value", () => {
  const variants = {
    low: {},
    medium: {},
  };
  const efforts = normalizeReasoningEfforts(variants);
  assert.deepEqual(efforts.map((e) => e.reasoningEffort), ["low", "medium"]);
});

test("excludes variants with no recognizable reasoning metadata", () => {
  const variants = {
    custom_pricing: { priceTier: "premium" },
    high: { reasoningEffort: "high" },
  };
  const efforts = normalizeReasoningEfforts(variants);
  assert.equal(efforts.length, 1);
  assert.equal(efforts[0].reasoningEffort, "high");
});

test("returns empty array for null/undefined variants", () => {
  assert.deepEqual(normalizeReasoningEfforts(null), []);
  assert.deepEqual(normalizeReasoningEfforts(undefined), []);
  assert.deepEqual(normalizeReasoningEfforts([]), []);
});

test("deduplicates repeated effort values", () => {
  const variants = {
    low: { reasoningEffort: "low" },
    also_low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
  };
  const efforts = normalizeReasoningEfforts(variants);
  assert.equal(efforts.length, 2);
  assert.deepEqual(efforts.map((e) => e.reasoningEffort), ["low", "medium"]);
});

test("formatEffortDescription produces human labels", () => {
  const variants = {
    low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
    xhigh: { reasoningEffort: "xhigh" },
    max: { reasoningEffort: "max" },
    minimal: { reasoningEffort: "minimal" },
  };
  const efforts = normalizeReasoningEfforts(variants);
  assert.deepEqual(efforts.map((e) => e.description), [
    "Low reasoning",
    "Medium reasoning",
    "High reasoning",
    "Extra high reasoning",
    "Maximum reasoning",
    "Minimal reasoning",
  ]);
});

test("inferDefaultReasoningEffort picks 'high' for Anthropic providers", () => {
  const efforts = [
    { reasoningEffort: "low" },
    { reasoningEffort: "medium" },
    { reasoningEffort: "high" },
  ];
  assert.equal(inferDefaultReasoningEffort(efforts, "anthropic"), "high");
});

test("inferDefaultReasoningEffort picks 'high' for Google providers", () => {
  const efforts = [
    { reasoningEffort: "low" },
    { reasoningEffort: "high" },
  ];
  assert.equal(inferDefaultReasoningEffort(efforts, "google"), "high");
});

test("inferDefaultReasoningEffort prefers 'high' when available", () => {
  const efforts = [
    { reasoningEffort: "low" },
    { reasoningEffort: "medium" },
    { reasoningEffort: "high" },
  ];
  assert.equal(inferDefaultReasoningEffort(efforts, "openai"), "high");
});

test("inferDefaultReasoningEffort prefers 'high' when medium and high available", () => {
  const efforts = [
    { reasoningEffort: "low" },
    { reasoningEffort: "medium" },
    { reasoningEffort: "high" },
  ];
  assert.equal(inferDefaultReasoningEffort(efforts, "opencode"), "high");
});

test("inferDefaultReasoningEffort prefers 'high' from available efforts", () => {
  const efforts = [
    { reasoningEffort: "low" },
    { reasoningEffort: "medium" },
    { reasoningEffort: "high" },
  ];
  assert.equal(inferDefaultReasoningEffort(efforts, "xai"), "high");
});

test("inferDefaultReasoningEffort returns null for empty efforts", () => {
  assert.equal(inferDefaultReasoningEffort([], "anthropic"), null);
  assert.equal(inferDefaultReasoningEffort(null, "anthropic"), null);
});

test("inferDefaultReasoningEffort returns single effort directly", () => {
  const efforts = [{ reasoningEffort: "high" }];
  assert.equal(inferDefaultReasoningEffort(efforts, "anthropic"), "high");
});

test("inferDefaultReasoningEffort falls back to first value when preferred not found", () => {
  const efforts = [
    { reasoningEffort: "low" },
    { reasoningEffort: "minimal" },
  ];
  assert.equal(inferDefaultReasoningEffort(efforts, "anthropic"), "low");
});
