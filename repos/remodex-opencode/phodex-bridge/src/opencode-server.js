// FILE: opencode-server.js
// Purpose: Manages the `opencode serve` HTTP server lifecycle. Spawns, health-checks,
//          and shuts down an opencode HTTP process used by the SDK client.
// Layer: Transport adapter
// Exports: createOpenCodeServer
// Depends on: child_process, http

const { readString } = require("./normalize");
const { spawn } = require("child_process");
const http = require("http");

const START_TIMEOUT_MS = 15_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const HEALTH_TIMEOUT_MS = 5_000;
const PORT_RANGE_START = 4200;

function createOpenCodeServer({
  env = process.env,
  spawnImpl = spawn,
  httpGetImpl = null,
  logPrefix = "[remodex]",
  port = 0,
} = {}) {
  let child = null;
  let baseUrl = "";
  let version = "";
  let started = false;
  let stopping = false;

  function start({ cwd = process.cwd(), extraArgs = [] } = {}) {
    if (child) {
      return Promise.resolve();
    }

    const command = readString(env.REMODEX_OPENCODE_COMMAND) || "opencode";
    let resolvedPort = port;
    if (!resolvedPort || resolvedPort <= 0) {
      resolvedPort = PORT_RANGE_START;
    }
    const args = ["serve", "--hostname=127.0.0.1", `--port=${resolvedPort}`, ...extraArgs];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        const err = new Error(`OpenCode serve did not start within ${START_TIMEOUT_MS / 1000}s.`);
        err.errorCode = "opencode_server_failed";
        reject(err);
      }, START_TIMEOUT_MS);

      try {
        child = spawnImpl(command, args, {
          env: { ...env },
          stdio: ["pipe", "pipe", "pipe"],
          cwd,
        });
      } catch (error) {
        clearTimeout(timeout);
        cleanup();
        const err = new Error(`Failed to spawn OpenCode serve: ${error.message}`);
        err.errorCode = "opencode_server_failed";
        err.cause = error;
        reject(err);
        return;
      }

      let stdoutBuffer = "";

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdoutBuffer += String(chunk);
        const match = stdoutBuffer.match(/opencode server listening on (https?:\/\/[^\s]+)/i);
        if (match && match[1]) {
          baseUrl = match[1].replace(/\/+$/, "");
          clearTimeout(timeout);
          waitForHealthy()
            .then(() => {
              started = true;
              console.log(`${logPrefix} OpenCode serve ready at ${baseUrl}`);
              resolve();
            })
            .catch((err) => {
              cleanup();
              reject(err);
            });
        }
      });

      child.stderr.on("data", (chunk) => {
        if (readString(env.REMODEX_DIAGNOSTICS) === "1") {
          process.stderr.write(`${logPrefix} [opencode stderr] ${String(chunk)}`);
        }
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        cleanup();
        const err = new Error(`OpenCode serve process error: ${error.message}`);
        err.errorCode = "opencode_server_failed";
        err.cause = error;
        reject(err);
      });

      child.on("close", (code) => {
        if (!stopping) {
          console.warn(`${logPrefix} OpenCode serve exited unexpectedly (code ${code}).`);
        }
        clearTimeout(timeout);
        child = null;
        started = false;
      });
    });
  }

  function waitForHealthy() {
    return new Promise((resolve, reject) => {
      const check = (attempt = 0) => {
        if (!baseUrl) {
          reject(new Error("No base URL available for health check."));
          return;
        }

        if (httpGetImpl) {
          httpGetImpl(`${baseUrl}/health`)
            .then(({ ok, version: v }) => {
              if (ok) {
                if (readString(v)) version = readString(v);
                resolve();
              } else {
                reject(new Error("OpenCode health check returned not-ok."));
              }
            })
            .catch(() => {
              if (attempt > 30) {
                reject(new Error("OpenCode health check timed out."));
                return;
              }
              setTimeout(() => check(attempt + 1), 500);
            });
          return;
        }

        const req = http.get(`${baseUrl}/health`, { timeout: HEALTH_TIMEOUT_MS }, (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(body);
              if (parsed.ok !== true) {
                reject(new Error("OpenCode health check returned not-ok."));
                return;
              }
              if (readString(parsed.version)) {
                version = readString(parsed.version);
              }
              resolve();
            } catch (e) {
              reject(new Error(`OpenCode health check failed: ${e.message}`));
            }
          });
        });

        req.on("error", () => {
          if (attempt > 30) {
            reject(new Error("OpenCode health check timed out."));
            return;
          }
          setTimeout(() => check(attempt + 1), 500);
        });
        req.on("timeout", () => {
          req.destroy();
          if (attempt > 30) {
            reject(new Error("OpenCode health check timed out."));
            return;
          }
          setTimeout(() => check(attempt + 1), 500);
        });
      };

      check(0);
    });
  }

  function stop() {
    stopping = true;
    if (!child) {
      stopping = false;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const killed = setTimeout(() => {
        if (child && !child.killed) {
          try {
            child.kill("SIGKILL");
          } catch {}
        }
        child = null;
        started = false;
        stopping = false;
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);

      child.on("close", () => {
        clearTimeout(killed);
        child = null;
        started = false;
        stopping = false;
        resolve();
      });

      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(killed);
        child = null;
        started = false;
        stopping = false;
        resolve();
      }
    });
  }

  function cleanup() {
    stopping = true;
    if (child) {
      try {
        child.kill("SIGTERM");
      } catch {}
      child = null;
    }
    started = false;
    stopping = false;
  }

  return {
    get baseUrl() {
      return baseUrl;
    },
    get version() {
      return version;
    },
    get isRunning() {
      return started && child !== null;
    },
    start,
    stop,
  };
}

module.exports = { createOpenCodeServer };
