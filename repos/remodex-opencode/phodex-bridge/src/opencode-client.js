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
const { parseOpenCodeModelSlug } = require("./opencode-model-slug");
const { resolveLogoProviderId } = require("./opencode-provider-inventory");


let _createOpencodeClient = null;

async function getSdkClient() {
  if (_createOpencodeClient) return _createOpencodeClient;
  const sdk = await import("@opencode-ai/sdk/v2");
  _createOpencodeClient = sdk.createOpencodeClient;
  return _createOpencodeClient;
}

const REQUEST_TIMEOUT_MS = 90_000;

function resolveSessionIdFromCreateResponse(response) {
  if (!response || typeof response !== "object") {
    return "";
  }

  const data = response.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const fromData = readString(data.id || data.sessionID || data.sessionId);
    if (fromData) {
      return fromData;
    }
  }

  return readString(response.sessionID || response.sessionId || response.id);
}

async function createOpenCodeClient({
  baseUrl,
  logPrefix = "[remodex]",
  createOpencodeClientImpl = null,
} = {}) {
  if (!baseUrl) {
    throw new Error("OpenCode SDK client requires a baseUrl.");
  }

  const createOpencodeClient = createOpencodeClientImpl || (await getSdkClient());
  const client = createOpencodeClient({ baseUrl });

  let inventoryCache = null;
  let inventoryRefreshPromise = null;

  async function listProviderInventory({
    force = false,
    credentialProviderIDs = [],
    authDiscoveryReasonCode = "ok",
    providerInventoryPartial = false,
  } = {}) {
    const cacheTtlMs = boundedProviderCacheTtlMs(process.env);
    if (inventoryRefreshPromise && !force) {
      return inventoryRefreshPromise;
    }
    const { refreshProviderInventory } = require("./opencode-provider-inventory");
    const run = refreshProviderInventory(client, {
      force,
      cached: inventoryCache,
      cacheTtlMs,
      credentialProviderIDs,
      authDiscoveryReasonCode,
      providerInventoryPartial,
    }).then((result) => {
      inventoryCache = {
        inventory: result.inventory,
        models: result.models,
        meta: result.meta,
        connectedProviders: result.connectedProviders,
        providerInventory: result.providerInventory,
        authDiscoveryReasonCode: result.authDiscoveryReasonCode,
        providerInventoryPartial: result.providerInventoryPartial,
        fetchedAt: Date.parse(result.meta?.fetchedAt) || Date.now(),
      };
      return result;
    });
    if (!force) {
      inventoryRefreshPromise = run.finally(() => {
        inventoryRefreshPromise = null;
      });
      return inventoryRefreshPromise;
    }
    return run;
  }

  async function listModels({
    force = false,
    credentialProviderIDs = [],
    authDiscoveryReasonCode = "ok",
  } = {}) {
    try {
      const result = await listProviderInventory({
        force,
        credentialProviderIDs,
        authDiscoveryReasonCode,
      });
      return {
        models: result.models || [],
        meta: result.meta || {
          reasonCode: "unknown",
          connectedProviderIds: [],
          fetchedAt: new Date().toISOString(),
          stale: false,
          modelCountBeforeCap: 0,
          modelCountAfterCap: 0,
        },
        connectedProviders: result.connectedProviders || [],
        providerInventory: result.providerInventory || [],
        authDiscoveryReasonCode: result.authDiscoveryReasonCode || authDiscoveryReasonCode,
        providerInventoryPartial: result.providerInventoryPartial === true,
      };
    } catch (error) {
      console.warn(`${logPrefix} OpenCode provider inventory failed: ${error.message}`);
      return {
        models: [],
        meta: {
          reasonCode: "provider_list_failed",
          connectedProviderIds: [],
          fetchedAt: new Date().toISOString(),
          stale: false,
          modelCountBeforeCap: 0,
          modelCountAfterCap: 0,
        },
      };
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
    const sessionId = resolveSessionIdFromCreateResponse(response);
    if (!readString(sessionId)) {
      throw new Error(
        "OpenCode session.create returned no session id (empty or missing id/sessionID in response).",
      );
    }
    return sessionId;
  }

  async function getSession(sessionId) {
    return withTimeout(client.session.get({ sessionID: sessionId }), REQUEST_TIMEOUT_MS);
  }

  async function prompt({ sessionID, prompt, parts, cwd, model, agent, variant, threadId, turnId }) {
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

    let parsedModel = null;
    if (model && typeof model === "object" && model.providerID && model.modelID) {
      parsedModel = {
        providerID: readString(model.providerID),
        modelID: readString(model.modelID),
      };
    } else {
      parsedModel = parseOpenCodeModelSlug(model);
    }

    const promptBody = {
      sessionID,
      directory: readString(cwd) || process.cwd(),
      parts: bodyParts,
    };
    if (parsedModel?.providerID && parsedModel?.modelID) {
      promptBody.model = parsedModel;
    }
    const normalizedAgent = readString(agent);
    if (normalizedAgent) {
      promptBody.agent = normalizedAgent;
    }
    const normalizedVariant = readString(variant);
    if (normalizedVariant) {
      promptBody.variant = normalizedVariant;
    }

    console.log(
      JSON.stringify({
        event: "opencode_turn_prompt",
        providerID: parsedModel?.providerID || null,
        modelID: parsedModel?.modelID || null,
        agent: normalizedAgent || null,
        variant: normalizedVariant || null,
        threadId: readString(threadId) || null,
        turnId: readString(turnId) || null,
        sessionId: readString(sessionID) || null,
      }),
    );

    return withTimeout(client.session.prompt(promptBody), REQUEST_TIMEOUT_MS);
  }

  async function abort(sessionId) {
    return withTimeout(client.session.abort({ sessionID: sessionId }), REQUEST_TIMEOUT_MS);
  }

  async function getMessages(sessionId) {
    const response = await withTimeout(
      client.session.messages({ sessionID: sessionId }),
      REQUEST_TIMEOUT_MS,
    );
    return normalizeSessionMessagesResponse(response);
  }

  async function replyToPermission(requestId, allow) {
    return withTimeout(
      client.permission.reply({ requestID: requestId, reply: { allow: Boolean(allow) } }),
      REQUEST_TIMEOUT_MS,
    );
  }

  function subscribeToEvents(handler) {
    let active = true;
    let releaseStream = null;

    const streamTask = (async () => {
      try {
        const sseClient = await client.event.subscribe();
        releaseStream =
          typeof sseClient.close === "function"
            ? () => sseClient.close()
            : typeof sseClient.abort === "function"
              ? () => sseClient.abort()
              : null;
        const subscription = sseClient.stream;
        try {
          for await (const event of subscription) {
            if (!active) {
              break;
            }
            dispatchEvent(event, handler);
          }
        } finally {
          if (typeof subscription?.return === "function") {
            try {
              await subscription.return();
            } catch {
              // Stream may already be closed when unsubscribing.
            }
          }
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
      if (releaseStream) {
        try {
          releaseStream();
        } catch {
          // Best-effort teardown so node:test can exit.
        }
        releaseStream = null;
      }
      void streamTask.catch(() => {});
    };
  }

  async function fork(sessionId) {
    const response = await withTimeout(
      client.session.fork({ sessionID: sessionId }),
      REQUEST_TIMEOUT_MS,
    );
    const forkedSessionId = resolveSessionIdFromCreateResponse(response);
    if (!readString(forkedSessionId)) {
      throw new Error(
        "OpenCode session.fork returned no session id (empty or missing id/sessionID in response).",
      );
    }
    return forkedSessionId;
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
      console.warn(`${logPrefix} OpenCode app.skills() failed: ${error?.message || error}`);
      return [];
    }
  }

  async function probeProviderAuthState() {
    try {
      const response = await withTimeout(client.provider.auth(), REQUEST_TIMEOUT_MS);
      return inferAuthConfiguredFromProviderAuth(response);
    } catch (error) {
      console.warn(`${logPrefix} OpenCode provider.auth() failed: ${error.message}`);
      return null;
    }
  }

  async function listAuthProviderIds() {
    try {
      const response = await withTimeout(client.provider.auth(), REQUEST_TIMEOUT_MS);
      const { authProviderIdsFromProbe } = require("./opencode-auth-providers");
      return authProviderIdsFromProbe(response);
    } catch {
      return [];
    }
  }

  async function probeConnectedProviders() {
    try {
      const response = await withTimeout(client.provider.list(), REQUEST_TIMEOUT_MS);
      const payload = resolveProviderListPayload(response);
      const connected = Array.isArray(payload?.connected) ? payload.connected : [];
      if (connected.length === 0) {
        return false;
      }
      return true;
    } catch {
      return null;
    }
  }

  return {
    listModels,
    listProviderInventory,
    listAgents,
    createSession,
    getSession,
    prompt,
    abort,
    getMessages,
    replyToPermission,
    subscribeToEvents,
    fork,
    listCommands,
    listSkills,
    selectTuiSession,
    probeProviderAuthState,
    probeConnectedProviders,
    listAuthProviderIds,
  };
}

function inferAuthConfiguredFromProviderAuth(response) {
  if (!response || typeof response !== "object") {
    return null;
  }
  const entries = Object.entries(response).filter(([key]) => key !== "data");
  if (entries.length === 0) {
    return null;
  }
  return entries.some(([, methods]) => Array.isArray(methods) && methods.length > 0);
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

function normalizeOpenCodeEventType(type) {
  const normalized = readString(type);
  if (!normalized) {
    return "";
  }
  return normalized.endsWith(".1") ? normalized.slice(0, -2) : normalized;
}

function readOpenCodeEventProperties(event) {
  if (event?.properties && typeof event.properties === "object" && !Array.isArray(event.properties)) {
    return event.properties;
  }
  return event || {};
}

function normalizeSessionMessagesResponse(response) {
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response?.data)) {
    return response.data;
  }
  if (Array.isArray(response?.messages)) {
    return response.messages;
  }
  if (Array.isArray(response?.items)) {
    return response.items;
  }
  return [];
}

function openCodeToolContentText(content) {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => readString(part?.text))
    .filter(Boolean)
    .join("\n");
}

function dispatchEvent(event, handler) {
  const type = normalizeOpenCodeEventType(event?.type);
  if (!type) return;
  const properties = readOpenCodeEventProperties(event);

  switch (type) {
    case "turn.started":
      handler("turn/started", {
        turnId: readString(event.turnID || event.turnId),
        sessionId: readString(event.sessionID || event.sessionId),
      });
      break;

    case "message.part.added": {
      const props = readOpenCodeEventProperties(event);
      const part = props.part && typeof props.part === "object" ? props.part : event.part || {};
      const partType = readString(part.type || event.partType);
      const turnId = readString(props.turnID || props.turnId || event.turnID || event.turnId);
      const itemId =
        readString(part.id || props.partID || props.partId || event.partID || event.partId) ||
        `part-${Date.now()}`;
      const text = readString(part.text || props.text || event.text || event.content);
      if (partType === "tool_call" || partType === "tool") {
        handler("item/toolCall", {
          turnId,
          itemId,
          toolName: readString(event.part?.tool?.name || event.toolName),
          args: event.part?.tool?.args || event.args || {},
          status: "running",
        });
      } else if (text) {
        handler("item/agentMessage/delta", {
          turnId,
          itemId,
          delta: text,
          textDelta: text,
          assistantPhase: "final",
        });
      }
      break;
    }

    case "message.part.delta": {
      const props = readOpenCodeEventProperties(event);
      const field = readString(props.field).toLowerCase();
      const partType = readString(props.partType || event.partType || field);
      const turnId = readString(props.turnID || props.turnId || event.turnID || event.turnId);
      const itemId =
        readString(props.partID || props.partId || event.partID || event.partId) ||
        `agent-${Date.now()}`;
      const delta = readString(props.delta || event.delta || event.text || event.textDelta);

      if (partType === "reasoning" || field === "reasoning" || event.isReasoning) {
        if (delta) {
          handler("item/reasoning/textDelta", {
            turnId,
            itemId,
            delta,
            textDelta: delta,
            sessionId: readString(props.sessionID || props.sessionId),
          });
        }
      } else if (partType === "tool_call" || partType === "tool") {
        const toolName = readString(props.tool || event.tool?.name || event.toolName || event.name);
        const toolId =
          readString(props.callID || props.callId || event.tool?.id || event.toolID || event.toolId) ||
          `tool-${Date.now()}`;
        const state = readString(props.state || event.state || event.status);
        const args = props.input || props.args || event.args || event.tool?.args || {};
        const output = readString(props.output || props.delta || event.output || delta);

        if (output) {
          handler("item/toolCallUpdate", {
            turnId,
            itemId: toolId,
            toolName,
            args,
            output,
            status: state || "running",
            sessionId: readString(props.sessionID || props.sessionId),
          });
        } else {
          handler("item/toolCall", {
            turnId,
            itemId: toolId,
            toolName,
            args,
            status: state || "running",
            sessionId: readString(props.sessionID || props.sessionId),
          });
        }
      } else if (delta) {
        handler("item/agentMessage/delta", {
          turnId,
          itemId,
          delta,
          textDelta: delta,
          assistantPhase: "final",
          sessionId: readString(props.sessionID || props.sessionId),
        });
      }
      break;
    }

    case "message.part.updated": {
      const props = readOpenCodeEventProperties(event);
      const part = props.part && typeof props.part === "object" ? props.part : {};
      const partType = readString(part.type);
      const turnId = readString(props.turnID || props.turnId || event.turnID || event.turnId);
      const itemId = readString(part.id || props.partID || props.partId || event.partID || event.partId);
      const sessionId = readString(props.sessionID || props.sessionId || part.sessionID);

      if (partType === "text") {
        const text = readString(part.text);
        if (text) {
          handler("item/agentMessage/delta", {
            turnId,
            itemId,
            delta: text,
            textDelta: text,
            assistantPhase: "final",
            sessionId,
          });
          if (part.time?.end != null || part.time?.completed != null) {
            handler("item/completed", {
              turnId,
              itemId,
              message: text,
              assistantPhase: "final_answer",
              sessionId,
            });
          }
        }
        break;
      }

      if (partType === "reasoning") {
        const text = readString(part.text);
        if (text) {
          handler("item/reasoning/textDelta", {
            turnId,
            itemId,
            delta: text,
            textDelta: text,
            sessionId,
          });
        }
        break;
      }

      const state = readString(part.state?.status || part.state || event.state);
      if (state === "pending" || state === "in_progress" || state === "running") {
        handler("item/toolCall", {
          turnId,
          itemId,
          toolName: readString(part.name || part.tool?.name || event.toolName),
          status: state === "in_progress" || state === "running" ? "running" : "pending",
          sessionId,
        });
      } else if (state === "completed") {
        handler("item/toolCallUpdate", {
          turnId,
          itemId,
          status: "completed",
          sessionId,
        });
      } else if (state === "error" || state === "failed") {
        handler("item/toolCallUpdate", {
          turnId,
          itemId,
          status: "failed",
          sessionId,
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
        completionSource: "turn.completed",
      });
      break;

    case "permission.asked":
      handler("permission/request", {
        permissionId: readString(event.requestID || event.requestId),
        tool: readString(event.tool || event.toolName),
        args: event.args || {},
      });
      break;

    case "session.idle":
      handler("turn/completed", {
        turnId: readString(event.turnID || event.turnId || event.properties?.turnID),
        status: "completed",
        sessionId: readString(event.sessionID || event.sessionId || event.properties?.sessionID),
        completionSource: "session.idle",
      });
      break;

    case "session.error": {
      const errMsg = readString(
        event.error?.message || event.message || event.properties?.error?.message,
      );
      handler("turn/failed", {
        turnId: readString(event.turnID || event.turnId),
        sessionId: readString(event.sessionID || event.sessionId),
        message: errMsg || "OpenCode session error",
      });
      break;
    }

    case "session.compacted":
      handler("thread/context/compacted", {
        sessionId: readString(event.sessionID || event.sessionId),
        turnId: readString(event.turnID || event.turnId),
      });
      break;

    case "todo.updated":
      handler("turn/tasks/updated", {
        turnId: readString(event.turnID || event.turnId),
        sessionId: readString(event.sessionID || event.sessionId),
        todos: event.todos || event.properties?.todos || [],
      });
      break;

    case "session.status": {
      const status = readString(properties.status || event.status);
      if (status) {
        handler("runtime/warning", {
          sessionId: readString(properties.sessionID || properties.sessionId || event.sessionID),
          turnId: readString(properties.turnID || properties.turnId || event.turnID),
          message: `OpenCode session status: ${status}`,
          reasonCode: "opencode_session_status",
        });
      }
      break;
    }

    case "session.next.text.delta": {
      const delta = readString(properties.delta);
      if (!delta) {
        break;
      }
      const sessionId = readString(properties.sessionID || properties.sessionId);
      const itemId =
        readString(properties.partID || properties.partId) ||
        `oc-text-${sessionId || "session"}-${Date.now()}`;
      handler("item/agentMessage/delta", {
        turnId: readString(properties.turnID || properties.turnId || event.turnID),
        itemId,
        delta,
        textDelta: delta,
        assistantPhase: "final",
        sessionId,
      });
      break;
    }

    case "session.next.text.ended": {
      const text = readString(properties.text);
      const sessionId = readString(properties.sessionID || properties.sessionId);
      const itemId =
        readString(properties.partID || properties.partId) ||
        `oc-text-${sessionId || "session"}-${Date.now()}`;
      if (text) {
        handler("item/agentMessage/delta", {
          turnId: readString(properties.turnID || properties.turnId || event.turnID),
          itemId,
          delta: text,
          textDelta: text,
          assistantPhase: "final",
          sessionId,
        });
      }
      handler("item/completed", {
        turnId: readString(properties.turnID || properties.turnId || event.turnID),
        itemId,
        message: text,
        assistantPhase: "final_answer",
        sessionId,
      });
      break;
    }

    case "session.next.reasoning.delta": {
      const delta = readString(properties.delta);
      if (!delta) {
        break;
      }
      handler("item/reasoning/textDelta", {
        turnId: readString(properties.turnID || properties.turnId || event.turnID),
        itemId: readString(properties.reasoningID || properties.reasoningId) || `reasoning-${Date.now()}`,
        delta,
        textDelta: delta,
        sessionId: readString(properties.sessionID || properties.sessionId),
      });
      break;
    }

    case "session.next.reasoning.ended": {
      const reasoningText = readString(properties.text);
      handler("item/completed", {
        turnId: readString(properties.turnID || properties.turnId || event.turnID),
        itemId: readString(properties.reasoningID || properties.reasoningId) || `reasoning-${Date.now()}`,
        message: reasoningText,
        assistantPhase: "reasoning",
        sessionId: readString(properties.sessionID || properties.sessionId),
      });
      break;
    }

    case "session.next.tool.called": {
      const toolName = readString(properties.tool || properties.name);
      const callId = readString(properties.callID || properties.callId) || `tool-${Date.now()}`;
      handler("item/toolCall", {
        turnId: readString(properties.turnID || properties.turnId || event.turnID),
        itemId: callId,
        toolName,
        args: properties.input || properties.args || {},
        status: "running",
        sessionId: readString(properties.sessionID || properties.sessionId),
      });
      break;
    }

    case "session.next.tool.progress":
    case "session.next.tool.success": {
      const callId = readString(properties.callID || properties.callId);
      const output = openCodeToolContentText(properties.content);
      const status = type === "session.next.tool.success" ? "completed" : "running";
      handler("item/toolCallUpdate", {
        turnId: readString(properties.turnID || properties.turnId || event.turnID),
        itemId: callId || `tool-${Date.now()}`,
        output,
        status,
        sessionId: readString(properties.sessionID || properties.sessionId),
      });
      if (type === "session.next.tool.success") {
        handler("item/completed", {
          turnId: readString(properties.turnID || properties.turnId || event.turnID),
          itemId: callId,
          status: "completed",
          sessionId: readString(properties.sessionID || properties.sessionId),
        });
      }
      break;
    }

    case "session.next.tool.failed": {
      const callId = readString(properties.callID || properties.callId);
      const errMsg = readString(properties.error?.message || properties.message) || "Tool failed";
      handler("item/toolCallUpdate", {
        turnId: readString(properties.turnID || properties.turnId || event.turnID),
        itemId: callId || `tool-${Date.now()}`,
        output: errMsg,
        status: "failed",
        sessionId: readString(properties.sessionID || properties.sessionId),
      });
      break;
    }

    case "session.next.step.failed": {
      const errMsg =
        readString(properties.error?.message || properties.message) || "OpenCode step failed";
      handler("turn/failed", {
        turnId: readString(properties.turnID || properties.turnId || event.turnID),
        sessionId: readString(properties.sessionID || properties.sessionId),
        message: errMsg,
      });
      break;
    }

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

function buildModelFromAny(model, upstreamProviderIdOrProvider) {
  const modelId = readString(model.id || model.model || model.name);
  let upstreamProviderId = "";
  let upstreamProviderDisplayName = "";
  if (upstreamProviderIdOrProvider && typeof upstreamProviderIdOrProvider === "object") {
    upstreamProviderId = readString(
      upstreamProviderIdOrProvider.id ||
        upstreamProviderIdOrProvider.providerId ||
        upstreamProviderIdOrProvider.providerID,
    );
    upstreamProviderDisplayName =
      readString(upstreamProviderIdOrProvider.name) ||
      formatProviderDisplayName(upstreamProviderId);
  } else {
    upstreamProviderId = readString(upstreamProviderIdOrProvider);
    upstreamProviderDisplayName = formatProviderDisplayName(upstreamProviderId);
  }
  const reference = `${upstreamProviderId}/${modelId}`;
  const capabilities = resolveModelCapabilities(OPENCODE_PROVIDER_ID, model);
  const logoProviderId = resolveLogoProviderId(upstreamProviderId, upstreamProviderDisplayName);

  return {
    id: reference,
    model: reference,
    modelProvider: OPENCODE_PROVIDER_ID,
    provider: OPENCODE_PROVIDER_ID,
    upstreamProviderId,
    upstreamProviderDisplayName,
    displayName:
      readString(model.name || model.displayName) || displayNameForOpenCodeModel(reference),
    description: readString(model.description) || "",
    isDefault: reference === DEFAULT_OPENCODE_MODEL,
    capabilities,
    contextWindow: model.contextWindow || model.context_window || null,
    status: readString(model.status) || "active",
    serveVariants:
      model.variants && typeof model.variants === "object" && !Array.isArray(model.variants)
        ? model.variants
        : null,
    ...(logoProviderId ? { logoProviderId } : {}),
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

function boundedProviderCacheTtlMs(env = process.env) {
  const raw = readString(env?.REMODEX_OPENCODE_PROVIDER_CACHE_MS);
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 60_000;
}

function withTimeout(promise, ms) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`OpenCode SDK request timed out after ${ms}ms`)),
      ms,
    );
    timeoutId.unref?.();
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function resolveProviderAuthPayload(response) {
  if (!response || typeof response !== "object") return response;

  const nested = response.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested;
  }

  return response;
}

module.exports = {
  createOpenCodeClient,
  dispatchEvent,
  normalizeSessionMessagesResponse,
  flattenProviderModels,
  buildModelFromAny,
  resolveAgentsList,
  normalizeOpenCodeEventType,
  resolveProviderListPayload,
  resolveProviderAuthPayload,
  resolveSessionIdFromCreateResponse,
};
