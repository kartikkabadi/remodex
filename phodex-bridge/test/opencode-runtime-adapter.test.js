// FILE: opencode-runtime-adapter.test.js
// Purpose: Verifies OpenCode runtime request mapping to server calls and canonical bridge events.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/opencode-runtime-adapter, ../src/thread-agent-state

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createOpenCodeRuntimeAdapter,
  hasOpenCodeAuthConfigured,
  mapOpenCodeRuntimeStatus,
  mapServerStatus,
} = require("../src/opencode-runtime-adapter");
const { createThreadAgentStateStore } = require("../src/thread-agent-state");

test("OpenCode runtime maps missing auth.json to needs_auth", () => {
  const fsImpl = {
    existsSync: () => false,
    readFileSync: () => "",
  };
  assert.equal(hasOpenCodeAuthConfigured(fsImpl), false);
  assert.equal(mapOpenCodeRuntimeStatus("ready", fsImpl).status, "needs_auth");
});

test("OpenCode runtime adapter maps server status into runtime status", async () => {
  const adapter = createAdapter({
    serverStatus: { state: "ready", baseUrl: "http://127.0.0.1:1" },
    modelCatalog: {
      defaultModelId: "opencode-go/deepseek-v4-flash",
      models: [],
    },
  }).adapter;
  const entry = await adapter.getRuntimeListEntry();
  assert.equal(entry.id, "opencode");
  assert.equal(entry.status, "ready");
  assert.equal(entry.capabilities.planMode, true);
  assert.equal(entry.modelCatalog.defaultModelId, "opencode-go/deepseek-v4-flash");
  assert.deepEqual(mapServerStatus("stopped"), {
    status: "ready",
    statusMessage: "OpenCode server will start on first use.",
  });
});

test("OpenCode thread/start creates a session, locks state, and emits canonical thread_started", async () => {
  const { adapter, stateStore, requests } = createAdapter({
    requestImpl: async () => ({ id: "ses_123", title: "OpenCode session" }),
  });
  const outbound = [];

  await adapter.handleRuntimeRequest({
    parsed: {
      id: "thread-start-1",
      method: "thread/start",
      params: {
        threadId: "thread-opencode",
        agentRuntime: "opencode",
        title: "Build it",
        cwd: "/repo",
      },
    },
    threadId: "thread-opencode",
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });

  assert.deepEqual(requests[0], {
    method: "POST",
    path: "/session",
    body: { title: "Build it" },
  });
  assert.equal(outbound[0].id, "thread-start-1");
  assert.equal(outbound[0].result.thread.agentRuntime, "opencode");
  assert.equal(outbound[1].method, "remodex/event/thread_started");
  assert.equal(outbound[1].params.agentSessionId, "ses_123");
  const record = stateStore.get("thread-opencode");
  assert.equal(record.agentRuntime, "opencode");
  assert.equal(record.agentSessionId, "ses_123");
  assert.equal(record.runtimeLocked, true);
});

test("OpenCode thread/resume rebinds an existing session without POST /session", async () => {
  const { adapter, stateStore, requests } = createAdapter({
    requestImpl: async (method, path) => {
      if (method === "GET" && path === "/session/ses_existing") {
        return { id: "ses_existing", title: "Resumed session" };
      }
      throw new Error(`unexpected request ${method} ${path}`);
    },
  });
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_existing",
    runtimeLocked: true,
  });
  const outbound = [];

  await adapter.handleRuntimeRequest({
    parsed: {
      id: "thread-resume-1",
      method: "thread/resume",
      params: { threadId: "thread-opencode" },
    },
    threadId: "thread-opencode",
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].path, "/session/ses_existing");
  assert.equal(outbound[0].result.thread.agentSessionId, "ses_existing");
  assert.equal(stateStore.get("thread-opencode")?.agentSessionId, "ses_existing");
});

