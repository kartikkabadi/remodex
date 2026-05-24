// FILE: cursor-acp-client.js
// Purpose: JSON-RPC stdio client and discovery helpers for Cursor Agent ACP.
// Layer: Bridge adapter
// Exports: createCursorAcpClient, discoverCursorAcpCommand
// Depends on: child_process, fs

const { execFile, spawn } = require("child_process");
const fs = require("fs");

const DEFAULT_ACP_REQUEST_TIMEOUT_MS = 30_000;
const LOCAL_CURSOR_AGENT_PATH = "/Users/user/.local/bin/agent";
const CURSOR_APP_CLI_PATH = "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";

function createCursorAcpClient({
  command,
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
    this.spawnImpl = spawnImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.onNotification = onNotification;
    this.onRequest = onRequest;
    this.child = null;
    this.closed = false;
    this.nextRequestId = 1;
    this.pendingRequests = new Map();
    this.stdoutBuffer = "";
    this.stderr = "";
  }

  start() {
    if (this.child) {
      return;
    }
    if (!this.command) {
      throw new Error("Cursor ACP command is required.");
    }

    this.child = this.spawnImpl(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout?.setEncoding?.("utf8");
    this.child.stderr?.setEncoding?.("utf8");
    this.child.stdout?.on?.("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr?.on?.("data", (chunk) => {
      this.stderr = truncateTail(`${this.stderr}${chunk}`, 4_000);
    });
    this.child.on?.("error", (error) => this.failAll(error));
    this.child.on?.("close", (code, signal) => {
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
      error: { code, message },
    });
  }

  stop(signal = "SIGTERM") {
    for (const waiter of this.pendingRequests.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("Cursor ACP client stopped."));
    }
    this.pendingRequests.clear();
    try {
      this.child?.kill?.(signal);
    } catch {
      // Process may already have exited.
    }
    this.child = null;
    this.closed = true;
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
        this.rejectRequest(frame.id, error?.code || -32603, error?.message || "Cursor ACP request failed.");
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

async function discoverCursorAcpCommand({
  env = process.env,
  fsImpl = fs,
  execFileImpl = execFile,
} = {}) {
  const override = readString(env.REMODEX_CURSOR_ACP_COMMAND);
  const candidates = [
    ...(override ? [parseCommandOverride(override)] : []),
    { command: LOCAL_CURSOR_AGENT_PATH, args: ["acp"], label: "local-agent" },
    { command: "agent", args: ["acp"], label: "path-agent" },
    { command: "cursor-agent", args: ["acp"], label: "path-cursor-agent" },
    { command: CURSOR_APP_CLI_PATH, args: ["agent", "acp"], label: "cursor-app-cli" },
  ];

  const failures = [];
  for (const candidate of candidates) {
    if (candidate.command.startsWith("/") && !fileExists(fsImpl, candidate.command)) {
      failures.push({ label: candidate.label, reason: "missing" });
      continue;
    }
    try {
      const result = await execFileForProbe(execFileImpl, candidate.command, [...candidate.args, "--help"]);
      return {
        ...candidate,
        status: "ready",
        version: await readCursorAgentVersion(candidate, execFileImpl),
        source: candidate.label,
        help: truncateTail(`${result.stdout || ""}${result.stderr || ""}`, 500),
      };
    } catch (error) {
      failures.push({
        label: candidate.label,
        reason: sanitizeErrorMessage(error),
      });
    }
  }

  return {
    status: "not_installed",
    statusMessage: "Install Cursor Agent on this Mac to enable the Cursor runtime.",
    failures,
  };
}

function execFileForProbe(execFileImpl, command, args) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, {
      timeout: 3_000,
      maxBuffer: 128 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function readCursorAgentVersion(candidate, execFileImpl) {
  try {
    const versionArgs = candidate.label === "cursor-app-cli"
      ? ["agent", "--version"]
      : ["--version"];
    const result = await execFileForProbe(execFileImpl, candidate.command, versionArgs);
    return readString(result.stdout || result.stderr);
  } catch {
    return "";
  }
}

function parseCommandOverride(value) {
  const parts = readString(value).split(/\s+/).filter(Boolean);
  return {
    command: parts[0],
    args: parts.slice(1),
    label: "env-override",
  };
}

function safeParseJSON(rawValue) {
  try {
    return JSON.parse(String(rawValue || ""));
  } catch {
    return null;
  }
}

function fileExists(fsImpl, filePath) {
  try {
    return fsImpl.existsSync(filePath);
  } catch {
    return false;
  }
}

function sanitizeErrorMessage(error) {
  if (error?.code === "ENOENT") {
    return "missing";
  }
  return truncateTail(String(error?.message || error || "probe failed"), 240);
}

function truncateTail(value, maxChars) {
  const text = String(value || "");
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  CURSOR_APP_CLI_PATH,
  LOCAL_CURSOR_AGENT_PATH,
  createCursorAcpClient,
  discoverCursorAcpCommand,
};
