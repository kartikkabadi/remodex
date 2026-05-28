// FILE: t1-8-git-handler-gate.test.js
// Purpose: Verifies bridge.js method-level git gate (WT-2): OpenCode git/* local;
//          thread/name/set → transport; Codex keeps local rename via git-handler.
// Layer: Unit test
// Depends on: node:test, node:assert/strict, fs, path, ../src/git-handler, ../src/bridge

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { handleGitRequest } = require("../src/git-handler");
const { isOpenCodeRuntime } = require("../src/opencode-runtime-policy");
const { shouldInvokeGitHandler } = require("../src/bridge");

const BRIDGE_SRC = path.join(__dirname, "..", "src", "bridge.js");

test("git-handler intercepts thread/name/set when called directly (Codex behavior)", () => {
  const handled = handleGitRequest(
    JSON.stringify({
      id: "rename-1",
      method: "thread/name/set",
      params: { threadId: "thread-1", title: "Polish loading states" },
    }),
    () => {},
    { onThreadNameSet: () => {} }
  );

  assert.equal(handled, true,
    "handleGitRequest must return true for thread/name/set in Codex mode"
  );
});

test("shouldInvokeGitHandler excludes thread/name/set under OpenCode", () => {
  const previous = process.env.REMODEX_PROVIDER;
  process.env.REMODEX_PROVIDER = "opencode";
  try {
    assert.equal(
      shouldInvokeGitHandler(JSON.stringify({
        id: "rename-oc",
        method: "thread/name/set",
        params: { threadId: "thread-1", title: "Via transport" },
      })),
      false
    );
    assert.equal(
      shouldInvokeGitHandler(JSON.stringify({ id: "git-1", method: "git/status", params: {} })),
      true
    );
  } finally {
    if (previous === undefined) {
      delete process.env.REMODEX_PROVIDER;
    } else {
      process.env.REMODEX_PROVIDER = previous;
    }
  }
});

test("bridge.js gates git-handler with shouldInvokeGitHandler", () => {
  const source = fs.readFileSync(BRIDGE_SRC, "utf8");

  assert.ok(
    source.includes("if (shouldInvokeGitHandler(rawMessage)"),
    "bridge.js must gate handleGitRequest with shouldInvokeGitHandler"
  );

  assert.equal(
    /if\s*\(!isOpenCodeRuntimeActive\s*&&\s*handleGitRequest\(/.test(source),
    false,
    "runtime blanket !isOpenCodeRuntimeActive git gate must be removed (WT-2)"
  );
});

test("isOpenCodeRuntime gates correctly per provider env var", () => {
  assert.equal(isOpenCodeRuntime({ REMODEX_PROVIDER: "opencode" }), true,
    "REMODEX_PROVIDER=opencode must activate OpenCode runtime"
  );
  assert.equal(isOpenCodeRuntime({ REMODEX_PROVIDER: "codex" }), false,
    "REMODEX_PROVIDER=codex must NOT activate OpenCode runtime"
  );
  assert.equal(isOpenCodeRuntime({}), false,
    "missing REMODEX_PROVIDER must default to Codex (not OpenCode)"
  );
});

test("bridge.js has exactly one handleGitRequest call site", () => {
  const source = fs.readFileSync(BRIDGE_SRC, "utf8");

  const callSites = source.match(/handleGitRequest\(/g) || [];
  assert.equal(callSites.length, 1,
    "handleGitRequest should be called exactly once in bridge.js"
  );
});

test("handleGitRequest is imported at module level in bridge.js", () => {
  const source = fs.readFileSync(BRIDGE_SRC, "utf8");

  const importPattern = 'const { handleGitRequest } = require("./git-handler");';
  assert.ok(
    source.includes(importPattern),
    "bridge.js must import handleGitRequest from git-handler"
  );
});
