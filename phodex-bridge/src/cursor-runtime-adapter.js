// FILE: cursor-runtime-adapter.js
// Purpose: Adapts Remodex runtime requests to Cursor Agent ACP.
// Layer: Bridge adapter
// Exports: createCursorRuntimeAdapter, mapCursorDiscoveryToRuntimeStatus
// Depends on: ./agent-runtime-capabilities, ./cursor-acp-client, ./cursor-to-canonical-adapter

const {
  buildRuntimeListEntry,
  getAgentRuntimeCapabilities,
} = require("./agent-runtime-capabilities");
const {
  createCursorModelCatalog,
} = require("./agent-runtime-model-catalog");
const {
  createCursorAcpClient,
  discoverCursorAcpCommand,
} = require("./cursor-acp-client");
const {
  convertCursorAcpFrameToCanonical,
  cursorModeForParams,
} = require("./cursor-to-canonical-adapter");
const {
  CANONICAL_EVENT_TYPES,
  createCanonicalEvent,
} = require("./canonical-events");

function createCursorRuntimeAdapter({
  id = "cursor",
  discoverCommand = discoverCursorAcpCommand,
  createClient = createCursorAcpClient,
  threadAgentState,
  env = process.env,
  logImpl = console,
} = {}) {
  if (!threadAgentState) {
    throw new Error("Cursor runtime adapter requires threadAgentState.");
  }

  let cachedDiscovery = null;
  const clientsByThreadId = new Map();
  const activeTurnIdsByThreadId = new Map();
  const activeTurnSessionsByThreadId = new Map();
  const pendingPermissionsById = new Map();

  return {
    id,
    async getRuntimeListEntry() {
      const discovery = await resolveDiscovery();
      const mapped = mapCursorDiscoveryToRuntimeStatus(discovery);
      return buildRuntimeListEntry({
        id,
        status: mapped.status,
        statusMessage: mapped.statusMessage,
        capabilities: getAgentRuntimeCapabilities(id),
        modelCatalog: createCursorModelCatalog({ statusMessage: mapped.statusMessage }),
      });
    },
    async handleRuntimeRequest(context = {}) {
      const method = readString(context.parsed?.method);
      if (method === "thread/start" || method === "thread/resume") {
        return handleThreadStartLike(context);
      }
      if (method === "turn/start") {
        return handleTurnStart(context);
      }
      if (method === "turn/interrupt" || method === "turn/stop") {
        return handleTurnStop(context);
      }
      throw new Error(`Cursor runtime does not support ${method} yet.`);
    },
    async handleRuntimeResponse(context = {}) {
      return handleRuntimeResponse(context);
    },
    stopAll() {
      for (const client of clientsByThreadId.values()) {
        client.stop?.();
      }
      clientsByThreadId.clear();
      pendingPermissionsById.clear();
    },
  };

  async function resolveDiscovery({ forceRefresh = false } = {}) {
    if (!forceRefresh && cachedDiscovery) {
      return cachedDiscovery;
    }
    cachedDiscovery = await discoverCommand({ env });
    return cachedDiscovery;
  }

  async function getOrCreateClient(threadId, params, sendResponse) {
    const existing = clientsByThreadId.get(threadId);
    if (existing) {
      return existing;
    }

    const discovery = await resolveDiscovery();
    if (discovery.status !== "ready") {
      throw new Error(discovery.statusMessage || "Cursor ACP is not available.");
    }

    const client = createClient({
      command: discovery.command,
      args: discovery.args,
      cwd: readString(params.cwd) || readString(params.workingDirectory) || process.cwd(),
      env,
      onNotification(frame) {
        sendCursorCanonical(sendResponse, frame, threadId);
      },
      onRequest(frame) {
        if (isCursorPermissionRequest(frame)) {
          pendingPermissionsById.set(String(frame.id), {
            threadId,
            acpRequestId: frame.id,
          });
        }
        sendCursorCanonical(sendResponse, frame, threadId);
        return undefined;
      },
    });
    clientsByThreadId.set(threadId, client);
    return client;
  }

  async function handleThreadStartLike({ parsed, sendResponse }) {
    const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
    const threadId = extractThreadId(params) || `cursor-${Date.now()}`;
    const client = await getOrCreateClient(threadId, params, sendResponse);
    const result = await client.request("session/new", {
      cwd: readString(params.cwd) || readString(params.workingDirectory),
      mcpServers: [],
      mode: cursorModeForParams(params),
      title: readString(params.title) || readString(params.prompt) || "Remodex",
    });
    const agentSessionId = readString(result?.sessionId) || readString(result?.session_id) || readString(result?.id);
    if (!agentSessionId) {
      throw new Error("Cursor ACP did not return a session id.");
    }

    threadAgentState.upsert(threadId, {
      agentRuntime: id,
      agentSessionId,
      cwd: readString(params.cwd) || readString(params.workingDirectory),
      runtimeLocked: true,
    });

    sendJsonRpcResult(sendResponse, parsed.id, {
      thread: {
        id: threadId,
        title: readString(result?.title) || readString(params.title),
        agentRuntime: id,
        agentSessionId,
      },
    });
    sendCanonical(sendResponse, CANONICAL_EVENT_TYPES.THREAD_STARTED, {
      threadId,
      agentSessionId,
      payload: {
        thread: {
          id: threadId,
          agentRuntime: id,
          agentSessionId,
        },
      },
    });
    return { responded: true };
  }

  async function handleTurnStart({ parsed, threadId, sendResponse }) {
    const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
    const record = threadId ? threadAgentState.get(threadId) : null;
    const agentSessionId = readString(record?.agentSessionId) || readString(params.agentSessionId);
    if (!threadId || !agentSessionId) {
      throw new Error("Cursor turn/start requires a known thread and agent session.");
    }
    const client = await getOrCreateClient(threadId, params, sendResponse);
    const turnId = extractTurnId(params) || `cursor-turn-${Date.now()}`;
    activeTurnIdsByThreadId.set(threadId, turnId);
    activeTurnSessionsByThreadId.set(threadId, agentSessionId);

    sendJsonRpcResult(sendResponse, parsed.id, {
      turnId,
      agentRuntime: id,
      agentSessionId,
    });
    sendCanonical(sendResponse, CANONICAL_EVENT_TYPES.TURN_STARTED, {
      threadId,
      agentSessionId,
      turnId,
      payload: {},
    });

    let promptRequest;
    try {
      promptRequest = client.request("session/prompt", {
        sessionId: agentSessionId,
        prompt: buildCursorPromptParts(params),
        mode: cursorModeForParams(params),
      });
    } catch (error) {
      promptRequest = Promise.reject(error);
    }
    void Promise.resolve(promptRequest)
      .then((result) => {
        if (result && typeof result === "object") {
          sendCanonical(sendResponse, CANONICAL_EVENT_TYPES.TURN_COMPLETED, {
            threadId,
            agentSessionId,
            turnId,
            payload: {
              status: readString(result.stopReason) || readString(result.status) || "completed",
              raw: result,
            },
          });
        }
      })
      .catch((error) => {
        completeCursorTurnWithError(sendResponse, {
          threadId,
          agentSessionId,
          turnId,
          message: error?.message || "Cursor ACP prompt failed.",
        });
      })
      .finally(() => {
        if (activeTurnIdsByThreadId.get(threadId) === turnId) {
          activeTurnIdsByThreadId.delete(threadId);
        }
        if (activeTurnSessionsByThreadId.get(threadId) === agentSessionId) {
          activeTurnSessionsByThreadId.delete(threadId);
        }
      });

    return { responded: true };
  }

  async function handleTurnStop({ parsed, threadId, sendResponse }) {
    const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
    const record = threadId ? threadAgentState.get(threadId) : null;
    const agentSessionId = readString(record?.agentSessionId) || readString(params.agentSessionId);
    const client = threadId
      ? clientsByThreadId.get(threadId) || await getOrCreateClient(threadId, params, sendResponse)
      : null;
    if (!client || !agentSessionId) {
      throw new Error("Cursor stop requires a known active ACP session.");
    }
    await client.request("session/cancel", {
      sessionId: agentSessionId,
    });
    sendJsonRpcResult(sendResponse, parsed.id, {
      cancelled: true,
      agentRuntime: id,
      agentSessionId,
    });
    return { responded: true };
  }

  function sendCursorCanonical(sendResponse, frame, threadId) {
    const record = threadAgentState.get(threadId);
    const canonical = convertCursorAcpFrameToCanonical(frame, {
      threadId,
      agentSessionId: record?.agentSessionId,
      turnId: activeTurnIdsByThreadId.get(threadId),
    });
    if (!canonical) {
      logImpl.debug?.(`[remodex] Ignored Cursor ACP frame: ${readString(frame?.method)}`);
      return;
    }
    sendResponse?.(JSON.stringify(canonical));
    if (canonical.method === "remodex/event/error") {
      completeCursorTurnWithError(sendResponse, {
        threadId,
        agentSessionId: record?.agentSessionId,
        turnId: activeTurnIdsByThreadId.get(threadId),
        message: readString(canonical.params?.payload?.message) || "Cursor ACP prompt failed.",
        skipErrorEvent: true,
      });
    }
  }

  function completeCursorTurnWithError(sendResponse, {
    threadId,
    agentSessionId,
    turnId,
    message,
    skipErrorEvent = false,
  }) {
    const errorMessage = readString(message) || "Cursor ACP prompt failed.";
    if (!skipErrorEvent) {
      sendCanonical(sendResponse, CANONICAL_EVENT_TYPES.ERROR, {
        threadId,
        agentSessionId,
        turnId,
        payload: { message: errorMessage },
      });
    }
    sendCanonical(sendResponse, CANONICAL_EVENT_TYPES.TURN_COMPLETED, {
      threadId,
      agentSessionId,
      turnId,
      payload: {
        status: "failed",
        error: { message: errorMessage },
      },
    });
  }

  async function handleRuntimeResponse({ rawMessage, parsed, sendResponse } = {}) {
    const message = parsed || parseJsonRpcMessage(rawMessage);
    if (!message || message.method || message.id == null) {
      return false;
    }

    const pending = pendingPermissionsById.get(String(message.id));
    if (!pending) {
      return false;
    }

    const client = clientsByThreadId.get(pending.threadId);
    if (!client || typeof client.respond !== "function") {
      return false;
    }

    if (message.error) {
      client.rejectRequest?.(
        pending.acpRequestId,
        message.error.code || -32603,
        readString(message.error.message) || "Permission denied."
      );
    } else {
      client.respond(pending.acpRequestId, message.result ?? {});
    }

    pendingPermissionsById.delete(String(message.id));
    sendResponse?.(JSON.stringify({
      method: "serverRequest/resolved",
      params: {
        threadId: pending.threadId,
        requestId: String(message.id),
      },
    }));
    return true;
  }

  function sendCanonical(sendResponse, type, {
    threadId,
    agentSessionId,
    turnId,
    payload,
  }) {
    sendResponse?.(JSON.stringify(createCanonicalEvent({
      type,
      agentRuntime: id,
      threadId,
      agentSessionId,
      turnId,
      payload,
    })));
  }
}

