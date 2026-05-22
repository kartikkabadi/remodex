// FILE: telegram-streaming-bubble.test.js
// Purpose: Verifies live assistant bubble edits and delta parsing.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/telegram-streaming-bubble

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TELEGRAM_EMPTY_REPLY_MARKUP,
} = require("../src/telegram-bot-api-client");
const {
  STREAMING_PLACEHOLDER,
  createTelegramStreamingBubble,
  parseTelegramStreamingDelta,
} = require("../src/telegram-streaming-bubble");

test("streaming bubble creates one message and throttles edits", async () => {
  const edits = [];
  const messages = [];
  let nowMs = 0;
  let scheduled;
  const bubble = createTelegramStreamingBubble({
    botClient: {
      sendMessage: async ({ chatId, text, replyMarkup }) => {
        messages.push({ chatId, text, replyMarkup });
        return { message_id: 11 };
      },
      editMessageText: async (payload) => {
        edits.push(payload);
        return true;
      },
      editMessageReplyMarkup: async (payload) => {
        edits.push({ ...payload, kind: "markup" });
        return true;
      },
    },
    makeStopReplyMarkup: () => ({ inline_keyboard: [[{ text: "Stop" }]] }),
    throttleMs: 100,
    now: () => nowMs,
    setTimer: (fn, delay) => {
      scheduled = { fn, dueAt: nowMs + delay };
      return scheduled;
    },
    clearTimer: () => {
      scheduled = null;
    },
  });

  await bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    delta: "Hel",
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "Hel");
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][0].text, "Stop");

  nowMs = 50;
  await bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    delta: "lo",
  });
  assert.equal(edits.length, 0);

  nowMs = 120;
  await bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    delta: "!",
  });
  assert.equal(edits.length, 1);
  assert.equal(edits[0].text, "Hello!");

  await bubble.finalizeAgentMessage({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    message: "Hello!",
  });
  assert.ok(edits.length >= 2);
  const finalizeTextEdit = edits.filter((edit) => edit.text === "Hello!" && edit.kind !== "markup").at(-1);
  assert.deepEqual(finalizeTextEdit.replyMarkup, TELEGRAM_EMPTY_REPLY_MARKUP);
  const markupClear = edits.find((edit) => edit.kind === "markup");
  assert.deepEqual(markupClear.replyMarkup, TELEGRAM_EMPTY_REPLY_MARKUP);
  assert.equal(bubble.isStreaming("42", "turn-1"), false);
});

test("streaming bubble defers finalize until agent message after early turn completed", async () => {
  const messages = [];
  const edits = [];
  let releaseSend;
  const sendGate = new Promise((resolve) => {
    releaseSend = resolve;
  });
  const bubble = createTelegramStreamingBubble({
    botClient: {
      sendMessage: async ({ text, replyMarkup }) => {
        await sendGate;
        messages.push({ text, replyMarkup });
        return { message_id: 7 };
      },
      editMessageText: async (payload) => {
        edits.push(payload);
        return true;
      },
      editMessageReplyMarkup: async (payload) => {
        edits.push({ ...payload, kind: "markup" });
        return true;
      },
    },
    makeStopReplyMarkup: () => ({ inline_keyboard: [[{ text: "Stop" }]] }),
    throttleMs: 0,
    now: () => 0,
    setTimer: (fn) => {
      fn();
      return null;
    },
    clearTimer: () => {},
  });

  const firstDelta = bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    delta: "He",
  });
  await bubble.markTurnCompleted({ chatId: "42", turnId: "turn-1" });
  releaseSend();
  await firstDelta;
  assert.equal(messages.length, 1);

  await bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    fullText: "Hello there",
    finalizeTurn: true,
  });

  assert.equal(messages.length, 1);
  const finalTextEdit = edits.filter((edit) => edit.kind !== "markup").at(-1);
  assert.equal(finalTextEdit.text, "Hello there");
  assert.deepEqual(finalTextEdit.replyMarkup, TELEGRAM_EMPTY_REPLY_MARKUP);
  assert.equal(bubble.isStreaming("42", "turn-1"), false);
});

test("streaming bubble clears stop markup on turn completed", async () => {
  const edits = [];
  const bubble = createTelegramStreamingBubble({
    botClient: {
      sendMessage: async () => ({ message_id: 5 }),
      editMessageText: async (payload) => {
        edits.push(payload);
        return true;
      },
      editMessageReplyMarkup: async (payload) => {
        edits.push({ ...payload, kind: "markup" });
        return true;
      },
    },
    makeStopReplyMarkup: () => ({ inline_keyboard: [[{ text: "Stop" }]] }),
    throttleMs: 0,
    now: () => 0,
    setTimer: (fn) => {
      fn();
      return null;
    },
    clearTimer: () => {},
  });

  await bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    delta: "Done",
  });
  edits.length = 0;

  await bubble.handleTurnCompleted({ chatId: "42", turnId: "turn-1" });

  assert.ok(edits.some((edit) => edit.kind === "markup"));
  assert.ok(edits.every((edit) => (
    edit.kind !== "markup" || deepEqualReplyMarkup(edit.replyMarkup, TELEGRAM_EMPTY_REPLY_MARKUP)
  )));
  assert.equal(bubble.isStreaming("42", "turn-1"), false);
});

