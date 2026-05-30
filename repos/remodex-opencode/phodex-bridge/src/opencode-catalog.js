// FILE: opencode-catalog.js
// Purpose: Fetches OpenCode models (verbose CLI + ACP config options), agents, and caches
//          results with separate TTLs. Applies reasoning normalization and capability flags.
// Layer: Bridge runtime provider helper
// Exports: createOpenCodeCatalog
// Depends on: child_process, ./opencode-models, ./opencode-reasoning, ./provider-capabilities

const { execFile } = require("child_process");
const {
  DEFAULT_OPENCODE_MODEL,
  OPENCODE_PROVIDER_ID,
  normalizeOpenCodeModelReference,
  displayNameForOpenCodeModel,
} = require("./opencode-models");
const { normalizeReasoningEfforts, inferDefaultReasoningEffort } = require("./opencode-reasoning");
const { CAPABILITIES, resolveModelCapabilities } = require("./provider-capabilities");

const MODEL_CACHE_TTL_MS = 60_000;
const AGENT_CACHE_TTL_MS = 120_000;
const CLI_TIMEOUT_MS = 10_000;

function createOpenCodeCatalog({
  env = process.env,
  execFileImpl = execFile,
  acpTransport = null,
  agentDiscovery = null,
  logPrefix = "[remodex]",
} = {}) {
  let modelCache = null;
  let agentCache = null;
  let versionChecked = false;
  let supportsVerbose = false;

  async function fetchModels() {
    const cached = readFreshModelCache();
    if (cached) {
      return cached;
    }

    const cliModels = await fetchCliModels();
    const verboseModels = supportsVerbose ? await fetchVerboseCliModels() : [];
    const acpModels = await fetchAcpModels();

    const merged = mergeModelLists(verboseModels.length > 0 ? verboseModels : cliModels, acpModels);
    modelCache = {
      expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
      value: merged,
    };
    return merged;
  }

  async function fetchCliModels() {
    try {
      const command = resolveOpenCodeCommand(env);
      const { stdout } = await execFilePromise(execFileImpl, command, ["models"], {
        env,
        timeout: CLI_TIMEOUT_MS,
        maxBuffer: 512 * 1024,
      });
      return parseCliModelOutput(stdout);
    } catch (error) {
      console.warn(`${logPrefix} OpenCode CLI models unavailable: ${error.message}`);
      return [];
    }
  }

  async function fetchVerboseCliModels() {
    try {
      const command = resolveOpenCodeCommand(env);
      const { stdout } = await execFilePromise(execFileImpl, command, ["models", "--verbose"], {
        env,
        timeout: CLI_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
      });
      return parseVerboseModelOutput(stdout);
    } catch {
      return [];
    }
  }

  async function fetchAcpModels() {
    if (!acpTransport || !acpTransport.isConnected()) {
      return [];
    }

    try {
      const response = await acpTransport.sendRequest("session/new", {
        cwd: process.cwd(),
        mcpServers: [],
      });
      return parseAcpConfigOptions(response);
    } catch {
      return [];
    }
  }

  async function fetchAgents() {
    const cached = readFreshAgentCache();
    if (cached) {
      return cached;
    }

    if (agentDiscovery) {
      const agents = await agentDiscovery.discoverAgents();
      agentCache = {
        expiresAt: Date.now() + AGENT_CACHE_TTL_MS,
        value: agents,
      };
      return agents;
    }

    agentCache = {
      expiresAt: Date.now() + AGENT_CACHE_TTL_MS,
      value: [],
    };
    return [];
  }

  async function probeVersion() {
    if (versionChecked) {
      return supportsVerbose;
    }

    try {
      const command = resolveOpenCodeCommand(env);
      const { stdout } = await execFilePromise(execFileImpl, command, ["--version"], {
        env,
        timeout: CLI_TIMEOUT_MS,
        maxBuffer: 32 * 1024,
      });
      const versionOutput = String(stdout || "").trim();
      supportsVerbose = /^opencode\s+([2-9]|[1-9]\d+)\./.test(versionOutput);
      console.log(`${logPrefix} OpenCode version probe: ${versionOutput}, verbose support: ${supportsVerbose}`);
    } catch {
      supportsVerbose = false;
    }
    versionChecked = true;
    return supportsVerbose;
  }

  function readFreshModelCache() {
    if (!modelCache || Date.now() > modelCache.expiresAt) {
      return null;
    }
    return modelCache.value;
  }

  function readFreshAgentCache() {
    if (!agentCache || Date.now() > agentCache.expiresAt) {
      return null;
    }
    return agentCache.value;
  }

  function invalidateCaches() {
    modelCache = null;
    agentCache = null;
  }

  return {
    fetchAgents,
    fetchModels,
    invalidateCaches,
    probeVersion,
  };
}

function parseCliModelOutput(output) {
  const lines = String(output || "").split(/\r?\n/);
  const models = [];
  const seen = new Set();

  for (const line of lines) {
    const reference = normalizeOpenCodeModelReference(line);
    if (!reference || seen.has(reference)) {
      continue;
    }
    seen.add(reference);

    const [providerId] = reference.split("/");
    models.push(buildRichModelOption({
      modelReference: reference,
      upstreamProviderId: providerId,
      isDefault: reference === DEFAULT_OPENCODE_MODEL,
    }));
  }

  return models;
}

