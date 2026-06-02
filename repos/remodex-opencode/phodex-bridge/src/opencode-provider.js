// FILE: opencode-provider.js
// Purpose: Adapts OpenCode SDK (opencode serve + @opencode-ai/sdk/v2) to Remodex
//          provider-aware thread/turn RPCs. Manages server lifecycle, session
//          mapping, event streaming, and permission bridging.
// Layer: Bridge runtime provider
// Exports: createOpenCodeProvider
// Depends on: ./opencode-server, ./opencode-client, ./opencode-models, ./provider-capabilities, ./thread-ownership-store

const { readString, resolvedParam } = require("./normalize");
const { createOpenCodeServer } = require("./opencode-server");
const { createOpenCodeClient } = require("./opencode-client");
const {
  DEFAULT_OPENCODE_MODEL,
  OPENCODE_PROVIDER_ID,
  appendNonEmpty,
  boundedPositiveInteger,
  buildPromptFromTurnInput,
  compareThreadsByUpdatedAt,
  messagesToTurns,
  normalizeOpenCodeModel,
  publicThread,
  readThreadId,
  removeUndefinedValues,
  textContent,
} = require("./opencode-models");
const { createThreadOwnershipStore } = require("./thread-ownership-store");
const { createOpenCodeSessionStore } = require("./opencode-session-store");

const ERROR_CODES = {
  OPENCODE_NOT_INSTALLED: { errorCode: "opencode_not_installed", action: "show_install_instructions" },
  OPENCODE_SERVER_UNREACHABLE: { errorCode: "opencode_server_unreachable", action: "show_retry" },
  OPENCODE_MODEL_UNAVAILABLE: { errorCode: "opencode_model_unavailable", action: "pick_different_model" },
  OPENCODE_AGENT_UNAVAILABLE: { errorCode: "opencode_agent_unavailable", action: "pick_different_agent" },
  OPENCODE_SESSION_EXPIRED: { errorCode: "opencode_session_expired", action: "restart_thread" },
  OPENCODE_TURN_FAILED: { errorCode: "opencode_turn_failed", action: "show_retry" },
  OPENCODE_PERMISSION_TIMEOUT: { errorCode: "opencode_permission_timeout", action: "show_timeout" },
};

const HEALTH_RESTART_WINDOW_MS = 5 * 60 * 1000;
const HEALTH_MAX_RESTARTS = 3;
const HEALTH_IDLE_SHUTDOWN_MS = 10 * 60 * 1000;