test("OpenCode thread/read hydrates session messages into Remodex turns", async () => {
  const { adapter, stateStore, requests } = createAdapter({
    requestImpl: async (method, path) => {
      if (method === "GET" && path === "/session/ses_123") {
        return {
          id: "ses_123",
          title: "History",
          directory: "/repo",
          time: { created: 1_770_000_000_000, updated: 1_770_000_001_000 },
          model: { providerID: "opencode-go", id: "deepseek-v4-flash" },
        };
      }
      if (method === "GET" && path === "/session/ses_123/message") {
        return [{
          info: {
            id: "msg_user",
            role: "user",
            time: { created: 1_770_000_000_000 },
          },
          parts: [{ id: "prt_user", type: "text", text: "Hi" }],
        }, {
          info: {
            id: "msg_assistant",
            role: "assistant",
            parentID: "msg_user",
            time: { created: 1_770_000_000_500, completed: 1_770_000_001_000 },
            finish: "stop",
          },
          parts: [{ id: "prt_assistant", type: "text", text: "Hello" }],
        }];
      }
      throw new Error(`unexpected request ${method} ${path}`);
    },
  });
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_123",
    runtimeLocked: true,
  });
  const outbound = [];

  await adapter.handleRuntimeRequest({
    parsed: {
      id: "thread-read-1",
      method: "thread/read",
      params: { threadId: "thread-opencode" },
    },
    threadId: "thread-opencode",
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });

  assert.deepEqual(requests.map((request) => request.path), [
    "/session/ses_123",
    "/session/ses_123/message",
  ]);
  const thread = outbound[0].result.thread;
  assert.equal(thread.id, "thread-opencode");
  assert.equal(thread.agentRuntime, "opencode");
  assert.equal(thread.agentSessionId, "ses_123");
  assert.equal(thread.model, "opencode-go/deepseek-v4-flash");
  assert.equal(thread.turns.length, 1);
  assert.equal(thread.turns[0].items[0].role, "user");
  assert.equal(thread.turns[0].items[0].text, "Hi");
  assert.equal(thread.turns[0].items[1].role, "assistant");
  assert.equal(thread.turns[0].items[1].text, "Hello");
});

test("OpenCode thread/turns/list returns bounded descending pages", async () => {
  const { adapter, stateStore } = createAdapter({
    requestImpl: async (method, path) => {
      if (method === "GET" && path === "/session/ses_123/message") {
        return ["one", "two", "three"].map((text, index) => ({
          info: {
            id: `msg_${index + 1}`,
            role: "user",
            time: { created: 1_770_000_000_000 + index },
          },
          parts: [{ type: "text", text }],
        }));
      }
      throw new Error(`unexpected request ${method} ${path}`);
    },
  });
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_123",
    runtimeLocked: true,
  });
  const outbound = [];

  await adapter.handleRuntimeRequest({
    parsed: {
      id: "turns-list-1",
      method: "thread/turns/list",
      params: {
        threadId: "thread-opencode",
        sortDirection: "desc",
        limit: 2,
      },
    },
    threadId: "thread-opencode",
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });

  assert.equal(outbound[0].result.data.length, 2);
  assert.equal(outbound[0].result.data[0].items[0].text, "three");
  assert.equal(outbound[0].result.data[1].items[0].text, "two");
  assert.equal(outbound[0].result.nextCursor, "opencode-offset:2");
});

test("OpenCode thread/fork creates a forked runtime thread and inherits metadata", async () => {
  const { adapter, stateStore, requests } = createAdapter({
    requestImpl: async (method, path) => {
      if (method === "POST" && path === "/session/ses_123/fork") {
        return {
          id: "ses_fork",
          title: "Forked",
          directory: "/repo",
          model: { providerID: "opencode-go", id: "qwen3.6-plus" },
        };
      }
      throw new Error(`unexpected request ${method} ${path}`);
    },
  });
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_123",
    cwd: "/repo",
    model: "opencode-go/deepseek-v4-flash",
    modelProvider: "opencode-go",
    runtimeLocked: true,
  });
  const outbound = [];

  await adapter.handleRuntimeRequest({
    parsed: {
      id: "thread-fork-1",
      method: "thread/fork",
      params: { threadId: "thread-opencode" },
    },
    threadId: "thread-opencode",
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });

  assert.deepEqual(requests[0], {
    method: "POST",
    path: "/session/ses_123/fork",
    body: undefined,
  });
  const thread = outbound[0].result.thread;
  assert.equal(thread.id, "opencode-ses_fork");
  assert.equal(thread.agentSessionId, "ses_fork");
  assert.equal(thread.forkedFromThreadId, "thread-opencode");
  assert.equal(stateStore.get("opencode-ses_fork")?.agentSessionId, "ses_fork");
  assert.equal(stateStore.get("opencode-ses_fork")?.model, "opencode-go/qwen3.6-plus");
});

