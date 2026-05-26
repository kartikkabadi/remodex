// FILE: opencode-transport.test.js
// Purpose: Unit tests for OpenCode transport lifecycle, SSE/bus mapping, and JSON-RPC handlers.
// Layer: Unit test
// Depends on: node:test, node:assert/strict, ../src/opencode-transport

const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  parseListenStdout,
  spawnOpenCodeServer,
  ensureOpenCodeServer,
  openCodeFetch,
  shutdownOpenCodeServer,
  parseSseChunk,
  scheduleSseReconnect,
  mapBusEventToCodexLines,
  connectOpenCodeEventStream,
  makeNotification,
  createOpenCodeTransport,
  loadBindings,
  saveBindings,
  markInFlightTurnsFailedOnBoot,
  tryAcquireCwdLock,
  releaseCwdLock,
  routeInboundJsonRpc,
  parseJsonRpcLine,
  resolveCwdFromThreadStartParams,
  handleUnsupportedMethod,
  handleInboundClientResponse,
  handleCollaborationModeListRequest,
  scheduleOpenCodeSseReconnect,
  catchUpAfterSseReconnect,
  rebuildBindingIndexes,
  flushPersistBindings,
  persistBindings,
  expireStaleCwdLocks,
  emitTurnFailed,
  coerceMessageString,
  makeJsonRpcError,
  mapProvidersConfigToModelList,
} = require("../src/opencode-transport");

const {
  BUS_EVENT_ID_CACHE_LIMIT,
  CWD_LOCK_TTL_MS,
  BINDINGS_PERSIST_DEBOUNCE_MS,
  lookupOpenCodeTransportRefusal,
} = require("../src/opencode-runtime-policy");

function createFakeChild() {
  const handlers = new Map();
  const stdoutHandlers = new Map();
  return {
    killed: false,
    exitCode: null,
    pid: 4242,
    stdout: {
      on(eventName, handler) { stdoutHandlers.set(eventName, handler); },
      off(eventName, handler) {
        if (stdoutHandlers.get(eventName) === handler) {
          stdoutHandlers.delete(eventName);
        }
      },
    },
    stderr: { on() {} },
    stdin: { on() {}, write() {} },
    on(eventName, handler) { handlers.set(eventName, handler); },
    off(eventName, handler) {
      if (handlers.get(eventName) === handler) {
        handlers.delete(eventName);
      }
    },
    kill() { this.killed = true; },
    emit(eventName, ...args) { handlers.get(eventName)?.(...args); },
    emitStdout(eventName, ...args) { stdoutHandlers.get(eventName)?.(...args); },
  };
}

function freshServer() {
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

test("parseListenStdout strips trailing carriage returns from CRLF stdout", () => {
  const result = parseListenStdout("opencode server listening on http://127.0.0.1:4096\r\n");
  assert.deepEqual(result, {
    ready: { baseUrl: "http://127.0.0.1:4096" },
    rest: "",
  });
});

test("openCodeFetch returns not_ready when baseUrl is missing", async () => {
  const result = await openCodeFetch({ baseUrl: null, username: "opencode", password: "pw" }, "/doc");
  assert.deepEqual(result, {
    __opencodeError: true,
    code: "not_ready",
    message: "OpenCode server baseUrl is not set",
    status: 0,
  });
});

test("ensureOpenCodeServer reuses a healthy ready server", async () => {
  const server = {
    ...freshServer(),
    phase: "ready",
    baseUrl: "http://127.0.0.1:4096",
    username: "opencode",
    password: "pw",
  };
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200, text: async () => "{}" };
  };

  const result = await ensureOpenCodeServer(server, { fetchImpl });
  assert.equal(result, server);
  assert.equal(fetchCalls, 1);
});

test("ensureOpenCodeServer respawns when health check fails and confirms /doc", async () => {
  const server = {
    ...freshServer(),
    phase: "ready",
    baseUrl: "http://127.0.0.1:4096",
    username: "opencode",
    password: "pw",
  };
  let spawnedChild = null;
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      return {
        ok: false,
        status: 503,
        statusText: "Unavailable",
        text: async () => JSON.stringify({ message: "down" }),
      };
    }
    return { ok: true, status: 200, text: async () => "{}" };
  };

  const pending = ensureOpenCodeServer(server, {
    fetchImpl,
    spawnImpl: () => {
      spawnedChild = createFakeChild();
      queueMicrotask(() => {
        spawnedChild.emitStdout(
          "data",
          Buffer.from("opencode server listening on http://127.0.0.1:9002\n")
        );
      });
      return spawnedChild;
    },
    spawnTimeoutMs: 500,
    now: () => 1000,
  });

  await pending;
  assert.equal(server.baseUrl, "http://127.0.0.1:9002");
  assert.equal(server.spawnAttempts, 0);
  assert.equal(fetchCalls, 2);
});

test("ensureOpenCodeServer rejects respawn after shutdown", async () => {
  const server = { ...freshServer(), phase: "stopped" };
  await assert.rejects(
    ensureOpenCodeServer(server, { fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" }) }),
    /cannot restart after shutdown/
  );
});

test("scheduleSseReconnect uses exponential backoff capped at 8s", () => {
  const sse = { reconnectAttempt: 0 };
  assert.equal(scheduleSseReconnect(sse), 1000);
  assert.equal(scheduleSseReconnect(sse), 2000);
  assert.equal(scheduleSseReconnect(sse), 4000);
  assert.equal(scheduleSseReconnect(sse), 8000);
  assert.equal(scheduleSseReconnect(sse), 8000);
});

test("parseSseChunk yields one bus event from a complete SSE frame", () => {
  const frame = [
    "event: message",
    "id: evt-1",
    'data: {"payload":{"id":"bus-1","type":"session.status","properties":{"sessionID":"sess-1","status":"busy"}}}',
    "",
    "",
  ].join("\n");
  const result = parseSseChunk(frame, { buffer: "", lastSequence: 0 });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].type, "session.status");
  assert.equal(result.events[0].sequence, 1);
  assert.equal(result.events[0].id, "bus-1");
  assert.equal(result.cursor.lastEventId, "evt-1");
});

test("parseSseChunk accepts flat bus envelopes from live opencode serve", () => {
  const frame = [
    "id: evt-live",
    'data: {"id":"evt-live","type":"server.connected","properties":{}}',
    "",
    "",
  ].join("\n");
  const result = parseSseChunk(frame, { buffer: "", lastSequence: 0 });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].type, "server.connected");
  assert.equal(result.events[0].id, "evt-live");
  assert.equal(result.events[0].sequence, 1);
  assert.equal(result.cursor.lastEventId, "evt-live");
});

test("parseSseChunk keeps partial frames in the cursor buffer", () => {
  const partial = 'event: message\ndata: {"payload":{"id":"bus-2","type":"server.connected","properties":{';
  const first = parseSseChunk(partial, { buffer: "", lastSequence: 3 });
  assert.equal(first.events.length, 0);
  assert.match(first.cursor.buffer, /"properties":\{$/);

  const second = parseSseChunk("}}}\n\n", first.cursor);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].type, "server.connected");
  assert.equal(second.events[0].sequence, 4);
});

test("mapBusEventToCodexLines maps session.status busy to turn/started once", () => {
  const state = {
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      activeRemodexTurnId: "turn-1",
      turnPhase: "running",
    }]]),
    pendingApprovalsById: new Map(),
    sse: { buffer: "", lastSequence: 0, reconnectAttempt: 0, stop: null, seenBusEventIds: new Set() },
  };

  const first = mapBusEventToCodexLines(state, {
    type: "session.status",
    properties: { sessionID: "sess-1", status: { type: "busy" } },
    sequence: 1,
    id: "evt-busy-1",
  });
  const second = mapBusEventToCodexLines(state, {
    type: "session.status",
    properties: { sessionID: "sess-1", status: { type: "busy" } },
    sequence: 2,
    id: "evt-busy-2",
  });

  assert.equal(first.length, 2);
  assert.equal(JSON.parse(first[0]).method, "thread/status/changed");
  assert.equal(JSON.parse(first[0]).params.status, "running");
  assert.equal(JSON.parse(first[1]).method, "turn/started");
  assert.equal(second.length, 1);
  assert.equal(JSON.parse(second[0]).method, "thread/status/changed");
  assert.equal(JSON.parse(second[0]).params.status, "running");
});

