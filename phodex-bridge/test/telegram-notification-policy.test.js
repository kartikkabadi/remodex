// FILE: telegram-notification-policy.test.js
// Purpose: Verifies turn notification budget rules for Telegram.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/telegram-notification-policy

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  decideThreadNotification,
  formatAgentMessageText,
} = require("../src/telegram-notification-policy");

test("notification policy suppresses implicit codex input acks", () => {
  assert.deepEqual(decideThreadNotification({ implicitCodexInput: true }), {
    suppress: true,
    text: "",
    markupSurface: "",
    mergeWithStreamingBubble: false,
    showTyping: false,
    finalizeStreaming: false,
    deferStreamingFinalize: false,
  });
});

test("notification policy replaces turn started with typing", () => {
  assert.deepEqual(decideThreadNotification({
    method: "turn/started",
    params: { threadId: "thread-1" },
  }), {
    suppress: true,
    text: "",
    markupSurface: "running_turn",
    mergeWithStreamingBubble: false,
    showTyping: true,
    finalizeStreaming: false,
    deferStreamingFinalize: false,
  });
});

test("notification policy sends plain assistant text without post-turn keyboard surface", () => {
  assert.deepEqual(decideThreadNotification({
    method: "codex/event/agent_message",
    params: { message: "Ready from Telegram." },
  }), {
    suppress: false,
    text: "Ready from Telegram.",
    markupSurface: "turn_output",
    mergeWithStreamingBubble: false,
    showTyping: false,
    finalizeStreaming: false,
    deferStreamingFinalize: false,
  });
});

test("notification policy merges final agent messages into an active stream bubble", () => {
  assert.deepEqual(decideThreadNotification({
    method: "codex/event/agent_message",
    params: { message: "Done." },
    streamingActive: true,
  }), {
    suppress: true,
    text: "Done.",
    markupSurface: "turn_output",
    mergeWithStreamingBubble: true,
    showTyping: false,
    finalizeStreaming: false,
    deferStreamingFinalize: false,
  });
});

test("notification policy defers turn completed finalize until agent message lands", () => {
  assert.deepEqual(decideThreadNotification({
    method: "turn/completed",
    params: { threadId: "thread-1", turnId: "turn-1" },
    renderedText: "Remodex finished the active turn.",
    streamingActive: true,
  }), {
    suppress: true,
    text: "",
    markupSurface: "",
    mergeWithStreamingBubble: false,
    showTyping: false,
    finalizeStreaming: false,
    deferStreamingFinalize: true,
  });
});

test("notification policy suppresses turn completed banner when stream is inactive", () => {
  assert.deepEqual(decideThreadNotification({
    method: "turn/completed",
    params: { threadId: "thread-1", turnId: "turn-1" },
    renderedText: "Remodex finished the active turn.",
    streamingActive: false,
  }), {
    suppress: true,
    text: "",
    markupSurface: "",
    mergeWithStreamingBubble: false,
    showTyping: false,
    finalizeStreaming: true,
    deferStreamingFinalize: false,
  });
});

test("formatAgentMessageText strips assistant prefix expectations and truncates", () => {
  assert.equal(formatAgentMessageText({ message: "Hello" }), "Hello");
  assert.equal(formatAgentMessageText({ text: "  trimmed  " }), "trimmed");
  assert.equal(formatAgentMessageText({ message: "" }), "");
});
