// FILE: opencode-client.js
// Purpose: Wraps @opencode-ai/sdk/v2 into a bridge-specific interface for
//          model/agent discovery, session lifecycle, turn execution,
//          event streaming, and permission handling.
// Layer: Transport adapter
// Exports: createOpenCodeClient
// Depends on: @opencode-ai/sdk/v2 (dynamic ESM import), ./opencode-models, ./provider-capabilities

const { readString } = require("./normalize");
const {
  OPENCODE_PROVIDER_ID,
  DEFAULT_OPENCODE_MODEL,
  displayNameForOpenCodeModel,
} = require("./opencode-models");
const { resolveModelCapabilities } = require("./provider-capabilities");

let _createOpencodeClient = null;

async function getSdkClient() {
  if (_createOpencodeClient) return _createOpencodeClient;
  const sdk = await import("@opencode-ai/sdk/v2");
  _createOpencodeClient = sdk.createOpencodeClient;
  return _createOpencodeClient;
}

const REQUEST_TIMEOUT_MS = 90_000;

async function createOpenCodeClient({ baseUrl, logPrefix = "[remodex]" } = {}) {
  if (!baseUrl) {
    throw new Error("OpenCode SDK client requires a baseUrl.");
  }

  const createOpencodeClient = await getSdkClient();
  const client = createOpencodeClient({ baseUrl });

  async function listModels() {
    try {
      const response = await withTimeout(client.provider.list(), REQUEST_TIMEOUT_MS);
      return flattenProviderModels(response);
    } catch (error) {
      console.warn(`${logPrefix} OpenCode provider.list() failed: ${error.message}`);
      return [];
    }
  }

  async function listAgents() {
    try {
      const response = await withTimeout(client.app.agents(), REQUEST_TIMEOUT_MS);
      return resolveAgentsList(response).map((a) => ({
        id: readString(a.id || a.name || a),
        label: readString(a.label || a.name || a.displayName || a.id || a),
        description: readString(a.description) || "",
      }));
    } catch (error) {
      console.warn(`${logPrefix} OpenCode app.agents() failed: ${error.message}`);
      return [];
    }
  }

  async function createSession({ cwd }) {
    const response = await withTimeout(
      client.session.create({ directory: readString(cwd) || process.cwd() }),
      REQUEST_TIMEOUT_MS,
    );
    return readString(response?.sessionID || response?.sessionId);
  }

  async function getSession(sessionId) {
    return withTimeout(client.session.get({ sessionID: sessionId }), REQUEST_TIMEOUT_MS);
  }

  async function prompt({ sessionID, prompt, parts, cwd }) {
    const resolvedParts =
      Array.isArray(parts) && parts.length > 0
        ? parts
        : [{ type: "text", text: readString(prompt) || "" }];
    const bodyParts = resolvedParts.filter(
      (part) =>
        part &&
        (part.type === "file" ||
          part.type === "agent" ||
          part.type === "subtask" ||
          readString(part.text)),
    );
    if (bodyParts.length === 0) {
      throw new Error("OpenCode prompt requires at least one part.");
    }

    return withTimeout(
      client.session.prompt({
        sessionID,
        directory: readString(cwd) || process.cwd(),
        parts: bodyParts,
      }),
      REQUEST_TIMEOUT_MS,
    );
  }

  async function setModel({ sessionID, model }) {
    return withTimeout(
      client.session.setConfig({
        sessionID,
        configId: "model",
        value: model,
      }),
      REQUEST_TIMEOUT_MS,
    );
  }

  async function setMode({ sessionID, mode }) {
    return withTimeout(
      client.session.setConfig({
        sessionID,
        configId: "mode",
        value: mode,
      }),
      REQUEST_TIMEOUT_MS,
    );
  }

  async function setEffort({ sessionID, effort }) {
    return withTimeout(
      client.session.setConfig({
        sessionID,
        configId: "effort",
        value: effort,
      }),
      REQUEST_TIMEOUT_MS,
    );
  }

  async function abort(sessionId) {
    return withTimeout(client.session.abort({ sessionID: sessionId }), REQUEST_TIMEOUT_MS);
  }

  async function getMessages(sessionId) {
    const response = await withTimeout(
      client.session.messages({ sessionID: sessionId }),
      REQUEST_TIMEOUT_MS,
    );
    return response?.messages || [];
  }

  async function replyToPermission(requestId, allow) {
    return withTimeout(
      client.permission.reply({ requestID: requestId, reply: { allow: Boolean(allow) } }),
      REQUEST_TIMEOUT_MS,
    );
  }

  function subscribeToEvents(handler) {
    let active = true;

    (async () => {
      try {
        const sseClient = await client.event.subscribe();
        const subscription = sseClient.stream;
        for await (const event of subscription) {
          if (!active) break;
          dispatchEvent(event, handler);
        }
      } catch (error) {
        if (active) {
          console.error(`${logPrefix} OpenCode event stream error: ${error.message}`);
          handler("event/streamError", { message: error.message });
        }
      }
    })();

    return () => {
      active = false;
    };
  }

  async function fork(sessionId) {
    const response = await withTimeout(
      client.session.fork({ sessionID: sessionId }),
      REQUEST_TIMEOUT_MS,
    );
    return readString(response?.sessionID || response?.sessionId);
  }

  async function listCommands(directory) {
    try {
      const commands = await withTimeout(
        client.command.list({ query: { directory: readString(directory) || process.cwd() } }),
        REQUEST_TIMEOUT_MS,
      );
      return (Array.isArray(commands) ? commands : []).map((c) => ({
        token: readString(c.token || c.name || c),
        title: readString(c.title || c.displayName || c.token || c.name || c),
        description: readString(c.description) || "",
      }));
    } catch (error) {
      console.warn(`${logPrefix} OpenCode command.list() failed: ${error.message}`);
      return [];
    }
  }

  async function selectTuiSession(sessionId) {
    const normalizedSessionId = readString(sessionId);
    if (!normalizedSessionId || typeof client.tui?.selectSession !== "function") {
      return false;
    }

    try {
      await withTimeout(
        client.tui.selectSession({ sessionID: normalizedSessionId }),
        REQUEST_TIMEOUT_MS,
      );
      return true;
    } catch (error) {
      console.warn(
        `${logPrefix} OpenCode tui.selectSession failed: ${error?.message || error}`,
      );
      return false;
    }
  }

  async function listSkills(directory) {
    if (typeof client.app?.skills !== "function") {
      return [];
    }
    try {
      const response = await withTimeout(
        client.app.skills({ query: { directory: readString(directory) || process.cwd() } }),
        REQUEST_TIMEOUT_MS,
      );
      const skills = resolveSkillsList(response);
      return skills.map((skill) => mapOpenCodeSkill(skill, directory));
    } catch (error) {
      console.warn(`${logPrefix} OpenCode app.skills() failed: ${error.message}`);
      return [];
    }
  }

  return {
    listModels,
    listAgents,
    createSession,
    getSession,
    prompt,
    setModel,
    setMode,
    setEffort,
    abort,
    getMessages,
    replyToPermission,
    subscribeToEvents,
    fork,
    listCommands,
    listSkills,
    selectTuiSession,
  };
}