test("mapBusEventToCodexLines maps session.status idle object to turn/completed", () => {
  const binding = {
    remodexThreadId: "thread-1",
    opencodeSessionId: "sess-1",
    activeRemodexTurnId: "turn-1",
    turnPhase: "running",
  };
  const state = {
    bindingsByThreadId: new Map([["thread-1", binding]]),
    pendingApprovalsById: new Map(),
    sse: { buffer: "", lastSequence: 0, reconnectAttempt: 0, stop: null, seenBusEventIds: new Set() },
  };

  mapBusEventToCodexLines(state, {
    type: "session.status",
    properties: { sessionID: "sess-1", status: { type: "busy" } },
    sequence: 1,
    id: "evt-busy",
  });

  const lines = mapBusEventToCodexLines(state, {
    type: "session.status",
    properties: { sessionID: "sess-1", status: { type: "idle" } },
    sequence: 2,
    id: "evt-idle",
  });

  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).method, "thread/status/changed");
  assert.equal(JSON.parse(lines[0]).params.status, "idle");
  const parsed = JSON.parse(lines[1]);
  assert.equal(parsed.method, "turn/completed");
  assert.equal(parsed.params.status, "completed");
  assert.equal(binding.activeRemodexTurnId, null);
  assert.equal(binding.turnPhase, "idle");
});

test("mapBusEventToCodexLines emits turn/started again after idle resets reducer", () => {
  const binding = {
    remodexThreadId: "thread-1",
    opencodeSessionId: "sess-1",
    activeRemodexTurnId: "turn-1",
    turnPhase: "running",
  };
  const state = {
    bindingsByThreadId: new Map([["thread-1", binding]]),
    pendingApprovalsById: new Map(),
    sse: { buffer: "", lastSequence: 0, reconnectAttempt: 0, stop: null, seenBusEventIds: new Set() },
  };

  mapBusEventToCodexLines(state, {
    type: "session.status",
    properties: { sessionID: "sess-1", status: { type: "busy" } },
    sequence: 1,
    id: "evt-busy-1",
  });
  mapBusEventToCodexLines(state, {
    type: "session.status",
    properties: { sessionID: "sess-1", status: { type: "idle" } },
    sequence: 2,
    id: "evt-idle-1",
  });

  binding.activeRemodexTurnId = "turn-2";
  binding.turnPhase = "running";

  const secondStart = mapBusEventToCodexLines(state, {
    type: "session.status",
    properties: { sessionID: "sess-1", status: { type: "busy" } },
    sequence: 3,
    id: "evt-busy-2",
  });

  assert.equal(secondStart.length, 2);
  assert.equal(JSON.parse(secondStart[0]).method, "thread/status/changed");
  assert.equal(JSON.parse(secondStart[0]).params.status, "running");
  assert.equal(JSON.parse(secondStart[1]).params.turnId, "turn-2");
});

test("mapBusEventToCodexLines maps session.status retry to thread/status/changed retrying", () => {
  const state = {
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      activeRemodexTurnId: "turn-1",
      turnPhase: "running",
    }]]),
    pendingApprovalsById: new Map(),
    sse: { buffer: "", lastSequence: 0, reconnectAttempt: 0, stop: null, seenBusEventIds: new Set() },
  };

  const lines = mapBusEventToCodexLines(state, {
    type: "session.status",
    properties: { sessionID: "sess-1", status: { type: "retry" } },
    sequence: 1,
    id: "evt-retry",
  });

  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).method, "thread/status/changed");
  assert.equal(JSON.parse(lines[0]).params.status, "retrying");
});

test("mapBusEventToCodexLines maps session.error structured message to turn/completed failed", () => {
  const binding = {
    remodexThreadId: "thread-1",
    opencodeSessionId: "sess-1",
    activeRemodexTurnId: "turn-1",
    turnPhase: "running",
  };
  const state = {
    bindingsByThreadId: new Map([["thread-1", binding]]),
    pendingApprovalsById: new Map(),
    sse: { buffer: "", lastSequence: 0, reconnectAttempt: 0, stop: null, seenBusEventIds: new Set() },
  };

  const lines = mapBusEventToCodexLines(state, {
    type: "session.error",
    properties: {
      sessionID: "sess-1",
      error: { message: "provider timeout" },
    },
    sequence: 1,
    id: "evt-error",
  });

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.method, "turn/completed");
  assert.equal(parsed.params.status, "failed");
  assert.equal(parsed.params.error.message, "provider timeout");
});

test("mapBusEventToCodexLines does not push null after duplicate terminal events", () => {
  const binding = {
    remodexThreadId: "thread-1",
    opencodeSessionId: "sess-1",
    activeRemodexTurnId: "turn-1",
    turnPhase: "running",
  };
  const state = {
    bindingsByThreadId: new Map([["thread-1", binding]]),
    pendingApprovalsById: new Map(),
    turnReducerByThreadId: new Map([["thread-1", {
      startedEmitted: true,
      terminalEmitted: true,
      itemIdByPartId: new Map(),
      partKindByPartId: new Map(),
    }]]),
    sse: { buffer: "", lastSequence: 0, reconnectAttempt: 0, stop: null, seenBusEventIds: new Set() },
  };

  const lines = mapBusEventToCodexLines(state, {
    type: "session.status",
    properties: { sessionID: "sess-1", status: { type: "idle" } },
    sequence: 1,
    id: "evt-idle-dup",
  });

  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).method, "thread/status/changed");
  assert.equal(JSON.parse(lines[0]).params.status, "idle");
});

test("mapBusEventToCodexLines routes reasoning delta after message.part.updated", () => {
  const state = {
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      activeRemodexTurnId: "turn-1",
      turnPhase: "running",
    }]]),
    pendingApprovalsById: new Map(),
    sse: { buffer: "", lastSequence: 0, reconnectAttempt: 0, stop: null, seenBusEventIds: new Set() },
  };

  mapBusEventToCodexLines(state, {
    type: "message.part.updated",
    properties: {
      sessionID: "sess-1",
      part: { id: "part-r", type: "reasoning" },
    },
    sequence: 1,
    id: "evt-part-updated",
  });

  const lines = mapBusEventToCodexLines(state, {
    type: "message.part.delta",
    properties: {
      sessionID: "sess-1",
      partID: "part-r",
      delta: "thinking",
    },
    sequence: 2,
    id: "evt-reasoning-delta",
  });

  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).method, "item/reasoning/textDelta");
});

test("mapBusEventToCodexLines maps permission.asked to command approval method", () => {
  const binding = {
    remodexThreadId: "thread-1",
    opencodeSessionId: "sess-1",
    activeRemodexTurnId: "turn-1",
    turnPhase: "running",
  };
  const state = {
    bindingsByThreadId: new Map([["thread-1", binding]]),
    pendingApprovalsById: new Map(),
    sse: { buffer: "", lastSequence: 0, reconnectAttempt: 0, stop: null, seenBusEventIds: new Set() },
  };

  const lines = mapBusEventToCodexLines(state, {
    type: "permission.asked",
    properties: {
      sessionID: "sess-1",
      id: "perm-1",
      permission: "bash",
    },
    sequence: 1,
    id: "evt-perm",
  });

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.method, "item/commandExecution/requestApproval");
  assert.ok(state.pendingApprovalsById.has("perm-1"));
});

test("mapBusEventToCodexLines maps tool part completed to item/completed", () => {
  const state = {
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      activeRemodexTurnId: "turn-1",
      turnPhase: "running",
    }]]),
    pendingApprovalsById: new Map(),
    sse: { buffer: "", lastSequence: 0, reconnectAttempt: 0, stop: null, seenBusEventIds: new Set() },
  };

  const lines = mapBusEventToCodexLines(state, {
    type: "message.part.updated",
    properties: {
      sessionID: "sess-1",
      part: { id: "part-tool", type: "tool", tool: "grep", state: { status: "completed" } },
    },
    sequence: 1,
    id: "evt-tool-done",
  });

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.method, "item/completed");
  assert.equal(parsed.params.item.status, "completed");
});

