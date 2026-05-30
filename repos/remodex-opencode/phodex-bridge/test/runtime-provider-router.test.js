// FILE: runtime-provider-router.test.js
// Purpose: Verifies bridge routing semantics for provider-aware model/thread RPCs.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/runtime-provider-router

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRuntimeProviderRouter,
  mergeModelListResult,
  mergeThreadListResult,
  providerForRequest,
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

test("mergeModelListResult annotates Codex models and appends provider models", () => {
  const result = mergeModelListResult(
    { items: [{ id: "gpt-5.5", model: "gpt-5.5", provider: "openai" }] },
    [{ id: "opencode/gpt-5.5", modelProvider: "opencode" }]
  );

  assert.deepEqual(result.items.map((model) => model.modelProvider), ["codex", "opencode"]);
  assert.equal(result.items[0].provider, "codex");
});

test("mergeThreadListResult deduplicates provider-owned thread copies", () => {
  const result = mergeThreadListResult(
    {
      data: [{
        id: "thread-1",
        title: "Codex copy",
        modelProvider: "codex",
        updatedAt: "2026-05-20T10:00:00Z",
      }],
    },
    [{
      id: "thread-1",
      title: "OpenCode copy",
      modelProvider: "opencode",
      updatedAt: "2026-05-21T10:00:00Z",
    }]
  );

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].title, "OpenCode copy");
  assert.equal(result.data[0].modelProvider, "opencode");
});

test("providerForRequest routes explicit OpenCode and honors explicit Codex fallback", () => {
  const provider = makeProvider(["thread-1"]);

  assert.equal(
    providerForRequest({ method: "turn/start", params: { threadId: "thread-1" } }, [provider]),
    provider
  );
  assert.equal(
    providerForRequest({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        modelProvider: "codex",
      },
    }, [provider]),
    null
  );
  assert.equal(
    providerForRequest({
      method: "turn/start",
      params: {
        threadId: "codex-thread",
        collaborationMode: {
          settings: {
            model_provider: "open-code",
          },
        },
      },
    }, [provider]),
    provider
  );
});

test("stripRuntimeProviderFieldsForCodex removes top-level and nested provider selectors", () => {
  const stripped = JSON.parse(stripRuntimeProviderFieldsForCodex(JSON.stringify({
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
  })));

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
      data: [{
        id: "codex-thread",
        cwd: "/Users/me/work/codex-app",
        provider: "codex",
      }],
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
    providers: [{
      id: "opencode",
      async listModels() {
        return [];
      },
      async listThreads() {
        return {
          data: [{
            id: "ses_test",
            cwd: "/Users/me/work/opencode-app",
            modelProvider: "opencode",
          }],
        };
      },
      ownsThread() {
        return false;
      },
      handleRequest() {
        return {};
      },
    }],
  });

  assert.equal(router.handleApplicationMessage(JSON.stringify({
    id: "threads-1",
    method: "thread/list",
    params: {},
  })), true);
  await responsePromise;

  assert.equal(responsePayload.id, "threads-1");
  assert.deepEqual(remembered.map((call) => call.threads.map((thread) => thread.cwd)), [
    ["/Users/me/work/codex-app"],
    ["/Users/me/work/opencode-app"],
  ]);
  assert.deepEqual(remembered.map((call) => call.metadata.source), [
    "codex-thread-list",
    "provider-thread-list",
  ]);
});
