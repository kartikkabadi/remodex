// FILE: cursor-provider.js
// Purpose: Adapts Cursor CLI ACP to Remodex provider-aware thread and turn RPCs.
// Layer: Bridge runtime provider
// Exports: createCursorProvider
// Depends on: crypto, ./cursor-acp-client, ./cursor-models, ./runtime-provider-models

const { randomUUID } = require("crypto");
const { createCursorAcpClient } = require("./cursor-acp-client");
const {
  CURSOR_PROVIDER_ID,
  DEFAULT_CURSOR_MODEL,
  normalizeCursorModelReference,
  parseCursorModelsFromSessionResult,
} = require("./cursor-models");
const { normalizeRuntimeProvider } = require("./runtime-provider-models");

const CURSOR_THREAD_PREFIX = "cursor-thread-";
const CURSOR_TURN_PREFIX = "cursor-turn-";
const CURSOR_MODEL_CACHE_TTL_MS = 60_000;
const CURSOR_MODEL_LIST_TIMEOUT_MS = 12_000;
const CURSOR_SESSION_LIST_TIMEOUT_MS = 12_000;
const CURSOR_SESSION_START_TIMEOUT_MS = 15_000;
const CURSOR_LOAD_HISTORY_TIMEOUT_MS = 15_000;

function createCursorProvider({
  sendApplicationMessage,
  env = process.env,
  randomUUIDImpl = randomUUID,
  createAcpClient = createCursorAcpClient,
  logPrefix = "[remodex]",
} = {}) {
  return new CursorProvider({
    createAcpClient,
    env,
    logPrefix,
    randomUUIDImpl,
    sendApplicationMessage,
  });
}

class CursorProvider {
  constructor({
    sendApplicationMessage,
    env,
    randomUUIDImpl,
    createAcpClient,
    logPrefix,
  }) {
    this.id = CURSOR_PROVIDER_ID;
    this.sendApplicationMessage = sendApplicationMessage;
    this.env = env;
    this.randomUUID = randomUUIDImpl;
    this.createAcpClient = createAcpClient;
    this.logPrefix = logPrefix;
    this.modelCache = null;
    this.threads = new Map();
    this.sessionThreadCache = new Map();
    this.activeTurnsByTurnId = new Map();
    this.activeTurnIdByThreadId = new Map();
    this.finalizedTurns = new Set();
    this.warnedAvailabilityReason = "";
  }

  canHandleProvider(provider) {
    return normalizeRuntimeProvider(provider) === CURSOR_PROVIDER_ID;
  }

  ownsThread(threadId) {
    const normalized = readString(threadId);
    return this.threads.has(normalized)
      || this.sessionThreadCache.has(normalized)
      || normalized.startsWith(CURSOR_THREAD_PREFIX);
  }

  async listModels() {
    const cached = this.readFreshModelCache();
    if (cached) {
      return cached;
    }

    const client = this.newClient({ cwd: process.cwd() });
    try {
      await initializeCursorClient(client, CURSOR_MODEL_LIST_TIMEOUT_MS);
      const session = await client.request(
        "session/new",
        { cwd: process.cwd(), mcpServers: [] },
        CURSOR_MODEL_LIST_TIMEOUT_MS
      );
      const models = parseCursorModelsFromSessionResult(session);
      this.modelCache = {
        expiresAt: Date.now() + CURSOR_MODEL_CACHE_TTL_MS,
        value: models,
      };
      return models;
    } catch (error) {
      this.warnUnavailable(error?.message || "Cursor models are unavailable.");
      return [];
    } finally {
      client.kill();
    }
  }

