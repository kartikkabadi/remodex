// FILE: telegram-session-state.test.js
// Purpose: Verifies local Telegram linked-chat and link-code state persistence.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, fs, os, path, ../src/telegram-session-state

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  clearTelegramActiveThread,
  createTelegramLinkCode,
  linkTelegramChat,
  readTelegramSessionState,
  resolveTelegramSessionStatePath,
  setTelegramActiveThread,
  setTelegramProjectBrowsePath,
  setTelegramRuntimePreferences,
  unlinkTelegramChat,
} = require("../src/telegram-session-state");

test("telegram session state creates short-lived link codes without persisting bot tokens", () => {
  withTempRemodexState(({ rootDir }) => {
    const state = createTelegramLinkCode({
      botToken: "123456:secret-token",
      now: () => 1_800_000_000_000,
      randomBytesImpl() {
        return Buffer.from([0, 1, 2, 3, 4, 5]);
      },
    });

    assert.equal(resolveTelegramSessionStatePath(), path.join(rootDir, "telegram-session.json"));
    assert.match(state.pendingLinkCode.code, /^[A-Z2-9]{6}$/);
    assert.equal(state.pendingLinkCode.expiresAt, 1_800_000_300_000);

    const raw = fs.readFileSync(resolveTelegramSessionStatePath(), "utf8");
    assert.doesNotMatch(raw, /secret-token/);
  });
});

test("telegram session state rejects malformed link-code entropy without writing state", () => {
  withTempRemodexState(() => {
    assert.throws(
      () => createTelegramLinkCode({
        now: () => 1_800_000_000_000,
        randomBytesImpl() {
          return Buffer.alloc(0);
        },
      }),
      /entropy source returned too few bytes/
    );

    assert.deepEqual(readTelegramSessionState(), {
      linkedChats: [],
      pendingLinkCode: null,
    });
    assert.equal(fs.existsSync(resolveTelegramSessionStatePath()), false);
  });
});

test("telegram session state drops malformed persisted link codes", () => {
  withTempRemodexState(() => {
    fs.mkdirSync(path.dirname(resolveTelegramSessionStatePath()), { recursive: true });
    fs.writeFileSync(resolveTelegramSessionStatePath(), JSON.stringify({
      linkedChats: [],
      pendingLinkCode: {
        code: "ABC123X",
        createdAt: 1_800_000_000_000,
        expiresAt: 1_800_000_300_000,
      },
    }));

    assert.deepEqual(readTelegramSessionState(), {
      linkedChats: [],
      pendingLinkCode: null,
    });
  });
});

test("telegram session state links and unlinks an allowed chat by code", () => {
  withTempRemodexState(() => {
    const created = createTelegramLinkCode({
      now: () => 1_800_000_000_000,
      randomBytesImpl() {
        return Buffer.from([1, 1, 1, 1, 1, 1]);
      },
    });

    const linked = linkTelegramChat({
      chatId: 42,
      chatTitle: "Kartik",
      code: created.pendingLinkCode.code.toLowerCase(),
      now: () => 1_800_000_010_000,
    });

    assert.equal(linked.linkedChats.length, 1);
    assert.equal(linked.linkedChats[0].chatId, "42");
    assert.equal(linked.linkedChats[0].chatTitle, "Kartik");
    assert.equal(linked.pendingLinkCode, null);

    const unlinked = unlinkTelegramChat({ chatId: "42" });
    assert.deepEqual(unlinked.linkedChats, []);
  });
});

