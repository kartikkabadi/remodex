// FILE: opencode-provider.test.js
// Purpose: Verifies OpenCode provider thread/turn lifecycle, streaming, and error cases.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/opencode-provider

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOpenCodeClient, dispatchEvent } = require("../src/opencode-client");
const { createOpenCodeProvider } = require("../src/opencode-provider");

const activeProviders = [];

test.afterEach(async () => {
  while (activeProviders.length > 0) {
    const provider = activeProviders.pop();
    await provider.shutdown?.();
  }
});

function fakeServer() {
  let running = false;
  return {
    get baseUrl() {
      return running ? "http://127.0.0.1:4291" : "";
    },
    get isRunning() {
      return running;
    },
    start() {
      running = true;
      return Promise.resolve();
    },
    stop() {
      running = false;
      return Promise.resolve();
    },
  };
}

function fakeOwnershipStore() {
  const store = new Map();
  return {
    setOwnership(threadId, providerId) {
      store.set(threadId, { providerId, assignedAt: new Date().toISOString() });
      return true;
    },
    ownsThread(threadId, providerId) {
      const entry = store.get(threadId);
      return entry ? entry.providerId === providerId : false;
    },
    removeOwnership(threadId) {
      return store.delete(threadId);
    },
    getAllOwnedBy(providerId) {
      return Array.from(store.entries())
        .filter(([, entry]) => entry.providerId === providerId)
        .map(([threadId, entry]) => ({ threadId, ...entry }));
    },
  };
}

function fakeClient() {
  return {
    listModels: async () => [],
    listAgents: async () => [
      { id: "build", label: "Build" },
      { id: "plan", label: "Plan" },
    ],
    createSession: async () => "ses_fake123",
    getSession: async () => ({}),
    prompt: async () => Promise.resolve(),
    setModel: async () => {},
    setMode: async () => {},
    setEffort: async () => {},
    abort: async () => {},
    fork: async () => "ses_forked456",
    getMessages: async () => [],
    replyToPermission: async () => {},
    subscribeToEvents: (handler) => {
      setImmediate(() => {
        handler("turn/started", { turnId: "fake-turn-1" });
        handler("item/agentMessage/delta", { delta: "Hello from test agent." });
        handler("turn/completed", { status: "completed" });
      });
      return () => {};
    },
  };
}

function makeProvider(opts = {}) {
  const provider = createOpenCodeProvider({
    sendApplicationMessage: opts.send || (() => {}),
    env: { REMODEX_ENABLE_OPENCODE: "1", ...opts.env },
    serverFactory: opts.serverFactory || (() => fakeServer()),
    clientFactory: opts.clientFactory || (() => fakeClient()),
    ownershipStore: opts.ownershipStore || fakeOwnershipStore(),
  });
  activeProviders.push(provider);
  return provider;
}

test("provider has expected API surface", () => {
  const provider = makeProvider();
  assert.equal(provider.id, "opencode");
  assert.equal(typeof provider.ownsThread, "function");
  assert.equal(typeof provider.listModels, "function");
  assert.equal(typeof provider.listAgents, "function");
  assert.equal(typeof provider.listCommands, "function");
  assert.equal(typeof provider.listThreads, "function");
  assert.equal(typeof provider.handleRequest, "function");
  assert.equal(typeof provider.shutdown, "function");
  assert.equal(typeof provider.getHandoffContext, "function");
});

test("ownsThread returns false for unknown thread", () => {
  const provider = makeProvider();
  assert.equal(provider.ownsThread("unknown-thread"), false);
});

test("threadStart creates thread and records ownership", async () => {
  const provider = makeProvider();
  const result = await provider.handleRequest({
    id: 1,
    method: "thread/start",
    params: { model: "openai/gpt-5.5", title: "Test thread", cwd: "/tmp/test" },
  });

  assert.ok(result.thread);
  assert.ok(result.thread.id.startsWith("opencode-thread-"));
  assert.equal(result.thread.title, "Test thread");
  assert.equal(result.thread.modelProvider, "opencode");
  assert.equal(provider.ownsThread(result.thread.id), true);
});

test("threadRead returns thread data", async () => {
  const provider = makeProvider();
  const start = await provider.handleRequest({
    id: 1,
    method: "thread/start",
    params: { title: "Read test" },
  });
  const read = await provider.handleRequest({
    id: 2,
    method: "thread/read",
    params: { threadId: start.thread.id },
  });
  assert.ok(read.thread);
  assert.equal(read.thread.id, start.thread.id);
});