function deepEqualReplyMarkup(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

test("streaming bubble ignores message-not-modified edit failures", async () => {
  const bubble = createTelegramStreamingBubble({
    botClient: {
      sendMessage: async () => ({ message_id: 3 }),
      editMessageText: async () => {
        throw new Error("Telegram Bot API editMessageText failed: Bad Request: MESSAGE_NOT_MODIFIED");
      },
      editMessageReplyMarkup: async () => true,
    },
    throttleMs: 0,
    now: () => 0,
    setTimer: (fn) => {
      fn();
      return null;
    },
    clearTimer: () => {},
  });

  await bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    delta: "Hi",
  });
  await assert.doesNotReject(() => bubble.finalizeAgentMessage({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    message: "Hi",
  }));
});

test("parseTelegramStreamingDelta reads legacy codex envelope payloads", () => {
  const delta = parseTelegramStreamingDelta(JSON.stringify({
    method: "codex/event/agent_message_content_delta",
    params: {
      conversationId: "thread-1",
      id: "turn-1",
      msg: {
        type: "agent_message_content_delta",
        message_id: "message-1",
        delta: "Hey",
      },
    },
  }), {
    readThreadId: (params) => params.conversationId || params.threadId,
    readTurnId: (params) => params.id || params.turnId,
    normalizeMethod: (method) => String(method || "").trim(),
  });

  assert.deepEqual(delta, {
    method: "codex/event/agent_message_content_delta",
    params: {
      conversationId: "thread-1",
      id: "turn-1",
      msg: {
        type: "agent_message_content_delta",
        message_id: "message-1",
        delta: "Hey",
      },
    },
    threadId: "thread-1",
    turnId: "turn-1",
    delta: "Hey",
    itemId: "",
  });
});

test("streaming bubble coalesces concurrent first deltas into one sendMessage", async () => {
  const messages = [];
  const edits = [];
  let resolveSend;
  const sendGate = new Promise((resolve) => {
    resolveSend = resolve;
  });
  const bubble = createTelegramStreamingBubble({
    botClient: {
      sendMessage: async ({ text }) => {
        await sendGate;
        messages.push(text);
        return { message_id: 1 };
      },
      editMessageText: async (payload) => {
        edits.push(payload);
        return true;
      },
      editMessageReplyMarkup: async () => true,
    },
    throttleMs: 0,
    now: () => 0,
    setTimer: (fn) => {
      fn();
      return null;
    },
    clearTimer: () => {},
  });

  const first = bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    delta: "He",
  });
  const second = bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    delta: "y",
  });
  resolveSend();
  await Promise.all([first, second]);
  assert.equal(messages.length, 1);
  assert.ok(edits.some((edit) => edit.text === "Hey"));
});

test("parseTelegramStreamingDelta reads rollout-style delta payloads", () => {
  const delta = parseTelegramStreamingDelta(JSON.stringify({
    method: "codex/event/agent_message_content_delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      delta: "partial",
    },
  }), {
    readThreadId: (params) => params.threadId,
    readTurnId: (params) => params.turnId,
    normalizeMethod: (method) => String(method || "").trim(),
  });

  assert.deepEqual(delta, {
    method: "codex/event/agent_message_content_delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      delta: "partial",
    },
    threadId: "thread-1",
    turnId: "turn-1",
    delta: "partial",
    itemId: "",
  });
});

test("streaming bubble uses placeholder text before first delta arrives", async () => {
  const messages = [];
  const bubble = createTelegramStreamingBubble({
    botClient: {
      sendMessage: async ({ text }) => {
        messages.push(text);
        return { message_id: 1 };
      },
      editMessageText: async () => true,
      editMessageReplyMarkup: async () => true,
    },
    throttleMs: 0,
    now: () => 0,
    setTimer: (fn) => {
      fn();
      return null;
    },
    clearTimer: () => {},
  });

  await bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    delta: "x",
  });
  assert.equal(messages[0], "x");
  assert.notEqual(STREAMING_PLACEHOLDER, messages[0]);
});

test("streaming bubble ignores late throttled edits after turn completed", async () => {
  const edits = [];
  let scheduledFn;
  const bubble = createTelegramStreamingBubble({
    botClient: {
      sendMessage: async () => ({ message_id: 9 }),
      editMessageText: async (payload) => {
        edits.push(payload);
        return true;
      },
      editMessageReplyMarkup: async (payload) => {
        edits.push({ ...payload, kind: "markup" });
        return true;
      },
    },
    makeStopReplyMarkup: () => ({ inline_keyboard: [[{ text: "Stop" }]] }),
    throttleMs: 100,
    now: () => 0,
    setTimer: (fn) => {
      scheduledFn = fn;
      return {};
    },
    clearTimer: () => {},
  });

  await bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    delta: "Late",
  });
  assert.equal(typeof scheduledFn, "function");

  await bubble.handleTurnCompleted({ chatId: "42", turnId: "turn-1" });
  await scheduledFn();

  assert.ok(edits.every((edit) => (
    edit.kind === "markup"
    || !edit.replyMarkup
    || deepEqualReplyMarkup(edit.replyMarkup, TELEGRAM_EMPTY_REPLY_MARKUP)
  )));
});

