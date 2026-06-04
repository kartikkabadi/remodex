// FILE: runtime-provider-router.test.js
// Purpose: Verifies bridge routing semantics for provider-aware model/thread RPCs.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/runtime-provider-router

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_OPENCODE_MODEL_LIST_BUDGET_MS,
  MODEL_LIST_PROVIDER_BUDGET_MS,
  capOpenCodeModelsForMobileList,
  createRuntimeProviderRouter,
  mergeModelListResult,
  mergeThreadListResult,
  opencodeModelListBudgetMs,
  providerForRequest,
  providerModelsForModelList,
  stripRuntimeProviderFieldsForCodex,
} = require("../src/runtime-provider-router");

function makeProvider(ownedThreadIds = []) {
  const owned = new Set(ownedThreadIds);
  return {
    id: "opencode",
    ownsThread(threadId) {
      return owned.has(threadId);
    },
  };
}

// Small helper (per review suggestion on Issue 9 capture hygiene): centralizes save/restore
// for muting console during direct providerForRequest calls (used by the explicit-routes test).
// Other tests that need the emitted logs (e.g. audit/decision) use their own collecting pattern.
function withMutedConsole(fn) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    fn();
  } finally {
    console.log = originalLog;
  }
}

test("providerModelsForModelList adds placeholder only when OpenCode is disabled and empty", () => {
  const realModel = {
    id: "anthropic/claude-sonnet-4",
    model: "anthropic/claude-sonnet-4",
    modelProvider: "opencode",
    upstreamProviderId: "anthropic",
  };

  const enabledCatalog = { id: "opencode", enabled: true };
  const disabledCatalog = { id: "opencode", enabled: false };

  assert.deepEqual(
    providerModelsForModelList([realModel], enabledCatalog).map((model) => model.id),
    ["anthropic/claude-sonnet-4"],
  );
  assert.deepEqual(
    providerModelsForModelList([], disabledCatalog).map((model) => model.id),
    ["opencode/gpt-5.5"],
  );
  assert.deepEqual(providerModelsForModelList([realModel], disabledCatalog).map((model) => model.id), [
    "anthropic/claude-sonnet-4",
  ]);
});

test("capOpenCodeModelsForMobileList limits total and per-upstream models", () => {
  const models = [];
  for (let index = 0; index < 40; index += 1) {
    models.push({
      id: `openai/gpt-${index}`,
      model: `openai/gpt-${index}`,
      modelProvider: "opencode",
      upstreamProviderId: "openai",
    });
  }
  for (let index = 0; index < 40; index += 1) {
    models.push({
      id: `anthropic/claude-${index}`,
      model: `anthropic/claude-${index}`,
      modelProvider: "opencode",
      upstreamProviderId: "anthropic",
    });
  }

  const capped = capOpenCodeModelsForMobileList(models, {
    REMODEX_MODEL_LIST_OPENCODE_MAX: "50",
    REMODEX_MODEL_LIST_OPENCODE_PER_UPSTREAM: "10",
  });

  assert.ok(capped.length <= 50);
  const openaiCount = capped.filter((model) => model.upstreamProviderId === "openai").length;
  const anthropicCount = capped.filter((model) => model.upstreamProviderId === "anthropic").length;
  assert.ok(openaiCount <= 10);
  assert.ok(anthropicCount <= 10);
  assert.ok(capped.every((model) => model.contextWindow === undefined));
});

test("capOpenCodeModelsForMobileList preserves logoProviderId", () => {
  const models = [
    {
      id: "opencode/free",
      model: "opencode/free",
      modelProvider: "opencode",
      upstreamProviderId: "opencode",
      upstreamProviderDisplayName: "OpenCode Zen",
      logoProviderId: "opencode-zen",
      contextWindow: { input: 128000 },
    },
  ];

  const capped = capOpenCodeModelsForMobileList(models);
  assert.equal(capped.length, 1);
  assert.equal(capped[0].logoProviderId, "opencode-zen");
  assert.equal(capped[0].contextWindow, undefined);
});

test("mergeModelListResult annotates Codex models and appends provider models", () => {
  const result = mergeModelListResult(
    { items: [{ id: "gpt-5.5", model: "gpt-5.5", provider: "openai" }] },
    [{ id: "opencode/gpt-5.5", modelProvider: "opencode" }],
  );

  assert.deepEqual(
    result.items.map((model) => model.modelProvider),
    ["codex", "opencode"],
  );
  assert.equal(result.items[0].provider, "codex");
});