test("connectOpenCodeEventStream forwards parsed bus events and sets directory header", async () => {
  const frame = [
    "event: message",
    'data: {"payload":{"id":"bus-live","type":"server.connected","properties":{}}}',
    "",
    "",
  ].join("\n");

  let capturedHeaders = null;
  const fetchImpl = async (_url, init) => {
    capturedHeaders = init.headers;
    const encoder = new TextEncoder();
    let pushed = false;
    return {
      ok: true,
      body: {
        getReader() {
          return {
            async read() {
              if (pushed) {
                return { done: true, value: undefined };
              }
              pushed = true;
              return { done: false, value: encoder.encode(frame) };
            },
            cancel() {},
          };
        },
      },
    };
  };

  const transport = {
    server: {
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "secret",
    },
    bindingsByThreadId: new Map(),
    pendingApprovalsById: new Map(),
  };
  const events = [];

  const stop = connectOpenCodeEventStream(
    transport,
    {
      onBusEvent: (event) => events.push(event),
      onStreamLost: () => {},
    },
    { fetchImpl, directory: "/tmp/workspace" }
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  stop();

  assert.equal(capturedHeaders["x-opencode-directory"], "/tmp/workspace");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "server.connected");
});

test("connectOpenCodeEventStream calls onStreamLost when fetch fails", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 503,
    body: null,
  });

  const transport = {
    server: {
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "secret",
    },
    bindingsByThreadId: new Map(),
    pendingApprovalsById: new Map(),
  };
  let lostReason = null;

  connectOpenCodeEventStream(
    transport,
    {
      onBusEvent: () => {},
      onStreamLost: (error) => { lostReason = error; },
    },
    { fetchImpl }
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(String(lostReason?.message || lostReason), /SSE connect failed/);
});

test("mapBusEventToCodexLines still accepts legacy string session.status busy", () => {
  const state = {
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      activeRemodexTurnId: "turn-1",
      turnPhase: "running",
    }]]),
    pendingApprovalsById: new Map(),
    sse: { buffer: "", lastSequence: 0, reconnectAttempt: 0, stop: null, seenBusEventIds: new Set() },
  };

  const lines = mapBusEventToCodexLines(state, {
    type: "session.status",
    properties: { sessionID: "sess-1", status: "busy" },
    sequence: 1,
    id: "evt-legacy-busy",
  });

  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).method, "thread/status/changed");
  assert.equal(JSON.parse(lines[0]).params.status, "running");
  assert.equal(JSON.parse(lines[1]).method, "turn/started");
});

test("mapBusEventToCodexLines maps message.part.delta to agentMessage delta", () => {
  const state = {
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      activeRemodexTurnId: "turn-1",
      turnPhase: "running",
    }]]),
    pendingApprovalsById: new Map(),
    sse: { buffer: "", lastSequence: 0, reconnectAttempt: 0, stop: null, seenBusEventIds: new Set() },
  };

  const lines = mapBusEventToCodexLines(state, {
    type: "message.part.delta",
    properties: {
      sessionID: "sess-1",
      partID: "part-1",
      delta: "hello",
    },
    sequence: 1,
    id: "evt-delta-1",
  });

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.method, "item/agentMessage/delta");
  assert.equal(parsed.params.delta, "hello");
  assert.equal(parsed.params.turnId, "turn-1");
});

test("mapBusEventToCodexLines drops replayed bus events by id", () => {
  const state = {
    bindingsByThreadId: new Map(),
    pendingApprovalsById: new Map(),
    sse: {
      buffer: "",
      lastSequence: 0,
      reconnectAttempt: 0,
      stop: null,
      seenBusEventIds: new Set(["evt-replay"]),
      lastAppliedSequence: 0,
    },
  };

  const lines = mapBusEventToCodexLines(state, {
    type: "server.connected",
    properties: {},
    sequence: 99,
    id: "evt-replay",
  });

  assert.deepEqual(lines, []);
});

test("makeNotification emits newline-terminated Codex-shaped notifications", () => {
  const line = makeNotification("turn/started", { threadId: "thread-1", turnId: "turn-1" });
  assert.equal(line, `${JSON.stringify({ method: "turn/started", params: { threadId: "thread-1", turnId: "turn-1" } })}\n`);
});

test("parseListenStdout extracts baseUrl from a single-chunk listening line", () => {
  const result = parseListenStdout("opencode server listening on http://127.0.0.1:4096\n");
  assert.deepEqual(result, {
    ready: { baseUrl: "http://127.0.0.1:4096" },
    rest: "",
  });
});

test("parseListenStdout handles split chunks and trailing bytes", () => {
  const first = parseListenStdout("opencode server listen");
  assert.equal(first.ready, null);
  assert.equal(first.rest, "opencode server listen");

  const second = parseListenStdout(`${first.rest}ing on http://127.0.0.1:7777\nextra`);
  assert.deepEqual(second, {
    ready: { baseUrl: "http://127.0.0.1:7777" },
    rest: "extra",
  });
});

test("spawnOpenCodeServer resolves with baseUrl when stdout emits the listening line", async () => {
  const server = freshServer();
  const child = createFakeChild();
  const spawnImpl = () => child;

  const pending = spawnOpenCodeServer(server, { spawnImpl });
  child.emitStdout("data", Buffer.from("opencode server listening on http://127.0.0.1:9001\n"));

  const result = await pending;
  assert.equal(result.baseUrl, "http://127.0.0.1:9001");
  assert.equal(result.child, child);
  assert.equal(server.phase, "ready");
  assert.equal(server.username, "opencode");
  assert.ok(server.password);
});

test("spawnOpenCodeServer rejects when the child exits before listening", async () => {
  const server = freshServer();
  const child = createFakeChild();
  const pending = spawnOpenCodeServer(server, { spawnImpl: () => child });

  child.emit("exit", 1, null);
  await assert.rejects(pending, /exited before ready/);
});

test("spawnOpenCodeServer rejects with a timeout when no listening line arrives", async () => {
  const server = freshServer();
  const child = createFakeChild();
  const pending = spawnOpenCodeServer(server, {
    spawnImpl: () => child,
    spawnTimeoutMs: 20,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });

  await assert.rejects(pending, /timed out after 20ms/);
  assert.equal(child.killed, true);
});

test("openCodeFetch sends Basic auth and x-opencode-directory headers", async () => {
  const server = {
    baseUrl: "http://127.0.0.1:4096",
    username: "opencode",
    password: "secret-pass",
  };
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    };
  };

  const body = await openCodeFetch(server, "/session", {
    method: "POST",
    directory: "/tmp/workspace",
    body: { hello: "world" },
    fetchImpl,
  });

  assert.deepEqual(body, { ok: true });
  assert.equal(captured.url, "http://127.0.0.1:4096/session");
  assert.equal(
    captured.init.headers.Authorization,
    `Basic ${Buffer.from("opencode:secret-pass").toString("base64")}`
  );
  assert.equal(captured.init.headers["x-opencode-directory"], "/tmp/workspace");
  assert.equal(captured.init.headers["Content-Type"], "application/json");
});

test("openCodeFetch returns { __opencodeError, code, message, status } on non-2xx", async () => {
  const server = { baseUrl: "http://127.0.0.1:1", username: "opencode", password: "pw" };
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    text: async () => JSON.stringify({ code: "unauthorized", message: "bad credentials" }),
  });

  const result = await openCodeFetch(server, "/doc", { fetchImpl });
  assert.deepEqual(result, {
    __opencodeError: true,
    code: "unauthorized",
    message: "bad credentials",
    status: 401,
  });
});

test("shutdownOpenCodeServer is idempotent and persists bindings on shutdown", () => {
  const bindingsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oc-bindings-")), "bindings.json");
  const child = createFakeChild();
  const transport = {
    server: {
      phase: "ready",
      child,
      pid: child.pid,
    },
    sse: { stop: () => { transport.sse.stopped = true; }, stopped: false },
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      cwd: "/tmp/workspace",
      model: null,
      activeRemodexTurnId: null,
      turnPhase: "idle",
      updatedAt: Date.now(),
    }]]),
    options: { bindingsPath },
  };

  shutdownOpenCodeServer(transport);
  assert.equal(transport.server.phase, "stopped");
  assert.equal(transport.server.child, null);
  assert.equal(child.killed, true);
  assert.equal(transport.sse.stopped, true);
  assert.ok(fs.existsSync(bindingsPath));

  shutdownOpenCodeServer(transport);
  assert.equal(transport.server.phase, "stopped");
});

test("loadBindings returns empty map for missing file", () => {
  const bindingsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oc-load-")), "missing.json");
  const bindings = loadBindings(bindingsPath);
  assert.equal(bindings.size, 0);
});