  async listThreads(params = {}) {
    const limit = boundedPositiveInteger(params.limit, 50);
    const client = this.newClient({ cwd: process.cwd() });
    try {
      const initializeResult = await initializeCursorClient(client, CURSOR_SESSION_LIST_TIMEOUT_MS);
      if (!initializeResult?.agentCapabilities?.sessionCapabilities?.list) {
        return { data: [], nextCursor: null };
      }

      const result = await client.request(
        "session/list",
        buildSessionListParams(params),
        CURSOR_SESSION_LIST_TIMEOUT_MS
      );
      const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
      const listedThreads = sessions
        .slice(0, limit)
        .map((session) => this.threadFromSession(session))
        .filter(Boolean);
      const localThreads = Array.from(this.threads.values())
        .filter((thread) => !thread.archived)
        .map((thread) => publicThread(thread));
      const data = dedupeThreadsById([...localThreads, ...listedThreads])
        .sort(compareThreadsByUpdatedAt)
        .slice(0, limit);
      return {
        data,
        nextCursor: result?.nextCursor || result?.next_cursor || null,
      };
    } catch (error) {
      this.warnUnavailable(error?.message || "Cursor sessions are unavailable.");
      return { data: [], nextCursor: null };
    } finally {
      client.kill();
    }
  }

  async handleRequest(request) {
    const method = readString(request?.method);
    switch (method) {
      case "thread/start":
        return this.threadStart(request);
      case "thread/resume":
      case "thread/read":
        return this.threadRead(request);
      case "thread/turns/list":
        return this.threadTurnsList(request);
      case "thread/name/set":
        return this.threadNameSet(request);
      case "thread/archive":
        return this.threadArchive(request, true);
      case "thread/unarchive":
        return this.threadArchive(request, false);
      case "turn/start":
        return this.turnStart(request);
      case "turn/interrupt":
        return this.turnInterrupt(request);
      default:
        throw unsupportedMethodError(method);
    }
  }

  shutdown() {
    for (const active of this.activeTurnsByTurnId.values()) {
      active.stopped = true;
      try {
        active.client.notify("session/cancel", { sessionId: active.sessionId });
      } catch {
        // Ignore cancellation races during shutdown.
      }
      active.client.kill("SIGTERM");
    }
    this.activeTurnsByTurnId.clear();
    this.activeTurnIdByThreadId.clear();
  }

  async threadStart(request) {
    const params = request.params || {};
    const now = new Date().toISOString();
    const requestedCwd = readProjectCwd(params);
    const cwd = requestedCwd || process.cwd();
    const model = normalizeCursorModel(params.model);
    const sessionId = await this.createSession({ cwd, model });
    const thread = {
      id: cursorThreadIdForSession(sessionId),
      title: readString(params.title) || "Cursor chat",
      cwd,
      model,
      createdAt: now,
      updatedAt: now,
      archived: false,
      hasProjectCwd: Boolean(requestedCwd),
      sessionId,
      turns: [],
    };
    this.threads.set(thread.id, thread);
    this.sessionThreadCache.set(sessionId, publicThread(thread));
    this.sessionThreadCache.set(thread.id, publicThread(thread));
    return { thread: publicThread(thread) };
  }

  async threadRead(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const thread = await this.resolveThread(threadId).catch((error) => {
      if (error?.errorCode !== "thread_not_found" || !threadId) {
        throw error;
      }
      return this.adoptThread(threadId, params);
    });

    const responseThread = { ...publicThread(thread) };
    if (params.includeTurns === true || params.include_turns === true) {
      responseThread.turns = await this.turnsForThread(threadId, { sortDirection: "asc" });
    }
    return { thread: responseThread };
  }

  async threadTurnsList(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const limit = boundedPositiveInteger(params.limit, 50);
    const sortDirection = readString(params.sortDirection || params.sort_direction) || "desc";
    const turns = await this.turnsForThread(threadId, { sortDirection });
    return {
      data: turns.slice(0, limit),
      nextCursor: null,
    };
  }

  async turnStart(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const thread = await this.resolveThreadForTurn(threadId, params);
    if (this.activeTurnIdByThreadId.has(thread.id)) {
      throw activeTurnError(thread.id);
    }

    const model = normalizeCursorModel(params.model || thread.model);
    const { prompt, inputText } = buildPromptFromTurnInput(params.input);
    if (!prompt) {
      const error = new Error("Cursor turn/start requires text input.");
      error.errorCode = "cursor_missing_input";
      throw error;
    }

    thread.model = model;
    thread.updatedAt = new Date().toISOString();
    const turnId = `${CURSOR_TURN_PREFIX}${this.randomUUID()}`;
    const turn = createStoredTurn({
      inputText,
      model,
      threadId: thread.id,
      turnId,
    });
    thread.turns.push(turn);

    setImmediate(() => {
      this.runTurn({
        model,
        params,
        prompt,
        thread,
        turn,
        turnId,
      });
    });

    this.emit("turn/started", {
      threadId: thread.id,
      turnId,
      turn: {
        id: turnId,
        status: "running",
      },
    });

    return {
      turnId,
      turn: {
        id: turnId,
        threadId: thread.id,
        status: "running",
      },
    };
  }