test("OpenCode turn/start posts prompt_async and emits canonical turn_started", async () => {
  const { adapter, stateStore, requests } = createAdapter();
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_123",
    opencodeBuildAgentName: "build",
    opencodePlanAgentName: "plan",
    runtimeLocked: true,
  });
  const outbound = [];

  await adapter.handleRuntimeRequest({
    parsed: {
      id: "turn-start-1",
      method: "turn/start",
      params: {
        threadId: "thread-opencode",
        turnId: "turn-123",
        prompt: "Fix the tests",
        mode: "plan",
      },
    },
    threadId: "thread-opencode",
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });

  assert.deepEqual(requests[0], {
    method: "POST",
    path: "/session/ses_123/prompt_async",
    body: {
      parts: [{ type: "text", text: "Fix the tests" }],
      agent: "plan",
      model: { providerID: "opencode-go", modelID: "deepseek-v4-flash" },
    },
  });
  assert.equal(outbound[0].result.agentSessionId, "ses_123");
  assert.equal(outbound[1].method, "remodex/event/turn_started");
  assert.equal(outbound[1].params.turnId, "turn-123");
});

test("OpenCode turn/start converts iOS structured input items into prompt parts", async () => {
  const { adapter, stateStore, requests } = createAdapter();
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_123",
    opencodeBuildAgentName: "build",
    opencodePlanAgentName: "planner",
    runtimeLocked: true,
  });

  await adapter.handleRuntimeRequest({
    parsed: {
      id: "turn-start-structured",
      method: "turn/start",
      params: {
        threadId: "thread-opencode",
        turnId: "turn-structured",
        input: [
          { type: "text", text: "Hey" },
          { type: "mention", name: "README", path: "/repo/README.md" },
          { type: "skill", name: "diagnose" },
        ],
        collaborationMode: {
          mode: "plan",
        },
      },
    },
    threadId: "thread-opencode",
    sendResponse() {},
  });

  assert.deepEqual(requests[0], {
    method: "POST",
    path: "/session/ses_123/prompt_async",
    body: {
      parts: [
        { type: "text", text: "Hey\n@README /repo/README.md\n$diagnose" },
      ],
      agent: "planner",
      model: { providerID: "opencode-go", modelID: "deepseek-v4-flash" },
    },
  });
});

test("OpenCode turn/start passes selected runtime model to prompt_async", async () => {
  const { adapter, stateStore, requests } = createAdapter();
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_123",
    runtimeLocked: true,
  });

  await adapter.handleRuntimeRequest({
    parsed: {
      id: "turn-start-model",
      method: "turn/start",
      params: {
        threadId: "thread-opencode",
        turnId: "turn-model",
        prompt: "Use qwen",
        model: "opencode-go/qwen3.6-plus",
      },
    },
    threadId: "thread-opencode",
    sendResponse() {},
  });

  assert.equal(requests[0].path, "/session/ses_123/prompt_async");
  assert.deepEqual(requests[0].body.model, {
    providerID: "opencode-go",
    modelID: "qwen3.6-plus",
  });
  assert.equal(stateStore.get("thread-opencode")?.model, "opencode-go/qwen3.6-plus");
  assert.equal(stateStore.get("thread-opencode")?.modelProvider, "opencode-go");
});

test("OpenCode thread/compact/start posts summarize and completes the compaction turn", async () => {
  const { adapter, stateStore, requests } = createAdapter({
    requestImpl: async (_method, path) => {
      if (path === "/session/ses_123/summarize") {
        return true;
      }
      if (path === "/session/ses_123/diff") {
        return [];
      }
      throw new Error(`unexpected request ${path}`);
    },
  });
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_123",
    model: "opencode-go/deepseek-v4-flash",
    modelProvider: "opencode-go",
    runtimeLocked: true,
  });
  const outbound = [];

  await adapter.handleRuntimeRequest({
    parsed: {
      id: "compact-1",
      method: "thread/compact/start",
      params: {
        threadId: "thread-opencode",
        turnId: "turn-compact",
      },
    },
    threadId: "thread-opencode",
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });
  await flushAsync();
  await flushAsync();

  assert.deepEqual(requests[0], {
    method: "POST",
    path: "/session/ses_123/summarize",
    body: {
      providerID: "opencode-go",
      modelID: "deepseek-v4-flash",
      auto: false,
    },
  });
  assert.equal(outbound[0].result.turnId, "turn-compact");
  assert.equal(outbound[1].method, "remodex/event/turn_started");
  assert.equal(outbound.at(-1).method, "remodex/event/turn_completed");
});