function parseVerboseModelOutput(output) {
  const lines = String(output || "").split(/\r?\n/);
  const models = [];
  const seen = new Set();
  let currentReference = "";

  for (const line of lines) {
    const trimmed = line.trim();
    const reference = normalizeOpenCodeModelReference(trimmed);
    if (reference) {
      currentReference = reference;
      continue;
    }

    if (!currentReference) {
      continue;
    }

    const parsed = safeParseJSON(trimmed);
    if (!parsed || typeof parsed !== "object") {
      continue;
    }

    if (seen.has(currentReference)) {
      continue;
    }
    seen.add(currentReference);

    const [providerId] = currentReference.split("/");
    const variants = parsed.variants && typeof parsed.variants === "object" ? parsed.variants : null;
    const reasoningEfforts = normalizeReasoningEfforts(variants);
    const defaultEffort = inferDefaultReasoningEffort(reasoningEfforts, providerId);

    models.push(buildRichModelOption({
      modelReference: currentReference,
      upstreamProviderId: providerId,
      isDefault: currentReference === DEFAULT_OPENCODE_MODEL,
      reasoningEfforts,
      defaultReasoningEffort: defaultEffort,
      modelData: parsed,
    }));
  }

  return models;
}

function parseAcpConfigOptions(sessionResponse) {
  const configOptions = Array.isArray(sessionResponse?.result?.configOptions)
    ? sessionResponse.result.configOptions
    : (Array.isArray(sessionResponse?.configOptions)
      ? sessionResponse.configOptions
      : []);

  const modelOption = configOptions.find((opt) => opt.id === "model" || opt.category === "model");
  if (!modelOption || !Array.isArray(modelOption.options)) {
    return [];
  }

  const models = [];
  const seen = new Set();

  for (const opt of modelOption.options) {
    const value = readString(opt.value || opt.id);
    const reference = normalizeOpenCodeModelReference(value);
    if (!reference || seen.has(reference)) {
      continue;
    }
    seen.add(reference);

    const [providerId] = reference.split("/");
    const defaultModelId = readString(
      sessionResponse?.result?.models?.currentModelId
        || sessionResponse?.models?.currentModelId
    );

    models.push(buildRichModelOption({
      modelReference: reference,
      upstreamProviderId: providerId,
      isDefault: reference === defaultModelId || reference === DEFAULT_OPENCODE_MODEL,
    }));
  }

  return models;
}

function mergeModelLists(cliModels, acpModels) {
  if (!Array.isArray(cliModels) || cliModels.length === 0) {
    return acpModels || [];
  }
  if (!Array.isArray(acpModels) || acpModels.length === 0) {
    return cliModels;
  }

  const byId = new Map();
  for (const model of cliModels) {
    if (model?.id) {
      byId.set(model.id, model);
    }
  }
  for (const model of acpModels) {
    if (model?.id && !byId.has(model.id)) {
      byId.set(model.id, model);
    }
  }
  return Array.from(byId.values());
}

function buildRichModelOption({
  modelReference,
  upstreamProviderId,
  isDefault = false,
  reasoningEfforts = [],
  defaultReasoningEffort = null,
  modelData = null,
} = {}) {
  const capabilities = resolveModelCapabilities(OPENCODE_PROVIDER_ID, {
    supportedReasoningEfforts: reasoningEfforts,
  });

  return {
    id: modelReference,
    model: modelReference,
    modelProvider: OPENCODE_PROVIDER_ID,
    provider: OPENCODE_PROVIDER_ID,
    upstreamProviderId: readString(upstreamProviderId),
    upstreamProviderDisplayName: formatProviderDisplayName(upstreamProviderId),
    displayName: readString(modelData?.name) || displayNameForOpenCodeModel(modelReference),
    description: modelData?.description || "",
    isDefault,
    supportsFastMode: false,
    supportedReasoningEfforts: reasoningEfforts,
    defaultReasoningEffort,
    capabilities,
    limit: modelData?.limit || null,
    status: readString(modelData?.status) || null,
  };
}

function formatProviderDisplayName(providerId) {
  const normalized = readString(providerId).toLowerCase();
  const known = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    google: "Google",
    github: "GitHub Copilot",
    "github-copilot": "GitHub Copilot",
    "amazon-bedrock": "Amazon Bedrock",
    bedrock: "Amazon Bedrock",
    openrouter: "OpenRouter",
    xai: "xAI",
    deepseek: "DeepSeek",
    opencode: "OpenCode",
    azure: "Azure",
    groq: "Groq",
  };

  return known[normalized]
    || normalized.split(/[-_]/).map(titleCase).join(" ");
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
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function safeParseJSON(raw) {
  try {
    return JSON.parse(String(raw || ""));
  } catch {
    return null;
  }
}

module.exports = { createOpenCodeCatalog };