test("saveBindings writes schemaVersioned file with mode 0600", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-save-"));
  const bindingsPath = path.join(dir, "opencode-bindings.json");
  const bindings = new Map([["thread-1", {
    remodexThreadId: "thread-1",
    opencodeSessionId: "sess-1",
    cwd: "/tmp/workspace",
    model: { provider: "opencode", model: "opencode/gpt-5.5" },
    activeRemodexTurnId: "turn-1",
    turnPhase: "running",
    updatedAt: 123,
  }]]);

  saveBindings(bindingsPath, bindings);
  const stat = fs.statSync(bindingsPath);
  assert.equal(stat.mode & 0o777, 0o600);
  const parsed = JSON.parse(fs.readFileSync(bindingsPath, "utf8"));
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.bindings.length, 1);
  assert.equal(parsed.bindings[0].remodexThreadId, "thread-1");
});

test("markInFlightTurnsFailedOnBoot marks running bindings failed", () => {
  const bindings = new Map([["thread-1", {
    remodexThreadId: "thread-1",
    opencodeSessionId: "sess-1",
    cwd: "/tmp/workspace",
    model: null,
    activeRemodexTurnId: "turn-1",
    turnPhase: "running",
    updatedAt: 1,
  }], ["thread-2", {
    remodexThreadId: "thread-2",
    opencodeSessionId: "sess-2",
    cwd: "/tmp/other",
    model: null,
    activeRemodexTurnId: null,
    turnPhase: "idle",
    updatedAt: 1,
  }]]);

  markInFlightTurnsFailedOnBoot(bindings);
  assert.equal(bindings.get("thread-1").turnPhase, "failed");
  assert.equal(bindings.get("thread-1").activeRemodexTurnId, null);
  assert.equal(bindings.get("thread-1").lastFailedTurnId, "turn-1");
  assert.equal(bindings.get("thread-2").turnPhase, "idle");
});

test("tryAcquireCwdLock rejects a second owner and release is idempotent", () => {
  const state = { locksByCwd: new Map() };
  const first = tryAcquireCwdLock(state, "/tmp/workspace", "thread-1", "turn-1");
  const second = tryAcquireCwdLock(state, "/tmp/workspace", "thread-2", "turn-2");

  assert.deepEqual(first, { ok: true });
  assert.deepEqual(second, {
    ok: false,
    holderThreadId: "thread-1",
    holderTurnId: "turn-1",
  });

  releaseCwdLock(state, "/tmp/workspace", "turn-1");
  releaseCwdLock(state, "/tmp/workspace", "turn-1");
  assert.equal(state.locksByCwd.size, 0);
});

test("parseJsonRpcLine returns null for blank or malformed lines", () => {
  assert.equal(parseJsonRpcLine(""), null);
  assert.equal(parseJsonRpcLine("   "), null);
  assert.equal(parseJsonRpcLine("{not-json"), null);
  assert.deepEqual(parseJsonRpcLine('{"id":1,"method":"initialize"}'), { id: 1, method: "initialize" });
});

test("resolveCwdFromThreadStartParams resolves relative cwd against process cwd", () => {
  const cwd = resolveCwdFromThreadStartParams({ cwd: "Projects/demo" });
  assert.equal(cwd, path.resolve(process.cwd(), "Projects/demo"));
});

test("PT-1 coerceMessageString passes through Error.message", () => {
  assert.equal(coerceMessageString(new Error("boom")), "boom");
});

test("PT-1 coerceMessageString JSON-stringifies plain objects", () => {
  const serialized = coerceMessageString({ code: "bad" });
  assert.equal(typeof serialized, "string");
  assert.notEqual(serialized, "[object Object]");
  assert.equal(serialized, JSON.stringify({ code: "bad" }));
});

test("PT-1 makeJsonRpcError always emits a string message field", () => {
  const line = makeJsonRpcError(1, -32000, new Error("boom"), { errorCode: "request_failed" });
  const parsed = JSON.parse(line);
  assert.equal(typeof parsed.error.message, "string");
  assert.equal(parsed.error.message, "boom");
});

test("PT-1 emitTurnFailed coerces object messages on turn/completed", () => {
  const state = { turnReducerByThreadId: new Map() };
  const line = emitTurnFailed(state, {
    threadId: "thread-1",
    turnId: "turn-1",
    message: { detail: "failed" },
  });
  assert.ok(line);
  const parsed = JSON.parse(line);
  assert.equal(typeof parsed.params.error.message, "string");
  assert.equal(parsed.params.error.message, JSON.stringify({ detail: "failed" }));
});

test("PT-2 catalog shape includes providerId and supportedVariants", () => {
  const result = mapProvidersConfigToModelList({
    providers: [
      {
        id: "anthropic",
        models: {
          "claude-opus-4": {
            name: "Claude Opus 4",
            variants: { thinking: {}, fast: {} },
          },
        },
      },
      {
        id: "openai",
        models: {
          "gpt-5.4": { name: "GPT-5.4" },
        },
      },
    ],
    default: { anthropic: "claude-opus-4" },
  });

  const providerIds = new Set(result.items.map((entry) => entry.providerId));
  assert.equal(providerIds.size, 2);
  assert.ok(providerIds.has("anthropic"));
  assert.ok(providerIds.has("openai"));

  const anthropic = result.items.find((entry) => entry.providerId === "anthropic");
  assert.ok(anthropic);
  assert.deepEqual(anthropic.supportedVariants, [
    { id: "thinking", displayName: "thinking" },
    { id: "fast", displayName: "fast" },
  ]);
  assert.equal(anthropic.modelId, "claude-opus-4");
  assert.equal(anthropic.id, "anthropic/claude-opus-4");
});

test("PT-2 catalog shape omits supportedVariants when provider has none", () => {
  const result = mapProvidersConfigToModelList({
    providers: [{ id: "groq", models: { "llama-3": { name: "Llama 3" } } }],
    default: {},
  });
  assert.deepEqual(result.items[0].supportedVariants, []);
});

test("PT-2 catalog shape expands experimental fast mode with serviceTier", () => {
  const result = mapProvidersConfigToModelList({
    providers: [{
      id: "openai",
      models: {
        "gpt-5.4": {
          name: "GPT-5.4",
          experimental: {
            modes: {
              fast: {
                provider: { body: { service_tier: "priority" } },
              },
            },
          },
        },
      },
    }],
    default: {},
  });

  const base = result.items.find((entry) => entry.modelId === "gpt-5.4");
  const fast = result.items.find((entry) => entry.modelId === "gpt-5.4-fast");
  assert.ok(base);
  assert.ok(fast);
  assert.equal(fast.options.serviceTier, "priority");
  assert.equal(base.supportsFastMode, true);
});

test("PT-1 routeInboundJsonRpc surfaces handler errors as string messages", async () => {
  const state = createRouteTestState();
  state.options.fetchImpl = async (url) => {
    if (String(url).includes("/doc")) {
      return { ok: true, status: 200, text: async () => "{}" };
    }
    if (String(url).includes("/config/providers")) {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ message: "boom" }),
      };
    }
    return { ok: true, status: 200, text: async () => "{}" };
  };
  const lines = [];
  routeInboundJsonRpc(state, JSON.stringify({ id: 42, method: "model/list", params: {} }), (line) => lines.push(line));
  for (let attempt = 0; attempt < 20 && lines.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.error.message, "boom");
  assert.equal(typeof parsed.error.message, "string");
});

test("routeInboundJsonRpc dispatches initialize to a JSON-RPC response", async () => {
  const state = createRouteTestState();
  const lines = [];
  routeInboundJsonRpc(state, JSON.stringify({ id: 1, method: "initialize", params: {} }), (line) => lines.push(line));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.id, 1);
  assert.equal(parsed.result.serverInfo.name, "opencode");
});

test("T1-1 initialize returns truthful OpenCode capabilities", async () => {
  const state = createRouteTestState();
  const lines = [];
  routeInboundJsonRpc(state, JSON.stringify({ id: 2, method: "initialize", params: {} }), (line) => lines.push(line));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(parsedCapabilities(lines[0]), {
    agentRuntime: "opencode",
    transportMode: "opencode",
    turnPagination: true,
    supportsApprovals: true,
    supportsAgents: true,
    supportsVariants: true,
    supportsCollaborationMode: true,
    requiresOpenaiAuth: false,
    experimentalApi: false,
  });
});

