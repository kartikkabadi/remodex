// FILE: opencode-provider.js
// Purpose: Adapts the local OpenCode ACP process to Remodex provider-aware thread/turn RPCs.
//          Replaces CLI `opencode run` with full ACP stdio transport. Handles streaming
//          event mapping, permission bridging, health monitoring, and restart circuit breaker.
// Layer: Bridge runtime provider
// Exports: createOpenCodeProvider
// Depends on: child_process, crypto, ./opencode-models, ./opencode-reasoning, ./opencode-catalog, ./opencode-agents, ./acp-transport, ./provider-capabilities, ./thread-ownership-store

const { createAcpTransport } = require("./acp-transport");
const { createOpenCodeCatalog } = require("./opencode-catalog");
const { createAgentDiscovery } = require("./opencode-agents");
const {
  DEFAULT_OPENCODE_MODEL,
  OPENCODE_PROVIDER_ID,
  normalizeOpenCodeModelReference,
} = require("./opencode-models");
const { CAPABILITIES, resolveModelCapabilities } = require("./provider-capabilities");
const { createThreadOwnershipStore } = require("./thread-ownership-store");
const { parseOpenCodeExport } = require("./opencode-export");

const HEALTH_RESTART_WINDOW_MS = 5 * 60 * 1000;
const HEALTH_MAX_RESTARTS = 3;
const HEALTH_IDLE_SHUTDOWN_MS = 10 * 60 * 1000;

function createOpenCodeProvider({
  sendApplicationMessage,
  env = process.env,
  projectRegistry = null,
  ownershipStore = null,
  acpTransport = null,
  agentDiscoveryService = null,
  catalogService = null,
  logPrefix = "[remodex]",
} = {}) {
  return new OpenCodeProvider({
    acpTransport,
    agentDiscoveryService,
    catalogService,
    env,
    logPrefix,
    ownershipStore,
    projectRegistry,
    sendApplicationMessage,
  });
}

class OpenCodeProvider {
  constructor({
    sendApplicationMessage,
    env,
    projectRegistry,
    ownershipStore,
    acpTransport,
    agentDiscoveryService,
    catalogService,
    logPrefix,
  }) {
    this.id = OPENCODE_PROVIDER_ID;
    this.sendApplicationMessage = sendApplicationMessage;
    this.env = env;
    this.projectRegistry = projectRegistry;
    this.logPrefix = logPrefix;
    this.ownership = ownershipStore || createThreadOwnershipStore();
    this.agentDiscovery = agentDiscoveryService || createAgentDiscovery({ env, logPrefix });
    this.acp = acpTransport || createAcpTransport({ env, logPrefix });
    this.catalog = catalogService || createOpenCodeCatalog({
      env,
      acpTransport: this.acp,
      agentDiscovery: this.agentDiscovery,
      logPrefix,
    });

    this.threads = new Map();
    this.activeSessions = new Map();
    this.activeTurns = new Map();
    this.notificationUnsubscribes = [];

    this.healthy = false;
    this.healthReason = "";
    this.restartCount = 0;
    this.restartWindowStart = 0;
    this.lastActivityAt = 0;
    this.idleTimer = null;

    this._pendingPermissions = new Map();
  }

  ownsThread(threadId) {
    const normalized = readString(threadId);
    return this.ownership.ownsThread(normalized, this.id)
      || this.threads.has(normalized);
  }

  async getAgentList() {
    return this.catalog.fetchAgents();
  }

  async listModels() {
    await this.ensureStarted();
    return this.catalog.fetchModels();
  }

  async listThreads(params = {}) {
    const limit = boundedPositiveInteger(params.limit, 50);
    const includeArchived = params.includeArchived === true || params.include_archived === true;
    const localThreads = Array.from(this.threads.values())
      .filter((thread) => includeArchived || !thread.archived)
      .map((thread) => publicThread(thread));

    let sessionThreads = [];
    try {
      const ownedThreads = this.ownership.getAllOwnedBy(this.id);
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
        if (!thread?.id || seen.has(thread.id)) {
          return false;
        }
        seen.add(thread.id);
        return true;
      })
      .sort(compareThreadsByUpdatedAt)
      .slice(0, limit);

