// FILE: opencode-transport.js
// Purpose: Adapts a loopback `opencode serve` HTTP+SSE process to the Remodex Codex-shaped JSON-RPC transport contract.
// Layer: CLI helper
// Exports: createOpenCodeTransport (see module.exports for test helpers).
// Depends on: child_process, crypto, fs, os, path

// OpenCode runtime adapter. Layout: factory, handlers by concern, pure helpers at the bottom.
// File split deferred per handoff ADR until a second non-Codex runtime exists; section headers mark internal boundaries.

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  BINDINGS_PERSIST_DEBOUNCE_MS,
  BUS_EVENT_ID_CACHE_LIMIT,
  CWD_LOCK_TTL_MS,
  lookupOpenCodeTransportRefusal,
} = require("./opencode-runtime-policy");

// === Public types ====================================================================
// JSDoc only. The transport returned by `createOpenCodeTransport` is duck-compatible
// with `codex-transport.js` so `bridge.js` can hold a single `runtime` variable
// regardless of provider.

/**
 * @typedef {Object} RuntimeTransport
 * @property {"opencode"} mode
 * @property {() => string} describe
 * @property {(rawJsonRpcLine: string) => void} send
 * @property {(handler: (rawJsonRpcLine: string) => void) => void} onMessage
 * @property {(handler: (code: number|null, signal: string|null) => void) => void} onClose
 * @property {(handler: (error: Error) => void) => void} onError
 * @property {(handler: (info: { mode: string, baseUrl?: string, description?: string }) => void) => void} onStarted
 * @property {() => void} shutdown
 */

/**
 * @typedef {Object} CreateOpenCodeTransportOptions
 * @property {NodeJS.ProcessEnv} [env]                Process env for spawn + auth.
 * @property {string}            [opencodeCommand]    Override binary (default `opencode`; honors `REMODEX_OPENCODE_COMMAND`).
 * @property {string}            [logPrefix]
 * @property {string}            [bindingsPath]       Override persistence path (default `~/.remodex/opencode-bindings.json`).
 * @property {typeof spawn}      [spawnImpl]          Injected for tests.
 * @property {typeof fetch}      [fetchImpl]          Injected for tests; defaults to global `fetch` (Node 18+).
 * @property {(url: string, init?: object) => AsyncIterable<string>} [connectSseImpl]
 * @property {string}            [directory]          Workspace for `x-opencode-directory` on SSE connect.
 * @property {string}            [sseDirectory]       Alias for `directory` on SSE connect.
 * @property {() => number}      [now]                Injected clock for tests.
 * @property {(ms: number) => Promise<void>} [sleep]  Injected sleep for backoff tests.
 */

/**
 * One `opencode serve` child per bridge run. All threads share it; each request
 * sends `x-opencode-directory`.
 *
 * @typedef {Object} OpenCodeServerState
 * @property {"cold"|"spawning"|"ready"|"degraded"|"stopped"} phase
 * @property {string|null} baseUrl              `http://127.0.0.1:<port>`; null until ready.
 * @property {string|null} username             Basic-auth user (default `opencode`).
 * @property {string|null} password             Bridge-generated; never logged.
 * @property {number|null} pid
 * @property {number}      spawnAttempts        Monotonic; caps retry storms.
 * @property {number|null} lastReadyAt          ms since epoch.
 * @property {import("child_process").ChildProcess|null} [child]
 * @property {number}      [_lastSpawnAttemptAt] ms since epoch; rate-limit anchor.
 * @property {Promise<{ child: import("child_process").ChildProcess, baseUrl: string }>|null} [_spawnPromise]
 */

/**
 * Persisted per-thread binding. Survives bridge restart so reopened threads can
 * resume against the same OpenCode session. In-flight turns are explicitly
 * marked failed on bridge boot (we never claim a turn is still running across
 * process boundaries).
 *
 * @typedef {Object} ThreadBinding
 * @property {string} remodexThreadId
 * @property {string} opencodeSessionId
 * @property {string} cwd                       Absolute workspace path; header for `x-opencode-directory`.
 * @property {{ provider: string, model: string, variant?: string }|null} model
 * @property {string|null} [agent]                  Last agent used for turn/start (e.g. build, plan).
 * @property {string|null} activeRemodexTurnId
 * @property {string|null} [lastFailedTurnId]   Set when boot marks a running turn failed.
 * @property {"idle"|"running"|"failed"|"interrupted"} turnPhase
 * @property {number}      updatedAt            ms since epoch.
 */

/**
 * Approval pending an iOS reply. Keyed by OpenCode `permissionID`.
 *
 * @typedef {Object} PendingApproval
 * @property {string} permissionId
 * @property {string} remodexThreadId
 * @property {string} remodexItemId             Synthetic id surfaced to iOS.
 * @property {string} approvalMethod            One of the existing Codex-shaped approval method names.
 * @property {number} requestedAt
 */

/**
 * Same-workspace turn lock. Two Remodex threads with the same `cwd` cannot both
 * be `running` at once or their file edits interleave. The lock is structural,
 * not advisory. A second `turn/start` returns JSON-RPC error `workspace_busy`
 * naming the holder.
 *
 * @typedef {Object} CwdTurnLock
 * @property {string} cwd
 * @property {string} ownerThreadId
 * @property {string} ownerTurnId
 * @property {number} acquiredAt
 */

/**
 * Discriminator-free JSON-RPC envelope. `id` present + `method` = request;
 * `id` absent + `method` = notification; `id` present + `result|error` = response.
 *
 * @typedef {Object} ParsedJsonRpc
 * @property {string|number|null} [id]
 * @property {string}             [method]
 * @property {object}             [params]
 * @property {object}             [result]
 * @property {{ code: number, message: string, data?: unknown }} [error]
 */

/**
 * One parsed bus event from `GET /event` SSE.
 *
 * @typedef {Object} BusEvent
 * @property {string} type                      e.g. `session.status`, `message.part.delta`, `permission.asked`.
 * @property {Record<string, unknown>} properties
 * @property {number} sequence                  Monotonic per SSE connection; used to drop duplicates on reconnect.
 * @property {string} [id]                      OpenCode bus payload id when present; dedup key on reconnect.
 */

/**
 * State for one `createOpenCodeTransport` call. Shared by internal handlers.
 *
 * @typedef {Object} OpenCodeTransportState
 * @property {OpenCodeServerState} server
 * @property {Map<string, ThreadBinding>} bindingsByThreadId
 * @property {Map<string, ThreadBinding>} bindingsBySessionId
 * @property {Map<string, CwdTurnLock>} locksByCwd
 * @property {Map<string, PendingApproval>} pendingApprovalsById
 * @property {{ buffer: string, lastSequence: number, reconnectAttempt: number, stop: (() => void) | null, reconnectScheduled?: boolean, reconnectTimer?: NodeJS.Timeout|null, lastEventId?: string|null, lastAppliedSequence?: number, seenBusEventIds?: Set<string>, evictedBusEventIds?: Set<string>, lastEmittedItemIdByThread?: Map<string, string> }} sse
 * @property {Map<string, { startedEmitted: boolean, terminalEmitted: boolean, itemIdByPartId: Map<string, string>, partKindByPartId: Map<string, string> }>} [turnReducerByThreadId]
 * @property {ReturnType<typeof createListenerBag>} listeners
 * @property {CreateOpenCodeTransportOptions} options
 */

// === Public factory ==================================================================

/**
 * Wired from `bridge.js` when `REMODEX_PROVIDER=opencode`. Same surface as
 * `createCodexTransport` so the dispatcher does not branch on provider after construction.
 *
 * @param {CreateOpenCodeTransportOptions} [options]
 * @returns {RuntimeTransport}
 */
function createOpenCodeTransport(options = {}) {
  const bindingsPath = options.bindingsPath ?? resolveBindingsPath();
  let bindingsByThreadId = loadBindings(bindingsPath);
  const rebootFailedTurns = [];
  for (const binding of bindingsByThreadId.values()) {
    if (binding.turnPhase === "running") {
      rebootFailedTurns.push({
        threadId: binding.remodexThreadId,
        turnId: binding.activeRemodexTurnId || synthesizeTurnId(),
      });
    }
  }
  bindingsByThreadId = markInFlightTurnsFailedOnBoot(bindingsByThreadId);
  saveBindings(bindingsPath, bindingsByThreadId);

  const state = {
    server: {
      phase: "cold",
      baseUrl: null,
      username: null,
      password: null,
      pid: null,
      spawnAttempts: 0,
      lastReadyAt: null,
    },
    bindingsByThreadId,
    bindingsBySessionId: new Map(),
    locksByCwd: new Map(),
    pendingApprovalsById: new Map(),
    sse: {
      buffer: "",
      lastSequence: 0,
      reconnectAttempt: 0,
      stop: null,
      reconnectScheduled: false,
      reconnectTimer: null,
      lastEventId: null,
      lastAppliedSequence: 0,
      seenBusEventIds: new Set(),
      evictedBusEventIds: new Set(),
      lastEmittedItemIdByThread: new Map(),
    },
    turnReducerByThreadId: new Map(),
    listeners: createListenerBag(),
    options,
    pendingBootLines: [],
    _persistBindingsTimer: null,
    agentsCache: null,
  };
  rebuildBindingIndexes(state);

  for (const failed of rebootFailedTurns) {
    const line = emitTurnFailed(state, {
      threadId: failed.threadId,
      turnId: failed.turnId,
      message: "Bridge restarted during an active turn.",
    });
    if (line) {
      state.pendingBootLines.push(line);
    }
  }

  ensureOpenCodeServer(state.server, options)
    .then(() => {
      attachOpenCodeSse(state, options);
      state.listeners.emitStarted({
        mode: "opencode",
        baseUrl: state.server.baseUrl || undefined,
      });
    })
    .catch((error) => {
      state.listeners.emitError(error instanceof Error ? error : new Error(String(error)));
    });

  return {
    mode: "opencode",
    describe() {
      const baseUrl = state.server.baseUrl;
      return baseUrl ? `\`opencode serve\` on ${baseUrl}` : "`opencode serve` (starting)";
    },
    send(rawLine) {
      routeInboundJsonRpc(state, rawLine, (line) => state.listeners.emitMessage(line));
    },
    onMessage(handler) {
      state.listeners.onMessage = handler;
      for (const line of state.pendingBootLines) {
        handler(line);
      }
      state.pendingBootLines = [];
    },
    onClose(handler) {
      state.listeners.onClose = handler;
    },
    onError(handler) {
      state.listeners.onError = handler;
    },
    onStarted(handler) {
      state.listeners.onStarted = handler;
    },
    shutdown() {
      shutdownOpenCodeServer(state);
    },
  };
}

// === Lifecycle =======================================================================

/**
 * Spawn `opencode serve --hostname 127.0.0.1 --port 0 --pure`. Parse stdout for
 * the `opencode server listening on http://...` stdout line. Generate `OPENCODE_SERVER_PASSWORD`
 * fresh per bridge run; never log it. Returns a child handle plus the resolved
 * server description on ready.
 *
 * @param {OpenCodeServerState} server
 * @param {CreateOpenCodeTransportOptions} options
 * @returns {Promise<{ child: import("child_process").ChildProcess, baseUrl: string }>}
 */