  runTurn({ model, params, prompt, thread, turn, turnId }) {
    const active = createActiveCursorTurn({ params, thread, turn, turnId });
    const client = this.newClient({
      cwd: thread.cwd || process.cwd(),
      onNotification: (frame) => this.handleAcpNotification({ active, frame, thread, turnId }),
      onRequest: (frame) => this.handleAcpClientRequest({ active, frame }),
    });
    active.client = client;
    this.activeTurnsByTurnId.set(turnId, active);
    this.activeTurnIdByThreadId.set(thread.id, turnId);

    this.runAcpTurn({ active, client, model, params, prompt, thread, turn, turnId })
      .catch((error) => {
        this.completeTurn({
          errorMessage: error?.message || "Cursor ACP turn failed.",
          status: active.stopped ? "stopped" : "failed",
          thread,
          turn,
          turnId,
        });
      });
  }

  async runAcpTurn(context) {
    try {
      await this.runAcpTurnImpl(context);
    } finally {
      context.client.kill();
    }
  }

  async runAcpTurnImpl({ active, client, model, params, prompt, thread, turn, turnId }) {
    await initializeCursorClient(client);
    const cwd = thread.cwd || process.cwd();

    if (thread.sessionId) {
      active.loadingHistory = true;
      try {
        await client.request("session/load", {
          sessionId: thread.sessionId,
          cwd,
          mcpServers: [],
        }, CURSOR_LOAD_HISTORY_TIMEOUT_MS);
      } catch (error) {
        this.warnUnavailable(`Cursor session load failed; starting a new session: ${error.message}`);
        thread.sessionId = "";
      } finally {
        active.loadingHistory = false;
      }
    }

    if (!thread.sessionId) {
      const session = await client.request("session/new", { cwd, mcpServers: [] });
      thread.sessionId = readString(session?.sessionId);
      if (!thread.sessionId) {
        throw cursorProtocolError("Cursor ACP session/new did not return a sessionId.");
      }
      active.sessionId = thread.sessionId;
      this.sessionThreadCache.set(thread.sessionId, publicThread(thread));
    } else {
      active.sessionId = thread.sessionId;
    }

    await this.applyCursorSessionConfig({ active, client, model, params });
    await client.request("session/prompt", {
      sessionId: thread.sessionId,
      prompt: [{ type: "text", text: prompt }],
    });

    this.completeTurn({
      status: active.stopped ? "stopped" : "completed",
      thread,
      turn,
      turnId,
    });
  }

  async applyCursorSessionConfig({ active, client, model, params }) {
    if (!active.sessionId) {
      return;
    }

    const selectedMode = cursorModeForParams(params);
    if (selectedMode) {
      await client.request("session/set_config_option", {
        sessionId: active.sessionId,
        configId: "mode",
        value: selectedMode,
      }).catch(() => null);
    }

    if (!model) {
      return;
    }
    await client.request("session/set_config_option", {
      sessionId: active.sessionId,
      configId: "model",
      value: model,
    });
  }

