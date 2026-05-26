// FILE: opencode-runtime-policy.test.js
// Purpose: Verifies shared OpenCode runtime provider selection and refusal tables.
// Layer: Unit test
// Depends on: node:test, node:assert/strict, ../src/opencode-runtime-policy

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isOpenCodeRuntime,
  lookupOpenCodeTransportRefusal,
  lookupCodexOnlyBridgeRefusal,
  resolveRuntimeTransportFactory,
} = require("../src/opencode-runtime-policy");

test("isOpenCodeRuntime returns true when REMODEX_PROVIDER=opencode", () => {
  assert.equal(isOpenCodeRuntime({ REMODEX_PROVIDER: "opencode" }), true);
  assert.equal(isOpenCodeRuntime({ REMODEX_PROVIDER: "codex" }), false);
  assert.equal(isOpenCodeRuntime({}), false);
});

test("lookupOpenCodeTransportRefusal returns voice and steer refusals", () => {
  const voice = lookupOpenCodeTransportRefusal("voice/transcribe");
  assert.equal(voice.errorCode, "voice_not_supported");
  const steer = lookupOpenCodeTransportRefusal("turn/steer");
  assert.equal(steer.errorCode, "turn_steer_not_supported");
});

test("lookupCodexOnlyBridgeRefusal returns codex_only_feature for title generation", () => {
  const refusal = lookupCodexOnlyBridgeRefusal("thread/generateTitle");
  assert.equal(refusal.errorCode, "codex_only_feature");
});

test("resolveRuntimeTransportFactory selects OpenCode transport when provider is opencode", () => {
  const factory = resolveRuntimeTransportFactory({ REMODEX_PROVIDER: "opencode" });
  assert.equal(factory.name, "createOpenCodeTransport");
});

test("resolveRuntimeTransportFactory selects Codex transport by default", () => {
  const factory = resolveRuntimeTransportFactory({});
  assert.equal(factory.name, "createCodexTransport");
});
