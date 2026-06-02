// FILE: opencode-session-store.js
// Purpose: Persists durable thread → session mappings so a session created in OpenCode
//          can be resumed across bridge restarts.
// Layer: Persistence helper
// Exports: createOpenCodeSessionStore
// Depends on: os, json-file-store, normalize

const os = require("os");
const { readString } = require("./normalize");
const { createJsonFileStore } = require("./json-file-store");

function createOpenCodeSessionStore({
  storagePath = "",
  homeDir = os.homedir(),
  fsImpl,
  nowMs = Date.now,
} = {}) {
  const store = createJsonFileStore({
    filePath: storagePath,
    defaultFileName: "opencode-sessions.json",
    homeDir,
    key: "sessions",
    fsImpl,
  });

  let sessions = store.read();

  function set(threadId, sessionId, metadata = {}) {
    const normalizedThreadId = readString(threadId);
    const normalizedSessionId = readString(sessionId);
    if (!normalizedThreadId || !normalizedSessionId) {
      return false;
    }

    const previous = sessions[normalizedThreadId] || {};
    const meta = metadata && typeof metadata === "object" ? metadata : {};
    sessions[normalizedThreadId] = {
      sessionId: normalizedSessionId,
      cwd: readString(meta.cwd) || readString(previous.cwd) || "",
      model: readString(meta.model) || readString(previous.model) || "",
      agent: readString(meta.agent) || readString(previous.agent) || "",
      title: readString(meta.title) || readString(previous.title) || "",
      updatedAt: new Date(nowMs()).toISOString(),
    };
    store.write(sessions);
    return true;
  }

  function get(threadId) {
    const normalizedThreadId = readString(threadId);
    return sessions[normalizedThreadId]?.sessionId || null;
  }

  function getEntry(threadId) {
    const normalizedThreadId = readString(threadId);
    if (!normalizedThreadId || !sessions[normalizedThreadId]) {
      return null;
    }
    return { ...sessions[normalizedThreadId] };
  }

  function remove(threadId) {
    const normalizedThreadId = readString(threadId);
    if (!normalizedThreadId || !sessions[normalizedThreadId]) {
      return false;
    }

    delete sessions[normalizedThreadId];
    store.write(sessions);
    return true;
  }

  function entries() {
    return Object.entries(sessions).map(([threadId, entry]) => [threadId, entry]);
  }

  return {
    get,
    getEntry,
    set,
    remove,
    entries,
  };
}

module.exports = { createOpenCodeSessionStore };