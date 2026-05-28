// FILE: opencode-provider.js
// Purpose: Adapts the local OpenCode CLI to Remodex provider-aware thread and turn RPCs.
// Layer: Bridge runtime provider
// Exports: createOpenCodeProvider
// Depends on: child_process, crypto, ./opencode-models

const { execFile, spawn } = require("child_process");
const { randomUUID } = require("crypto");
const {
  DEFAULT_OPENCODE_MODEL,
  OPENCODE_PROVIDER_ID,
  normalizeOpenCodeModelReference,
  parseOpenCodeModelsOutput,
} = require("./opencode-models");

const OPENCODE_THREAD_PREFIX = "opencode-thread-";
const OPENCODE_TURN_PREFIX = "opencode-turn-";
const OPENCODE_EXEC_TIMEOUT_MS = 8_000;
const OPENCODE_MODEL_CACHE_TTL_MS = 60_000;
const OPENCODE_MAX_HISTORY_MESSAGES = 200;

function createOpenCodeProvider({
  sendApplicationMessage,
  env = process.env,
  execFileImpl = execFile,
  spawnImpl = spawn,
  randomUUIDImpl = randomUUID,
  projectRegistry = null,
  logPrefix = "[remodex]",
} = {}) {
  return new OpenCodeProvider({
    env,
    execFileImpl,
    logPrefix,
    projectRegistry,
    randomUUIDImpl,
    sendApplicationMessage,
    spawnImpl,
  });
}

class OpenCodeProvider {
  constructor({
    sendApplicationMessage,
    env,
    execFileImpl,
    spawnImpl,
    randomUUIDImpl,
    projectRegistry,
    logPrefix,
  }) {
    this.id = OPENCODE_PROVIDER_ID;
    this.sendApplicationMessage = sendApplicationMessage;
    this.env = env;
    this.execFile = execFileImpl;
    this.spawn = spawnImpl;
    this.randomUUID = randomUUIDImpl;
    this.projectRegistry = projectRegistry;
    this.logPrefix = logPrefix;
    this.modelCache = null;
    this.threads = new Map();
    this.sessionThreadCache = new Map();
    this.activeTurnsByTurnId = new Map();
    this.activeTurnIdByThreadId = new Map();
    this.finalizedTurns = new Set();
    this.warnedAvailabilityReason = "";
  }

  ownsThread(threadId) {
    const normalized = readString(threadId);
    return this.threads.has(normalized)
      || this.sessionThreadCache.has(normalized)
      || normalized.startsWith(OPENCODE_THREAD_PREFIX)
      || normalized.startsWith("ses_");
  }

  async listModels() {
    const cached = this.readFreshModelCache();
    if (cached) {
      return cached;
    }

    try {
      const { stdout } = await this.runOpenCode(["models"], {
        timeout: OPENCODE_EXEC_TIMEOUT_MS,
      });
      const models = parseOpenCodeModelsOutput(stdout);
      this.modelCache = {
        expiresAt: Date.now() + OPENCODE_MODEL_CACHE_TTL_MS,
        value: models,
      };
      return models;
    } catch (error) {
      this.warnUnavailable(error?.message || "OpenCode models are unavailable.");
      return [];
    }
  }

