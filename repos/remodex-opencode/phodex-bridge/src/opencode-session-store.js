// FILE: opencode-session-store.js
// Purpose: Persists durable thread → session mappings so a session created in OpenCode
//          can be resumed across bridge restarts.
// Layer: Persistence helper
// Exports: createOpenCodeSessionStore
// Depends on: fs, os, path

const fs = require("fs");
const os = require("os");
const path = require("path");
const { readString } = require("./normalize");

function createOpenCodeSessionStore({
  storagePath = "",
  homeDir = os.homedir(),
  fsImpl = fs,
  nowMs = Date.now,
} = {}) {
  const resolvedPath = resolveStoragePath(storagePath, homeDir);
  let state = readSessionState(resolvedPath, fsImpl);

  function set(threadId, sessionId) {
    const normalizedThreadId = readString(threadId);
    const normalizedSessionId = readString(sessionId);
    if (!normalizedThreadId || !normalizedSessionId) {
      return false;
    }

    state.sessions[normalizedThreadId] = {
      sessionId: normalizedSessionId,
      updatedAt: new Date(nowMs()).toISOString(),
    };
    writeSessionState(resolvedPath, state, fsImpl);
    return true;
  }

  function get(threadId) {
    const normalizedThreadId = readString(threadId);
    return state.sessions[normalizedThreadId]?.sessionId || null;
  }

  function remove(threadId) {
    const normalizedThreadId = readString(threadId);
    if (!normalizedThreadId || !state.sessions[normalizedThreadId]) {
      return false;
    }

    delete state.sessions[normalizedThreadId];
    writeSessionState(resolvedPath, state, fsImpl);
    return true;
  }

  function entries() {
    return Object.entries(state.sessions).map(([threadId, entry]) => [
      threadId,
      entry.sessionId,
    ]);
  }

  return {
    get,
    set,
    remove,
    entries,
  };
}

function resolveStoragePath(storagePath, homeDir) {
  const resolvedHome = path.resolve(homeDir);
  return readString(storagePath) || path.join(resolvedHome, ".remodex", "opencode-sessions.json");
}

function readSessionState(filePath, fsImpl) {
  try {
    const raw = fsImpl.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return normalizeSessionState(parsed);
    }
  } catch {
    // File doesn't exist yet or is corrupted; start fresh.
  }
  return emptySessionState();
}

function writeSessionState(filePath, state, fsImpl) {
  const normalizedState = normalizeSessionState(state);
  const directory = path.dirname(filePath);
  fsImpl.mkdirSync(directory, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fsImpl.writeFileSync(tempPath, `${JSON.stringify(normalizedState, null, 2)}\n`, "utf8");
  fsImpl.renameSync(tempPath, filePath);
}

function normalizeSessionState(state) {
  return {
    sessions:
      state.sessions && typeof state.sessions === "object" && !Array.isArray(state.sessions)
        ? state.sessions
        : {},
  };
}

function emptySessionState() {
  return { sessions: {} };
}

module.exports = { createOpenCodeSessionStore };