function createOpenCodeProvider({
  sendApplicationMessage,
  env = process.env,
  projectRegistry = null,
  ownershipStore = null,
  sessionStore = null,
  logPrefix = "[remodex]",
  serverFactory = null,
  clientFactory = null,
} = {}) {
  const server = serverFactory
    ? serverFactory({ env, logPrefix: `${logPrefix}:server` })
    : createOpenCodeServer({ env, logPrefix: `${logPrefix}:server` });
  const ownership = ownershipStore || createThreadOwnershipStore();
  const sessions = sessionStore || createOpenCodeSessionStore();

  let client = null;
  let healthy = false;
  let restartCount = 0;
  let restartWindowStart = 0;
  let lastActivityAt = 0;
  let idleTimer = null;
  let catalogUnavailable = null;

  const threads = new Map();
  const activeTurns = new Map();
  const eventUnsubscribers = new Map();

  async function ensureStarted() {
    if (healthy && client) return;

    if (server.isRunning && !client) {
      client = clientFactory
        ? await clientFactory({ baseUrl: server.baseUrl, logPrefix: `${logPrefix}:sdk` })
        : await createOpenCodeClient({ baseUrl: server.baseUrl, logPrefix: `${logPrefix}:sdk` });
      healthy = true;
      await restoreSessions();
      return;
    }

    if (!healthy) {
      try {
        await startServer();
      } catch (error) {
        const enriched = new Error(catalogUnavailable?.message || "OpenCode is not available on this Mac.");
        enriched.errorCode =
          catalogUnavailable?.reasonCode === "opencode_not_installed"
            ? ERROR_CODES.OPENCODE_NOT_INSTALLED.errorCode
            : ERROR_CODES.OPENCODE_SERVER_UNREACHABLE.errorCode;
        enriched.action =
          catalogUnavailable?.reasonCode === "opencode_not_installed"
            ? ERROR_CODES.OPENCODE_NOT_INSTALLED.action
            : ERROR_CODES.OPENCODE_SERVER_UNREACHABLE.action;
        enriched.reasonCode = catalogUnavailable?.reasonCode || enriched.errorCode;
        throw enriched;
      }
    }
  }

  async function startServer() {
    if (Date.now() - restartWindowStart > HEALTH_RESTART_WINDOW_MS) {
      restartCount = 0;
      restartWindowStart = Date.now();
    }

    if (restartCount >= HEALTH_MAX_RESTARTS) {
      catalogUnavailable = {
        unavailableReason:
          "OpenCode server could not stay running on this Mac. Check OpenCode logs.",
        reasonCode: "opencode_server_failed",
      };
      throw new Error(catalogUnavailable.unavailableReason);
    }

    restartCount++;
    console.log(
      `${logPrefix} Starting OpenCode server (attempt ${restartCount}/${HEALTH_MAX_RESTARTS})...`,
    );

    try {
      await server.start();
    } catch (error) {
      const failure = server.getLastStartFailure?.() || null;
      const reasonCode =
        readString(error?.reasonCode) ||
        readString(failure?.reasonCode) ||
        "opencode_server_failed";
      catalogUnavailable = {
        unavailableReason:
          readString(failure?.message) ||
          readString(error?.message) ||
          "OpenCode is not available on this Mac.",
        reasonCode,
      };
      throw error;
    }

    catalogUnavailable = null;
    client = clientFactory
      ? await clientFactory({ baseUrl: server.baseUrl, logPrefix: `${logPrefix}:sdk` })
      : await createOpenCodeClient({ baseUrl: server.baseUrl, logPrefix: `${logPrefix}:sdk` });
    healthy = true;
    await restoreSessions();

    resetIdleTimer();
  }

  function persistSessionRecord(thread) {
    if (!thread?.id || !thread.sessionId) return;
    sessions.set(thread.id, thread.sessionId, {
      cwd: thread.cwd,
      model: thread.model,
      agent: thread.agent,
      title: thread.title,
    });
  }

  async function rehydrateThreadIfNeeded(threadId) {
    const normalizedThreadId = readThreadId({ threadId });
    if (!normalizedThreadId) {
      throw threadNotFoundError(threadId);
    }

    const existing = threads.get(normalizedThreadId);
    if (existing) {
      return existing;
    }

    if (!ownership.ownsThread(normalizedThreadId, OPENCODE_PROVIDER_ID)) {
      throw threadNotFoundError(normalizedThreadId);
    }

    const storeEntry = sessions.getEntry(normalizedThreadId);
    const sessionId = storeEntry?.sessionId || sessions.get(normalizedThreadId);
    if (!sessionId) {
      throw threadNotFoundError(normalizedThreadId);
    }

    await ensureStarted();

    let sdkSession = null;
    try {
      sdkSession = await client.getSession(sessionId);
    } catch (error) {
      sessions.remove(normalizedThreadId);
      const expired = new Error(
        `OpenCode session expired for thread ${normalizedThreadId}. Start a new thread.`,
      );
      expired.errorCode = ERROR_CODES.OPENCODE_SESSION_EXPIRED.errorCode;
      expired.action = ERROR_CODES.OPENCODE_SESSION_EXPIRED.action;
      expired.reasonCode = "opencode_session_expired";
      throw expired;
    }

    const now = new Date().toISOString();
    const cwd =
      readString(storeEntry?.cwd) ||
      readString(sdkSession?.directory) ||
      readString(sdkSession?.cwd) ||
      process.cwd();
    const thread = {
      id: normalizedThreadId,
      title: readString(storeEntry?.title) || "OpenCode chat",
      cwd,
      model: normalizeOpenCodeModel(storeEntry?.model || sdkSession?.model),
      agent: readString(storeEntry?.agent) || "build",
      createdAt: readString(storeEntry?.updatedAt) || now,
      updatedAt: now,
      archived: false,
      hasProjectCwd: Boolean(readString(storeEntry?.cwd)),
      turns: [],
      sessionId,
    };

    try {
      const messages = await client.getMessages(sessionId);
      if (messages && messages.length > 0) {
        thread.turns = messagesToTurns(messages, normalizedThreadId);
      }
    } catch {
      // In-memory turns stay empty; thread/read still succeeds.
    }

    threads.set(normalizedThreadId, thread);
    persistSessionRecord(thread);
    rememberThreadProject(thread, "opencode-rehydrate");
    return thread;
  }

  async function requireThread(threadId) {
    const normalizedThreadId = readThreadId({ threadId });
    const existing = threads.get(normalizedThreadId);
    if (existing) {
      return existing;
    }
    return rehydrateThreadIfNeeded(normalizedThreadId);
  }

  function ownsThread(threadId) {
    const normalized = readString(threadId);
    return ownership.ownsThread(normalized, OPENCODE_PROVIDER_ID) || threads.has(normalized);
  }

  async function listModels() {
    try {
      await ensureStarted();
    } catch {
      return [];
    }
    return client.listModels();
  }

  // Starts opencode serve in the background so the first model/list is not capped out.
  async function warmup() {
    try {
      await ensureStarted();
      console.log(`${logPrefix} OpenCode warmup complete`);
    } catch (error) {
      console.warn(
        `${logPrefix} OpenCode warmup failed: ${(error && error.message) || error}`,
      );
    }
  }

  async function listAgents() {
    try {
      await ensureStarted();
    } catch {
      return [];
    }
    return client.listAgents();
  }

  async function listCommands(directory) {
    try {
      await ensureStarted();
    } catch {
      return [];
    }
    return client.listCommands(directory);
  }

  async function listSkills(directory) {
    try {
      await ensureStarted();
    } catch {
      return [];
    }
    return client.listSkills(directory);
  }

  async function listThreads(params = {}) {
    const limit = boundedPositiveInteger(params.limit, 50);
    const includeArchived = params.includeArchived === true || params.include_archived === true;

    const localThreads = Array.from(threads.values())
      .filter((thread) => includeArchived || !thread.archived)
      .map((thread) => publicThread(thread));

    let sessionThreads = [];
    try {
      const ownedThreads = ownership.getAllOwnedBy(OPENCODE_PROVIDER_ID);
      sessionThreads = ownedThreads.map((entry) => ({
        id: entry.threadId,
        title: "OpenCode chat",
        name: "OpenCode chat",
        model: DEFAULT_OPENCODE_MODEL,
        modelProvider: OPENCODE_PROVIDER_ID,
        provider: OPENCODE_PROVIDER_ID,
        createdAt: entry.assignedAt,
        updatedAt: entry.assignedAt,
      }));
    } catch {
      sessionThreads = [];
    }

    const seen = new Set();
    const data = [...localThreads, ...sessionThreads]
      .filter((thread) => {
        if (!thread?.id || seen.has(thread.id)) return false;
        seen.add(thread.id);
        return true;
      })
      .toSorted(compareThreadsByUpdatedAt)
      .slice(0, limit);

    return { data, nextCursor: null };
  }

  async function handleRequest(request) {
    const method = readString(request?.method);
    switch (method) {
      case "thread/start":
        return threadStart(request);
      case "thread/resume":
      case "thread/read":
        return threadRead(request);
      case "thread/turns/list":
        return threadTurnsList(request);
      case "thread/name/set":
        return threadNameSet(request);
      case "thread/archive":
        return threadArchive(request, true);
      case "thread/unarchive":
        return threadArchive(request, false);
      case "thread/fork":
        return threadFork(request);
      case "turn/start":
        return turnStart(request);
      case "turn/interrupt":
        return turnInterrupt(request);
      case "permission/reply":
        return permissionReply(request);
      default:
        throw unsupportedMethodError(method);
    }
  }

  function handleApplicationResponse() {
    return false;
  }

  async function shutdown() {
    stopIdleTimer();
    for (const [, unsubscribe] of eventUnsubscribers) {
      unsubscribe();
    }
    eventUnsubscribers.clear();
    await server.stop();
    client = null;
    healthy = false;
  }

  async function threadStart(request) {
    const params = request.params || {};
    const now = new Date().toISOString();
    const requestedCwd = resolvedParam(params, 'cwd', 'current_working_directory', 'working_directory');
    const threadId = `${OPENCODE_PROVIDER_ID}-thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resolvedSessionId = resolvedParam(params, 'sessionId', 'session_id');
    const thread = {
      id: threadId,
      title: readString(params.title) || "OpenCode chat",
      cwd: requestedCwd || process.cwd(),
      model: normalizeOpenCodeModel(params.model),
      agent: readString(params.agent) || "build",
      createdAt: now,
      updatedAt: now,
      archived: false,
      hasProjectCwd: Boolean(requestedCwd),
      turns: [],
      sessionId: resolvedSessionId || "",
    };
    threads.set(threadId, thread);
    ownership.setOwnership(threadId, OPENCODE_PROVIDER_ID);
    if (resolvedSessionId) {
      thread.sessionId = resolvedSessionId;
      persistSessionRecord(thread);
    }
    rememberThreadProject(thread, "opencode-thread-start");
    return { thread: publicThread(thread) };
  }

  async function threadRead(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const thread = await requireThread(threadId);

    rememberThreadProject(thread, "opencode-thread-read");
    const responseThread = { ...publicThread(thread) };
    if (params.includeTurns === true || params.include_turns === true) {
      responseThread.turns = thread.turns || [];
    }
    return { thread: responseThread };
  }

  async function threadTurnsList(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const thread = await requireThread(threadId);

    const limit = boundedPositiveInteger(params.limit, 50);
    const sortDirection = resolvedParam(params, 'sortDirection', 'sort_direction') || "desc";
    const turns = [...(thread.turns || [])];
    if (sortDirection === "asc") turns.reverse();

    // Try SDK messages if session exists
    if (thread.sessionId) {
      try {
        await ensureStarted();
        const messages = await client.getMessages(thread.sessionId);
        if (messages && messages.length > 0) {
          const sdkTurns = messagesToTurns(messages, threadId);
          return { data: sdkTurns.slice(0, limit), nextCursor: null };
        }
      } catch {
        // Fall through to in-memory turns
      }
    }

    return { data: turns.slice(0, limit), nextCursor: null };
  }

  async function turnStart(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const thread = await requireThread(threadId);

    for (const [, active] of activeTurns) {
      if (active.thread.id === threadId) throw activeTurnError(threadId);
    }

    const model = normalizeOpenCodeModel(params.model || thread.model);
    const { inputText, prompt, parts } = buildPromptFromTurnInput(params.input);
    if (!prompt && (!Array.isArray(parts) || parts.length === 0)) {
      const error = new Error("OpenCode turn/start requires text input.");
      error.errorCode = "opencode_input_required";
      throw error;
    }

    thread.model = model;
    thread.agent = resolvedParam(params, 'agent', 'mode') || thread.agent || "build";
    thread.updatedAt = new Date().toISOString();

    const turnId = `${OPENCODE_PROVIDER_ID}-turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const effort = resolvedParam(params, 'reasoningEffort', 'reasoning_effort', 'effort');
    const now = new Date().toISOString();
    const assistantItemId = `${OPENCODE_PROVIDER_ID}-agent-${turnId}`;

    const turn = {
      id: turnId,
      model,
      status: "running",
      createdAt: now,
      items: [
        {
          id: `${OPENCODE_PROVIDER_ID}-user-${turnId}`,
          type: "userMessage",
          role: "user",
          text: inputText,
          content: textContent(inputText),
          createdAt: now,
        },
        {
          id: assistantItemId,
          type: "agentMessage",
          role: "assistant",
          phase: "final",
          text: "",
          content: textContent(""),
          createdAt: now,
        },
      ],
      metadata: { threadId, provider: OPENCODE_PROVIDER_ID },
    };
    thread.turns.push(turn);

    const active = {
      agent: thread.agent,
      assistantItemId,
      effort,
      sessionId: "",
      thread,
      turn,
      started: false,
      completed: false,
    };
    activeTurns.set(turnId, active);
    ownership.setOwnership(thread.id, OPENCODE_PROVIDER_ID);

    emit("turn/started", { threadId: thread.id, turnId, turn: { id: turnId, status: "running" } });

    setImmediate(() => executeTurn(active, model, thread.agent, effort, prompt, parts, thread.cwd));
    return { turnId, turn: { id: turnId, threadId: thread.id, status: "running" } };
  }

  async function executeTurn(active, model, agent, effort, prompt, parts, cwd) {
    try {
      await ensureStarted();

      if (!active.thread.sessionId) {
        const sessionId = await client.createSession({ cwd });
        active.sessionId = sessionId;
        active.thread.sessionId = sessionId;
        persistSessionRecord(active.thread);
      } else {
        active.sessionId = active.thread.sessionId;
      }

      const unsubscribe = client.subscribeToEvents((method, params) => {
        if (active.completed) return;
        const enriched = {
          ...params,
          threadId: active.thread.id,
          turnId: active.turn.id,
        };

        if (method === "item/agentMessage/delta") {
          const assistantItem = active.turn.items.find((item) => item.type === "agentMessage");
          if (assistantItem) {
            assistantItem.text += readString(params.delta || "");
          }
        }

        if (method === "turn/completed") {
          completeTurn({ status: readString(params.status) || "completed", active });
        }

        emit(method, enriched);
      });
      eventUnsubscribers.set(active.turn.id, unsubscribe);

      await client.setModel({ sessionID: active.sessionId, model });
      await client.setMode({ sessionID: active.sessionId, mode: agent });
      if (effort) {
        await client.setEffort({ sessionID: active.sessionId, effort });
      }

      await client.prompt({ sessionID: active.sessionId, prompt, parts, cwd });
      active.started = true;
    } catch (error) {
      completeTurn({
        errorMessage: error?.message || "OpenCode SDK turn failed.",
        errorCode: error?.errorCode || ERROR_CODES.OPENCODE_TURN_FAILED.errorCode,
        action: error?.action || ERROR_CODES.OPENCODE_TURN_FAILED.action,
        status: "failed",
        active,
      });
    }
  }

  function completeTurn({ errorMessage = "", errorCode = "", action = "", status, active }) {
    const turnId = active.turn.id;
    if (active.completed) return false;
    active.completed = true;

    const unsubscribe = eventUnsubscribers.get(turnId);
    if (unsubscribe) {
      unsubscribe();
      eventUnsubscribers.delete(turnId);
    }

    activeTurns.delete(turnId);
    active.thread.updatedAt = new Date().toISOString();
    active.turn.status = status;
    active.turn.completedAt = active.thread.updatedAt;

    if (errorMessage) {
      active.turn.error = { message: errorMessage, errorCode: errorCode || null, action: action || null };
    }

    const assistantItem = active.turn.items.find((item) => item.type === "agentMessage");
    if (assistantItem && assistantItem.text) {
      emit("item/completed", {
        threadId: active.thread.id,
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
        },
      });
    }

    emit("turn/completed", {
      threadId: active.thread.id,
      turnId,
      model: active.thread.model,
      status,
      turn: { id: turnId, status, error: errorMessage ? { message: errorMessage } : undefined },
    });

    resetIdleTimer();
    return true;
  }

  async function permissionReply(request) {
    const params = request.params || {};
    const permissionId = readString(
      params.permissionId || params.permission_id || params.requestId,
    );
    const allow = params.allow === true || params.approved === true || params.accept === true;
    if (!permissionId) {
      return { success: false, reason: "Missing permission ID" };
    }
    try {
      await ensureStarted();
      await client.replyToPermission(permissionId, allow);
      return { success: true, permissionId, allow };
    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  async function turnInterrupt(request) {
    const params = request.params || {};
    const turnId = readString(params.turnId || params.turn_id);
    const threadId = readThreadId(params);
    const resolvedTurnId = turnId || findActiveTurnByThread(threadId);
    const active = activeTurns.get(resolvedTurnId);
    if (!active) return { success: true, interrupted: false };

    try {
      if (active.sessionId && active.started) await client.abort(active.sessionId);
    } catch {
      // Best effort
    }

    completeTurn({ status: "stopped", active });
    return { success: true, interrupted: true };
  }

  function findActiveTurnByThread(threadId) {
    for (const [turnId, active] of activeTurns) {
      if (active.thread.id === threadId) return turnId;
    }
    return "";
  }

  async function threadNameSet(request) {
    const params = request.params || {};
    const thread = await requireThread(readThreadId(params));

    const name = resolvedParam(params, 'name', 'title');
    if (name) {
      thread.title = name;
      thread.updatedAt = new Date().toISOString();
      persistSessionRecord(thread);
    }

    const publicValue = publicThread(thread);
    emit("thread/name/updated", {
      threadId: publicValue.id,
      thread_id: publicValue.id,
      name: publicValue.name,
      title: publicValue.title,
    });
    return { thread: publicValue };
  }

  async function threadArchive(request, archived) {
    const thread = await requireThread(readThreadId(request.params));
    thread.archived = archived;
    thread.updatedAt = new Date().toISOString();
    return { thread: publicThread(thread) };
  }

  async function threadFork(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const thread = await requireThread(threadId);
    if (!thread.sessionId) {
      const error = new Error("OpenCode fork requires a session on the source thread");
      error.errorCode = "opencode_fork_requires_session";
      throw error;
    }

    try {
      await ensureStarted();
    } catch (error) {
      if (error.errorCode === ERROR_CODES.OPENCODE_NOT_INSTALLED.errorCode) {
        const forkError = new Error("OpenCode server is unreachable. Fork could not complete.");
        forkError.errorCode = ERROR_CODES.OPENCODE_SERVER_UNREACHABLE.errorCode;
        forkError.action = ERROR_CODES.OPENCODE_SERVER_UNREACHABLE.action;
        throw forkError;
      }
      throw error;
    }
    const newSessionId = await client.fork(thread.sessionId);
    return threadStart({
      params: {
        sessionId: newSessionId,
        model: thread.model,
        agent: thread.agent,
        cwd: thread.cwd,
      },
    });
  }

  function resetIdleTimer() {
    stopIdleTimer();
    idleTimer = setTimeout(() => {
      const idleDuration = Date.now() - lastActivityAt;
      if (idleDuration >= HEALTH_IDLE_SHUTDOWN_MS && activeTurns.size === 0) {
        console.log(
          `${logPrefix} OpenCode server idle for ${Math.round(idleDuration / 60000)}min, shutting down.`,
        );
        server.stop().then(() => {
          client = null;
          healthy = false;
        });
      }
    }, HEALTH_IDLE_SHUTDOWN_MS);
  }

  function stopIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  async function restoreSessions() {
    activeTurns.clear();
    for (const [threadId, entry] of sessions.entries()) {
      const sessionId =
        typeof entry === "string" ? entry : readString(entry?.sessionId);
      const thread = threads.get(threadId);
      if (thread) {
        if (sessionId) {
          thread.sessionId = sessionId;
        }
        continue;
      }
      try {
        await rehydrateThreadIfNeeded(threadId);
      } catch (error) {
        console.warn(
          `${logPrefix} OpenCode session rehydrate skipped for ${threadId}: ${
            (error && error.message) || error
          }`,
        );
      }
    }
  }

  function rememberThreadProject(thread, source) {
    if (!projectRegistry || !thread?.hasProjectCwd) return;
    try {
      projectRegistry.rememberProjectPath(thread.cwd, {
        source,
        provider: OPENCODE_PROVIDER_ID,
        lastSeenAt: thread.updatedAt || thread.createdAt,
      });
    } catch {}
  }

  function emit(method, params) {
    sendApplicationMessage?.(
      JSON.stringify({ method, params: removeUndefinedValues(params || {}) }),
    );
  }

  function getCatalogAvailability() {
    return catalogUnavailable ? { ...catalogUnavailable } : null;
  }

  return {
    id: OPENCODE_PROVIDER_ID,
    ownsThread,
    listModels,
    listAgents,
    listCommands,
    listSkills,
    listThreads,
    handleRequest,
    handleApplicationResponse,
    warmup,
    shutdown,
    getCatalogAvailability,
  };
}

function unsupportedMethodError(method) {
  const error = new Error(`Unsupported OpenCode provider method: ${method || "unknown"}`);
  error.errorCode = "unsupported_opencode_method";
  return error;
}

function threadNotFoundError(threadId) {
  const error = new Error(`OpenCode thread not found: ${threadId || "unknown"}`);
  error.errorCode = "thread_not_found";
  return error;
}

function activeTurnError(threadId) {
  const error = new Error(`OpenCode thread already has a running turn: ${threadId}`);
  error.errorCode = "thread_turn_active";
  return error;
}

module.exports = { createOpenCodeProvider };
