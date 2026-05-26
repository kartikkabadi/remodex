// FILE: t1-8-git-handler-gate.test.js
// Purpose: Verifies bridge.js gates git-handler for OpenCode runtime so
//          thread/name/set routes to opencode-transport's PATCH /session/{id}.
// Layer: Unit test
// Depends on: node:test, node:assert/strict, fs, path, ../src/git-handler, ../src/bridge

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { handleGitRequest } = require("../src/git-handler");
const { isOpenCodeRuntime } = require("../src/opencode-runtime-policy");

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

test("bridge.js gates git-handler behind !isOpenCodeRuntimeActive", () => {
  const source = fs.readFileSync(BRIDGE_SRC, "utf8");

  // The gate must prefix the handleGitRequest call
  const gatePattern = '!isOpenCodeRuntimeActive && handleGitRequest(rawMessage, sendApplicationResponse, {';
  assert.ok(
    source.includes(gatePattern),
    "bridge.js must gate handleGitRequest with !isOpenCodeRuntimeActive &&"
  );

  // Verify the gate is on the actual call site (not just a comment)
  // Line should look like: if (!isOpenCodeRuntimeActive && handleGitRequest(
  const gatedCall = /if\s*\(!isOpenCodeRuntimeActive\s*&&\s*handleGitRequest\(/;
  assert.ok(
    gatedCall.test(source),
    "bridge.js must contain if (!isOpenCodeRuntimeActive && handleGitRequest(..."
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

test("bridge.js has exactly one handleGitRequest call site (the gated one)", () => {
  const source = fs.readFileSync(BRIDGE_SRC, "utf8");

  // Count lines containing handleGitRequest( — the actual invocation
  const callSites = source.match(/handleGitRequest\(/g) || [];
  assert.equal(callSites.length, 1,
    "handleGitRequest should be called exactly once in bridge.js " +
    "(the import uses destructuring, not a call)"
  );
});

test("handleGitRequest is imported at module level in bridge.js", () => {
  const source = fs.readFileSync(BRIDGE_SRC, "utf8");

  // The import pattern at line 41
  const importPattern = 'const { handleGitRequest } = require("./git-handler");';
  assert.ok(
    source.includes(importPattern),
    "bridge.js must import handleGitRequest from git-handler"
  );
});