test("OpenCode turn/start rejects empty prompt parts instead of starting a silent turn", async () => {
  const { adapter, stateStore, requests } = createAdapter();
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_123",
    runtimeLocked: true,
  });

  await assert.rejects(
    () => adapter.handleRuntimeRequest({
      parsed: {
        id: "turn-start-empty",
        method: "turn/start",
        params: {
          threadId: "thread-opencode",
          turnId: "turn-empty",
          input: [],
        },
      },
      threadId: "thread-opencode",
      sendResponse() {},
    }),
    /non-empty prompt/
  );
  assert.equal(requests.length, 0);
});

test("OpenCode turn/start maps event stream deltas, completion, and diff refresh to canonical events", async () => {
  const { adapter, stateStore, requests, eventHandlers } = createAdapter({
    requestImpl: async (_method, path) => {
      if (path === "/session/ses_123/diff") {
        return [{ path: "README.md", type: "modified" }];
      }
      return null;
    },
  });
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_123",
    opencodeBuildAgentName: "build",
    opencodePlanAgentName: "plan",
    runtimeLocked: true,
  });
  const outbound = [];

  await adapter.handleRuntimeRequest({
    parsed: {
      id: "turn-start-1",
      method: "turn/start",
      params: {
        threadId: "thread-opencode",
        turnId: "turn-123",
        prompt: "Say hello",
      },
    },
    threadId: "thread-opencode",
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });

  assert.equal(eventHandlers.length, 1);
  eventHandlers[0]({
    type: "message.part.updated",
    properties: {
      sessionID: "ses_123",
      part: {
        id: "prt_text",
        sessionID: "ses_123",
        messageID: "msg_assistant",
        type: "text",
        text: "",
      },
      time: 1,
    },
  });
  eventHandlers[0]({
    type: "message.part.delta",
    properties: {
      sessionID: "ses_123",
      messageID: "msg_assistant",
      partID: "prt_text",
      field: "text",
      delta: "Hello from OpenCode",
    },
  });
  eventHandlers[0]({
    type: "message.updated",
    properties: {
      sessionID: "ses_123",
      info: {
        id: "msg_assistant",
        sessionID: "ses_123",
        role: "assistant",
        time: { created: 1, completed: 2 },
        finish: "stop",
      },
    },
  });
  await flushAsync();

  const methods = outbound.map((message) => message.method).filter(Boolean);
  assert.deepEqual(methods, [
    "remodex/event/turn_started",
    "remodex/event/assistant_delta",
    "remodex/event/assistant_completed",
    "remodex/event/diff_updated",
    "remodex/event/turn_completed",
  ]);
  assert.equal(outbound.find((message) => message.method === "remodex/event/assistant_delta").params.payload.delta, "Hello from OpenCode");
  assert.deepEqual(
    outbound.find((message) => message.method === "remodex/event/diff_updated").params.payload.diff,
    [{ path: "README.md", type: "modified" }]
  );
  assert.equal(requests.at(-1).method, "GET");
  assert.equal(requests.at(-1).path, "/session/ses_123/diff");
});

test("OpenCode turn/start buffers early event stream messages until prompt_async is accepted", async () => {
  let resolvePrompt;
  const { adapter, stateStore, eventHandlers } = createAdapter({
    requestImpl: async (_method, path) => {
      if (path === "/session/ses_123/prompt_async") {
        return new Promise((resolve) => {
          resolvePrompt = resolve;
        });
      }
      if (path === "/session/ses_123/diff") {
        return [];
      }
      return null;
    },
  });
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_123",
    runtimeLocked: true,
  });
  const outbound = [];

  const turnStart = adapter.handleRuntimeRequest({
    parsed: {
      id: "turn-start-buffered",
      method: "turn/start",
      params: {
        threadId: "thread-opencode",
        turnId: "turn-buffered",
        prompt: "Start slowly",
      },
    },
    threadId: "thread-opencode",
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });
  await flushAsync();

  assert.equal(eventHandlers.length, 1);
  eventHandlers[0]({
    type: "message.part.updated",
    properties: {
      sessionID: "ses_123",
      part: {
        id: "prt_buffered",
        sessionID: "ses_123",
        messageID: "msg_buffered",
        type: "text",
        text: "",
      },
    },
  });
  eventHandlers[0]({
    type: "message.part.delta",
    properties: {
      sessionID: "ses_123",
      messageID: "msg_buffered",
      partID: "prt_buffered",
      field: "text",
      delta: "Buffered hello",
    },
  });
  await flushAsync();

  assert.deepEqual(outbound.map((message) => message.method).filter(Boolean), []);

  resolvePrompt(null);
  await turnStart;
  await flushAsync();

  assert.deepEqual(outbound.map((message) => message.method).filter(Boolean), [
    "remodex/event/turn_started",
    "remodex/event/assistant_delta",
  ]);
  assert.equal(
    outbound.find((message) => message.method === "remodex/event/assistant_delta").params.payload.delta,
    "Buffered hello"
  );
});

