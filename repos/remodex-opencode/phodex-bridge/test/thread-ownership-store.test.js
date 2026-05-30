// FILE: thread-ownership-store.test.js
// Purpose: Verifies durable thread→provider ownership persistence and CRUD operations.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, fs, os, ../src/thread-ownership-store

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createThreadOwnershipStore } = require("../src/thread-ownership-store");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "remodex-ownership-"));
}

function makeStore(tempDir) {
  return createThreadOwnershipStore({
    storagePath: path.join(tempDir, "thread-ownership.json"),
    fsImpl: fs,
  });
}

test("set and get thread ownership", () => {
  const tempDir = makeTempDir();
  try {
    const store = makeStore(tempDir);
    assert.equal(store.getOwnership("thread-1"), null);

    store.setOwnership("thread-1", "opencode");
    assert.equal(store.getOwnership("thread-1"), "opencode");
    assert.equal(store.ownsThread("thread-1", "opencode"), true);
    assert.equal(store.ownsThread("thread-1", "codex"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test("overwrite ownership changes provider", () => {
  const tempDir = makeTempDir();
  try {
    const store = makeStore(tempDir);
    store.setOwnership("thread-1", "codex");
    assert.equal(store.getOwnership("thread-1"), "codex");

    store.setOwnership("thread-1", "opencode");
    assert.equal(store.getOwnership("thread-1"), "opencode");
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test("remove ownership", () => {
  const tempDir = makeTempDir();
  try {
    const store = makeStore(tempDir);
    store.setOwnership("thread-1", "opencode");
    store.removeOwnership("thread-1");
    assert.equal(store.getOwnership("thread-1"), null);
    assert.equal(store.size(), 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test("getAllOwnedBy returns threads for a provider", () => {
  const tempDir = makeTempDir();
  try {
    const store = makeStore(tempDir);
    store.setOwnership("thread-1", "opencode");
    store.setOwnership("thread-2", "opencode");
    store.setOwnership("thread-3", "codex");

    const opencodeThreads = store.getAllOwnedBy("opencode");
    assert.equal(opencodeThreads.length, 2);
    assert.equal(opencodeThreads[0].providerId, "opencode");
    assert.equal(opencodeThreads[1].providerId, "opencode");

    const codexThreads = store.getAllOwnedBy("codex");
    assert.equal(codexThreads.length, 1);
    assert.equal(codexThreads[0].threadId, "thread-3");
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test("durable across store instances", () => {
  const tempDir = makeTempDir();
  try {
    const store1 = makeStore(tempDir);
    store1.setOwnership("thread-1", "opencode");

    const store2 = makeStore(tempDir);
    assert.equal(store2.getOwnership("thread-1"), "opencode");
    assert.equal(store2.ownsThread("thread-1", "opencode"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test("size reflects current count", () => {
  const tempDir = makeTempDir();
  try {
    const store = makeStore(tempDir);
    assert.equal(store.size(), 0);

    store.setOwnership("thread-1", "opencode");
    store.setOwnership("thread-2", "codex");
    assert.equal(store.size(), 2);

    store.removeOwnership("thread-1");
    assert.equal(store.size(), 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test("prune removes entries older than stale threshold", () => {
  const tempDir = makeTempDir();
  try {
    const now = Date.now();
    let clock = now;
    const store = createThreadOwnershipStore({
      storagePath: path.join(tempDir, "thread-ownership.json"),
      fsImpl: fs,
      nowMs: () => clock,
    });

    store.setOwnership("thread-old", "opencode");
    store.setOwnership("thread-new", "codex");

    clock = now + 100 * 24 * 60 * 60 * 1000;

    store.pruneStaleEntries(30 * 24 * 60 * 60 * 1000);
    assert.equal(store.size(), 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});

test("ignores empty or invalid thread/provider ids", () => {
  const tempDir = makeTempDir();
  try {
    const store = makeStore(tempDir);

    assert.equal(store.setOwnership("", "opencode"), false);
    assert.equal(store.setOwnership("thread-1", ""), false);
    assert.equal(store.setOwnership("", ""), false);
    assert.equal(store.getOwnership(""), null);
    assert.equal(store.getOwnership(null), null);
    assert.equal(store.ownsThread("thread-1", ""), false);
    assert.deepEqual(store.getAllOwnedBy(""), []);
    assert.equal(store.size(), 0);

    assert.equal(store.removeOwnership(""), false);
    assert.equal(store.removeOwnership("nonexistent"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
});