async function spawnOpenCodeServer(server, options = {}) {
  if (server._spawnPromise) {
    return server._spawnPromise;
  }

  server._spawnPromise = spawnOpenCodeServerOnce(server, options).finally(() => {
    server._spawnPromise = null;
  });
  return server._spawnPromise;
}

async function spawnOpenCodeServerOnce(server, options = {}) {
  const now = options.now ?? Date.now;
  const spawnImpl = options.spawnImpl ?? spawn;
  const env = { ...(options.env ?? process.env) };
  const username = env.OPENCODE_SERVER_USERNAME || "opencode";
  const password = generateServerPassword();

  env.OPENCODE_SERVER_USERNAME = username;
  env.OPENCODE_SERVER_PASSWORD = password;

  server.phase = "spawning";
  server.username = username;
  server.password = password;
  server.baseUrl = null;

  const command = options.opencodeCommand ?? resolveOpenCodeCommand(env);
  const args = ["serve", "--hostname", "127.0.0.1", "--port", "0", "--pure"];
  const child = spawnImpl(command, args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  server.pid = child.pid ?? null;

  const timeoutMs = options.spawnTimeoutMs ?? 30_000;

  return new Promise((resolve, reject) => {
    let stdoutBuffer = "";
    let settled = false;

    const onStdout = (chunk) => {
      stdoutBuffer += chunk.toString();
      const parsed = parseListenStdout(stdoutBuffer);
      stdoutBuffer = parsed.rest;
      if (!parsed.ready) {
        return;
      }
      server.phase = "ready";
      server.baseUrl = parsed.ready.baseUrl;
      server.lastReadyAt = now();
      server.child = child;
      settle(null, { child, baseUrl: parsed.ready.baseUrl });
    };

    const onExit = (code, signal) => {
      if (settled) {
        return;
      }
      settle(
        new Error(
          `opencode serve exited before ready (code=${code ?? "null"}, signal=${signal ?? "null"})`
        )
      );
    };

    const onError = (error) => {
      settle(error);
    };

    const settle = (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      child.stdout?.off("data", onStdout);
      child.off("exit", onExit);
      child.off("error", onError);
      if (error) {
        server.phase = "degraded";
        server.baseUrl = null;
        server.pid = null;
        server.child = null;
        reject(error);
        return;
      }
      resolve(result);
    };

    const timeoutHandle = setTimeout(() => {
      settle(new Error(`opencode serve timed out after ${timeoutMs}ms`));
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }, timeoutMs);

    child.stdout?.on("data", onStdout);
    child.on("exit", onExit);
    child.on("error", onError);
  });
}

/**
 * Return the existing healthy server when still up; otherwise spawn, with at
 * most 2 attempts per 60s (`server.spawnAttempts`). Not a generic circuit breaker.
 * Confirm with `GET /doc`.
 *
 * @param {OpenCodeServerState} server
 * @param {CreateOpenCodeTransportOptions} options
 * @returns {Promise<OpenCodeServerState>}
 */
async function ensureOpenCodeServer(server, options = {}) {
  if (server.phase === "stopped") {
    throw new Error("opencode serve cannot restart after shutdown");
  }

  if (server._spawnPromise) {
    await server._spawnPromise;
  }

  const now = options.now ?? Date.now;
  const windowMs = 60_000;

  if (server.phase === "ready" && server.baseUrl) {
    try {
      const doc = await openCodeFetch(server, "/doc", {
        method: "GET",
        fetchImpl: options.fetchImpl,
      });
      if (!doc.__opencodeError) {
        return server;
      }
    } catch (_err) {
      // fall through to respawn
    }
    server.phase = "degraded";
  }

  const windowAnchor = server._lastSpawnAttemptAt ?? server.lastReadyAt ?? 0;
  if (now() - windowAnchor > windowMs) {
    server.spawnAttempts = 0;
  }

  server.spawnAttempts += 1;
  server._lastSpawnAttemptAt = now();
  if (server.spawnAttempts > 2) {
    throw new Error("opencode serve spawn retry limit exceeded (2 per 60s)");
  }

  if (server.child && !server.child.killed) {
    server.child.kill("SIGTERM");
    server.child = null;
    server.pid = null;
  }

  await spawnOpenCodeServer(server, options);

  const doc = await openCodeFetch(server, "/doc", {
    method: "GET",
    fetchImpl: options.fetchImpl,
  });
  if (doc.__opencodeError) {
    server.phase = "degraded";
    throw new Error(`opencode serve health check failed: ${doc.message}`);
  }

  server.spawnAttempts = 0;
  return server;
}

/**
 * Tear down via `transport.server`, abort `transport.sse`, persist
 * `transport.bindingsByThreadId`. Marks server `phase = "stopped"`. Safe to call
 * multiple times.
 *
 * @param {OpenCodeTransportState} transport
 */
function shutdownOpenCodeServer(transport) {
  if (transport.server.phase === "stopped") {
    return;
  }

  if (transport.sse?.reconnectTimer) {
    clearTimeout(transport.sse.reconnectTimer);
    transport.sse.reconnectTimer = null;
  }
  transport.sse.reconnectScheduled = false;
  transport.sse?.stop?.();

  const child = transport.server.child;
  if (child && !child.killed) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode == null && !child.killed) {
        child.kill("SIGKILL");
      }
    }, 5000);
  }

  flushPersistBindings(transport);

  transport.server.phase = "stopped";
  transport.server.child = null;
  transport.server.pid = null;
}

// === HTTP boundary ===================================================================

/**
 * All OpenCode REST calls go through this function. Sets Basic auth,
 * `x-opencode-directory` from the binding's cwd, parses JSON, and surfaces
 * non-2xx as `{ code, message }` rather than throwing on the happy path.
 *
 * Validate response shape here. Inner handlers trust the typed payload.
 *
 * @param {OpenCodeServerState} server
 * @param {string} requestPath                  e.g. `/session/abc/prompt_async`.
 * @param {{ method?: "GET"|"POST"|"PUT"|"DELETE"|"PATCH", directory?: string, body?: unknown, signal?: AbortSignal }} [opts]
 * @returns {Promise<unknown>}
 */