  async listThreads(params = {}) {
    const limit = boundedPositiveInteger(params.limit, 50);
    const includeArchived = params.includeArchived === true || params.include_archived === true;
    const localThreads = Array.from(this.threads.values())
      .filter((thread) => includeArchived || !thread.archived)
      .map((thread) => publicThread(thread));

    let sessionThreads = [];
    try {
      const { stdout } = await this.runOpenCode([
        "session",
        "list",
        "--format",
        "json",
        "--max-count",
        String(limit),
      ], {
        timeout: OPENCODE_EXEC_TIMEOUT_MS,
      });
      sessionThreads = parseOpenCodeSessionList(stdout).map((session) => this.threadFromSession(session));
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

    return {
      data,
      nextCursor: null,
    };
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
    for (const active of this.activeTurnsByTurnId.values()) {
      active.stopped = true;
      try {
        active.child.kill("SIGTERM");
      } catch {
        // Ignore shutdown races; the process may already have exited.
      }
    }
    this.activeTurnsByTurnId.clear();
    this.activeTurnIdByThreadId.clear();
  }

  threadStart(request) {
    const params = request.params || {};
    const now = new Date().toISOString();
    const requestedCwd = readString(params.cwd || params.current_working_directory || params.working_directory);
    const thread = {
      id: `${OPENCODE_THREAD_PREFIX}${this.randomUUID()}`,
      title: readString(params.title) || "OpenCode chat",
      cwd: requestedCwd || process.cwd(),
      model: normalizeOpenCodeModel(params.model),
      createdAt: now,
      updatedAt: now,
      archived: false,
      hasProjectCwd: Boolean(requestedCwd),
      sessionId: "",
      turns: [],
    };
    this.threads.set(thread.id, thread);
    this.rememberThreadProject(thread, "opencode-thread-start");
    return {
      thread: publicThread(thread),
    };
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
    this.rememberThreadProject(thread, "opencode-thread-read");
    const responseThread = { ...publicThread(thread) };
    if (params.includeTurns === true || params.include_turns === true) {
      responseThread.turns = await this.turnsForThread(threadId, {
        sortDirection: "asc",
      });
    }
    return {
      thread: responseThread,
    };
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

    const model = normalizeOpenCodeModel(params.model || thread.model);
    const { prompt, inputText } = buildPromptFromTurnInput(params.input);
    if (!prompt) {
      const error = new Error("OpenCode turn/start requires text input.");
      error.errorCode = "opencode_missing_input";
      throw error;
    }

    thread.model = model;
    thread.updatedAt = new Date().toISOString();
    const turnId = `${OPENCODE_TURN_PREFIX}${this.randomUUID()}`;
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
    const args = [
      "run",
      "--format",
      "json",
      "--model",
      model,
      "--dir",
      thread.cwd || process.cwd(),
    ];

    if (thread.sessionId) {
      args.push("--session", thread.sessionId);
    }
    if (shouldSkipPermissions(params)) {
      args.push("--dangerously-skip-permissions");
    }
    if (thread.title) {
      args.push("--title", thread.title);
    }
    args.push(prompt);

    let child;
    try {
      child = this.spawn(resolveOpenCodeCommand(this.env), args, {
        env: this.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      this.completeTurn({
        errorMessage: error?.message || "Failed to start OpenCode.",
        status: "failed",
        thread,
        turn,
        turnId,
      });
      return;
    }

    const active = {
      assistantItemId: `opencode-agent-${turnId}`,
      assistantText: "",
      child,
      stderr: "",
      stopped: false,
      textByPartId: new Map(),
      threadId: thread.id,
      turn,
    };
    this.activeTurnsByTurnId.set(turnId, active);
    this.activeTurnIdByThreadId.set(thread.id, turnId);

    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");

    let stdoutBuffer = "";
    child.stdout?.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        this.handleRunJsonLine({ active, line, thread, turnId });
      }
    });

    child.stderr?.on("data", (chunk) => {
      active.stderr = truncateTail(`${active.stderr}${chunk}`, 4_000);
    });

    child.on("error", (error) => {
      this.completeTurn({
        errorMessage: error?.message || "OpenCode process failed.",
        status: active.stopped ? "stopped" : "failed",
        thread,
        turn,
        turnId,
      });
    });

    child.on("close", (code, signal) => {
      if (stdoutBuffer.trim()) {
        this.handleRunJsonLine({ active, line: stdoutBuffer, thread, turnId });
      }
      const stopped = active.stopped || signal === "SIGINT" || signal === "SIGTERM";
      const status = stopped ? "stopped" : (code === 0 ? "completed" : "failed");
      const errorMessage = status === "failed"
        ? readString(active.stderr) || `OpenCode exited with code ${code}.`
        : "";
      this.completeTurn({
        errorMessage,
        status,
        thread,
        turn,
        turnId,
      });
    });
  }

