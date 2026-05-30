// FILE: opencode-regression.test.js
// Purpose: Verifies that REMODEX_ENABLE_OPENCODE=0 disables OpenCode correctly:
//          runtime catalog excludes opencode, and the provider is not created.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/runtime-provider-router

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntimeProviderRouter } = require("../src/runtime-provider-router");

function waitOneTick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("runtime catalog excludes opencode when flag is off", async () => {
  const responses = [];
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({}),
    sendApplicationResponse: (msg) => responses.push(JSON.parse(msg)),
    sendRuntimeMessage: () => {},
    logPrefix: "[test]",
  });

  // Set env flag off
  process.env.REMODEX_ENABLE_OPENCODE = "0";

  router.handleApplicationMessage(
    JSON.stringify({ id: 1, method: "runtime/catalog" }),
  );
  await waitOneTick();

  const catalog = responses.find((r) => r.id === 1)?.result;
  assert.ok(catalog, "runtime/catalog should produce a result");
  assert.ok(Array.isArray(catalog.runtimes), "runtimes should be an array");
  assert.ok(catalog.runtimes.some((r) => r.id === "codex"), "codex should be present");
  assert.ok(
    !catalog.runtimes.some((r) => r.id === "opencode"),
    "opencode should not be in catalog when flag is off",
  );

  delete process.env.REMODEX_ENABLE_OPENCODE;
});

test("provider is not created when flag is off", () => {
  // The resolveProviders function in runtime-provider-router checks
  // REMODEX_ENABLE_OPENCODE env var. When NOT "1", it returns [].
  // The router's .providers is set from resolveProviders called at creation.
  //
  // Since resolveProviders uses process.env directly (line 424), we set it
  // before creating the router.

  process.env.REMODEX_ENABLE_OPENCODE = "0";
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({}),
    sendApplicationResponse: () => {},
    sendRuntimeMessage: () => {},
    logPrefix: "[test]",
  });
  delete process.env.REMODEX_ENABLE_OPENCODE;

  assert.equal(router.providers.length, 0, "no providers should be created when flag is off");
});