async function openCodeFetch(server, requestPath, opts = {}) {
  if (!server.baseUrl) {
    return {
      __opencodeError: true,
      code: "not_ready",
      message: "OpenCode server baseUrl is not set",
      status: 0,
    };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const method = opts.method ?? "GET";
  const url = `${server.baseUrl}${requestPath}`;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`,
  };

  if (opts.directory) {
    headers["x-opencode-directory"] = opts.directory;
  }

  const init = { method, headers, signal: opts.signal };
  if (
    opts.body != null &&
    (method === "POST" || method === "PUT" || method === "PATCH")
  ) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }

  const response = await fetchImpl(url, init);
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (response.ok) {
    return parsed;
  }

  const message =
    parsed && typeof parsed === "object" && parsed.message
      ? String(parsed.message)
      : String(parsed ?? response.statusText);
  const code =
    parsed && typeof parsed === "object" && parsed.code != null
      ? parsed.code
      : response.status;

  return {
    __opencodeError: true,
    code,
    message,
    status: response.status,
  };
}

// === SSE boundary ====================================================================

/**
 * Connect `GET /event` once per server. Each parsed `BusEvent` is passed to
 * `onBusEvent`; the connection itself signals lost via `onStreamLost`.
 * Returns a stop function the caller invokes on transport shutdown.
 *
 * @param {OpenCodeTransportState} transport
 * @param {{ onBusEvent: (event: BusEvent) => void, onStreamLost: (reason: Error) => void }} handlers
 * @param {CreateOpenCodeTransportOptions} options
 * @returns {() => void} stop
 */
function connectOpenCodeEventStream(transport, handlers, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const server = transport.server;
  let aborted = false;
  let activeReader = null;

  if (!transport.sse) {
    ensureSseState(transport);
  }

  const readLoop = async () => {
    const headers = {
      Authorization: `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`,
      Accept: "text/event-stream",
    };
    const directory = options.directory ?? options.sseDirectory;
    if (directory) {
      headers["x-opencode-directory"] = directory;
    }
    if (transport.sse.lastEventId) {
      headers["Last-Event-ID"] = transport.sse.lastEventId;
    }

    try {
      const response = await fetchImpl(`${server.baseUrl}/event`, { headers });
      if (!response.ok || !response.body) {
        throw new Error(`SSE connect failed (${response.status})`);
      }

      transport.sse.reconnectAttempt = 0;
      activeReader = response.body.getReader();
      const decoder = new TextDecoder();

      while (!aborted) {
        const { done, value } = await activeReader.read();
        if (done) {
          break;
        }
        const chunkText = decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(chunkText, transport.sse);
        transport.sse.buffer = parsed.cursor.buffer;
        transport.sse.lastSequence = parsed.cursor.lastSequence;
        if (parsed.cursor.lastEventId != null) {
          transport.sse.lastEventId = parsed.cursor.lastEventId;
        }
        for (const event of parsed.events) {
          handlers.onBusEvent(event);
        }
      }

      if (!aborted) {
        handlers.onStreamLost(new Error("OpenCode SSE stream ended"));
      }
    } catch (error) {
      if (!aborted) {
        handlers.onStreamLost(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      activeReader = null;
    }
  };

  readLoop();

  const stop = () => {
    aborted = true;
    transport.sse.stop = null;
    activeReader?.cancel?.().catch(() => {});
  };

  transport.sse.stop = stop;
  return stop;
}

/**
 * Exponential backoff capped at 8s. Returns the next delay in ms.
 *
 * @param {{ reconnectAttempt: number }} sse
 * @returns {number}
 */
function scheduleSseReconnect(sse) {
  const attempt = sse.reconnectAttempt ?? 0;
  sse.reconnectAttempt = attempt + 1;
  return Math.min(1000 * (2 ** attempt), 8000);
}

// === Bindings persistence ============================================================

/**
 * Load `~/.remodex/opencode-bindings.json` (mode 0600). Missing file = empty
 * map. Schema-versioned so future migrations are explicit.
 *
 * @param {string} bindingsPath
 * @returns {Map<string, ThreadBinding>}
 */
const BINDINGS_SCHEMA_VERSION = 1;

function loadBindings(bindingsPath) {
  const bindings = new Map();
  if (!fs.existsSync(bindingsPath)) {
    return bindings;
  }

  try {
    fs.chmodSync(bindingsPath, 0o600);
    const parsed = JSON.parse(fs.readFileSync(bindingsPath, "utf8"));
    const entries = Array.isArray(parsed?.bindings) ? parsed.bindings : [];
    for (const entry of entries) {
      const threadId = readString(entry?.remodexThreadId);
      const sessionId = readString(entry?.opencodeSessionId);
      if (!threadId || !sessionId) {
        continue;
      }
      bindings.set(threadId, normalizeThreadBinding(entry));
    }
  } catch (error) {
    const logPrefix = process.env.REMODEX_LOG_PREFIX || "[remodex]";
    console.warn(
      `${logPrefix} Ignoring corrupt OpenCode bindings at ${bindingsPath}: ${coerceMessageString(error)}`
    );
    try {
      fs.renameSync(bindingsPath, `${bindingsPath}.corrupt-${Date.now()}`);
    } catch {
      // Leave the file in place if rename fails.
    }
    return new Map();
  }

  return bindings;
}

/**
 * Atomic write (`*.tmp` + `rename`). Caller serializes; this function does not
 * own concurrency. Permissions enforced to `0600`.
 *
 * @param {string} bindingsPath
 * @param {Map<string, ThreadBinding>} bindings
 */
function saveBindings(bindingsPath, bindings) {
  fs.mkdirSync(path.dirname(bindingsPath), { recursive: true, mode: 0o700 });
  const payload = {
    schemaVersion: BINDINGS_SCHEMA_VERSION,
    bindings: Array.from(bindings.values()),
  };
  const tmpPath = `${bindingsPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  const fd = fs.openSync(tmpPath, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, bindingsPath);
  fs.chmodSync(bindingsPath, 0o600);
}

/**
 * At bridge boot, any binding with `turnPhase === "running"` is impossible
 * (the process owning it just died). Mark them `failed`, stash `lastFailedTurnId`,
 * and emit `turn/completed` with `status: "failed"` via boot buffer or `thread/read`.
 * Returns the patched bindings map for re-save.
 *
 * @param {Map<string, ThreadBinding>} bindings
 * @returns {Map<string, ThreadBinding>}
 */
function markInFlightTurnsFailedOnBoot(bindings) {
  const now = Date.now();
  for (const binding of bindings.values()) {
    if (binding.turnPhase === "running") {
      binding.lastFailedTurnId = binding.activeRemodexTurnId;
      binding.turnPhase = "failed";
      binding.updatedAt = now;
      binding.activeRemodexTurnId = null;
    }
  }
  return bindings;
}

// === Cwd turn lock ===================================================================

/**
 * Reserve the cwd for one running turn. Returns `{ ok: true }` on success or
 * `{ ok: false, holderThreadId }` if a different thread is already running in
 * the same workspace.
 *
 * @param {OpenCodeTransportState} state
 * @param {string} cwd
 * @param {string} threadId
 * @param {string} turnId
 * @returns {{ ok: true } | { ok: false, holderThreadId: string, holderTurnId: string }}
 */
function expireStaleCwdLocks(state, now = Date.now()) {
  if (!state?.locksByCwd) {
    return;
  }
  for (const [normalizedCwd, lock] of state.locksByCwd.entries()) {
    if (now - lock.acquiredAt > CWD_LOCK_TTL_MS) {
      state.locksByCwd.delete(normalizedCwd);
    }
  }
}

function tryAcquireCwdLock(state, cwd, threadId, turnId) {
  const now = state.options?.now?.() ?? Date.now();
  expireStaleCwdLocks(state, now);
  const normalizedCwd = normalizeLockCwd(cwd);
  const existing = state.locksByCwd.get(normalizedCwd);
  if (existing) {
    if (existing.ownerThreadId === threadId && existing.ownerTurnId === turnId) {
      return { ok: true };
    }
    return {
      ok: false,
      holderThreadId: existing.ownerThreadId,
      holderTurnId: existing.ownerTurnId,
    };
  }

  state.locksByCwd.set(normalizedCwd, {
    cwd: normalizedCwd,
    ownerThreadId: threadId,
    ownerTurnId: turnId,
    acquiredAt: now,
  });
  return { ok: true };
}

/**
 * Release the lock if owned by `turnId`. No-op when the lock has already been
 * released or never existed (idempotent).
 *
 * @param {OpenCodeTransportState} state
 * @param {string} cwd
 * @param {string} turnId
 */
function releaseCwdLock(state, cwd, turnId) {
  if (!state?.locksByCwd) {
    return;
  }
  const normalizedCwd = normalizeLockCwd(cwd);
  const existing = state.locksByCwd.get(normalizedCwd);
  if (existing && existing.ownerTurnId === turnId) {
    state.locksByCwd.delete(normalizedCwd);
  }
}

// === JSON-RPC ingress ================================================================

/**
 * Inbound method → request handler. Methods absent from this table route
 * through `handleUnsupportedMethod`. Client responses (`{ id, result }` with
 * no `method`) bypass this table and go to `handleInboundClientResponse`.
 *
 * @type {Record<string, (state: OpenCodeTransportState, request: ParsedJsonRpc, emit: (line: string) => void) => Promise<void> | void>}
 */
const INBOUND_REQUEST_HANDLERS = {
  initialize: handleInitializeRequest,
  "model/list": handleModelListRequest,
  "thread/start": handleThreadStartRequest,
  "thread/read": handleThreadReadRequest,
  "thread/list": handleThreadListRequest,
  "thread/turns/list": handleThreadTurnsListRequest,
  "thread/resume": handleThreadResumeRequest,
  "thread/name/set": handleThreadNameSetRequest,
  "turn/start": handleTurnStartRequest,
  "turn/interrupt": handleTurnInterruptRequest,
  "collaborationMode/list": handleCollaborationModeListRequest,
};

/**
 * Dispatch one inbound JSON-RPC line from iOS.
 * Unknown methods get `method_not_supported` via `handleUnsupportedMethod`.
 * Voice and steer return refusal messages the client can show.
 *
 * @param {OpenCodeTransportState} state
 * @param {string} rawLine
 * @param {(line: string) => void} emit         Sends a JSON-RPC line back to iOS.
 */
function routeInboundJsonRpc(state, rawLine, emit) {
  const parsed = parseJsonRpcLine(rawLine);
  if (!parsed) {
    return;
  }

  if (parsed.id != null && !parsed.method && (parsed.result !== undefined || parsed.error)) {
    Promise.resolve(handleInboundClientResponse(state, parsed, emit)).catch((error) => {
      const logPrefix = state.options.logPrefix || "[remodex]";
      console.warn(`${logPrefix} OpenCode approval response failed: ${coerceMessageString(error)}`);
    });
    return;
  }

  const method = readString(parsed.method);
  if (!method) {
    return;
  }

  if (parsed.id == null) {
    if (method === "initialized") {
      return;
    }
    handleUnsupportedMethod(method, parsed, emit);
    return;
  }

  const handler = INBOUND_REQUEST_HANDLERS[method];
  if (!handler) {
    handleUnsupportedMethod(method, parsed, emit);
    return;
  }

  Promise.resolve(handler(state, parsed, emit)).catch((error) => {
    emit(makeJsonRpcError(
      parsed.id,
      -32000,
      coerceMessageString(error, "OpenCode request failed"),
      { errorCode: error?.errorCode || "request_failed" }
    ));
  });
}

/**
 * Answer `initialize` locally (do not forward), with OpenCode capabilities only
 * (no `experimentalApi`, no plan-mode probe). iOS already tolerates truthy
 * capability lists.
 *
 * @param {OpenCodeTransportState} state
 * @param {ParsedJsonRpc} request
 * @param {(line: string) => void} emit
 * @returns {Promise<void>}
 */
async function handleInitializeRequest(state, request, emit) {
  emit(makeJsonRpcResponse(request.id, {
    capabilities: {
      agentRuntime: "opencode",
      transportMode: "opencode",
      turnPagination: true,
      supportsApprovals: true,
      supportsAgents: true,
      supportsVariants: true,
      supportsCollaborationMode: true,
      requiresOpenaiAuth: false,
      experimentalApi: false,
    },
    serverInfo: {
      name: "opencode",
      version: "serve",
    },
  }));
}

/**
 * Caches agent list 60 s. On fetch error, returns empty array (does not crash).
 *
 * @param {OpenCodeTransportState} state
 * @param {ParsedJsonRpc} request
 * @param {(line: string) => void} emit
 * @returns {Promise<void>}
 */
async function handleCollaborationModeListRequest(state, request, emit) {
  let agents = [];

  const cached = state.agentsCache;
  if (cached && Date.now() - cached.fetchedAt < 60_000) {
    agents = cached.agents;
  } else {
    try {
      await ensureOpenCodeServer(state.server, state.options);
      const result = await openCodeFetch(state.server, "/agent", {
        method: "GET",
        fetchImpl: state.options.fetchImpl,
      });
      if (!result.__opencodeError && Array.isArray(result)) {
        agents = result;
        state.agentsCache = { agents, fetchedAt: Date.now() };
      } else {
        state.agentsCache = { agents: [], fetchedAt: Date.now() };
      }
    } catch {
      state.agentsCache = { agents: [], fetchedAt: Date.now() };
    }
  }

  const hasPlan = agents.some(
    (agent) => agent && (agent.id === "plan" || agent.name === "plan"),
  );

  emit(
    makeJsonRpcResponse(request.id, {
      modes: [{ mode: "plan", name: "Plan", supported: hasPlan }],
    }),
  );
}

/**
 * `model/list` translated from `GET /config/providers`. Emits Codex-shaped
 * model entries with `modelProvider: "opencode"` so the iOS picker can group.
 *
 * @param {OpenCodeTransportState} state
 * @param {ParsedJsonRpc} request
 * @param {(line: string) => void} emit
 * @returns {Promise<void>}
 */
async function handleModelListRequest(state, request, emit) {
  await ensureOpenCodeServer(state.server, state.options);
  const config = await openCodeFetch(state.server, "/config/providers", {
    method: "GET",
    fetchImpl: state.options.fetchImpl,
  });
  if (config.__opencodeError) {
    throw transportError("model_list_failed", config.message);
  }
  emit(makeJsonRpcResponse(request.id, mapProvidersConfigToModelList(config)));
}

/**
 * `POST /session`, persist `ThreadBinding`, emit `thread/started` plus the
 * response. The OpenCode session id stays inside the binding map; iOS only
 * sees the Remodex thread id.
 *
 * @param {OpenCodeTransportState} state
 * @param {ParsedJsonRpc} request
 * @param {(line: string) => void} emit
 * @returns {Promise<void>}
 */
async function handleThreadStartRequest(state, request, emit) {
  const params = request.params || {};
  const cwd = resolveCwdFromThreadStartParams(params);
  const threadId = `oc-thread-${crypto.randomUUID()}`;
  const title = readString(params.title) || readString(params.name) || "OpenCode chat";
  const model = readModelFromParams(params);

  await ensureOpenCodeServer(state.server, state.options);
  const created = await openCodeFetch(state.server, "/session", {
    method: "POST",
    directory: cwd || undefined,
    body: { title },
    fetchImpl: state.options.fetchImpl,
  });
  if (created.__opencodeError) {
    throw transportError("session_create_failed", created.message);
  }

  const sessionId = readString(created?.id)
    || readString(created?.info?.id)
    || readString(created?.sessionID)
    || readString(created?.sessionId);
  if (!sessionId) {
    throw transportError("session_create_failed", "OpenCode session response missing id");
  }

  const binding = {
    remodexThreadId: threadId,
    opencodeSessionId: sessionId,
    cwd: cwd || process.cwd(),
    model,
    activeRemodexTurnId: null,
    turnPhase: "idle",
    updatedAt: Date.now(),
    title,
  };
  state.bindingsByThreadId.set(threadId, binding);
  indexBinding(state, binding);
  persistBindings(state);

  emit(emitThreadStarted(state, { threadId, model: model?.model ?? null }));
  emit(makeJsonRpcResponse(request.id, { thread: publicThreadFromBinding(binding) }));
}

/**
 * `GET /session/:id` + `GET /session/:id/message` → Codex-shaped `thread/read`
 * result. If OpenCode no longer has the session after a bridge restart, tell
 * the client to start a fresh thread.
 *
 * @param {OpenCodeTransportState} state
 * @param {ParsedJsonRpc} request
 * @param {(line: string) => void} emit
 * @returns {Promise<void>}
 */
async function handleThreadReadRequest(state, request, emit) {
  const params = request.params || {};
  const threadId = readThreadId(params);
  const binding = getBinding(state, threadId);
  if (!binding) {
    throw transportError("thread_not_found", `OpenCode thread not found: ${threadId}`);
  }

  if (binding.turnPhase === "failed" && binding.lastFailedTurnId) {
    const line = emitTurnFailed(state, {
      threadId: binding.remodexThreadId,
      turnId: binding.lastFailedTurnId,
      message: "Bridge restarted during an active turn.",
    });
    if (line) {
      emit(line);
    }
    binding.lastFailedTurnId = null;
    persistBindings(state);
  }

  await ensureOpenCodeServer(state.server, state.options);
  const session = await openCodeFetch(state.server, `/session/${binding.opencodeSessionId}`, {
    method: "GET",
    directory: binding.cwd,
    fetchImpl: state.options.fetchImpl,
  });
  if (session.__opencodeError) {
    throw transportError("session_not_found", "OpenCode session is no longer available. Start a new thread.");
  }

  if (session?.title) {
    binding.title = readString(session.title) || binding.title;
  }
  binding.updatedAt = Date.now();
  persistBindings(state);

  const responseThread = publicThreadFromBinding(binding);
  if (params.includeTurns === true || params.include_turns === true) {
    responseThread.turns = await loadTurnsForBinding(state, binding, { sortDirection: "asc" });
  }

  emit(makeJsonRpcResponse(request.id, { thread: responseThread }));
}

/**
 * `GET /session/:id/message` chunked into Codex-shaped turn entries. OpenCode
 * threads never hit the `~/.codex/sessions` JSONL fallback.
 *
 * @param {OpenCodeTransportState} state
 * @param {ParsedJsonRpc} request
 * @param {(line: string) => void} emit
 * @returns {Promise<void>}
 */
async function handleThreadTurnsListRequest(state, request, emit) {
  const params = request.params || {};
  const threadId = readThreadId(params);
  const binding = getBinding(state, threadId);
  if (!binding) {
    throw transportError("thread_not_found", `OpenCode thread not found: ${threadId}`);
  }

  const sortDirection = readString(params.sortDirection || params.sort_direction) || "desc";
  const limit = boundedPositiveInteger(params.limit, 50);
  const turns = await loadTurnsForBinding(state, binding, { sortDirection });

  emit(makeJsonRpcResponse(request.id, {
    data: turns.slice(0, limit),
    nextCursor: null,
  }));
}

/**
 * Re-bind a Remodex thread to its persisted OpenCode session. Return
 * `session_not_found` when OpenCode no longer has the session.
 *
 * @param {OpenCodeTransportState} state
 * @param {ParsedJsonRpc} request
 * @param {(line: string) => void} emit
 * @returns {Promise<void>}
 */
async function handleThreadResumeRequest(state, request, emit) {
  const params = request.params || {};
  const threadId = readThreadId(params);
  const binding = getBinding(state, threadId);
  if (!binding) {
    throw transportError("session_not_found", "OpenCode session is no longer available. Start a new thread.");
  }

  await ensureOpenCodeServer(state.server, state.options);
  const session = await openCodeFetch(state.server, `/session/${binding.opencodeSessionId}`, {
    method: "GET",
    directory: binding.cwd,
    fetchImpl: state.options.fetchImpl,
  });
  if (session.__opencodeError) {
    throw transportError("session_not_found", "OpenCode session is no longer available. Start a new thread.");
  }

  binding.updatedAt = Date.now();
  persistBindings(state);
  emit(makeJsonRpcResponse(request.id, { thread: publicThreadFromBinding(binding) }));
}

/**
 * `thread/list` synthesized from persisted `ThreadBinding`s. OpenCode has no
 * top-level session-list endpoint in V1; the bridge owns this view.
 *
 * @param {OpenCodeTransportState} state
 * @param {ParsedJsonRpc} request
 * @param {(line: string) => void} emit
 * @returns {Promise<void>}
 */
async function handleThreadListRequest(state, request, emit) {
  const params = request.params || {};
  const limit = boundedPositiveInteger(params.limit, 50);
  const threads = Array.from(state.bindingsByThreadId.values())
    .map((binding) => publicThreadFromBinding(binding))
    .sort((lhs, rhs) => Date.parse(rhs.updatedAt || rhs.createdAt || 0)
      - Date.parse(lhs.updatedAt || lhs.createdAt || 0))
    .slice(0, limit);

  emit(makeJsonRpcResponse(request.id, {
    data: threads,
    nextCursor: null,
  }));
}

/**
 * `PATCH /session/:id` with the new title. Also emits `thread/name/updated`
 * for the local sidebar.
 *
 * @param {OpenCodeTransportState} state
 * @param {ParsedJsonRpc} request
 * @param {(line: string) => void} emit
 * @returns {Promise<void>}
 */
async function handleThreadNameSetRequest(state, request, emit) {
  const params = request.params || {};
  const threadId = readThreadId(params);
  const binding = getBinding(state, threadId);
  if (!binding) {
    throw transportError("thread_not_found", `OpenCode thread not found: ${threadId}`);
  }

  const name = readString(params.name) || readString(params.title);
  if (!name) {
    throw transportError("missing_thread_name", "A thread name is required.");
  }

  await ensureOpenCodeServer(state.server, state.options);
  const updated = await openCodeFetch(state.server, `/session/${binding.opencodeSessionId}`, {
    method: "PATCH",
    directory: binding.cwd,
    body: { title: name },
    fetchImpl: state.options.fetchImpl,
  });
  if (updated.__opencodeError) {
    throw transportError("thread_name_set_failed", updated.message);
  }

  binding.title = name;
  binding.updatedAt = Date.now();
  persistBindings(state);

  emit(makeNotification("thread/name/updated", {
    threadId: binding.remodexThreadId,
    thread_id: binding.remodexThreadId,
    name,
    title: name,
  }));
  emit(makeJsonRpcResponse(request.id, { thread: publicThreadFromBinding(binding) }));
}

/**
 * `POST /session/:id/prompt_async`. Maps:
 *   - `input[]` → `parts[]` (text + image parts; real multimodal, not stub).
 *   - `collaborationMode: "plan"` → `agent: "plan"` (OpenCode plan agent).
 *   - `model`, `variant` passed through.
 *   - `approvalPolicy: never` or `sandbox: dangerously-skip-approvals` →
 *     session-level permission rules at thread creation (not here).
 *
 * Acquires the cwd lock before posting. Returns `workspace_busy` if another
 * thread holds the lock. A duplicate `(threadId, turnId)` while already running
 * is a no-op.
 *
 * @param {OpenCodeTransportState} state
 * @param {ParsedJsonRpc} request
 * @param {(line: string) => void} emit
 * @returns {Promise<void>}
 */
async function handleTurnStartRequest(state, request, emit) {
  const params = request.params || {};
  const threadId = readThreadId(params);
  const binding = getBinding(state, threadId);
  if (!binding) {
    throw transportError("thread_not_found", `OpenCode thread not found: ${threadId}`);
  }

  const turnId = readString(params.turnId || params.turn_id) || synthesizeTurnId();
  if (binding.turnPhase === "running" && binding.activeRemodexTurnId === turnId) {
    emit(makeJsonRpcResponse(request.id, {
      turnId,
      turn: { id: turnId, threadId, status: "running" },
    }));
    return;
  }
  if (binding.turnPhase === "running" && binding.activeRemodexTurnId) {
    throw transportError(
      "turn_in_progress",
      "A turn is already running on this thread."
    );
  }

  const lock = tryAcquireCwdLock(state, binding.cwd, threadId, turnId);
  if (!lock.ok) {
    emit(makeJsonRpcError(
      request.id,
      -32000,
      "Another thread is already running in this workspace.",
      {
        errorCode: "workspace_busy",
        holderThreadId: lock.holderThreadId,
        holderTurnId: lock.holderTurnId,
      }
    ));
    return;
  }

  const parts = buildPromptPartsFromTurnInput(params.input);
  if (parts.length === 0) {
    releaseCwdLock(state, binding.cwd, turnId);
    throw transportError("missing_turn_input", "turn/start requires text or image input.");
  }

  await ensureOpenCodeServer(state.server, state.options);
  const body = {
    parts,
    model: readModelReference(params.model || binding.model),
    variant: readString(params.variant) || undefined,
  };
  const agent = resolveTurnAgent(params);
  if (agent) {
    body.agent = agent;
  }

  const result = await openCodeFetch(state.server, `/session/${binding.opencodeSessionId}/prompt_async`, {
    method: "POST",
    directory: binding.cwd,
    body,
    fetchImpl: state.options.fetchImpl,
  });
  if (result.__opencodeError) {
    releaseCwdLock(state, binding.cwd, turnId);
    throw transportError("turn_start_failed", result.message);
  }

  applyBindingRuntimeFromTurnParams(binding, params, agent);
  binding.activeRemodexTurnId = turnId;
  binding.turnPhase = "running";
  binding.updatedAt = Date.now();
  resetTurnReducer(state, threadId);
  persistBindings(state);

  emit(makeJsonRpcResponse(request.id, {
    turnId,
    turn: { id: turnId, threadId, status: "running" },
  }));
}

/**
 * `POST /session/:id/abort`. A second call after the turn is terminal returns
 * success without re-posting.
 *
 * @param {OpenCodeTransportState} state
 * @param {ParsedJsonRpc} request
 * @param {(line: string) => void} emit
 * @returns {Promise<void>}
 */
async function handleTurnInterruptRequest(state, request, emit) {
  const params = request.params || {};
  const threadId = readThreadId(params);
  const binding = getBinding(state, threadId);
  if (!binding) {
    emit(makeJsonRpcResponse(request.id, { success: true, interrupted: false }));
    return;
  }

  if (binding.turnPhase !== "running") {
    emit(makeJsonRpcResponse(request.id, { success: true, interrupted: false }));
    return;
  }

  await ensureOpenCodeServer(state.server, state.options);
  const abortResult = await openCodeFetch(state.server, `/session/${binding.opencodeSessionId}/abort`, {
    method: "POST",
    directory: binding.cwd,
    fetchImpl: state.options.fetchImpl,
  });
  if (abortResult.__opencodeError) {
    throw transportError("turn_interrupt_failed", abortResult.message);
  }

  const turnId = binding.activeRemodexTurnId;
  if (turnId) {
    releaseCwdLock(state, binding.cwd, turnId);
    const line = emitTurnCompleted(state, {
      threadId: binding.remodexThreadId,
      turnId,
      status: "interrupted",
    });
    if (line) {
      emit(line);
    }
  }
  binding.turnPhase = "interrupted";
  binding.activeRemodexTurnId = null;
  binding.updatedAt = Date.now();
  persistBindings(state);

  emit(makeJsonRpcResponse(request.id, { success: true, interrupted: true }));
}

/**
 * Match an iOS `{ id, result }` reply to a pending approval or question request.
 * Unmapped shapes leave the pending entry intact so OpenCode can still be answered.
 *
 * @param {OpenCodeTransportState} state
 * @param {ParsedJsonRpc} response
 * @param {(line: string) => void} emit
 * @returns {Promise<void>}
 */
async function handleInboundClientResponse(state, response, emit) {
  const pending = findPendingApproval(state, response.id);
  if (!pending) {
    return;
  }

  const binding = state.bindingsByThreadId.get(pending.remodexThreadId);
  if (!binding) {
    return;
  }

  await ensureOpenCodeServer(state.server, state.options);

  if (pending.approvalMethod === "item/tool/requestUserInput") {
    const body = mapUserInputAnswersToOpenCode(response.result);
    if (!body) {
      return;
    }
    const result = await openCodeFetch(
      state.server,
      `/question/${pending.permissionId}/reply`,
      {
        method: "POST",
        directory: binding.cwd,
        body,
        fetchImpl: state.options.fetchImpl,
      }
    );
    if (result.__opencodeError) {
      throw transportError("approval_reply_failed", result.message);
    }
    state.pendingApprovalsById.delete(pending.permissionId);
    return;
  }

  const decision = mapApprovalResultToOpenCode(response.result, pending);
  if (!decision) {
    return;
  }

  const result = await openCodeFetch(
    state.server,
    `/session/${binding.opencodeSessionId}/permissions/${pending.permissionId}`,
    {
      method: "POST",
      directory: binding.cwd,
      body: { response: decision },
      fetchImpl: state.options.fetchImpl,
    }
  );
  if (result.__opencodeError) {
    throw transportError("approval_reply_failed", result.message);
  }
  state.pendingApprovalsById.delete(pending.permissionId);
}

/**
 * Refusal path for transport methods OpenCode does not implement.
 *
 * @param {string} methodName
 * @param {ParsedJsonRpc} request
 * @param {(line: string) => void} emit
 */
function handleUnsupportedMethod(methodName, request, emit) {
  const refusal = lookupOpenCodeTransportRefusal(methodName);
  if (request.id == null) {
    return;
  }

  if (refusal) {
    emit(makeJsonRpcError(request.id, -32000, refusal.message, { errorCode: refusal.errorCode }));
    return;
  }

  emit(makeJsonRpcError(
    request.id,
    -32000,
    `Method not supported by the OpenCode runtime: ${methodName || "unknown"}`,
    { errorCode: "method_not_supported" }
  ));
}

// === Bus egress (OpenCode → iOS) =====================================================

/**
 * Map one bus event to zero or more JSON-RPC notification lines
 * (newline-terminated). Array order is wire order. Exported for unit tests.
 *
 * @param {OpenCodeTransportState} state
 * @param {BusEvent} busEvent
 * @returns {string[]}
 */
function mapBusEventToCodexLines(state, busEvent) {
  if (shouldDropDuplicateBusEvent(state, busEvent)) {
    return [];
  }

  const sessionId = readString(busEvent.properties?.sessionID)
    || readString(busEvent.properties?.sessionId);
  const binding = sessionId ? findBindingBySessionId(state, sessionId) : null;
  if (!binding && !isGlobalBusEvent(busEvent.type)) {
    markBusEventProcessed(state, busEvent);
    return [];
  }

  const lines = [];
  let bindingDirty = false;
  switch (busEvent.type) {
    case "session.status": {
      const statusType = readSessionStatusType(busEvent.properties);

      // thread/status/changed fires whenever we have a binding, regardless of turn
      if (binding) {
        let threadStatus;
        if (statusType === "busy") {
          threadStatus = "running";
        } else if (statusType === "idle") {
          threadStatus = "idle";
        } else if (statusType === "retry") {
          threadStatus = "retrying";
        }
        if (threadStatus) {
          lines.push(emitThreadStatusChanged(state, {
            threadId: binding.remodexThreadId,
            status: threadStatus,
          }));
        }
      }

      if (statusType === "busy" && binding?.activeRemodexTurnId) {
        const line = emitTurnStarted(state, {
          threadId: binding.remodexThreadId,
          turnId: binding.activeRemodexTurnId,
        });
        if (line) {
          lines.push(line);
        }
      } else if (statusType === "idle" && binding?.activeRemodexTurnId) {
        const turnId = binding.activeRemodexTurnId;
        const line = emitTurnCompleted(state, {
          threadId: binding.remodexThreadId,
          turnId,
          status: "completed",
        });
        if (line) {
          lines.push(line);
        }
        releaseCwdLock(state, binding.cwd, turnId);
        binding.turnPhase = "idle";
        binding.activeRemodexTurnId = null;
        resetTurnReducer(state, binding.remodexThreadId);
        bindingDirty = true;
      }
      break;
    }
    case "session.error": {
      if (!binding?.activeRemodexTurnId) {
        break;
      }
      const message = readSessionErrorMessage(busEvent.properties)
        || "OpenCode session error";
      const turnId = binding.activeRemodexTurnId;
      const line = emitTurnFailed(state, {
        threadId: binding.remodexThreadId,
        turnId,
        message,
      });
      if (line) {
        lines.push(line);
      }
      releaseCwdLock(state, binding.cwd, turnId);
      binding.turnPhase = "failed";
      binding.activeRemodexTurnId = null;
      resetTurnReducer(state, binding.remodexThreadId);
      bindingDirty = true;
      break;
    }
    case "message.part.delta": {
      if (!binding?.activeRemodexTurnId) {
        break;
      }
      const delta = readString(busEvent.properties?.delta);
      if (!delta) {
        break;
      }
      const partId = readString(busEvent.properties?.partID)
        || readString(busEvent.properties?.partId)
        || "part";
      const itemId = resolveItemIdForPart(state, binding.remodexThreadId, partId);
      const partKind = resolvePartKind(state, binding.remodexThreadId, partId, busEvent.properties);
      if (partKind === "reasoning") {
        const line = emitReasoningDelta(state, {
          threadId: binding.remodexThreadId,
          turnId: binding.activeRemodexTurnId,
          itemId,
          delta,
        });
        if (line) {
          lines.push(line);
          state.sse.lastEmittedItemIdByThread.set(binding.remodexThreadId, itemId);
        }
      } else if (partKind === "tool") {
        const line = emitToolCallDelta(state, {
          threadId: binding.remodexThreadId,
          turnId: binding.activeRemodexTurnId,
          itemId,
          delta,
        });
        if (line) {
          lines.push(line);
          state.sse.lastEmittedItemIdByThread.set(binding.remodexThreadId, itemId);
        }
      } else {
        const line = emitAgentMessageDelta(state, {
          threadId: binding.remodexThreadId,
          turnId: binding.activeRemodexTurnId,
          itemId,
          delta,
        });
        if (line) {
          lines.push(line);
          state.sse.lastEmittedItemIdByThread.set(binding.remodexThreadId, itemId);
        }
      }
      break;
    }
    case "message.part.updated": {
      if (!binding?.activeRemodexTurnId) {
        break;
      }
      const part = busEvent.properties?.part;
      const partId = readString(part?.id) || readString(part?.partID);
      if (partId) {
        rememberPartKind(state, binding.remodexThreadId, partId, readString(part?.type) || "text");
      }
      const toolName = readString(part?.tool) || readString(part?.name);
      const partStatus = readString(part?.state?.status) || readString(part?.status);
      if (toolName) {
        const itemId = resolveItemIdForPart(state, binding.remodexThreadId, partId || toolName);
        let lifecycleLine;
        if (partStatus === "completed" || partStatus === "failed") {
          lifecycleLine = emitItemLifecycle(state, {
            threadId: binding.remodexThreadId,
            turnId: binding.activeRemodexTurnId,
            itemId,
            phase: "completed",
            patch: {
              type: "toolCall",
              name: toolName,
              status: partStatus === "failed" ? "failed" : "completed",
            },
          });
        } else {
          lifecycleLine = emitItemLifecycle(state, {
            threadId: binding.remodexThreadId,
            turnId: binding.activeRemodexTurnId,
            itemId,
            phase: "started",
            patch: { type: "toolCall", name: toolName, status: "running" },
          });
        }
        if (lifecycleLine) {
          lines.push(lifecycleLine);
          state.sse.lastEmittedItemIdByThread.set(binding.remodexThreadId, itemId);
        }
      }
      break;
    }
    case "permission.asked": {
      if (!binding) {
        break;
      }
      const permLine = emitApprovalRequest(state, binding, busEvent.properties);
      if (permLine) {
        lines.push(permLine);
        const parsed = JSON.parse(permLine);
        if (parsed?.params?.itemId) {
          state.sse.lastEmittedItemIdByThread.set(binding.remodexThreadId, parsed.params.itemId);
        }
      }
      break;
    }
    case "question.asked": {
      if (!binding) {
        break;
      }
      const qLine = emitUserInputRequest(state, binding, busEvent.properties);
      if (qLine) {
        lines.push(qLine);
        const parsed = JSON.parse(qLine);
        if (parsed?.params?.itemId) {
          state.sse.lastEmittedItemIdByThread.set(binding.remodexThreadId, parsed.params.itemId);
        }
      }
      break;
    }
    default:
      break;
  }

  markBusEventProcessed(state, busEvent);
  if (bindingDirty) {
    binding.updatedAt = Date.now();
    persistBindings(state);
  }
  return lines;
}

function emitThreadStarted(state, { threadId, model }) {
  return makeNotification("thread/started", {
    threadId,
    thread: { id: threadId, model: model ?? null },
  });
}

function emitTurnStarted(state, { threadId, turnId }) {
  const reducer = getTurnReducer(state, threadId);
  if (reducer.startedEmitted) {
    return null;
  }
  reducer.startedEmitted = true;
  return makeNotification("turn/started", { threadId, turnId, id: turnId });
}

function emitAgentMessageDelta(state, { threadId, turnId, itemId, delta }) {
  return makeNotification("item/agentMessage/delta", {
    threadId,
    turnId,
    itemId,
    delta,
  });
}

function emitReasoningDelta(state, { threadId, turnId, itemId, delta }) {
  return makeNotification("item/reasoning/textDelta", {
    threadId,
    turnId,
    itemId,
    delta,
  });
}

function emitToolCallDelta(state, { threadId, turnId, itemId, delta }) {
  return makeNotification("item/toolCall/outputDelta", {
    threadId,
    turnId,
    itemId,
    delta,
  });
}

function emitThreadStatusChanged(state, { threadId, status }) {
  return makeNotification("thread/status/changed", {
    threadId,
    status,
  });
}

function emitTurnCompleted(state, { threadId, turnId, status }) {
  const reducer = getTurnReducer(state, threadId);
  if (reducer.terminalEmitted) {
    return null;
  }
  reducer.terminalEmitted = true;
  return makeNotification("turn/completed", { threadId, turnId, status });
}

function emitTurnFailed(state, { threadId, turnId, message }) {
  const reducer = getTurnReducer(state, threadId);
  if (reducer.terminalEmitted) {
    return null;
  }
  reducer.terminalEmitted = true;
  return makeNotification("turn/completed", {
    threadId,
    turnId,
    status: "failed",
    error: { message: coerceMessageString(message, "Turn failed") },
  });
}

function emitApprovalRequest(state, binding, payload) {
  const permissionId = readString(payload?.id)
    || readString(payload?.permissionID)
    || readString(payload?.permissionId);
  if (!permissionId) {
    return null;
  }

  const approvalMethod = resolveApprovalMethod(payload);
  const remodexItemId = synthesizeItemId("approval");
  state.pendingApprovalsById.set(permissionId, {
    permissionId,
    remodexThreadId: binding.remodexThreadId,
    remodexItemId,
    approvalMethod,
    requestedAt: Date.now(),
  });

  return makeNotification(approvalMethod, {
    threadId: binding.remodexThreadId,
    turnId: binding.activeRemodexTurnId,
    itemId: remodexItemId,
    id: remodexItemId,
    permissionId,
    request: payload,
  });
}

function emitUserInputRequest(state, binding, payload) {
  const requestId = readString(payload?.id) || readString(payload?.requestID);
  const remodexItemId = synthesizeItemId("question");
  if (requestId) {
    state.pendingApprovalsById.set(requestId, {
      permissionId: requestId,
      remodexThreadId: binding.remodexThreadId,
      remodexItemId,
      approvalMethod: "item/tool/requestUserInput",
      requestedAt: Date.now(),
    });
  }

  return makeNotification("item/tool/requestUserInput", {
    threadId: binding.remodexThreadId,
    turnId: binding.activeRemodexTurnId,
    itemId: remodexItemId,
    id: remodexItemId,
    request: payload,
  });
}

function emitItemLifecycle(state, { threadId, turnId, itemId, phase, patch }) {
  const method = phase === "started"
    ? "item/started"
    : phase === "completed"
      ? "item/completed"
      : "item/updated";
  return makeNotification(method, {
    threadId,
    turnId,
    itemId,
    item: { id: itemId, ...patch },
  });
}

// === Pure parsers (exported for tests) ===============================================

/**
 * Extract the listening URL from accumulated `opencode serve` stdout. Returns
 * `{ ready, rest }` where `ready` is `{ baseUrl }` once the prefix
 * `opencode server listening on http://...` is seen; otherwise `ready` is null
 * and `rest` is the buffer to keep accumulating. Username and password live
 * in env, not stdout (see `resolveOpenCodeCommand` / `generateServerPassword`).
 *
 * @param {string} buffer
 * @returns {{ ready: { baseUrl: string }|null, rest: string }}
 */
function parseListenStdout(buffer) {
  const LISTEN_RE = /^opencode server listening on (https?:\/\/[^\s]+)/;
  const PREFIX = "opencode server listening";

  let offset = 0;
  while (offset < buffer.length) {
    const newlineIndex = buffer.indexOf("\n", offset);
    const lineEnd = newlineIndex === -1 ? buffer.length : newlineIndex;
    const line = buffer.slice(offset, lineEnd).replace(/\r$/, "");
    const match = line.match(LISTEN_RE);
    if (match) {
      const restStart = newlineIndex === -1 ? lineEnd : newlineIndex + 1;
      return { ready: { baseUrl: match[1] }, rest: buffer.slice(restStart) };
    }
    if (newlineIndex === -1) {
      break;
    }
    offset = newlineIndex + 1;
  }

  const tail = buffer.slice(offset);
  for (let len = Math.min(tail.length, PREFIX.length); len > 0; len -= 1) {
    if (PREFIX.startsWith(tail.slice(-len))) {
      return { ready: null, rest: tail };
    }
  }

  return { ready: null, rest: tail.length > 0 ? tail : "" };
}

/**
 * Incremental SSE parser. Feeds raw chunks plus a cursor; returns any
 * complete bus events plus the updated cursor. Partial frames stay inside
 * `cursor.buffer`.
 *
 * @param {string} chunk
 * @param {{ buffer: string, lastSequence: number, lastEventId?: string|null }} cursor
 * @returns {{ events: BusEvent[], cursor: { buffer: string, lastSequence: number, lastEventId?: string|null } }}
 */
function parseSseChunk(chunk, cursor) {
  const nextCursor = {
    buffer: `${cursor.buffer || ""}${chunk}`,
    lastSequence: cursor.lastSequence || 0,
    lastEventId: cursor.lastEventId ?? null,
  };
  const events = [];

  while (true) {
    const frameEnd = nextCursor.buffer.indexOf("\n\n");
    if (frameEnd === -1) {
      break;
    }

    const frame = nextCursor.buffer.slice(0, frameEnd);
    nextCursor.buffer = nextCursor.buffer.slice(frameEnd + 2);

    let dataLines = [];
    let eventId = null;

    for (const rawLine of frame.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (!line || line.startsWith(":")) {
        continue;
      }
      if (line.startsWith("event:")) {
        continue;
      }
      if (line.startsWith("id:")) {
        eventId = line.slice(3).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) {
      continue;
    }

    if (eventId) {
      nextCursor.lastEventId = eventId;
    }

    let envelope = null;
    try {
      envelope = JSON.parse(dataLines.join("\n"));
    } catch {
      continue;
    }

    const payload = envelope?.payload?.type
      ? envelope.payload
      : (typeof envelope?.type === "string" ? envelope : null);
    if (!payload) {
      continue;
    }

    nextCursor.lastSequence += 1;
    events.push({
      type: payload.type,
      properties: payload.properties && typeof payload.properties === "object"
        ? payload.properties
        : {},
      sequence: nextCursor.lastSequence,
      id: readString(payload.id) || eventId || undefined,
    });
  }

  return { events, cursor: nextCursor };
}

/**
 * Parse one JSON-RPC line. Returns null for blank lines; throws nothing on
 * malformed input (caller decides whether to emit `error` or drop).
 *
 * @param {string} rawLine
 * @returns {ParsedJsonRpc|null}
 */
function parseJsonRpcLine(rawLine) {
  const trimmed = typeof rawLine === "string" ? rawLine.trim() : "";
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// === JSON-RPC formatters =============================================================

/** @param {string|number|null} id @param {unknown} result */
function makeJsonRpcResponse(id, result) {
  return `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`;
}

function makeJsonRpcError(id, code, message, data) {
  const envelope = {
    jsonrpc: "2.0",
    id,
    error: { code, message: coerceMessageString(message, "Request failed") },
  };
  if (data !== undefined) {
    envelope.error.data = data;
  }
  return `${JSON.stringify(envelope)}\n`;
}

/**
 * JSON-RPC and iOS-facing notifications require string `message` fields.
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function coerceMessageString(value, fallback = "Unknown error") {
  if (value == null) {
    return fallback;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message || fallback;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return String(value);
}

function makeNotification(method, params) {
  return `${JSON.stringify({ method, params: params ?? {} })}\n`;
}

// === Internal helpers ================================================================

/** Resolve the default bindings file path. Overridable for tests. */
function resolveBindingsPath() {
  return path.join(os.homedir(), ".remodex", "opencode-bindings.json");
}

/** Resolve the OpenCode binary name. Honors `REMODEX_OPENCODE_COMMAND`. */
function resolveOpenCodeCommand(env = process.env) {
  return env.REMODEX_OPENCODE_COMMAND || "opencode";
}

/** Mint a fresh password for `OPENCODE_SERVER_PASSWORD`. Never logged. */
function generateServerPassword() {
  return crypto.randomBytes(24).toString("base64url");
}

/** Synthetic ids that stay inside this transport so we never collide with Codex ids. */
function synthesizeTurnId() {
  return `oc-turn-${crypto.randomUUID()}`;
}

function synthesizeItemId(kind) {
  return `oc-${kind}-${crypto.randomUUID()}`;
}

/**
 * Resolve the workspace path from `thread/start` params. Falls back through
 * the same conventions `project-handler.js` uses so iOS-side cwd handling is
 * unchanged.
 *
 * @param {object} params
 * @returns {string}
 */
function resolveCwdFromThreadStartParams(params = {}) {
  const requested = readString(params.cwd)
    || readString(params.currentWorkingDirectory)
    || readString(params.current_working_directory)
    || readString(params.workingDirectory)
    || readString(params.working_directory);
  if (!requested) {
    return "";
  }
  return path.isAbsolute(requested) ? requested : path.resolve(process.cwd(), requested);
}

/** Listener bag matching `codex-transport.js` (`createListenerBag` in that file). */
function createListenerBag() {
  return {
    onMessage: null,
    onClose: null,
    onError: null,
    onStarted: null,
    emitMessage(message) {
      this.onMessage?.(message);
    },
    emitClose(...args) {
      this.onClose?.(...args);
    },
    emitError(error) {
      this.onError?.(error);
    },
    emitStarted(info) {
      this.onStarted?.(info);
    },
  };
}

/** Shared `notImplemented` error; grep `not implemented` for the contract footprint. */
function notImplemented(name) {
  return new Error(`opencode-transport: ${name} not implemented`);
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value : "";
}

function findBindingBySessionId(state, sessionId) {
  const normalized = readString(sessionId);
  if (!normalized) {
    return null;
  }
  const indexed = state.bindingsBySessionId?.get(normalized);
  if (indexed) {
    return indexed;
  }
  for (const binding of state.bindingsByThreadId.values()) {
    if (binding.opencodeSessionId === normalized) {
      indexBinding(state, binding);
      return binding;
    }
  }
  return null;
}

function indexBinding(state, binding) {
  const sessionId = readString(binding?.opencodeSessionId);
  if (!sessionId) {
    return;
  }
  if (!state.bindingsBySessionId) {
    state.bindingsBySessionId = new Map();
  }
  state.bindingsBySessionId.set(sessionId, binding);
}

function rebuildBindingIndexes(state) {
  state.bindingsBySessionId = new Map();
  for (const binding of state.bindingsByThreadId.values()) {
    indexBinding(state, binding);
  }
}

function isGlobalBusEvent(type) {
  return type === "server.connected"
    || type === "server.heartbeat"
    || type === "server.instance.disposed"
    || type === "global.disposed";
}

function ensureSseState(state) {
  if (!state.sse) {
    state.sse = {
      buffer: "",
      lastSequence: 0,
      reconnectAttempt: 0,
      stop: null,
      lastEventId: null,
      lastAppliedSequence: 0,
      seenBusEventIds: new Set(),
      evictedBusEventIds: new Set(),
    };
  }
  if (!state.sse.seenBusEventIds) {
    state.sse.seenBusEventIds = new Set();
  }
  if (!state.sse.evictedBusEventIds) {
    state.sse.evictedBusEventIds = new Set();
  }
  if (!state.sse.lastEmittedItemIdByThread) {
    state.sse.lastEmittedItemIdByThread = new Map();
  }
  return state.sse;
}

function shouldDropDuplicateBusEvent(state, busEvent) {
  const sse = ensureSseState(state);
  if (!busEvent.id) {
    return false;
  }
  if (sse.seenBusEventIds.has(busEvent.id)) {
    return true;
  }
  if (sse.evictedBusEventIds.has(busEvent.id)) {
    return true;
  }
  return false;
}

function markBusEventProcessed(state, busEvent) {
  const sse = ensureSseState(state);
  if (busEvent.id) {
    sse.seenBusEventIds.add(busEvent.id);
    if (sse.seenBusEventIds.size > BUS_EVENT_ID_CACHE_LIMIT) {
      const oldest = sse.seenBusEventIds.values().next().value;
      sse.seenBusEventIds.delete(oldest);
      sse.evictedBusEventIds.add(oldest);
      if (sse.evictedBusEventIds.size > BUS_EVENT_ID_CACHE_LIMIT) {
        const oldestEvicted = sse.evictedBusEventIds.values().next().value;
        sse.evictedBusEventIds.delete(oldestEvicted);
      }
    }
  }
  sse.lastAppliedSequence = Math.max(
    sse.lastAppliedSequence ?? 0,
    busEvent.sequence
  );
}

function resetTurnReducer(state, threadId) {
  state.turnReducerByThreadId?.delete(threadId);
  const sse = ensureSseState(state);
  sse.seenBusEventIds.clear();
  sse.evictedBusEventIds.clear();
}

function readSessionStatusType(properties) {
  const status = properties?.status;
  if (typeof status === "string") {
    return status.trim();
  }
  if (status && typeof status === "object") {
    const type = readString(status.type);
    if (type === "busy" || type === "idle" || type === "retry") {
      return type;
    }
  }
  return readString(properties?.sessionStatus) || "";
}

function readSessionErrorMessage(properties) {
  const error = properties?.error;
  if (typeof error === "string") {
    return error.trim();
  }
  if (error && typeof error === "object") {
    const message = readString(error.message);
    if (message) {
      return message;
    }
  }
  return readString(properties?.message);
}

function getTurnReducer(state, threadId) {
  if (!state.turnReducerByThreadId) {
    state.turnReducerByThreadId = new Map();
  }
  let reducer = state.turnReducerByThreadId.get(threadId);
  if (!reducer) {
    reducer = {
      startedEmitted: false,
      terminalEmitted: false,
      itemIdByPartId: new Map(),
      partKindByPartId: new Map(),
    };
    state.turnReducerByThreadId.set(threadId, reducer);
  }
  return reducer;
}

function rememberPartKind(state, threadId, partId, kind) {
  if (!partId) {
    return;
  }
  getTurnReducer(state, threadId).partKindByPartId.set(partId, kind);
}

function resolvePartKind(state, threadId, partId, properties) {
  const reducer = getTurnReducer(state, threadId);
  const remembered = reducer.partKindByPartId.get(partId);
  if (remembered) {
    return remembered;
  }
  const inlineType = readString(properties?.part?.type) || readString(properties?.type);
  if (inlineType === "reasoning") {
    return "reasoning";
  }
  if (inlineType === "tool" || inlineType === "tool-call") {
    return "tool";
  }
  return "text";
}

function resolveItemIdForPart(state, threadId, partId) {
  const reducer = getTurnReducer(state, threadId);
  let itemId = reducer.itemIdByPartId.get(partId);
  if (!itemId) {
    itemId = synthesizeItemId("item");
    reducer.itemIdByPartId.set(partId, itemId);
  }
  return itemId;
}

function resolveApprovalMethod(payload) {
  const permission = readString(payload?.permission) || readString(payload?.type);
  if (permission === "edit" || permission === "write") {
    return "item/fileChange/requestApproval";
  }
  if (permission === "read") {
    return "item/fileRead/requestApproval";
  }
  if (permission === "bash" || permission === "command") {
    return "item/commandExecution/requestApproval";
  }
  return "item/permissions/requestApproval";
}

function normalizeThreadBinding(entry) {
  const turnPhase = readString(entry?.turnPhase);
  return {
    remodexThreadId: readString(entry?.remodexThreadId),
    opencodeSessionId: readString(entry?.opencodeSessionId),
    cwd: readString(entry?.cwd) || process.cwd(),
    model: entry?.model && typeof entry.model === "object" ? entry.model : null,
    agent: readString(entry?.agent) || null,
    activeRemodexTurnId: readString(entry?.activeRemodexTurnId) || null,
    lastFailedTurnId: readString(entry?.lastFailedTurnId) || null,
    turnPhase: turnPhase === "running"
      || turnPhase === "failed"
      || turnPhase === "interrupted"
      ? turnPhase
      : "idle",
    updatedAt: Number(entry?.updatedAt) || Date.now(),
    title: readString(entry?.title) || null,
  };
}

function normalizeLockCwd(cwd) {
  const raw = readString(cwd) || process.cwd();
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(raw) : fs.realpathSync(raw);
  } catch {
    return path.resolve(raw);
  }
}

function persistBindingsNow(state) {
  if (!state?.bindingsByThreadId || !state.options) {
    return;
  }
  const bindingsPath = state.options.bindingsPath ?? resolveBindingsPath();
  saveBindings(bindingsPath, state.bindingsByThreadId);
}

function schedulePersistBindings(state) {
  if (!state?.bindingsByThreadId || !state.options) {
    return;
  }
  if (state._persistBindingsTimer) {
    clearTimeout(state._persistBindingsTimer);
  }
  state._persistBindingsTimer = setTimeout(() => {
    state._persistBindingsTimer = null;
    persistBindingsNow(state);
  }, BINDINGS_PERSIST_DEBOUNCE_MS);
  state._persistBindingsTimer.unref?.();
}

function flushPersistBindings(state) {
  if (state?._persistBindingsTimer) {
    clearTimeout(state._persistBindingsTimer);
    state._persistBindingsTimer = null;
  }
  persistBindingsNow(state);
}

function persistBindings(state) {
  schedulePersistBindings(state);
}

function readThreadId(params = {}) {
  return readString(params.threadId || params.thread_id || params.id);
}

function getBinding(state, threadId) {
  const normalized = readString(threadId);
  return normalized ? state.bindingsByThreadId.get(normalized) || null : null;
}

function transportError(errorCode, message) {
  const error = new Error(message);
  error.errorCode = errorCode;
  return error;
}

function publicThreadFromBinding(binding) {
  return {
    id: binding.remodexThreadId,
    title: binding.title || "OpenCode chat",
    name: binding.title || "OpenCode chat",
    cwd: binding.cwd,
    current_working_directory: binding.cwd,
    model: binding.model?.model ?? null,
    modelProvider: "opencode",
    provider: "opencode",
    agentRuntime: "opencode",
    providerId: binding.model?.provider ?? null,
    variant: binding.model?.variant ?? null,
    agent: binding.agent ?? null,
    createdAt: new Date(binding.updatedAt).toISOString(),
    updatedAt: new Date(binding.updatedAt).toISOString(),
  };
}

function readModelFromParams(params = {}) {
  const model = readModelReference(params.model);
  if (!model) {
    return null;
  }
  const provider = readString(params.modelProvider || params.provider) || "opencode";
  return {
    provider,
    model,
    variant: readString(params.variant) || undefined,
  };
}

/**
 * Persists resolved model, variant, and agent on the thread binding after turn/start.
 *
 * @param {ThreadBinding} binding
 * @param {Record<string, unknown>} params
 * @param {string|undefined} agent
 */
function applyBindingRuntimeFromTurnParams(binding, params = {}, agent) {
  const modelFromParams = readModelFromParams(params);
  if (modelFromParams) {
    binding.model = modelFromParams;
  } else {
    const variantOnly = readString(params.variant);
    if (variantOnly) {
      if (binding.model && typeof binding.model === "object") {
        binding.model = { ...binding.model, variant: variantOnly };
      } else {
        binding.model = { provider: "opencode", model: "", variant: variantOnly };
      }
    }
  }
  if (agent) {
    binding.agent = agent;
  }
}

function readModelReference(value) {
  if (typeof value === "string") {
    return readString(value);
  }
  if (value && typeof value === "object") {
    return readString(value.model || value.id);
  }
  return "";
}

function mapProvidersConfigToModelList(config) {
  const items = [];
  const defaults = config?.default && typeof config.default === "object" ? config.default : {};

  for (const { providerId, providerConfig } of iterateProviderConfigs(config)) {
    const models = providerConfig?.models && typeof providerConfig.models === "object"
      ? providerConfig.models
      : {};
    for (const [modelId, modelConfig] of Object.entries(models)) {
      const normalizedModelId = readString(modelId);
      if (!normalizedModelId) {
        continue;
      }
      appendCatalogEntriesForModel(items, {
        providerId,
        modelId: normalizedModelId,
        modelConfig: modelConfig && typeof modelConfig === "object" ? modelConfig : {},
        defaults,
      });
    }
  }

  for (const entry of items) {
    entry.supportsFastMode = items.some((other) => other.providerId === entry.providerId
      && other.id !== entry.id
      && readServiceTierFromModelOptions(other)
      && (other.modelId === `${entry.modelId}-fast`
        || (other.modelId.startsWith(`${entry.modelId}-`)
          && other.modelId.length > entry.modelId.length + 1)));
  }

  return { items };
}

/**
 * OpenCode returns `providers` as an array; older fixtures may use a keyed object.
 * @param {unknown} config
 * @returns {{ providerId: string, providerConfig: object }[]}
 */
function iterateProviderConfigs(config) {
  const raw = config?.providers;
  if (Array.isArray(raw)) {
    return raw
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        providerId: readString(entry.id) || readString(entry.name) || "unknown",
        providerConfig: entry,
      }))
      .filter((entry) => entry.providerId !== "unknown" || entry.providerConfig?.models);
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([providerId, providerConfig]) => ({
      providerId: readString(providerId),
      providerConfig: providerConfig && typeof providerConfig === "object" ? providerConfig : {},
    }));
  }
  return [];
}

