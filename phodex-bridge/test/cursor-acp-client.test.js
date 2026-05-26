// FILE: cursor-acp-client.test.js
// Purpose: Verifies Cursor ACP discovery and newline JSON-RPC stdio behavior.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, events, ../src/cursor-acp-client

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const {
  LOCAL_CURSOR_AGENT_PATH,
  createCursorAcpClient,
  discoverCursorAcpCommand,
} = require("../src/cursor-acp-client");

test("Cursor discovery finds local agent path before PATH candidates", async () => {
  const calls = [];
  const discovery = await discoverCursorAcpCommand({
    fsImpl: { existsSync: (filePath) => filePath === LOCAL_CURSOR_AGENT_PATH },
    execFileImpl(command, args, _options, callback) {
      calls.push({ command, args });
      callback(null, args.includes("--version") ? "2026.05.20-test\n" : "Usage: agent acp\n", "");
    },
  });

  assert.equal(discovery.status, "ready");
  assert.equal(discovery.command, LOCAL_CURSOR_AGENT_PATH);
  assert.deepEqual(discovery.args, ["acp"]);
  assert.equal(discovery.version, "2026.05.20-test");
  assert.equal(calls[0].command, LOCAL_CURSOR_AGENT_PATH);
});

test("Cursor discovery does not report not_installed just because PATH misses", async () => {
  const discovery = await discoverCursorAcpCommand({
    fsImpl: { existsSync: () => false },
    execFileImpl(command, _args, _options, callback) {
      if (command === "agent") {
        callback(null, "Usage: agent acp\n", "");
        return;
      }
      const error = new Error("ENOENT");
      error.code = "ENOENT";
      callback(error);
    },
  });

  assert.equal(discovery.status, "ready");
  assert.equal(discovery.command, "agent");
});

test("Cursor discovery maps all missing candidates to not_installed", async () => {
  const discovery = await discoverCursorAcpCommand({
    fsImpl: { existsSync: () => false },
    execFileImpl(_command, _args, _options, callback) {
      const error = new Error("ENOENT");
      error.code = "ENOENT";
      callback(error);
    },
  });

  assert.equal(discovery.status, "not_installed");
  assert.match(discovery.statusMessage, /Install Cursor Agent/);
});

test("Cursor ACP client writes newline JSON-RPC and resolves responses", async () => {
  let child;
  const client = createCursorAcpClient({
    command: "agent",
    args: ["acp"],
    spawnImpl() {
      child = createFakeChild();
      return child;
    },
  });

  const pending = client.request("session/new", { cwd: "/repo" });
  const sent = JSON.parse(child.stdin.writes[0].trim());
  assert.equal(sent.method, "session/new");
  assert.deepEqual(sent.params, { cwd: "/repo" });

  child.stdout.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: sent.id, result: { sessionId: "cur-1" } })}\n`);
  assert.deepEqual(await pending, { sessionId: "cur-1" });
});

test("Cursor ACP client forwards server requests without auto-response when handler returns undefined", async () => {
  let child;
  const requests = [];
  const client = createCursorAcpClient({
    command: "agent",
    args: ["acp"],
    onRequest(frame) {
      requests.push(frame);
      return undefined;
    },
    spawnImpl() {
      child = createFakeChild();
      return child;
    },
  });

  client.start();
  child.stdout.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "permission/request", params: { id: "perm-1" } })}\n`);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "permission/request");
  assert.equal(child.stdin.writes.length, 0);
});

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.stdin = {
    writable: true,
    writes: [],
    write(value) {
      this.writes.push(value);
    },
  };
  child.kill = () => {};
  return child;
}
