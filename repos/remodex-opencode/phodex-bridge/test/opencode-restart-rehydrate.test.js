// FILE: opencode-restart-rehydrate.test.js
// Purpose: Verifies OpenCode threads rehydrate from persisted session store after a new provider instance.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/opencode-provider, ../src/opencode-session-store

if (process.env.REMODEX_TEST !== "1") {
  throw new Error(
    "opencode-restart-rehydrate.test.js must run with the test harness preload.\n" +
      "  npm test\n" +
      "  node -r ./test/test-env.js --test ./test/opencode-restart-rehydrate.test.js",
  );
}

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOpenCodeProvider } = require("../src/opencode-provider");
const { createOpenCodeSessionStore } = require("../src/opencode-session-store");

function fakeFs() {
  const files = new Map();
  return {
    readFileSync(path) {
      if (files.has(path)) return files.get(path);
      throw new Error("ENOENT");
    },
    writeFileSync(path, data) {
      files.set(path, data);
    },
    renameSync(oldPath, newPath) {
      if (files.has(oldPath)) {
        files.set(newPath, files.get(oldPath));
        files.delete(oldPath);
      }
    },
    mkdirSync() {},
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

function fakeClient({ getSessionImpl, getMessagesImpl } = {}) {
  return {
    listModels: async () => [],
    listAgents: async () => [{ id: "build", label: "Build" }],
    createSession: async () => "ses_new",
    getSession:
      getSessionImpl ||
      (async (sessionId) => ({
        sessionID: sessionId,
        directory: "/tmp/rehydrate-project",
      })),
    getMessages: getMessagesImpl || (async () => []),
    prompt: async () => {},
    setModel: async () => {},
    setMode: async () => {},
    setEffort: async () => {},
    abort: async () => {},
    fork: async () => "ses_forked",
    replyToPermission: async () => {},
    subscribeToEvents: () => () => {},
  };
}

function makeProvider({ sessionStore, ownershipStore, clientFactory }) {
  delete process.env.REMODEX_DISABLE_OPENCODE;
  return createOpenCodeProvider({
    sendApplicationMessage: () => {},
    env: { REMODEX_ENABLE_OPENCODE: "1" },
    serverFactory: () => fakeServer(),
    clientFactory: clientFactory || (() => fakeClient()),
    ownershipStore: ownershipStore || fakeOwnershipStore(),
    sessionStore,
  });
}

test("thread/read rehydrates from persisted session after provider restart", async () => {
  const fs = fakeFs();
  const sessionStore = createOpenCodeSessionStore({
    storagePath: "/tmp/rehydrate-sessions.json",
    fsImpl: fs,
  });
  const ownershipStore = fakeOwnershipStore();

  const provider1 = makeProvider({ sessionStore, ownershipStore });
  const started = await provider1.handleRequest({
    id: 1,
    method: "thread/start",
    params: { title: "Rehydrate me", cwd: "/tmp/rehydrate-project", model: "openai/gpt-5.5" },
  });
  const threadId = started.thread.id;

  await provider1.handleRequest({
    id: 2,
    method: "turn/start",
    params: { threadId, input: "hello" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await provider1.shutdown();

  const provider2 = makeProvider({ sessionStore, ownershipStore });
  const read = await provider2.handleRequest({
    id: 3,
    method: "thread/read",
    params: { threadId },
  });

  assert.equal(read.thread.id, threadId);
  assert.equal(read.thread.model, "openai/gpt-5.5");
  const entry = sessionStore.getEntry(threadId);
  assert.equal(entry.sessionId, "ses_new");
  assert.equal(entry.cwd, "/tmp/rehydrate-project");

  await provider2.shutdown();
});

test("thread/turns/list rehydrates before listing turns", async () => {
  const fs = fakeFs();
  const sessionStore = createOpenCodeSessionStore({
    storagePath: "/tmp/rehydrate-turns.json",
    fsImpl: fs,
  });
  const ownershipStore = fakeOwnershipStore();

  const provider1 = makeProvider({ sessionStore, ownershipStore });
  const started = await provider1.handleRequest({
    method: "thread/start",
    params: { cwd: "/tmp/proj" },
  });
  await provider1.handleRequest({
    method: "turn/start",
    params: { threadId: started.thread.id, input: "ping" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await provider1.shutdown();

  const provider2 = makeProvider({
    sessionStore,
    ownershipStore,
    clientFactory: () =>
      fakeClient({
        getMessagesImpl: async () => [
          {
            id: "msg-1",
            role: "user",
            content: [{ type: "text", text: "ping" }],
          },
        ],
      }),
  });

  const listed = await provider2.handleRequest({
    method: "thread/turns/list",
    params: { threadId: started.thread.id, limit: 10 },
  });

  assert.ok(Array.isArray(listed.data));
  assert.ok(listed.data.length >= 1);
  await provider2.shutdown();
});

test("expired SDK session removes store entry and returns opencode_session_expired", async () => {
  const fs = fakeFs();
  const sessionStore = createOpenCodeSessionStore({
    storagePath: "/tmp/rehydrate-expired.json",
    fsImpl: fs,
  });
  const ownershipStore = fakeOwnershipStore();

  sessionStore.set("opencode-thread-stale", "ses_gone", {
    cwd: "/tmp/proj",
    model: "openai/gpt-5.5",
    agent: "build",
  });
  ownershipStore.setOwnership("opencode-thread-stale", "opencode");

  const provider = makeProvider({
    sessionStore,
    ownershipStore,
    clientFactory: () =>
      fakeClient({
        getSessionImpl: async () => {
          const error = new Error("session not found");
          error.status = 404;
          throw error;
        },
      }),
  });

  await assert.rejects(
    () =>
      provider.handleRequest({
        method: "thread/read",
        params: { threadId: "opencode-thread-stale" },
      }),
    (error) => error.errorCode === "opencode_session_expired",
  );
  assert.equal(sessionStore.get("opencode-thread-stale"), null);
  await provider.shutdown();
});

test("transient getSession failure keeps store entry and propagates error", async () => {
  const fs = fakeFs();
  const sessionStore = createOpenCodeSessionStore({
    storagePath: "/tmp/rehydrate-transient.json",
    fsImpl: fs,
  });
  const ownershipStore = fakeOwnershipStore();

  sessionStore.set("opencode-thread-transient", "ses_ok", {
    cwd: "/tmp/proj",
    model: "openai/gpt-5.5",
    agent: "build",
  });
  ownershipStore.setOwnership("opencode-thread-transient", "opencode");

  const provider = makeProvider({
    sessionStore,
    ownershipStore,
    clientFactory: () =>
      fakeClient({
        getSessionImpl: async () => {
          throw new Error("OpenCode SDK request timed out after 90000ms");
        },
      }),
  });

  await assert.rejects(
    () =>
      provider.handleRequest({
        method: "thread/read",
        params: { threadId: "opencode-thread-transient" },
      }),
    (error) =>
      error.message.includes("timed out") && error.errorCode !== "opencode_session_expired",
  );
  assert.equal(sessionStore.get("opencode-thread-transient"), "ses_ok");
  await provider.shutdown();
});