/**
 * @param {object[]} items
 * @param {{ providerId: string, modelId: string, modelConfig: object, defaults: object }} ctx
 */
function appendCatalogEntriesForModel(items, ctx) {
  const { providerId, modelId, modelConfig, defaults } = ctx;
  const variantsMap = modelConfig.variants && typeof modelConfig.variants === "object"
    ? modelConfig.variants
    : {};
  const supportedVariants = Object.keys(variantsMap).map((id) => ({
    id,
    displayName: id,
  }));
  const providerDefault = readString(defaults[providerId]);
  const reference = `${providerId}/${modelId}`;
  const serviceTier = readServiceTierFromModelOptions(modelConfig);

  items.push({
    id: reference,
    model: reference,
    modelId,
    providerId,
    modelProvider: "opencode",
    provider: "opencode",
    displayName: readString(modelConfig.name) || modelId,
    isDefault: reference === readString(defaults.model)
      || modelId === providerDefault
      || reference === `${providerId}/${providerDefault}`,
    supportedVariants,
    supportsFastMode: false,
    defaultVariant: readString(modelConfig.defaultVariant)
      || readString(modelConfig.default_variant)
      || supportedVariants[0]?.id
      || null,
    ...(serviceTier ? { options: { serviceTier } } : {}),
  });

  const experimentalModes = modelConfig.experimental?.modes
    ?? modelConfig.experimental_modes
    ?? {};
  if (experimentalModes && typeof experimentalModes === "object") {
    for (const [mode, modeConfig] of Object.entries(experimentalModes)) {
      const modeModelId = `${modelId}-${mode}`;
      const modeOptions = mergeModelOptions(modelConfig.options, modeConfig);
      const modeServiceTier = readServiceTierFromModelOptions({ options: modeOptions })
        || readServiceTierFromProviderBody(modeConfig);
      items.push({
        id: `${providerId}/${modeModelId}`,
        model: `${providerId}/${modeModelId}`,
        modelId: modeModelId,
        providerId,
        modelProvider: "opencode",
        provider: "opencode",
        displayName: readString(modeConfig?.name) || `${readString(modelConfig.name) || modelId} ${mode}`,
        isDefault: false,
        supportedVariants: [],
        supportsFastMode: Boolean(modeServiceTier),
        defaultVariant: null,
        ...(modeServiceTier ? { options: { serviceTier: modeServiceTier } } : {}),
      });
    }
  }
}

