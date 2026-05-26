// FILE: opencode-runtime-adapter.js
// Purpose: Adapts Remodex runtime requests to a local OpenCode server.
// Layer: Bridge adapter
// Exports: createOpenCodeRuntimeAdapter
// Depends on: ./agent-runtime-capabilities, ./canonical-events

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  OPENCODE_DEFAULT_BUILD_AGENT_NAME,
  OPENCODE_DEFAULT_PLAN_AGENT_NAME,
  buildRuntimeListEntry,
  getAgentRuntimeCapabilities,
} = require("./agent-runtime-capabilities");
const {
  createOpenCodeModelCatalogProvider,
  createOpenCodeModelCatalog,
  openCodeModelPayloadForSelection,
  resolveRuntimeModelSelection,
} = require("./agent-runtime-model-catalog");
const {
  CANONICAL_EVENT_TYPES,
  createCanonicalEvent,
} = require("./canonical-events");
const {
  PERMISSION_REQUEST_METHOD,
  USER_INPUT_REQUEST_METHOD,
  convertOpenCodeEventToCanonical,
  createOpenCodeCanonicalState,
} = require("./opencode-to-canonical-adapter");
const { discoverOpenCodeAgents } = require("./opencode-agent-discovery");

function createOpenCodeRuntimeAdapter({
  id = "opencode",
  displayName = "OpenCode",
  serverManager,
  threadAgentState,
  modelCatalogProvider = createOpenCodeModelCatalogProvider(),
  completionGraceMs = 1_500,
  fsImpl = fs,
  discoverAgents = discoverOpenCodeAgents,
} = {}) {
  if (!serverManager) {
    throw new Error("OpenCode runtime adapter requires a serverManager.");
  }
  if (!threadAgentState) {
    throw new Error("OpenCode runtime adapter requires threadAgentState.");
  }

  const activeTurnsBySessionId = new Map();
  const pendingPermissionsById = new Map();
  const pendingQuestionsById = new Map();
  let eventSubscription = null;

  return {
    id,
    displayName,
    getCapabilities() {
      return getAgentRuntimeCapabilities(id);
    },
    async getRuntimeListEntry() {
      const serverStatus = serverManager.getStatus?.() || { state: "stopped" };
      const mappedStatus = mapOpenCodeRuntimeStatus(serverStatus.state, fsImpl);
      const modelCatalog = await resolveOpenCodeModelCatalog();
      const openCodeAgents = discoverAgents({ fsImpl });
      return buildRuntimeListEntry({
        id,
        status: mappedStatus.status,
        statusMessage: mappedStatus.statusMessage,
        capabilities: getAgentRuntimeCapabilities(id),
        modelCatalog,
        openCodeAgents,
      });
    },
    async handleRuntimeRequest(context = {}) {
      const method = typeof context.parsed?.method === "string" ? context.parsed.method.trim() : "";
      if (method === "thread/start") {
        return handleThreadStart(context);
      }
      if (method === "thread/resume") {
        return handleThreadResume(context);
      }
      if (method === "thread/read") {
        return handleThreadRead(context);
      }
      if (method === "thread/turns/list") {
        return handleThreadTurnsList(context);
      }
      if (method === "thread/fork") {
        return handleThreadFork(context);
      }
      if (method === "thread/compact/start") {
        return handleThreadCompactStart(context);
      }
      if (method === "turn/start") {
        return handleTurnStart(context);
      }
      if (method === "turn/interrupt" || method === "turn/stop") {
        return handleTurnStop(context);
      }
      throw new Error(`OpenCode runtime does not support ${method} yet.`);
    },
    async handleRuntimeResponse(context = {}) {
      return handleRuntimeResponse(context);
    },
    stopAll() {
      eventSubscription?.close?.();
      eventSubscription = null;
      for (const activeTurn of activeTurnsBySessionId.values()) {
        clearCompletionTimer(activeTurn);
      }
      activeTurnsBySessionId.clear();
      pendingPermissionsById.clear();
      pendingQuestionsById.clear();
    },
  };

  async function handleThreadResume({ parsed, sendResponse }) {
    await ensureServerReady(parsed.params);
    const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
    const threadId = extractThreadId(params);
    if (!threadId) {
      throw new Error("OpenCode thread/resume requires a thread id.");
    }

    const record = threadAgentState.get(threadId);
    const agentSessionId = readString(record?.agentSessionId)
      || readString(params.agentSessionId)
      || readString(params.agent_session_id);
    if (!agentSessionId) {
      return handleThreadStart({ parsed, sendResponse });
    }

    const session = await serverManager.request(
      "GET",
      `/session/${encodeURIComponent(agentSessionId)}`,
    );

    threadAgentState.upsert(threadId, {
      agentRuntime: id,
      agentSessionId,
      cwd: readString(record?.cwd) || readString(params.cwd) || readString(params.workingDirectory),
      opencodeBuildAgentName: readString(record?.opencodeBuildAgentName)
        || readString(params.opencodeBuildAgentName)
        || readString(params.opencode_build_agent_name)
        || OPENCODE_DEFAULT_BUILD_AGENT_NAME,
      opencodePlanAgentName: readString(record?.opencodePlanAgentName)
        || readString(params.opencodePlanAgentName)
        || readString(params.opencode_plan_agent_name)
        || OPENCODE_DEFAULT_PLAN_AGENT_NAME,
      model: readString(record?.model)
        || runtimeModelIdentifierFromSession(session)
        || readString(params.model)
        || readString(params.runtimeModel)
        || readString(params.runtime_model),
      modelProvider: readString(record?.modelProvider)
        || runtimeModelProviderFromSession(session)
        || readString(params.modelProvider)
        || readString(params.model_provider),
      modelVariant: readString(record?.modelVariant)
        || runtimeModelVariantFromSession(session)
        || readString(params.modelVariant)
        || readString(params.model_variant)
        || readString(params.variant),
      runtimeLocked: true,
    });

    ensureEventSubscription();
    sendJsonRpcResult(sendResponse, parsed.id, {
      thread: {
        id: threadId,
        title: readString(session?.title) || readString(params.title),
        agentRuntime: id,
        agentSessionId,
      },
    });
    return { responded: true };
  }

  async function handleThreadRead({ parsed, threadId, sendResponse }) {
    await ensureServerReady(parsed.params);
    const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
    const resolvedThreadId = threadId || extractThreadId(params);
    const { record, agentSessionId } = resolveKnownThreadSession(resolvedThreadId, params, "thread/read");
    const thread = await readOpenCodeThreadPayload(resolvedThreadId, agentSessionId, record);

    sendJsonRpcResult(sendResponse, parsed.id, { thread });
    return { responded: true };
  }

  async function handleThreadTurnsList({ parsed, threadId, sendResponse }) {
    await ensureServerReady(parsed.params);
    const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
    const resolvedThreadId = threadId || extractThreadId(params);
    const { record, agentSessionId } = resolveKnownThreadSession(resolvedThreadId, params, "thread/turns/list");
    const messages = await readOpenCodeSessionMessages(agentSessionId);
    const turns = buildOpenCodeTurnsFromMessages(messages);
    const sortDirection = readString(params.sortDirection) || readString(params.sort_direction) || "asc";
    const ordered = sortDirection.toLowerCase() === "desc" ? [...turns].reverse() : turns;
    const limit = normalizePositiveInteger(params.limit, 50);
    const offset = parseTurnsCursor(params.cursor);
    const data = ordered.slice(offset, offset + limit);
    const nextOffset = offset + data.length;
    const nextCursor = nextOffset < ordered.length ? `opencode-offset:${nextOffset}` : null;

    sendJsonRpcResult(sendResponse, parsed.id, {
      data,
      items: data,
      turns: data,
      nextCursor,
      agentRuntime: id,
      agentSessionId,
      threadId: resolvedThreadId,
      model: record.model,
      modelProvider: record.modelProvider,
    });
    return { responded: true };
  }

  async function handleThreadFork({ parsed, threadId, sendResponse }) {
    await ensureServerReady(parsed.params);
    const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
    const sourceThreadId = threadId || extractThreadId(params);
    const { record, agentSessionId } = resolveKnownThreadSession(sourceThreadId, params, "thread/fork");
    const messageID = readString(params.messageID)
      || readString(params.messageId)
      || readString(params.message_id);
    const forkedSession = await serverManager.request(
      "POST",
      `/session/${encodeURIComponent(agentSessionId)}/fork`,
      { body: messageID ? { messageID } : undefined }
    );
    const forkedSessionId = readString(forkedSession?.id);
    if (!forkedSessionId) {
      throw new Error("OpenCode fork did not return a session id.");
    }
    const forkedThreadId = readString(params.targetThreadId)
      || readString(params.target_thread_id)
      || readString(params.newThreadId)
      || readString(params.new_thread_id)
      || `opencode-${forkedSessionId}`;
    const forkedModel = runtimeModelIdentifierFromSession(forkedSession) || record.model;
    const forkedModelProvider = runtimeModelProviderFromSession(forkedSession) || record.modelProvider;
    const forkedRecord = threadAgentState.upsert(forkedThreadId, {
      agentRuntime: id,
      agentSessionId: forkedSessionId,
      cwd: readString(forkedSession?.directory) || record.cwd,
      opencodeBuildAgentName: record.opencodeBuildAgentName,
      opencodePlanAgentName: record.opencodePlanAgentName,
      model: forkedModel,
      modelProvider: forkedModelProvider,
      modelVariant: runtimeModelVariantFromSession(forkedSession) || record.modelVariant,
      runtimeLocked: true,
    });

    sendJsonRpcResult(sendResponse, parsed.id, {
      thread: buildThreadSummary(forkedThreadId, forkedSession, forkedRecord, {
        forkedFromThreadId: sourceThreadId,
      }),
    });
    return { responded: true };
  }

  async function handleThreadCompactStart({ parsed, threadId, sendResponse }) {
    await ensureServerReady(parsed.params);
    const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
    const resolvedThreadId = threadId || extractThreadId(params);
    const { record, agentSessionId } = resolveKnownThreadSession(resolvedThreadId, params, "thread/compact/start");
    const modelCatalog = await resolveOpenCodeModelCatalog();
    const modelSelection = resolveRuntimeModelSelection(params, record || {}, modelCatalog);
    if (!modelSelection) {
      throw new Error("OpenCode thread/compact/start requires an available OpenCode model.");
    }
    const nativeModel = openCodeModelPayloadForSelection(modelSelection);
    if (!nativeModel) {
      throw new Error(`OpenCode model "${modelSelection.id}" is missing provider/model identity.`);
    }

    const turnId = extractTurnId(params) || `opencode-compact-${Date.now()}`;
    ensureEventSubscription();
    const activeTurn = {
      threadId: resolvedThreadId,
      agentSessionId,
      turnId,
      sendResponse,
      accepted: true,
      completed: false,
      lastErrorMessage: "",
      bufferedMessages: [],
      state: createOpenCodeCanonicalState(),
      completionTimer: null,
      pendingCompletion: null,
    };
    activeTurnsBySessionId.set(agentSessionId, activeTurn);

    persistThreadModelSelection(resolvedThreadId, record, modelSelection);
    sendJsonRpcResult(sendResponse, parsed.id, {
      turnId,
      agentRuntime: id,
      agentSessionId,
    });
    sendCanonical(sendResponse, CANONICAL_EVENT_TYPES.TURN_STARTED, {
      threadId: resolvedThreadId,
      agentSessionId,
      turnId,
      payload: {
        kind: "context_compaction",
      },
    });

    void serverManager.request("POST", `/session/${encodeURIComponent(agentSessionId)}/summarize`, {
      body: {
        providerID: nativeModel.providerID,
        modelID: nativeModel.modelID,
        auto: params.auto === true,
      },
    }).then(() => {
      if (!activeTurn.completed) {
        scheduleActiveTurnCompletion(activeTurn, { status: "completed" });
      }
    }).catch((error) => {
      activeTurn.lastErrorMessage = error?.message || "OpenCode compaction failed.";
      sendCanonical(activeTurn.sendResponse, CANONICAL_EVENT_TYPES.ERROR, {
        threadId: activeTurn.threadId,
        agentSessionId: activeTurn.agentSessionId,
        turnId: activeTurn.turnId,
        payload: {
          message: activeTurn.lastErrorMessage,
        },
      });
      void completeActiveTurn(activeTurn, { status: "failed", skipDiff: true });
    });
    return { responded: true };
  }

  async function handleThreadStart({ parsed, sendResponse }) {
    await ensureServerReady(parsed.params);
    const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
    const threadId = extractThreadId(params) || `opencode-${Date.now()}`;
    const session = await serverManager.request("POST", "/session", {
      body: {
        title: readString(params.title) || readString(params.prompt) || "Remodex",
      },
    });
    const agentSessionId = readString(session?.id);
    if (!agentSessionId) {
      throw new Error("OpenCode did not return a session id.");
    }

    const record = threadAgentState.upsert(threadId, {
      agentRuntime: id,
      agentSessionId,
      cwd: readString(params.cwd) || readString(params.workingDirectory),
      opencodeBuildAgentName: readString(params.opencodeBuildAgentName)
        || readString(params.opencode_build_agent_name)
        || OPENCODE_DEFAULT_BUILD_AGENT_NAME,
      opencodePlanAgentName: readString(params.opencodePlanAgentName)
        || readString(params.opencode_plan_agent_name)
        || OPENCODE_DEFAULT_PLAN_AGENT_NAME,
      model: readString(params.model)
        || readString(params.runtimeModel)
        || readString(params.runtime_model),
      modelProvider: readString(params.modelProvider)
        || readString(params.model_provider)
        || readString(params.providerID)
        || readString(params.provider_id),
      modelVariant: readString(params.modelVariant)
        || readString(params.model_variant)
        || readString(params.variant),
      runtimeLocked: true,
    });

    sendJsonRpcResult(sendResponse, parsed.id, {
      thread: buildThreadSummary(threadId, {
        ...session,
        title: readString(session.title) || readString(params.title),
      }, record),
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
    await ensureServerReady(parsed.params);
    const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
    const record = threadId ? threadAgentState.get(threadId) : null;
    const agentSessionId = readString(record?.agentSessionId) || readString(params.agentSessionId);
    if (!threadId || !agentSessionId) {
      throw new Error("OpenCode turn/start requires a known thread and agent session.");
    }
    const turnId = extractTurnId(params) || `opencode-turn-${Date.now()}`;
    const parts = buildOpenCodePromptParts(params);
    if (parts.length === 0) {
      throw new Error("OpenCode turn/start requires non-empty prompt text.");
    }
    ensureEventSubscription();
    const activeTurn = {
      threadId,
      agentSessionId,
      turnId,
      sendResponse,
      accepted: false,
      completed: false,
      lastErrorMessage: "",
      bufferedMessages: [],
      state: createOpenCodeCanonicalState(),
      completionTimer: null,
      pendingCompletion: null,
    };
    activeTurnsBySessionId.set(agentSessionId, activeTurn);

    const modelCatalog = await resolveOpenCodeModelCatalog();
    const modelSelection = resolveRuntimeModelSelection(params, record || {}, modelCatalog);
    if (!modelSelection) {
      throw new Error("OpenCode turn/start requires an available OpenCode model.");
    }
    const nativeModel = openCodeModelPayloadForSelection(modelSelection);
    if (!nativeModel) {
      throw new Error(`OpenCode model "${modelSelection.id}" is missing provider/model identity.`);
    }
    const modelVariant = readString(params.modelVariant)
      || readString(params.model_variant)
      || readString(params.variant)
      || readString(record?.modelVariant);
    if (modelVariant) {
      nativeModel.variant = modelVariant;
    }
    persistThreadModelSelection(threadId, record, {
      ...modelSelection,
      variant: modelVariant,
    });

    try {
      await serverManager.request("POST", `/session/${encodeURIComponent(agentSessionId)}/prompt_async`, {
        body: {
          parts,
          agent: chooseOpenCodeAgentName(params, record),
          model: nativeModel,
        },
      });
    } catch (error) {
      if (activeTurnsBySessionId.get(agentSessionId) === activeTurn) {
        activeTurnsBySessionId.delete(agentSessionId);
      }
      throw error;
    }

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
    activeTurn.accepted = true;
    await flushBufferedMessages(activeTurn);
    return { responded: true };
  }

  async function handleTurnStop({ parsed, threadId, sendResponse }) {
    await ensureServerReady(parsed.params);
    const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
    const record = threadId ? threadAgentState.get(threadId) : null;
    const agentSessionId = readString(record?.agentSessionId) || readString(params.agentSessionId);
    if (!agentSessionId) {
      throw new Error("OpenCode stop requires a known agent session.");
    }
    const aborted = await serverManager.request("POST", `/session/${encodeURIComponent(agentSessionId)}/abort`);
    sendJsonRpcResult(sendResponse, parsed.id, {
      aborted: aborted !== false,
      agentRuntime: id,
      agentSessionId,
    });
    return { responded: true };
  }

  async function handleRuntimeResponse({ rawMessage, parsed, sendResponse } = {}) {
    const message = parsed || parseJsonRpcMessage(rawMessage);
    if (!message || message.method || message.id == null) {
      return false;
    }
    const pendingPermission = pendingPermissionsById.get(String(message.id));
    if (pendingPermission) {
      const response = openCodePermissionResponseForResult(message.result);
      await serverManager.request(
        "POST",
        `/session/${encodeURIComponent(pendingPermission.agentSessionId)}/permissions/${encodeURIComponent(pendingPermission.permissionId)}`,
        { body: { response } }
      );
      pendingPermissionsById.delete(String(message.id));
      sendResponse?.(JSON.stringify({
        method: "serverRequest/resolved",
        params: {
          threadId: pendingPermission.threadId,
          requestId: pendingPermission.permissionId,
        },
      }));
      return true;
    }

    const pendingQuestion = pendingQuestionsById.get(String(message.id));
    if (!pendingQuestion) {
      return false;
    }

    if (isRejectedQuestionResponse(message.result)) {
      await serverManager.request(
        "POST",
        `/question/${encodeURIComponent(pendingQuestion.questionRequestId)}/reject`,
      );
    } else {
      await serverManager.request(
        "POST",
        `/question/${encodeURIComponent(pendingQuestion.questionRequestId)}/reply`,
        { body: { answers: openCodeQuestionAnswersForResult(message.result, pendingQuestion.questionIds) } }
      );
    }
    pendingQuestionsById.delete(String(message.id));
    sendResponse?.(JSON.stringify({
      method: "serverRequest/resolved",
      params: {
        threadId: pendingQuestion.threadId,
        requestId: pendingQuestion.questionRequestId,
      },
    }));
    return true;
  }

  function ensureEventSubscription() {
    if (eventSubscription) {
      return;
    }
    if (typeof serverManager.subscribeEvents !== "function") {
      throw new Error("OpenCode runtime requires an event stream subscription.");
    }

    eventSubscription = serverManager.subscribeEvents({
      onEvent(event) {
        void handleOpenCodeEvent(event);
      },
      onError(error) {
        for (const activeTurn of activeTurnsBySessionId.values()) {
          activeTurn.lastErrorMessage = error?.message || "OpenCode event stream failed.";
          sendCanonical(activeTurn.sendResponse, CANONICAL_EVENT_TYPES.ERROR, {
            threadId: activeTurn.threadId,
            agentSessionId: activeTurn.agentSessionId,
            turnId: activeTurn.turnId,
            payload: {
              message: activeTurn.lastErrorMessage,
            },
          });
        }
      },
    });
    eventSubscription?.closed?.catch?.(() => {
      if (eventSubscription?.closed) {
        eventSubscription = null;
      }
    });
  }

  async function handleOpenCodeEvent(event) {
    const sessionId = extractOpenCodeEventSessionId(event);
    if (!sessionId) {
      return;
    }
    const activeTurn = activeTurnsBySessionId.get(sessionId);
    if (!activeTurn) {
      return;
    }

    const canonicalMessages = convertOpenCodeEventToCanonical(event, {
      threadId: activeTurn.threadId,
      agentSessionId: activeTurn.agentSessionId,
      turnId: activeTurn.turnId,
      state: activeTurn.state,
    });
    if (canonicalMessages.length === 0) {
      return;
    }
    if (!activeTurn.accepted) {
      activeTurn.bufferedMessages.push(...canonicalMessages);
      return;
    }
    for (const canonicalMessage of canonicalMessages) {
      await processCanonicalMessage(activeTurn, canonicalMessage);
    }
  }

  async function flushBufferedMessages(activeTurn) {
    const messages = activeTurn.bufferedMessages.splice(0);
    for (const message of messages) {
      await processCanonicalMessage(activeTurn, message);
    }
  }

  async function processCanonicalMessage(activeTurn, canonicalMessage) {
    if (canonicalMessage.method === PERMISSION_REQUEST_METHOD) {
      const permissionId = readString(canonicalMessage.params?.permissionId) || readString(canonicalMessage.id);
      if (permissionId) {
        pendingPermissionsById.set(String(canonicalMessage.id || permissionId), {
          agentSessionId: activeTurn.agentSessionId,
          permissionId,
          threadId: activeTurn.threadId,
        });
      }
      sendCanonicalMessage(activeTurn.sendResponse, canonicalMessage);
      return;
    }

    if (canonicalMessage.method === USER_INPUT_REQUEST_METHOD) {
      const questionRequestId = readString(canonicalMessage.params?.questionRequestId)
        || readString(canonicalMessage.params?.requestId)
        || readString(canonicalMessage.id);
      if (questionRequestId) {
        const questions = Array.isArray(canonicalMessage.params?.questions) ? canonicalMessage.params.questions : [];
        pendingQuestionsById.set(String(canonicalMessage.id || questionRequestId), {
          agentSessionId: activeTurn.agentSessionId,
          questionRequestId,
          questionIds: questions.map((question) => readString(question?.id)).filter(Boolean),
          threadId: activeTurn.threadId,
        });
      }
      sendCanonicalMessage(activeTurn.sendResponse, canonicalMessage);
      return;
    }

    sendCanonicalMessage(activeTurn.sendResponse, canonicalMessage);
    if (canonicalMessage.method === "remodex/event/assistant_completed") {
      scheduleActiveTurnCompletion(activeTurn, { status: "completed" });
    } else if (canonicalMessage.method === "remodex/event/error") {
      activeTurn.lastErrorMessage = readString(canonicalMessage.params?.payload?.message)
        || readString(canonicalMessage.params?.error?.message)
        || activeTurn.lastErrorMessage;
      await completeActiveTurn(activeTurn, { status: "failed", skipDiff: true });
    } else if (activeTurn.pendingCompletion) {
      scheduleActiveTurnCompletion(activeTurn, activeTurn.pendingCompletion);
    }
  }

  async function resolveOpenCodeModelCatalog() {
    try {
      return await modelCatalogProvider.get();
    } catch (error) {
      return createOpenCodeModelCatalog({
        status: "degraded",
        statusMessage: `OpenCode model discovery failed; showing recovery fallbacks. ${error?.message || ""}`.trim(),
      });
    }
  }

  function scheduleActiveTurnCompletion(activeTurn, completion) {
    if (activeTurn.completed) {
      return;
    }
    activeTurn.pendingCompletion = completion;
    clearCompletionTimer(activeTurn);
    if (completionGraceMs <= 0) {
      void completeActiveTurn(activeTurn, completion);
      return;
    }
    activeTurn.completionTimer = setTimeout(() => {
      activeTurn.completionTimer = null;
      const pendingCompletion = activeTurn.pendingCompletion;
      activeTurn.pendingCompletion = null;
      void completeActiveTurn(activeTurn, pendingCompletion);
    }, completionGraceMs);
  }

  function clearCompletionTimer(activeTurn) {
    if (activeTurn?.completionTimer) {
      clearTimeout(activeTurn.completionTimer);
      activeTurn.completionTimer = null;
    }
  }

  async function completeActiveTurn(activeTurn, { status, skipDiff = false } = {}) {
    if (activeTurn.completed) {
      return;
    }
    clearCompletionTimer(activeTurn);
    activeTurn.pendingCompletion = null;
    activeTurn.completed = true;
    if (!skipDiff) {
      await emitSessionDiff(activeTurn);
    }
    sendCanonical(activeTurn.sendResponse, CANONICAL_EVENT_TYPES.TURN_COMPLETED, {
      threadId: activeTurn.threadId,
      agentSessionId: activeTurn.agentSessionId,
      turnId: activeTurn.turnId,
      payload: {
        status: readString(status) || "completed",
        ...(readString(status) === "failed" && activeTurn.lastErrorMessage
          ? { error: { message: activeTurn.lastErrorMessage } }
          : {}),
      },
    });
    if (activeTurnsBySessionId.get(activeTurn.agentSessionId) === activeTurn) {
      activeTurnsBySessionId.delete(activeTurn.agentSessionId);
    }
  }

  async function emitSessionDiff(activeTurn) {
    try {
      const diff = await serverManager.request("GET", `/session/${encodeURIComponent(activeTurn.agentSessionId)}/diff`);
      sendCanonical(activeTurn.sendResponse, CANONICAL_EVENT_TYPES.DIFF_UPDATED, {
        threadId: activeTurn.threadId,
        agentSessionId: activeTurn.agentSessionId,
        turnId: activeTurn.turnId,
        payload: {
          diff: diff ?? null,
        },
      });
    } catch (error) {
      sendCanonical(activeTurn.sendResponse, CANONICAL_EVENT_TYPES.ERROR, {
        threadId: activeTurn.threadId,
        agentSessionId: activeTurn.agentSessionId,
        turnId: activeTurn.turnId,
        payload: {
          message: error?.message || "OpenCode diff refresh failed.",
        },
      });
    }
  }

  async function ensureServerReady(params = {}) {
    const status = serverManager.getStatus?.() || { state: "stopped" };
    if (status.state === "ready" && status.baseUrl) {
      return;
    }
    serverManager.start?.({
      cwd: readString(params.cwd) || readString(params.workingDirectory),
    });
    const nextStatus = await waitForServerReady();
    if (nextStatus.state !== "ready" || !nextStatus.baseUrl) {
      throw new Error("OpenCode server is not ready.");
    }
  }

  async function waitForServerReady({
    timeoutMs = 5_000,
    intervalMs = 50,
  } = {}) {
    const startedAt = Date.now();
    let latestStatus = serverManager.getStatus?.() || {};
    while (Date.now() - startedAt <= timeoutMs) {
      latestStatus = serverManager.getStatus?.() || {};
      if (latestStatus.state === "ready" && latestStatus.baseUrl) {
        return latestStatus;
      }
      if (["error", "not_installed", "stopped"].includes(latestStatus.state)) {
        return latestStatus;
      }
      await delay(intervalMs);
    }
    return latestStatus;
  }

  function resolveKnownThreadSession(threadId, params = {}, methodName = "OpenCode request") {
    const resolvedThreadId = readString(threadId) || extractThreadId(params);
    if (!resolvedThreadId) {
      throw new Error(`OpenCode ${methodName} requires a thread id.`);
    }
    const record = threadAgentState.get(resolvedThreadId);
    const agentSessionId = readString(record?.agentSessionId)
      || readString(params.agentSessionId)
      || readString(params.agent_session_id);
    if (!agentSessionId) {
      throw new Error(`OpenCode ${methodName} requires a known agent session.`);
    }
    return {
      record: record || {},
      agentSessionId,
    };
  }

  async function readOpenCodeThreadPayload(threadId, agentSessionId, record = {}) {
    const [session, messages] = await Promise.all([
      serverManager.request("GET", `/session/${encodeURIComponent(agentSessionId)}`),
      readOpenCodeSessionMessages(agentSessionId),
    ]);
    return {
      ...buildThreadSummary(threadId, session, {
        ...record,
        agentSessionId,
        model: record.model || runtimeModelIdentifierFromSession(session),
        modelProvider: record.modelProvider || runtimeModelProviderFromSession(session),
        modelVariant: record.modelVariant || runtimeModelVariantFromSession(session),
      }),
      turns: buildOpenCodeTurnsFromMessages(messages),
    };
  }

  async function readOpenCodeSessionMessages(agentSessionId) {
    const response = await serverManager.request("GET", `/session/${encodeURIComponent(agentSessionId)}/message`);
    return normalizeOpenCodeMessagesResponse(response);
  }

  function buildThreadSummary(threadId, session = {}, record = {}, extras = {}) {
    const model = record.model || runtimeModelIdentifierFromSession(session);
    const modelProvider = record.modelProvider || runtimeModelProviderFromSession(session);
    const modelVariant = record.modelVariant || runtimeModelVariantFromSession(session);
    return omitEmpty({
      id: threadId,
      title: readString(session?.title),
      name: readString(session?.title),
      cwd: readString(session?.directory) || readString(record.cwd),
      createdAt: session?.time?.created,
      updatedAt: session?.time?.updated,
      agentRuntime: id,
      agentSessionId: readString(record.agentSessionId) || readString(session?.id),
      opencodeBuildAgentName: readString(record.opencodeBuildAgentName) || OPENCODE_DEFAULT_BUILD_AGENT_NAME,
      opencodePlanAgentName: readString(record.opencodePlanAgentName) || OPENCODE_DEFAULT_PLAN_AGENT_NAME,
      model,
      modelProvider,
      modelVariant,
      forkedFromThreadId: readString(extras.forkedFromThreadId) || readString(session?.parentID),
    });
  }

  function persistThreadModelSelection(threadId, record = {}, selection = {}) {
    const providerID = readString(selection.providerID);
    const modelID = readString(selection.modelID);
    const model = readString(selection.model) || readString(selection.id) || (providerID && modelID ? `${providerID}/${modelID}` : "");
    threadAgentState.upsert(threadId, {
      agentRuntime: id,
      agentSessionId: record.agentSessionId,
      cwd: record.cwd,
      opencodeBuildAgentName: record.opencodeBuildAgentName,
      opencodePlanAgentName: record.opencodePlanAgentName,
      model,
      modelProvider: providerID || record.modelProvider,
      modelVariant: readString(selection.variant) || record.modelVariant,
      runtimeLocked: true,
    });
  }

  function chooseOpenCodeAgentName(params, record) {
    const collaborationMode = params.collaborationMode && typeof params.collaborationMode === "object"
      ? params.collaborationMode
      : params.collaboration_mode && typeof params.collaboration_mode === "object"
        ? params.collaboration_mode
        : {};
    const mode = readString(params.mode)
      || readString(params.turnMode)
      || readString(params.turn_mode)
      || readString(collaborationMode.mode)
      || readString(collaborationMode.kind);
    if (mode === "plan") {
      return readString(record?.opencodePlanAgentName) || OPENCODE_DEFAULT_PLAN_AGENT_NAME;
    }
    return readString(record?.opencodeBuildAgentName) || OPENCODE_DEFAULT_BUILD_AGENT_NAME;
  }

  function sendCanonical(sendResponse, type, {
    threadId,
    agentSessionId,
    turnId,
    itemId,
    payload,
  }) {
    if (typeof sendResponse !== "function") {
      return;
    }
    sendResponse(JSON.stringify(createCanonicalEvent({
      type,
      agentRuntime: id,
      threadId,
      agentSessionId,
      turnId,
      itemId,
      payload,
    })));
  }
}

function sendCanonicalMessage(sendResponse, canonicalMessage) {
  if (typeof sendResponse !== "function") {
    return;
  }
  sendResponse(JSON.stringify(canonicalMessage));
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

function mapOpenCodeRuntimeStatus(state, fsImpl) {
  const mapped = mapServerStatus(state);
  if (mapped.status === "ready" && !hasOpenCodeAuthConfigured(fsImpl)) {
    return {
      status: "needs_auth",
      statusMessage: "Sign in to OpenCode on this Mac before starting OpenCode threads.",
    };
  }
  return mapped;
}

function hasOpenCodeAuthConfigured(fsImpl = fs) {
  const authPath = path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
  if (!fsImpl.existsSync(authPath)) {
    return false;
  }
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(authPath, "utf8"));
    return Boolean(parsed && typeof parsed === "object" && Object.keys(parsed).length > 0);
  } catch {
    return false;
  }
}

function mapServerStatus(state) {
  if (state === "ready") {
    return { status: "ready", statusMessage: "" };
  }
  if (state === "stopped") {
    return { status: "ready", statusMessage: "OpenCode server will start on first use." };
  }
  if (state === "starting") {
    return { status: "starting", statusMessage: "OpenCode server is starting." };
  }
  if (state === "not_installed") {
    return { status: "not_installed", statusMessage: "Install OpenCode on this Mac to enable the OpenCode runtime." };
  }
  if (state === "error") {
    return { status: "error", statusMessage: "OpenCode server failed on this Mac." };
  }
  return { status: "degraded", statusMessage: "OpenCode server status could not be verified on this Mac." };
}

function buildOpenCodePromptParts(params = {}) {
  const text = readString(params.prompt) || readString(params.input) || readString(params.message);
  if (text) {
    return [{ type: "text", text }];
  }
  if (Array.isArray(params.input)) {
    const structuredText = readStructuredInputText(params.input);
    return structuredText ? [{ type: "text", text: structuredText }] : [];
  }
  if (Array.isArray(params.parts)) {
    const structuredText = readStructuredInputText(params.parts);
    return structuredText ? [{ type: "text", text: structuredText }] : [];
  }
  return [];
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

function readStructuredInputText(inputItems) {
  const chunks = [];
  for (const item of inputItems) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const type = readString(item.type).toLowerCase();
    if (type === "text" || type === "input_text") {
      const text = readString(item.text) || readString(item.content);
      if (text) {
        chunks.push(text);
      }
      continue;
    }
    if (type === "mention") {
      const name = readString(item.name);
      const path = readString(item.path);
      const mention = [name ? `@${name}` : "", path].filter(Boolean).join(" ");
      if (mention) {
        chunks.push(mention);
      }
      continue;
    }
    if (type === "skill") {
      const name = readString(item.name) || readString(item.id);
      if (name) {
        chunks.push(`$${name}`);
      }
      continue;
    }
    if (type === "file") {
      const path = readString(item.path) || readString(item.url);
      if (path) {
        chunks.push(path);
      }
    }
  }
  return chunks.join("\n").trim();
}

function normalizeOpenCodeMessagesResponse(response) {
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response?.data)) {
    return response.data;
  }
  if (Array.isArray(response?.items)) {
    return response.items;
  }
  if (Array.isArray(response?.messages)) {
    return response.messages;
  }
  return [];
}