    return { data, nextCursor: null };
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

  handleApplicationResponse() {
    return false;
  }

  shutdown() {
    this.stopIdleTimer();
    for (const unsubscribe of this.notificationUnsubscribes) {
      unsubscribe();
    }
    this.notificationUnsubscribes = [];
    this.acp.stop();
    this.healthy = false;
  }

  async ensureStarted() {
    if (!this.healthy && this.acp.isConnected()) {
      this.healthy = true;
    }

    if (!this.healthy) {
      try {
        await this.startAcp();
      } catch (error) {
        this.healthReason = error.message;
        throw error;
      }
    }

    this.markActivity();
  }

  async startAcp() {
    if (Date.now() - this.restartWindowStart > HEALTH_RESTART_WINDOW_MS) {
      this.restartCount = 0;
      this.restartWindowStart = Date.now();
    }

    if (this.restartCount >= HEALTH_MAX_RESTARTS) {
      throw new Error("OpenCode ACP has restarted too many times. Please check opencode installation.");
    }

    this.restartCount++;
    console.log(`${this.logPrefix} Starting OpenCode ACP (attempt ${this.restartCount}/${HEALTH_MAX_RESTARTS})...`);

    await this.catalog.probeVersion();
    await this.acp.start();
    this.healthy = true;
    this.healthReason = "";
    this.setupNotificationListeners();
    this.resetIdleTimer();
  }

  setupNotificationListeners() {
    for (const unsubscribe of this.notificationUnsubscribes) {
      unsubscribe();
    }
    this.notificationUnsubscribes = [];

    this.notificationUnsubscribes.push(
      this.acp.onNotification("session/update", (params) => {
        this.handleSessionUpdate(params);
      })
    );

    this.notificationUnsubscribes.push(
      this.acp.onNotification("request_permission", (params) => {
        this.handlePermissionRequest(params);
      })
    );

    this.acp.onClose(({ code, signal, expected }) => {
      this.healthy = false;
      if (!expected) {
        this.healthReason = `OpenCode ACP exited unexpectedly (code ${code}, signal ${signal}).`;
        console.warn(`${this.logPrefix} ${this.healthReason}`);
      }
    });

    this.acp.onError((error) => {
      this.healthy = false;
      this.healthReason = error.message;
      console.error(`${this.logPrefix} OpenCode ACP error: ${error.message}`);
    });
  }

  handleSessionUpdate(params) {
    this.markActivity();

    const update = readString(params.sessionUpdate || params.session_update);
    const sessionId = readString(params.sessionId || params.session_id);

    if (!update && sessionId) {
      const active = this.findActiveTurnBySession(sessionId);
      if (active) {
        this.routeSessionUpdateToActive(active, params);
      }
      return;
    }

    switch (update) {
      case "agent_message_chunk":
        this.handleAgentMessageChunk(params);
        break;
      case "agent_thought_chunk":
        this.handleAgentThoughtChunk(params);
        break;
      case "tool_call":
        this.handleToolCall(params);
        break;
      case "tool_call_update":
        this.handleToolCallUpdate(params);
        break;
      case "current_mode_update":
        this.handleModeUpdate(params);
        break;
      case "config_option_update":
        break;
      default:
        break;
    }
  }