test("mergeModelListResult attaches opencode meta when provided", () => {
  const result = mergeModelListResult(
    { items: [] },
    [],
    {
      opencode: {
        reasonCode: "no_connected_providers",
        connectedProviderIds: [],
        fetchedAt: "2026-06-03T12:00:00.000Z",
        stale: false,
        modelCountBeforeCap: 0,
        modelCountAfterCap: 0,
      },
    },
  );
  assert.equal(result.opencode.reasonCode, "no_connected_providers");
});

test("mergeThreadListResult deduplicates provider-owned thread copies", () => {
  const result = mergeThreadListResult(
    {
      data: [
        {
          id: "thread-1",
          title: "Codex copy",
          modelProvider: "codex",
          updatedAt: "2026-05-20T10:00:00Z",
        },
      ],
    },
    [
      {
        id: "thread-1",
        title: "OpenCode copy",
        modelProvider: "opencode",
        updatedAt: "2026-05-21T10:00:00Z",
      },
    ],
  );

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].title, "OpenCode copy");
  assert.equal(result.data[0].modelProvider, "opencode");
});

test("providerForRequest routes explicit OpenCode and honors explicit Codex fallback", () => {
  const provider = makeProvider(["thread-1"]);

  // Use helper (per review on Issue 9) to mute console for the 3 direct calls (prevents
  // pollution from providerForRequest decision/owns_call side-effects added for RP-MSG-1).
  // Sibling tests that assert on emitted logs use their own collecting pattern instead.
  withMutedConsole(() => {
    assert.equal(
      providerForRequest({ method: "turn/start", params: { threadId: "thread-1" } }, [provider]),
      provider,
    );
    assert.equal(
      providerForRequest(
        {
          method: "turn/start",
          params: {
            threadId: "thread-1",
            modelProvider: "codex",
          },
        },
        [provider],
      ),
      null,
    );
    assert.equal(
      providerForRequest(
        {
          method: "turn/start",
          params: {
            threadId: "codex-thread",
            collaborationMode: {
              settings: {
                model_provider: "open-code",
              },
            },
          },
        },
        [provider],
      ),
      provider,
    );
  });
});

test("stripRuntimeProviderFieldsForCodex removes top-level and nested provider selectors", () => {
  const stripped = JSON.parse(
    stripRuntimeProviderFieldsForCodex(
      JSON.stringify({
        id: 1,
        method: "turn/start",
        params: {
          threadId: "thread-1",
          model: "gpt-5.5",
          modelProvider: "codex",
          collaborationMode: {
            settings: {
              model: "gpt-5.5",
              model_provider: "codex",
              reasoning_effort: "medium",
            },
          },
        },
      }),
    ),
  );

  assert.equal(stripped.params.modelProvider, undefined);
  assert.equal(stripped.params.collaborationMode.settings.model_provider, undefined);
  assert.equal(stripped.params.collaborationMode.settings.reasoning_effort, "medium");
});

test("thread/list remembers Codex and provider project folders", async () => {
  const remembered = [];
  let responsePayload = null;
  let resolveResponse;
  const responsePromise = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({
      data: [
        {
          id: "codex-thread",
          cwd: "/Users/me/work/codex-app",
          provider: "codex",
        },
      ],
    }),
    sendApplicationResponse(payload) {
      responsePayload = JSON.parse(payload);
      resolveResponse();
    },
    projectRegistry: {
      rememberProjectsFromThreads(threads, metadata) {
        remembered.push({ threads, metadata });
      },
    },
    providers: [
      {
        id: "opencode",
        async listModels() {
          return [];
        },
        async listThreads() {
          return {
            data: [
              {
                id: "ses_test",
                cwd: "/Users/me/work/opencode-app",
                modelProvider: "opencode",
              },
            ],
          };
        },
        ownsThread() {
          return false;
        },
        handleRequest() {
          return {};
        },
      },
    ],
  });

  assert.equal(
    router.handleApplicationMessage(
      JSON.stringify({
        id: "threads-1",
        method: "thread/list",
        params: {},
      }),
    ),
    true,
  );
  await responsePromise;

  assert.equal(responsePayload.id, "threads-1");
  assert.deepEqual(
    remembered.map((call) => call.threads.map((thread) => thread.cwd)),
    [["/Users/me/work/codex-app"], ["/Users/me/work/opencode-app"]],
  );
  assert.deepEqual(
    remembered.map((call) => call.metadata.source),
    ["codex-thread-list", "provider-thread-list"],
  );
});

