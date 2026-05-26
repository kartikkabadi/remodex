// FILE: codex-to-canonical-adapter.test.js
// Purpose: Verifies fixture-style Codex notification conversion into canonical Remodex events.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/codex-to-canonical-adapter, ../src/canonical-events

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PERMISSION_REQUEST_METHOD,
  convertCodexNotificationToCanonical,
  convertCodexServerRequestToCanonical,
} = require("../src/codex-to-canonical-adapter");
const { validateCanonicalEvent } = require("../src/canonical-events");

test("codex adapter maps turn lifecycle notifications to canonical events", () => {
  const threadStarted = convertFixture({
    method: "thread/started",
    params: {
      thread: {
        id: "thread-1",
        title: "Canonical thread",
      },
    },
  });
  const canonical = convertFixture({
    method: "turn/started",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
    },
  });

  assert.equal(threadStarted.method, "remodex/event/thread_started");
  assert.equal(threadStarted.params.threadId, "thread-1");
  assert.equal(threadStarted.params.payload.thread.title, "Canonical thread");
  assert.deepEqual(validateCanonicalEvent(threadStarted), { valid: true });
  assert.equal(canonical.method, "remodex/event/turn_started");
  assert.equal(canonical.params.threadId, "thread-1");
  assert.equal(canonical.params.agentSessionId, "agent-session-thread-1");
  assert.deepEqual(validateCanonicalEvent(canonical), { valid: true });
});

test("codex adapter maps assistant deltas to canonical assistant_delta", () => {
  const canonical = convertFixture({
    method: "codex/event/agent_message_content_delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      delta: "Hello",
    },
  });

  assert.equal(canonical.method, "remodex/event/assistant_delta");
  assert.equal(canonical.params.itemId, "item-1");
  assert.equal(canonical.params.payload.delta, "Hello");
  assert.equal(canonical.params.payload.sourceMethod, "codex/event/agent_message_content_delta");
});

test("codex adapter maps assistant item completions to canonical assistant_completed", () => {
  const canonical = convertFixture({
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "assistant-1",
        type: "agent_message",
        role: "assistant",
        text: "Done.",
      },
    },
  });

  assert.equal(canonical.method, "remodex/event/assistant_completed");
  assert.equal(canonical.params.itemId, "assistant-1");
  assert.equal(canonical.params.payload.text, "Done.");
});

test("codex adapter maps tool activity and diffs to canonical events", () => {
  const toolStarted = convertFixture({
    method: "codex/event/exec_command_begin",
    params: {
      threadId: "thread-tools",
      turnId: "turn-tools",
      itemId: "tool-1",
      command: "git status",
    },
  });
  const toolDelta = convertFixture({
    method: "codex/event/exec_command_output_delta",
    params: {
      threadId: "thread-tools",
      turnId: "turn-tools",
      itemId: "tool-1",
      chunk: "On branch main",
    },
  });
  const diff = convertFixture({
    method: "turn/diff/updated",
    params: {
      threadId: "thread-tools",
      turnId: "turn-tools",
      diff: "diff --git a/file b/file",
    },
  });

  assert.equal(toolStarted.method, "remodex/event/tool_started");
  assert.equal(toolStarted.params.payload.command, "git status");
  assert.equal(toolDelta.method, "remodex/event/tool_delta");
  assert.equal(toolDelta.params.payload.chunk, "On branch main");
  assert.equal(diff.method, "remodex/event/diff_updated");
});

test("codex adapter maps explicit tool completion fixtures", () => {
  const completed = convertFixture({
    method: "codex/event/exec_command_end",
    params: {
      threadId: "thread-tools",
      turnId: "turn-tools",
      itemId: "tool-1",
      command: "git status",
      status: "completed",
      success: true,
    },
  });

  assert.equal(completed.method, "remodex/event/tool_completed");
  assert.equal(completed.params.itemId, "tool-1");
  assert.equal(completed.params.payload.toolType, "exec_command_end");
  assert.equal(completed.params.payload.status, "completed");
  assert.equal(completed.params.payload.success, true);
});

test("codex adapter keeps plan methods while adding canonical envelope fields", () => {
  const planUpdated = convertFixture({
    method: "turn/plan/updated",
    params: {
      threadId: "thread-plan",
      turnId: "turn-plan",
      plan: {
        steps: [
          { id: "step-1", text: "Inspect", status: "completed" },
          { id: "step-2", text: "Patch", status: "in_progress" },
        ],
      },
    },
  });
  const planDelta = convertFixture({
    method: "item/plan/delta",
    params: {
      threadId: "thread-plan",
      turnId: "turn-plan",
      itemId: "plan-item-1",
      delta: "Need one more fixture.",
    },
  });

  assert.equal(planUpdated.method, "turn/plan/updated");
  assert.equal(planUpdated.params.schemaVersion, 1);
  assert.equal(planUpdated.params.agentRuntime, "codex");
  assert.equal(planUpdated.params.payload.sourceMethod, "turn/plan/updated");
  assert.equal(planUpdated.params.payload.plan.steps.length, 2);
  assert.equal(planUpdated.params.plan.steps[1].status, "in_progress");
  assert.equal(planDelta.method, "item/plan/delta");
  assert.equal(planDelta.params.schemaVersion, 1);
  assert.equal(planDelta.params.itemId, "plan-item-1");
  assert.equal(planDelta.params.payload.delta, "Need one more fixture.");
  assert.equal(planDelta.params.delta, "Need one more fixture.");
});

