// FILE: cursor-runtime-adapter.test.js
// Purpose: Verifies Cursor runtime request mapping, status, and failure isolation.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, fs, os, path, ../src/cursor-runtime-adapter, ../src/thread-agent-state

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createCursorRuntimeAdapter,
  mapCursorDiscoveryToRuntimeStatus,
} = require("../src/cursor-runtime-adapter");
const { createThreadAgentStateStore } = require("../src/thread-agent-state");

test("Cursor runtime adapter maps discovery status into runtime list entry", async () => {
  await withTempState(async ({ stateStore }) => {
    const adapter = createCursorRuntimeAdapter({
      threadAgentState: stateStore,
      discoverCommand: async () => ({ status: "ready", command: "agent", args: ["acp"] }),
    });
    const entry = await adapter.getRuntimeListEntry();
    assert.equal(entry.id, "cursor");
    assert.equal(entry.status, "ready");
    assert.equal(entry.capabilities.planMode, true);
    assert.equal(entry.capabilities.photos, false);
    assert.equal(entry.modelCatalog.status, "unavailable");
    assert.deepEqual(mapCursorDiscoveryToRuntimeStatus({ status: "not_installed" }).status, "not_installed");
  });
});

test("Cursor thread/start creates an ACP session, locks state, and emits canonical thread_started", async () => {
  await withTempState(async ({ stateStore }) => {
    const { adapter, requests } = createAdapter({
      stateStore,
      clientResults: [{ sessionId: "cur-123", title: "Cursor session" }],
    });
    const outbound = [];

    await adapter.handleRuntimeRequest({
      parsed: {
        id: "thread-start-1",
        method: "thread/start",
        params: {
          threadId: "thread-cursor",
          agentRuntime: "cursor",
          title: "Build it",
          cwd: "/repo",
        },
      },
      threadId: "thread-cursor",
      sendResponse(rawMessage) {
        outbound.push(JSON.parse(rawMessage));
      },
    });

    assert.deepEqual(requests[0], {
      method: "session/new",
      params: {
        cwd: "/repo",
        mcpServers: [],
        mode: "agent",
        title: "Build it",
      },
    });
    assert.equal(outbound[0].result.thread.agentRuntime, "cursor");
    assert.equal(outbound[1].method, "remodex/event/thread_started");
    assert.equal(stateStore.get("thread-cursor").runtimeLocked, true);
  });
});

test("Cursor thread/resume reuses the stored ACP session without creating a new one", async () => {
  await withTempState(async ({ stateStore }) => {
    const { adapter, requests } = createAdapter({
      stateStore,
      clientResults: [{ sessionId: "cur-fresh", title: "Unexpected fresh session" }],
    });
    stateStore.upsert("thread-cursor", {
      agentRuntime: "cursor",
      agentSessionId: "cur-existing",
      cwd: "/repo",
      runtimeLocked: true,
    });
    const outbound = [];

    await adapter.handleRuntimeRequest({
      parsed: {
        id: "thread-resume-1",
        method: "thread/resume",
        params: {
          threadId: "thread-cursor",
          agentRuntime: "cursor",
          cwd: "/repo",
        },
      },
      threadId: "thread-cursor",
      sendResponse(rawMessage) {
        outbound.push(JSON.parse(rawMessage));
      },
    });

    assert.deepEqual(requests, []);
    assert.equal(outbound[0].result.thread.agentSessionId, "cur-existing");
    assert.equal(outbound[1].method, "remodex/event/thread_started");
    assert.equal(outbound[1].params.agentSessionId, "cur-existing");
    assert.equal(stateStore.get("thread-cursor").agentSessionId, "cur-existing");
    assert.equal(stateStore.get("thread-cursor").runtimeLocked, true);
  });
});

test("Cursor turn/start prompts in plan mode and maps ACP notifications to canonical", async () => {
  await withTempState(async ({ stateStore }) => {
    const { adapter, requests } = createAdapter({
      stateStore,
      clientResults: [null],
      onClientRequest(_method, _params, clientOptions) {
        clientOptions.onNotification({
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Hello" },
            },
          },
        });
      },
    });
    stateStore.upsert("thread-cursor", {
      agentRuntime: "cursor",
      agentSessionId: "cur-123",
      runtimeLocked: true,
    });
    const outbound = [];

    await adapter.handleRuntimeRequest({
      parsed: {
        id: "turn-start-1",
        method: "turn/start",
        params: {
          threadId: "thread-cursor",
          turnId: "turn-1",
          prompt: "Plan this",
          mode: "plan",
        },
      },
      threadId: "thread-cursor",
      sendResponse(rawMessage) {
        outbound.push(JSON.parse(rawMessage));
      },
    });
    assert.deepEqual(requests[0], {
      method: "session/prompt",
      params: {
        sessionId: "cur-123",
        prompt: [{ type: "text", text: "Plan this" }],
        mode: "plan",
      },
    });
    assert.equal(outbound[0].result.agentSessionId, "cur-123");
    assert.equal(outbound[1].method, "remodex/event/turn_started");
    assert.equal(outbound[2].method, "remodex/event/assistant_delta");
    assert.equal(outbound[2].params.turnId, "turn-1");
  });
});