test("streaming bubble resolves active turn key on turn completed", async () => {
  const edits = [];
  const bubble = createTelegramStreamingBubble({
    botClient: {
      sendMessage: async () => ({ message_id: 12 }),
      editMessageText: async (payload) => {
        edits.push(payload);
        return true;
      },
      editMessageReplyMarkup: async (payload) => {
        edits.push({ ...payload, kind: "markup" });
        return true;
      },
    },
    makeStopReplyMarkup: () => ({ inline_keyboard: [[{ text: "Stop" }]] }),
    throttleMs: 0,
    now: () => 0,
    setTimer: (fn) => {
      fn();
      return null;
    },
    clearTimer: () => {},
  });

  await bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    delta: "Done",
  });
  edits.length = 0;

  await bubble.handleTurnCompleted({ chatId: "42", turnId: "turn-1" });

  assert.ok(edits.some((edit) => edit.kind === "markup"));
  assert.equal(bubble.isStreaming("42", ""), false);
});

test("streaming bubble finalizes prior turn bubble when a new turn starts", async () => {
  const edits = [];
  const bubble = createTelegramStreamingBubble({
    botClient: {
      sendMessage: async () => ({ message_id: 1 }),
      editMessageText: async (payload) => {
        edits.push(payload);
        return true;
      },
      editMessageReplyMarkup: async (payload) => {
        edits.push({ ...payload, kind: "markup" });
        return true;
      },
    },
    makeStopReplyMarkup: () => ({ inline_keyboard: [[{ text: "Stop" }]] }),
    throttleMs: 0,
    now: () => 0,
    setTimer: (fn) => {
      fn();
      return null;
    },
    clearTimer: () => {},
  });

  await bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    delta: "First",
  });
  edits.length = 0;

  await bubble.handleTurnStarted({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-2",
  });

  assert.ok(edits.some((edit) => edit.kind === "markup"));
  assert.equal(bubble.isStreaming("42", "turn-1"), false);
  assert.equal(bubble.isLiveTurn("42", "turn-2"), true);
  assert.equal(bubble.isStreaming("42", "turn-2"), false);
});

test("streaming bubble migrates active-key bubble when turn id arrives", async () => {
  const messages = [];
  const bubble = createTelegramStreamingBubble({
    botClient: {
      sendMessage: async ({ text }) => {
        messages.push(text);
        return { message_id: 7 };
      },
      editMessageText: async () => true,
      editMessageReplyMarkup: async () => true,
    },
    throttleMs: 0,
    now: () => 0,
    setTimer: (fn) => {
      fn();
      return null;
    },
    clearTimer: () => {},
  });

  await bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    delta: "Early",
  });
  assert.equal(messages.length, 1);

  await bubble.handleTurnStarted({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-2",
  });

  assert.equal(bubble.isStreaming("42", "turn-2"), true);
  assert.equal(bubble.isStreaming("42", ""), false);
});

test("streaming bubble treats turnStarted as live turn for agent snapshots", async () => {
  const bubble = createTelegramStreamingBubble({
    botClient: {
      sendMessage: async () => ({ message_id: 2 }),
      editMessageText: async () => true,
      editMessageReplyMarkup: async () => true,
    },
    throttleMs: 0,
    now: () => 0,
    setTimer: (fn) => {
      fn();
      return null;
    },
    clearTimer: () => {},
  });

  await bubble.handleTurnStarted({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
  });

  assert.equal(bubble.isLiveTurn("42", "turn-1"), true);
  assert.equal(bubble.isStreaming("42", "turn-1"), false);
});

test("streaming bubble logs markup clear failures", async () => {
  const warnings = [];
  const bubble = createTelegramStreamingBubble({
    botClient: {
      sendMessage: async () => ({ message_id: 4 }),
      editMessageText: async () => true,
      editMessageReplyMarkup: async () => {
        throw new Error("Telegram Bot API editMessageReplyMarkup failed: Bad Request: CHAT_NOT_FOUND");
      },
    },
    logger: {
      warn: (message) => warnings.push(message),
    },
    throttleMs: 0,
    now: () => 0,
    setTimer: (fn) => {
      fn();
      return null;
    },
    clearTimer: () => {},
  });

  await bubble.appendDelta({
    chatId: "42",
    threadId: "thread-1",
    turnId: "turn-1",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    delta: "Hi",
  });

  await assert.doesNotReject(
    bubble.handleTurnCompleted({ chatId: "42", turnId: "turn-1" })
  );
  assert.ok(warnings.some((message) => /failed to clear Stop markup/i.test(message)));
});