test("codex adapter maps rollout message strings and image generation end", () => {
  const userMessage = convertFixture({
    method: "codex/event/user_message",
    params: {
      threadId: "thread-rollout",
      turnId: "turn-rollout",
      message: "Prompt from desktop",
    },
  });
  const assistantMessage = convertFixture({
    method: "codex/event/agent_message",
    params: {
      threadId: "thread-rollout",
      turnId: "turn-rollout",
      itemId: "assistant-rollout",
      message: "Done from desktop",
    },
  });
  const imageEnd = convertFixture({
    method: "codex/event/image_generation_end",
    params: {
      threadId: "thread-rollout",
      turnId: "turn-rollout",
      itemId: "image-rollout",
      saved_path: "/tmp/generated image.png",
    },
  });

  assert.equal(userMessage.method, "remodex/event/user_message");
  assert.equal(userMessage.params.payload.text, "Prompt from desktop");
  assert.equal(assistantMessage.method, "remodex/event/assistant_completed");
  assert.equal(assistantMessage.params.payload.text, "Done from desktop");
  assert.equal(imageEnd.method, "remodex/event/image_generation_end");
  assert.equal(imageEnd.params.itemId, "image-rollout");
  assert.equal(imageEnd.params.payload.saved_path, "/tmp/generated image.png");
});

test("codex adapter accepts already-parsed notification objects", () => {
  const canonical = convertCodexNotificationToCanonical({
    method: "codex/event/user_message",
    params: {
      threadId: "thread-object",
      message: "Object input",
    },
  }, {
    now: () => "2026-05-23T00:00:00.000Z",
  });

  assert.equal(canonical.method, "remodex/event/user_message");
  assert.equal(canonical.params.payload.text, "Object input");
});

test("codex adapter maps approval server requests to canonical permission requests", () => {
  const canonical = convertCodexServerRequestToCanonical({
    jsonrpc: "2.0",
    id: "approval-1",
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-permission",
      turnId: "turn-permission",
      itemId: "item-permission",
      command: "git status",
      reason: "Inspect repository state",
      permissions: {
        shell: true,
      },
    },
  }, {
    now: () => "2026-05-23T00:00:00.000Z",
    resolveAgentSessionId({ threadId }) {
      return `agent-session-${threadId}`;
    },
  });

  assert.equal(canonical.id, "approval-1");
  assert.equal(canonical.method, PERMISSION_REQUEST_METHOD);
  assert.equal(canonical.params.agentRuntime, "codex");
  assert.equal(canonical.params.threadId, "thread-permission");
  assert.equal(canonical.params.agentSessionId, "agent-session-thread-permission");
  assert.equal(canonical.params.turnId, "turn-permission");
  assert.equal(canonical.params.itemId, "item-permission");
  assert.equal(canonical.params.permissionId, "approval-1");
  assert.equal(canonical.params.payload.sourceMethod, "item/commandExecution/requestApproval");
  assert.equal(canonical.params.payload.request.command, "git status");
  assert.equal(canonical.params.payload.request.reason, "Inspect repository state");
  assert.equal(canonical.params.payload.request.permissions.shell, true);
});

test("codex adapter stringifies numeric approval ids for permission tracking", () => {
  const canonical = convertCodexServerRequestToCanonical({
    jsonrpc: "2.0",
    id: 42,
    method: "item/fileRead/requestApproval",
    params: {
      threadId: "thread-numeric",
      path: "README.md",
    },
  });

  assert.equal(canonical.id, 42);
  assert.equal(canonical.params.permissionId, "42");
});

test("codex adapter maps server request resolution to canonical metadata", () => {
  const resolved = convertFixture({
    method: "serverRequest/resolved",
    params: {
      threadId: "thread-permission",
      turnId: "turn-permission",
      requestId: "approval-1",
      resolution: {
        decision: "accept",
      },
    },
  });

  assert.equal(resolved.method, "serverRequest/resolved");
  assert.equal(resolved.params.schemaVersion, 1);
  assert.equal(resolved.params.requestId, "approval-1");
  assert.equal(resolved.params.payload.requestId, "approval-1");
  assert.equal(resolved.params.payload.resolution.decision, "accept");
});

test("codex adapter maps failed turns and error envelopes to canonical error events", () => {
  const failed = convertFixture({
    method: "turn/failed",
    params: {
      threadId: "thread-error",
      turnId: "turn-error",
      error: {
        message: "Tool crashed",
        code: "tool_failed",
      },
    },
  });
  const error = convertFixture({
    method: "codex/event/error",
    params: {
      threadId: "thread-error",
      turnId: "turn-error",
      message: "Runtime went away",
    },
  });

  assert.equal(failed.method, "remodex/event/error");
  assert.equal(failed.params.payload.message, "Tool crashed");
  assert.equal(failed.params.payload.code, "tool_failed");
  assert.equal(error.method, "remodex/event/error");
  assert.equal(error.params.payload.message, "Runtime went away");
});

test("codex adapter ignores non-approval server requests", () => {
  assert.equal(convertCodexServerRequestToCanonical({
    jsonrpc: "2.0",
    id: "question-1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-question",
    },
  }), null);
});

test("codex adapter preserves unknown approval-like server requests as raw", () => {
  assert.equal(convertCodexServerRequestToCanonical({
    jsonrpc: "2.0",
    id: "unknown-approval",
    method: "runtime/custom/requestApproval",
    params: {
      threadId: "thread-custom",
    },
  }), null);
});

test("codex adapter ignores responses and unknown notifications", () => {
  assert.equal(convertFixture({
    id: "thread-list-1",
    result: { data: [] },
  }), null);
  assert.equal(convertFixture({
    method: "session/unknown",
    params: {},
  }), null);
});

function convertFixture(message) {
  return convertCodexNotificationToCanonical(JSON.stringify(message), {
    now: () => "2026-05-23T00:00:00.000Z",
    resolveAgentSessionId({ threadId }) {
      return threadId ? `agent-session-${threadId}` : "";
    },
  });
}