test("model/list returns Codex models when OpenCode listModels never resolves", async () => {
  let responsePayload = null;
  let resolveResponse;
  const responsePromise = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const startedAt = Date.now();
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({ items: [{ id: "gpt-5.5", model: "gpt-5.5" }] }),
    sendApplicationResponse(payload) {
      responsePayload = JSON.parse(payload);
      resolveResponse();
    },
    providers: [
      {
        id: "opencode",
        listModels() {
          return new Promise(() => {});
        },
        async listAgents() {
          return [];
        },
        async listThreads() {
          return { data: [] };
        },
        ownsThread() {
          return false;
        },
        handleRequest() {
          return {};
        },
      },
    ],
  });

  router.handleApplicationMessage(
    JSON.stringify({
      id: "models-opencode-hang",
      method: "model/list",
      params: {},
    }),
  );
  await responsePromise;

  const elapsedMs = Date.now() - startedAt;
  const opencodeBudgetMs = opencodeModelListBudgetMs();
  assert.ok(
    elapsedMs < opencodeBudgetMs + 1_500,
    `expected model/list within OpenCode budget, took ${elapsedMs}ms`,
  );
  const providers = responsePayload.result.items.map((model) => model.modelProvider);
  assert.ok(providers.includes("codex"));
  assert.equal(providers.filter((provider) => provider === "opencode").length, 0);
});

test("opencodeModelListBudgetMs defaults to serve-start budget and honors env override", () => {
  assert.equal(opencodeModelListBudgetMs({}), DEFAULT_OPENCODE_MODEL_LIST_BUDGET_MS);
  assert.equal(
    opencodeModelListBudgetMs({ REMODEX_MODEL_LIST_OPENCODE_BUDGET_MS: "12000" }),
    12_000,
  );
});

test("model/list mobile payload stays within OpenCode cap", async () => {
  let responsePayload = null;
  let resolveResponse;
  const responsePromise = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const opencodeModels = [];
  for (let index = 0; index < 300; index += 1) {
    opencodeModels.push({
      id: `openai/gpt-${index}`,
      model: `openai/gpt-${index}`,
      modelProvider: "opencode",
      upstreamProviderId: "openai",
    });
  }

  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({ items: [{ id: "gpt-5.5", model: "gpt-5.5" }] }),
    sendApplicationResponse(payload) {
      responsePayload = JSON.parse(payload);
      resolveResponse();
    },
    providers: [
      {
        id: "opencode",
        async listModels() {
          return opencodeModels;
        },
        async listAgents() {
          return [];
        },
        async listThreads() {
          return { data: [] };
        },
        ownsThread() {
          return false;
        },
        handleRequest() {
          return {};
        },
      },
    ],
  });

  router.handleApplicationMessage(
    JSON.stringify({
      id: "models-size-cap",
      method: "model/list",
      params: {},
    }),
  );
  await responsePromise;

  const opencodeCount = responsePayload.result.items.filter(
    (model) => model.modelProvider === "opencode",
  ).length;
  assert.ok(opencodeCount <= 120);
  assert.ok(JSON.stringify(responsePayload.result).length < 512_000);
});

test("model/list still returns OpenCode models when Codex model/list fails", async () => {
  let responsePayload = null;
  let resolveResponse;
  const responsePromise = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => {
      throw new Error("codex offline");
    },
    sendApplicationResponse(payload) {
      responsePayload = JSON.parse(payload);
      resolveResponse();
    },
    providers: [
      {
        id: "opencode",
        async listModels() {
          return [
            {
              id: "openai/gpt-5.5",
              model: "openai/gpt-5.5",
              modelProvider: "opencode",
              upstreamProviderId: "openai",
            },
          ];
        },
        async listAgents() {
          return [];
        },
        async listThreads() {
          return { data: [] };
        },
        ownsThread() {
          return false;
        },
        handleRequest() {
          return {};
        },
      },
    ],
  });

  router.handleApplicationMessage(
    JSON.stringify({
      id: "models-codex-fail",
      method: "model/list",
      params: {},
    }),
  );
  await responsePromise;

  const ids = responsePayload.result.items.map((model) => model.id);
  assert.deepEqual(ids, ["openai/gpt-5.5"]);
});