function resolveSkillsList(response) {
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response?.data)) {
    return response.data;
  }
  if (Array.isArray(response?.skills)) {
    return response.skills;
  }
  return [];
}

function mapOpenCodeSkill(skill, directory) {
  const name = readString(skill?.name || skill?.id);
  const location = readString(skill?.location || skill?.path);
  const path = location || "";
  const scope =
    path.includes("/.codex/skills/") || path.includes("/.agents/skills/")
      ? path.includes("/.codex/skills/")
        ? "global"
        : "project"
      : directory && path.startsWith(directory)
        ? "project"
        : "global";
  return {
    name,
    description: readString(skill?.description) || "",
    path,
    scope,
    enabled: skill?.enabled !== false,
  };
}

function dispatchEvent(event, handler) {
  const type = readString(event?.type);
  if (!type) return;

  switch (type) {
    case "turn.started":
      handler("turn/started", {
        turnId: readString(event.turnID || event.turnId),
        sessionId: readString(event.sessionID || event.sessionId),
      });
      break;

    case "message.part.added":
      break;

    case "message.part.delta": {
      const partType = readString(event.part?.type || event.partType);
      const turnId = readString(event.turnID || event.turnId);
      const itemId = readString(event.partID || event.partId) || `agent-${Date.now()}`;

      if (partType === "reasoning" || event.isReasoning) {
        const delta = readString(event.delta || event.text || event.textDelta);
        if (delta) {
          handler("item/reasoning/textDelta", {
            turnId,
            itemId,
            delta,
            textDelta: delta,
          });
        }
      } else if (partType === "tool_call" || partType === "tool") {
        const toolName = readString(event.tool?.name || event.toolName || event.name);
        const toolId = readString(event.tool?.id || event.toolID || event.toolId) || `tool-${Date.now()}`;
        const state = readString(event.state || event.status);
        const args = event.args || event.tool?.args || {};
        const output = readString(event.output || event.delta || event.text || event.textDelta);

        if (output) {
          handler("item/toolCallUpdate", {
            turnId,
            itemId: toolId,
            toolName,
            args,
            output,
            status: state || "running",
          });
        } else {
          handler("item/toolCall", {
            turnId,
            itemId: toolId,
            toolName,
            args,
            status: state || "running",
          });
        }
      } else {
        const delta = readString(event.delta || event.text || event.textDelta);
        if (delta) {
          handler("item/agentMessage/delta", {
            turnId,
            itemId,
            delta,
            textDelta: delta,
            assistantPhase: "final",
          });
        }
      }
      break;
    }

    case "message.part.updated": {
      const state = readString(event.state);
      if (state === "pending" || state === "in_progress") {
        handler("item/toolCall", {
          turnId: readString(event.turnID || event.turnId),
          itemId: readString(event.partID || event.partId),
          toolName: readString(event.tool?.name || event.toolName),
          status: state === "in_progress" ? "running" : "pending",
        });
      } else if (state === "completed") {
        handler("item/toolCallUpdate", {
          turnId: readString(event.turnID || event.turnId),
          itemId: readString(event.partID || event.partId),
          status: "completed",
        });
      } else if (state === "error" || state === "failed") {
        handler("item/toolCallUpdate", {
          turnId: readString(event.turnID || event.turnId),
          itemId: readString(event.partID || event.partId),
          status: "failed",
        });
      }
      break;
    }

    case "message.completed":
      handler("item/completed", {
        turnId: readString(event.turnID || event.turnId),
        itemId: readString(event.messageID || event.messageId),
        message: readString(event.text || event.content),
        assistantPhase: "final_answer",
      });
      break;

    case "turn.completed":
      handler("turn/completed", {
        turnId: readString(event.turnID || event.turnId),
        status: readString(event.status) || "completed",
        sessionId: readString(event.sessionID || event.sessionId),
      });
      break;

    case "permission.asked":
      handler("permission/request", {
        permissionId: readString(event.requestID || event.requestId),
        tool: readString(event.tool || event.toolName),
        args: event.args || {},
      });
      break;

    default:
      break;
  }
}