function readServiceTierFromModelOptions(modelOrEntry) {
  const options = modelOrEntry?.options;
  if (!options || typeof options !== "object") {
    return readServiceTierFromProviderBody(modelOrEntry);
  }
  return readString(options.serviceTier)
    || readString(options.service_tier)
    || "";
}

function readServiceTierFromProviderBody(modeConfig) {
  const body = modeConfig?.provider?.body;
  if (!body || typeof body !== "object") {
    return "";
  }
  return readString(body.serviceTier) || readString(body.service_tier) || "";
}

function mergeModelOptions(baseOptions, modeConfig) {
  const base = baseOptions && typeof baseOptions === "object" ? { ...baseOptions } : {};
  const body = modeConfig?.provider?.body;
  if (!body || typeof body !== "object") {
    return base;
  }
  for (const [key, value] of Object.entries(body)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    base[camelKey] = value;
  }
  return base;
}

async function loadTurnsForBinding(state, binding, { sortDirection = "desc" } = {}) {
  const messages = await openCodeFetch(
    state.server,
    `/session/${binding.opencodeSessionId}/message`,
    {
      method: "GET",
      directory: binding.cwd,
      fetchImpl: state.options.fetchImpl,
    }
  );
  if (messages.__opencodeError) {
    return [];
  }

  const entries = Array.isArray(messages?.data)
    ? messages.data
    : Array.isArray(messages)
      ? messages
      : Array.isArray(messages?.messages)
        ? messages.messages
        : [];
  return mapMessagesToTurns(entries, sortDirection);
}