test("model/list omits placeholder when OpenCode is enabled with real models", async () => {
  let responsePayload = null;
  let resolveResponse;
  const responsePromise = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({ items: [{ id: "gpt-5.5", model: "gpt-5.5" }] }),
    sendApplicationResponse(payload) {
      responsePayload = JSON.parse(payload);
      resolveResponse();
    },
    providers: [
      {
        id: "opencode",
        async listModels() {
          return [
            {
              id: "anthropic/claude-sonnet-4",
              model: "anthropic/claude-sonnet-4",
              modelProvider: "opencode",
              upstreamProviderId: "anthropic",
              upstreamProviderDisplayName: "Anthropic",
            },
            {
              id: "openai/gpt-5.5",
              model: "openai/gpt-5.5",
              modelProvider: "opencode",
              upstreamProviderId: "openai",
              upstreamProviderDisplayName: "OpenAI",
            },
          ];
        },
        async listAgents() {
          return [{ id: "build", label: "Build" }];
        },
        async listThreads() {
          return { data: [] };
        },
        ownsThread() {
          return false;
        },
        handleRequest() {
          return {};
        },
      },
    ],
  });

  router.handleApplicationMessage(
    JSON.stringify({
      id: "models-1",
      method: "model/list",
      params: {},
    }),
  );
  await responsePromise;

  const ids = responsePayload.result.items.map((model) => model.id);
  assert.ok(ids.includes("anthropic/claude-sonnet-4"));
  assert.ok(ids.includes("openai/gpt-5.5"));
  assert.equal(ids.filter((id) => id === "opencode/gpt-5.5").length, 0);

  const { OPENCODE_CAPABILITIES } = require("../src/provider-capabilities");
  const opencodeModel = responsePayload.result.items.find(
    (model) => model.modelProvider === "opencode",
  );
  assert.ok(opencodeModel, "expected at least one OpenCode model in model/list");
  assert.deepEqual(opencodeModel.capabilities, OPENCODE_CAPABILITIES);
});

test("command/list returns commands from opencode provider", async () => {
  let responsePayload = null;
  let resolveResponse;
  const responsePromise = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({}),
    sendApplicationResponse(payload) {
      responsePayload = JSON.parse(payload);
      resolveResponse();
    },
    providers: [
      {
        id: "opencode",
        async listModels() {
          return [];
        },
        async listCommands(directory) {
          return [
            { token: "/build", title: "Build", description: "Build the project" },
            { token: "/test", title: "Test", description: "Run tests" },
          ];
        },
        listThreads: async () => ({ data: [] }),
        ownsThread() {
          return false;
        },
        handleRequest() {},
      },
    ],
  });

  assert.equal(
    router.handleApplicationMessage(
      JSON.stringify({
        id: "cmd-1",
        method: "command/list",
        params: { directory: "/tmp/test" },
      }),
    ),
    true,
  );
  await responsePromise;

  assert.equal(responsePayload.id, "cmd-1");
  assert.ok(Array.isArray(responsePayload.result.commands));
  assert.equal(responsePayload.result.commands.length, 2);
  assert.equal(responsePayload.result.commands[0].token, "/build");
  assert.equal(responsePayload.result.commands[1].token, "/test");
});

test("skills/list merges Codex and OpenCode skill buckets", async () => {
  let responsePayload = null;
  let resolveResponse;
  const responsePromise = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({
      data: [
        {
          cwd: "/tmp/repo",
          skills: [
            {
              name: "codex-skill",
              description: "From Codex",
              path: "/tmp/repo/.agents/skills/codex-skill/SKILL.md",
              scope: "project",
              enabled: true,
            },
          ],
        },
      ],
    }),
    sendApplicationResponse(payload) {
      responsePayload = JSON.parse(payload);
      resolveResponse();
    },
    providers: [
      {
        id: "opencode",
        async listModels() {
          return [];
        },
        async listSkills(directory) {
          return [
            {
              name: "opencode-skill",
              description: "From OpenCode",
              path: `${directory}/.agents/skills/opencode-skill/SKILL.md`,
              scope: "project",
              enabled: true,
            },
          ];
        },
        listThreads: async () => ({ data: [] }),
        ownsThread() {
          return false;
        },
        handleRequest() {},
      },
    ],
  });

  assert.equal(
    router.handleApplicationMessage(
      JSON.stringify({
        id: "skills-1",
        method: "skills/list",
        params: { cwds: ["/tmp/repo"] },
      }),
    ),
    true,
  );
  await responsePromise;

  assert.equal(responsePayload.id, "skills-1");
  const bucket = responsePayload.result.data.find((entry) => entry.cwd === "/tmp/repo");
  assert.ok(bucket);
  const names = bucket.skills.map((skill) => skill.name).sort();
  assert.deepEqual(names, ["codex-skill", "opencode-skill"]);
});

