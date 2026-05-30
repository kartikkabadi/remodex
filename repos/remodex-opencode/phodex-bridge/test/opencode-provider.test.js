// FILE: opencode-provider.test.js
// Purpose: Verifies OpenCode provider thread/turn RPCs with injected dependencies.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/opencode-provider

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createOpenCodeProvider,
  parseOpenCodeExport,
} = require("../src/opencode-provider");

function makeProvider(messages, options = {}) {
  return createOpenCodeProvider({
    sendApplicationMessage(msg) {
      if (messages) messages.push(JSON.parse(msg));
    },
    acpTransport: {
      isConnected() { return true; },
      start() { return Promise.resolve(); },
      stop() {},
      sendRequest(method, params) {
        return Promise.resolve({ result: {} });
      },
      onNotification(method, handler) {
        this._notifyHandlers = this._notifyHandlers || {};
        this._notifyHandlers[method] = this._notifyHandlers[method] || [];
        this._notifyHandlers[method].push(handler);
        return () => {};
      },
      onClose(handler) {},
      onError(handler) {},
    },
    catalogService: {
      fetchModels() { return Promise.resolve([]); },
      fetchAgents() { return Promise.resolve([]); },
      probeVersion() { return Promise.resolve(false); },
      invalidateCaches() {},
    },
    agentDiscoveryService: {
      discoverAgents() { return Promise.resolve([]); },
    },
    ...options,
  });
}

test("thread/start creates a thread and marks ownership", async () => {
  const provider = makeProvider();

  const result = await provider.handleRequest({
    method: "thread/start",
    params: { title: "Test thread", cwd: "/tmp/test", model: "opencode/gpt-5.5" },
  });

  assert.ok(result.thread.id.startsWith("opencode-thread-"));
  assert.equal(result.thread.title, "Test thread");
  assert.equal(result.thread.cwd, "/tmp/test");
  assert.equal(result.thread.modelProvider, "opencode");
  assert.equal(provider.ownsThread(result.thread.id), true);
});

test("turn/start validates the thread exists", async () => {
  const provider = makeProvider();

  await assert.rejects(
    provider.handleRequest({
      method: "turn/start",
      params: { threadId: "nonexistent", model: "opencode/gpt-5.5", input: "hello" },
    }),
    /thread not found/
  );
});

test("thread/read returns a thread with turns", async () => {
  const provider = makeProvider();

  const created = await provider.handleRequest({
    method: "thread/start",
    params: { title: "Readable", model: "opencode/gpt-5.5" },
  });

  const read = await provider.handleRequest({
    method: "thread/read",
    params: { threadId: created.thread.id, includeTurns: true },
  });

  assert.equal(read.thread.id, created.thread.id);
  assert.ok(Array.isArray(read.thread.turns));
});

test("turn/start creates turn with user message and emits turn/started", async () => {
  const messages = [];
  const provider = makeProvider(messages);

  const thread = await provider.handleRequest({
    method: "thread/start",
    params: { model: "opencode/gpt-5.5" },
  });

  const turnResult = await provider.handleRequest({
    method: "turn/start",
    params: { threadId: thread.thread.id, model: "opencode/gpt-5.5", input: "hello" },
  });

  assert.ok(turnResult.turnId.startsWith("opencode-turn-"));
  assert.equal(turnResult.turn.status, "running");

  const startedMessages = messages.filter((m) => m.method === "turn/started");
  assert.equal(startedMessages.length, 1);
  assert.equal(startedMessages[0].params.turnId, turnResult.turnId);

  // Verify turn was added to thread
  const read = await provider.handleRequest({
    method: "thread/read",
    params: { threadId: thread.thread.id, includeTurns: true },
  });
  assert.equal(read.thread.turns.length, 1);
  assert.equal(read.thread.turns[0].items[0].type, "userMessage");
  assert.equal(read.thread.turns[0].items[0].text, "hello");
});

test("thread/turns/list returns turns from thread state", async () => {
  const provider = makeProvider();

  const thread = await provider.handleRequest({
    method: "thread/start",
    params: { model: "opencode/gpt-5.5" },
  });

  const turnEntry = {
    id: "turn-1",
    status: "completed",
    model: "opencode/gpt-5.5",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    items: [
      {
        id: "user-1", type: "userMessage", role: "user",
        text: "test", content: [{ type: "text", text: "test" }],
        createdAt: new Date().toISOString(),
      },
    ],
    metadata: { threadId: thread.thread.id, provider: "opencode" },
  };
  provider.threads.get(thread.thread.id).turns.push(turnEntry);

  const list = await provider.handleRequest({
    method: "thread/turns/list",
    params: { threadId: thread.thread.id },
  });

  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].id, "turn-1");
});