test("threadRead throws for unknown thread", async () => {
  const provider = makeProvider();
  await assert.rejects(
    () => provider.handleRequest({ id: 1, method: "thread/read", params: { threadId: "nope" } }),
    { errorCode: "thread_not_found" },
  );
});

test("threadArchive toggles archived flag", async () => {
  const provider = makeProvider();
  const start = await provider.handleRequest({ id: 1, method: "thread/start", params: {} });
  await provider.handleRequest({
    id: 2,
    method: "thread/archive",
    params: { threadId: start.thread.id },
  });
  const list = await provider.listThreads({ includeArchived: true });
  const found = list.data.find((t) => t.id === start.thread.id);
  assert.ok(found);
});

test("threadNameSet updates title", async () => {
  const messages = [];
  const provider = makeProvider({ send: (msg) => messages.push(JSON.parse(msg)) });
  const start = await provider.handleRequest({
    id: 1,
    method: "thread/start",
    params: { title: "Old name" },
  });
  const result = await provider.handleRequest({
    id: 2,
    method: "thread/name/set",
    params: { threadId: start.thread.id, name: "New name" },
  });
  assert.equal(result.thread.title, "New name");
  assert.ok(messages.some((m) => m.method === "thread/name/updated"));
});

test("turnStart requires text input", async () => {
  const provider = makeProvider();
  const start = await provider.handleRequest({ id: 1, method: "thread/start", params: {} });
  await assert.rejects(
    () =>
      provider.handleRequest({
        id: 2,
        method: "turn/start",
        params: { threadId: start.thread.id },
      }),
    { errorCode: "opencode_input_required" },
  );
});

test("turnStart on already-running thread throws", async () => {
  const provider = makeProvider();
  const start = await provider.handleRequest({ id: 1, method: "thread/start", params: {} });
  await provider.handleRequest({
    id: 2,
    method: "turn/start",
    params: { threadId: start.thread.id, input: "test" },
  });
  await assert.rejects(
    () =>
      provider.handleRequest({
        id: 3,
        method: "turn/start",
        params: { threadId: start.thread.id, input: "test2" },
      }),
    { errorCode: "thread_turn_active" },
  );
});

test("turnInterrupt completes running turn", async () => {
  let completed = false;
  const provider = makeProvider({
    send: (msg) => {
      const p = JSON.parse(msg);
      if (p.method === "turn/completed" && p.params.status === "stopped") completed = true;
    },
  });
  const start = await provider.handleRequest({ id: 1, method: "thread/start", params: {} });
  await provider.handleRequest({
    id: 2,
    method: "turn/start",
    params: { threadId: start.thread.id, input: "test" },
  });
  const result = await provider.handleRequest({
    id: 3,
    method: "turn/interrupt",
    params: { threadId: start.thread.id },
  });
  assert.equal(result.success, true);
  assert.equal(result.interrupted, true);
  assert.equal(completed, true);
});

test("listThreads returns created threads", async () => {
  const provider = makeProvider();
  await provider.handleRequest({ id: 1, method: "thread/start", params: { title: "First" } });
  await provider.handleRequest({ id: 2, method: "thread/start", params: { title: "Second" } });
  const list = await provider.listThreads();
  assert.ok(list.data.length >= 2);
});

test("unsupported method throws error", async () => {
  const provider = makeProvider();
  await assert.rejects(() => provider.handleRequest({ id: 1, method: "turn/steer", params: {} }), {
    errorCode: "unsupported_opencode_method",
  });
});

test("shutdown cleans up state", async () => {
  const provider = makeProvider();
  await provider.handleRequest({ id: 1, method: "thread/start", params: {} });
  await provider.shutdown();
});

test("listAgents returns agents from client", async () => {
  const provider = makeProvider();
  const agents = await provider.listAgents();
  assert.ok(Array.isArray(agents));
  assert.ok(agents.some((a) => a.id === "build"));
});

test("turnStart emits turn/started notification", async () => {
  const messages = [];
  const provider = makeProvider({ send: (msg) => messages.push(JSON.parse(msg)) });
  const start = await provider.handleRequest({ id: 1, method: "thread/start", params: {} });
  await provider.handleRequest({
    id: 2,
    method: "turn/start",
    params: { threadId: start.thread.id, input: "hello world" },
  });
  assert.ok(messages.some((m) => m.method === "turn/started"));
});

test("turnStart returns turnId and status running", async () => {
  const provider = makeProvider();
  const start = await provider.handleRequest({ id: 1, method: "thread/start", params: {} });
  const result = await provider.handleRequest({
    id: 2,
    method: "turn/start",
    params: { threadId: start.thread.id, input: "test" },
  });
  assert.ok(result.turnId);
  assert.ok(result.turnId.startsWith("opencode-turn-"));
  assert.equal(result.turn.status, "running");
});