test("command/list returns empty when no opencode provider", async () => {
  let responsePayload = null;
  let resolveResponse;
  const responsePromise = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({}),
    sendApplicationResponse(payload) {
      responsePayload = JSON.parse(payload);
      resolveResponse();
    },
    providers: [],
  });

  router.handleApplicationMessage(
    JSON.stringify({
      id: "cmd-2",
      method: "command/list",
      params: {},
    }),
  );
  await responsePromise;

  assert.equal(responsePayload.id, "cmd-2");
  assert.ok(Array.isArray(responsePayload.result.commands));
  assert.equal(responsePayload.result.commands.length, 0);
});

function waitOneTick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("runtime/catalog omits opencode when OpenCode is explicitly disabled", async () => {
  const responses = [];
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({}),
    sendApplicationResponse: (msg) => responses.push(JSON.parse(msg)),
    providers: [
      {
        id: "opencode",
        async listAgents() {
          return [{ id: "build", label: "Build" }];
        },
      },
    ],
  });

  const previousDisable = process.env.REMODEX_DISABLE_OPENCODE;
  process.env.REMODEX_DISABLE_OPENCODE = "1";

  router.handleApplicationMessage(
    JSON.stringify({ id: "catalog-disabled", method: "runtime/catalog" }),
  );
  await waitOneTick();

  const catalog = responses.find((r) => r.id === "catalog-disabled")?.result;
  const codexRuntime = catalog.runtimes.find((runtime) => runtime.id === "codex");
  const opencodeRuntime = catalog.runtimes.find((runtime) => runtime.id === "opencode");
  assert.equal(codexRuntime.reasonCode, null);
  assert.equal(opencodeRuntime, undefined);

  if (previousDisable === undefined) {
    delete process.env.REMODEX_DISABLE_OPENCODE;
  } else {
    process.env.REMODEX_DISABLE_OPENCODE = previousDisable;
  }
});

test("runtime/catalog sets reasonCode when OpenCode agents cannot be listed", async () => {
  const responses = [];
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({}),
    sendApplicationResponse: (msg) => responses.push(JSON.parse(msg)),
    providers: [
      {
        id: "opencode",
        async listAgents() {
          throw new Error("agents unavailable");
        },
      },
    ],
  });

  const previousDisable = process.env.REMODEX_DISABLE_OPENCODE;
  delete process.env.REMODEX_DISABLE_OPENCODE;

  router.handleApplicationMessage(
    JSON.stringify({ id: "catalog-agents", method: "runtime/catalog" }),
  );
  await waitOneTick();

  const catalog = responses.find((r) => r.id === "catalog-agents")?.result;
  const opencodeRuntime = catalog.runtimes.find((runtime) => runtime.id === "opencode");
  assert.equal(opencodeRuntime.enabled, false);
  assert.equal(opencodeRuntime.reasonCode, "opencode_agents_unavailable");
  assert.equal(opencodeRuntime.unavailableReason, "OpenCode agents could not be listed");

  if (previousDisable === undefined) {
    delete process.env.REMODEX_DISABLE_OPENCODE;
  } else {
    process.env.REMODEX_DISABLE_OPENCODE = previousDisable;
  }
});

