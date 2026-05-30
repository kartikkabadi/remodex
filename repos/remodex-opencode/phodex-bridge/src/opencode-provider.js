// FILE: opencode-provider.js
// Purpose: Adapts OpenCode SDK (opencode serve + @opencode-ai/sdk/v2) to Remodex
//          provider-aware thread/turn RPCs. Manages server lifecycle, session
//          mapping, event streaming, and permission bridging.
// Layer: Bridge runtime provider
// Exports: createOpenCodeProvider
// Depends on: ./opencode-server, ./opencode-client, ./opencode-models, ./provider-capabilities, ./thread-ownership-store

const { createOpenCodeServer } = require("./opencode-server");
const { createOpenCodeClient } = require("./opencode-client");
const {
  DEFAULT_OPENCODE_MODEL,
  OPENCODE_PROVIDER_ID,
  normalizeOpenCodeModelReference,
} = require("./opencode-models");
const { resolveModelCapabilities } = require("./provider-capabilities");
const { createThreadOwnershipStore } = require("./thread-ownership-store");

const HEALTH_RESTART_WINDOW_MS = 5 * 60 * 1000;
const HEALTH_MAX_RESTARTS = 3;
const HEALTH_IDLE_SHUTDOWN_MS = 10 * 60 * 1000;

function createOpenCodeProvider({
  sendApplicationMessage,
  env = process.env,
  projectRegistry = null,
  ownershipStore = null,
  logPrefix = "[remodex]",
  serverFactory = null,
  clientFactory = null,
} = {}) {
  const server = serverFactory
    ? serverFactory({ env, logPrefix: `${logPrefix}:server` })
    : createOpenCodeServer({ env, logPrefix: `${logPrefix}:server` });
  const ownership = ownershipStore || createThreadOwnershipStore();

  let client = null;
  let healthy = false;
  let healthReason = "";
  let restartCount = 0;
  let restartWindowStart = 0;
  let lastActivityAt = 0;
  let idleTimer = null;

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
      return;
    }

    if (!healthy) {
      try {
        await startServer();
      } catch (error) {
        healthReason = error.message;
        throw error;
      }
    }
  }

  async function startServer() {
    if (Date.now() - restartWindowStart > HEALTH_RESTART_WINDOW_MS) {
      restartCount = 0;
      restartWindowStart = Date.now();
    }

    if (restartCount >= HEALTH_MAX_RESTARTS) {
      throw new Error("OpenCode server has restarted too many times. Check opencode installation.");
    }

    restartCount++;
    console.log(`${logPrefix} Starting OpenCode server (attempt ${restartCount}/${HEALTH_MAX_RESTARTS})...`);

    await server.start();
    client = clientFactory
      ? await clientFactory({ baseUrl: server.baseUrl, logPrefix: `${logPrefix}:sdk` })
      : await createOpenCodeClient({ baseUrl: server.baseUrl, logPrefix: `${logPrefix}:sdk` });
    healthy = true;
    healthReason = "";
    resetIdleTimer();
  }

  function ownsThread(threadId) {
    const normalized = readString(threadId);
    return ownership.ownsThread(normalized, OPENCODE_PROVIDER_ID)
      || threads.has(normalized);
  }

  async function listModels() {
    try {
      await ensureStarted();
    } catch {
      return [];
    }
    return client.listModels();
  }

  async function listAgents() {
    try {
      await ensureStarted();
    } catch {
      return [];
    }
    return client.listAgents();
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
      .sort(compareThreadsByUpdatedAt)
      .slice(0, limit);

    return { data, nextCursor: null };
  }

  async function handleRequest(request) {
    const method = readString(request?.method);
    switch (method) {
      case "thread/start": return threadStart(request);
      case "thread/resume":
      case "thread/read": return threadRead(request);
      case "thread/turns/list": return threadTurnsList(request);
      case "thread/name/set": return threadNameSet(request);
      case "thread/archive": return threadArchive(request, true);
      case "thread/unarchive": return threadArchive(request, false);
      case "turn/start": return turnStart(request);
      case "turn/interrupt": return turnInterrupt(request);
      default:
        throw unsupportedMethodError(method);
    }
  }

  function handleApplicationResponse() {
    return false;
  }

  async function shutdown() {
    stopIdleTimer();
    for (const [turnId, unsubscribe] of eventUnsubscribers) {
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
    const requestedCwd = readString(params.cwd || params.current_working_directory || params.working_directory);
    const threadId = `${OPENCODE_PROVIDER_ID}-thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      sessionId: "",
    };
    threads.set(threadId, thread);
    ownership.setOwnership(threadId, OPENCODE_PROVIDER_ID);
    rememberThreadProject(thread, "opencode-thread-start");
    return { thread: publicThread(thread) };
  }

  async function threadRead(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const thread = threads.get(threadId);
    if (!thread) throw threadNotFoundError(threadId);

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
    const thread = threads.get(threadId);
    if (!thread) throw threadNotFoundError(threadId);

    const limit = boundedPositiveInteger(params.limit, 50);
    const sortDirection = readString(params.sortDirection || params.sort_direction) || "desc";
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
    const thread = threads.get(threadId);
    if (!thread) throw threadNotFoundError(threadId);

    for (const [, active] of activeTurns) {
      if (active.thread.id === threadId) throw activeTurnError(threadId);
    }

    const model = normalizeOpenCodeModel(params.model || thread.model);
    const { inputText, prompt } = buildPromptFromTurnInput(params.input);
    if (!prompt) {
      const error = new Error("OpenCode turn/start requires text input.");
      error.errorCode = "opencode_input_required";
      throw error;
    }

    thread.model = model;
    thread.agent = readString(params.agent || params.mode) || thread.agent || "build";
    thread.updatedAt = new Date().toISOString();

    const turnId = `${OPENCODE_PROVIDER_ID}-turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const effort = readString(params.reasoningEffort || params.reasoning_effort || params.effort);
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
      assistantText: "",
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

    setImmediate(() => executeTurn(active, model, thread.agent, effort, prompt, thread.cwd));
    return { turnId, turn: { id: turnId, threadId: thread.id, status: "running" } };
  }

  async function executeTurn(active, model, agent, effort, prompt, cwd) {
    try {
      await ensureStarted();

      if (!active.thread.sessionId) {
        const sessionId = await client.createSession({ cwd });
        active.sessionId = sessionId;
        active.thread.sessionId = sessionId;
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
          active.assistantText += readString(params.delta || "");
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

      await client.prompt({ sessionID: active.sessionId, prompt, cwd });
      active.started = true;

    } catch (error) {
      completeTurn({
        errorMessage: error?.message || "OpenCode SDK turn failed.",
        status: "failed",
        active,
      });
    }
  }

  function completeTurn({ errorMessage = "", status, active }) {
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
      active.turn.error = { message: errorMessage };
    }

    const assistantItem = active.turn.items.find((item) => item.type === "agentMessage");
    if (assistantItem && assistantItem.text) {
      emit("item/completed", {
        threadId: active.thread.id,
        turnId,
        itemId: assistantItem.id,
        message: assistantItem.text,
        assistantPhase: "final_answer",
        item: { id: assistantItem.id, turnId, type: "agentMessage", phase: "final", text: assistantItem.text },
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
    const thread = threads.get(readThreadId(params));
    if (!thread) throw threadNotFoundError(readThreadId(params));

    const name = readString(params.name || params.title);
    if (name) {
      thread.title = name;
      thread.updatedAt = new Date().toISOString();
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
    const thread = threads.get(readThreadId(request.params));
    if (!thread) throw threadNotFoundError(readThreadId(request.params));
    thread.archived = archived;
    thread.updatedAt = new Date().toISOString();
    return { thread: publicThread(thread) };
  }

  function markActivity() { lastActivityAt = Date.now(); }

  function resetIdleTimer() {
    stopIdleTimer();
    idleTimer = setTimeout(() => {
      const idleDuration = Date.now() - lastActivityAt;
      if (idleDuration >= HEALTH_IDLE_SHUTDOWN_MS && activeTurns.size === 0) {
        console.log(`${logPrefix} OpenCode server idle for ${Math.round(idleDuration / 60000)}min, shutting down.`);
        server.stop().then(() => {
          client = null;
          healthy = false;
        });
      }
    }, HEALTH_IDLE_SHUTDOWN_MS);
  }

  function stopIdleTimer() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  function rememberThreadProject(thread, source) {
    if (!projectRegistry || !thread?.hasProjectCwd) return;
    try {
      projectRegistry.rememberProjectPath(thread.cwd, { source, provider: OPENCODE_PROVIDER_ID, lastSeenAt: thread.updatedAt || thread.createdAt });
    } catch {}
  }

  function emit(method, params) {
    sendApplicationMessage?.(JSON.stringify({ method, params: removeUndefinedValues(params || {}) }));
  }

  return {
    id: OPENCODE_PROVIDER_ID,
    ownsThread,
    listModels,
    listAgents,
    listThreads,
    handleRequest,
    handleApplicationResponse,
    shutdown,
  };
}

function normalizeOpenCodeModel(value) {
  return normalizeOpenCodeModelReference(value) || DEFAULT_OPENCODE_MODEL;
}

function publicThread(thread) {
  return {
    id: thread.id,
    title: thread.title,
    name: thread.title,
    cwd: thread.hasProjectCwd !== false ? thread.cwd : null,
    model: thread.model || DEFAULT_OPENCODE_MODEL,
    modelProvider: OPENCODE_PROVIDER_ID,
    provider: OPENCODE_PROVIDER_ID,
    agent: thread.agent || "",
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    metadata: { provider: OPENCODE_PROVIDER_ID },
  };
}

function buildPromptFromTurnInput(input) {
  if (typeof input === "string") return { inputText: input.trim(), prompt: input.trim() };
  if (!Array.isArray(input)) return { inputText: "", prompt: "" };

  const textParts = [];
  for (const item of input) {
    if (typeof item === "string") { appendNonEmpty(textParts, item); continue; }
    if (!item || typeof item !== "object") continue;
    const type = readString(item.type).toLowerCase();
    if (type.includes("image")) {
      const imagePath = readString(item.path || item.url || item.image_url || item.dataURL);
      appendNonEmpty(textParts, imagePath ? `[image attached: ${imagePath}]` : "[image attached]");
      continue;
    }
    appendNonEmpty(textParts, item.text || item.content || item.message);
  }
  const prompt = textParts.join("\n\n").trim();
  return { inputText: prompt, prompt };
}

function messagesToTurns(messages, threadId) {
  const turns = [];
  let currentTurn = null;
  for (const msg of messages) {
    if (!msg) continue;
    const role = readString(msg.role);
    if (role === "user") {
      currentTurn = {
        id: `turn-${turns.length}`,
        model: "",
        status: "completed",
        createdAt: msg.createdAt || new Date().toISOString(),
        items: [{
          id: `user-${turns.length}`,
          type: "userMessage",
          role: "user",
          text: readString(msg.content || msg.text),
          content: textContent(readString(msg.content || msg.text)),
          createdAt: msg.createdAt || new Date().toISOString(),
        }],
        metadata: { threadId, provider: OPENCODE_PROVIDER_ID },
      };
      turns.push(currentTurn);
    } else if (role === "assistant" && currentTurn) {
      currentTurn.items.push({
        id: `assistant-${turns.length}`,
        type: "agentMessage",
        role: "assistant",
        phase: "final",
        text: readString(msg.content || msg.text),
        content: textContent(readString(msg.content || msg.text)),
        createdAt: msg.createdAt || new Date().toISOString(),
      });
    }
  }
  return turns;
}

function textContent(text) {
  return [{ type: "text", text: text || "" }];
}

function compareThreadsByUpdatedAt(lhs, rhs) {
  const lhsTime = Date.parse(lhs?.updatedAt || lhs?.updated_at || lhs?.createdAt || lhs?.created_at || 0) || 0;
  const rhsTime = Date.parse(rhs?.updatedAt || rhs?.updated_at || rhs?.createdAt || rhs?.created_at || 0) || 0;
  return rhsTime - lhsTime;
}

function boundedPositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(Math.floor(numeric), 200);
}

function removeUndefinedValues(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) result[key] = removeUndefinedValues(child);
  }
  return result;
}

function appendNonEmpty(target, value) {
  const text = readString(value);
  if (text) target.push(text);
}

function readThreadId(params = {}) {
  return readString(params.threadId || params.thread_id || params.id);
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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
