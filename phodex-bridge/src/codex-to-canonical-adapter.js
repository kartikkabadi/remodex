// FILE: codex-to-canonical-adapter.js
// Purpose: Converts Codex app-server notifications into Remodex canonical events.
// Layer: Bridge adapter
// Exports: convertCodexNotificationToCanonical
// Depends on: ./canonical-events

const {
  CANONICAL_EVENT_TYPES,
  CANONICAL_SCHEMA_VERSION,
  createCanonicalEvent,
} = require("./canonical-events");

const PERMISSION_REQUEST_METHOD = "remodex/request/permission";

function convertCodexNotificationToCanonical(rawMessage, {
  agentRuntime = "codex",
  resolveAgentSessionId,
  now = () => new Date().toISOString(),
} = {}) {
  const parsed = parseJsonRpcMessage(rawMessage);
  if (!parsed || parsed.id != null) {
    return null;
  }

  const method = readString(parsed.method);
  const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
  const mapping = mapCodexMethod(method, params);
  if (!mapping) {
    return null;
  }

  const threadId = mapping.threadId || extractThreadId(params);
  const turnId = mapping.turnId || extractTurnId(params);
  const itemId = mapping.itemId || extractItemId(params);
  const agentSessionId = typeof resolveAgentSessionId === "function"
    ? resolveAgentSessionId({ threadId, params, method })
    : threadId;
  const createdAt = readString(params.createdAt) || readString(params.timestamp) || now();
  const payload = {
    ...mapping.payload,
    sourceMethod: method,
    raw: params,
  };

  if (mapping.method) {
    return createCanonicalBridgeMessage({
      method: mapping.method,
      agentRuntime,
      threadId,
      agentSessionId,
      turnId,
      itemId,
      requestId: mapping.requestId,
      createdAt,
      payload,
      extraParams: mapping.extraParams,
    });
  }

  return createCanonicalEvent({
    type: mapping.type,
    agentRuntime,
    threadId,
    agentSessionId,
    turnId,
    itemId,
    createdAt,
    payload,
  });
}

function convertCodexServerRequestToCanonical(rawMessage, {
  agentRuntime = "codex",
  resolveAgentSessionId,
  now = () => new Date().toISOString(),
} = {}) {
  const parsed = parseJsonRpcMessage(rawMessage);
  if (!parsed || parsed.id == null) {
    return null;
  }

  const method = readString(parsed.method);
  const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
  if (!isApprovalRequestMethod(method)) {
    return null;
  }

  const threadId = extractThreadId(params);
  const turnId = extractTurnId(params);
  const itemId = extractItemId(params);
  const agentSessionId = typeof resolveAgentSessionId === "function"
    ? resolveAgentSessionId({ threadId, params, method })
    : threadId;
  const permissionId = readString(params.permissionId)
    || readString(params.permission_id)
    || readString(params.requestId)
    || readString(params.request_id)
    || (parsed.id != null ? String(parsed.id) : "");

  return {
    jsonrpc: "2.0",
    id: parsed.id,
    method: PERMISSION_REQUEST_METHOD,
    params: omitEmpty({
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      agentRuntime: readString(agentRuntime) || "codex",
      threadId,
      agentSessionId,
      turnId,
      itemId,
      permissionId,
      createdAt: readString(params.createdAt) || readString(params.timestamp) || now(),
      payload: {
        sourceMethod: method,
        request: {
          ...params,
          reason: readString(params.reason)
            || readString(params.message)
            || readString(params.description),
          command: readString(params.command)
            || readString(params.path)
            || readString(params.filePath)
            || readString(params.title),
          permissions: params.permissions && typeof params.permissions === "object"
            ? params.permissions
            : params.options && typeof params.options === "object"
              ? params.options
              : {},
        },
      },
    }),
  };
}

