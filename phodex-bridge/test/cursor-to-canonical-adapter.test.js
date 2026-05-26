// FILE: cursor-to-canonical-adapter.test.js
// Purpose: Verifies Cursor ACP fixture conversion into Remodex canonical events.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/cursor-to-canonical-adapter, ../src/canonical-events

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PERMISSION_REQUEST_METHOD,
  convertCursorAcpFrameToCanonical,
  cursorModeForParams,
} = require("../src/cursor-to-canonical-adapter");
const { validateCanonicalEvent } = require("../src/canonical-events");

test("Cursor adapter maps assistant and reasoning deltas to canonical assistant_delta", () => {
  const canonical = convertFixture({
    method: "session/update",
    params: {
      type: "reasoning_delta",
      sessionId: "cur-1",
      turnId: "turn-1",
      itemId: "reason-1",
      reasoning: "Thinking",
    },
  });

  assert.equal(canonical.method, "remodex/event/assistant_delta");
  assert.equal(canonical.params.agentRuntime, "cursor");
  assert.equal(canonical.params.payload.reasoning, "Thinking");
  assert.deepEqual(validateCanonicalEvent(canonical), { valid: true });
});

test("Cursor adapter maps live ACP agent message chunks to assistant deltas", () => {
  const canonical = convertFixture({
    method: "session/update",
    params: {
      sessionId: "cur-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Hello from Cursor",
        },
      },
    },
  });

  assert.equal(canonical.method, "remodex/event/assistant_delta");
  assert.equal(canonical.params.payload.delta, "Hello from Cursor");
  assert.equal(canonical.params.payload.sourceMethod, "session/update");
  assert.deepEqual(validateCanonicalEvent(canonical), { valid: true });
});

test("Cursor adapter maps tool, diff, completion, and error fixtures", () => {
  const tool = convertFixture({ method: "session/update", params: { type: "tool_started", name: "shell" } });
  const diff = convertFixture({ method: "session/update", params: { type: "diff_updated", diff: "--- a" } });
  const done = convertFixture({ method: "session/update", params: { type: "completed", status: "completed" } });
  const error = convertFixture({ method: "session/update", params: { type: "error", message: "boom" } });

  assert.equal(tool.method, "remodex/event/tool_started");
  assert.equal(tool.params.payload.toolName, "shell");
  assert.equal(diff.method, "remodex/event/diff_updated");
  assert.equal(done.method, "remodex/event/turn_completed");
  assert.equal(error.method, "remodex/event/error");
});

test("Cursor adapter maps permission request without auto-allowing it", () => {
  const permission = convertFixture({
    id: 9,
    method: "permission/request",
    params: {
      id: "perm-1",
      toolName: "shell",
    },
  });

  assert.equal(permission.method, PERMISSION_REQUEST_METHOD);
  assert.equal(permission.id, 9);
  assert.equal(permission.params.permissionId, "perm-1");
  assert.equal(permission.params.payload.request.toolName, "shell");
});

test("cursorModeForParams preserves documented ACP modes and defaults UI-only modes to agent", () => {
  assert.equal(cursorModeForParams({ mode: "agent" }), "agent");
  assert.equal(cursorModeForParams({ mode: "plan" }), "plan");
  assert.equal(cursorModeForParams({ plan: true }), "plan");
  assert.equal(cursorModeForParams({ mode: "ask" }), "ask");
  assert.equal(cursorModeForParams({ mode: "debug" }), "agent");
  assert.equal(cursorModeForParams({ mode: "multitask" }), "agent");
  assert.equal(cursorModeForParams({}), "agent");
});

function convertFixture(frame) {
  return convertCursorAcpFrameToCanonical(frame, {
    threadId: "thread-cursor",
    agentSessionId: "cur-1",
    turnId: "turn-1",
    now: () => "2026-05-24T00:00:00.000Z",
  });
}