  handleAcpNotification({ active, frame, thread, turnId }) {
    if (frame.method !== "session/update") {
      return;
    }
    const update = frame.params?.update;
    if (!update || active.loadingHistory) {
      return;
    }

    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        this.appendAssistantText({ active, content: update.content, thread, turnId });
        break;
      case "agent_thought_chunk":
        this.appendReasoningText({ content: update.content, thread, turnId });
        break;
      case "tool_call":
        this.appendToolCallSummary({ active, update, thread, turnId });
        break;
      case "session_info_update":
        this.applySessionInfoUpdate({ thread, update });
        break;
      default:
        break;
    }
  }

  handleAcpClientRequest({ active, frame }) {
    if (frame.method !== "session/request_permission") {
      const error = new Error(`Unsupported Cursor ACP client request: ${frame.method || "unknown"}`);
      error.code = -32601;
      throw error;
    }

    if (active.stopped) {
      return {
        outcome: { outcome: "cancelled" },
      };
    }

    return {
      outcome: {
        outcome: "selected",
        optionId: selectPermissionOption(frame.params?.options, active.params),
      },
    };
  }

  appendAssistantText({ active, content, thread, turnId }) {
    const text = contentText(content);
    const delta = computeTextDelta(active.assistantText, text);
    if (!delta) {
      return;
    }

    active.assistantText += delta;
    const assistantItem = active.turn.items.find((item) => item.id === active.assistantItemId);
    if (assistantItem) {
      assistantItem.text = active.assistantText;
      assistantItem.content = textContent(active.assistantText);
    }
    this.emit("item/agentMessage/delta", {
      threadId: thread.id,
      turnId,
      itemId: active.assistantItemId,
      delta,
      textDelta: delta,
      assistantPhase: "final_answer",
      item: {
        id: active.assistantItemId,
        turnId,
        type: "agentMessage",
        phase: "final",
      },
    });
  }

  appendReasoningText({ content, thread, turnId }) {
    const delta = contentText(content);
    if (!delta) {
      return;
    }
    this.emit("item/reasoning/textDelta", {
      threadId: thread.id,
      turnId,
      itemId: `cursor-reasoning-${turnId}`,
      delta,
      textDelta: delta,
      item: {
        id: `cursor-reasoning-${turnId}`,
        type: "reasoning",
        turnId,
      },
    });
  }

  appendToolCallSummary({ active, update, thread, turnId }) {
    const title = readString(update.title);
    if (!title || active.toolCallIds.has(update.toolCallId)) {
      return;
    }
    active.toolCallIds.add(update.toolCallId);
    this.appendReasoningText({
      content: { type: "text", text: `\n${title}\n` },
      thread,
      turnId,
    });
  }

  applySessionInfoUpdate({ thread, update }) {
    const title = readString(update.title);
    if (title) {
      thread.title = title;
    }
    thread.updatedAt = normalizeDateString(update.updatedAt) || new Date().toISOString();
    this.emit("thread/name/updated", {
      threadId: thread.id,
      thread_id: thread.id,
      name: thread.title,
      title: thread.title,
    });
  }

  completeTurn({ errorMessage = "", status, thread, turn, turnId }) {
    if (this.finalizedTurns.has(turnId)) {
      return false;
    }
    this.finalizedTurns.add(turnId);
    pruneSet(this.finalizedTurns, 500);
    this.activeTurnsByTurnId.delete(turnId);
    this.activeTurnIdByThreadId.delete(thread.id);
    thread.updatedAt = new Date().toISOString();
    turn.status = status;
    turn.completedAt = thread.updatedAt;
    if (errorMessage) {
      turn.error = { message: errorMessage };
    }

    const assistantItem = turn.items.find((item) => item.type === "agentMessage");
    if (assistantItem && assistantItem.text) {
      this.emit("item/completed", {
        threadId: thread.id,
        turnId,
        itemId: assistantItem.id,
        message: assistantItem.text,
        assistantPhase: "final_answer",
        item: {
          id: assistantItem.id,
          turnId,
          type: "agentMessage",
          phase: "final",
          text: assistantItem.text,
          content: assistantItem.content,
        },
      });
    }

    this.emit("turn/completed", {
      threadId: thread.id,
      turnId,
      model: thread.model,
      status,
      turn: {
        id: turnId,
        status,
        error: errorMessage ? { message: errorMessage } : undefined,
      },
    });
    return true;
  }

  async turnInterrupt(request) {
    const params = request.params || {};
    const turnId = readString(params.turnId || params.turn_id);
    const threadId = readThreadId(params);
    const resolvedTurnId = turnId || this.activeTurnIdByThreadId.get(threadId) || "";
    const active = this.activeTurnsByTurnId.get(resolvedTurnId);
    if (!active) {
      return { success: true, interrupted: false };
    }

    active.stopped = true;
    try {
      active.client.notify("session/cancel", { sessionId: active.sessionId });
    } catch {
      // The process may already be exiting.
    }
    active.client.kill("SIGINT");
    return { success: true, interrupted: true };
  }

  async threadNameSet(request) {
    const params = request.params || {};
    const thread = await this.resolveThread(readThreadId(params));
    const name = readString(params.name || params.title);
    if (name) {
      thread.title = name;
      thread.updatedAt = new Date().toISOString();
    }
    const publicValue = publicThread(thread);
    this.emit("thread/name/updated", {
      threadId: publicValue.id,
      thread_id: publicValue.id,
      name: publicValue.name,
      title: publicValue.title,
    });
    return { thread: publicValue };
  }

  async threadArchive(request, archived) {
    const thread = await this.resolveThread(readThreadId(request.params));
    thread.archived = archived;
    thread.updatedAt = new Date().toISOString();
    return { thread: publicThread(thread) };
  }

  async turnsForThread(threadId, { sortDirection = "desc" } = {}) {
    const thread = await this.resolveThread(threadId);
    let turns = thread.turns || [];
    if (thread.sessionId && !turns.length) {
      turns = await this.loadSessionTurns(thread.sessionId, thread);
      thread.turns = turns;
    }
    const normalizedDirection = readString(sortDirection).toLowerCase();
    return normalizedDirection === "asc" ? [...turns] : [...turns].reverse();
  }

  async loadSessionTurns(sessionId, thread) {
    const client = this.newClient({ cwd: thread.cwd || process.cwd() });
    const collector = createHistoryCollector(thread);
    client.onNotification = (frame) => {
      if (frame.method === "session/update") {
        collector.append(frame.params?.update);
      }
    };

    try {
      await initializeCursorClient(client, CURSOR_LOAD_HISTORY_TIMEOUT_MS);
      await client.request("session/load", {
        sessionId,
        cwd: thread.cwd || process.cwd(),
        mcpServers: [],
      }, CURSOR_LOAD_HISTORY_TIMEOUT_MS);
      return collector.turns.slice(-200);
    } catch {
      return thread.turns || [];
    } finally {
      client.kill();
    }
  }

  async resolveThread(threadId) {
    const normalized = readString(threadId);
    if (this.threads.has(normalized)) {
      return this.threads.get(normalized);
    }

    if (this.sessionThreadCache.has(normalized)) {
      const cached = this.sessionThreadCache.get(normalized);
      return this.rememberSessionThread(cached);
    }

    throw threadNotFoundError(normalized);
  }

  async resolveThreadForTurn(threadId, params = {}) {
    try {
      const thread = await this.resolveThread(threadId);
      this.applyRequestedProjectCwd(thread, params);
      return thread;
    } catch (error) {
      if (!threadId || error?.errorCode !== "thread_not_found") {
        throw error;
      }
    }

    return this.adoptThread(threadId, params);
  }

  applyRequestedProjectCwd(thread, params = {}) {
    const requestedCwd = readProjectCwd(params);
    if (!requestedCwd || !thread || (thread.hasProjectCwd && thread.cwd === requestedCwd)) {
      return;
    }

    thread.cwd = requestedCwd;
    thread.hasProjectCwd = true;
  }

  rememberSessionThread(thread) {
    const hasProjectCwd = thread.hasProjectCwd !== false
      && thread.metadata?.projectCwdSource !== "fallback";
    const sessionId = thread.sessionId || cursorSessionIdFromThreadId(thread.id) || thread.id;
    const stored = {
      id: thread.id,
      title: thread.title || thread.name || "Cursor chat",
      cwd: thread.cwd || process.cwd(),
      model: normalizeCursorModel(thread.model),
      createdAt: thread.createdAt || new Date().toISOString(),
      updatedAt: thread.updatedAt || new Date().toISOString(),
      archived: false,
      hasProjectCwd,
      sessionId,
      turns: Array.isArray(thread.turns) ? thread.turns : [],
    };
    this.threads.set(stored.id, stored);
    this.sessionThreadCache.set(stored.id, publicThread(stored));
    this.sessionThreadCache.set(stored.sessionId, publicThread(stored));
    return stored;
  }

  adoptThread(threadId, params = {}) {
    // Existing Codex-local chats can switch providers mid-thread; adopt the id
    // locally so the Cursor turn can stream back into the same timeline.
    const now = new Date().toISOString();
    const requestedCwd = readProjectCwd(params);
    const sessionId = cursorSessionIdFromThreadId(threadId);
    const thread = {
      id: threadId,
      title: readString(params.title) || "Cursor chat",
      cwd: requestedCwd || process.cwd(),
      model: normalizeCursorModel(params.model),
      createdAt: now,
      updatedAt: now,
      archived: false,
      hasProjectCwd: Boolean(requestedCwd),
      sessionId,
      turns: [],
    };
    this.threads.set(thread.id, thread);
    return thread;
  }

  threadFromSession(session) {
    const id = readString(session.sessionId || session.id);
    if (!id) {
      return null;
    }

    const sessionCwd = readString(session.cwd || session.directory || session.path);
    const threadId = cursorThreadIdForSession(id);
    const thread = {
      id: threadId,
      title: readString(session.title || session.name) || "Cursor chat",
      cwd: sessionCwd || process.cwd(),
      model: DEFAULT_CURSOR_MODEL,
      createdAt: normalizeDateString(session.createdAt || session.created_at),
      updatedAt: normalizeDateString(session.updatedAt || session.updated_at),
      archived: false,
      hasProjectCwd: Boolean(sessionCwd),
      sessionId: id,
      turns: [],
    };
    this.sessionThreadCache.set(threadId, publicThread(thread));
    this.sessionThreadCache.set(id, publicThread(thread));
    return publicThread(thread);
  }

  readFreshModelCache() {
    if (!this.modelCache || Date.now() > this.modelCache.expiresAt) {
      return null;
    }
    return this.modelCache.value;
  }

  newClient(options = {}) {
    return this.createAcpClient({
      command: resolveCursorCommand(this.env),
      cwd: options.cwd || process.cwd(),
      env: this.env,
      onNotification: options.onNotification,
      onRequest: options.onRequest,
    });
  }

  async createSession({ cwd, model }) {
    const client = this.newClient({ cwd });
    try {
      await initializeCursorClient(client, CURSOR_SESSION_START_TIMEOUT_MS);
      const session = await client.request(
        "session/new",
        { cwd, mcpServers: [] },
        CURSOR_SESSION_START_TIMEOUT_MS
      );
      const sessionId = readString(session?.sessionId);
      if (!sessionId) {
        throw cursorProtocolError("Cursor ACP session/new did not return a sessionId.");
      }
      if (model) {
        await client.request("session/set_config_option", {
          sessionId,
          configId: "model",
          value: model,
        }, CURSOR_SESSION_START_TIMEOUT_MS).catch(() => null);
      }
      return sessionId;
    } finally {
      client.kill();
    }
  }

  emit(method, params) {
    this.sendApplicationMessage?.(JSON.stringify({
      method,
      params: removeUndefinedValues(params || {}),
    }));
  }

  warnUnavailable(reason) {
    const normalizedReason = readString(reason);
    if (!normalizedReason || this.warnedAvailabilityReason === normalizedReason) {
      return;
    }
    this.warnedAvailabilityReason = normalizedReason;
    console.warn(`${this.logPrefix} Cursor unavailable: ${normalizedReason}`);
  }
}