test("T1-2 collaborationMode/list returns plan when plan agent exists", async () => {
  const state = createRouteTestState();
  state.options.fetchImpl = async (url) => {
    if (String(url).includes("/agent")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([
          { id: "plan", name: "Plan" },
          { id: "build", name: "Build" },
        ]),
      };
    }
    return { ok: true, status: 200, text: async () => "{}" };
  };
  const lines = [];
  routeInboundJsonRpc(
    state,
    JSON.stringify({ id: 42, method: "collaborationMode/list", params: {} }),
    (line) => lines.push(line),
  );
  for (let attempt = 0; attempt < 20 && lines.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.id, 42);
  assert.ok(parsed.result.modes);
  assert.equal(parsed.result.modes.length, 1);
  assert.equal(parsed.result.modes[0].mode, "plan");
  assert.equal(parsed.result.modes[0].name, "Plan");
  assert.equal(parsed.result.modes[0].supported, true);
});

test("T1-2 collaborationMode/list returns unsupported when plan agent missing", async () => {
  const state = createRouteTestState();
  state.options.fetchImpl = async (url) => {
    if (String(url).includes("/agent")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([
          { id: "build", name: "Build" },
          { id: "test", name: "Test" },
        ]),
      };
    }
    return { ok: true, status: 200, text: async () => "{}" };
  };
  const lines = [];
  routeInboundJsonRpc(
    state,
    JSON.stringify({ id: 43, method: "collaborationMode/list", params: {} }),
    (line) => lines.push(line),
  );
  for (let attempt = 0; attempt < 20 && lines.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.id, 43);
  assert.equal(parsed.result.modes.length, 1);
  assert.equal(parsed.result.modes[0].supported, false);
});

test("handleUnsupportedMethod refuses voice/transcribe and turn/steer", () => {
  const lines = [];
  const emit = (line) => lines.push(line);
  handleUnsupportedMethod("voice/transcribe", { id: "voice-1" }, emit);
  handleUnsupportedMethod("turn/steer", { id: "steer-1" }, emit);

  assert.equal(lines.length, 2);
  const voice = JSON.parse(lines[0]);
  const steer = JSON.parse(lines[1]);
  assert.equal(voice.error.data.errorCode, "voice_not_supported");
  assert.equal(steer.error.data.errorCode, "turn_steer_not_supported");
});

test("routeInboundJsonRpc returns method_not_supported for unknown methods", () => {
  const state = createRouteTestState();
  const lines = [];
  routeInboundJsonRpc(state, JSON.stringify({ id: 9, method: "account/read", params: {} }), (line) => lines.push(line));
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.error.data.errorCode, "method_not_supported");
});

test("markInFlightTurnsFailedOnBoot clears activeRemodexTurnId", () => {
  const bindings = new Map([["thread-1", {
    remodexThreadId: "thread-1",
    opencodeSessionId: "sess-1",
    cwd: "/tmp/workspace",
    model: null,
    activeRemodexTurnId: "turn-1",
    turnPhase: "running",
    updatedAt: 1,
  }]]);

  markInFlightTurnsFailedOnBoot(bindings);
  assert.equal(bindings.get("thread-1").turnPhase, "failed");
  assert.equal(bindings.get("thread-1").activeRemodexTurnId, null);
  assert.equal(bindings.get("thread-1").lastFailedTurnId, "turn-1");
});

test("handleInboundClientResponse maps iOS decision accept to OpenCode once", async () => {
  const requests = [];
  const state = {
    server: {
      phase: "ready",
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "pw",
    },
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      cwd: "/tmp/workspace",
    }]]),
    pendingApprovalsById: new Map([["perm-1", {
      permissionId: "perm-1",
      remodexThreadId: "thread-1",
      remodexItemId: "item-1",
      approvalMethod: "item/commandExecution/requestApproval",
      requestedAt: Date.now(),
    }]]),
    options: {
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return { ok: true, status: 200, text: async () => "{}" };
      },
    },
  };

  await handleInboundClientResponse(state, { id: "perm-1", result: { decision: "accept" } }, () => {});
  const permissionRequest = requests.find((entry) => entry.url.includes("/permissions/perm-1"));
  assert.ok(permissionRequest);
  assert.deepEqual(JSON.parse(permissionRequest.init.body), { response: "once" });
});

test("handleInboundClientResponse resolves pending approval by remodex item id", async () => {
  const requests = [];
  const state = {
    server: {
      phase: "ready",
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "pw",
    },
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      cwd: "/tmp/workspace",
    }]]),
    pendingApprovalsById: new Map([["perm-2", {
      permissionId: "perm-2",
      remodexThreadId: "thread-1",
      remodexItemId: "item-2",
      approvalMethod: "item/fileChange/requestApproval",
      requestedAt: Date.now(),
    }]]),
    options: {
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return { ok: true, status: 200, text: async () => "{}" };
      },
    },
  };

  await handleInboundClientResponse(state, { id: "item-2", result: { decision: "acceptForSession" } }, () => {});
  const permissionRequest = requests.find((entry) => entry.url.includes("/permissions/perm-2"));
  assert.ok(permissionRequest);
  assert.deepEqual(JSON.parse(permissionRequest.init.body), { response: "always" });
});

test("handleUnsupportedMethod refuses desktop/continueOnDesktop", () => {
  const lines = [];
  handleUnsupportedMethod("desktop/continueOnDesktop", { id: "desktop-1" }, (line) => lines.push(line));
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.error.data.errorCode, "desktop_continue_not_supported");
});

test("handleInboundClientResponse keeps pending approval when result is unmapped", async () => {
  const state = {
    server: {
      phase: "ready",
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "pw",
    },
    bindingsByThreadId: new Map([[ "thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      cwd: "/tmp/workspace",
    } ]]),
    pendingApprovalsById: new Map([[ "perm-1", {
      permissionId: "perm-1",
      remodexThreadId: "thread-1",
      remodexItemId: "item-1",
      approvalMethod: "item/commandExecution/requestApproval",
      requestedAt: Date.now(),
    } ]]),
    options: {
      fetchImpl: async (url, init) => {
        if (String(url).endsWith("/doc") && init?.method === "GET") {
          return { ok: true, status: 200, text: async () => "{}" };
        }
        throw new Error("fetch should not run for unmapped approval replies");
      },
    },
  };

  await handleInboundClientResponse(state, { id: "perm-1", result: { foo: "bar" } }, () => {});
  assert.equal(state.pendingApprovalsById.size, 1);
});

test("handleInboundClientResponse maps requestChanges to OpenCode reject", async () => {
  const requests = [];
  const state = {
    server: {
      phase: "ready",
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "pw",
    },
    bindingsByThreadId: new Map([[ "thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      cwd: "/tmp/workspace",
    } ]]),
    pendingApprovalsById: new Map([[ "perm-1", {
      permissionId: "perm-1",
      remodexThreadId: "thread-1",
      remodexItemId: "item-1",
      approvalMethod: "item/commandExecution/requestApproval",
      requestedAt: Date.now(),
    } ]]),
    options: {
      fetchImpl: async (url, init) => {
        if (String(url).endsWith("/doc") && init?.method === "GET") {
          return { ok: true, status: 200, text: async () => "{}" };
        }
        requests.push({ url, init });
        return { ok: true, status: 200, text: async () => "{}" };
      },
    },
  };

  await handleInboundClientResponse(state, { id: "perm-1", result: { decision: "requestChanges" } }, () => {});
  const permissionRequest = requests.find((entry) => entry.url.includes("/permissions/perm-1"));
  assert.ok(permissionRequest);
  assert.deepEqual(JSON.parse(permissionRequest.init.body), { response: "reject" });
  assert.equal(state.pendingApprovalsById.size, 0);
});

test("handleInboundClientResponse posts structured user input answers to OpenCode question reply", async () => {
  const requests = [];
  const state = {
    server: {
      phase: "ready",
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "pw",
    },
    bindingsByThreadId: new Map([[ "thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      cwd: "/tmp/workspace",
    } ]]),
    pendingApprovalsById: new Map([[ "que-1", {
      permissionId: "que-1",
      remodexThreadId: "thread-1",
      remodexItemId: "item-q1",
      approvalMethod: "item/tool/requestUserInput",
      requestedAt: Date.now(),
    } ]]),
    options: {
      fetchImpl: async (url, init) => {
        if (String(url).endsWith("/doc") && init?.method === "GET") {
          return { ok: true, status: 200, text: async () => "{}" };
        }
        requests.push({ url, init });
        return { ok: true, status: 200, text: async () => "true" };
      },
    },
  };

  await handleInboundClientResponse(state, {
    id: "que-1",
    result: {
      answers: {
        "q-color": { answers: ["Red"] },
        "q-animal": { answers: ["Dog"] },
      },
    },
  }, () => {});

  const questionRequest = requests.find((entry) => entry.url.includes("/question/que-1/reply"));
  assert.ok(questionRequest);
  assert.match(questionRequest.url, /\/question\/que-1\/reply$/);
  assert.deepEqual(JSON.parse(questionRequest.init.body), {
    answers: [["Red"], ["Dog"]],
  });
  assert.equal(state.pendingApprovalsById.size, 0);
});

