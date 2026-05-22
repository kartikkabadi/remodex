// FILE: telegram-reply-policy.test.js
// Purpose: Verifies conversation-first Telegram reply markup policy.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/telegram-reply-policy

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveReplyMarkup } = require("../src/telegram-reply-policy");

test("reply policy returns no markup for codex input acks", () => {
  assert.equal(resolveReplyMarkup({
    surface: "codex_input",
    phase: "ack",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    keyboards: { makeActionButton: () => ({ text: "Stop" }) },
  }), undefined);
});

test("reply policy returns stop-only row for running turns", () => {
  const markup = resolveReplyMarkup({
    surface: "running_turn",
    phase: "active",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    event: { threadId: "thread-1" },
    keyboards: {
      makeActionButton: (_chatId, label) => ({ text: label, callback_data: "stop" }),
    },
  });

  assert.deepEqual(markup, {
    inline_keyboard: [[{ text: "Stop", callback_data: "stop" }]],
  });
});

test("reply policy returns no markup for assistant output", () => {
  assert.equal(resolveReplyMarkup({
    surface: "turn_output",
    phase: "assistant",
    linkedChat: { chatId: "42", activeThreadId: "thread-1" },
    keyboards: { makeActionButton: () => ({ text: "Menu" }) },
  }), undefined);
});

test("reply policy delegates control hubs and keeps missing-thread hints", () => {
  const hub = { inline_keyboard: [[{ text: "Menu", callback_data: "menu" }]] };
  assert.deepEqual(resolveReplyMarkup({
    surface: "control",
    phase: "hub",
    linkedChat: { chatId: "42" },
    keyboards: { delegatedReplyMarkup: hub },
  }), hub);

  const missing = { inline_keyboard: [[{ text: "Threads", callback_data: "threads" }]] };
  assert.deepEqual(resolveReplyMarkup({
    surface: "missing_thread",
    linkedChat: { chatId: "42" },
    keyboards: {
      buildMissingThreadReplyMarkup: (chatId) => {
        assert.equal(chatId, "42");
        return missing;
      },
    },
  }), missing);
});