async function initializeCursorClient(client, timeoutMs) {
  return client.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
      _meta: {
        parameterizedModelPicker: true,
      },
    },
    clientInfo: {
      name: "remodex_bridge",
      title: "Remodex Bridge",
      version: "1.0.0",
    },
  }, timeoutMs);
}

function createActiveCursorTurn({ params, thread, turn, turnId }) {
  return {
    assistantItemId: `cursor-agent-${turnId}`,
    assistantText: "",
    client: null,
    loadingHistory: false,
    params,
    sessionId: thread.sessionId || "",
    stopped: false,
    threadId: thread.id,
    toolCallIds: new Set(),
    turn,
  };
}

function createStoredTurn({ inputText, model, threadId, turnId }) {
  const now = new Date().toISOString();
  return {
    id: turnId,
    model,
    status: "running",
    createdAt: now,
    items: [
      {
        id: `cursor-user-${turnId}`,
        type: "userMessage",
        role: "user",
        text: inputText,
        content: textContent(inputText),
        createdAt: now,
      },
      {
        id: `cursor-agent-${turnId}`,
        type: "agentMessage",
        role: "assistant",
        phase: "final",
        text: "",
        content: textContent(""),
        createdAt: now,
      },
    ],
    metadata: {
      threadId,
      provider: CURSOR_PROVIDER_ID,
    },
  };
}