  handleAgentMessageChunk(params) {
    const turnId = readString(params.turnId || params.turn_id);
    const active = this.activeTurns.get(turnId);
    if (!active) {
      return;
    }

    const delta = readString(params.delta || params.textDelta || params.text);
    if (!delta || isRedactedTextPlaceholder(delta)) {
      return;
    }

    active.assistantText += delta;
    const assistantItem = active.turn.items.find((item) => item.type === "agentMessage");
    if (assistantItem) {
      assistantItem.text = active.assistantText;
      assistantItem.content = textContent(active.assistantText);
    }

    this.emit("item/agentMessage/delta", {
      threadId: active.thread.id,
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

  handleAgentThoughtChunk(params) {
    const turnId = readString(params.turnId || params.turn_id);
    const active = this.activeTurns.get(turnId);
    if (!active) {
      return;
    }

    const delta = readString(params.delta || params.textDelta || params.text);
    if (!delta || isRedactedTextPlaceholder(delta)) {
      return;
    }

    this.emit("item/reasoning/textDelta", {
      threadId: active.thread.id,
      turnId,
      itemId: `opencode-reasoning-${turnId}`,
      delta,
      textDelta: delta,
      item: {
        id: `opencode-reasoning-${turnId}`,
        type: "reasoning",
        turnId,
      },
    });
  }

  handleToolCall(params) {
    const turnId = readString(params.turnId || params.turn_id);
    const active = this.activeTurns.get(turnId);
    if (!active) {
      return;
    }

    const toolName = readString(params.toolName || params.tool_name || params.name);
    const toolId = readString(params.toolCallId || params.tool_call_id || params.id);

    this.emit("item/toolCall", {
      threadId: active.thread.id,
      turnId,
      itemId: toolId,
      toolName,
      status: "pending",
    });
  }

  handleToolCallUpdate(params) {
    const turnId = readString(params.turnId || params.turn_id);
    const active = this.activeTurns.get(turnId);
    if (!active) {
      return;
    }

    const toolId = readString(params.toolCallId || params.tool_call_id || params.id);
    const status = readString(params.status);

    this.emit("item/toolCallUpdate", {
      threadId: active.thread.id,
      turnId,
      itemId: toolId,
      status: status || "completed",
    });
  }

  handleModeUpdate(params) {
    const turnId = readString(params.turnId || params.turn_id);
    const active = this.activeTurns.get(turnId);
    if (!active) {
      return;
    }

    const modeId = readString(params.currentModeId || params.current_mode_id || params.modeId || params.mode_id);
    if (modeId) {
      active.agent = modeId;
    }
  }

  routeSessionUpdateToActive(active, params) {
    const message = params.part || params.message || params;
    if (!message) {
      return;
    }

    this.handleAgentMessageChunk({
      turnId: active.turn.id,
      delta: readString(message.text || message.delta),
    });
  }

  handlePermissionRequest(params) {
    const permissionId = readString(params.id || params.permissionId);
    const tool = readString(params.tool || params.toolName);
    const args = params.args || {};

    if (permissionId) {
      this._pendingPermissions.set(permissionId, { tool, args, timestamp: Date.now() });
    }

    this.emit("permission/request", {
      permissionId,
      tool,
      args,
    });
  }

  findActiveTurnBySession(sessionId) {
    for (const [turnId, active] of this.activeTurns) {
      if (active.sessionId === sessionId) {
        return active;
      }
    }
    return null;
  }

  async threadStart(request) {
    const params = request.params || {};
    const now = new Date().toISOString();
    const requestedCwd = readString(params.cwd || params.current_working_directory || params.working_directory);
    const thread = {
      id: `${OPENCODE_PROVIDER_ID}-thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: readString(params.title) || "OpenCode chat",
      cwd: requestedCwd || process.cwd(),
      model: normalizeOpenCodeModel(params.model),
      createdAt: now,
      updatedAt: now,
      archived: false,
      hasProjectCwd: Boolean(requestedCwd),
      turns: [],
    };
    this.threads.set(thread.id, thread);
    this.ownership.setOwnership(thread.id, this.id);
    this.rememberThreadProject(thread, "opencode-thread-start");
    return { thread: publicThread(thread) };
  }

  async threadRead(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw threadNotFoundError(threadId);
    }

    this.rememberThreadProject(thread, "opencode-thread-read");
    const responseThread = { ...publicThread(thread) };
    if (params.includeTurns === true || params.include_turns === true) {
      responseThread.turns = thread.turns || [];
    }
    return { thread: responseThread };
  }

  async threadTurnsList(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw threadNotFoundError(threadId);
    }

    const limit = boundedPositiveInteger(params.limit, 50);
    const sortDirection = readString(params.sortDirection || params.sort_direction) || "desc";
    const turns = [...(thread.turns || [])];
    if (sortDirection === "asc") {
      turns.reverse();
    }

    return {
      data: turns.slice(0, limit),
      nextCursor: null,
    };
  }

  async turnStart(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw threadNotFoundError(threadId);
    }

    // Check for already-running turn
    for (const [, active] of this.activeTurns) {
      if (active.thread.id === threadId) {
        throw activeTurnError(threadId);
      }
    }

    const model = normalizeOpenCodeModel(params.model || thread.model);
    const { inputText, prompt } = buildPromptFromTurnInput(params.input);
    if (!prompt) {
      const error = new Error("OpenCode turn/start requires text input.");
      error.errorCode = "opencode_missing_input";
      throw error;
    }

    thread.model = model;
    thread.updatedAt = new Date().toISOString();

    const turnId = `opencode-turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agent = readString(params.agent || params.mode) || "build";
    const effort = readString(params.reasoningEffort || params.reasoning_effort || params.effort);

    const now = new Date().toISOString();
    const assistantItemId = `opencode-agent-${turnId}`;
    const turn = {
      id: turnId,
      model,
      status: "running",
      createdAt: now,
      items: [
        {
          id: `opencode-user-${turnId}`,
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
      metadata: {
        threadId: thread.id,
        provider: OPENCODE_PROVIDER_ID,
      },
    };
    thread.turns.push(turn);

    const active = {
      agent,
      assistantItemId,
      assistantText: "",
      effort,
      sessionId: "",
      thread,
      turn,
      started: false,
    };
    this.activeTurns.set(turnId, active);
    this.ownership.setOwnership(thread.id, this.id);

    this.emit("turn/started", {
      threadId: thread.id,
      turnId,
      turn: { id: turnId, status: "running" },
    });

    setImmediate(() => {
      this.executeTurn(active, model, agent, effort, prompt);
    });

    return {
      turnId,
      turn: { id: turnId, threadId: thread.id, status: "running" },
    };
  }

  async executeTurn(active, model, agent, effort, prompt) {
    try {
      await this.ensureStarted();

      // Select model before prompting
      await this.acp.sendRequest("session/set_config_option", {
        configId: "model",
        value: model,
      });

      if (effort) {
        await this.acp.sendRequest("session/set_config_option", {
          configId: "effort",
          value: effort,
        });
      }

      await this.acp.sendRequest("session/set_config_option", {
        configId: "mode",
        value: agent,
      });

      const response = await this.acp.sendRequest("session/prompt", {
        prompt,
        cwd: active.thread.cwd,
      });

      active.sessionId = readString(response?.result?.sessionId || response?.sessionId);
      active.started = true;

      // Wait for completion via session updates...
      // The actual streaming happens via session/update notifications handled in handleSessionUpdate
    } catch (error) {
      this.completeTurn({
        errorMessage: error?.message || "OpenCode ACP turn failed.",
        status: "failed",
        active,
      });
    }
  }

  completeTurn({ errorMessage = "", status, active }) {
    const turnId = active.turn.id;
    if (active.completed) {
      return false;
    }
    active.completed = true;

    this.activeTurns.delete(turnId);
    active.thread.updatedAt = new Date().toISOString();
    active.turn.status = status;
    active.turn.completedAt = active.thread.updatedAt;

    if (errorMessage) {
      active.turn.error = { message: errorMessage };
    }

    const assistantItem = active.turn.items.find((item) => item.type === "agentMessage");
    if (assistantItem && assistantItem.text) {
      this.emit("item/completed", {
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
          content: assistantItem.content,
        },
      });
    }

    this.emit("turn/completed", {
      threadId: active.thread.id,
      turnId,
      model: active.thread.model,
      status,
      turn: {
        id: turnId,
        status,
        error: errorMessage ? { message: errorMessage } : undefined,
      },
    });

    this.resetIdleTimer();
    return true;
  }

  async turnInterrupt(request) {
    const params = request.params || {};
    const turnId = readString(params.turnId || params.turn_id);
    const threadId = readThreadId(params);

    const resolvedTurnId = turnId || this.findActiveTurnByThread(threadId);
    const active = this.activeTurns.get(resolvedTurnId);
    if (!active || !active.started) {
      return { success: true, interrupted: false };
    }

    try {
      if (active.sessionId) {
        await this.acp.sendRequest("session/abort", {
          sessionId: active.sessionId,
        });
      }
    } catch {
      // Best effort.
    }

    this.completeTurn({
      status: "stopped",
      active,
    });

    return { success: true, interrupted: true };
  }

  findActiveTurnByThread(threadId) {
    for (const [turnId, active] of this.activeTurns) {
      if (active.thread.id === threadId) {
        return turnId;
      }
    }
    return "";
  }

  async threadNameSet(request) {
    const params = request.params || {};
    const thread = this.threads.get(readThreadId(params));
    if (!thread) {
      throw threadNotFoundError(readThreadId(params));
    }

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
    const thread = this.threads.get(readThreadId(request.params));
    if (!thread) {
      throw threadNotFoundError(readThreadId(request.params));
    }

    thread.archived = archived;
    thread.updatedAt = new Date().toISOString();
    return { thread: publicThread(thread) };
  }

  markActivity() {
    this.lastActivityAt = Date.now();
  }

  resetIdleTimer() {
    this.stopIdleTimer();
    this.idleTimer = setTimeout(() => {
      const idleDuration = Date.now() - this.lastActivityAt;
      if (idleDuration >= HEALTH_IDLE_SHUTDOWN_MS && this.activeTurns.size === 0) {
        console.log(`${this.logPrefix} OpenCode ACP idle for ${Math.round(idleDuration / 60000)}min, shutting down.`);
        this.acp.stop();
        this.healthy = false;
      }
    }, HEALTH_IDLE_SHUTDOWN_MS);
  }

  stopIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  rememberThreadProject(thread, source) {
    if (!this.projectRegistry || !thread?.hasProjectCwd) {
      return;
    }

    try {
      this.projectRegistry.rememberProjectPath(thread.cwd, {
        source,
        provider: this.id,
        lastSeenAt: thread.updatedAt || thread.createdAt,
      });
    } catch {
      // Best-effort cache.
    }
  }

  emit(method, params) {
    this.sendApplicationMessage?.(JSON.stringify({
      method,
      params: removeUndefinedValues(params || {}),
    }));
  }
}

function normalizeOpenCodeModel(value) {
  return normalizeOpenCodeModelReference(value) || DEFAULT_OPENCODE_MODEL;
}

function publicThread(thread) {
  const hasProjectCwd = thread.hasProjectCwd !== false;
  return {
    id: thread.id,
    title: thread.title,
    name: thread.title,
    cwd: hasProjectCwd ? thread.cwd : null,
    model: thread.model || DEFAULT_OPENCODE_MODEL,
    modelProvider: OPENCODE_PROVIDER_ID,
    provider: OPENCODE_PROVIDER_ID,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    metadata: {
      provider: OPENCODE_PROVIDER_ID,
      projectCwdSource: hasProjectCwd ? "explicit" : "fallback",
    },
  };
}

function buildPromptFromTurnInput(input) {
  if (typeof input === "string") {
    return { inputText: input.trim(), prompt: input.trim() };
  }
  if (!Array.isArray(input)) {
    return { inputText: "", prompt: "" };
  }

  const textParts = [];
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
      const imagePath = readString(item.path || item.url || item.image_url || item.dataURL);
      appendNonEmpty(textParts, imagePath ? `[image attached: ${imagePath}]` : "[image attached]");
      continue;
    }
    appendNonEmpty(textParts, item.text || item.content || item.message);
  }

  const prompt = textParts.join("\n\n").trim();
  return { inputText: prompt, prompt };
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

function appendNonEmpty(target, value) {
  const text = readString(value);
  if (text) {
    target.push(text);
  }
}

function readThreadId(params = {}) {
  return readString(params.threadId || params.thread_id || params.id);
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function safeParseJSON(rawValue) {
  try {
    return JSON.parse(String(rawValue || ""));
  } catch {
    return null;
  }
}

function isRedactedTextPlaceholder(value) {
  return /^\[redacted:text:prt_[A-Za-z0-9_-]+\]$/.test(readString(value));
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

module.exports = {
  createOpenCodeProvider,
  parseOpenCodeExport,
};