function mapMessagesToTurns(messages, sortDirection) {
  const turns = [];
  let currentTurn = null;

  for (const message of messages) {
    const role = readString(message?.info?.role || message?.role).toLowerCase();
    const text = textFromOpenCodeMessage(message);
    if (!text && role !== "assistant" && role !== "user") {
      continue;
    }

    if (role === "user" || !currentTurn) {
      currentTurn = {
        id: readString(message?.info?.id) || synthesizeTurnId(),
        status: "completed",
        items: [],
      };
      turns.push(currentTurn);
    }

    currentTurn.items.push({
      id: readString(message?.info?.id) || synthesizeItemId("item"),
      type: role === "user" ? "userMessage" : "agentMessage",
      text,
    });

    if (role === "assistant") {
      currentTurn = null;
    }
  }

  return sortDirection.toLowerCase() === "asc" ? turns : [...turns].reverse();
}

function textFromOpenCodeMessage(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      if (part.type === "text" || part.type === "reasoning") {
        return readString(part.text);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function buildPromptPartsFromTurnInput(input) {
  if (typeof input === "string") {
    const text = input.trim();
    return text ? [{ type: "text", text }] : [];
  }
  if (!Array.isArray(input)) {
    return [];
  }

  const parts = [];
  for (const item of input) {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) {
        parts.push({ type: "text", text });
      }
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const type = readString(item.type).toLowerCase();
    if (type.includes("image")) {
      const url = readString(item.url || item.path || item.dataURL || item.data_url);
      if (url) {
        parts.push({ type: "image", url });
      }
      continue;
    }
    const text = readString(item.text || item.content || item.message);
    if (text) {
      parts.push({ type: "text", text });
    }
  }
  return parts;
}

function resolveTurnAgent(params = {}) {
  const mode = readCollaborationModeId(params).toLowerCase();
  if (mode === "plan") {
    return "plan";
  }
  return readString(params.agent) || undefined;
}

function readCollaborationModeId(params = {}) {
  const raw = params.collaborationMode ?? params.collaboration_mode;
  if (typeof raw === "string") {
    return readString(raw);
  }
  if (raw && typeof raw === "object") {
    return readString(raw.mode || raw.id);
  }
  return "";
}

function boundedPositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numeric), 200);
}