function createHistoryCollector(thread) {
  const turns = [];
  let currentTurn = null;

  return {
    turns,
    append(update) {
      if (!update || typeof update !== "object") {
        return;
      }

      const text = contentText(update.content);
      if (!text) {
        return;
      }

      if (update.sessionUpdate === "user_message_chunk" || !currentTurn) {
        currentTurn = {
          id: `${CURSOR_TURN_PREFIX}history-${turns.length + 1}`,
          model: thread.model || DEFAULT_CURSOR_MODEL,
          status: "completed",
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          items: [],
        };
        turns.push(currentTurn);
      }

      if (update.sessionUpdate === "user_message_chunk") {
        currentTurn.items.push({
          id: `${currentTurn.id}-user`,
          type: "userMessage",
          role: "user",
          text,
          content: textContent(text),
        });
        return;
      }

      if (update.sessionUpdate === "agent_message_chunk") {
        const existing = currentTurn.items.find((item) => item.type === "agentMessage");
        if (existing) {
          existing.text += text;
          existing.content = textContent(existing.text);
        } else {
          currentTurn.items.push({
            id: `${currentTurn.id}-agent`,
            type: "agentMessage",
            role: "assistant",
            phase: "final",
            text,
            content: textContent(text),
          });
        }
      }
    },
  };
}

