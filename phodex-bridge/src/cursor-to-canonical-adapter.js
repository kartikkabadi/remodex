// FILE: cursor-to-canonical-adapter.js
// Purpose: Converts Cursor ACP frames into Remodex canonical bridge events.
// Layer: Bridge adapter
// Exports: convertCursorAcpFrameToCanonical, cursorModeForParams
// Depends on: ./canonical-events

const {
  CANONICAL_EVENT_TYPES,
  createCanonicalEvent,
} = require("./canonical-events");

const PERMISSION_REQUEST_METHOD = "remodex/request/permission";

function convertCursorAcpFrameToCanonical(frame, {
  threadId,
  agentSessionId,
  turnId,
  now = () => new Date().toISOString(),
} = {}) {
  const params = frame?.params && typeof frame.params === "object" ? frame.params : {};
  const update = params.update && typeof params.update === "object" ? params.update : {};
  const eventType = readString(params.type)
    || readString(params.kind)
    || readString(params.event)
    || readString(update.sessionUpdate)
    || readString(update.type)
    || readString(frame?.method);
  const itemId = readString(params.itemId)
    || readString(params.item_id)
    || readString(params.id)
    || readString(update.itemId)
    || readString(update.item_id)
    || readString(update.id);
  const common = {
    agentRuntime: "cursor",
    threadId: readString(params.threadId) || readString(params.thread_id) || threadId,
    agentSessionId: readString(params.sessionId) || readString(params.session_id) || agentSessionId,
    turnId: readString(params.turnId)
      || readString(params.turn_id)
      || readString(update.turnId)
      || readString(update.turn_id)
      || turnId,
    itemId,
    createdAt: now(),
  };

  if (isPermissionEvent(eventType, frame?.method)) {
    return {
      jsonrpc: "2.0",
      id: frame?.id || itemId || readString(params.permissionId) || readString(params.permission_id) || undefined,
      method: PERMISSION_REQUEST_METHOD,
      params: {
        ...common,
        permissionId: itemId || readString(params.permissionId) || readString(params.permission_id),
        payload: {
          sourceMethod: frame?.method,
          request: params,
        },
      },
    };
  }

  if (matchesEvent(eventType, ["assistant_delta", "assistant", "assistant_message_delta", "text_delta", "message_delta", "reasoning_delta", "plan_delta", "agent_message_chunk"])) {
    return createCanonicalEvent({
      ...common,
      type: CANONICAL_EVENT_TYPES.ASSISTANT_DELTA,
      payload: {
        sourceMethod: frame?.method,
        delta: readCursorText(params, update),
        reasoning: readString(params.reasoning),
        plan: params.plan,
        raw: params,
      },
    });
  }

  if (matchesEvent(eventType, ["assistant_completed", "message_completed", "assistant_done"])) {
    return createCanonicalEvent({
      ...common,
      type: CANONICAL_EVENT_TYPES.ASSISTANT_COMPLETED,
      payload: {
        sourceMethod: frame?.method,
        text: readString(params.text) || readString(params.content),
        raw: params,
      },
    });
  }

  if (matchesEvent(eventType, ["tool_started", "tool_start", "command_started", "file_started"])) {
    return createCanonicalEvent({
      ...common,
      type: CANONICAL_EVENT_TYPES.TOOL_STARTED,
      payload: {
        sourceMethod: frame?.method,
        toolName: readString(params.toolName) || readString(params.tool_name) || readString(params.name),
        raw: params,
      },
    });
  }

  if (matchesEvent(eventType, ["tool_delta", "tool_update", "command_delta", "file_delta"])) {
    return createCanonicalEvent({
      ...common,
      type: CANONICAL_EVENT_TYPES.TOOL_DELTA,
      payload: {
        sourceMethod: frame?.method,
        delta: readString(params.delta) || readString(params.text) || readString(params.content),
        raw: params,
      },
    });
  }

  if (matchesEvent(eventType, ["tool_completed", "tool_done", "command_completed", "file_completed"])) {
    return createCanonicalEvent({
      ...common,
      type: CANONICAL_EVENT_TYPES.TOOL_COMPLETED,
      payload: {
        sourceMethod: frame?.method,
        status: readString(params.status),
        raw: params,
      },
    });
  }

  if (matchesEvent(eventType, ["diff_updated", "diff", "file_diff"])) {
    return createCanonicalEvent({
      ...common,
      type: CANONICAL_EVENT_TYPES.DIFF_UPDATED,
      payload: {
        sourceMethod: frame?.method,
        diff: readString(params.diff) || readString(params.patch),
        raw: params,
      },
    });
  }

  if (matchesEvent(eventType, ["turn_completed", "session_completed", "completed", "done", "cancelled", "canceled"])) {
    return createCanonicalEvent({
      ...common,
      type: CANONICAL_EVENT_TYPES.TURN_COMPLETED,
      payload: {
        sourceMethod: frame?.method,
        status: readString(params.status) || eventType,
        raw: params,
      },
    });
  }

  if (matchesEvent(eventType, ["error", "failed", "failure"])) {
    return createCanonicalEvent({
      ...common,
      type: CANONICAL_EVENT_TYPES.ERROR,
      payload: {
        sourceMethod: frame?.method,
        message: readString(params.message) || readString(params.error),
        raw: params,
      },
    });
  }

  return null;
}

function cursorModeForParams(params = {}) {
  const mode = readString(params.mode) || readString(params.turnMode) || readString(params.turn_mode);
  if (["agent", "plan", "ask", "debug", "multitask"].includes(mode)) {
    return mode;
  }
  if (params.plan === true) {
    return "plan";
  }
  return "agent";
}

function readCursorText(params = {}, update = {}) {
  const content = update.content && typeof update.content === "object" ? update.content : {};
  return readString(params.delta)
    || readString(params.text)
    || readString(params.content)
    || readString(update.delta)
    || readString(update.text)
    || readString(update.message)
    || readString(content.text)
    || readString(content.content);
}

function isPermissionEvent(eventType, method) {
  return matchesEvent(eventType, ["permission", "permission_request", "request_permission"])
    || /permission/i.test(readString(method));
}

function matchesEvent(value, candidates) {
  const normalized = readString(value).toLowerCase();
  return candidates.includes(normalized);
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  PERMISSION_REQUEST_METHOD,
  convertCursorAcpFrameToCanonical,
  cursorModeForParams,
};
