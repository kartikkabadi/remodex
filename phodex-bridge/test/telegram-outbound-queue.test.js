// FILE: telegram-outbound-queue.test.js
// Purpose: Verifies per-chat Telegram outbound pacing and retry_after handling.
// Layer: Unit Test

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createTelegramOutboundQueue,
  wrapTelegramBotClientWithOutboundQueue,
} = require("../src/telegram-outbound-queue");

test("telegram outbound queue enforces per-chat spacing", async () => {
  const timestamps = [];
  const queue = createTelegramOutboundQueue({
    minIntervalMs: 40,
    now: () => Date.now(),
    sleep: async (ms) => {
      timestamps.push(ms);
    },
  });

  await Promise.all([
    queue.enqueue("42", async () => "first"),
    queue.enqueue("42", async () => "second"),
  ]);

  assert.equal(timestamps.length, 1);
  assert.ok(timestamps[0] >= 35);
});

test("telegram outbound queue retries after retry_after", async () => {
  let attempts = 0;
  const queue = createTelegramOutboundQueue({
    minIntervalMs: 0,
    sleep: async () => {},
  });

  const result = await queue.enqueue("42", async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("Too Many Requests");
      error.retryAfterSeconds = 0.01;
      throw error;
    }
    return "ok";
  });

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});

test("wrapTelegramBotClientWithOutboundQueue queues send and edit methods", async () => {
  const calls = [];
  const queue = createTelegramOutboundQueue({ minIntervalMs: 0, sleep: async () => {} });
  const client = wrapTelegramBotClientWithOutboundQueue({
    sendMessage: async (args) => {
      calls.push(["sendMessage", args.chatId, args.text]);
      return { message_id: calls.length };
    },
    editMessageText: async (args) => {
      calls.push(["editMessageText", args.chatId, args.text]);
      return true;
    },
    sendChatAction: async (args) => {
      calls.push(["sendChatAction", args.chatId, args.action]);
      return true;
    },
  }, queue);

  await client.sendMessage({ chatId: "42", text: "one" });
  await client.editMessageText({ chatId: "42", messageId: 1, text: "two" });
  await client.sendChatAction({ chatId: "42", action: "typing" });

  assert.deepEqual(calls, [
    ["sendMessage", "42", "one"],
    ["editMessageText", "42", "two"],
    ["sendChatAction", "42", "typing"],
  ]);
});
