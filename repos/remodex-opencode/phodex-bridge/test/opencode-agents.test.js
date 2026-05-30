// FILE: opencode-agents.test.js
// Purpose: Verifies OpenCode agent list parsing, built-in fallback, and primary-agent filtering.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/opencode-agents

const test = require("node:test");
const assert = require("node:assert/strict");
const { BUILT_IN_AGENTS, createAgentDiscovery, parseAgentListOutput } = require("../src/opencode-agents");

test("parseAgentListOutput extracts agents with primary/all mode", () => {
  const output = `build (primary)\nplan (primary)\n`;
  const agents = parseAgentListOutput(output);
  assert.equal(agents.length, 2);
  assert.equal(agents[0].id, "build");
  assert.equal(agents[0].mode, "primary");
  assert.equal(agents[1].id, "plan");
  assert.equal(agents[1].mode, "primary");
});

test("parseAgentListOutput filters subagent-only entries", () => {
  const output = `build (primary)\ngeneral (subagent)\nplan (primary)\nexplore (subagent)\n`;
  const agents = parseAgentListOutput(output);
  assert.equal(agents.length, 2);
  assert.deepEqual(agents.map((a) => a.id), ["build", "plan"]);
});

test("parseAgentListOutput returns empty for empty output", () => {
  assert.deepEqual(parseAgentListOutput(""), []);
  assert.deepEqual(parseAgentListOutput("\n  \n"), []);
});

test("parseAgentListOutput assigns display names", () => {
  const output = `build (primary)\nplan (primary)\n`;
  const agents = parseAgentListOutput(output);
  assert.equal(agents[0].name, "Build");
  assert.equal(agents[1].name, "Plan");
});

test("parseAgentListOutput marks build as default", () => {
  const output = `build (primary)\nplan (primary)\n`;
  const agents = parseAgentListOutput(output);
  assert.equal(agents[0].isDefault, true);
  assert.equal(agents[1].isDefault, false);
});

test("parseAgentListOutput deduplicates repeated entries", () => {
  const output = `build (primary)\nbuild (primary)\nplan (primary)\n`;
  const agents = parseAgentListOutput(output);
  assert.equal(agents.length, 2);
});

test("createAgentDiscovery falls back to built-in agents when CLI fails", async () => {
  const discovery = createAgentDiscovery({
    env: { PATH: process.env.PATH },
    execFileImpl: (command, args, options, callback) => {
      const error = new Error("command not found");
      error.code = "ENOENT";
      setImmediate(() => callback(error));
    },
  });

  const agents = await discovery.loadAgents();
  assert.equal(agents.length, 2);
  assert.equal(agents[0].id, "build");
  assert.equal(agents[1].id, "plan");
});

test("createAgentDiscovery caches results", async () => {
  let callCount = 0;
  const discovery = createAgentDiscovery({
    env: { PATH: process.env.PATH },
    execFileImpl: (command, args, options, callback) => {
      callCount++;
      callback(null, "build (primary)\nplan (primary)\n", "");
    },
  });

  const first = await discovery.discoverAgents();
  const second = await discovery.discoverAgents();
  assert.equal(callCount, 1);
  assert.deepEqual(first, second);
});

test("createAgentDiscovery invalidateCache forces reload", async () => {
  let callCount = 0;
  const discovery = createAgentDiscovery({
    env: { PATH: process.env.PATH },
    execFileImpl: (command, args, options, callback) => {
      callCount++;
      callback(null, "build (primary)\n", "");
    },
  });

  await discovery.discoverAgents();
  discovery.invalidateCache();
  await discovery.discoverAgents();
  assert.equal(callCount, 2);
});

test("BUILT_IN_AGENTS contains build and plan", () => {
  const ids = BUILT_IN_AGENTS.map((a) => a.id);
  assert.deepEqual(ids, ["build", "plan"]);
  assert.equal(BUILT_IN_AGENTS[0].mode, "primary");
  assert.equal(BUILT_IN_AGENTS[0].isDefault, true);
});

test("parseAgentListOutput handles custom agents with all mode", () => {
  const output = `build (primary)\nmy-custom (all)\n`;
  const agents = parseAgentListOutput(output);
  assert.equal(agents.length, 2);
  assert.equal(agents[1].id, "my-custom");
  assert.equal(agents[1].mode, "all");
});
