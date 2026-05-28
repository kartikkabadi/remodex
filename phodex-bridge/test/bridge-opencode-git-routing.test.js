// FILE: bridge-opencode-git-routing.test.js
// Purpose: WT-2 routing — method-level git gate + Codex account forward vs OpenCode refusals.
// Layer: Unit test
// Depends on: node:test, node:assert/strict, ../src/bridge, ../src/opencode-runtime-policy

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  CODEX_BRIDGE_MANAGED_ACCOUNT_METHODS,
  OPENCODE_BRIDGE_MANAGED_ACCOUNT_METHODS,
  isBridgeManagedAccountMethod,
  shouldInvokeGitHandler,
} = require("../src/bridge");
const { lookupOpenCodeAccountRefusal } = require("../src/opencode-runtime-policy");

const BRIDGE_SRC = path.join(__dirname, "..", "src", "bridge.js");

function withProvider(provider, fn) {
  const previous = process.env.REMODEX_PROVIDER;
  if (provider == null) {
    delete process.env.REMODEX_PROVIDER;
  } else {
    process.env.REMODEX_PROVIDER = provider;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.REMODEX_PROVIDER;
    } else {
      process.env.REMODEX_PROVIDER = previous;
    }
  }
}

test("shouldInvokeGitHandler routes git/status under OpenCode", () => {
  withProvider("opencode", () => {
    assert.equal(
      shouldInvokeGitHandler(JSON.stringify({ id: 1, method: "git/status", params: {} })),
      true
    );
  });
});

test("shouldInvokeGitHandler skips thread/name/set under OpenCode (transport)", () => {
  withProvider("opencode", () => {
    assert.equal(
      shouldInvokeGitHandler(JSON.stringify({
        id: 2,
        method: "thread/name/set",
        params: { threadId: "t1", title: "Rename" },
      })),
      false
    );
  });
});

test("shouldInvokeGitHandler keeps thread/name/set on Codex git handler path", () => {
  withProvider("codex", () => {
    assert.equal(
      shouldInvokeGitHandler(JSON.stringify({
        id: 3,
        method: "thread/name/set",
        params: { threadId: "t1", title: "Rename" },
      })),
      true
    );
  });
});

test("Codex mode does not bridge-manage login/logout/rateLimits (forwards to transport)", () => {
  const forwardToCodex = [
    "account/login/start",
    "account/login/cancel",
    "account/login/complete",
    "account/login/openOnMac",
    "account/logout",
    "account/rateLimits/read",
  ];
  for (const method of forwardToCodex) {
    assert.equal(
      isBridgeManagedAccountMethod(method, false),
      false,
      `${method} must fall through to codex.send in Codex mode`
    );
    assert.equal(
      OPENCODE_BRIDGE_MANAGED_ACCOUNT_METHODS.has(method),
      true,
      `${method} stays bridge-managed under OpenCode for refusal/snapshot`
    );
  }
});

test("Codex bridge-managed account methods are status + voice only", () => {
  assert.deepEqual(
    [...CODEX_BRIDGE_MANAGED_ACCOUNT_METHODS].sort(),
    ["account/status/read", "getAuthStatus", "voice/resolveAuth"].sort()
  );
});

test("OpenCode account refusal matrix for login and rate limits", () => {
  const refused = [
    "account/login/start",
    "account/login/cancel",
    "account/login/complete",
    "account/login/openOnMac",
    "account/logout",
    "account/rateLimits/read",
  ];
  for (const method of refused) {
    const refusal = lookupOpenCodeAccountRefusal(method);
    assert.ok(refusal?.errorCode, `${method} must have OpenCode refusal`);
    assert.ok(refusal.message.length > 0);
  }
});

test("bridge.js uses method-level shouldInvokeGitHandler gate", () => {
  const source = fs.readFileSync(BRIDGE_SRC, "utf8");
  assert.ok(
    source.includes("if (shouldInvokeGitHandler(rawMessage)"),
    "git handler must use shouldInvokeGitHandler, not !isOpenCodeRuntimeActive"
  );
  assert.equal(
    /!isOpenCodeRuntimeActive\s*&&\s*handleGitRequest/.test(source),
    false,
    "runtime blanket git gate must be removed"
  );
});