function publicThread(thread) {
  const hasProjectCwd = thread.hasProjectCwd !== false;
  return {
    id: thread.id,
    title: thread.title,
    name: thread.title,
    cwd: hasProjectCwd ? thread.cwd : null,
    model: normalizeCursorModel(thread.model),
    modelProvider: CURSOR_PROVIDER_ID,
    provider: CURSOR_PROVIDER_ID,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    metadata: {
      provider: CURSOR_PROVIDER_ID,
      projectCwdSource: hasProjectCwd ? "explicit" : "fallback",
      sessionId: thread.sessionId || null,
    },
  };
}

function normalizeCursorModel(value) {
  return normalizeCursorModelReference(value) || DEFAULT_CURSOR_MODEL;
}

function cursorThreadIdForSession(sessionId) {
  const normalized = readString(sessionId);
  return normalized ? `${CURSOR_THREAD_PREFIX}${normalized}` : "";
}

function cursorSessionIdFromThreadId(threadId) {
  const normalized = readString(threadId);
  return normalized.startsWith(CURSOR_THREAD_PREFIX)
    ? normalized.slice(CURSOR_THREAD_PREFIX.length)
    : "";
}

function resolveCursorCommand(env = process.env) {
  return readString(env.REMODEX_CURSOR_COMMAND) || readString(env.CURSOR_AGENT_COMMAND) || "cursor-agent";
}

function buildSessionListParams(params = {}) {
  const result = {};
  const cwd = readString(params.cwd || params.current_working_directory || params.working_directory);
  if (cwd) {
    result.cwd = cwd;
  }
  const cursor = readString(params.cursor);
  if (cursor) {
    result.cursor = cursor;
  }
  return result;
}

function cursorModeForParams(params = {}) {
  const mode = readString(params.collaborationMode?.mode || params.collaboration_mode?.mode).toLowerCase();
  if (mode === "plan") {
    return "plan";
  }
  if (mode === "ask") {
    return "ask";
  }
  return "";
}

function selectPermissionOption(options, params = {}) {
  const choices = Array.isArray(options) ? options : [];
  const preferredKinds = shouldSkipPermissions(params)
    ? ["allow_always", "allow_once", "reject_once", "reject_always"]
    : ["allow_once", "allow_always", "reject_once", "reject_always"];

  for (const kind of preferredKinds) {
    const choice = choices.find((option) => readString(option?.kind) === kind);
    if (choice?.optionId) {
      return choice.optionId;
    }
  }
  return readString(choices[0]?.optionId);
}

