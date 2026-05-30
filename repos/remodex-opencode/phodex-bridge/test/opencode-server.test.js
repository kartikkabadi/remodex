// FILE: opencode-server.test.js
// Purpose: Verifies OpenCode serve lifecycle: spawn, health check, shutdown, failure recovery.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/opencode-server

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOpenCodeServer } = require("../src/opencode-server");

test("createOpenCodeServer returns expected API surface", () => {
  const server = createOpenCodeServer({});
  assert.ok(server, "server object exists");
  assert.equal(typeof server.start, "function");
  assert.equal(typeof server.stop, "function");
  assert.equal(typeof server.isRunning, "boolean");
  assert.equal(typeof server.baseUrl, "string");
  assert.equal(typeof server.version, "string");
});

test("server.baseUrl is empty before start", () => {
  const server = createOpenCodeServer({});
  assert.equal(server.baseUrl, "");
  assert.equal(server.isRunning, false);
});

test("server stop on unstarted server resolves cleanly", async () => {
  const server = createOpenCodeServer({});
  await server.stop();
  assert.equal(server.isRunning, false);
});

test("server resolves baseUrl from stdout listening message", async () => {
  const server = createOpenCodeServer({
    spawnImpl: () => fakeChildThatEmits("opencode server listening on http://127.0.0.1:4291\n"),
    httpGetImpl: () => Promise.resolve({ ok: true, version: "1.15.12" }),
  });

  await server.start();
  assert.ok(server.baseUrl.startsWith("http://127.0.0.1:4291"));
  assert.equal(server.isRunning, true);
});

test("server start rejects when spawn throws", async () => {
  const server = createOpenCodeServer({
    spawnImpl: () => { throw new Error("ENOENT"); },
  });

  await assert.rejects(
    () => server.start(),
    { message: /Failed to spawn/ }
  );
});

test("server start rejects on timeout when no listening message appears", async () => {
  const server = createOpenCodeServer({
    spawnImpl: () => fakeChildThatNeverEmits(),
    httpGetImpl: () => Promise.reject(new Error("unreachable")),
  });

  const startResult = server.start();
  await assert.rejects(
    () => startResult,
    { message: /did not start/ }
  );
});

test("server stop kills child process and cleans up state", async () => {
  let killed = false;
  const child = fakeChildThatEmits("opencode server listening on http://127.0.0.1:4291\n");
  const origKill = child.kill;
  child.kill = (signal) => {
    killed = true;
    process.nextTick(() => child._emit("close", 0));
    return origKill.call(child, signal);
  };

  const server = createOpenCodeServer({
    spawnImpl: () => child,
    httpGetImpl: () => Promise.resolve({ ok: true, version: "1.15.12" }),
  });

  await server.start();
  await server.stop();

  assert.equal(killed, true);
  assert.equal(server.isRunning, false);
});

test("server extracts version from health check", async () => {
  const server = createOpenCodeServer({
    spawnImpl: () => fakeChildThatEmits("opencode server listening on http://127.0.0.1:4291\n"),
    httpGetImpl: () => Promise.resolve({ ok: true, version: "2.0.0" }),
  });

  await server.start();
  assert.equal(server.version, "2.0.0");
});

test("server rejects when health check returns not-ok", async () => {
  const server = createOpenCodeServer({
    spawnImpl: () => fakeChildThatEmits("opencode server listening on http://127.0.0.1:4291\n"),
    httpGetImpl: () => Promise.resolve({ ok: false }),
  });

  await assert.rejects(
    () => server.start(),
    { message: /not-ok/ }
  );
});

test("server uses custom command from env", async () => {
  const server = createOpenCodeServer({
    env: { REMODEX_OPENCODE_COMMAND: "/usr/local/bin/opencode" },
    spawnImpl: (cmd, args) => {
      assert.equal(cmd, "/usr/local/bin/opencode");
      return fakeChildThatEmits("opencode server listening on http://127.0.0.1:4291\n");
    },
    httpGetImpl: () => Promise.resolve({ ok: true }),
  });

  await server.start();
  assert.ok(server.isRunning);
});

// ─── Fake helpers ───────────────────────────────────────────────

function fakeChildThatEmits(stdoutMsg) {
  const handlers = new Map();
  const child = {
    killed: false,
    pid: 99999,
    stdout: {
      setEncoding() {},
      on(event, handler) {
        if (event === "data") {
          process.nextTick(() => handler(String(stdoutMsg)));
        }
        return child.stdout;
      },
    },
    stderr: { setEncoding() {}, on() { return child.stderr; } },
    stdin: { on() {}, writable: true },
    kill() { child.killed = true; return true; },
    on(event, handler) { handlers.set(event, handler); return child; },
    _emit(event, ...args) { handlers.get(event)?.(...args); },
  };
  return child;
}

function fakeChildThatNeverEmits() {
  const child = {
    killed: false,
    pid: 99999,
    stdout: { setEncoding() {}, on() { return child.stdout; } },
    stderr: { setEncoding() {}, on() { return child.stderr; } },
    stdin: { on() {}, writable: true },
    kill() { child.killed = true; return true; },
    on() { return child; },
    _emit() {},
  };
  return child;
}
