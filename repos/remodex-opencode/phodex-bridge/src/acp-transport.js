// FILE: acp-transport.js
// Purpose: Low-level ACP NDJSON stdio transport for communicating with an `opencode acp --acp-next`
//          child process. Handles request/response matching, notification routing, and buffer assembly.
// Layer: Transport adapter
// Exports: createAcpTransport
// Depends on: child_process, crypto

const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const ACP_START_TIMEOUT_MS = 15_000;
const ACP_REQUEST_TIMEOUT_MS = 90_000;
const STDOUT_BUFFER_MAX_BYTES = 2 * 1024 * 1024;

function createAcpTransport({
  env = process.env,
  spawnImpl = spawn,
  randomUUIDImpl = randomUUID,
  logPrefix = "[remodex]",
} = {}) {
  let child = null;
  let pendingRequests = new Map();
  let notificationHandlers = new Map();
  let closeHandlers = [];
  let errorHandlers = [];
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let started = false;
  let stopping = false;

  function start({ cwd = process.cwd(), extraArgs = [] } = {}) {
    if (child) {
      return Promise.resolve();
    }

    const command = resolveOpenCodeCommand(env);
    const args = ["acp", "--acp-next", ...extraArgs];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`OpenCode ACP did not start within ${ACP_START_TIMEOUT_MS / 1000}s.`));
      }, ACP_START_TIMEOUT_MS);

      try {
        child = spawnImpl(command, args, {
          env: { ...env, OPENCODE_ACP_NEXT: "1" },
          stdio: ["pipe", "pipe", "pipe"],
          cwd,
        });
      } catch (error) {
        clearTimeout(timeout);
        cleanup();
        reject(new Error(`Failed to spawn OpenCode ACP: ${error.message}`));
        return;
      }

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk) => {
        stdoutBuffer += String(chunk);
        if (stdoutBuffer.length > STDOUT_BUFFER_MAX_BYTES) {
          stdoutBuffer = stdoutBuffer.slice(-STDOUT_BUFFER_MAX_BYTES);
        }

        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          processLine(trimmed);
        }
      });

      child.stderr.on("data", (chunk) => {
        stderrBuffer = `${String(chunk)}${stderrBuffer}`.slice(0, 16_000);
        console.warn(`${logPrefix} OpenCode ACP stderr: ${String(chunk).trim()}`);
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        const wasStarted = started;
        cleanup();
        for (const handler of errorHandlers) {
          handler(err);
        }
        if (!wasStarted) {
          reject(err);
        }
      });

      child.on("spawn", () => {
        clearTimeout(timeout);
        started = true;
        resolve();
      });

      child.on("exit", (code, signal) => {
        const wasStarted = started;
        const wasStopping = stopping;
        cleanup();

        for (const handler of closeHandlers) {
          handler({ code, signal, expected: wasStopping });
        }

        if (wasStarted && !wasStopping) {
          for (const handler of errorHandlers) {
            handler(new Error(`OpenCode ACP exited unexpectedly (code ${code}, signal ${signal}).`));
          }
        }
      });
    });
  }

  function processLine(line) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      return;
    }

    const id = parsed.id;
    const method = readString(parsed.method);

    // Response to a pending request
    if (id != null && !method && pendingRequests.has(id)) {
      const { resolve, reject, timer } = pendingRequests.get(id);
      pendingRequests.delete(id);
      clearTimeout(timer);

      if (parsed.error) {
        reject(new Error(readString(parsed.error.message) || "OpenCode ACP error."));
      } else {
        resolve(parsed);
      }
      return;
    }

    // Server→client notification (has method, no id)
    if (method && id == null) {
      const handlers = notificationHandlers.get(method);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(parsed.params || {}, parsed);
          } catch {
            // Handler errors should not crash the transport.
          }
        }
      }
      return;
    }
  }

  function cleanup() {
    started = false;
    clearPendingRequests(new Error("OpenCode ACP transport closed."));
    child = null;
    stdoutBuffer = "";
    stderrBuffer = "";
  }

  function clearPendingRequests(error) {
    for (const [, { reject, timer }] of pendingRequests) {
      clearTimeout(timer);
      reject(error);
    }
    pendingRequests.clear();
  }

  function send(data) {
    if (!child || !child.stdin.writable || child.stdin.destroyed) {
      throw new Error("OpenCode ACP transport is not connected.");
    }

    const payload = JSON.stringify(data);
    child.stdin.write(`${payload}\n`);
  }

  function sendRequest(method, params = {}) {
    const id = randomUUIDImpl();
    const request = { id, method, params: params || {} };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`OpenCode ACP request '${method}' timed out after ${ACP_REQUEST_TIMEOUT_MS / 1000}s.`));
      }, ACP_REQUEST_TIMEOUT_MS);

      pendingRequests.set(id, { resolve, reject, timer });

      try {
        send(request);
      } catch (error) {
        clearTimeout(timer);
        pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  function onNotification(method, handler) {
    if (!notificationHandlers.has(method)) {
      notificationHandlers.set(method, []);
    }
    notificationHandlers.get(method).push(handler);

    return () => {
      const handlers = notificationHandlers.get(method);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  function onClose(handler) {
    closeHandlers.push(handler);
  }

  function onError(handler) {
    errorHandlers.push(handler);
  }

  function stop() {
    stopping = true;
    if (child) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Process may already be dead.
      }

      // Force kill after 5 seconds if still alive
      setTimeout(() => {
        if (child) {
          try {
            child.kill("SIGKILL");
          } catch {
            // Already dead.
          }
        }
      }, 5_000);
    }
  }

  function isConnected() {
    return child !== null && started && !stopping;
  }

  function getStderr() {
    return readString(stderrBuffer) || "";
  }

  return {
    isConnected,
    onClose,
    onError,
    onNotification,
    send,
    sendRequest,
    start,
    stop,
    getStderr,
  };
}

function resolveOpenCodeCommand(env = process.env) {
  return readString(env.REMODEX_OPENCODE_COMMAND) || "opencode";
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = { createAcpTransport };
