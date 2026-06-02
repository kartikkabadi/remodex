// FILE: opencode-client.test.js
// Purpose: Verifies OpenCode SDK client wrapper without a live server (injected mock SDK).
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/opencode-client

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createOpenCodeClient,
  dispatchEvent,
  flattenProviderModels,
  resolveAgentsList,
} = require("../src/opencode-client");

const TEST_BASE_URL = "http://127.0.0.1:4291";

function createMockOpencodeClientImpl() {
  return function createOpencodeClient() {
    return {
      provider: {
        list: async () => ({
          providers: [
            {
              id: "anthropic",
              models: [{ id: "claude-sonnet-4", name: "Claude Sonnet 4" }],
            },
          ],
        }),
      },
      app: {
        agents: async () => ({
          data: [{ name: "build", description: "Default agent" }],
        }),
        skills: async () => [],
      },
      session: {
        create: async () => ({ sessionID: "ses_test" }),
        get: async () => ({}),
        prompt: async () => ({}),
        setConfig: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({ messages: [] }),
        fork: async () => ({ sessionID: "ses_fork" }),
      },
      permission: {
        reply: async () => ({}),
      },
      command: {
        list: async () => [{ token: "/compact", title: "Compact" }],
      },
      event: {
        subscribe: async () => ({
          stream: (async function* eventStream() {
            yield { type: "turn.started", turnID: "turn-1" };
          })(),
          close: () => {},
        }),
      },
      tui: {
        selectSession: async () => ({}),
      },
    };
  };
}

async function createTestClient() {
  return createOpenCodeClient({
    baseUrl: TEST_BASE_URL,
    createOpencodeClientImpl: createMockOpencodeClientImpl(),
  });
}

test("throws when baseUrl is empty", async () => {
  await assert.rejects(() => createOpenCodeClient({ baseUrl: "" }), { message: /baseUrl/ });
});

test("throws when baseUrl is missing", async () => {
  await assert.rejects(() => createOpenCodeClient({}), { message: /baseUrl/ });
});

test("creates client when baseUrl is provided", async () => {
  const client = await createTestClient();
  assert.ok(client, "client object exists");
  assert.equal(typeof client.listModels, "function");
  assert.equal(typeof client.listAgents, "function");
  assert.equal(typeof client.createSession, "function");
  assert.equal(typeof client.getSession, "function");
  assert.equal(typeof client.prompt, "function");
  assert.equal(typeof client.setModel, "function");
  assert.equal(typeof client.setMode, "function");
  assert.equal(typeof client.setEffort, "function");
  assert.equal(typeof client.abort, "function");
  assert.equal(typeof client.getMessages, "function");
  assert.equal(typeof client.replyToPermission, "function");
  assert.equal(typeof client.subscribeToEvents, "function");
  assert.equal(typeof client.fork, "function");
  assert.equal(typeof client.listCommands, "function");
  assert.equal(typeof client.listSkills, "function");
});

test("listModels returns flattened provider model array", async () => {
  const client = await createTestClient();
  const models = await client.listModels();
  assert.equal(models.length, 1);
  assert.equal(models[0].upstreamProviderId, "anthropic");
});

test("flattenProviderModels preserves upstream provider metadata", () => {
  const models = flattenProviderModels({
    providers: [
      {
        id: "anthropic",
        models: [{ id: "claude-sonnet-4", name: "Claude Sonnet 4" }],
      },
      {
        id: "openai",
        models: [{ id: "gpt-5.5", displayName: "GPT-5.5" }],
      },
    ],
  });

  assert.equal(models.length, 2);
  assert.equal(models[0].modelProvider, "opencode");
  assert.equal(models[0].upstreamProviderId, "anthropic");
  assert.equal(models[0].id, "anthropic/claude-sonnet-4");
  assert.equal(models[1].upstreamProviderId, "openai");
  assert.equal(models[1].upstreamProviderDisplayName, "OpenAI");
});

