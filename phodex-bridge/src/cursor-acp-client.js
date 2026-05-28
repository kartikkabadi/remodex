// FILE: cursor-acp-client.js
// Purpose: Small JSON-RPC stdio client for Cursor's `cursor-agent acp` server.
// Layer: Bridge runtime provider transport
// Exports: createCursorAcpClient
// Depends on: child_process

const { spawn } = require("child_process");

const DEFAULT_ACP_REQUEST_TIMEOUT_MS = 30_000;

function createCursorAcpClient({
  command = "cursor-agent",
  args = ["acp"],
  cwd = process.cwd(),
  env = process.env,
  spawnImpl = spawn,
  requestTimeoutMs = DEFAULT_ACP_REQUEST_TIMEOUT_MS,
  onNotification = null,
  onRequest = null,
} = {}) {
  return new CursorAcpClient({
    args,
    command,
    cwd,
    env,
    onNotification,
    onRequest,
    requestTimeoutMs,
    spawnImpl,
  });
}

class CursorAcpClient {
  constructor({
    command,
    args,
    cwd,
    env,
    spawnImpl,
    requestTimeoutMs,
    onNotification,
    onRequest,
  }) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.spawn = spawnImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.onNotification = onNotification;
    this.onRequest = onRequest;
    this.child = null;
    this.nextRequestId = 1;
    this.pendingRequests = new Map();
    this.stdoutBuffer = "";
    this.stderr = "";
    this.closed = false;
  }

  start() {
    if (this.child) {
      return;
    }

    this.child = this.spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout?.setEncoding?.("utf8");
    this.child.stderr?.setEncoding?.("utf8");

    this.child.stdout?.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr?.on("data", (chunk) => {
      this.stderr = truncateTail(`${this.stderr}${chunk}`, 4_000);
    });
    this.child.on("error", (error) => this.failAll(error));
    this.child.on("close", (code, signal) => {
      this.closed = true;
      this.failAll(new Error(`Cursor ACP exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`));
    });
  }

  request(method, params = {}, timeoutMs = this.requestTimeoutMs) {
    this.start();
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Cursor ACP request timed out: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        method,
        reject,
        resolve,
        timeout,
      });
      try {
        this.writeFrame({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    this.start();
    this.writeFrame({ jsonrpc: "2.0", method, params });
  }

  respond(id, result) {
    this.writeFrame({ jsonrpc: "2.0", id, result });
  }

  rejectRequest(id, code, message) {
    this.writeFrame({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    });
  }

  kill(signal = "SIGTERM") {
    for (const waiter of this.pendingRequests.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("Cursor ACP client stopped."));
    }
    this.pendingRequests.clear();
    try {
      this.child?.kill(signal);
    } catch {
      // Ignore shutdown races; the process may already have exited.
    }
  }

  writeFrame(frame) {
    if (this.closed || !this.child?.stdin?.writable) {
      throw new Error("Cursor ACP stdin is not writable.");
    }
    this.child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  handleStdout(chunk) {
    this.stdoutBuffer += String(chunk);
    for (;;) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        this.handleFrame(line);
      }
    }
  }

  handleFrame(line) {
    const frame = safeParseJSON(line);
    if (!frame || typeof frame !== "object") {
      return;
    }

    if (frame.id != null && !frame.method) {
      this.handleResponse(frame);
      return;
    }

    if (frame.id != null && frame.method) {
      this.handleRequest(frame);
      return;
    }

    if (frame.method) {
      this.onNotification?.(frame);
    }
  }

  handleResponse(frame) {
    const waiter = this.pendingRequests.get(frame.id);
    if (!waiter) {
      return;
    }

    this.pendingRequests.delete(frame.id);
    clearTimeout(waiter.timeout);
    if (frame.error) {
      const error = new Error(frame.error.message || `Cursor ACP request failed: ${waiter.method}`);
      error.code = frame.error.code;
      error.data = frame.error.data;
      waiter.reject(error);
      return;
    }
    waiter.resolve(frame.result ?? null);
  }

  handleRequest(frame) {
    Promise.resolve()
      .then(() => this.onRequest?.(frame))
      .then((result) => {
        if (result !== undefined) {
          this.respond(frame.id, result);
        }
      })
      .catch((error) => {
        this.rejectRequest(frame.id, error?.code || -32603, error?.message || "Cursor ACP client request failed.");
      });
  }

  failAll(error) {
    for (const waiter of this.pendingRequests.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.pendingRequests.clear();
  }
}

function safeParseJSON(rawValue) {
  try {
    return JSON.parse(String(rawValue || ""));
  } catch {
    return null;
  }
}

function truncateTail(value, maxChars) {
  const text = String(value || "");
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

module.exports = {
  createCursorAcpClient,
};
