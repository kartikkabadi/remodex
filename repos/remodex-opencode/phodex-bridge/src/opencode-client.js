// FILE: opencode-client.js
// Purpose: Wraps @opencode-ai/sdk/v2 into a bridge-specific interface for
//          model/agent discovery, session lifecycle, turn execution,
//          event streaming, and permission handling.
// Layer: Transport adapter
// Exports: createOpenCodeClient
// Depends on: @opencode-ai/sdk/v2 (dynamic ESM import), ./opencode-models, ./provider-capabilities

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

async function createOpenCodeClient({
  baseUrl,
  logPrefix = "[remodex]",
} = {}) {
  if (!baseUrl) {
    throw new Error("OpenCode SDK client requires a baseUrl.");
  }

  const createOpencodeClient = await getSdkClient();
  const client = createOpencodeClient({ baseUrl });

  async function listModels() {
    try {
      const response = await withTimeout(
        client.provider.list(),
        REQUEST_TIMEOUT_MS
      );
      return flattenProviderModels(response);
    } catch (error) {
      console.warn(`${logPrefix} OpenCode provider.list() failed: ${error.message}`);
      return [];
    }
  }

  async function listAgents() {
    try {
      const agents = await withTimeout(
        client.app.agents(),
        REQUEST_TIMEOUT_MS
      );
      return (Array.isArray(agents) ? agents : []).map((a) => ({
        id: readString(a.id || a),
        label: readString(a.name || a.displayName || a.id || a),
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
      REQUEST_TIMEOUT_MS
    );
    return readString(response?.sessionID || response?.sessionId);
  }

  async function getSession(sessionId) {
    return withTimeout(
      client.session.get({ sessionID: sessionId }),
      REQUEST_TIMEOUT_MS
    );
  }

  async function prompt({ sessionID, prompt, cwd }) {
    return withTimeout(
      client.session.prompt({
        sessionID,
        prompt,
        cwd,
      }),
      REQUEST_TIMEOUT_MS
    );
  }

  async function setModel({ sessionID, model }) {
    return withTimeout(
      client.session.setConfig({
        sessionID,
        configId: "model",
        value: model,
      }),
      REQUEST_TIMEOUT_MS
    );
  }

  async function setMode({ sessionID, mode }) {
    return withTimeout(
      client.session.setConfig({
        sessionID,
        configId: "mode",
        value: mode,
      }),
      REQUEST_TIMEOUT_MS
    );
  }

  async function setEffort({ sessionID, effort }) {
    return withTimeout(
      client.session.setConfig({
        sessionID,
        configId: "effort",
        value: effort,
      }),
      REQUEST_TIMEOUT_MS
    );
  }

  async function abort(sessionId) {
    return withTimeout(
      client.session.abort({ sessionID: sessionId }),
      REQUEST_TIMEOUT_MS
    );
  }

  async function getMessages(sessionId) {
    const response = await withTimeout(
      client.session.messages({ sessionID: sessionId }),
      REQUEST_TIMEOUT_MS
    );
    return response?.messages || [];
  }

  async function replyToPermission(requestId, allow) {
    return withTimeout(
      client.permission.reply({ requestID: requestId, reply: { allow: Boolean(allow) } }),
      REQUEST_TIMEOUT_MS
    );
  }

  function subscribeToEvents(handler) {
    let active = true;

    (async () => {
      try {
        const subscription = client.event.subscribe();
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
      const delta = readString(event.delta || event.text || event.textDelta);
      const partType = readString(event.part?.type || event.partType);
      if (!delta) break;

      if (partType === "reasoning" || event.isReasoning) {
        handler("item/reasoning/textDelta", {
          turnId: readString(event.turnID || event.turnId),
          itemId: readString(event.partID || event.partId) || `reasoning-${Date.now()}`,
          delta,
          textDelta: delta,
        });
      } else {
        handler("item/agentMessage/delta", {
          turnId: readString(event.turnID || event.turnId),
          itemId: readString(event.partID || event.partId) || `agent-${Date.now()}`,
          delta,
          textDelta: delta,
          assistantPhase: "final",
        });
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

function flattenProviderModels(response) {
  if (!response || typeof response !== "object") return [];

  const providers = response.providers;
  if (!Array.isArray(providers)) {
    const models = Array.isArray(response.models) ? response.models : [];
    const items = Array.isArray(response.items) ? response.items : [];
    const data = Array.isArray(response.data) ? response.data : [];
    const flat = [...models, ...items, ...data];
    if (flat.length > 0) return flat.map((m) => buildModelFromAny(m, "unknown"));
    return [];
  }

  return providers.flatMap((provider) => {
    const providerId = readString(provider.id || provider.providerId);
    const models = Array.isArray(provider.models) ? provider.models : [];
    return models.map((model) => buildModelFromAny(model, providerId));
  });
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
    displayName: readString(model.name || model.displayName) || displayNameForOpenCodeModel(reference),
    description: readString(model.description) || "",
    isDefault: reference === DEFAULT_OPENCODE_MODEL,
    capabilities,
    contextWindow: model.contextWindow || model.context_window || model.maxTokens || null,
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
      setTimeout(() => reject(new Error(`OpenCode SDK request timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = { createOpenCodeClient };
