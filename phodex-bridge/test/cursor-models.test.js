// FILE: cursor-models.test.js
// Purpose: Verifies Cursor ACP model config parsing for provider-aware model/list responses.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/cursor-models

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_CURSOR_MODEL,
  normalizeCursorModelReference,
  parseCursorModelsFromSessionResult,
} = require("../src/cursor-models");
const { createCursorProvider, selectPermissionOption } = require("../src/cursor-provider");

test("parseCursorModelsFromSessionResult flattens ACP model config options", () => {
  const models = parseCursorModelsFromSessionResult({
    configOptions: [
      {
        id: "model",
        category: "model",
        currentValue: "composer-2.5[fast=true]",
        options: [
          { name: "Auto", value: "default[]" },
          {
            name: "OpenAI",
            options: [
              {
                name: "GPT-5.5",
                value: "gpt-5.5[context=272k,reasoning=medium,fast=false]",
              },
            ],
          },
          { name: "Composer 2.5", value: "composer-2.5[fast=true]" },
        ],
      },
    ],
  });

  assert.deepEqual(models.map((model) => model.id), [
    "default[]",
    "gpt-5.5[context=272k,reasoning=medium,fast=false]",
    "composer-2.5[fast=true]",
  ]);
  assert.equal(models[0].modelProvider, "cursor");
  assert.equal(models[0].provider, "cursor");
  assert.equal(models[2].isDefault, true);
});

test("parseCursorModelsFromSessionResult falls back to the Composer default", () => {
  const models = parseCursorModelsFromSessionResult({});

  assert.equal(models.length, 1);
  assert.equal(models[0].id, DEFAULT_CURSOR_MODEL);
  assert.equal(models[0].modelProvider, "cursor");
  assert.equal(models[0].isDefault, true);
});

test("normalizeCursorModelReference rejects non-model payloads", () => {
  assert.equal(normalizeCursorModelReference("composer-2.5[fast=true]"), "composer-2.5[fast=true]");
  assert.equal(normalizeCursorModelReference("{\"model\":\"gpt\"}"), "");
  assert.equal(normalizeCursorModelReference("bad\nmodel"), "");
});

test("selectPermissionOption prefers durable allow when full access is already selected", () => {
  const optionId = selectPermissionOption(
    [
      { optionId: "once", kind: "allow_once" },
      { optionId: "always", kind: "allow_always" },
    ],
    { approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } }
  );

  assert.equal(optionId, "always");
});

test("Cursor thread/start uses a deterministic provider thread id from the ACP session", async () => {
  const calls = [];
  const provider = createCursorProvider({
    createAcpClient: () => ({
      async request(method, params) {
        calls.push({ method, params });
        if (method === "initialize") {
          return { protocolVersion: 1 };
        }
        if (method === "session/new") {
          return { sessionId: "session-abc" };
        }
        return null;
      },
      kill() {
        calls.push({ method: "kill" });
      },
    }),
    randomUUIDImpl: () => "fallback-id",
    sendApplicationMessage: () => {},
  });

  const result = await provider.handleRequest({
    method: "thread/start",
    params: {
      cwd: "/tmp/project",
      model: "composer-2.5[fast=true]",
    },
  });

  assert.equal(result.thread.id, "cursor-thread-session-abc");
  assert.equal(result.thread.metadata.sessionId, "session-abc");
  assert.equal(provider.ownsThread("cursor-thread-session-abc"), true);
  assert.deepEqual(calls.map((call) => call.method), [
    "initialize",
    "session/new",
    "session/set_config_option",
    "kill",
  ]);
});
