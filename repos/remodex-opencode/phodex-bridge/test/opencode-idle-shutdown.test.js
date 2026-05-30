// FILE: opencode-idle-shutdown.test.js
// Purpose: Verifies OpenCode provider idle shutdown timer behavior.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/opencode-provider

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOpenCodeProvider } = require("../src/opencode-provider");

let originalSetTimeout;
let originalClearTimeout;
let timeoutCalls;
let clearTimeoutCalls;
let nextId;

function installFakeTimers() {
  originalSetTimeout = global.setTimeout;
  originalClearTimeout = global.clearTimeout;
  timeoutCalls = [];
  clearTimeoutCalls = [];
  nextId = 1;
  global.setTimeout = (fn, ms) => {
    const id = nextId++;
    timeoutCalls.push({ id, fn, ms });
    return id;
  };
  global.clearTimeout = (id) => {
    clearTimeoutCalls.push(id);
  };
}

function restoreTimers() {
  global.setTimeout = originalSetTimeout;
  global.clearTimeout = originalClearTimeout;
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
    listAgents: async () => [],
    createSession: async () => "ses_idle",
    getSession: async () => ({}),
    prompt: async () => Promise.resolve(),
    setModel: async () => {},
    setMode: async () => {},
    setEffort: async () => {},
    abort: async () => {},
    getMessages: async () => [],
    replyToPermission: async () => {},
    subscribeToEvents: () => () => {},
  };
}

const HEALTH_IDLE_SHUTDOWN_MS = 10 * 60 * 1000;

test("idle timer starts after server starts", async () => {
  installFakeTimers();
  try {
    const provider = createOpenCodeProvider({
      sendApplicationMessage: () => {},
      serverFactory: () => fakeServer(),
      clientFactory: () => fakeClient(),
      ownershipStore: fakeOwnershipStore(),
    });

    await provider.listModels();

    const idleTimeout = timeoutCalls.find(
      (t) => t.ms === HEALTH_IDLE_SHUTDOWN_MS,
    );
    assert.ok(idleTimeout, "idle shutdown timer should be set with 10 min duration");
  } finally {
    restoreTimers();
  }
});

test("idle timer resets on activity", async () => {
  installFakeTimers();
  try {
    const server = fakeServer();
    const provider = createOpenCodeProvider({
      sendApplicationMessage: () => {},
      serverFactory: () => server,
      clientFactory: () => fakeClient(),
      ownershipStore: fakeOwnershipStore(),
    });

    // First start sets the idle timer
    await provider.listModels();
    assert.ok(
      timeoutCalls.some((t) => t.ms === HEALTH_IDLE_SHUTDOWN_MS),
      "idle timer should be set initially",
    );

    // Reset captured state
    timeoutCalls.length = 0;
    clearTimeoutCalls.length = 0;

    // Shutdown and restart triggers startServer -> resetIdleTimer
    await provider.shutdown();
    await provider.listModels();

    assert.ok(
      clearTimeoutCalls.length >= 1,
      "clearTimeout should have been called on restart",
    );
    assert.ok(
      timeoutCalls.some((t) => t.ms === HEALTH_IDLE_SHUTDOWN_MS),
      "new idle timer should be set on restart",
    );
  } finally {
    restoreTimers();
  }
});

test("shutdown stops idle timer", async () => {
  installFakeTimers();
  try {
    const provider = createOpenCodeProvider({
      sendApplicationMessage: () => {},
      serverFactory: () => fakeServer(),
      clientFactory: () => fakeClient(),
      ownershipStore: fakeOwnershipStore(),
    });

    await provider.listModels();

    clearTimeoutCalls.length = 0;
    await provider.shutdown();

    assert.ok(clearTimeoutCalls.length >= 1, "shutdown should clear idle timer");
  } finally {
    restoreTimers();
  }
});

test("idle timer stops server when no active turns", async () => {
  installFakeTimers();
  try {
    let stopped = false;
    let _running = false;
    const server = {
      get baseUrl() {
        return _running ? "http://127.0.0.1:4291" : "";
      },
      get isRunning() {
        return _running;
      },
      start() {
        _running = true;
        return Promise.resolve();
      },
      stop() {
        _running = false;
        stopped = true;
        return Promise.resolve();
      },
    };

    const provider = createOpenCodeProvider({
      sendApplicationMessage: () => {},
      serverFactory: () => server,
      clientFactory: () => fakeClient(),
      ownershipStore: fakeOwnershipStore(),
    });

    await provider.listModels();

    const idleTimeout = timeoutCalls.find(
      (t) => t.ms === HEALTH_IDLE_SHUTDOWN_MS,
    );
    assert.ok(idleTimeout, "idle timer should be set");

    // Fire the timer callback
    await idleTimeout.fn();

    assert.ok(stopped, "server.stop should be called by idle timer");
  } finally {
    restoreTimers();
  }
});
