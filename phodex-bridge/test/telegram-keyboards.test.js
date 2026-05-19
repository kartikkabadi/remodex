// FILE: telegram-keyboards.test.js
// Purpose: Verifies Telegram keyboard row-limit and pagination invariants.
// Layer: Unit test

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTelegramActionRegistry } = require("../src/telegram-action-registry");
const {
  MAX_KEYBOARD_ROWS,
  MAX_PICKER_ITEMS,
  NAV_BUTTONS,
  createTelegramKeyboards,
} = require("../src/telegram-keyboards");

function createTestKeyboards() {
  return createTelegramKeyboards({
    actionRegistry: createTelegramActionRegistry(),
    telegramAccessModeFor: () => "on-request",
    canLogoutFromAccountStatus: () => false,
  });
}

function rowCount(markup) {
  return markup?.inline_keyboard?.length ?? 0;
}

test("hub keyboards stay within MAX_KEYBOARD_ROWS", () => {
  const keyboards = createTestKeyboards();
  const linkedChat = { activeThreadId: "thread-1" };
  for (const build of [
    (chatId) => keyboards.buildHomeHubReplyMarkup(chatId, linkedChat),
    (chatId) => keyboards.buildChatHubReplyMarkup(chatId, linkedChat),
    (chatId) => keyboards.buildThreadsHubReplyMarkup(chatId, linkedChat),
    (chatId) => keyboards.buildGitHubReplyMarkup(chatId, linkedChat),
    (chatId) => keyboards.buildSettingsHubReplyMarkup(chatId),
    (chatId) => keyboards.buildAdvancedMacHubReplyMarkup(chatId, linkedChat),
  ]) {
    assert.ok(rowCount(build("chat-1")) <= MAX_KEYBOARD_ROWS);
  }
});

test("thread picker paginates five items per page", () => {
  const keyboards = createTestKeyboards();
  const threads = Array.from({ length: 12 }, (_, index) => ({
    id: `thread-${index}`,
    title: `Thread ${index}`,
  }));
  const page0 = keyboards.buildThreadChoiceReplyMarkup("chat-1", threads, { page: 0 });
  const page1 = keyboards.buildThreadChoiceReplyMarkup("chat-1", threads, { page: 1 });
  assert.equal(page0.inline_keyboard.filter((row) => row[0]?.text?.includes("Thread")).length, MAX_PICKER_ITEMS);
  assert.equal(page1.inline_keyboard.filter((row) => row[0]?.text?.includes("Thread")).length, MAX_PICKER_ITEMS);
  assert.match(page1.inline_keyboard.at(-1)[0].text, /Prev/);
});

test("model summary keyboard uses compact sections", () => {
  const keyboards = createTestKeyboards();
  const markup = keyboards.buildModelReplyMarkup("chat-1", {}, { section: "summary" });
  assert.ok(rowCount(markup) <= MAX_KEYBOARD_ROWS);
  assert.match(markup.inline_keyboard[0][0].text, /Pick Model/);
});

test("NAV_BUTTONS reference menu and status commands", () => {
  assert.equal(NAV_BUTTONS.menu, "command.menu");
  assert.equal(NAV_BUTTONS.status, "command.status");
});