function mapCodexMethod(method, params) {
  if (method === "thread/started") {
    return {
      type: CANONICAL_EVENT_TYPES.THREAD_STARTED,
      threadId: extractThreadId(params),
      payload: {
        thread: params.thread && typeof params.thread === "object" ? params.thread : null,
      },
    };
  }

  if (method === "turn/started") {
    return {
      type: CANONICAL_EVENT_TYPES.TURN_STARTED,
      payload: {},
    };
  }

  if (method === "codex/event/user_message") {
    return {
      type: CANONICAL_EVENT_TYPES.USER_MESSAGE,
      payload: {
        text: readString(params.text)
          || readString(params.message)
          || readString(params.message?.text)
          || readString(params.item?.text),
      },
    };
  }

  if (method === "turn/plan/updated") {
    const plan = params.plan !== undefined ? params.plan : params;
    const explanation = params.explanation !== undefined ? params.explanation : undefined;
    return {
      method,
      payload: {
        plan,
        explanation,
      },
      extraParams: {
        plan,
        explanation,
      },
    };
  }

  if (method === "item/plan/delta") {
    const delta = params.delta !== undefined
      ? params.delta
      : params.text !== undefined
        ? params.text
        : params.content;
    return {
      method,
      payload: {
        delta,
      },
      extraParams: {
        delta,
      },
    };
  }

  if (method === "item/agentMessage/delta"
    || method === "codex/event/agent_message_content_delta"
    || method === "codex/event/agent_message_delta") {
    return {
      type: CANONICAL_EVENT_TYPES.ASSISTANT_DELTA,
      itemId: extractItemId(params),
      payload: {
        delta: readString(params.delta)
          || readString(params.text)
          || readString(params.content),
      },
    };
  }

  if (method === "codex/event/agent_message") {
    return {
      type: CANONICAL_EVENT_TYPES.ASSISTANT_COMPLETED,
      itemId: extractItemId(params),
      payload: {
        text: readString(params.text)
          || readString(params.message)
          || readString(params.message?.text)
          || readString(params.item?.text),
      },
    };
  }

  if (method === "item/completed" || method === "codex/event/item_completed") {
    return mapItemCompleted(params);
  }

  if (isToolStartMethod(method)) {
    return {
      type: CANONICAL_EVENT_TYPES.TOOL_STARTED,
      itemId: extractItemId(params),
      payload: extractToolPayload(params, method),
    };
  }

  if (isToolDeltaMethod(method)) {
    return {
      type: CANONICAL_EVENT_TYPES.TOOL_DELTA,
      itemId: extractItemId(params),
      payload: extractToolPayload(params, method),
    };
  }

  if (method === "codex/event/image_generation_end") {
    return {
      type: CANONICAL_EVENT_TYPES.IMAGE_GENERATION_END,
      itemId: extractItemId(params),
      payload: extractImageGenerationPayload(params, method),
    };
  }

  if (isToolCompletedMethod(method)) {
    return {
      type: CANONICAL_EVENT_TYPES.TOOL_COMPLETED,
      itemId: extractItemId(params),
      payload: extractToolPayload(params, method),
    };
  }

  if (method === "turn/diff/updated" || method === "codex/event/turn_diff_updated") {
    return {
      type: CANONICAL_EVENT_TYPES.DIFF_UPDATED,
      payload: {
        diff: params.diff || params.patch || null,
      },
    };
  }

  if (method === "turn/completed") {
    return {
      type: CANONICAL_EVENT_TYPES.TURN_COMPLETED,
      payload: {
        status: readString(params.status) || "completed",
      },
    };
  }

  if (method === "serverRequest/resolved") {
    const requestId = readIdentifier(params.requestId)
      || readIdentifier(params.request_id)
      || readIdentifier(params.id);
    return {
      method,
      requestId,
      payload: {
        requestId,
        resolution: params.resolution || params.result || null,
      },
      extraParams: {
        requestId,
      },
    };
  }

  if (method === "error" || method === "codex/event/error" || method === "turn/failed") {
    return {
      type: CANONICAL_EVENT_TYPES.ERROR,
      payload: {
        message: readString(params.message)
          || readString(params.error?.message)
          || "Runtime event failed.",
        code: readString(params.code) || readString(params.error?.code),
      },
    };
  }

  return null;
}

function createCanonicalBridgeMessage({
  method,
  agentRuntime = "codex",
  threadId,
  agentSessionId,
  turnId,
  itemId,
  requestId,
  createdAt = new Date().toISOString(),
  payload = {},
  extraParams = {},
} = {}) {
  const params = omitEmpty({
    ...(extraParams && typeof extraParams === "object" ? extraParams : {}),
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    agentRuntime: readString(agentRuntime) || "codex",
    threadId: readString(threadId),
    agentSessionId: readString(agentSessionId),
    turnId: readString(turnId),
    itemId: readString(itemId),
    requestId: readIdentifier(requestId),
    createdAt: readString(createdAt) || new Date().toISOString(),
    payload: payload && typeof payload === "object" ? payload : {},
  });

  return {
    jsonrpc: "2.0",
    method,
    params,
  };
}