  handleRunJsonLine({ active, line, thread, turnId }) {
    const event = safeParseJSON(line);
    if (!event || typeof event !== "object") {
      return;
    }

    const sessionId = readString(event.sessionID || event.sessionId || event.part?.sessionID || event.part?.sessionId);
    if (sessionId && thread.sessionId !== sessionId) {
      thread.sessionId = sessionId;
      this.sessionThreadCache.set(sessionId, publicThread(thread));
    }

    const type = readString(event.type || event.part?.type).toLowerCase();
    const text = readString(event.part?.text || event.text || event.delta);
    if (!text || isRedactedTextPlaceholder(text)) {
      return;
    }

    if (type.includes("reasoning")) {
      this.emit("item/reasoning/textDelta", {
        threadId: thread.id,
        turnId,
        itemId: `opencode-reasoning-${turnId}`,
        delta: text,
        textDelta: text,
        item: {
          id: `opencode-reasoning-${turnId}`,
          type: "reasoning",
          turnId,
        },
      });
      return;
    }

    const partId = readString(event.part?.id) || active.assistantItemId;
    const previousText = active.textByPartId.get(partId) || "";
    const delta = computeTextDelta(previousText, text);
    active.textByPartId.set(partId, mergeTextSnapshot(previousText, text));
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
      return {
        success: true,
        interrupted: false,
      };
    }

    active.stopped = true;
    try {
      active.child.kill("SIGINT");
    } catch {
      // The close handler will finalize if the process is still alive.
    }
    return {
      success: true,
      interrupted: true,
    };
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
    return {
      thread: publicValue,
    };
  }

  async threadArchive(request, archived) {
    const thread = await this.resolveThread(readThreadId(request.params));
    thread.archived = archived;
    thread.updatedAt = new Date().toISOString();
    return {
      thread: publicThread(thread),
    };
  }

  async turnsForThread(threadId, { sortDirection = "desc" } = {}) {
    const thread = await this.resolveThread(threadId);
    let turns = thread.turns || [];
    if (thread.sessionId || thread.id.startsWith("ses_")) {
      turns = await this.exportSessionTurns(thread.sessionId || thread.id, thread);
      thread.turns = turns;
    }
    const normalizedDirection = readString(sortDirection).toLowerCase();
    return normalizedDirection === "asc" ? [...turns] : [...turns].reverse();
  }

  async exportSessionTurns(sessionId, thread) {
    try {
      // `--sanitize` replaces visible chat text with placeholder ids, which the
      // mobile timeline cannot resolve back to readable messages.
      const { stdout } = await this.runOpenCode(["export", sessionId], {
        timeout: 15_000,
      });
      return parseOpenCodeExport(stdout, thread).slice(-OPENCODE_MAX_HISTORY_MESSAGES);
    } catch {
      return thread.turns || [];
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

    if (normalized.startsWith("ses_")) {
      return this.rememberSessionThread({
        id: normalized,
        title: "OpenCode chat",
        cwd: process.cwd(),
        model: DEFAULT_OPENCODE_MODEL,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sessionId: normalized,
        hasProjectCwd: false,
        turns: [],
      });
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
    const requestedCwd = readString(params.cwd || params.current_working_directory || params.working_directory);
    if (!requestedCwd || !thread || (thread.hasProjectCwd && thread.cwd === requestedCwd)) {
      return;
    }

    thread.cwd = requestedCwd;
    thread.hasProjectCwd = true;
    this.rememberThreadProject(thread, "opencode-request-cwd");
  }

  rememberSessionThread(thread) {
    const hasProjectCwd = thread.hasProjectCwd !== false
      && thread.metadata?.projectCwdSource !== "fallback";
    const stored = {
      id: thread.id,
      title: thread.title || thread.name || "OpenCode chat",
      cwd: thread.cwd || process.cwd(),
      model: normalizeOpenCodeModel(thread.model),
      createdAt: thread.createdAt || new Date().toISOString(),
      updatedAt: thread.updatedAt || new Date().toISOString(),
      archived: false,
      hasProjectCwd,
      sessionId: thread.sessionId || thread.id,
      turns: Array.isArray(thread.turns) ? thread.turns : [],
    };
    this.threads.set(stored.id, stored);
    this.sessionThreadCache.set(stored.sessionId, publicThread(stored));
    this.rememberThreadProject(stored, "opencode-session");
    return stored;
  }

  adoptThread(threadId, params = {}) {
    // Existing Codex-local chats can switch providers mid-thread; adopt the id
    // locally so the OpenCode turn can stream back into the same timeline.
    const now = new Date().toISOString();
    const requestedCwd = readString(params.cwd || params.current_working_directory || params.working_directory);
    const thread = {
      id: threadId,
      title: readString(params.title) || "OpenCode chat",
      cwd: requestedCwd || process.cwd(),
      model: normalizeOpenCodeModel(params.model),
      createdAt: now,
      updatedAt: now,
      archived: false,
      hasProjectCwd: Boolean(requestedCwd),
      sessionId: "",
      turns: [],
    };
    this.threads.set(thread.id, thread);
    this.rememberThreadProject(thread, "opencode-adopt-thread");
    return thread;
  }

  threadFromSession(session) {
    const id = readString(session.id);
    const sessionCwd = readString(session.directory || session.cwd || session.path);
    const thread = {
      id,
      title: readString(session.title || session.name) || "OpenCode chat",
      cwd: sessionCwd || process.cwd(),
      model: normalizeOpenCodeModel(session.model),
      createdAt: normalizeDateString(session.created || session.createdAt || session.created_at),
      updatedAt: normalizeDateString(session.updated || session.updatedAt || session.updated_at),
      archived: false,
      hasProjectCwd: Boolean(sessionCwd),
      sessionId: id,
      turns: [],
    };
    this.sessionThreadCache.set(id, publicThread(thread));
    this.rememberThreadProject(thread, "opencode-session-list");
    return publicThread(thread);
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
      // Project history is a best-effort picker cache, not part of turn execution.
    }
  }

  readFreshModelCache() {
    if (!this.modelCache || Date.now() > this.modelCache.expiresAt) {
      return null;
    }
    return this.modelCache.value;
  }

  runOpenCode(args, options = {}) {
    return execFilePromise(this.execFile, resolveOpenCodeCommand(this.env), args, {
      env: this.env,
      timeout: options.timeout || OPENCODE_EXEC_TIMEOUT_MS,
      maxBuffer: options.maxBuffer || 2 * 1024 * 1024,
    });
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
    console.warn(`${this.logPrefix} OpenCode unavailable: ${normalizedReason}`);
  }
}

