// FILE: codex-runtime-adapter.js
// Purpose: Wraps the existing Codex transport as the first agent runtime adapter behind the registry.
// Layer: Bridge adapter
// Exports: createCodexRuntimeAdapter
// Depends on: ./agent-runtime-capabilities

const {
  buildRuntimeListEntry,
  getAgentRuntimeCapabilities,
} = require("./agent-runtime-capabilities");

function createCodexRuntimeAdapter({
  id = "codex",
  displayName = "Codex",
} = {}) {
  return {
    id,
    displayName,
    getCapabilities() {
      return getAgentRuntimeCapabilities(id);
    },
    async getRuntimeListEntry() {
      return buildRuntimeListEntry({
        id,
        status: "ready",
        capabilities: getAgentRuntimeCapabilities(id),
      });
    },
    shouldHandleRuntime(agentRuntime) {
      return agentRuntime === id;
    },
  };
}

module.exports = {
  createCodexRuntimeAdapter,
};
