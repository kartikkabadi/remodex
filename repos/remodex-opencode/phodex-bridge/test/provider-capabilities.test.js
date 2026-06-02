// FILE: provider-capabilities.test.js
// Purpose: Verifies model-level capability resolution and per-provider capability defaults.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/provider-capabilities

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveModelCapabilities,
  resolveOpenCodeCatalogCapabilities,
} = require("../src/provider-capabilities");

test("Codex provider has standard capabilities (no agent selection)", () => {
  const capabilities = resolveModelCapabilities("codex", {});
  assert.equal(capabilities.supportsFastMode, true);
  assert.equal(capabilities.supportsPlanMode, true);
  assert.equal(capabilities.supportsAgentSelection, false);
  assert.equal(capabilities.supportsVoice, true);
  assert.equal(capabilities.supportsDesktopHandoff, true);
  assert.equal(capabilities.supportsWorktree, true);
  assert.equal(capabilities.supportsFork, true);
  assert.equal(capabilities.supportsApprovals, true);
  assert.equal(capabilities.supportsStreamingTools, true);
  assert.equal(capabilities.supportsSlashCommands, true);
  assert.equal(capabilities.supportsMCP, true);
});

test("OpenCode provider has agent selection enabled and fast/plan/voice/desktop/worktree disabled", () => {
  const capabilities = resolveModelCapabilities("opencode", {});
  assert.equal(capabilities.supportsAgentSelection, true);
  assert.equal(capabilities.supportsFastMode, false);
  assert.equal(capabilities.supportsPlanMode, false);
  assert.equal(capabilities.supportsVoice, false);
  assert.equal(capabilities.supportsDesktopHandoff, false);
  assert.equal(capabilities.supportsWorktree, false);
  assert.equal(capabilities.supportsFork, true);
  assert.equal(capabilities.supportsApprovals, true);
  assert.equal(capabilities.supportsStreamingTools, true);
  assert.equal(capabilities.supportsSlashCommands, true);
  assert.equal(capabilities.supportsMCP, false);
});

test("reasoning effort enabled when model has supportedReasoningEfforts", () => {
  const capabilities = resolveModelCapabilities("opencode", {
    supportedReasoningEfforts: [{ reasoningEffort: "high" }],
  });
  assert.equal(capabilities.supportsReasoningEffort, true);
});

test("reasoning effort disabled when supportedReasoningEfforts is empty", () => {
  const capabilities = resolveModelCapabilities("opencode", {
    supportedReasoningEfforts: [],
  });
  assert.equal(capabilities.supportsReasoningEffort, false);
});

test("reasoning effort disabled when model data is null", () => {
  const capabilities = resolveModelCapabilities("opencode", null);
  assert.equal(capabilities.supportsReasoningEffort, false);
});

test("reasoning effort enabled from reasoningEfforts alt field", () => {
  const capabilities = resolveModelCapabilities("opencode", {
    reasoningEfforts: [{ reasoningEffort: "medium" }],
  });
  assert.equal(capabilities.supportsReasoningEffort, true);
});

test("reasoning effort enabled from boolean hasReasoning", () => {
  const capabilities = resolveModelCapabilities("opencode", {
    hasReasoning: true,
  });
  assert.equal(capabilities.supportsReasoningEffort, true);
});

test("reasoning effort enabled from boolean supportsReasoning", () => {
  const capabilities = resolveModelCapabilities("opencode", {
    supportsReasoning: true,
  });
  assert.equal(capabilities.supportsReasoningEffort, true);
});

test("unknown provider defaults to Codex capabilities", () => {
  const capabilities = resolveModelCapabilities("", {});
  assert.equal(capabilities.supportsFastMode, true);
  assert.equal(capabilities.supportsAgentSelection, false);
  assert.equal(capabilities.supportsVoice, true);
});

test("OpenCode MCP is greyed in catalog (configured on Mac, not in Remodex)", () => {
  const capabilities = resolveModelCapabilities("opencode", {});
  assert.equal(capabilities.supportsMCP, false);
});

test("Codex MCP is enabled", () => {
  const capabilities = resolveModelCapabilities("codex", {});
  assert.equal(capabilities.supportsMCP, true);
});

test("Codex supports structured skill input on turn/start", () => {
  const capabilities = resolveModelCapabilities("codex", {});
  assert.equal(capabilities.supportsStructuredSkillInput, true);
});

test("OpenCode does not enable structured skill input until SDK spike", () => {
  const capabilities = resolveModelCapabilities("opencode", {});
  assert.equal(capabilities.supportsStructuredSkillInput, false);
  assert.equal(capabilities.supportsSkillAutocomplete, true);
});

test("OpenCode catalog keeps supportsDesktopHandoff false until device E2E (PR8)", () => {
  assert.equal(resolveOpenCodeCatalogCapabilities({}).supportsDesktopHandoff, false);
  assert.equal(
    resolveModelCapabilities("opencode", {}, {}).supportsDesktopHandoff,
    false,
  );
});

test("OpenCode catalog snapshot matches docs/contracts/bridge-rpc.md example (PR1)", () => {
  const capabilities = resolveOpenCodeCatalogCapabilities({});
  const expected = {
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
    supportsMCP: false,
    supportsSkillAutocomplete: true,
    supportsStructuredSkillInput: false,
    supportsSteer: false,
    supportsQueue: true,
  };
  assert.deepEqual(capabilities, expected);
});