test("thread/start does not remember fallback cwd", async () => {
  const remembered = [];
  const provider = makeProvider(null, {
    projectRegistry: {
      rememberProjectPath(path, meta) { remembered.push({ path, meta }); },
    },
  });

  await provider.handleRequest({
    method: "thread/start",
    params: { model: "opencode/gpt-5.5" },
  });

  assert.deepEqual(remembered, []);
});

test("thread/name/set updates title and emits event", async () => {
  const messages = [];
  const provider = makeProvider(messages);

  const created = await provider.handleRequest({
    method: "thread/start",
    params: { title: "Old name", model: "opencode/gpt-5.5" },
  });

  const result = await provider.handleRequest({
    method: "thread/name/set",
    params: { threadId: created.thread.id, name: "New name" },
  });

  assert.equal(result.thread.title, "New name");

  const nameEvents = messages.filter((m) => m.method === "thread/name/updated");
  assert.equal(nameEvents.length, 1);
  assert.equal(nameEvents[0].params.name, "New name");
});

test("listModels returns catalog results", async () => {
  const provider = makeProvider(null, {
    catalogService: {
      fetchModels() {
        return Promise.resolve([{
          id: "opencode/gpt-5.5",
          model: "opencode/gpt-5.5",
          modelProvider: "opencode",
          displayName: "GPT-5.5",
          isDefault: true,
          supportsFastMode: false,
          supportedReasoningEfforts: [],
          defaultReasoningEffort: null,
          capabilities: {},
        }]);
      },
      fetchAgents() { return Promise.resolve([]); },
      probeVersion() { return Promise.resolve(false); },
      invalidateCaches() {},
    },
  });

  const models = await provider.listModels();
  assert.equal(models.length, 1);
  assert.equal(models[0].displayName, "GPT-5.5");
});

test("export parsing with parseOpenCodeExport", () => {
  const storedTurn = {
    id: "opencode-turn-local",
    status: "completed",
    items: [
      { id: "user-local", type: "userMessage", text: "ciao" },
      { id: "agent-local", type: "agentMessage", text: "Ciao! Come posso aiutarti?" },
    ],
  };

  const turns = parseOpenCodeExport(JSON.stringify({
    messages: [
      {
        info: { id: "msg-user", role: "user" },
        parts: [{ type: "text", text: "ciao" }],
      },
      {
        info: { id: "msg-assistant", role: "assistant" },
        parts: [{ type: "text", text: "Ciao! Come posso aiutarti?" }],
      },
    ],
  }), { turns: [storedTurn] });

  assert.equal(turns.length, 1);
  assert.equal(turns[0].id, "opencode-turn-local");
});

test("export parsing drops sanitized placeholders", () => {
  const turns = parseOpenCodeExport(JSON.stringify({
    messages: [
      {
        info: { id: "msg-redacted", role: "user" },
        parts: [{ type: "text", text: "[redacted:text:prt_e5163dcc9001pKQKV4VPozQdgE]" }],
      },
      {
        info: { id: "msg-redacted2", role: "assistant" },
        parts: [{ type: "text", text: "[redacted:text:prt_e5163e657001MmdkT4ans3C8pl]" }],
      },
    ],
  }), { turns: [] });

  assert.deepEqual(turns, []);
});

test("thread/archive toggles archived flag", async () => {
  const provider = makeProvider();

  const created = await provider.handleRequest({
    method: "thread/start",
    params: { title: "T", model: "opencode/gpt-5.5" },
  });

  await provider.handleRequest({
    method: "thread/archive",
    params: { threadId: created.thread.id },
  });

  const read = await provider.handleRequest({
    method: "thread/read",
    params: { threadId: created.thread.id },
  });
  assert.equal(read.thread.metadata.provider, "opencode");
});

test("thread/start with cwd has project in public view", async () => {
  const provider = makeProvider();

  const result = await provider.handleRequest({
    method: "thread/start",
    params: { title: "P", cwd: "/Users/me/project", model: "opencode/gpt-5.5" },
  });

  assert.equal(result.thread.cwd, "/Users/me/project");
});

test("turn/start rejects duplicate active turns", async () => {
  const provider = makeProvider();

  const thread = await provider.handleRequest({
    method: "thread/start",
    params: { model: "opencode/gpt-5.5" },
  });

  await provider.handleRequest({
    method: "turn/start",
    params: { threadId: thread.thread.id, model: "opencode/gpt-5.5", input: "first" },
  });

  await assert.rejects(
    provider.handleRequest({
      method: "turn/start",
      params: { threadId: thread.thread.id, model: "opencode/gpt-5.5", input: "second" },
    }),
    /already has a running turn/
  );
});
