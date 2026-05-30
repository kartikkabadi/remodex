// FILE: acp-transport.test.js
// Purpose: Verifies ACP NDJSON transport: request/response matching, notification dispatch,
//          error handling, and connection lifecycle using a mock child process.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, child_process, crypto, ../src/acp-transport

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { randomUUID } = require("crypto");
const { createAcpTransport } = require("../src/acp-transport");

function createMockChild() {
  return {
    killed: false,
    pid: 10000,
    exitCode: null,
    signalCode: null,
    stdin: {
      writable: true,
      destroyed: false,
      write: (data) => true,
    },
    stdout: Object.assign(new EventEmitter(), {
      setEncoding() {},
    }),
    stderr: Object.assign(new EventEmitter(), {
      setEncoding() {},
    }),
    _handlers: {},
    on(event, handler) {
      this._handlers[event] = handler;
      return this;
    },
    emitEvent(event, ...args) {
      if (this._handlers[event]) {
        this._handlers[event](...args);
      }
    },
    kill(signal) {
      this.killed = true;
      this.exitCode = signal === "SIGTERM" ? 0 : 1;
      this.signalCode = signal;
      const exitHandler = this._handlers.exit;
      if (exitHandler) {
        setImmediate(() => exitHandler(this.exitCode, this.signalCode));
      }
    },
  };
}

function emitLine(mockChild, line) {
  mockChild.stdout.emit("data", `${line}\n`);
}

test("start spawns process and resolves on spawn event", async () => {
  let spawnArgs = null;
  const transport = createAcpTransport({
    spawnImpl: (command, args) => {
      spawnArgs = { command, args };
      const child = createMockChild();
      setImmediate(() => child.emitEvent("spawn"));
      return child;
    },
  });

  await transport.start();
  assert.equal(transport.isConnected(), true);
  assert.deepEqual(spawnArgs.args, ["acp", "--acp-next"]);
});

test("sendRequest receives matching response by id", async () => {
  const child = createMockChild();
  const transport = createAcpTransport({
    spawnImpl: () => {
      setImmediate(() => child.emitEvent("spawn"));
      return child;
    },
    randomUUIDImpl: () => "test-request-id",
  });

  await transport.start();

  const responsePromise = transport.sendRequest("session/new", { cwd: "/test" });
  emitLine(child, JSON.stringify({ id: "test-request-id", result: { sessionId: "ses_abc" } }));

  const response = await responsePromise;
  assert.deepEqual(response, { id: "test-request-id", result: { sessionId: "ses_abc" } });
});

test("sendRequest rejects on error response", async () => {
  const child = createMockChild();
  const transport = createAcpTransport({
    spawnImpl: () => {
      setImmediate(() => child.emitEvent("spawn"));
      return child;
    },
    randomUUIDImpl: () => "test-request-id",
  });

  await transport.start();

  const responsePromise = transport.sendRequest("session/new", { cwd: "/test" });
  emitLine(child, JSON.stringify({ id: "test-request-id", error: { message: "Session not found." } }));

  await assert.rejects(responsePromise, /Session not found/);
});

test("onNotification dispatches to matching method handlers", async () => {
  const child = createMockChild();
  const transport = createAcpTransport({
    spawnImpl: () => {
      setImmediate(() => child.emitEvent("spawn"));
      return child;
    },
  });

  await transport.start();

  const received = [];
  transport.onNotification("session/update", (params) => {
    received.push(params);
  });

  emitLine(child, JSON.stringify({ method: "session/update", params: { delta: "hello" } }));
  emitLine(child, JSON.stringify({ method: "session/update", params: { delta: "world" } }));

  // Microtask flush
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received.length, 2);
  assert.deepEqual(received[0], { delta: "hello" });
  assert.deepEqual(received[1], { delta: "world" });
});

test("onNotification unsubscription removes handler", async () => {
  const child = createMockChild();
  const transport = createAcpTransport({
    spawnImpl: () => {
      setImmediate(() => child.emitEvent("spawn"));
      return child;
    },
  });

  await transport.start();

  const received = [];
  const unsubscribe = transport.onNotification("session/update", (params) => {
    received.push(params);
  });

  emitLine(child, JSON.stringify({ method: "session/update", params: { n: 1 } }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received.length, 1);

  unsubscribe();
  emitLine(child, JSON.stringify({ method: "session/update", params: { n: 2 } }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received.length, 1);
});

test("onClose fires when child exits", async () => {
  const child = createMockChild();
  const transport = createAcpTransport({
    spawnImpl: () => {
      setImmediate(() => child.emitEvent("spawn"));
      return child;
    },
  });

  await transport.start();

  let closeEvent = null;
  transport.onClose((event) => {
    closeEvent = event;
  });

  child.emitEvent("exit", 0, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(closeEvent, { code: 0, signal: null, expected: false });
});

test("onError fires on unexpected exit when not stopping", async () => {
  const child = createMockChild();
  const transport = createAcpTransport({
    spawnImpl: () => {
      setImmediate(() => child.emitEvent("spawn"));
      return child;
    },
  });

  await transport.start();

  let errorEvent = null;
  transport.onError((error) => {
    errorEvent = error.message;
  });

  child.emitEvent("exit", 1, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(errorEvent, /exited unexpectedly/);
});

test("onError does not fire on expected stop", async () => {
  const child = createMockChild();
  const transport = createAcpTransport({
    spawnImpl: () => {
      setImmediate(() => child.emitEvent("spawn"));
      return child;
    },
  });

  await transport.start();

  let errorCalled = false;
  transport.onError(() => {
    errorCalled = true;
  });

  transport.stop();
  child.emitEvent("exit", null, "SIGTERM");

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errorCalled, false);
  assert.equal(transport.isConnected(), false);
});

test("pending requests are rejected on unexpected child exit", async () => {
  const child = createMockChild();
  const transport = createAcpTransport({
    spawnImpl: () => {
      setImmediate(() => child.emitEvent("spawn"));
      return child;
    },
    randomUUIDImpl: () => "req-exit-test",
  });

  await transport.start();

  const responsePromise = transport.sendRequest("test/method", {});
  // Exit BEFORE the response arrives — pending requests should all reject
  child.emitEvent("exit", 1, null);

  await assert.rejects(responsePromise, /transport closed/);
  assert.equal(transport.isConnected(), false);
});