function buildCursorPromptParts(params = {}) {
  const text = readString(params.prompt) || readString(params.input) || readString(params.message);
  return text ? [{ type: "text", text }] : [];
}

function mapCursorDiscoveryToRuntimeStatus(discovery = {}) {
  if (discovery.status === "ready") {
    return { status: "ready", statusMessage: "" };
  }
  if (discovery.status === "not_installed") {
    return {
      status: "not_installed",
      statusMessage: discovery.statusMessage || "Install Cursor Agent on this Mac to enable the Cursor runtime.",
    };
  }
  return {
    status: "error",
    statusMessage: "Cursor ACP status could not be verified on this Mac.",
  };
}

function sendJsonRpcResult(sendResponse, requestId, result) {
  if (typeof sendResponse !== "function" || requestId == null) {
    return;
  }
  sendResponse(JSON.stringify({
    id: requestId,
    result,
  }));
}

function extractThreadId(params = {}) {
  return readString(params.threadId)
    || readString(params.thread_id)
    || readString(params.thread?.id)
    || readString(params.thread?.threadId)
    || readString(params.thread?.thread_id);
}

function extractTurnId(params = {}) {
  return readString(params.turnId)
    || readString(params.turn_id)
    || readString(params.turn?.id);
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseJsonRpcMessage(rawMessage) {
  if (!rawMessage) {
    return null;
  }
  if (typeof rawMessage === "object") {
    return rawMessage;
  }
  try {
    return JSON.parse(rawMessage);
  } catch {
    return null;
  }
}

function isCursorPermissionRequest(frame = {}) {
  const method = readString(frame.method);
  return method === "permission/request"
    || method === "item/permissions/requestApproval"
    || method.endsWith("/requestApproval");
}

module.exports = {
  createCursorRuntimeAdapter,
  mapCursorDiscoveryToRuntimeStatus,
};