test("createOpenCodeTransport buffers reboot failure notifications until onMessage", async () => {
  const bindingsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oc-factory-")), "bindings.json");
  saveBindings(bindingsPath, new Map([["thread-1", {
    remodexThreadId: "thread-1",
    opencodeSessionId: "sess-1",
    cwd: "/tmp/workspace",
    model: null,
    activeRemodexTurnId: "turn-1",
    turnPhase: "running",
    updatedAt: Date.now(),
  }]]));

  const child = createFakeChild();
  const transport = createOpenCodeTransport({
    bindingsPath,
    spawnImpl: () => child,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/event")) {
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({ start() {} }),
        };
      }
      return { ok: true, status: 200, text: async () => "{}" };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });

  try {
    const bootLines = [];
    transport.onMessage((line) => bootLines.push(line));
    assert.equal(bootLines.length, 1);
    assert.equal(JSON.parse(bootLines[0]).params.status, "failed");

    child.emitStdout("data", Buffer.from("opencode server listening on http://127.0.0.1:9010\n"));
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    transport.shutdown();
  }
});

test("connectOpenCodeEventStream resets reconnectAttempt after a successful connect", async () => {
  const state = {
    server: {
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "pw",
    },
    sse: {
      buffer: "",
      lastSequence: 0,
      reconnectAttempt: 4,
      stop: null,
      seenBusEventIds: new Set(),
    },
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(":\n\n"));
      controller.close();
    },
  });

  connectOpenCodeEventStream(state, {
    onBusEvent() {},
    onStreamLost() {},
  }, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      body: stream,
    }),
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(state.sse.reconnectAttempt, 0);
  state.sse.stop?.();
});

test("scheduleOpenCodeSseReconnect single-flights overlapping reconnect timers", () => {
  const state = {
    server: { phase: "ready" },
    sse: {
      reconnectAttempt: 0,
      reconnectScheduled: false,
      reconnectTimer: null,
      stop: null,
    },
    listeners: { emitMessage() {} },
  };

  const originalSetTimeout = global.setTimeout;
  let scheduled = 0;
  global.setTimeout = (fn, ms) => {
    scheduled += 1;
    return originalSetTimeout(fn, ms);
  };

  try {
    scheduleOpenCodeSseReconnect(state, {});
    scheduleOpenCodeSseReconnect(state, {});
    assert.equal(scheduled, 1);
    assert.equal(state.sse.reconnectScheduled, true);
  } finally {
    global.setTimeout = originalSetTimeout;
    if (state.sse.reconnectTimer) {
      clearTimeout(state.sse.reconnectTimer);
    }
  }
});

test("scheduleOpenCodeSseReconnect emits turn/failed after 20 reconnect attempts", () => {
  const emitted = [];
  const state = {
    server: { phase: "ready" },
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      cwd: "/tmp/ws",
      model: null,
      activeRemodexTurnId: "turn-1",
      turnPhase: "running",
      updatedAt: Date.now(),
    }]]),
    sse: {
      reconnectAttempt: 20,
      reconnectScheduled: false,
      reconnectTimer: null,
      stop: null,
      lastEmittedItemIdByThread: new Map(),
    },
    listeners: {
      emitMessage(line) { emitted.push(line); },
    },
    turnReducerByThreadId: new Map(),
  };

  const originalSetTimeout = global.setTimeout;
  let timerScheduled = false;
  global.setTimeout = () => { timerScheduled = true; return 123; };

  try {
    scheduleOpenCodeSseReconnect(state, {});
    assert.equal(timerScheduled, false);
    assert.equal(state.sse.reconnectScheduled, false);
    assert.equal(state.sse.reconnectAttempt, 0);
    assert.equal(emitted.length, 1);
    const parsed = JSON.parse(emitted[0]);
    assert.equal(parsed.method, "turn/completed");
    assert.equal(parsed.params.status, "failed");
    assert.equal(parsed.params.threadId, "thread-1");
    assert.equal(parsed.params.turnId, "turn-1");
    assert.ok(parsed.params.error.message.includes("20 reconnect attempts"));
  } finally {
    global.setTimeout = originalSetTimeout;
    if (state.sse.reconnectTimer) {
      clearTimeout(state.sse.reconnectTimer);
    }
  }
});

test("scheduleOpenCodeSseReconnect does not fail idle bindings at 20 attempts", () => {
  const emitted = [];
  const state = {
    server: { phase: "ready" },
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      cwd: "/tmp/ws",
      model: null,
      activeRemodexTurnId: null,
      turnPhase: "idle",
      updatedAt: Date.now(),
    }]]),
    sse: {
      reconnectAttempt: 20,
      reconnectScheduled: false,
      reconnectTimer: null,
      stop: null,
      lastEmittedItemIdByThread: new Map(),
    },
    listeners: {
      emitMessage(line) { emitted.push(line); },
    },
    turnReducerByThreadId: new Map(),
  };

  const originalSetTimeout = global.setTimeout;
  let timerScheduled = false;
  global.setTimeout = () => { timerScheduled = true; return 123; };

  try {
    scheduleOpenCodeSseReconnect(state, {});
    assert.equal(timerScheduled, false);
    assert.equal(emitted.length, 0, "must not emit turn/failed for idle bindings");
    assert.equal(state.sse.reconnectAttempt, 0);
  } finally {
    global.setTimeout = originalSetTimeout;
    if (state.sse.reconnectTimer) {
      clearTimeout(state.sse.reconnectTimer);
    }
  }
});

test("catchUpAfterSseReconnect emits item/updated for missed items after reconnect", async () => {
  const emitted = [];
  const state = {
    server: {
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "pw",
    },
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      cwd: "/tmp/ws",
      model: null,
      activeRemodexTurnId: "turn-1",
      turnPhase: "running",
      updatedAt: Date.now(),
    }]]),
    sse: {
      lastEmittedItemIdByThread: new Map([["thread-1", "item-3"]]),
      seenBusEventIds: new Set(),
    },
    options: {
      // OpenCode API returns newest-first; the catch-up code reverses to oldest-first
      fetchImpl: async (url) => {
        assert.ok(url.includes("/session/sess-1/message"));
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: [
            { info: { id: "item-5", role: "assistant" }, parts: [{ type: "text", text: "Let me explain" }] },
            { info: { id: "item-4", role: "assistant" }, parts: [{ type: "text", text: "Here is some code" }] },
            { info: { id: "item-3", role: "assistant" }, parts: [{ type: "text", text: "How can I help?" }] },
            { info: { id: "item-2", role: "assistant" }, parts: [{ type: "text", text: "Hi there" }] },
            { info: { id: "item-1", role: "user" }, parts: [{ type: "text", text: "Hello" }] },
          ]}),
        };
      },
    },
    listeners: {
      emitMessage(line) { emitted.push(line); },
    },
    turnReducerByThreadId: new Map(),
  };

  await catchUpAfterSseReconnect(state);

  // item-3 is the last emitted, so we should get item-4 and item-5
  assert.equal(emitted.length, 2, "should emit 2 missed items");

  const parsed4 = JSON.parse(emitted[0]);
  assert.equal(parsed4.method, "item/updated");
  assert.equal(parsed4.params.itemId, "item-4");
  assert.equal(parsed4.params.threadId, "thread-1");
  assert.equal(parsed4.params.turnId, "turn-1");

  const parsed5 = JSON.parse(emitted[1]);
  assert.equal(parsed5.method, "item/updated");
  assert.equal(parsed5.params.itemId, "item-5");
  assert.equal(parsed5.params.threadId, "thread-1");
  assert.equal(parsed5.params.turnId, "turn-1");
});

