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
  lookupOpenCodeAccountRefusal,
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

test("lookupOpenCodeAccountRefusal returns auth_not_supported for account/login/complete", () => {
  const refusal = lookupOpenCodeAccountRefusal("account/login/complete");
  assert.equal(refusal.errorCode, "auth_not_supported");
  assert.ok(refusal.message.includes("login"));
});

test("lookupOpenCodeAccountRefusal returns voice_not_supported for voice/resolveAuth", () => {
  const refusal = lookupOpenCodeAccountRefusal("voice/resolveAuth");
  assert.equal(refusal.errorCode, "voice_not_supported");
  assert.ok(refusal.message.includes("Voice authentication"));
});

test("lookupOpenCodeAccountRefusal returns null for unknown methods", () => {
  assert.equal(lookupOpenCodeAccountRefusal("some/random"), null);
  assert.equal(lookupOpenCodeAccountRefusal(""), null);
  assert.equal(lookupOpenCodeAccountRefusal(null), null);
});

test("lookupOpenCodeAccountRefusal recognizes all seven account methods", () => {
  const methods = [
    "account/login/start",
    "account/login/cancel",
    "account/login/complete",
    "account/login/openOnMac",
    "account/logout",
    "voice/resolveAuth",
    "account/rateLimits/read",
  ];
  for (const m of methods) {
    const refusal = lookupOpenCodeAccountRefusal(m);
    assert.notEqual(refusal, null, `Expected refusal for ${m}`);
    assert.ok(refusal.errorCode, `Expected errorCode for ${m}`);
  }
});

test("resolveRuntimeTransportFactory selects OpenCode transport when provider is opencode", () => {
  const factory = resolveRuntimeTransportFactory({ REMODEX_PROVIDER: "opencode" });
  assert.equal(factory.name, "createOpenCodeTransport");
});

test("resolveRuntimeTransportFactory selects Codex transport by default", () => {
  const factory = resolveRuntimeTransportFactory({});
  assert.equal(factory.name, "createCodexTransport");
});