test("runtime/catalog surfaces OpenCode server start failures from provider", async () => {
  const responses = [];
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({}),
    sendApplicationResponse: (msg) => responses.push(JSON.parse(msg)),
    providers: [
      {
        id: "opencode",
        getCatalogAvailability() {
          return {
            unavailableReason: "OpenCode port 4200 is already in use on this Mac.",
            reasonCode: "opencode_port_in_use",
          };
        },
        async listAgents() {
          return [];
        },
      },
    ],
  });

  const previousDisable = process.env.REMODEX_DISABLE_OPENCODE;
  delete process.env.REMODEX_DISABLE_OPENCODE;

  router.handleApplicationMessage(
    JSON.stringify({ id: "catalog-server-down", method: "runtime/catalog" }),
  );
  await waitOneTick();

  const catalog = responses.find((r) => r.id === "catalog-server-down")?.result;
  const opencodeRuntime = catalog.runtimes.find((runtime) => runtime.id === "opencode");
  assert.equal(opencodeRuntime.enabled, false);
  assert.equal(opencodeRuntime.reasonCode, "opencode_port_in_use");
  assert.match(opencodeRuntime.unavailableReason, /port 4200/i);

  if (previousDisable === undefined) {
    delete process.env.REMODEX_DISABLE_OPENCODE;
  } else {
    process.env.REMODEX_DISABLE_OPENCODE = previousDisable;
  }
});

test("runtime/catalog clears reasonCode when OpenCode is enabled with agents", async () => {
  const responses = [];
  const router = createRuntimeProviderRouter({
    sendCodexRequest: async () => ({}),
    sendApplicationResponse: (msg) => responses.push(JSON.parse(msg)),
    providers: [
      {
        id: "opencode",
        async listAgents() {
          return [{ id: "build", label: "Build" }];
        },
      },
    ],
  });

  const previousDisable = process.env.REMODEX_DISABLE_OPENCODE;
  delete process.env.REMODEX_DISABLE_OPENCODE;

  router.handleApplicationMessage(
    JSON.stringify({ id: "catalog-enabled", method: "runtime/catalog" }),
  );
  await waitOneTick();

  const catalog = responses.find((r) => r.id === "catalog-enabled")?.result;
  const opencodeRuntime = catalog.runtimes.find((runtime) => runtime.id === "opencode");
  assert.equal(opencodeRuntime.enabled, true);
  assert.equal(opencodeRuntime.reasonCode, null);
  assert.equal(opencodeRuntime.unavailableReason, null);
  assert.equal(opencodeRuntime.capabilities.supportsSteer, false);
  assert.equal(opencodeRuntime.capabilities.supportsQueue, true);
  assert.equal(opencodeRuntime.capabilities.supportsSkillAutocomplete, true);
  assert.equal(opencodeRuntime.capabilities.supportsStructuredSkillInput, false);

  if (previousDisable === undefined) {
    delete process.env.REMODEX_DISABLE_OPENCODE;
  } else {
    process.env.REMODEX_DISABLE_OPENCODE = previousDisable;
  }
});

