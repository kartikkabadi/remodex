// FILE: opencode-agents.js
// Purpose: Discovers OpenCode agents (modes) via CLI fallback, with built-in agent
//          awareness for when the CLI is unavailable. Filters to primary-eligible agents.
// Layer: Bridge runtime provider helper
// Exports: discoverAgents, parseAgentListOutput, BUILT_IN_AGENTS
// Depends on: child_process (injected)

const { execFile } = require("child_process");

const OPENCODE_EXEC_TIMEOUT_MS = 8_000;

const BUILT_IN_AGENTS = [
  { id: "build", name: "Build", description: "Full access, can edit files.", mode: "primary", isDefault: true },
  { id: "plan", name: "Plan", description: "Plan-only mode. Read and search without editing.", mode: "primary" },
];

const AGENT_CACHE_TTL_MS = 120_000;

function createAgentDiscovery({
  env = process.env,
  execFileImpl = execFile,
  logPrefix = "[remodex]",
} = {}) {
  let agentCache = null;

  function discoverAgents() {
    return readFreshAgentCache() || loadAgents();
  }

  function readFreshAgentCache() {
    if (!agentCache || Date.now() > agentCache.expiresAt) {
      return null;
    }
    return agentCache.value;
  }

  async function loadAgents() {
    const command = resolveOpenCodeCommand(env);

    // Primary: CLI `opencode agent list`
    try {
      const { stdout } = await execFilePromise(execFileImpl, command, ["agent", "list"], {
        env,
        timeout: OPENCODE_EXEC_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
      });
      const agents = parseAgentListOutput(stdout);
      if (agents.length > 0) {
        agentCache = {
          expiresAt: Date.now() + AGENT_CACHE_TTL_MS,
          value: agents,
        };
        return agents;
      }
    } catch {
      // CLI not available; fall through to built-in list.
    }

    const agents = [...BUILT_IN_AGENTS];
    agentCache = {
      expiresAt: Date.now() + AGENT_CACHE_TTL_MS,
      value: agents,
    };
    return agents;
  }

  function invalidateCache() {
    agentCache = null;
  }

  return {
    discoverAgents,
    invalidateCache,
    loadAgents,
  };
}

function parseAgentListOutput(output) {
  const lines = String(output || "").split(/\r?\n/);
  const agents = [];
  const seenIds = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    // Format: "agentName (mode)" — e.g., "build (primary)"
    const match = trimmed.match(/^(\S+)\s+\((\w+)\)$/);
    if (!match) {
      continue;
    }

    const id = match[1];
    const mode = match[2];

    if (mode === "subagent") {
      continue;
    }

    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    agents.push({
      id,
      name: formatAgentDisplayName(id),
      description: builtInAgentDescription(id) || "",
      mode,
      isDefault: id === "build",
    });
  }

  return agents;
}

function formatAgentDisplayName(id) {
  const lowered = id.toLowerCase();
  const known = {
    build: "Build",
    plan: "Plan",
    general: "General",
    explore: "Explore",
  };
  return known[lowered] || titleCase(id);
}

function builtInAgentDescription(id) {
  const lowered = id.toLowerCase();
  const descriptions = {
    build: "Full access, can edit files.",
    plan: "Plan-only mode. Read and search without editing.",
    general: "General-purpose parallel subagent.",
    explore: "Codebase explorer (read and search only).",
  };
  return descriptions[lowered] || "";
}

function resolveOpenCodeCommand(env = process.env) {
  return readString(env.REMODEX_OPENCODE_COMMAND) || "opencode";
}

function execFilePromise(execFileImpl, command, args, options) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, options, (error, stdout = "", stderr = "") => {
      if (error) {
        const message = readString(stderr) || error.message || `${command} failed.`;
        const wrapped = new Error(message);
        wrapped.code = error.code;
        reject(wrapped);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function titleCase(value) {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  BUILT_IN_AGENTS,
  createAgentDiscovery,
  parseAgentListOutput,
};