function buildOpenCodeTurnsFromMessages(messages = []) {
  const turnsByKey = new Map();
  const orderedKeys = [];
  const sortedMessages = [...messages].sort((left, right) => {
    return readMessageCreatedAt(left) - readMessageCreatedAt(right);
  });

  for (const message of sortedMessages) {
    const info = message?.info && typeof message.info === "object" ? message.info : message || {};
    const role = readString(info.role).toLowerCase();
    const messageId = readString(info.id);
    if (!messageId || (role !== "user" && role !== "assistant")) {
      continue;
    }

    const turnKey = role === "assistant"
      ? (readString(info.parentID) || readString(info.parentId) || messageId)
      : messageId;
    if (!turnsByKey.has(turnKey)) {
      orderedKeys.push(turnKey);
      turnsByKey.set(turnKey, {
        id: `opencode-turn-${turnKey}`,
        status: "completed",
        createdAt: readMessageCreatedAt(message) || undefined,
        items: [],
      });
    }

    const turn = turnsByKey.get(turnKey);
    const items = buildOpenCodeHistoryItems(message);
    turn.items.push(...items);
    const status = historyTurnStatusFromMessage(message);
    if (status === "failed" || turn.status !== "failed") {
      turn.status = status;
    }
    const updatedAt = readMessageCompletedAt(message) || readMessageCreatedAt(message);
    if (updatedAt) {
      turn.updatedAt = updatedAt;
    }
  }

  return orderedKeys
    .map((key) => turnsByKey.get(key))
    .filter((turn) => turn.items.length > 0);
}