test("catchUpAfterSseReconnect handles newest-first message ordering", async () => {
  const emitted = [];
  const state = {
    server: {
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "pw",
    },
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      cwd: "/tmp/ws",
      model: null,
      activeRemodexTurnId: "turn-1",
      turnPhase: "running",
      updatedAt: Date.now(),
    }]]),
    sse: {
      lastEmittedItemIdByThread: new Map([["thread-1", "msg-2"]]),
      seenBusEventIds: new Set(),
    },
    options: {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [
          { info: { id: "msg-5", role: "assistant" }, parts: [{ type: "text", text: "Fifth" }] },
          { info: { id: "msg-4", role: "assistant" }, parts: [{ type: "text", text: "Fourth" }] },
          { info: { id: "msg-3", role: "assistant" }, parts: [{ type: "text", text: "Third" }] },
          { info: { id: "msg-2", role: "assistant" }, parts: [{ type: "text", text: "Second" }] },
          { info: { id: "msg-1", role: "user" }, parts: [{ type: "text", text: "First" }] },
        ]}),
      }),
    },
    listeners: {
      emitMessage(line) { emitted.push(line); },
    },
    turnReducerByThreadId: new Map(),
  };

  await catchUpAfterSseReconnect(state);

  // Should reverse newest-first to oldest-first, find msg-2, emit msg-3, msg-4, msg-5
  // msg-1 is user role and should be skipped
  assert.equal(emitted.length, 3, "should emit 3 missed items after reversal");

  const ids = emitted.map((line) => JSON.parse(line).params.itemId);
  assert.deepEqual(ids, ["msg-3", "msg-4", "msg-5"]);
});

test("catchUpAfterSseReconnect skips binding with no lastEmittedItemId", async () => {
  const emitted = [];
  const state = {
    server: {
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "pw",
    },
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      cwd: "/tmp/ws",
      model: null,
      activeRemodexTurnId: "turn-1",
      turnPhase: "running",
      updatedAt: Date.now(),
    }]]),
    sse: {
      lastEmittedItemIdByThread: new Map(),
      seenBusEventIds: new Set(),
    },
    options: {},
    listeners: {
      emitMessage(line) { emitted.push(line); },
    },
  };

  await catchUpAfterSseReconnect(state);
  assert.equal(emitted.length, 0);
});

test("routeInboundJsonRpc returns workspace_busy when cwd lock is held", async () => {
  const state = createRouteTestState();
  const cwd = "/tmp/shared-workspace";
  state.bindingsByThreadId.set("thread-1", {
    remodexThreadId: "thread-1",
    opencodeSessionId: "sess-1",
    cwd,
    model: null,
    activeRemodexTurnId: null,
    turnPhase: "idle",
    updatedAt: Date.now(),
  });
  state.bindingsByThreadId.set("thread-2", {
    remodexThreadId: "thread-2",
    opencodeSessionId: "sess-2",
    cwd,
    model: null,
    activeRemodexTurnId: null,
    turnPhase: "idle",
    updatedAt: Date.now(),
  });
  rebuildBindingIndexes(state);
  tryAcquireCwdLock(state, cwd, "thread-1", "turn-1");

  const lines = [];
  routeInboundJsonRpc(state, JSON.stringify({
    id: 42,
    method: "turn/start",
    params: { threadId: "thread-2", turnId: "turn-2", input: "hello" },
  }), (line) => lines.push(line));

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.error.data.errorCode, "workspace_busy");
  assert.equal(parsed.error.data.holderThreadId, "thread-1");
});

test("handleTurnInterruptRequest emits interrupted turn notification", async () => {
  const state = createRouteTestState();
  state.bindingsByThreadId.set("thread-1", {
    remodexThreadId: "thread-1",
    opencodeSessionId: "sess-1",
    cwd: "/tmp/workspace",
    model: null,
    activeRemodexTurnId: "turn-1",
    turnPhase: "running",
    updatedAt: Date.now(),
  });
  rebuildBindingIndexes(state);

  const lines = [];
  routeInboundJsonRpc(state, JSON.stringify({
    id: 7,
    method: "turn/interrupt",
    params: { threadId: "thread-1" },
  }), (line) => lines.push(line));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const payloads = lines.map((line) => JSON.parse(line));
  const response = payloads.find((entry) => entry.id === 7);
  const notification = payloads.find((entry) => entry.method === "turn/completed");
  assert.equal(response.result.interrupted, true);
  assert.equal(notification.method, "turn/completed");
  assert.equal(notification.params.status, "interrupted");
});

test("handleThreadReadRequest re-emits reboot failure when lastFailedTurnId is set", async () => {
  const state = createRouteTestState();
  state.bindingsByThreadId.set("thread-1", {
    remodexThreadId: "thread-1",
    opencodeSessionId: "sess-1",
    cwd: "/tmp/workspace",
    model: null,
    activeRemodexTurnId: null,
    lastFailedTurnId: "turn-reboot",
    turnPhase: "failed",
    updatedAt: Date.now(),
  });
  rebuildBindingIndexes(state);

  const lines = [];
  routeInboundJsonRpc(state, JSON.stringify({
    id: 3,
    method: "thread/read",
    params: { threadId: "thread-1" },
  }), (line) => lines.push(line));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const notification = lines.find((line) => {
    const parsed = JSON.parse(line);
    return parsed.method === "turn/completed";
  });
  assert.ok(notification);
  const parsed = JSON.parse(notification);
  assert.equal(parsed.params.status, "failed");
  assert.equal(parsed.params.turnId, "turn-reboot");
  assert.equal(state.bindingsByThreadId.get("thread-1").lastFailedTurnId, null);
});

test("mapBusEventToCodexLines marks unbound session events processed", () => {
  const state = {
    bindingsByThreadId: new Map(),
    bindingsBySessionId: new Map(),
    pendingApprovalsById: new Map(),
    sse: {
      seenBusEventIds: new Set(),
      lastAppliedSequence: 0,
    },
    turnReducerByThreadId: new Map(),
  };

  const first = mapBusEventToCodexLines(state, {
    type: "session.status",
    properties: { sessionID: "missing-session", status: "busy" },
    sequence: 1,
    id: "orphan-1",
  });
  const second = mapBusEventToCodexLines(state, {
    type: "session.status",
    properties: { sessionID: "missing-session", status: "busy" },
    sequence: 2,
    id: "orphan-1",
  });

  assert.deepEqual(first, []);
  assert.deepEqual(second, []);
  assert.ok(state.sse.seenBusEventIds.has("orphan-1"));
});

test("mapBusEventToCodexLines maps question.asked to requestUserInput notification", () => {
  const state = {
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      activeRemodexTurnId: "turn-1",
      turnPhase: "running",
    }]]),
    bindingsBySessionId: new Map([["sess-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      activeRemodexTurnId: "turn-1",
      turnPhase: "running",
    }]]),
    pendingApprovalsById: new Map(),
    sse: { buffer: "", lastSequence: 0, reconnectAttempt: 0, stop: null, seenBusEventIds: new Set(), evictedBusEventIds: new Set() },
    turnReducerByThreadId: new Map(),
  };
  rebuildBindingIndexes(state);

  const lines = mapBusEventToCodexLines(state, {
    type: "question.asked",
    properties: {
      sessionID: "sess-1",
      id: "que-42",
      questions: [{ header: "Pick a color", options: ["Red", "Blue"] }],
    },
    sequence: 1,
    id: "evt-question-1",
  });

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.method, "item/tool/requestUserInput");
  assert.equal(parsed.params.threadId, "thread-1");
  assert.equal(parsed.params.turnId, "turn-1");
  assert.ok(state.pendingApprovalsById.has("que-42"));
});

test("mapBusEventToCodexLines routes tool deltas after message.part.updated registers tool kind", () => {
  const state = {
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      activeRemodexTurnId: "turn-1",
      turnPhase: "running",
    }]]),
    bindingsBySessionId: new Map(),
    pendingApprovalsById: new Map(),
    sse: { buffer: "", lastSequence: 0, reconnectAttempt: 0, stop: null, seenBusEventIds: new Set(), evictedBusEventIds: new Set() },
    turnReducerByThreadId: new Map(),
  };
  rebuildBindingIndexes(state);

  mapBusEventToCodexLines(state, {
    type: "message.part.updated",
    properties: {
      sessionID: "sess-1",
      part: { id: "part-tool-1", type: "tool", tool: "bash", state: { status: "running" } },
    },
    sequence: 1,
    id: "evt-part-updated",
  });

  const lines = mapBusEventToCodexLines(state, {
    type: "message.part.delta",
    properties: {
      sessionID: "sess-1",
      partID: "part-tool-1",
      delta: "npm test",
    },
    sequence: 2,
    id: "evt-tool-delta",
  });

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.method, "item/toolCall/outputDelta");
  assert.equal(parsed.params.delta, "npm test");
});