function shouldSkipPermissions(params = {}) {
  const approvalPolicy = readString(params.approvalPolicy || params.approval_policy).toLowerCase();
  const sandbox = readString(params.sandbox).toLowerCase();
  const sandboxType = readString(params.sandboxPolicy?.type || params.sandbox_policy?.type).toLowerCase();
  return approvalPolicy === "never"
    || sandbox.includes("danger")
    || sandboxType === "dangerfullaccess"
    || sandboxType === "danger-full-access";
}

function buildPromptFromTurnInput(input) {
  if (typeof input === "string") {
    return {
      inputText: input.trim(),
      prompt: input.trim(),
    };
  }
  if (!Array.isArray(input)) {
    return { inputText: "", prompt: "" };
  }

  const textParts = [];
  const fallbackParts = [];
  for (const item of input) {
    if (typeof item === "string") {
      appendNonEmpty(textParts, item);
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const type = readString(item.type).toLowerCase();
    if (type.includes("image")) {
      appendNonEmpty(fallbackParts, imageFallbackText(item));
      continue;
    }
    appendNonEmpty(textParts, item.text || item.content || item.message);
  }

  const inputText = textParts.join("\n\n").trim() || fallbackParts.join("\n\n").trim();
  const prompt = [...textParts, ...fallbackParts].join("\n\n").trim();
  return { inputText, prompt };
}

function imageFallbackText(item) {
  const imagePath = readString(item.path || item.url || item.image_url || item.dataURL || item.data_url);
  return imagePath ? `[image attached: ${imagePath}]` : "[image attached]";
}

function contentText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!content || typeof content !== "object") {
    return "";
  }
  if (content.type === "text") {
    return typeof content.text === "string" ? content.text : "";
  }
  return readRawString(content.text || content.content || content.message);
}

function computeTextDelta(previousText, incomingText) {
  if (!incomingText) {
    return "";
  }
  if (!previousText || incomingText.startsWith(previousText)) {
    return incomingText.slice(previousText.length);
  }
  return incomingText;
}

function textContent(text) {
  return [{ type: "text", text: text || "" }];
}

function dedupeThreadsById(threads) {
  const seen = new Set();
  const result = [];
  for (const thread of threads) {
    const id = readString(thread?.id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(thread);
  }
  return result;
}

function compareThreadsByUpdatedAt(lhs, rhs) {
  const lhsTime = Date.parse(lhs?.updatedAt || lhs?.updated_at || lhs?.createdAt || lhs?.created_at || 0) || 0;
  const rhsTime = Date.parse(rhs?.updatedAt || rhs?.updated_at || rhs?.createdAt || rhs?.created_at || 0) || 0;
  return rhsTime - lhsTime;
}

function normalizeDateString(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 10_000_000_000 ? value * 1000 : value;
    return new Date(milliseconds).toISOString();
  }
  const normalized = readString(value);
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function boundedPositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numeric), 200);
}

function removeUndefinedValues(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) {
      result[key] = removeUndefinedValues(child);
    }
  }
  return result;
}

function pruneSet(set, maxSize) {
  while (set.size > maxSize) {
    const [first] = set;
    set.delete(first);
  }
}

function appendNonEmpty(target, value) {
  const text = readString(value);
  if (text) {
    target.push(text);
  }
}

function readProjectCwd(params = {}) {
  return readString(params.cwd || params.current_working_directory || params.working_directory);
}

function readThreadId(params = {}) {
  return readString(params.threadId || params.thread_id || params.id);
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function readRawString(value) {
  return typeof value === "string" ? value : "";
}

function unsupportedMethodError(method) {
  const error = new Error(`Unsupported Cursor provider method: ${method || "unknown"}`);
  error.errorCode = "unsupported_cursor_method";
  return error;
}

function threadNotFoundError(threadId) {
  const error = new Error(`Cursor thread not found: ${threadId || "unknown"}`);
  error.errorCode = "thread_not_found";
  return error;
}

function activeTurnError(threadId) {
  const error = new Error(`Cursor thread already has a running turn: ${threadId}`);
  error.errorCode = "thread_turn_active";
  return error;
}

function cursorProtocolError(message) {
  const error = new Error(message);
  error.errorCode = "cursor_protocol_error";
  return error;
}

module.exports = {
  createCursorProvider,
  selectPermissionOption,
};
