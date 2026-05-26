// FILE: opencode-agent-discovery.test.js
// Purpose: Verifies OpenCode agent discovery from local config files.
// Layer: Unit test
// Depends on: node:test, node:assert/strict, ../src/opencode-agent-discovery

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { discoverOpenCodeAgents } = require("../src/opencode-agent-discovery");

test("discoverOpenCodeAgents merges defaults with config agent keys", () => {
  const configDir = "/tmp/opencode-test-agents";
  const agents = discoverOpenCodeAgents({
    configDir,
    fsImpl: {
      readFileSync(filePath) {
        if (filePath.endsWith("oh-my-openagent.json")) {
          return JSON.stringify({
            agents: {
              hephaestus: { model: "openai/gpt-5.5" },
              sisyphus: { model: "kimi-for-coding/k2p6" },
            },
          });
        }
        throw new Error("missing");
      },
    },
  });

  assert.ok(agents.some((entry) => entry.id === "build" && entry.isDefaultBuild));
  assert.ok(agents.some((entry) => entry.id === "plan" && entry.isDefaultPlan));
  assert.ok(agents.some((entry) => entry.id === "hephaestus"));
  assert.equal(agents.find((entry) => entry.id === "hephaestus")?.displayName, "Hephaestus");
});

test("discoverOpenCodeAgents returns defaults when config is missing", () => {
  const agents = discoverOpenCodeAgents({
    configDir: path.join("/nonexistent", "opencode-config"),
    fsImpl: {
      readFileSync() {
        throw new Error("ENOENT");
      },
    },
  });

  assert.deepEqual(agents.map((entry) => entry.id), ["build", "plan"]);
});