test("telegram session state preserves linked chat context when relinking", () => {
  withTempRemodexState(() => {
    const firstCode = createTelegramLinkCode({
      now: () => 1_800_000_000_000,
      randomBytesImpl: () => Buffer.from([1, 1, 1, 1, 1, 1]),
    });
    linkTelegramChat({
      chatId: "42",
      chatTitle: "Kartik",
      code: firstCode.pendingLinkCode.code,
      now: () => 1_800_000_001_000,
    });
    setTelegramActiveThread({
      chatId: "42",
      threadId: "thread-1",
      cwd: "/Users/user/Documents/Projects/remodex",
    });
    setTelegramProjectBrowsePath({
      chatId: "42",
      path: "/Users/user/Documents/Projects",
    });
    setTelegramRuntimePreferences({
      chatId: "42",
      model: "gpt-5.4-mini",
      reasoningEffort: "high",
      serviceTier: "fast",
      accessMode: "full",
    });
    const secondCode = createTelegramLinkCode({
      now: () => 1_800_000_010_000,
      randomBytesImpl: () => Buffer.from([2, 2, 2, 2, 2, 2]),
    });

    const relinked = linkTelegramChat({
      chatId: "42",
      chatTitle: "Kartik Remodex",
      code: secondCode.pendingLinkCode.code,
      now: () => 1_800_000_011_000,
    });

    assert.equal(relinked.linkedChats.length, 1);
    assert.equal(relinked.linkedChats[0].chatId, "42");
    assert.equal(relinked.linkedChats[0].chatTitle, "Kartik Remodex");
    assert.equal(relinked.linkedChats[0].linkedAt, 1_800_000_011_000);
    assert.equal(relinked.linkedChats[0].activeThreadId, "thread-1");
    assert.equal(relinked.linkedChats[0].activeThreadCwd, "/Users/user/Documents/Projects/remodex");
    assert.equal(relinked.linkedChats[0].projectBrowsePath, "/Users/user/Documents/Projects");
    assert.equal(relinked.linkedChats[0].runtimeModel, "gpt-5.4-mini");
    assert.equal(relinked.linkedChats[0].reasoningEffort, "high");
    assert.equal(relinked.linkedChats[0].runtimeServiceTier, "fast");
    assert.equal(relinked.linkedChats[0].runtimeAccessMode, "full-access");
    assert.equal(relinked.pendingLinkCode, null);
  });
});

test("telegram session state persists active thread cwd for restart recovery", () => {
  withTempRemodexState(() => {
    const created = createTelegramLinkCode({
      now: () => 1_800_000_000_000,
      randomBytesImpl: () => Buffer.from([1, 2, 3, 4, 5, 6]),
    });
    const linked = linkTelegramChat({
      chatId: "42",
      chatTitle: "Kartik",
      code: created.pendingLinkCode.code,
      now: () => 1_800_000_001_000,
    });
    assert.equal(linked.linkedChats[0].activeThreadCwd, "");

    const selected = setTelegramActiveThread({
      chatId: "42",
      threadId: "thread-1",
      cwd: "/Users/user/Documents/Projects/remodex",
    });

    assert.equal(selected.linkedChats[0].activeThreadId, "thread-1");
    assert.equal(selected.linkedChats[0].activeThreadCwd, "/Users/user/Documents/Projects/remodex");
    assert.equal(readTelegramSessionState().linkedChats[0].activeThreadCwd, "/Users/user/Documents/Projects/remodex");
  });
});

test("telegram session state clears active thread after archive", () => {
  withTempRemodexState(() => {
    const created = createTelegramLinkCode({
      now: () => 1_800_000_000_000,
      randomBytesImpl: () => Buffer.from([1, 2, 3, 4, 5, 6]),
    });
    linkTelegramChat({
      chatId: "42",
      chatTitle: "Kartik",
      code: created.pendingLinkCode.code,
      now: () => 1_800_000_001_000,
    });
    setTelegramActiveThread({
      chatId: "42",
      threadId: "thread-1",
      cwd: "/Users/user/Documents/Projects/remodex",
    });

    const cleared = clearTelegramActiveThread({ chatId: "42" });

    assert.equal(cleared.linkedChats[0].activeThreadId, "");
    assert.equal(cleared.linkedChats[0].activeThreadCwd, "");
    assert.equal(readTelegramSessionState().linkedChats[0].activeThreadId, "");
  });
});

