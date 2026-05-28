// FILE: runtime-provider-router.test.js
// Purpose: Verifies provider-aware bridge routing and merge behavior without launching external runtimes.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/runtime-provider-router

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createRuntimeProviderRouter,
  mergeModelListResult,
  mergeThreadListResult,
  providerForRequest,
  stripRuntimeProviderFieldsForCodex,
} = require("../src/runtime-provider-router");

test("mergeModelListResult tags Codex models and appends provider models", () => {
  const result = mergeModelListResult(
    { items: [{ id: "gpt-5.5", model: "gpt-5.5" }] },
    [{ id: "composer-2.5[fast=true]", model: "composer-2.5[fast=true]", modelProvider: "cursor" }]
  );

  assert.deepEqual(result.items.map((model) => model.modelProvider), ["codex", "cursor"]);
  assert.equal(result.items[0].provider, "codex");
});

test("mergeThreadListResult dedupes by id and prefers provider metadata", () => {
  const result = mergeThreadListResult(
    {
      data: [
        { id: "thread-1", title: "Codex", updatedAt: "2026-05-20T10:00:00.000Z" },
        { id: "thread-2", title: "Old", updatedAt: "2026-05-20T09:00:00.000Z" },
      ],
    },
    [
      {
        id: "thread-1",
        title: "Cursor",
        modelProvider: "cursor",
        updatedAt: "2026-05-20T11:00:00.000Z",
      },
    ]
  );

  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].title, "Cursor");
  assert.equal(result.data[0].modelProvider, "cursor");
});

test("providerForRequest routes explicit Cursor providers and owned threads", () => {
  const cursorProvider = makeProvider({
    ownsThread: (threadId) => threadId === "cursor-thread-1",
  });

  assert.equal(
    providerForRequest({ params: { modelProvider: "cursor-agent" } }, [cursorProvider]),
    cursorProvider
  );
  assert.equal(
    providerForRequest({ params: { threadId: "cursor-thread-1" } }, [cursorProvider]),
    cursorProvider
  );
  assert.equal(
    providerForRequest({ params: { modelProvider: "codex", threadId: "cursor-thread-1" } }, [cursorProvider]),
    null
  );
});

test("createRuntimeProviderRouter merges model/list and routes Cursor turn/start", async () => {
  const responses = [];
  const handledRequests = [];
  const provider = makeProvider({
    handleRequest: async (request) => {
      handledRequests.push(request);
      return { turnId: "cursor-turn-1" };
    },
  });
  const router = createRuntimeProviderRouter({
    providers: [provider],
    sendApplicationResponse: (message) => responses.push(JSON.parse(message)),
    sendCodexRequest: async (method, params) => {
      assert.equal(method, "model/list");
      assert.equal(params.modelProvider, undefined);
      return { items: [{ id: "gpt-5.5", model: "gpt-5.5" }] };
    },
  });

  assert.equal(router.handleApplicationMessage(JSON.stringify({ id: 1, method: "model/list", params: {} })), true);
  await flushAsyncWork();
  assert.equal(responses[0].id, 1);
  assert.deepEqual(responses[0].result.items.map((model) => model.modelProvider), ["codex", "cursor"]);

  assert.equal(
    router.handleApplicationMessage(JSON.stringify({
      id: 2,
      method: "turn/start",
      params: {
        threadId: "thread-1",
        modelProvider: "cursor",
        model: "composer-2.5[fast=true]",
      },
    })),
    true
  );
  await flushAsyncWork();
  assert.equal(responses[1].id, 2);
  assert.equal(responses[1].result.turnId, "cursor-turn-1");
  assert.equal(handledRequests[0].params.modelProvider, "cursor");
});

test("stripRuntimeProviderFieldsForCodex removes provider-only fields before forwarding", () => {
  const stripped = JSON.parse(stripRuntimeProviderFieldsForCodex(JSON.stringify({
    id: 3,
    method: "turn/start",
    params: {
      model: "gpt-5.5",
      modelProvider: "codex",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.5",
          model_provider: "codex",
        },
      },
    },
  })));

  assert.equal(stripped.params.model, "gpt-5.5");
  assert.equal(stripped.params.modelProvider, undefined);
  assert.equal(stripped.params.collaborationMode.settings.model, "gpt-5.5");
  assert.equal(stripped.params.collaborationMode.settings.model_provider, undefined);
});

function makeProvider(overrides = {}) {
  return {
    id: "cursor",
    canHandleProvider: (provider) => provider === "cursor",
    listModels: async () => [
      {
        id: "composer-2.5[fast=true]",
        model: "composer-2.5[fast=true]",
        modelProvider: "cursor",
      },
    ],
    listThreads: async () => ({ data: [] }),
    ownsThread: () => false,
    handleRequest: async () => ({ ok: true }),
    shutdown() {},
    ...overrides,
  };
}

function flushAsyncWork() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
