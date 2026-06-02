// FILE: json-file-store.test.js
// Purpose: Verifies atomic JSON file persistence: read, write, durability, and edge cases.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/json-file-store

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { createJsonFileStore } = require("../src/json-file-store");

function fakeFs() {
  const files = new Map();
  return {
    readFileSync(p) {
      if (files.has(p)) return files.get(p);
      throw new Error("ENOENT");
    },
    writeFileSync(p, data) {
      files.set(p, data);
    },
    renameSync(oldP, newP) {
      if (files.has(oldP)) {
        files.set(newP, files.get(oldP));
        files.delete(oldP);
      }
    },
    mkdirSync() {},
  };
}

test("read returns empty object when file does not exist", () => {
  const store = createJsonFileStore({
    filePath: "/tmp/nonexistent.json",
    key: "test",
    fsImpl: fakeFs(),
  });
  assert.deepEqual(store.read(), {});
});

test("write and read round-trip", () => {
  const fs = fakeFs();
  const store = createJsonFileStore({
    filePath: "/tmp/roundtrip.json",
    key: "data",
    fsImpl: fs,
  });

  store.write({ a: 1, b: 2 });
  assert.deepEqual(store.read(), { a: 1, b: 2 });
});

test("durable across store instances", () => {
  const fs = fakeFs();
  const store1 = createJsonFileStore({
    filePath: "/tmp/durable.json",
    key: "entries",
    fsImpl: fs,
  });
  store1.write({ thread1: "ses_abc" });

  const store2 = createJsonFileStore({
    filePath: "/tmp/durable.json",
    key: "entries",
    fsImpl: fs,
  });
  assert.deepEqual(store2.read(), { thread1: "ses_abc" });
});

test("write overwrites previous state completely", () => {
  const fs = fakeFs();
  const store = createJsonFileStore({
    filePath: "/tmp/overwrite.json",
    key: "data",
    fsImpl: fs,
  });

  store.write({ old: true });
  store.write({ new: true });
  assert.deepEqual(store.read(), { new: true });
});

test("read returns empty object for malformed JSON", () => {
  const fs = fakeFs();
  fs.writeFileSync("/tmp/malformed.json", "not json");
  const store = createJsonFileStore({
    filePath: "/tmp/malformed.json",
    key: "data",
    fsImpl: fs,
  });
  assert.deepEqual(store.read(), {});
});

test("read returns empty object for array root", () => {
  const fs = fakeFs();
  fs.writeFileSync("/tmp/array.json", JSON.stringify([]));
  const store = createJsonFileStore({
    filePath: "/tmp/array.json",
    key: "data",
    fsImpl: fs,
  });
  assert.deepEqual(store.read(), {});
});

test("write normalizes non-object value to empty object", () => {
  const fs = fakeFs();
  const store = createJsonFileStore({
    filePath: "/tmp/normalize.json",
    key: "data",
    fsImpl: fs,
  });

  store.write("not an object");
  assert.deepEqual(store.read(), {});
});

test("write normalizes array to empty object", () => {
  const fs = fakeFs();
  const store = createJsonFileStore({
    filePath: "/tmp/array-write.json",
    key: "data",
    fsImpl: fs,
  });

  store.write([1, 2, 3]);
  assert.deepEqual(store.read(), {});
});

test("isolation: different files don't interfere", () => {
  const fs = fakeFs();
  const storeA = createJsonFileStore({
    filePath: "/tmp/ownership.json",
    key: "ownership",
    fsImpl: fs,
  });
  const storeB = createJsonFileStore({
    filePath: "/tmp/sessions.json",
    key: "sessions",
    fsImpl: fs,
  });

  storeA.write({ t1: "codex" });
  storeB.write({ t2: "ses_xyz" });

  assert.deepEqual(storeA.read(), { t1: "codex" });
  assert.deepEqual(storeB.read(), { t2: "ses_xyz" });
});

test("resolvePath returns the resolved path", () => {
  const store = createJsonFileStore({
    filePath: "/tmp/resolve-test.json",
    key: "data",
    fsImpl: fakeFs(),
  });
  assert.equal(store.resolvePath(), "/tmp/resolve-test.json");
});

test("default path uses homeDir and defaultFileName", () => {
  const store = createJsonFileStore({
    homeDir: "/home/user",
    defaultFileName: "custom-store.json",
    key: "data",
    fsImpl: fakeFs(),
  });
  assert.equal(store.resolvePath(), "/home/user/.remodex/custom-store.json");
});