function mapItemCompleted(params) {
  const item = params.item && typeof params.item === "object"
    ? params.item
    : params.event?.item && typeof params.event.item === "object"
      ? params.event.item
      : {};
  const itemType = readString(item.type) || readString(params.type);
  const isAssistant = itemType === "agent_message"
    || itemType === "agentMessage"
    || itemType === "assistant_message"
    || readString(item.role) === "assistant";

  if (isAssistant) {
    return {
      type: CANONICAL_EVENT_TYPES.ASSISTANT_COMPLETED,
      itemId: extractItemId(params),
      payload: {
        text: readString(item.text)
          || readString(item.content)
          || readString(params.text),
      },
    };
  }

  return {
    type: CANONICAL_EVENT_TYPES.TOOL_COMPLETED,
    itemId: extractItemId(params),
    payload: {
      toolType: itemType,
      status: readString(item.status) || readString(params.status) || "completed",
      item,
    },
  };
}

function isToolStartMethod(method) {
  return method === "codex/event/exec_command_begin"
    || method === "codex/event/patch_apply_begin"
    || method === "codex/event/file_search_begin"
    || method === "codex/event/image_generation_begin";
}

function isToolDeltaMethod(method) {
  return method === "codex/event/exec_command_output_delta"
    || method === "codex/event/background_event"
    || method === "codex/event/patch_apply_delta";
}

function isToolCompletedMethod(method) {
  return method === "codex/event/exec_command_end"
    || method === "codex/event/patch_apply_end"
    || method === "codex/event/image_generation_end";
}

function isApprovalRequestMethod(method) {
  return method === "item/commandExecution/requestApproval"
    || method === "item/fileChange/requestApproval"
    || method === "item/fileRead/requestApproval"
    || method === "item/permissions/requestApproval";
}

function extractToolPayload(params, method) {
  return {
    toolType: method.replace(/^codex\/event\//, ""),
    command: readString(params.command),
    message: readString(params.message),
    chunk: readString(params.chunk) || readString(params.delta) || readString(params.output),
    status: readString(params.status),
    success: typeof params.success === "boolean" ? params.success : undefined,
    changes: Array.isArray(params.changes) ? params.changes : undefined,
    fileChanges: Array.isArray(params.fileChanges) ? params.fileChanges : undefined,
    remodexTurnFileChangeSnapshot: params.remodexTurnFileChangeSnapshot === true ? true : undefined,
  };
}

function extractImageGenerationPayload(params, method) {
  return {
    toolType: method.replace(/^codex\/event\//, ""),
    call_id: readString(params.call_id)
      || readString(params.callId)
      || readString(params.id)
      || readString(params.itemId),
    status: readString(params.status) || "completed",
    saved_path: readString(params.saved_path)
      || readString(params.savedPath)
      || readString(params.path)
      || readString(params.file_path),
    result: readString(params.result),
  };
}

function extractThreadId(params = {}) {
  return readString(params.threadId)
    || readString(params.thread_id)
    || readString(params.thread?.id)
    || readString(params.event?.threadId)
    || readString(params.event?.thread_id);
}

function extractTurnId(params = {}) {
  return readString(params.turnId)
    || readString(params.turn_id)
    || readString(params.turn?.id)
    || readString(params.event?.turnId)
    || readString(params.event?.turn_id);
}

function extractItemId(params = {}) {
  return readString(params.itemId)
    || readString(params.item_id)
    || readString(params.item?.id)
    || readString(params.event?.itemId)
    || readString(params.event?.item_id)
    || readString(params.event?.item?.id);
}

function parseJsonRpcMessage(rawMessage) {
  if (rawMessage && typeof rawMessage === "object") {
    return rawMessage;
  }
  try {
    return JSON.parse(rawMessage);
  } catch {
    return null;
  }
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function readIdentifier(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function omitEmpty(value) {
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === "" || entry === undefined || entry === null) {
      continue;
    }
    next[key] = entry;
  }
  return next;
}

module.exports = {
  convertCodexNotificationToCanonical,
  convertCodexServerRequestToCanonical,
  mapCodexMethod,
  PERMISSION_REQUEST_METHOD,
};
