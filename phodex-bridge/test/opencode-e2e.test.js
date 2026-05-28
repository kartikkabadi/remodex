// FILE: opencode-e2e.test.js
// Purpose: Canary end-to-end tests against a real `opencode serve` process.
// Layer: Integration test (opt-in)
// Depends on: node:test, node:assert/strict, ../src/opencode-transport
//
// Default `npm test` skips these tests. To run locally:
//   OPENCODE_E2E=1 node --test test/opencode-e2e.test.js
// Or run the full suite with E2E enabled:
//   OPENCODE_E2E=1 npm test
// Requires `opencode` on PATH, or set REMODEX_OPENCODE_COMMAND to the binary path.

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createOpenCodeTransport,
  ensureOpenCodeServer,
  openCodeFetch,
  parseSseChunk,
  parseJsonRpcLine,
  resolveOpenCodeCommand,
} = require("../src/opencode-transport");

const E2E_TIMEOUT_MS = 60_000;

function opencodeBinaryAvailable() {
  const command = resolveOpenCodeCommand(process.env);
  try {
    execFileSync(command, ["--version"], { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

const e2eEnabled = process.env.OPENCODE_E2E === "1" && opencodeBinaryAvailable();
const skipReason = process.env.OPENCODE_E2E !== "1"
  ? "set OPENCODE_E2E=1 to run"
  : "opencode binary not found on PATH (or REMODEX_OPENCODE_COMMAND)";

function freshServerState() {
  return {
    phase: "cold",
    baseUrl: null,
    username: null,
    password: null,
    pid: null,
    spawnAttempts: 0,
    lastReadyAt: null,
  };
}

test("opencode e2e canary skipped unless OPENCODE_E2E=1 and opencode on PATH", {
  skip: e2eEnabled ? "OPENCODE_E2E enabled" : false,
}, () => {
  assert.ok(!e2eEnabled);
});

test("ensureOpenCodeServer reaches real opencode serve, GET /doc, and SSE server.connected", {
  skip: e2eEnabled ? false : skipReason,
  timeout: E2E_TIMEOUT_MS,
}, async () => {
  const server = freshServerState();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "oc-e2e-serve-"));
  try {
    await ensureOpenCodeServer(server, { spawnTimeoutMs: 45_000 });
    assert.equal(server.phase, "ready");
    assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

    const doc = await openCodeFetch(server, "/doc", { method: "GET" });
    assert.equal(doc.__opencodeError, undefined);
    assert.equal(doc.info?.title, "opencode");

    const session = await openCodeFetch(server, "/session", {
      method: "POST",
      directory: workspace,
      body: { title: "e2e session" },
    });
    assert.equal(session.__opencodeError, undefined);
    assert.ok(readString(session?.id), "expected session id from POST /session");

    const sseRes = await fetch(`${server.baseUrl}/event`, {
      headers: {
        Authorization: basicAuth(server),
        Accept: "text/event-stream",
        "x-opencode-directory": workspace,
      },
    });
    assert.equal(sseRes.ok, true);
    const chunk = await readFirstSseChunk(sseRes);
    const parsed = parseSseChunk(chunk, { buffer: "", lastSequence: 0 });
    assert.ok(parsed.events.length > 0, `expected SSE bus events, saw: ${chunk.slice(0, 200)}`);
    assert.equal(parsed.events[0].type, "server.connected");
  } finally {
    stopServerChild(server);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("createOpenCodeTransport golden path against real opencode serve", {
  skip: e2eEnabled ? false : skipReason,
  timeout: E2E_TIMEOUT_MS,
}, async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "oc-e2e-workspace-"));
  const bindingsPath = path.join(workspace, "opencode-bindings.json");
  const started = createStartedWaiter(45_000);
  const transport = createOpenCodeTransport({
    bindingsPath,
    directory: workspace,
    spawnTimeoutMs: 45_000,
  });
  transport.onStarted(started.resolve);
  transport.onError(started.reject);

  const outbound = [];
  transport.onMessage((line) => outbound.push(line));

  try {
    const info = await started.promise;
    assert.equal(info.mode, "opencode");
    assert.match(info.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

    transport.send(JSON.stringify({
      id: "e2e-init",
      method: "initialize",
      params: {},
    }));
    const initLine = await waitForRpcResponse(outbound, "e2e-init", 10_000);
    const initResponse = parseJsonRpcLine(initLine);
    assert.equal(initResponse.error, undefined);
    assert.equal(initResponse.result.serverInfo.name, "opencode");

    transport.send(JSON.stringify({
      id: "e2e-thread",
      method: "thread/start",
      params: { cwd: workspace, title: "e2e canary" },
    }));

    const threadLine = await waitForRpcResponse(outbound, "e2e-thread", 15_000);
    const threadResponse = parseJsonRpcLine(threadLine);
    assert.equal(threadResponse.error, undefined);
    assert.match(threadResponse.result.thread.id, /^oc-thread-/);
    assert.equal(threadResponse.result.thread.title, "e2e canary");

    const threadStarted = outbound.some((line) => parseJsonRpcLine(line)?.method === "thread/started");
    assert.ok(threadStarted, "expected thread/started notification");
  } finally {
    transport.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

function createStartedWaiter(timeoutMs) {
  let resolveStarted;
  let rejectStarted;
  const promise = new Promise((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const timer = setTimeout(() => rejectStarted(new Error("onStarted timed out")), timeoutMs);
  promise.finally(() => clearTimeout(timer));
  return {
    promise,
    resolve(info) {
      resolveStarted(info);
    },
    reject(error) {
      rejectStarted(error);
    },
  };
}

function isJsonRpcResponse(parsed) {
  return parsed
    && parsed.id != null
    && !parsed.method
    && (parsed.result !== undefined || parsed.error !== undefined);
}

async function waitForRpcResponse(outbound, id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = outbound.find((line) => {
      const parsed = parseJsonRpcLine(line);
      return parsed?.id === id && isJsonRpcResponse(parsed);
    });
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for JSON-RPC response id=${id}`);
}

async function readFirstSseChunk(response, timeoutMs = 5_000) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    text += decoder.decode(value, { stream: true });
    if (text.includes("\n\n")) {
      break;
    }
  }
  reader.cancel?.().catch(() => {});
  return text;
}

function basicAuth(server) {
  return `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`;
}

function stopServerChild(server) {
  const child = server.child;
  if (!child || child.killed) {
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode == null && !child.killed) {
      child.kill("SIGKILL");
    }
  }, 2_000).unref?.();
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value : "";
}