function buildOpenCodeHistoryItems(message = {}) {
  const info = message?.info && typeof message.info === "object" ? message.info : message;
  const parts = Array.isArray(message?.parts)
    ? message.parts
    : Array.isArray(info?.parts)
      ? info.parts
      : [];
  const role = readString(info?.role).toLowerCase();
  const messageId = readString(info?.id);
  const items = [];
  const text = textFromOpenCodeParts(parts);

  if (text || role === "user" || role === "assistant") {
    items.push(omitEmpty({
      id: messageId,
      type: "message",
      role,
      text,
      content: text ? [{
        type: role === "user" ? "input_text" : "output_text",
        text,
      }] : undefined,
      createdAt: readMessageCreatedAt(message) || undefined,
    }));
  }

  for (const part of parts) {
    const partType = readString(part?.type).toLowerCase();
    if (partType === "reasoning") {
      const reasoning = readString(part.text);
      if (reasoning) {
        items.push(omitEmpty({
          id: readString(part.id),
          type: "reasoning",
          text: reasoning,
          createdAt: part?.time?.start,
        }));
      }
      continue;
    }
    if (partType === "tool") {
      items.push(openCodeToolPartToHistoryItem(part));
      continue;
    }
    if (partType === "compaction") {
      items.push(omitEmpty({
        id: readString(part.id),
        type: "contextCompaction",
        text: "Context compacted",
        createdAt: part?.time?.start,
      }));
    }
  }

  return items.filter(Boolean);
}

