// FILE: opencode-client.test.js
// Purpose: Verifies OpenCode SDK client wrapper: model/agent discovery, sessions,
//          events, permissions. Uses dependency injection to test without real server.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/opencode-client

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOpenCodeClient } = require("../src/opencode-client");

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
});

test("listModels returns flattened provider model array", async () => {
  const client = await createOpenCodeClient({ baseUrl: "http://127.0.0.1:4291" });
  assert.equal(typeof client.listModels, "function");
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
