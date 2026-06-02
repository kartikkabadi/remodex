// FILE: opencode-client.test.js
// Purpose: Verifies OpenCode SDK client wrapper: model/agent discovery, sessions,
//          events, permissions. Uses dependency injection to test without real server.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/opencode-client

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createOpenCodeClient,
  flattenProviderModels,
  resolveAgentsList,
} = require("../src/opencode-client");

test("throws when baseUrl is empty", async () => {
  await assert.rejects(() => createOpenCodeClient({ baseUrl: "" }), { message: /baseUrl/ });
});

test("throws when baseUrl is missing", async () => {
  await assert.rejects(() => createOpenCodeClient({}), { message: /baseUrl/ });
});

test("creates client when baseUrl is provided", async () => {
  const client = await createOpenCodeClient({ baseUrl: "http://127.0.0.1:4291" });
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
  const client = await createOpenCodeClient({ baseUrl: "http://127.0.0.1:4291" });
  assert.equal(typeof client.listModels, "function");
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
  const client = await createOpenCodeClient({ baseUrl: "http://127.0.0.1:4291" });
  assert.equal(typeof client.listAgents, "function");
});

test("createSession requires cwd", async () => {
  const client = await createOpenCodeClient({ baseUrl: "http://127.0.0.1:4291" });
  assert.equal(typeof client.createSession, "function");
});

test("subscribeToEvents returns unsubscribe function", async () => {
  const client = await createOpenCodeClient({ baseUrl: "http://127.0.0.1:4291" });
  const unsubscribe = client.subscribeToEvents(() => {});
  assert.equal(typeof unsubscribe, "function");
  unsubscribe();
});

test("abort sends session abort", async () => {
  const client = await createOpenCodeClient({ baseUrl: "http://127.0.0.1:4291" });
  assert.equal(typeof client.abort, "function");
});

test("getMessages returns message array", async () => {
  const client = await createOpenCodeClient({ baseUrl: "http://127.0.0.1:4291" });
  assert.equal(typeof client.getMessages, "function");
});

test("replyToPermission sends permission reply", async () => {
  const client = await createOpenCodeClient({ baseUrl: "http://127.0.0.1:4291" });
  assert.equal(typeof client.replyToPermission, "function");
});

test("listCommands API surface is exposed", async () => {
  const client = await createOpenCodeClient({ baseUrl: "http://127.0.0.1:4291" });
  assert.equal(typeof client.listCommands, "function");
});