function openCodeToolPartToHistoryItem(part = {}) {
  const state = part.state && typeof part.state === "object" ? part.state : {};
  const status = readString(state.status) || "completed";
  const output = readString(state.output)
    || readString(state.error)
    || readString(state.title)
    || stringifyToolContent(state.input);
  return omitEmpty({
    id: readString(part.id) || readString(part.callID),
    type: "toolCall",
    tool: readString(part.tool),
    toolName: readString(part.tool),
    name: readString(part.tool),
    status,
    text: output,
    output,
    input: state.input,
    createdAt: state.time?.start,
    completedAt: state.time?.end,
  });
}

function textFromOpenCodeParts(parts = []) {
  return parts
    .filter((part) => readString(part?.type).toLowerCase() === "text")
    .map((part) => readString(part.text))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function historyTurnStatusFromMessage(message = {}) {
  const info = message?.info && typeof message.info === "object" ? message.info : message;
  if (info?.error) {
    return "failed";
  }
  if (readString(info?.role).toLowerCase() !== "assistant") {
    return "completed";
  }
  if (info?.time?.completed || (readString(info?.finish) && !isNonTerminalFinishReason(info.finish))) {
    return "completed";
  }
  return "running";
}

function readMessageCreatedAt(message = {}) {
  const info = message?.info && typeof message.info === "object" ? message.info : message;
  return normalizeTimestamp(info?.time?.created) || 0;
}

function readMessageCompletedAt(message = {}) {
  const info = message?.info && typeof message.info === "object" ? message.info : message;
  return normalizeTimestamp(info?.time?.completed) || 0;
}

function normalizeTimestamp(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTurnsCursor(cursor) {
  const value = readString(cursor);
  const match = value.match(/^opencode-offset:(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function runtimeModelIdentifierFromSession(session = {}) {
  const providerID = runtimeModelProviderFromSession(session);
  const modelID = readString(session?.model?.id)
    || readString(session?.model?.modelID)
    || readString(session?.model?.modelId);
  return providerID && modelID ? `${providerID}/${modelID}` : "";
}

function runtimeModelProviderFromSession(session = {}) {
  return readString(session?.model?.providerID)
    || readString(session?.model?.providerId)
    || readString(session?.modelProvider)
    || readString(session?.model_provider);
}

function runtimeModelVariantFromSession(session = {}) {
  return readString(session?.model?.variant)
    || readString(session?.modelVariant)
    || readString(session?.model_variant);
}

function isNonTerminalFinishReason(value) {
  const normalized = readString(value).toLowerCase().replace(/[_\s]+/g, "-");
  return normalized === "tool-calls" || normalized === "tool-call";
}

function extractOpenCodeEventSessionId(event) {
  const properties = event?.properties && typeof event.properties === "object" ? event.properties : {};
  return readString(properties.sessionID)
    || readString(properties.sessionId)
    || readString(properties.info?.sessionID)
    || readString(properties.info?.sessionId)
    || readString(properties.part?.sessionID)
    || readString(properties.part?.sessionId);
}

function parseJsonRpcMessage(rawMessage) {
  try {
    return typeof rawMessage === "string" ? JSON.parse(rawMessage) : null;
  } catch {
    return null;
  }
}

function openCodePermissionResponseForResult(result = {}) {
  const explicitResponse = readString(result.response) || readString(result.reply);
  if (["once", "always", "reject"].includes(explicitResponse)) {
    return explicitResponse;
  }
  const permissions = result.permissions && typeof result.permissions === "object" ? result.permissions : {};
  return hasGrantedPermission(permissions) ? "once" : "reject";
}

function openCodeQuestionAnswersForResult(result = {}, questionIds = []) {
  const answers = result?.answers && typeof result.answers === "object" ? result.answers : {};
  const orderedQuestionIds = Array.isArray(questionIds) && questionIds.length > 0
    ? questionIds
    : Object.keys(answers);
  return orderedQuestionIds.map((questionId) => {
    const entry = answers[questionId];
    const rawAnswers = Array.isArray(entry)
      ? entry
      : Array.isArray(entry?.answers)
        ? entry.answers
        : [];
    return rawAnswers.map(readString).filter(Boolean);
  });
}

function isRejectedQuestionResponse(result = {}) {
  const decision = readString(result?.decision).toLowerCase();
  const response = readString(result?.response).toLowerCase();
  return result?.rejected === true
    || result?.cancelled === true
    || ["reject", "rejected", "decline", "declined", "cancel", "cancelled"].includes(decision)
    || ["reject", "rejected", "decline", "declined", "cancel", "cancelled"].includes(response);
}

function hasGrantedPermission(permissions) {
  return Object.values(permissions).some((value) => {
    if (value === true) {
      return true;
    }
    if (value && typeof value === "object") {
      return hasGrantedPermission(value);
    }
    return false;
  });
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function omitEmpty(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      return entry !== undefined && entry !== null && entry !== "";
    })
  );
}

module.exports = {
  buildOpenCodePromptParts,
  createOpenCodeRuntimeAdapter,
  hasOpenCodeAuthConfigured,
  mapOpenCodeRuntimeStatus,
  mapServerStatus,
};