function findPendingApproval(state, responseId) {
  const normalizedId = String(responseId);
  const direct = state.pendingApprovalsById.get(normalizedId);
  if (direct) {
    return direct;
  }
  for (const pending of state.pendingApprovalsById.values()) {
    if (pending.remodexItemId === normalizedId) {
      return pending;
    }
  }
  return null;
}

function attachOpenCodeSse(state, options) {
  if (state.sse.reconnectTimer) {
    clearTimeout(state.sse.reconnectTimer);
    state.sse.reconnectTimer = null;
  }
  state.sse.reconnectScheduled = false;
  state.sse.stop?.();

  state.sse.stop = connectOpenCodeEventStream(state, {
    onBusEvent: (event) => {
      for (const line of mapBusEventToCodexLines(state, event)) {
        state.listeners.emitMessage(line);
      }
    },
    onStreamLost: () => {
      scheduleOpenCodeSseReconnect(state, options);
    },
  }, options);

  // Fire-and-forget catch-up: fetch missed messages for running turns after reconnect
  catchUpAfterSseReconnect(state);
}

/** @param {OpenCodeTransportState} state */
async function catchUpAfterSseReconnect(state) {
  const { lastEmittedItemIdByThread, seenBusEventIds } = state.sse;
  if (!lastEmittedItemIdByThread || lastEmittedItemIdByThread.size === 0) {
    return;
  }

  for (const binding of state.bindingsByThreadId.values()) {
    if (binding.turnPhase !== "running" || !binding.opencodeSessionId) {
      continue;
    }

    const lastItemId = lastEmittedItemIdByThread.get(binding.remodexThreadId);
    if (!lastItemId) {
      continue;
    }

    const messages = await openCodeFetch(
      state.server,
      `/session/${binding.opencodeSessionId}/message`,
      {
        method: "GET",
        directory: binding.cwd,
        fetchImpl: state.options.fetchImpl,
      }
    );

    if (messages && typeof messages === "object" && !messages.__opencodeError) {
      const entries = Array.isArray(messages?.data)
        ? messages.data
        : Array.isArray(messages)
          ? messages
          : Array.isArray(messages?.messages)
            ? messages.messages
            : [];

      if (entries.length === 0) {
        continue;
      }

      // API returns newest-first; reverse to chronological for catch-up scanning
      const ordered = [...entries].reverse();

      let startIndex = -1;
      for (let i = 0; i < ordered.length; i++) {
        const msgId = readString(ordered[i]?.info?.id) || readString(ordered[i]?.id) || "";
        if (msgId === lastItemId) {
          startIndex = i;
          break;
        }
      }

      for (let i = startIndex + 1; i < ordered.length; i++) {
        const msg = ordered[i];
        const msgId = readString(msg?.info?.id) || readString(msg?.id) || synthesizeItemId("item");
        const role = readString(msg?.info?.role || msg?.role).toLowerCase();
        if (role !== "assistant") {
          continue;
        }

        // Bus events have stable IDs for dedup
        const eventId = readString(msg?.info?.id) || msgId;
        if (seenBusEventIds?.has(eventId)) {
          continue;
        }

        const text = textFromOpenCodeMessage(msg);
        const turnId = binding.activeRemodexTurnId || synthesizeTurnId();
        const line = makeNotification("item/updated", {
          threadId: binding.remodexThreadId,
          turnId,
          itemId: msgId,
          item: {
            id: msgId,
            type: "agentMessage",
            content: text,
            status: "completed",
          },
        });
        state.listeners.emitMessage(line);
      }
    }
  }
}

