// FILE: opencode-regression.test.js
// Purpose: Verifies that explicit OpenCode disable flags keep Codex-only routing:
//          runtime catalog excludes opencode, and the provider is not created.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/runtime-provider-router, ./test-env (preload)

if (process.env.REMODEX_TEST !== "1") {
  throw new Error(
    "opencode-regression.test.js must run with the test harness preload.\n" +
      "  npm test\n" +
      "  node -r ./test/test-env.js --test ./test/opencode-regression.test.js\n" +
      "Without -r ./test/test-env.js, tests may spawn live opencode serve and hang.",
  );
}

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

  process.env.REMODEX_DISABLE_OPENCODE = "1";

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

  delete process.env.REMODEX_DISABLE_OPENCODE;
});

test("runtime catalog includes opencode by default", async () => {
  const responses = [];
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({}),
    sendApplicationResponse: (msg) => responses.push(JSON.parse(msg)),
    sendRuntimeMessage: () => {},
    providers: [],
    logPrefix: "[test]",
  });

  const previousDisable = process.env.REMODEX_DISABLE_OPENCODE;
  const previousEnable = process.env.REMODEX_ENABLE_OPENCODE;
  delete process.env.REMODEX_DISABLE_OPENCODE;
  delete process.env.REMODEX_ENABLE_OPENCODE;

  router.handleApplicationMessage(
    JSON.stringify({ id: 3, method: "runtime/catalog" }),
  );
  await waitOneTick();

  const catalog = responses.find((r) => r.id === 3)?.result;
  const opencodeRuntime = catalog.runtimes.find((runtime) => runtime.id === "opencode");
  assert.ok(opencodeRuntime, "opencode should be advertised by default");
  assert.equal(opencodeRuntime.enabled, false);
  assert.equal(opencodeRuntime.reasonCode, "opencode_not_enabled");

  if (previousDisable === undefined) {
    delete process.env.REMODEX_DISABLE_OPENCODE;
  } else {
    process.env.REMODEX_DISABLE_OPENCODE = previousDisable;
  }
  if (previousEnable === undefined) {
    delete process.env.REMODEX_ENABLE_OPENCODE;
  } else {
    process.env.REMODEX_ENABLE_OPENCODE = previousEnable;
  }
});

test("runtime catalog exposes showsBetaLabel on opencode runtime", async () => {
  const responses = [];
  const mockOpenCodeProvider = {
    id: "opencode",
    listAgents: async () => [{ id: "build", label: "Build" }],
  };
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({}),
    sendApplicationResponse: (msg) => responses.push(JSON.parse(msg)),
    sendRuntimeMessage: () => {},
    providers: [mockOpenCodeProvider],
    logPrefix: "[test]",
  });

  const previousDisable = process.env.REMODEX_DISABLE_OPENCODE;
  delete process.env.REMODEX_DISABLE_OPENCODE;

  router.handleApplicationMessage(
    JSON.stringify({ id: 2, method: "runtime/catalog" }),
  );
  await waitOneTick();

  const catalog = responses.find((r) => r.id === 2)?.result;
  const codexRuntime = catalog.runtimes.find((runtime) => runtime.id === "codex");
  const opencodeRuntime = catalog.runtimes.find((runtime) => runtime.id === "opencode");
  assert.equal(codexRuntime.showsBetaLabel, false);
  assert.equal(opencodeRuntime.showsBetaLabel, true);

  if (previousDisable === undefined) {
    delete process.env.REMODEX_DISABLE_OPENCODE;
  } else {
    process.env.REMODEX_DISABLE_OPENCODE = previousDisable;
  }
});

test("provider is not created when OpenCode is explicitly disabled", () => {
  process.env.REMODEX_DISABLE_OPENCODE = "1";
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({}),
    sendApplicationResponse: () => {},
    sendRuntimeMessage: () => {},
    logPrefix: "[test]",
  });
  delete process.env.REMODEX_DISABLE_OPENCODE;

  assert.equal(router.providers.length, 0, "no providers should be created when OpenCode is disabled");
});

test("provider is created by default", async (t) => {
  const previousDisable = process.env.REMODEX_DISABLE_OPENCODE;
  const previousEnable = process.env.REMODEX_ENABLE_OPENCODE;
  delete process.env.REMODEX_DISABLE_OPENCODE;
  delete process.env.REMODEX_ENABLE_OPENCODE;

  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({}),
    sendApplicationResponse: () => {},
    sendRuntimeMessage: () => {},
    logPrefix: "[test]",
  });

  t.after(async () => {
    const provider = router.providers.find((entry) => entry.id === "opencode");
    if (provider && typeof provider.shutdown === "function") {
      await provider.shutdown();
    }
  });

  assert.equal(router.providers.length, 1, "OpenCode provider should register by default");
  assert.equal(router.providers[0].id, "opencode");

  if (previousDisable === undefined) {
    delete process.env.REMODEX_DISABLE_OPENCODE;
  } else {
    process.env.REMODEX_DISABLE_OPENCODE = previousDisable;
  }
  if (previousEnable === undefined) {
    delete process.env.REMODEX_ENABLE_OPENCODE;
  } else {
    process.env.REMODEX_ENABLE_OPENCODE = previousEnable;
  }
});