test("Cursor handleRuntimeResponse forwards phone permission replies to ACP", async () => {
  await withTempState(async ({ stateStore }) => {
    const fakeClients = [];
    const { adapter } = createAdapter({
      stateStore,
      clientResults: [null],
      fakeClients,
    });
    stateStore.upsert("thread-cursor", {
      agentRuntime: "cursor",
      agentSessionId: "cur-123",
      runtimeLocked: true,
    });
    const outbound = [];

    await adapter.handleRuntimeRequest({
      parsed: {
        id: "turn-start-perm",
        method: "turn/start",
        params: {
          threadId: "thread-cursor",
          turnId: "turn-perm",
          prompt: "Need approval",
        },
      },
      threadId: "thread-cursor",
      sendResponse(rawMessage) {
        outbound.push(JSON.parse(rawMessage));
      },
    });

    fakeClients[0].emitRequest({
      id: 42,
      method: "permission/request",
      params: { id: "perm-1" },
    });

    const handled = await adapter.handleRuntimeResponse({
      parsed: {
        id: 42,
        result: { decision: "accept" },
      },
      sendResponse(rawMessage) {
        outbound.push(JSON.parse(rawMessage));
      },
    });

    assert.equal(handled, true);
    assert.equal(fakeClients[0].responded.length, 1);
    assert.deepEqual(fakeClients[0].responded[0], {
      id: 42,
      result: { decision: "accept" },
    });
    assert.equal(outbound.at(-1)?.method, "serverRequest/resolved");
  });
});

test("Cursor stop sends session/cancel and transport does not auto-approve permission requests", async () => {
  await withTempState(async ({ stateStore }) => {
    const fakeClients = [];
    const { adapter, requests } = createAdapter({
      stateStore,
      clientResults: [null],
      fakeClients,
    });
    stateStore.upsert("thread-cursor", {
      agentRuntime: "cursor",
      agentSessionId: "cur-123",
      runtimeLocked: true,
    });
    const outbound = [];

    await adapter.handleRuntimeRequest({
      parsed: {
        id: "turn-stop-1",
        method: "turn/interrupt",
        params: { threadId: "thread-cursor" },
      },
      threadId: "thread-cursor",
      sendResponse(rawMessage) {
        outbound.push(JSON.parse(rawMessage));
      },
    });
    const permissionResult = fakeClients[0].emitRequest({
      id: 4,
      method: "permission/request",
      params: { id: "perm-1" },
    });

    assert.deepEqual(requests[0], {
      method: "session/cancel",
      params: { sessionId: "cur-123" },
    });
    assert.equal(outbound[0].result.cancelled, true);
    assert.equal(outbound[1].method, "remodex/request/permission");
    assert.equal(permissionResult, undefined);
  });
});

function createAdapter({
  stateStore,
  clientResults = [],
  fakeClients = [],
  onClientRequest,
} = {}) {
  const requests = [];
  const adapter = createCursorRuntimeAdapter({
    threadAgentState: stateStore,
    discoverCommand: async () => ({ status: "ready", command: "agent", args: ["acp"] }),
    createClient(options) {
      const client = {
        responded: [],
        async request(method, params) {
          requests.push({ method, params });
          onClientRequest?.(method, params, options);
          return clientResults.shift() ?? null;
        },
        respond(id, result) {
          this.responded.push({ id, result });
        },
        rejectRequest(id, code, message) {
          this.responded.push({ id, error: { code, message } });
        },
        emitNotification(frame) {
          options.onNotification(frame);
        },
        emitRequest(frame) {
          return options.onRequest(frame);
        },
        stop() {},
      };
      fakeClients.push(client);
      return client;
    },
  });
  return { adapter, requests };
}

async function withTempState(run) {
  const previousDir = process.env.REMODEX_DEVICE_STATE_DIR;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-cursor-runtime-"));
  process.env.REMODEX_DEVICE_STATE_DIR = stateDir;
  try {
    await run({ stateStore: createThreadAgentStateStore() });
  } finally {
    if (previousDir === undefined) {
      delete process.env.REMODEX_DEVICE_STATE_DIR;
    } else {
      process.env.REMODEX_DEVICE_STATE_DIR = previousDir;
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}