test("mapBusEventToCodexLines drops replayed ids kept in evicted tombstones after LRU eviction", () => {
  const state = {
    bindingsByThreadId: new Map(),
    pendingApprovalsById: new Map(),
    sse: {
      buffer: "",
      lastSequence: 0,
      reconnectAttempt: 0,
      stop: null,
      seenBusEventIds: new Set(),
      evictedBusEventIds: new Set(["evt-tombstone"]),
      lastAppliedSequence: 0,
    },
  };

  const lines = mapBusEventToCodexLines(state, {
    type: "server.connected",
    properties: {},
    sequence: 100,
    id: "evt-tombstone",
  });

  assert.deepEqual(lines, []);
});

test("markBusEventProcessed tombstones evicted ids so reconnect replay stays deduped", () => {
  const state = {
    sse: {
      seenBusEventIds: new Set(),
      evictedBusEventIds: new Set(),
      lastAppliedSequence: 0,
    },
  };

  for (let index = 0; index <= BUS_EVENT_ID_CACHE_LIMIT; index += 1) {
    mapBusEventToCodexLines(state, {
      type: "server.connected",
      properties: {},
      sequence: index + 1,
      id: `evt-${index}`,
    });
  }

  assert.ok(state.sse.evictedBusEventIds.has("evt-0"));
  const replay = mapBusEventToCodexLines(state, {
    type: "server.connected",
    properties: {},
    sequence: 999,
    id: "evt-0",
  });
  assert.deepEqual(replay, []);
});

test("emitTurnFailed emits turn/completed with failed status for iOS and push parity", () => {
  const state = { turnReducerByThreadId: new Map() };
  const line = emitTurnFailed(state, {
    threadId: "thread-1",
    turnId: "turn-1",
    message: "session error",
  });
  assert.ok(line);
  const parsed = JSON.parse(line);
  assert.equal(parsed.method, "turn/completed");
  assert.equal(parsed.params.status, "failed");
  assert.equal(parsed.params.error.message, "session error");
});

test("markInFlightTurnsFailedOnBoot is idempotent on second boot reconciliation", () => {
  const bindings = new Map([["thread-1", {
    remodexThreadId: "thread-1",
    opencodeSessionId: "sess-1",
    cwd: "/tmp/workspace",
    model: null,
    activeRemodexTurnId: "turn-1",
    turnPhase: "running",
    updatedAt: 1,
  }]]);

  markInFlightTurnsFailedOnBoot(bindings);
  markInFlightTurnsFailedOnBoot(bindings);

  assert.equal(bindings.get("thread-1").turnPhase, "failed");
  assert.equal(bindings.get("thread-1").activeRemodexTurnId, null);
  assert.equal(bindings.get("thread-1").lastFailedTurnId, "turn-1");
});

test("expireStaleCwdLocks releases locks older than TTL", () => {
  const state = {
    locksByCwd: new Map([["/tmp/workspace", {
      cwd: "/tmp/workspace",
      ownerThreadId: "thread-1",
      ownerTurnId: "turn-1",
      acquiredAt: 1_000,
    }]]),
    options: { now: () => 1_000 + CWD_LOCK_TTL_MS + 1 },
  };

  expireStaleCwdLocks(state);
  assert.equal(state.locksByCwd.size, 0);

  const fresh = tryAcquireCwdLock(state, "/tmp/workspace", "thread-2", "turn-2");
  assert.deepEqual(fresh, { ok: true });
});

test("persistBindings debounces disk writes until flush", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-debounce-"));
  const bindingsPath = path.join(dir, "opencode-bindings.json");
  const state = {
    bindingsByThreadId: new Map([["thread-1", {
      remodexThreadId: "thread-1",
      opencodeSessionId: "sess-1",
      cwd: "/tmp/workspace",
      model: null,
      activeRemodexTurnId: "turn-1",
      turnPhase: "running",
      updatedAt: Date.now(),
    }]]),
    options: { bindingsPath },
    _persistBindingsTimer: null,
  };

  persistBindings(state);
  assert.ok(state._persistBindingsTimer);
  assert.equal(fs.existsSync(bindingsPath), false);

  flushPersistBindings(state);
  assert.equal(state._persistBindingsTimer, null);
  assert.equal(fs.existsSync(bindingsPath), true);
});

test("connectOpenCodeEventStream signals stream loss for SSE reconnect integration", async () => {
  const streamLost = [];
  const state = {
    server: {
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "pw",
    },
    sse: {
      buffer: "",
      lastSequence: 0,
      reconnectAttempt: 0,
      stop: null,
      seenBusEventIds: new Set(),
      evictedBusEventIds: new Set(),
    },
  };

  connectOpenCodeEventStream(state, {
    onBusEvent() {},
    onStreamLost(reason) {
      streamLost.push(reason.message);
    },
  }, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    }),
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(streamLost.length, 1);
  assert.match(streamLost[0], /ended/i);
  state.sse.stop?.();
});

test("createOpenCodeTransport round-trips turn/start through routeInboundJsonRpc and mock fetch", async () => {
  const bindingsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oc-roundtrip-")), "bindings.json");
  saveBindings(bindingsPath, new Map([["thread-1", {
    remodexThreadId: "thread-1",
    opencodeSessionId: "sess-1",
    cwd: "/tmp/workspace",
    model: null,
    activeRemodexTurnId: null,
    turnPhase: "idle",
    updatedAt: Date.now(),
  }]]));

  const fetchCalls = [];
  const child = createFakeChild();
  const transport = createOpenCodeTransport({
    bindingsPath,
    spawnImpl: () => child,
    fetchImpl: async (url, init) => {
      const urlString = String(url);
      if (urlString.endsWith("/event")) {
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start() {},
          }),
        };
      }
      fetchCalls.push({ url: urlString, init });
      return { ok: true, status: 200, text: async () => "{}" };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });

  const responses = [];
  transport.onMessage((line) => responses.push(line));

  try {
    const started = new Promise((resolve) => {
      transport.onStarted(() => resolve());
    });
    child.emitStdout("data", Buffer.from("opencode server listening on http://127.0.0.1:9020\n"));
    await started;

    transport.send(JSON.stringify({
      id: "turn-req-1",
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: [{ type: "text", text: "Ship it" }],
      },
    }));

    for (let attempt = 0; attempt < 20 && !responses.some((line) => JSON.parse(line).id === "turn-req-1"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const promptCall = fetchCalls.find((entry) => entry.url.includes("/session/sess-1/prompt_async"));
    assert.ok(promptCall, `expected prompt_async fetch, saw: ${fetchCalls.map((entry) => entry.url).join(", ")}`);
    assert.equal(JSON.parse(promptCall.init.body).parts[0].text, "Ship it");

    const rpcResponse = responses.find((line) => {
      const parsed = JSON.parse(line);
      return parsed.id === "turn-req-1";
    });
    assert.ok(rpcResponse, `expected turn/start response, saw: ${responses.join(" | ")}`);
    assert.equal(JSON.parse(rpcResponse).result.turn.status, "running");
  } finally {
    transport.shutdown();
  }
});

function parsedCapabilities(line) {
  return JSON.parse(line).result.capabilities;
}

test("T1-6 thread/contextWindow/read is refused for OpenCode threads", () => {
  const refusal = lookupOpenCodeTransportRefusal("thread/contextWindow/read");
  assert.ok(refusal, "Expected refusal for thread/contextWindow/read");
  assert.equal(refusal.errorCode, "context_not_supported");
});

function createRouteTestState() {
  return {
    server: {
      phase: "ready",
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "pw",
    },
    bindingsByThreadId: new Map(),
    bindingsBySessionId: new Map(),
    locksByCwd: new Map(),
    pendingApprovalsById: new Map(),
    sse: {
      buffer: "",
      lastSequence: 0,
      reconnectAttempt: 0,
      stop: null,
      seenBusEventIds: new Set(),
    },
    turnReducerByThreadId: new Map(),
    options: {
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" }),
      spawnImpl: () => createFakeChild(),
    },
  };
}