function resolveAgentsList(response) {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.data)) return response.data;
  if (response && Array.isArray(response.agents)) return response.agents;
  return [];
}

function resolveProviderListPayload(response) {
  if (!response || typeof response !== "object") return response;

  if (Array.isArray(response.providers) || Array.isArray(response.all)) {
    return response;
  }

  const nested = response.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested;
  }

  return response;
}

function providerEntriesFromPayload(payload) {
  if (!payload || typeof payload !== "object") return [];

  if (Array.isArray(payload.providers)) return payload.providers;
  if (Array.isArray(payload.all)) return payload.all;
  return [];
}

function modelsForProvider(provider) {
  const models = provider?.models;
  if (Array.isArray(models)) return models;
  if (models && typeof models === "object") return Object.values(models);
  return [];
}

function flattenProviderModels(response) {
  if (!response || typeof response !== "object") return [];

  const payload = resolveProviderListPayload(response);
  const providers = providerEntriesFromPayload(payload);
  if (providers.length > 0) {
    return providers.flatMap((provider) => {
      const providerId = readString(provider.id || provider.providerId || provider.providerID);
      return modelsForProvider(provider).map((model) => buildModelFromAny(model, providerId));
    });
  }

  const models = Array.isArray(payload.models) ? payload.models : [];
  const items = Array.isArray(payload.items) ? payload.items : [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  const flat = [...models, ...items, ...data];
  if (flat.length > 0) return flat.map((m) => buildModelFromAny(m, "unknown"));
  return [];
}

function buildModelFromAny(model, upstreamProviderId) {
  const modelId = readString(model.id || model.model || model.name);
  const reference = `${readString(upstreamProviderId)}/${modelId}`;
  const capabilities = resolveModelCapabilities(OPENCODE_PROVIDER_ID, model);

  return {
    id: reference,
    model: reference,
    modelProvider: OPENCODE_PROVIDER_ID,
    provider: OPENCODE_PROVIDER_ID,
    upstreamProviderId: readString(upstreamProviderId),
    upstreamProviderDisplayName: formatProviderDisplayName(upstreamProviderId),
    displayName:
      readString(model.name || model.displayName) || displayNameForOpenCodeModel(reference),
    description: readString(model.description) || "",
    isDefault: reference === DEFAULT_OPENCODE_MODEL,
    capabilities,
    contextWindow: model.contextWindow || model.context_window || null,
    status: readString(model.status) || "active",
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
  return known[normalized] || normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`OpenCode SDK request timed out after ${ms}ms`)), ms),
    ),
  ]);
}

module.exports = {
  createOpenCodeClient,
  flattenProviderModels,
  buildModelFromAny,
  resolveAgentsList,
};
