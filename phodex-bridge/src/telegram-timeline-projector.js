// FILE: telegram-timeline-projector.js
// Purpose: Pure bridge-event → Telegram action projection with iOS turn/dedupe rules.
// Layer: CLI helper
// Exports: createTelegramTimelineProjector, buildTimelineDedupeKey, parseBridgeTimelineEvent
// Depends on: telegram-streaming-bubble

const { STREAMING_DELTA_METHODS } = require("./telegram-streaming-bubble");
const { telegramEnvelopeEvent } = require("./telegram-codex-envelope");
const {
  mergeFileChangeSummaryText,
  parseTelegramFileChangeSummary,
} = require("./telegram-file-change-summary");

const APPROVAL_REQUEST_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/fileRead/requestApproval",
  "item/permissions/requestApproval",
]);
const USER_INPUT_REQUEST_METHODS = new Set([
  "item/tool/requestUserInput",
]);
const THREAD_EVENT_METHODS = new Set([
  "turn/started",
  "turn/completed",
  "codex/event/agent_message",
]);
const FILE_CHANGE_DELTA_METHODS = new Set([
  "item/fileChange/outputDelta",
  "item/fileChange/output_delta",
]);
const ACTIVITY_FOOTER_METHODS = new Set([
  "codex/event/background_event",
  "codex/event/exec_command_begin",
  "codex/event/read",
  "codex/event/search",
  "codex/event/list_files",
]);
const MAX_SEEN_EVENT_KEYS = 5000;
const MAX_COMPLETED_TURN_KEYS = 2000;

function normalizeTimelineId(value) {
  return String(value ?? "").trim();
}

function buildTurnScopeKey(threadId, turnId) {
  return `${normalizeTimelineId(threadId)}|${normalizeTimelineId(turnId)}`;
}

function buildTimelineDedupeKey(event = {}) {
  return [
    normalizeTimelineId(event.method),
    normalizeTimelineId(event.threadId),
    normalizeTimelineId(event.turnId),
    normalizeTimelineId(event.itemId),
  ].join("|");
}

function shouldDedupeTimelineEvent(event = {}) {
  const method = normalizeTimelineId(event.method);
  if (STREAMING_DELTA_METHODS.has(method) && !normalizeTimelineId(event.itemId)) {
    return false;
  }
  return true;
}

function safeParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function requestIdKey(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function readTimelineThreadId(params = {}) {
  const envelope = telegramEnvelopeEvent(params);
  return normalizeTimelineId(
    params.threadId
    || params.thread_id
    || params.conversationId
    || params.conversation_id
    || params.turn?.threadId
    || params.turn?.thread_id
    || params.item?.threadId
    || params.item?.thread_id
    || envelope?.threadId
    || envelope?.thread_id
    || envelope?.conversationId
    || envelope?.conversation_id
  );
}

function readTimelineTurnId(params = {}) {
  const envelope = telegramEnvelopeEvent(params);
  return normalizeTimelineId(
    params.turnId
    || params.turn_id
    || params.id
    || params.turn?.id
    || params.turn?.turnId
    || params.turn?.turn_id
    || envelope?.turnId
    || envelope?.turn_id
    || envelope?.id
  );
}

function readTimelineItemId(params = {}) {
  return normalizeTimelineId(params.itemId || params.item_id);
}

function parseBridgeTimelineEvent(rawMessage) {
  const message = typeof rawMessage === "string" ? safeParseJSON(rawMessage) : rawMessage;
  if (!message || typeof message !== "object") {
    return null;
  }

  const approval = parseApprovalTimelineEvent(message);
  if (approval) {
    return approval;
  }

  const userInput = parseUserInputTimelineEvent(message);
  if (userInput) {
    return userInput;
  }

  const streamingDelta = parseStreamingTimelineDelta(message);
  if (streamingDelta) {
    return streamingDelta;
  }

  const fileChangeDelta = parseFileChangeTimelineDelta(message);
  if (fileChangeDelta) {
    return fileChangeDelta;
  }

  const activityFooter = parseActivityFooterTimelineEvent(message);
  if (activityFooter) {
    return activityFooter;
  }

  return parseThreadTimelineEvent(message);
}

function parseApprovalTimelineEvent(message) {
  const id = requestIdKey(message?.id);
  const method = normalizeTimelineId(message?.method);
  if (!id || !APPROVAL_REQUEST_METHODS.has(method)) {
    return null;
  }
  const params = message.params && typeof message.params === "object" && !Array.isArray(message.params)
    ? message.params
    : {};
  const threadId = readTimelineThreadId(params);
  return {
    kind: "approval",
    method,
    threadId,
    turnId: readTimelineTurnId(params),
    itemId: readTimelineItemId(params),
    request: {
      id,
      method,
      params,
    },
  };
}

function parseUserInputTimelineEvent(message) {
  const id = requestIdKey(message?.id);
  const method = normalizeTimelineId(message?.method);
  if (!id || !USER_INPUT_REQUEST_METHODS.has(method)) {
    return null;
  }
  const params = message.params && typeof message.params === "object" && !Array.isArray(message.params)
    ? message.params
    : {};
  const questions = Array.isArray(params.questions) ? params.questions : [];
  if (questions.length === 0) {
    return null;
  }
  return {
    kind: "userInput",
    method,
    threadId: readTimelineThreadId(params),
    turnId: readTimelineTurnId(params),
    itemId: readTimelineItemId(params),
    request: {
      id,
      method,
      params,
    },
  };
}

function parseFileChangeTimelineDelta(message) {
  const method = normalizeTimelineId(message?.method);
  if (!FILE_CHANGE_DELTA_METHODS.has(method)) {
    return null;
  }
  const params = message.params && typeof message.params === "object" && !Array.isArray(message.params)
    ? message.params
    : {};
  const threadId = readTimelineThreadId(params);
  if (!threadId) {
    return null;
  }
  const delta = extractTimelineAssistantDeltaText(params, message);
  if (!delta) {
    return null;
  }
  return {
    kind: "fileChangeDelta",
    method,
    threadId,
    turnId: readTimelineTurnId(params),
    itemId: readTimelineItemId(params),
    delta,
    params,
  };
}

function parseActivityFooterTimelineEvent(message) {
  const method = normalizeTimelineId(message?.method);
  if (!ACTIVITY_FOOTER_METHODS.has(method)) {
    return null;
  }
  const params = message.params && typeof message.params === "object" && !Array.isArray(message.params)
    ? message.params
    : {};
  const threadId = readTimelineThreadId(params);
  if (!threadId) {
    return null;
  }
  const activity = readActivityFooterText(method, params);
  if (!activity) {
    return null;
  }
  return {
    kind: "activityFooter",
    method,
    threadId,
    turnId: readTimelineTurnId(params),
    itemId: readTimelineItemId(params),
    activity,
    params,
  };
}

function readActivityFooterText(method, params = {}) {
  const envelope = telegramEnvelopeEvent(params);
  if (method === "codex/event/background_event") {
    return normalizeTimelineId(params.message || envelope?.message);
  }
  if (method === "codex/event/exec_command_begin") {
    const command = normalizeTimelineId(params.command || envelope?.command);
    return command ? `Running ${command}` : "";
  }
  if (method === "codex/event/read") {
    const path = normalizeTimelineId(params.path || envelope?.path);
    return path ? `Reading ${path}` : "Reading file";
  }
  if (method === "codex/event/search") {
    const query = normalizeTimelineId(params.query || envelope?.query);
    return query ? `Searching ${query}` : "Searching";
  }
  if (method === "codex/event/list_files") {
    const path = normalizeTimelineId(params.path || envelope?.path);
    return path ? `Listing ${path}` : "Listing files";
  }
  return "";
}

function parseStreamingTimelineDelta(message) {
  const method = normalizeTimelineId(message?.method);
  if (!STREAMING_DELTA_METHODS.has(method)) {
    return null;
  }
  const params = message.params && typeof message.params === "object" && !Array.isArray(message.params)
    ? message.params
    : {};
  const threadId = readTimelineThreadId(params);
  if (!threadId) {
    return null;
  }
  const delta = extractTimelineAssistantDeltaText(params, message);
  if (!delta) {
    return null;
  }
  return {
    kind: "streamingDelta",
    method,
    threadId,
    turnId: readTimelineTurnId(params),
    itemId: readTimelineItemId(params),
    delta,
    params,
  };
}

function parseThreadTimelineEvent(message) {
  const method = normalizeTimelineId(message?.method);
  if (!THREAD_EVENT_METHODS.has(method)) {
    return null;
  }
  const params = message.params && typeof message.params === "object" && !Array.isArray(message.params)
    ? message.params
    : {};
  const threadId = readTimelineThreadId(params);
  if (!threadId) {
    return null;
  }
  const event = {
    kind: "threadEvent",
    method,
    params,
    threadId,
    turnId: readTimelineTurnId(params),
    itemId: readTimelineItemId(params),
  };
  if (method === "codex/event/agent_message") {
    const envelope = telegramEnvelopeEvent(params);
    const text = normalizeTimelineId(
      params.message
      || params.text
      || envelope?.message
      || envelope?.text
    );
    if (!text) {
      return null;
    }
  }
  return event;
}

function extractTimelineAssistantDeltaText(params = {}, eventObject = {}) {
  const envelope = telegramEnvelopeEvent(params);
  const candidates = [
    params?.delta,
    params?.textDelta,
    params?.text_delta,
    envelope?.delta,
    envelope?.textDelta,
    envelope?.text_delta,
    eventObject?.delta,
    eventObject?.text,
    params?.event?.delta,
    params?.event?.text,
  ];
  for (const candidate of candidates) {
    if (candidate == null) {
      continue;
    }
    const value = typeof candidate === "string" ? candidate : String(candidate);
    if (value.length > 0) {
      return value;
    }
  }
  return "";
}

function createTelegramTimelineProjector() {
  const seenKeys = new Set();
  const activeTurnIdByThread = new Map();
  const protectedRunningFallbackThreads = new Set();
  const completedTurnKeys = new Set();
  const fileChangeTextByTurn = new Map();
  const activityFooterByTurn = new Map();

  function trimSet(set, maxSize) {
    while (set.size > maxSize) {
      const oldest = set.values().next().value;
      set.delete(oldest);
    }
  }

  function resolveTurnId(threadId, turnId) {
    const normalizedTurnId = normalizeTimelineId(turnId);
    if (normalizedTurnId) {
      return normalizedTurnId;
    }
    return normalizeTimelineId(activeTurnIdByThread.get(normalizeTimelineId(threadId))) || "";
  }

  function hasProtectedRunningFallback(threadId) {
    return protectedRunningFallbackThreads.has(normalizeTimelineId(threadId));
  }

  function isTurnCompleted(threadId, turnId) {
    const resolvedTurnId = resolveTurnId(threadId, turnId);
    if (!resolvedTurnId) {
      return false;
    }
    return completedTurnKeys.has(buildTurnScopeKey(threadId, resolvedTurnId));
  }

  function isActiveTurnForThread(threadId, turnId) {
    const normalizedThreadId = normalizeTimelineId(threadId);
    const resolvedTurnId = resolveTurnId(threadId, turnId);
    if (!resolvedTurnId) {
      return hasProtectedRunningFallback(normalizedThreadId);
    }
    return normalizeTimelineId(activeTurnIdByThread.get(normalizedThreadId)) === resolvedTurnId;
  }

  function clearTurnConversationState(turnScopeKey) {
    fileChangeTextByTurn.delete(turnScopeKey);
    activityFooterByTurn.delete(turnScopeKey);
  }

  function markTurnStarted(threadId, turnId) {
    const normalizedThreadId = normalizeTimelineId(threadId);
    if (!normalizedThreadId) {
      return;
    }
    const normalizedTurnId = normalizeTimelineId(turnId);
    if (normalizedTurnId) {
      activeTurnIdByThread.set(normalizedThreadId, normalizedTurnId);
      protectedRunningFallbackThreads.delete(normalizedThreadId);
      completedTurnKeys.delete(buildTurnScopeKey(normalizedThreadId, normalizedTurnId));
      clearTurnConversationState(buildTurnScopeKey(normalizedThreadId, normalizedTurnId));
      return;
    }
    protectedRunningFallbackThreads.add(normalizedThreadId);
  }

  function markTurnCompleted(threadId, turnId) {
    const normalizedThreadId = normalizeTimelineId(threadId);
    const resolvedTurnId = resolveTurnId(threadId, turnId);
    if (resolvedTurnId) {
      completedTurnKeys.add(buildTurnScopeKey(normalizedThreadId, resolvedTurnId));
      trimSet(completedTurnKeys, MAX_COMPLETED_TURN_KEYS);
    }
    const activeTurnId = normalizeTimelineId(activeTurnIdByThread.get(normalizedThreadId));
    if (!activeTurnId || activeTurnId === resolvedTurnId) {
      activeTurnIdByThread.delete(normalizedThreadId);
    }
    protectedRunningFallbackThreads.delete(normalizedThreadId);
  }

  function clearThreadState(threadId) {
    const normalizedThreadId = normalizeTimelineId(threadId);
    activeTurnIdByThread.delete(normalizedThreadId);
    protectedRunningFallbackThreads.delete(normalizedThreadId);
    for (const key of [...completedTurnKeys]) {
      if (key.startsWith(`${normalizedThreadId}|`)) {
        completedTurnKeys.delete(key);
      }
    }
    for (const key of [...fileChangeTextByTurn.keys()]) {
      if (key.startsWith(`${normalizedThreadId}|`)) {
        fileChangeTextByTurn.delete(key);
      }
    }
    for (const key of [...activityFooterByTurn.keys()]) {
      if (key.startsWith(`${normalizedThreadId}|`)) {
        activityFooterByTurn.delete(key);
      }
    }
  }

  function takeTurnFileChangeSummary(threadId, turnId) {
    const turnScopeKey = buildTurnScopeKey(threadId, turnId);
    const sourceText = fileChangeTextByTurn.get(turnScopeKey) || "";
    clearTurnConversationState(turnScopeKey);
    return parseTelegramFileChangeSummary(sourceText);
  }

  function project(rawMessage) {
    const event = parseBridgeTimelineEvent(rawMessage);
    if (!event) {
      return {
        handled: false,
        duplicate: false,
        conversationActions: [],
        controlActions: [],
      };
    }

    const dedupeKey = buildTimelineDedupeKey(event);
    const shouldDedupe = shouldDedupeTimelineEvent(event);
    if (shouldDedupe && seenKeys.has(dedupeKey)) {
      return {
        handled: true,
        duplicate: true,
        conversationActions: [],
        controlActions: [],
      };
    }
    if (shouldDedupe) {
      seenKeys.add(dedupeKey);
      trimSet(seenKeys, MAX_SEEN_EVENT_KEYS);
    }

    const controlActions = [];
    const conversationActions = [];

    if (event.kind === "approval") {
      controlActions.push({ type: "approval", request: event.request });
      return {
        handled: true,
        duplicate: false,
        conversationActions,
        controlActions,
      };
    }

    if (event.kind === "userInput") {
      controlActions.push({ type: "userInput", request: event.request });
      return {
        handled: true,
        duplicate: false,
        conversationActions,
        controlActions,
      };
    }

    if (event.kind === "streamingDelta") {
      const resolvedTurnId = resolveTurnId(event.threadId, event.turnId);
      const late = Boolean(
        resolvedTurnId
        && isTurnCompleted(event.threadId, resolvedTurnId)
        && !isActiveTurnForThread(event.threadId, resolvedTurnId)
      );
      conversationActions.push({
        type: late ? "streamingLateDelta" : "streamingDelta",
        threadId: event.threadId,
        turnId: resolvedTurnId,
        delta: event.delta,
        itemId: event.itemId,
        method: event.method,
        params: event.params,
      });
      return {
        handled: true,
        duplicate: false,
        conversationActions,
        controlActions,
      };
    }

    if (event.kind === "fileChangeDelta") {
      const resolvedTurnId = resolveTurnId(event.threadId, event.turnId);
      if (
        resolvedTurnId
        && isTurnCompleted(event.threadId, resolvedTurnId)
        && !isActiveTurnForThread(event.threadId, resolvedTurnId)
      ) {
        return {
          handled: true,
          duplicate: false,
          conversationActions,
          controlActions,
        };
      }
      const turnScopeKey = buildTurnScopeKey(
        event.threadId,
        resolvedTurnId || normalizeTimelineId(activeTurnIdByThread.get(normalizeTimelineId(event.threadId))) || "active",
      );
      fileChangeTextByTurn.set(
        turnScopeKey,
        mergeFileChangeSummaryText(fileChangeTextByTurn.get(turnScopeKey), event.delta),
      );
      return {
        handled: true,
        duplicate: false,
        conversationActions,
        controlActions,
      };
    }

    if (event.kind === "activityFooter") {
      const resolvedTurnId = resolveTurnId(event.threadId, event.turnId);
      if (
        resolvedTurnId
        && isTurnCompleted(event.threadId, resolvedTurnId)
        && !isActiveTurnForThread(event.threadId, resolvedTurnId)
      ) {
        return {
          handled: true,
          duplicate: false,
          conversationActions,
          controlActions,
        };
      }
      const turnScopeKey = buildTurnScopeKey(
        event.threadId,
        resolvedTurnId || normalizeTimelineId(activeTurnIdByThread.get(normalizeTimelineId(event.threadId))) || "active",
      );
      activityFooterByTurn.set(turnScopeKey, event.activity);
      conversationActions.push({
        type: "streamingActivityFooter",
        threadId: event.threadId,
        turnId: resolvedTurnId,
        activity: event.activity,
      });
      return {
        handled: true,
        duplicate: false,
        conversationActions,
        controlActions,
      };
    }

    if (event.kind === "threadEvent") {
      const resolvedTurnId = resolveTurnId(event.threadId, event.turnId);
      const resolvedEvent = {
        method: event.method,
        params: event.params,
        threadId: event.threadId,
        turnId: resolvedTurnId,
        itemId: event.itemId,
      };

      if (event.method === "turn/started") {
        markTurnStarted(event.threadId, event.turnId);
        conversationActions.push({
          type: "threadEvent",
          event: resolvedEvent,
        });
        return {
          handled: true,
          duplicate: false,
          conversationActions,
          controlActions,
        };
      }

      const late = event.method !== "turn/completed"
        && Boolean(
          resolvedTurnId
          && isTurnCompleted(event.threadId, resolvedTurnId)
          && !isActiveTurnForThread(event.threadId, resolvedTurnId)
        );

      if (event.method === "turn/completed") {
        markTurnCompleted(event.threadId, event.turnId);
        const summary = takeTurnFileChangeSummary(event.threadId, resolvedTurnId);
        if (summary?.entries?.length) {
          conversationActions.push({
            type: "turnFileChangeSummary",
            threadId: event.threadId,
            turnId: resolvedTurnId,
            summary,
          });
        }
      }

      conversationActions.push({
        type: late ? "threadEventLate" : "threadEvent",
        event: resolvedEvent,
      });
      return {
        handled: true,
        duplicate: false,
        conversationActions,
        controlActions,
      };
    }

    return {
      handled: false,
      duplicate: false,
      conversationActions: [],
      controlActions: [],
    };
  }

  return {
    project,
    resolveTurnId,
    hasProtectedRunningFallback,
    clearThreadState,
    getActiveTurnId(threadId) {
      return normalizeTimelineId(activeTurnIdByThread.get(normalizeTimelineId(threadId))) || "";
    },
  };
}

module.exports = {
  ACTIVITY_FOOTER_METHODS,
  APPROVAL_REQUEST_METHODS,
  FILE_CHANGE_DELTA_METHODS,
  THREAD_EVENT_METHODS,
  USER_INPUT_REQUEST_METHODS,
  buildTimelineDedupeKey,
  buildTurnScopeKey,
  createTelegramTimelineProjector,
  parseBridgeTimelineEvent,
  shouldDedupeTimelineEvent,
};