test("OpenCode completion grace keeps turn active for late event stream activity", async () => {
  const { adapter, stateStore, requests, eventHandlers } = createAdapter({
    completionGraceMs: 50,
    requestImpl: async (_method, path) => {
      if (path === "/session/ses_123/diff") {
        return [{ path: "late.txt", type: "modified" }];
      }
      return null;
    },
  });
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_123",
    runtimeLocked: true,
  });
  const outbound = [];

  await adapter.handleRuntimeRequest({
    parsed: {
      id: "turn-start-grace",
      method: "turn/start",
      params: {
        threadId: "thread-opencode",
        turnId: "turn-grace",
        prompt: "Finish with a late chunk",
      },
    },
    threadId: "thread-opencode",
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });
  eventHandlers[0]({
    type: "message.part.updated",
    properties: {
      sessionID: "ses_123",
      part: {
        id: "prt_grace",
        sessionID: "ses_123",
        messageID: "msg_grace",
        type: "text",
        text: "",
      },
    },
  });
  eventHandlers[0]({
    type: "message.updated",
    properties: {
      sessionID: "ses_123",
      info: {
        id: "msg_grace",
        sessionID: "ses_123",
        role: "assistant",
        time: { created: 1, completed: 2 },
        finish: "stop",
      },
    },
  });
  eventHandlers[0]({
    type: "message.part.delta",
    properties: {
      sessionID: "ses_123",
      messageID: "msg_grace",
      partID: "prt_grace",
      field: "text",
      delta: "late chunk",
    },
  });
  await flushAsync();

  assert.equal(outbound.some((message) => message.method === "remodex/event/turn_completed"), false);

  await waitUntil(() => outbound.some((message) => message.method === "remodex/event/turn_completed"));

  const methods = outbound.map((message) => message.method).filter(Boolean);
  assert.deepEqual(methods, [
    "remodex/event/turn_started",
    "remodex/event/assistant_completed",
    "remodex/event/assistant_delta",
    "remodex/event/diff_updated",
    "remodex/event/turn_completed",
  ]);
  assert.equal(requests.at(-1).path, "/session/ses_123/diff");
});

test("OpenCode permission request waits for phone response and replies to OpenCode", async () => {
  const { adapter, stateStore, requests, eventHandlers } = createAdapter();
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_123",
    runtimeLocked: true,
  });
  const outbound = [];

  await adapter.handleRuntimeRequest({
    parsed: {
      id: "turn-start-1",
      method: "turn/start",
      params: {
        threadId: "thread-opencode",
        turnId: "turn-123",
        prompt: "Edit a file",
      },
    },
    threadId: "thread-opencode",
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });
  eventHandlers[0]({
    type: "permission.asked",
    properties: {
      id: "per_123",
      sessionID: "ses_123",
      permission: "edit",
      patterns: ["src/**"],
      metadata: {},
      always: ["edit"],
    },
  });

  const permission = outbound.find((message) => message.method === "remodex/request/permission");
  assert.equal(permission.id, "per_123");

  const handled = await adapter.handleRuntimeResponse({
    rawMessage: JSON.stringify({
      id: "per_123",
      result: {
        permissions: { edit: true },
      },
    }),
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(requests.at(-1), {
    method: "POST",
    path: "/session/ses_123/permissions/per_123",
    body: { response: "once" },
  });
  assert.equal(outbound.at(-1).method, "serverRequest/resolved");
  assert.equal(outbound.at(-1).params.requestId, "per_123");
});