test("telegram session state persists the last browsed project folder per chat", () => {
  withTempRemodexState(() => {
    const created = createTelegramLinkCode({
      now: () => 1_800_000_000_000,
      randomBytesImpl: () => Buffer.from([1, 2, 3, 4, 5, 6]),
    });
    linkTelegramChat({
      chatId: "42",
      chatTitle: "Kartik",
      code: created.pendingLinkCode.code,
      now: () => 1_800_000_001_000,
    });

    const selected = setTelegramProjectBrowsePath({
      chatId: "42",
      path: "/Users/user/Documents/Projects",
    });

    assert.equal(selected.linkedChats[0].projectBrowsePath, "/Users/user/Documents/Projects");
    assert.equal(readTelegramSessionState().linkedChats[0].projectBrowsePath, "/Users/user/Documents/Projects");
  });
});

test("telegram session state persists runtime preferences per linked chat", () => {
  withTempRemodexState(() => {
    const created = createTelegramLinkCode({
      now: () => 1_800_000_000_000,
      randomBytesImpl: () => Buffer.from([1, 2, 3, 4, 5, 6]),
    });
    linkTelegramChat({
      chatId: "42",
      chatTitle: "Kartik",
      code: created.pendingLinkCode.code,
      now: () => 1_800_000_001_000,
    });

    const selected = setTelegramRuntimePreferences({
      chatId: "42",
      model: "gpt-5.4-mini",
      reasoningEffort: "high",
      serviceTier: "fast",
      accessMode: "full",
    });

    assert.equal(selected.linkedChats[0].runtimeModel, "gpt-5.4-mini");
    assert.equal(selected.linkedChats[0].reasoningEffort, "high");
    assert.equal(selected.linkedChats[0].runtimeServiceTier, "fast");
    assert.equal(selected.linkedChats[0].runtimeAccessMode, "full-access");
    assert.equal(readTelegramSessionState().linkedChats[0].runtimeModel, "gpt-5.4-mini");
    assert.equal(readTelegramSessionState().linkedChats[0].reasoningEffort, "high");
    assert.equal(readTelegramSessionState().linkedChats[0].runtimeServiceTier, "fast");
    assert.equal(readTelegramSessionState().linkedChats[0].runtimeAccessMode, "full-access");

    const normal = setTelegramRuntimePreferences({
      chatId: "42",
      serviceTier: "normal",
    });
    assert.equal(normal.linkedChats[0].runtimeServiceTier, "");
  });
});

test("telegram session state rejects expired or mismatched link codes", () => {
  withTempRemodexState(() => {
    const created = createTelegramLinkCode({
      now: () => 1_800_000_000_000,
      randomBytesImpl() {
        return Buffer.from([2, 2, 2, 2, 2, 2]);
      },
    });

    assert.throws(
      () => linkTelegramChat({ chatId: "42", code: "WRONG2", now: () => 1_800_000_001_000 }),
      /Invalid Telegram link code/
    );
    assert.throws(
      () => linkTelegramChat({ chatId: "42", code: created.pendingLinkCode.code, now: () => 1_800_000_400_000 }),
      /expired/
    );
  });
});

test("telegram session state rejects malformed link codes without consuming the pending code", () => {
  withTempRemodexState(() => {
    const created = createTelegramLinkCode({
      now: () => 1_800_000_000_000,
      randomBytesImpl() {
        return Buffer.from([2, 2, 2, 2, 2, 2]);
      },
    });

    assert.throws(
      () => linkTelegramChat({ chatId: "42", code: "ABC123X", now: () => 1_800_000_001_000 }),
      /Invalid Telegram link code/
    );
    assert.equal(readTelegramSessionState().pendingLinkCode.code, created.pendingLinkCode.code);
  });
});

function withTempRemodexState(callback) {
  const previous = process.env.REMODEX_DEVICE_STATE_DIR;
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-telegram-state-"));
  process.env.REMODEX_DEVICE_STATE_DIR = rootDir;
  try {
    callback({ rootDir });
  } finally {
    if (previous === undefined) {
      delete process.env.REMODEX_DEVICE_STATE_DIR;
    } else {
      process.env.REMODEX_DEVICE_STATE_DIR = previous;
    }
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}