function scheduleOpenCodeSseReconnect(state, options) {
  if (state.server.phase === "stopped" || state.sse.reconnectScheduled) {
    return;
  }

  // Max-attempts ceiling: after 20 failures, fail active turns instead of retrying forever
  if (state.sse.reconnectAttempt >= 20) {
    for (const binding of state.bindingsByThreadId.values()) {
      if (binding.turnPhase === "running" && binding.activeRemodexTurnId) {
        const line = emitTurnFailed(state, {
          threadId: binding.remodexThreadId,
          turnId: binding.activeRemodexTurnId,
          message: "OpenCode SSE stream lost after 20 reconnect attempts",
        });
        if (line) {
          state.listeners.emitMessage(line);
        }
      }
    }
    state.sse.reconnectAttempt = 0;
    state.sse.reconnectScheduled = false;
    return;
  }

  state.sse.reconnectScheduled = true;
  const delayMs = scheduleSseReconnect(state.sse);
  state.sse.reconnectTimer = setTimeout(() => {
    state.sse.reconnectTimer = null;
    state.sse.reconnectScheduled = false;
    if (state.server.phase !== "stopped") {
      attachOpenCodeSse(state, options);
    }
  }, delayMs);
  state.sse.reconnectTimer.unref?.();
}

function mapApprovalResultToOpenCode(result, pending) {
  if (result === true) {
    return "once";
  }
  if (result === false) {
    return "reject";
  }
  if (!result || typeof result !== "object") {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(result, "permissions")) {
    const granted = Object.keys(result.permissions || {}).length > 0;
    return granted ? "once" : "reject";
  }
  const decision = readString(result.decision || result.action || result.response).toLowerCase();
  if (decision === "accept" || decision === "allow" || decision === "once" || decision === "approve") {
    return "once";
  }
  if (decision === "acceptforsession" || decision === "always") {
    return "always";
  }
  if (decision === "decline" || decision === "deny" || decision === "reject" || decision === "requestchanges") {
    return "reject";
  }
  return null;
}

function mapUserInputAnswersToOpenCode(result) {
  if (!result || typeof result !== "object") {
    return null;
  }
  const answersByQuestion = result.answers;
  if (!answersByQuestion || typeof answersByQuestion !== "object" || Array.isArray(answersByQuestion)) {
    return null;
  }

  const ordered = [];
  for (const entry of Object.values(answersByQuestion)) {
    if (entry && typeof entry === "object" && Array.isArray(entry.answers)) {
      const labels = entry.answers.map((value) => readString(value)).filter(Boolean);
      if (labels.length > 0) {
        ordered.push(labels);
      }
      continue;
    }
    const single = readString(entry);
    if (single) {
      ordered.push([single]);
    }
  }

  return ordered.length > 0 ? { answers: ordered } : null;
}

// === Module exports ==================================================================

module.exports = {
  createOpenCodeTransport,
  // Lifecycle (exposed for integration tests that inject `spawnImpl`).
  spawnOpenCodeServer,
  ensureOpenCodeServer,
  shutdownOpenCodeServer,
  // HTTP + SSE boundaries.
  openCodeFetch,
  connectOpenCodeEventStream,
  scheduleSseReconnect,
  // Bindings persistence.
  loadBindings,
  saveBindings,
  markInFlightTurnsFailedOnBoot,
  // Cwd turn lock.
  tryAcquireCwdLock,
  releaseCwdLock,
  // JSON-RPC ingress dispatch.
  routeInboundJsonRpc,
  handleUnsupportedMethod,
  handleThreadListRequest,
  handleInboundClientResponse,
  handleCollaborationModeListRequest,
  // Pure helpers (the unit-test surface).
  mapBusEventToCodexLines,
  mapProvidersConfigToModelList,
  emitTurnFailed,
  emitUserInputRequest,
  emitItemLifecycle,
  parseListenStdout,
  parseSseChunk,
  parseJsonRpcLine,
  makeJsonRpcResponse,
  makeJsonRpcError,
  coerceMessageString,
  makeNotification,
  resolveBindingsPath,
  resolveOpenCodeCommand,
  generateServerPassword,
  synthesizeTurnId,
  synthesizeItemId,
  resolveCwdFromThreadStartParams,
  rebuildBindingIndexes,
  scheduleOpenCodeSseReconnect,
  catchUpAfterSseReconnect,
  expireStaleCwdLocks,
  flushPersistBindings,
  persistBindingsNow,
  persistBindings,
};