function resolveOpenCodeCommand(env = process.env) {
  return readString(env.REMODEX_OPENCODE_COMMAND) || "opencode";
}

function normalizeOpenCodeModel(value) {
  return normalizeOpenCodeModelReference(value) || DEFAULT_OPENCODE_MODEL;
}

function execFilePromise(execFileImpl, command, args, options) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, options, (error, stdout = "", stderr = "") => {
      if (error) {
        const message = readString(stderr) || error.message || `${command} failed.`;
        const wrapped = new Error(message);
        wrapped.code = error.code;
        reject(wrapped);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function parseOpenCodeSessionList(output) {
  const parsed = safeParseJSON(output);
  return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
}

function parseOpenCodeExport(output, thread) {
  const parsed = safeParseJSON(output);
  const messages = Array.isArray(parsed?.messages) ? parsed.messages.slice(-OPENCODE_MAX_HISTORY_MESSAGES) : [];
  const turns = [];
  let currentTurn = null;

  for (const message of messages) {
    const role = readString(message?.info?.role || message?.role).toLowerCase();
    const text = textFromExportedMessage(message);
    if (!text) {
      continue;
    }

    if (role === "user" || !currentTurn) {
      currentTurn = {
        id: readString(message?.info?.id) || `${OPENCODE_TURN_PREFIX}${turns.length + 1}`,
        status: "completed",
        createdAt: normalizeDateString(message?.info?.time?.created || message?.created),
        completedAt: normalizeDateString(message?.info?.time?.updated || message?.updated),
        items: [],
      };
      turns.push(currentTurn);
    }

    currentTurn.items.push({
      id: readString(message?.info?.id) || `${currentTurn.id}-${role || "message"}-${currentTurn.items.length}`,
      type: role === "user" ? "userMessage" : "agentMessage",
      role: role === "user" ? "user" : "assistant",
      phase: role === "assistant" ? "final" : undefined,
      text,
      content: textContent(text),
      createdAt: currentTurn.createdAt,
    });

    if (role === "assistant") {
      currentTurn = null;
    }
  }

  if (thread?.turns?.length) {
    return mergeStoredAndExportedTurns(thread.turns, turns);
  }
  return turns;
}

function mergeStoredAndExportedTurns(storedTurns, exportedTurns) {
  const result = [];
  const seenKeys = new Set();
  const storedByFingerprint = new Map();
  for (const turn of storedTurns) {
    const fingerprint = turnFingerprint(turn);
    if (fingerprint && !storedByFingerprint.has(fingerprint)) {
      storedByFingerprint.set(fingerprint, turn);
    }
  }

  for (const exportedTurn of exportedTurns) {
    const fingerprint = turnFingerprint(exportedTurn);
    const turn = (fingerprint && storedByFingerprint.get(fingerprint)) || exportedTurn;
    appendUniqueTurn(result, seenKeys, turn);
  }
  for (const turn of storedTurns) {
    appendUniqueTurn(result, seenKeys, turn);
  }
  return result;
}

function appendUniqueTurn(result, seenKeys, turn) {
  const keys = turnDeduplicationKeys(turn);
  if (!keys.length || keys.some((key) => seenKeys.has(key))) {
    return;
  }
  for (const key of keys) {
    seenKeys.add(key);
  }
  result.push(turn);
}

function turnDeduplicationKeys(turn) {
  if (!turn || typeof turn !== "object") {
    return [];
  }
  const keys = [];
  const id = readString(turn.id);
  if (id) {
    keys.push(`id:${id}`);
  }
  const fingerprint = turnFingerprint(turn);
  if (fingerprint) {
    keys.push(`fp:${fingerprint}`);
  }
  return keys;
}

function turnFingerprint(turn) {
  const userText = firstItemText(turn, "userMessage");
  const assistantText = firstItemText(turn, "agentMessage");
  if (!userText || !assistantText) {
    return "";
  }
  return `${normalizeFingerprintText(userText)}\n---\n${normalizeFingerprintText(assistantText)}`;
}

function firstItemText(turn, itemType) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (const item of items) {
    if (item?.type !== itemType) {
      continue;
    }
    const text = readString(item.text || item.message);
    if (text) {
      return text;
    }
  }
  return "";
}

function normalizeFingerprintText(value) {
  return readString(value).replace(/\s+/g, " ");
}

function textFromExportedMessage(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      if (part.type === "text" || part.type === "reasoning") {
        const text = readString(part.text);
        return isRedactedTextPlaceholder(text) ? "" : text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
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
        id: `opencode-user-${turnId}`,
        type: "userMessage",
        role: "user",
        text: inputText,
        content: textContent(inputText),
        createdAt: now,
      },
      {
        id: `opencode-agent-${turnId}`,
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
      provider: OPENCODE_PROVIDER_ID,
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
    model: normalizeOpenCodeModel(thread.model),
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
    return {
      inputText: input.trim(),
      prompt: input.trim(),
    };
  }
  if (!Array.isArray(input)) {
    return {
      inputText: "",
      prompt: "",
    };
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
  return {
    inputText,
    prompt,
  };
}

function imageFallbackText(item) {
  const imagePath = readString(item.path || item.url || item.image_url || item.dataURL || item.data_url);
  return imagePath ? `[image attached: ${imagePath}]` : "[image attached]";
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

function computeTextDelta(previousText, incomingText) {
  if (!incomingText || incomingText === previousText) {
    return "";
  }
  if (incomingText.startsWith(previousText)) {
    return incomingText.slice(previousText.length);
  }
  return incomingText;
}

function mergeTextSnapshot(previousText, incomingText) {
  if (!previousText || incomingText.startsWith(previousText)) {
    return incomingText;
  }
  return previousText + incomingText;
}

function textContent(text) {
  return [
    {
      type: "text",
      text: text || "",
    },
  ];
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
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
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

function truncateTail(value, maxChars) {
  const text = String(value || "");
  return text.length <= maxChars ? text : text.slice(-maxChars);
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
  parseOpenCodeSessionList,
};
