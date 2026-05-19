// FILE: telegram-action-registry.test.js
// Purpose: Verifies opaque Telegram callback action registry behavior.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/telegram-action-registry

const test = require("node:test");
const assert = require("node:assert/strict");

const { createTelegramActionRegistry } = require("../src/telegram-action-registry");

test("telegram action registry creates opaque short callback ids", () => {
  const registry = createTelegramActionRegistry({
    now: () => 1_800_000_000_000,
    randomBytesImpl() {
      return Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    },
  });

  const callbackData = registry.createAction({
    chatId: "42",
    type: "approval.accept",
    payload: { requestId: "approval-1", command: "npm test" },
  });

  assert.match(callbackData, /^a:[A-Z2-9]{10}$/);
  assert.ok(Buffer.byteLength(callbackData, "utf8") <= 64);
  assert.doesNotMatch(callbackData, /approval-1|npm/);
});

test("telegram action registry enforces chat id, expiry, and single use", () => {
  const registry = createTelegramActionRegistry({
    now: () => 1_800_000_000_000,
    randomBytesImpl() {
      return Buffer.from([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    },
  });

  const callbackData = registry.createAction({
    chatId: "42",
    type: "approval.reject",
    payload: { requestId: "approval-2" },
    ttlMs: 1_000,
  });

  assert.throws(() => registry.consumeAction(callbackData, { chatId: "99", now: () => 1_800_000_000_500 }), /not allowed/);
  assert.throws(() => registry.consumeAction(callbackData, { chatId: "42", now: () => 1_800_000_002_000 }), /expired/);

  const fresh = registry.createAction({
    chatId: "42",
    type: "approval.reject",
    payload: { requestId: "approval-3" },
  });
  assert.deepEqual(registry.consumeAction(fresh, { chatId: "42", now: () => 1_800_000_000_500 }), {
    type: "approval.reject",
    payload: { requestId: "approval-3" },
  });
  assert.throws(() => registry.consumeAction(fresh, { chatId: "42", now: () => 1_800_000_000_600 }), /already used/);
});

test("telegram action registry allows explicitly reusable actions until expiry", () => {
  const registry = createTelegramActionRegistry({
    now: () => 1_800_000_000_000,
    randomBytesImpl() {
      return Buffer.from([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    },
  });

  const callbackData = registry.createAction({
    chatId: "42",
    type: "command.status",
    payload: { source: "menu" },
    singleUse: false,
    ttlMs: 1_000,
  });

  assert.deepEqual(registry.consumeAction(callbackData, { chatId: "42", now: () => 1_800_000_000_100 }), {
    type: "command.status",
    payload: { source: "menu" },
  });
  assert.deepEqual(registry.consumeAction(callbackData, { chatId: "42", now: () => 1_800_000_000_200 }), {
    type: "command.status",
    payload: { source: "menu" },
  });
  assert.throws(() => registry.consumeAction(callbackData, { chatId: "99", now: () => 1_800_000_000_300 }), /not allowed/);
  assert.throws(() => registry.consumeAction(callbackData, { chatId: "42", now: () => 1_800_000_002_000 }), /expired/);
});

test("telegram action registry retries callback id collisions before storing actions", () => {
  const generated = [
    Buffer.alloc(10, 3),
    Buffer.alloc(10, 3),
    Buffer.alloc(10, 4),
  ];
  const registry = createTelegramActionRegistry({
    now: () => 1_800_000_000_000,
    randomBytesImpl() {
      return generated.shift() || Buffer.alloc(10, 5);
    },
  });

  const firstCallbackData = registry.createAction({
    chatId: "42",
    type: "command.status",
    payload: { slot: "first" },
    singleUse: false,
  });
  const secondCallbackData = registry.createAction({
    chatId: "42",
    type: "command.help",
    payload: { slot: "second" },
    singleUse: false,
  });

  assert.notEqual(firstCallbackData, secondCallbackData);
  assert.deepEqual(registry.consumeAction(firstCallbackData, { chatId: "42" }), {
    type: "command.status",
    payload: { slot: "first" },
  });
  assert.deepEqual(registry.consumeAction(secondCallbackData, { chatId: "42" }), {
    type: "command.help",
    payload: { slot: "second" },
  });
});

test("telegram action registry rejects malformed callback id entropy", () => {
  const registry = createTelegramActionRegistry({
    now: () => 1_800_000_000_000,
    randomBytesImpl() {
      return Buffer.alloc(0);
    },
  });

  assert.throws(
    () => registry.createAction({ chatId: "42", type: "command.status" }),
    /entropy source returned too few bytes/
  );
});

test("telegram action registry prunes expired actions when new buttons are created", () => {
  let currentNow = 1_800_000_000_000;
  const registry = createTelegramActionRegistry({
    now: () => currentNow,
    randomBytesImpl: incrementingRandomBytes(),
  });

  const expiredCallbackData = registry.createAction({
    chatId: "42",
    type: "command.status",
    singleUse: false,
    ttlMs: 100,
  });
  currentNow += 200;
  const freshCallbackData = registry.createAction({
    chatId: "42",
    type: "command.help",
    singleUse: false,
  });

  assert.throws(() => registry.consumeAction(expiredCallbackData, { chatId: "42", now: () => currentNow }), /Unknown/);
  assert.deepEqual(registry.consumeAction(freshCallbackData, { chatId: "42", now: () => currentNow }), {
    type: "command.help",
    payload: {},
  });
});

test("telegram action registry bounds retained actions by dropping oldest entries", () => {
  const registry = createTelegramActionRegistry({
    now: () => 1_800_000_000_000,
    randomBytesImpl: incrementingRandomBytes(),
    maxActions: 2,
  });

  const firstCallbackData = registry.createAction({ chatId: "42", type: "command.status", singleUse: false });
  const secondCallbackData = registry.createAction({ chatId: "42", type: "command.help", singleUse: false });
  const thirdCallbackData = registry.createAction({ chatId: "42", type: "command.threads", singleUse: false });

  assert.throws(() => registry.consumeAction(firstCallbackData, { chatId: "42" }), /Unknown/);
  assert.deepEqual(registry.consumeAction(secondCallbackData, { chatId: "42" }), {
    type: "command.help",
    payload: {},
  });
  assert.deepEqual(registry.consumeAction(thirdCallbackData, { chatId: "42" }), {
    type: "command.threads",
    payload: {},
  });
});

function incrementingRandomBytes() {
  let next = 0;
  return function randomBytesImpl(length) {
    next += 1;
    return Buffer.alloc(length, next);
  };
}
