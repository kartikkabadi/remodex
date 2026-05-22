// FILE: telegram-timeline-projector.test.js
// Purpose: Verifies iOS-style turn identity, dedupe, and late-event policy for Telegram.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/telegram-timeline-projector

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTimelineDedupeKey,
  createTelegramTimelineProjector,
} = require("../src/telegram-timeline-projector");

function turnStarted({ threadId, turnId }) {
  return JSON.stringify({
    method: "turn/started",
    params: { threadId, turnId },
  });
}

function turnCompleted({ threadId, turnId }) {
  return JSON.stringify({
    method: "turn/completed",
    params: { threadId, turnId },
  });
}

function agentDelta({ threadId, turnId, delta, itemId = "" }) {
  return JSON.stringify({
    method: "codex/event/agent_message_content_delta",
    params: { threadId, turnId, delta, itemId },
  });
}

test("buildTimelineDedupeKey uses method thread turn and item identity", () => {
  assert.equal(
    buildTimelineDedupeKey({
      method: "codex/event/agent_message",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
    }),
    "codex/event/agent_message|thread-1|turn-1|item-1",
  );
});

test("turn/started without turnId enables protected running fallback", () => {
  const projector = createTelegramTimelineProjector();

  const projection = projector.project(turnStarted({ threadId: "thread-1" }));

  assert.equal(projection.duplicate, false);
  assert.equal(projection.conversationActions.length, 1);
  assert.equal(projection.conversationActions[0].type, "threadEvent");
  assert.equal(projector.hasProtectedRunningFallback("thread-1"), true);
  assert.equal(projector.getActiveTurnId("thread-1"), "");
  assert.equal(projector.resolveTurnId("thread-1", ""), "");
});

test("turn/started with turnId clears fallback and tracks active turn", () => {
  const projector = createTelegramTimelineProjector();

  projector.project(turnStarted({ threadId: "thread-1" }));
  projector.project(turnStarted({ threadId: "thread-1", turnId: "turn-1" }));

  assert.equal(projector.hasProtectedRunningFallback("thread-1"), false);
  assert.equal(projector.getActiveTurnId("thread-1"), "turn-1");
  assert.equal(projector.resolveTurnId("thread-1", ""), "turn-1");
});

test("streaming deltas without itemId are not deduped across chunks", () => {
  const projector = createTelegramTimelineProjector();
  const payload = agentDelta({ threadId: "thread-1", turnId: "turn-1", delta: "Hey" });

  const first = projector.project(payload);
  const second = projector.project(agentDelta({ threadId: "thread-1", turnId: "turn-1", delta: " there" }));

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, false);
  assert.equal(first.conversationActions[0].type, "streamingDelta");
  assert.equal(second.conversationActions[0].type, "streamingDelta");
});

test("duplicate events are dropped by dedupe key", () => {
  const projector = createTelegramTimelineProjector();
  const payload = turnStarted({ threadId: "thread-1", turnId: "turn-1" });

  const first = projector.project(payload);
  const second = projector.project(payload);

  assert.equal(first.duplicate, false);
  assert.equal(first.conversationActions.length, 1);
  assert.equal(second.duplicate, true);
  assert.equal(second.conversationActions.length, 0);
});

test("late streaming deltas after turn/completed are patched not reopened", () => {
  const projector = createTelegramTimelineProjector();

  projector.project(turnStarted({ threadId: "thread-1", turnId: "turn-1" }));
  projector.project(turnCompleted({ threadId: "thread-1", turnId: "turn-1" }));

  const late = projector.project(agentDelta({
    threadId: "thread-1",
    turnId: "turn-1",
    delta: "late tail",
    itemId: "item-1",
  }));

  assert.equal(late.duplicate, false);
  assert.equal(late.conversationActions.length, 1);
  assert.equal(late.conversationActions[0].type, "streamingLateDelta");
  assert.equal(late.conversationActions[0].delta, "late tail");
});

test("new turn after completion accepts live deltas again", () => {
  const projector = createTelegramTimelineProjector();

  projector.project(turnStarted({ threadId: "thread-1", turnId: "turn-1" }));
  projector.project(turnCompleted({ threadId: "thread-1", turnId: "turn-1" }));
  projector.project(turnStarted({ threadId: "thread-1", turnId: "turn-2" }));

  const live = projector.project(agentDelta({
    threadId: "thread-1",
    turnId: "turn-2",
    delta: "fresh",
  }));

  assert.equal(live.conversationActions[0].type, "streamingDelta");
});

test("approval and user-input requests route to control actions", () => {
  const projector = createTelegramTimelineProjector();

  const approval = projector.project(JSON.stringify({
    id: "req-1",
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread-1", turnId: "turn-1" },
  }));
  const userInput = projector.project(JSON.stringify({
    id: "req-2",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [{ id: "q1", header: "Pick", options: [{ label: "A" }] }],
    },
  }));

  assert.equal(approval.controlActions[0].type, "approval");
  assert.equal(approval.controlActions[0].request.id, "req-1");
  assert.equal(userInput.controlActions[0].type, "userInput");
  assert.equal(userInput.controlActions[0].request.id, "req-2");
});

test("late agent_message after completed turn is dropped from conversation stream", () => {
  const projector = createTelegramTimelineProjector();

  projector.project(turnStarted({ threadId: "thread-1", turnId: "turn-1" }));
  projector.project(turnCompleted({ threadId: "thread-1", turnId: "turn-1" }));

  const late = projector.project(JSON.stringify({
    method: "codex/event/agent_message",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-final",
      message: "stale snapshot",
    },
  }));

  assert.equal(late.conversationActions[0].type, "threadEventLate");
});

test("turn/completed emits file-change summary from accumulated deltas", () => {
  const projector = createTelegramTimelineProjector();

  projector.project(turnStarted({ threadId: "thread-1", turnId: "turn-1" }));
  projector.project(JSON.stringify({
    method: "item/fileChange/outputDelta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      delta: "Edited src/auth.ts +18 -3\n",
    },
  }));

  const completed = projector.project(turnCompleted({ threadId: "thread-1", turnId: "turn-1" }));
  const summaryAction = completed.conversationActions.find((action) => action.type === "turnFileChangeSummary");

  assert.ok(summaryAction);
  assert.equal(summaryAction.summary.entries.length, 1);
  assert.equal(summaryAction.summary.entries[0].path, "src/auth.ts");
});

test("activity footer events surface as streaming footer actions", () => {
  const projector = createTelegramTimelineProjector();

  projector.project(turnStarted({ threadId: "thread-1", turnId: "turn-1" }));
  const activity = projector.project(JSON.stringify({
    method: "codex/event/background_event",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      message: "running tests in auth/",
    },
  }));

  assert.equal(activity.conversationActions[0].type, "streamingActivityFooter");
  assert.equal(activity.conversationActions[0].activity, "running tests in auth/");
});
