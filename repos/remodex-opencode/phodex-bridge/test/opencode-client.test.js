// FILE: opencode-client.test.js
// Purpose: Verifies OpenCode SDK client wrapper without a live server (injected mock SDK).
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/opencode-client

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildModelFromAny,
  createOpenCodeClient,
  dispatchEvent,
  flattenProviderModels,
  resolveAgentsList,
  resolveSessionIdFromCreateResponse,
} = require("../src/opencode-client");

const TEST_BASE_URL = "http://127.0.0.1:4291";

function createMockOpencodeClientImpl() {
  return function createOpencodeClient() {
    return {
      provider: {
        list: async () => ({
          all: [
            {
              id: "anthropic",
              name: "Anthropic",
              source: "api",
              models: { "claude-sonnet-4": { id: "claude-sonnet-4", name: "Claude Sonnet 4" } },
            },
          ],
          connected: ["anthropic"],
          default: {},
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
  assert.equal(typeof client.abort, "function");
  assert.equal(typeof client.getMessages, "function");
  assert.equal(typeof client.replyToPermission, "function");
  assert.equal(typeof client.subscribeToEvents, "function");
  assert.equal(typeof client.fork, "function");
  assert.equal(typeof client.listCommands, "function");
  assert.equal(typeof client.listSkills, "function");
});

test("listModels returns connected-only models with meta", async () => {
  const client = await createTestClient();
  const result = await client.listModels();
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].upstreamProviderId, "anthropic");
  assert.equal(result.models[0].upstreamProviderDisplayName, "Anthropic");
  assert.equal(result.meta.reasonCode, "ok");
  assert.deepEqual(result.meta.connectedProviderIds, ["anthropic"]);
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

test("resolveSessionIdFromCreateResponse reads nested and top-level envelopes", () => {
  assert.equal(
    resolveSessionIdFromCreateResponse({ data: { id: "ses_test" } }),
    "ses_test",
  );
  assert.equal(
    resolveSessionIdFromCreateResponse({ data: { sessionID: "ses_nested" } }),
    "ses_nested",
  );
  assert.equal(
    resolveSessionIdFromCreateResponse({ data: { sessionId: "ses_data_sessionId" } }),
    "ses_data_sessionId",
  );
  assert.equal(
    resolveSessionIdFromCreateResponse({ sessionID: "ses_top" }),
    "ses_top",
  );
  assert.equal(
    resolveSessionIdFromCreateResponse({ sessionId: "ses_top_sessionId" }),
    "ses_top_sessionId",
  );
  assert.equal(
    resolveSessionIdFromCreateResponse({ id: "ses_top_id" }),
    "ses_top_id",
  );
  assert.equal(resolveSessionIdFromCreateResponse(null), "");
  assert.equal(resolveSessionIdFromCreateResponse(undefined), "");
  assert.equal(resolveSessionIdFromCreateResponse({}), "");
  assert.equal(resolveSessionIdFromCreateResponse({ data: {} }), "");
  assert.equal(resolveSessionIdFromCreateResponse({ data: { id: "" } }), "");
});

test("createSession requires cwd", async () => {
  const client = await createTestClient();
  const sessionId = await client.createSession({ cwd: "/tmp/project" });
  assert.equal(sessionId, "ses_test");
});

test("createSession fails fast when response has no session id", async () => {
  const client = await createOpenCodeClient({
    baseUrl: TEST_BASE_URL,
    createOpencodeClientImpl: () => ({
      provider: {
        list: async () => ({ all: [], connected: [], default: {} }),
      },
      app: { agents: async () => ({ data: [] }), skills: async () => [] },
      session: {
        create: async () => ({ data: {} }),
        get: async () => ({}),
        prompt: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({ messages: [] }),
        fork: async () => ({ data: {} }),
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

  await assert.rejects(
    () => client.createSession({ cwd: "/tmp/project" }),
    /returned no session id/,
  );
  await assert.rejects(() => client.fork("ses_parent"), /returned no session id/);
});

test("createSession resolves session id from SDK data.id envelope", async () => {
  const client = await createOpenCodeClient({
    baseUrl: TEST_BASE_URL,
    createOpencodeClientImpl: () => ({
      provider: {
        list: async () => ({ all: [], connected: [], default: {} }),
      },
      app: { agents: async () => ({ data: [] }), skills: async () => [] },
      session: {
        create: async () => ({ data: { id: "ses_data_envelope" } }),
        get: async () => ({}),
        prompt: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({ messages: [] }),
        fork: async () => ({ data: { id: "ses_fork_data" } }),
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
  const sessionId = await client.createSession({ cwd: "/tmp/project" });
  assert.equal(sessionId, "ses_data_envelope");
  const forkId = await client.fork("ses_data_envelope");
  assert.equal(forkId, "ses_fork_data");
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

test("dispatchEvent maps session.idle to turn/completed", () => {
  const events = [];
  dispatchEvent(
    { type: "session.idle", properties: { sessionID: "ses-1", turnID: "turn-9" } },
    (method, payload) => events.push([method, payload]),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0][0], "turn/completed");
  assert.equal(events[0][1].status, "completed");
  assert.equal(events[0][1].completionSource, "session.idle");
});

test("dispatchEvent maps message.part.delta properties to agentMessage delta", () => {
  const events = [];
  dispatchEvent(
    {
      type: "message.part.delta",
      properties: {
        sessionID: "ses-1",
        messageID: "msg-1",
        partID: "part-1",
        field: "text",
        delta: "Hello",
      },
    },
    (method, payload) => events.push([method, payload]),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0][0], "item/agentMessage/delta");
  assert.equal(events[0][1].delta, "Hello");
  assert.equal(events[0][1].itemId, "part-1");
});

function createProbeMockClient({ connected = [], auth = {} } = {}) {
  return function createOpencodeClient() {
    return {
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
    };
  };
}

test("probeConnectedProviders returns false when connected list is empty", async () => {
  const client = await createOpenCodeClient({
    baseUrl: TEST_BASE_URL,
    createOpencodeClientImpl: createProbeMockClient({ connected: [] }),
  });
  assert.equal(await client.probeConnectedProviders(), false);
});

test("probeConnectedProviders returns true when connected providers exist", async () => {
  const client = await createOpenCodeClient({
    baseUrl: TEST_BASE_URL,
    createOpencodeClientImpl: createProbeMockClient({ connected: ["anthropic"] }),
  });
  assert.equal(await client.probeConnectedProviders(), true);
});

test("probeProviderAuthState returns true when auth methods are configured", async () => {
  const client = await createOpenCodeClient({
    baseUrl: TEST_BASE_URL,
    createOpencodeClientImpl: createProbeMockClient({
      auth: { anthropic: ["oauth"], openai: ["api"] },
    }),
  });
  assert.equal(await client.probeProviderAuthState(), true);
});

test("prompt passes parsed model agent and variant to session.prompt", async () => {
  const captured = [];
  const client = await createOpenCodeClient({
    baseUrl: TEST_BASE_URL,
    createOpencodeClientImpl: () => ({
      provider: {
        list: async () => ({
          all: [{ id: "opencode-go", name: "OpenCode Go", models: {} }],
          connected: ["opencode-go"],
          default: {},
        }),
        auth: async () => ({}),
      },
      app: { agents: async () => ({ data: [] }), skills: async () => [] },
      session: {
        create: async () => ({ sessionID: "ses_prompt" }),
        get: async () => ({}),
        prompt: async (body) => {
          captured.push(body);
          return {};
        },
        abort: async () => ({}),
        messages: async () => ({ messages: [] }),
        fork: async () => ({ sessionID: "ses_fork" }),
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

  const promptLogs = [];
  const originalLog = console.log;
  console.log = (value) => {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (parsed?.event === "opencode_turn_prompt") {
          promptLogs.push(parsed);
        }
      } catch {
        // Ignore non-JSON console output.
      }
    }
    originalLog(value);
  };

  try {
    await client.prompt({
      sessionID: "ses_prompt",
      prompt: "hi",
      model: "opencode-go/deepseek-v4-flash",
      agent: "build",
      variant: "max",
      threadId: "thread-42",
      turnId: "turn-42",
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].model, {
    providerID: "opencode-go",
    modelID: "deepseek-v4-flash",
  });
  assert.equal(captured[0].agent, "build");
  assert.equal(captured[0].variant, "max");
  assert.equal(promptLogs.length, 1);
  assert.equal(promptLogs[0].threadId, "thread-42");
  assert.equal(promptLogs[0].turnId, "turn-42");
  assert.equal(promptLogs[0].sessionId, "ses_prompt");
});

test("probeProviderAuthState returns false when auth payload has no methods", async () => {
  const client = await createOpenCodeClient({
    baseUrl: TEST_BASE_URL,
    createOpencodeClientImpl: createProbeMockClient({ auth: { anthropic: [] } }),
  });
  assert.equal(await client.probeProviderAuthState(), false);
});

test("buildModelFromAny sets logoProviderId for OpenCode Zen upstream", () => {
  const zenModel = buildModelFromAny(
    { id: "free", name: "Free" },
    { id: "opencode", name: "OpenCode Zen" },
  );
  assert.equal(zenModel.logoProviderId, "opencode-zen");
  assert.equal(zenModel.upstreamProviderId, "opencode");
  assert.equal(zenModel.upstreamProviderDisplayName, "OpenCode Zen");
});

test("buildModelFromAny omits logoProviderId for generic OpenCode upstream", () => {
  const model = buildModelFromAny(
    { id: "free", name: "Free" },
    { id: "opencode", name: "OpenCode" },
  );
  assert.equal(model.logoProviderId, undefined);
});

test("buildModelFromAny sets logoProviderId for OpenCode Go upstream", () => {
  const goModel = buildModelFromAny(
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "opencode-go", name: "OpenCode Go" },
  );
  assert.equal(goModel.logoProviderId, "opencode-go");
  assert.equal(goModel.upstreamProviderId, "opencode-go");
});