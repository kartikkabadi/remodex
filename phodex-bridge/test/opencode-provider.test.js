// FILE: opencode-provider.test.js
// Purpose: Verifies OpenCode provider thread adoption without invoking the real CLI.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, events, stream, ../src/opencode-provider

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const {
  createOpenCodeProvider,
  parseOpenCodeExport,
} = require("../src/opencode-provider");

test("turn/start adopts an existing chat id and runs OpenCode in the provided cwd", async () => {
  const messages = [];
  const spawnCalls = [];
  const provider = createOpenCodeProvider({
    sendApplicationMessage(message) {
      messages.push(JSON.parse(message));
    },
    randomUUIDImpl: () => "uuid-1",
    spawnImpl(command, args) {
      spawnCalls.push({ command, args });
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      setImmediate(() => {
        child.stdout.write(`${JSON.stringify({ type: "step_start", sessionID: "ses_test" })}\n`);
        child.stdout.write(`${JSON.stringify({ type: "text", part: { id: "part-1", text: "Hello" } })}\n`);
        child.stdout.end();
        child.emit("close", 0);
      });
      return child;
    },
  });

  const result = await provider.handleRequest({
    method: "turn/start",
    params: {
      threadId: "codex-thread-1",
      cwd: "/tmp/remodex-opencode",
      model: "opencode/gpt-5.5",
      input: [{ type: "input_text", text: "Say hello" }],
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(result.turn.threadId, "codex-thread-1");
  assert.equal(provider.ownsThread("codex-thread-1"), true);
  assert.equal(spawnCalls[0].command, "opencode");
  assert.deepEqual(spawnCalls[0].args.slice(0, 7), [
    "run",
    "--format",
    "json",
    "--model",
    "opencode/gpt-5.5",
    "--dir",
    "/tmp/remodex-opencode",
  ]);
  assert.equal(messages.some((message) => message.method === "item/agentMessage/delta"), true);
  assert.equal(messages.at(-1).method, "turn/completed");
});

test("export parsing keeps live Remodex turn stable when OpenCode later exports the same session", () => {
  const storedTurn = {
    id: "opencode-turn-local",
    status: "completed",
    items: [
      {
        id: "opencode-user-local",
        type: "userMessage",
        text: "ciao",
      },
      {
        id: "opencode-agent-local",
        type: "agentMessage",
        text: "Ciao! Come posso aiutarti?",
      },
    ],
  };

  const turns = parseOpenCodeExport(JSON.stringify({
    messages: [
      {
        info: { id: "msg-user-exported", role: "user" },
        parts: [{ type: "text", text: "ciao" }],
      },
      {
        info: { id: "msg-assistant-exported", role: "assistant" },
        parts: [{ type: "text", text: "Ciao! Come posso aiutarti?" }],
      },
    ],
  }), {
    turns: [storedTurn],
  });

  assert.equal(turns.length, 1);
  assert.equal(turns[0].id, "opencode-turn-local");
});

test("thread/read exports OpenCode sessions without sanitizing visible transcript text", async () => {
  const execCalls = [];
  const provider = createOpenCodeProvider({
    execFileImpl(command, args, options, callback) {
      execCalls.push({ command, args });
      callback(null, JSON.stringify({
        messages: [
          {
            info: { id: "msg-user-exported", role: "user" },
            parts: [{ type: "text", text: "ciao" }],
          },
          {
            info: { id: "msg-assistant-exported", role: "assistant" },
            parts: [{ type: "text", text: "Ciao! Come posso aiutarti?" }],
          },
        ],
      }), "");
    },
  });

  const response = await provider.handleRequest({
    method: "thread/read",
    params: {
      threadId: "ses_test",
      includeTurns: true,
    },
  });

  assert.deepEqual(execCalls[0].args, ["export", "ses_test"]);
  assert.equal(response.thread.turns[0].items[0].text, "ciao");
});

test("session list remembers OpenCode project directories for picker reuse", async () => {
  const remembered = [];
  const provider = createOpenCodeProvider({
    projectRegistry: {
      rememberProjectPath(projectPath, metadata) {
        remembered.push({ projectPath, metadata });
      },
    },
    execFileImpl(command, args, options, callback) {
      callback(null, JSON.stringify([
        {
          id: "ses_test",
          title: "OpenCode chat",
          directory: "/Users/me/work/opencode-app",
          updatedAt: "2026-05-21T10:00:00.000Z",
        },
      ]), "");
    },
  });

  const result = await provider.listThreads();

  assert.equal(result.data[0].cwd, "/Users/me/work/opencode-app");
  assert.deepEqual(remembered, [{
    projectPath: "/Users/me/work/opencode-app",
    metadata: {
      source: "opencode-session-list",
      provider: "opencode",
      lastSeenAt: "2026-05-21T10:00:00.000Z",
    },
  }]);
});

test("thread/start does not remember the bridge cwd when no project cwd was provided", async () => {
  const remembered = [];
  const provider = createOpenCodeProvider({
    projectRegistry: {
      rememberProjectPath(projectPath, metadata) {
        remembered.push({ projectPath, metadata });
      },
    },
    randomUUIDImpl: () => "uuid-1",
  });

  const result = await provider.handleRequest({
    method: "thread/start",
    params: {
      model: "opencode/gpt-5.5",
    },
  });

  assert.equal(result.thread.cwd, null);
  assert.equal(result.thread.metadata.projectCwdSource, "fallback");
  assert.deepEqual(remembered, []);
});

test("session list hides fallback cwd when OpenCode omits a project directory", async () => {
  const provider = createOpenCodeProvider({
    execFileImpl(command, args, options, callback) {
      callback(null, JSON.stringify([
        {
          id: "ses_rootless",
          title: "Rootless OpenCode chat",
          updatedAt: "2026-05-21T10:00:00.000Z",
        },
      ]), "");
    },
  });

  const result = await provider.listThreads();

  assert.equal(result.data[0].cwd, null);
  assert.equal(result.data[0].metadata.projectCwdSource, "fallback");
});

test("turn/start replaces a fallback session cwd when the request provides a project cwd", async () => {
  const remembered = [];
  const spawnCalls = [];
  const provider = createOpenCodeProvider({
    projectRegistry: {
      rememberProjectPath(projectPath, metadata) {
        remembered.push({ projectPath, metadata });
      },
    },
    randomUUIDImpl: () => "uuid-1",
    spawnImpl(command, args) {
      spawnCalls.push({ command, args });
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      setImmediate(() => {
        child.stdout.end();
        child.emit("close", 0);
      });
      return child;
    },
  });

  await provider.handleRequest({
    method: "thread/read",
    params: {
      threadId: "ses_without_directory",
    },
  });
  await provider.handleRequest({
    method: "turn/start",
    params: {
      threadId: "ses_without_directory",
      cwd: "/Users/me/work/opencode-app",
      model: "opencode/gpt-5.5",
      input: "hello",
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(spawnCalls[0].args[6], "/Users/me/work/opencode-app");
  assert.equal(remembered.at(-1).projectPath, "/Users/me/work/opencode-app");
  assert.equal(remembered.at(-1).metadata.source, "opencode-request-cwd");
});

test("export parsing drops sanitized OpenCode text placeholders", () => {
  const turns = parseOpenCodeExport(JSON.stringify({
    messages: [
      {
        info: { id: "msg-user-redacted", role: "user" },
        parts: [{ type: "text", text: "[redacted:text:prt_e5163dcc9001pKQKV4VPozQdgE]" }],
      },
      {
        info: { id: "msg-assistant-redacted", role: "assistant" },
        parts: [{ type: "text", text: "[redacted:text:prt_e5163e657001MmdkT4ans3C8pl]" }],
      },
    ],
  }), {
    turns: [],
  });

  assert.deepEqual(turns, []);
});