test("rejects explicit provider switches on owned threads", async () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { createThreadOwnershipStore } = require("../src/thread-ownership-store");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-router-ownership-"));

  try {
    const ownershipStore = createThreadOwnershipStore({
      storagePath: path.join(tempDir, "thread-ownership.json"),
      fsImpl: fs,
    });
    ownershipStore.setOwnership("thread-owned", "opencode");

    const responses = [];
    const router = createRuntimeProviderRouter({
      sendCodexRequest: async () => ({ items: [] }),
      sendApplicationResponse: (message) => {
        responses.push(JSON.parse(message));
      },
      sendRuntimeMessage: () => {},
      ownershipStore,
      providers: [makeProvider(["thread-owned"])],
    });

    const handled = router.handleApplicationMessage(
      JSON.stringify({
        id: "ownership-mismatch",
        method: "turn/start",
        params: {
          threadId: "thread-owned",
          modelProvider: "codex",
        },
      }),
    );

    assert.equal(handled, true);
    await waitOneTick();
    const response = responses.find((entry) => entry.id === "ownership-mismatch");
    assert.equal(response?.error?.data?.errorCode, "thread_provider_mismatch");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("routes providerless owned thread RPCs by durable ownership", async () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { createThreadOwnershipStore } = require("../src/thread-ownership-store");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-router-providerless-"));

  try {
    const ownershipStore = createThreadOwnershipStore({
      storagePath: path.join(tempDir, "thread-ownership.json"),
      fsImpl: fs,
    });
    ownershipStore.setOwnership("thread-owned", "opencode");

    const handledRequests = [];
    const responses = [];
    const router = createRuntimeProviderRouter({
      sendCodexRequest: async () => ({ items: [] }),
      sendApplicationResponse: (message) => {
        responses.push(JSON.parse(message));
      },
      sendRuntimeMessage: () => {},
      ownershipStore,
      providers: [
        {
          id: "opencode",
          ownsThread(threadId) {
            return threadId === "thread-owned";
          },
          async handleRequest(request) {
            handledRequests.push(request);
            return { thread: { id: request.params.threadId, modelProvider: "opencode" } };
          },
        },
      ],
    });

    const handled = router.handleApplicationMessage(
      JSON.stringify({
        id: "providerless-owned-read",
        method: "thread/read",
        params: {
          threadId: "thread-owned",
          includeTurns: true,
        },
      }),
    );

    assert.equal(handled, true);
    await waitOneTick();
    assert.equal(handledRequests.length, 1);
    assert.equal(handledRequests[0].method, "thread/read");
    const response = responses.find((entry) => entry.id === "providerless-owned-read");
    assert.equal(response?.error, undefined);
    assert.equal(response?.result?.thread?.modelProvider, "opencode");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("turn/start logs bridge_turn_start_audit and bridge_ownership_mismatch", async () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { createThreadOwnershipStore } = require("../src/thread-ownership-store");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-router-audit-"));
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map((entry) => String(entry)).join(" "));
  };

  try {
    const ownershipStore = createThreadOwnershipStore({
      storagePath: path.join(tempDir, "thread-ownership.json"),
      fsImpl: fs,
    });
    ownershipStore.setOwnership("thread-owned", "opencode");

    const router = createRuntimeProviderRouter({
      sendCodexRequest: async () => ({ items: [] }),
      sendApplicationResponse: () => {},
      sendRuntimeMessage: () => {},
      ownershipStore,
      providers: [makeProvider(["thread-owned"])],
    });

    router.handleApplicationMessage(
      JSON.stringify({
        id: "audit-mismatch",
        method: "turn/start",
        params: {
          threadId: "thread-owned",
          modelProvider: "codex",
        },
      }),
    );
    await waitOneTick();

    const audit = logs
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const turnStartAudit = audit.find((entry) => entry.event === "bridge_turn_start_audit");
    const mismatchLog = audit.find((entry) => entry.event === "bridge_ownership_mismatch");
    assert.equal(turnStartAudit?.threadId, "thread-owned");
    assert.equal(turnStartAudit?.requestedProvider, "codex");
    assert.equal(turnStartAudit?.storedProvider, "opencode");
    assert.equal(turnStartAudit?.mismatch, true);
    assert.equal(mismatchLog?.errorCode, "thread_provider_mismatch");
  } finally {
    console.log = originalLog;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("providerForRequest logs ownsThread decision and router init", async () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { createThreadOwnershipStore } = require("../src/thread-ownership-store");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-router-decision-"));
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map((entry) => String(entry)).join(" "));
  };

  try {
    const ownershipStore = createThreadOwnershipStore({
      storagePath: path.join(tempDir, "thread-ownership.json"),
      fsImpl: fs,
    });
    ownershipStore.setOwnership("thread-owned-oc", "opencode");

    const router = createRuntimeProviderRouter({
      sendCodexRequest: async () => ({ items: [] }),
      sendApplicationResponse: () => {},
      sendRuntimeMessage: () => {},
      ownershipStore,
      providers: [makeProvider(["thread-owned-oc"])],
    });

    // providerless request on owned thread hits owns lookup path (plus decision + init logs for RP-MSG-1)
    router.handleApplicationMessage(
      JSON.stringify({
        id: "decision-owns",
        method: "turn/start",
        params: {
          threadId: "thread-owned-oc",
        },
      }),
    );
    await waitOneTick();

    const parsedLogs = logs
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const decision = parsedLogs.find((entry) => entry.event === "provider_for_request_decision");
    const ownsCall = parsedLogs.find((entry) => entry.event === "provider_for_request_owns_call");
    const initLog = parsedLogs.find((entry) => entry.event === "runtime_provider_router_init");

    assert.equal(decision?.requestedProvider, null);
    assert.equal(decision?.hasExplicitProviderField, false);
    assert.equal(decision?.storedProvider, "opencode");
    assert.equal(decision?.resolvedProvider, "opencode");
    assert.equal(decision?.matchReason, "owns_thread_match");
    assert.equal(decision?.owns, true);
    assert.equal(ownsCall?.threadId, "thread-owned-oc");
    assert.ok(initLog, "startup router init log present");
  } finally {
    console.log = originalLog;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