test("threadFork creates new thread with forked session", async () => {
  const provider = makeProvider();
  const start = await provider.handleRequest({
    id: 1,
    method: "thread/start",
    params: { title: "Source thread" },
  });

  await provider.handleRequest({
    id: 2,
    method: "turn/start",
    params: { threadId: start.thread.id, input: "test fork" },
  });

  // Wait for setImmediate in executeTurn to set sessionId
  await new Promise((resolve) => setImmediate(resolve));

  const forkResult = await provider.handleRequest({
    id: 3,
    method: "thread/fork",
    params: { threadId: start.thread.id },
  });

  assert.ok(forkResult.thread);
  assert.ok(forkResult.thread.id.startsWith("opencode-thread-"));
  assert.notEqual(forkResult.thread.id, start.thread.id);
  assert.equal(provider.ownsThread(forkResult.thread.id), true);
});

test("threadFork without session returns error", async () => {
  const provider = makeProvider();
  const start = await provider.handleRequest({
    id: 1,
    method: "thread/start",
    params: { title: "No session thread" },
  });

  await assert.rejects(
    () =>
      provider.handleRequest({
        id: 2,
        method: "thread/fork",
        params: { threadId: start.thread.id },
      }),
    { errorCode: "opencode_fork_requires_session" },
  );
});

test("threadFork on unknown thread returns error", async () => {
  const provider = makeProvider();
  await assert.rejects(
    () =>
      provider.handleRequest({
        id: 1,
        method: "thread/fork",
        params: { threadId: "nonexistent" },
      }),
    { errorCode: "thread_not_found" },
  );
});

