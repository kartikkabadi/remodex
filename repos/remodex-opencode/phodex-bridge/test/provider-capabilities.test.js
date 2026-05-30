// FILE: provider-capabilities.test.js
// Purpose: Verifies model-level capability resolution and per-provider capability defaults.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/provider-capabilities

const test = require("node:test");
const assert = require("node:assert/strict");
const { CAPABILITIES, resolveModelCapabilities } = require("../src/provider-capabilities");

test("Codex provider has fast mode and plan mode enabled", () => {
  const capabilities = resolveModelCapabilities("codex", {});
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_FAST_MODE], true);
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_PLAN_MODE], true);
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_AGENT_SELECTION], false);
});

test("OpenCode provider has agent selection enabled and fast/plan mode disabled", () => {
  const capabilities = resolveModelCapabilities("opencode", {});
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_AGENT_SELECTION], true);
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_FAST_MODE], false);
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_PLAN_MODE], false);
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_VOICE], false);
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_DESKTOP_HANDOFF], false);
});

test("reasoning effort enabled when model has supportedReasoningEfforts", () => {
  const capabilities = resolveModelCapabilities("opencode", {
    supportedReasoningEfforts: [{ reasoningEffort: "high" }],
  });
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_REASONING_EFFORT], true);
});

test("reasoning effort disabled when supportedReasoningEfforts is empty", () => {
  const capabilities = resolveModelCapabilities("opencode", {
    supportedReasoningEfforts: [],
  });
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_REASONING_EFFORT], false);
});

test("reasoning effort disabled when model data is null", () => {
  const capabilities = resolveModelCapabilities("opencode", null);
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_REASONING_EFFORT], false);
});

test("reasoning effort enabled from reasoningEfforts alt field", () => {
  const capabilities = resolveModelCapabilities("codex", {
    reasoningEfforts: [{ reasoningEffort: "medium" }],
  });
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_REASONING_EFFORT], true);
});

test("reasoning effort enabled from boolean hasReasoning", () => {
  const capabilities = resolveModelCapabilities("opencode", {
    hasReasoning: true,
  });
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_REASONING_EFFORT], true);
});

test("unknown provider defaults to Codex capabilities", () => {
  const capabilities = resolveModelCapabilities("", {});
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_FAST_MODE], true);
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_AGENT_SELECTION], false);
});

test("OpenCode always has MCP disabled", () => {
  const capabilities = resolveModelCapabilities("opencode", {});
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_MCP], false);
});

test("Codex always has MCP enabled", () => {
  const capabilities = resolveModelCapabilities("codex", {});
  assert.equal(capabilities[CAPABILITIES.SUPPORTS_MCP], true);
});