test("flattenProviderModels unwraps SDK provider.list envelope with object models", () => {
  const models = flattenProviderModels({
    data: {
      all: [
        {
          id: "anthropic",
          models: {
            "claude-sonnet-4": { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
          },
        },
        {
          id: "openai",
          models: {
            "gpt-5.5": { id: "gpt-5.5", displayName: "GPT-5.5" },
          },
        },
      ],
    },
  });

  assert.equal(models.length, 2);
  assert.equal(models[0].upstreamProviderId, "anthropic");
  assert.equal(models[1].upstreamProviderId, "openai");
});

test("resolveAgentsList unwraps SDK app.agents envelope", () => {
  const agents = resolveAgentsList({
    data: [
      { name: "build", description: "Default agent" },
      { name: "plan", description: "Plan mode", hidden: true },
    ],
  });

  assert.equal(agents.length, 2);
  assert.equal(agents[0].name, "build");
});

test("listAgents returns agent array", async () => {
  const client = await createTestClient();
  const agents = await client.listAgents();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].id, "build");
});

test("createSession requires cwd", async () => {
  const client = await createTestClient();
  const sessionId = await client.createSession({ cwd: "/tmp/project" });
  assert.equal(sessionId, "ses_test");
});

test("subscribeToEvents returns unsubscribe and exits cleanly", async () => {
  const client = await createTestClient();
  const events = [];

  const unsubscribe = client.subscribeToEvents((method, payload) => {
    events.push(method);
  });

  assert.equal(typeof unsubscribe, "function");

  await new Promise((resolve) => setTimeout(resolve, 10));
  unsubscribe();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(events, ["turn/started"]);
});

test("abort sends session abort", async () => {
  const client = await createTestClient();
  await assert.doesNotReject(() => client.abort("ses_test"));
});

test("getMessages returns message array", async () => {
  const client = await createTestClient();
  const messages = await client.getMessages("ses_test");
  assert.deepEqual(messages, []);
});

test("replyToPermission sends permission reply", async () => {
  const client = await createTestClient();
  await assert.doesNotReject(() => client.replyToPermission("perm-1", true));
});

test("listCommands API surface is exposed", async () => {
  const client = await createTestClient();
  const commands = await client.listCommands("/tmp/project");
  assert.equal(commands.length, 1);
  assert.equal(commands[0].token, "/compact");
});

test("dispatchEvent maps session.next.text.delta to agent message delta", () => {
  const events = [];
  dispatchEvent(
    {
      type: "session.next.text.delta",
      properties: {
        sessionID: "ses-1",
        delta: "Hello ",
      },
    },
    (method, payload) => events.push([method, payload]),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0][0], "item/agentMessage/delta");
  assert.equal(events[0][1].delta, "Hello");
  assert.equal(events[0][1].textDelta, "Hello");
});

test("dispatchEvent maps session.next.text.delta.1 suffix events", () => {
  const events = [];
  dispatchEvent(
    {
      type: "session.next.text.delta.1",
      properties: { sessionID: "ses-1", delta: "partial" },
    },
    (method) => events.push(method),
  );
  assert.deepEqual(events, ["item/agentMessage/delta"]);
});

test("dispatchEvent maps session.next.tool.called and tool.success", () => {
  const events = [];
  dispatchEvent(
    {
      type: "session.next.tool.called",
      properties: {
        sessionID: "ses-1",
        callID: "call-1",
        tool: "bash",
        input: { command: "ls" },
      },
    },
    (method, payload) => events.push([method, payload]),
  );
  dispatchEvent(
    {
      type: "session.next.tool.success",
      properties: {
        sessionID: "ses-1",
        callID: "call-1",
        content: [{ type: "text", text: "done" }],
      },
    },
    (method, payload) => events.push([method, payload]),
  );

  assert.equal(events[0][0], "item/toolCall");
  assert.equal(events[0][1].toolName, "bash");
  assert.equal(events[1][0], "item/toolCallUpdate");
  assert.equal(events[1][1].status, "completed");
  assert.equal(events[2][0], "item/completed");
});

test("dispatchEvent maps session.next.reasoning.delta", () => {
  const events = [];
  dispatchEvent(
    {
      type: "session.next.reasoning.delta",
      properties: {
        sessionID: "ses-1",
        reasoningID: "reason-1",
        delta: "thinking",
      },
    },
    (method) => events.push(method),
  );
  assert.deepEqual(events, ["item/reasoning/textDelta"]);
});