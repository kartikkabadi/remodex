// FILE: agent-runtime-registry.test.js
// Purpose: Verifies agent runtime registry routing, initialize payloads, and thread projection.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, fs, os, path, ../src/agent-runtime-registry, ../src/thread-agent-state

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAgentRuntimeRegistry } = require("../src/agent-runtime-registry");
const { createThreadAgentStateStore } = require("../src/thread-agent-state");

test("agent runtime registry returns codex ready and cursor not_installed", async () => {
  await withTempStateDir(async ({ registry }) => {
    const runtimes = await registry.listAgentRuntimes();
    assert.equal(runtimes[0].id, "codex");
    assert.equal(runtimes[0].status, "ready");
    assert.equal(runtimes[2].id, "cursor");
    assert.equal(runtimes[2].status, "not_installed");
  });
});

test("agent runtime registry reports opencode not_installed when binary is missing", async () => {
  await withTempStateDir(async ({ registry }) => {
    const openCode = await registry.resolveOpenCodeStatus({
      forceRefresh: true,
    });
    assert.equal(openCode.id, "opencode");
    assert.equal(openCode.status, "not_installed");
  }, {
    execFileImpl: async () => {
      const error = new Error("ENOENT");
      error.code = "ENOENT";
      throw error;
    },
  });
});

test("agent runtime registry survives opencode probe failures without throwing", async () => {
  await withTempStateDir(async ({ registry }) => {
    const openCode = await registry.resolveOpenCodeStatus({
      forceRefresh: true,
    });
    assert.equal(openCode.id, "opencode");
    assert.equal(openCode.status, "error");
  }, {
    execFileImpl: async () => {
      throw new Error("probe failed");
    },
  });
});

test("warm initialize payload includes bridge-managed runtime list", async () => {
  await withTempStateDir(async ({ registry }) => {
    await registry.refreshInitializeCache();
    const payload = registry.buildWarmInitializeResult();
    assert.equal(payload.bridgeManaged, true);
    assert.equal(payload.defaultAgentRuntime, "codex");
    assert.equal(Array.isArray(payload.agentRuntimes), true);
    assert.equal(payload.agentRuntimes.length, 3);
  }, {
    execFileImpl: missingCommandExecFile,
  });
});

test("agent/runtime/list responds with runtime inventory", async () => {
  await withTempStateDir(async ({ registry }) => {
    await registry.refreshInitializeCache();
    const responses = [];
    const handled = await registry.handleInboundRequest(JSON.stringify({
      id: "runtime-list-1",
      method: "agent/runtime/list",
      params: {},
    }), (rawMessage) => {
      responses.push(JSON.parse(rawMessage));
    });

    assert.equal(handled, true);
    assert.equal(responses.length, 1);
    assert.equal(responses[0].result.defaultAgentRuntime, "codex");
    assert.equal(responses[0].result.agentRuntimes.length, 3);
  }, {
    execFileImpl: missingCommandExecFile,
  });
});

test("thread/list projection injects bridge runtime fields and backfills legacy codex threads", async () => {
  await withTempStateDir(async ({ registry }) => {
    const enriched = registry.enrichOutboundResponse(JSON.stringify({
      id: "thread-list-1",
      result: {
        data: [{ id: "thread-legacy", title: "Legacy thread" }],
      },
    }), { method: "thread/list" });

    const parsed = JSON.parse(enriched);
    assert.equal(parsed.result.data[0].agentRuntime, "codex");
    assert.equal(parsed.result.data[0].agentSessionId, "thread-legacy");
    assert.equal(parsed.result.data[0].opencodeBuildAgentName, "build");
    assert.equal(parsed.result.data[0].opencodePlanAgentName, "plan");
  });
});

test("thread/start locks runtime after successful codex response", async () => {
  await withTempStateDir(async ({ registry, stateDir }) => {
    const allowed = registry.validateThreadStartRequest(JSON.stringify({
      id: "thread-start-1",
      method: "thread/start",
      params: {
        threadId: "thread-1",
        agentRuntime: "codex",
      },
    }));
    assert.equal(allowed.allowed, true);

    registry.observeOutboundMessage(JSON.stringify({
      id: "thread-start-1",
      result: {
        thread: { id: "thread-1" },
      },
    }));

    const record = registry.threadAgentState.get("thread-1");
    assert.equal(record.runtimeLocked, true);
    assert.equal(record.agentRuntime, "codex");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(stateDir, "thread-agent-state.json"), "utf8")).threads["thread-1"].runtimeLocked,
      true
    );
  });
});

test("thread/start rejects runtime changes after lock", async () => {
  await withTempStateDir(async ({ registry }) => {
    registry.threadAgentState.lockRuntime("thread-locked", {
      agentRuntime: "codex",
      agentSessionId: "thread-locked",
    });

    const blocked = registry.validateThreadStartRequest(JSON.stringify({
      id: "thread-start-2",
      method: "thread/start",
      params: {
        threadId: "thread-locked",
        agentRuntime: "opencode",
      },
    }));

    assert.equal(blocked.allowed, false);
    assert.match(blocked.message, /locked/i);
    assert.equal(blocked.errorCode, "agent_runtime_locked");
  });
});

test("initialize responses merge bridge runtime payload on cold reconnect", async () => {
  await withTempStateDir(async ({ registry }) => {
    await registry.refreshInitializeCache();
    const enriched = registry.enrichOutboundResponse(JSON.stringify({
      id: "initialize-1",
      result: {
        serverInfo: { name: "codex" },
      },
    }), { method: "initialize" });

    const parsed = JSON.parse(enriched);
    assert.equal(parsed.result.serverInfo.name, "codex");
    assert.equal(parsed.result.bridgeManaged, true);
    assert.equal(parsed.result.defaultAgentRuntime, "codex");
    assert.equal(parsed.result.agentRuntimes.length, 3);
  }, {
    execFileImpl: missingCommandExecFile,
  });
});

async function withTempStateDir(run, { execFileImpl } = {}) {
  const previousDir = process.env.REMODEX_DEVICE_STATE_DIR;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-agent-runtime-"));
  process.env.REMODEX_DEVICE_STATE_DIR = stateDir;

  const registry = createAgentRuntimeRegistry({
    threadAgentState: createThreadAgentStateStore(),
    execFileImpl: execFileImpl || missingCommandExecFile,
    logImpl: { warn() {} },
  });

  try {
    await run({ registry, stateDir });
  } finally {
    if (previousDir === undefined) {
      delete process.env.REMODEX_DEVICE_STATE_DIR;
    } else {
      process.env.REMODEX_DEVICE_STATE_DIR = previousDir;
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

async function missingCommandExecFile() {
  const error = new Error("ENOENT");
  error.code = "ENOENT";
  throw error;
}