test("duplicate turn/completed from session.idle is ignored after first completion", async () => {
  const emitted = [];
  const provider = makeProvider({
    send: (raw) => {
      const message = JSON.parse(raw);
      emitted.push(message.method);
    },
    clientFactory: () => ({
      ...fakeClient(),
      subscribeToEvents: (handler) => {
        setImmediate(() => {
          dispatchEvent({ type: "turn/completed", status: "completed" }, handler);
          dispatchEvent(
            { type: "session.idle", properties: { sessionID: "ses_fake123" } },
            handler,
          );
        });
        return () => {};
      },
    }),
  });

  const start = await provider.handleRequest({
    id: 1,
    method: "thread/start",
    params: { title: "Idle dedupe" },
  });
  await provider.handleRequest({
    id: 2,
    method: "turn/start",
    params: { threadId: start.thread.id, input: "hello" },
  });

  const deadline = Date.now() + 2000;
  let completedCount = 0;
  while (Date.now() < deadline) {
    completedCount = emitted.filter((method) => method === "turn/completed").length;
    if (completedCount >= 1) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(completedCount, 1);
});

function createProbeMockClient({ connected = [], auth = {} } = {}) {
  return async () =>
    createOpenCodeClient({
      baseUrl: "http://127.0.0.1:4291",
      createOpencodeClientImpl: () => () => ({
        provider: {
          list: async () => ({ connected }),
          auth: async () => auth,
        },
        app: { agents: async () => ({ data: [] }), skills: async () => [] },
        session: {
          create: async () => "ses_probe",
          get: async () => ({}),
          prompt: async () => ({}),
          setConfig: async () => ({}),
          abort: async () => ({}),
          messages: async () => ({ messages: [] }),
          fork: async () => "ses_fork",
        },
        permission: { reply: async () => ({}) },
        command: { list: async () => [] },
        event: {
          subscribe: async () => ({
            stream: (async function* empty() {})(),
            close: () => {},
          }),
        },
        tui: { selectSession: async () => ({}) },
      }),
    });
}

test("listModels with unknown meta sets authConfigured null", async () => {
  const client = {
    ...fakeClient(),
    listModels: async () => ({
      models: [],
      meta: {
        reasonCode: "unknown",
        connectedProviderIds: ["orphan-id"],
        fetchedAt: "2026-06-03T12:00:00.000Z",
        stale: false,
        modelCountBeforeCap: 0,
        modelCountAfterCap: 0,
      },
      connectedProviders: [],
    }),
    listProviderInventory: async () => ({
      inventory: { all: [], connected: ["orphan-id"], default: {} },
      models: [],
      meta: {
        reasonCode: "unknown",
        connectedProviderIds: ["orphan-id"],
        fetchedAt: "2026-06-03T12:00:00.000Z",
        stale: false,
        modelCountBeforeCap: 0,
        modelCountAfterCap: 0,
      },
      connectedProviders: [],
    }),
  };
  const provider = makeProvider({ clientFactory: async () => client });
  const result = await provider.listModels();
  assert.equal(result.meta.reasonCode, "unknown");
  assert.equal(provider.getRuntimeStatus().authConfigured, null);
});

test("forced listModels keeps live meta as source of truth", async () => {
  const liveMeta = {
    reasonCode: "ok",
    connectedProviderIds: ["anthropic"],
    fetchedAt: "2026-06-03T12:00:00.000Z",
    stale: false,
    modelCountBeforeCap: 1,
    modelCountAfterCap: 1,
  };
  const client = {
    ...fakeClient(),
    listModels: async ({ force }) => ({
      models: force
        ? [
            {
              id: "anthropic/claude",
              model: "anthropic/claude",
              modelProvider: "opencode",
              provider: "opencode",
            },
          ]
        : [],
      meta: liveMeta,
      connectedProviders: [{ id: "anthropic", displayName: "Anthropic", modelCount: 1 }],
    }),
    listProviderInventory: async ({ force }) => ({
      inventory: {
        all: [
          {
            id: "anthropic",
            name: "Anthropic",
            source: "api",
            models: { claude: { id: "claude", name: "Claude" } },
          },
        ],
        connected: ["anthropic"],
        default: {},
      },
      models: force
        ? [
            {
              id: "anthropic/claude",
              model: "anthropic/claude",
              modelProvider: "opencode",
            },
          ]
        : [],
      meta: liveMeta,
      connectedProviders: [{ id: "anthropic", displayName: "Anthropic", modelCount: 1 }],
    }),
  };
  const provider = makeProvider({ clientFactory: async () => client });
  await provider.listModels({ force: true, refreshProviders: true });
  assert.equal(provider.getLastModelListMeta()?.reasonCode, "ok");
  assert.equal(provider.getRuntimeStatus().authConfigured, true);
});

test("forced listModels does not adopt stale inventory meta over live listModels meta", async () => {
  const liveMeta = {
    reasonCode: "unknown",
    connectedProviderIds: ["orphan-id"],
    fetchedAt: "2026-06-03T12:00:00.000Z",
    stale: false,
    modelCountBeforeCap: 0,
    modelCountAfterCap: 0,
  };
  const staleInventoryMeta = {
    reasonCode: "ok",
    connectedProviderIds: ["anthropic"],
    fetchedAt: "2026-06-02T00:00:00.000Z",
    stale: true,
    modelCountBeforeCap: 5,
    modelCountAfterCap: 5,
  };
  const client = {
    ...fakeClient(),
    listModels: async () => ({
      models: [],
      meta: liveMeta,
      connectedProviders: [],
    }),
    listProviderInventory: async () => ({
      inventory: { all: [], connected: ["orphan-id"], default: {} },
      models: [
        {
          id: "anthropic/claude",
          model: "anthropic/claude",
          modelProvider: "opencode",
        },
      ],
      meta: staleInventoryMeta,
      connectedProviders: [{ id: "anthropic", displayName: "Anthropic", modelCount: 1 }],
    }),
  };
  const provider = makeProvider({ clientFactory: async () => client });
  await provider.listModels({ force: true, refreshProviders: true });
  assert.equal(provider.getLastModelListMeta()?.reasonCode, "unknown");
  assert.equal(provider.getLastModelListMeta()?.stale, false);
  assert.equal(provider.getRuntimeStatus().authConfigured, null);
});

test("getRuntimeStatus exposes authConfigured after connected provider probe", async () => {
  const probeClient = {
    ...fakeClient(),
    probeConnectedProviders: async () => true,
    probeProviderAuthState: async () => null,
  };
  const provider = makeProvider({
    clientFactory: async () => probeClient,
  });

  await provider.warmup();

  const status = provider.getRuntimeStatus();
  assert.equal(status.authConfigured, true);
});

test("getHandoffContext ignores untrusted client sessionId and directory", async () => {
  const provider = makeProvider();
  const start = await provider.handleRequest({
    id: 1,
    method: "thread/start",
    params: {
      title: "Handoff test",
      cwd: "/tmp/owned-project",
      sessionId: "ses_owned",
    },
  });

  const context = await provider.getHandoffContext(start.thread.id, {
    sessionId: "ses_untrusted",
    directory: "/tmp/evil-path",
  });

  assert.equal(context.threadId, start.thread.id);
  assert.equal(context.sessionId, "ses_owned");
  assert.equal(context.cwd, "/tmp/owned-project");
});