test("OpenCode question request waits for phone response and replies to OpenCode", async () => {
  const { adapter, stateStore, requests, eventHandlers } = createAdapter();
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_123",
    runtimeLocked: true,
  });
  const outbound = [];

  await adapter.handleRuntimeRequest({
    parsed: {
      id: "turn-start-question",
      method: "turn/start",
      params: {
        threadId: "thread-opencode",
        turnId: "turn-123",
        prompt: "Ask a question",
      },
    },
    threadId: "thread-opencode",
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });
  eventHandlers[0]({
    type: "question.asked",
    properties: {
      id: "que_123",
      sessionID: "ses_123",
      questions: [{
        header: "Direction",
        question: "Pick one",
        options: [
          { label: "A", description: "First" },
          { label: "B", description: "Second" },
        ],
      }],
    },
  });

  const question = outbound.find((message) => message.method === "item/tool/requestUserInput");
  assert.equal(question.id, "que_123");
  assert.equal(question.params.questions[0].id, "q1");

  const handled = await adapter.handleRuntimeResponse({
    rawMessage: JSON.stringify({
      id: "que_123",
      result: {
        answers: {
          q1: { answers: ["B"] },
        },
      },
    }),
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(requests.at(-1), {
    method: "POST",
    path: "/question/que_123/reply",
    body: { answers: [["B"]] },
  });
  assert.equal(outbound.at(-1).method, "serverRequest/resolved");
  assert.equal(outbound.at(-1).params.requestId, "que_123");
});

test("OpenCode stop posts abort for the runtime session", async () => {
  const { adapter, stateStore, requests } = createAdapter({
    requestImpl: async () => true,
  });
  stateStore.upsert("thread-opencode", {
    agentRuntime: "opencode",
    agentSessionId: "ses_123",
  });
  const outbound = [];

  await adapter.handleRuntimeRequest({
    parsed: {
      id: "turn-stop-1",
      method: "turn/interrupt",
      params: {
        threadId: "thread-opencode",
      },
    },
    threadId: "thread-opencode",
    sendResponse(rawMessage) {
      outbound.push(JSON.parse(rawMessage));
    },
  });

  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].path, "/session/ses_123/abort");
  assert.equal(outbound[0].result.aborted, true);
});

function createAuthedFsImpl() {
  return {
    existsSync: (filePath) => String(filePath).endsWith("auth.json"),
    readFileSync: () => JSON.stringify({ openai: { token: "test-token" } }),
  };
}

function createAdapter({
  serverStatus = { state: "ready", baseUrl: "http://127.0.0.1:49152" },
  requestImpl,
  fsImpl = createAuthedFsImpl(),
  modelCatalog = {
    defaultModelId: "opencode-go/deepseek-v4-flash",
    models: [
      {
        id: "opencode-go/deepseek-v4-flash",
        model: "opencode-go/deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
        providerID: "opencode-go",
        modelID: "deepseek-v4-flash",
        isDefault: true,
      },
      {
        id: "opencode-go/qwen3.6-plus",
        model: "opencode-go/qwen3.6-plus",
        displayName: "Qwen 3.6 Plus",
        providerID: "opencode-go",
        modelID: "qwen3.6-plus",
        isDefault: false,
      },
    ],
  },
  completionGraceMs = 0,
} = {}) {
  const requests = [];
  const eventHandlers = [];
  const stateStore = createThreadAgentStateStore({ stateFile: null });
  const serverManager = {
    getStatus() {
      return serverStatus;
    },
    start() {
      serverStatus = { state: "ready", baseUrl: "http://127.0.0.1:49152" };
      return serverStatus;
    },
    async request(method, path, options = {}) {
      requests.push({ method, path, body: options.body });
      if (requestImpl) {
        return requestImpl(method, path, options);
      }
      return path === "/session" ? { id: "ses_123" } : null;
    },
    subscribeEvents({ onEvent }) {
      eventHandlers.push(onEvent);
      return {
        close() {},
        closed: Promise.resolve(),
      };
    },
  };
  return {
    adapter: createOpenCodeRuntimeAdapter({
      serverManager,
      threadAgentState: stateStore,
      fsImpl,
      discoverAgents: () => [
        { id: "build", displayName: "Build", isDefaultBuild: true, isDefaultPlan: false },
        { id: "plan", displayName: "Plan", isDefaultBuild: false, isDefaultPlan: true },
      ],
      modelCatalogProvider: {
        async get() {
          return modelCatalog;
        },
      },
      completionGraceMs,
    }),
    eventHandlers,
    requests,
    stateStore,
  };
}

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate, { timeoutMs = 1_000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await delay(intervalMs);
  }
  assert.fail("Timed out waiting for condition.");
}
