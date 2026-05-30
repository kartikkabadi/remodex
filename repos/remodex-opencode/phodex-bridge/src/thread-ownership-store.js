// FILE: thread-ownership-store.js
// Purpose: Persists durable thread → provider mappings so a thread created in OpenCode
//          remains owned by OpenCode across bridge restarts.
// Layer: Persistence helper
// Exports: createThreadOwnershipStore
// Depends on: fs, os, path

const fs = require("fs");
const os = require("os");
const path = require("path");

function createThreadOwnershipStore({
  storagePath = "",
  homeDir = os.homedir(),
  fsImpl = fs,
  nowMs = Date.now,
} = {}) {
  const resolvedPath = resolveStoragePath(storagePath, homeDir);
  let state = readOwnershipState(resolvedPath, fsImpl);

  function setOwnership(threadId, providerId) {
    const normalizedThreadId = readString(threadId);
    const normalizedProviderId = readString(providerId);
    if (!normalizedThreadId || !normalizedProviderId) {
      return false;
    }

    state.ownership[normalizedThreadId] = {
      providerId: normalizedProviderId,
      assignedAt: new Date(nowMs()).toISOString(),
    };
    writeOwnershipState(resolvedPath, state, fsImpl);
    return true;
  }

  function getOwnership(threadId) {
    const normalizedThreadId = readString(threadId);
    return state.ownership[normalizedThreadId]?.providerId || null;
  }

  function ownsThread(threadId, providerId) {
    const owner = getOwnership(threadId);
    return owner !== null && owner === readString(providerId);
  }

  function removeOwnership(threadId) {
    const normalizedThreadId = readString(threadId);
    if (!normalizedThreadId || !state.ownership[normalizedThreadId]) {
      return false;
    }

    delete state.ownership[normalizedThreadId];
    writeOwnershipState(resolvedPath, state, fsImpl);
    return true;
  }

  function getAllOwnedBy(providerId) {
    const normalizedProviderId = readString(providerId);
    if (!normalizedProviderId) {
      return [];
    }

    return Object.entries(state.ownership)
      .filter(([, entry]) => entry?.providerId === normalizedProviderId)
      .map(([threadId, entry]) => ({
        threadId,
        providerId: entry.providerId,
        assignedAt: entry.assignedAt,
      }));
  }

  function pruneStaleEntries(staleMs = 30 * 24 * 60 * 60 * 1000) {
    const cutoff = nowMs() - staleMs;
    let didChange = false;
    for (const [threadId, entry] of Object.entries(state.ownership)) {
      const assignedTime = Date.parse(entry?.assignedAt || "");
      if (Number.isFinite(assignedTime) && assignedTime < cutoff) {
        delete state.ownership[threadId];
        didChange = true;
      }
    }

    if (didChange) {
      writeOwnershipState(resolvedPath, state, fsImpl);
    }
    return didChange;
  }

  function size() {
    return Object.keys(state.ownership).length;
  }

  return {
    getOwnership,
    getAllOwnedBy,
    ownsThread,
    pruneStaleEntries,
    removeOwnership,
    setOwnership,
    size,
  };
}

function resolveStoragePath(storagePath, homeDir) {
  const resolvedHome = path.resolve(homeDir);
  return readString(storagePath) || path.join(resolvedHome, ".remodex", "thread-ownership.json");
}

function readOwnershipState(filePath, fsImpl) {
  try {
    const raw = fsImpl.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return normalizeOwnershipState(parsed);
    }
  } catch {
    // File doesn't exist yet or is corrupted; start fresh.
  }
  return emptyOwnershipState();
}

function writeOwnershipState(filePath, state, fsImpl) {
  const normalizedState = normalizeOwnershipState(state);
  const directory = path.dirname(filePath);
  fsImpl.mkdirSync(directory, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fsImpl.writeFileSync(tempPath, `${JSON.stringify(normalizedState, null, 2)}\n`, "utf8");
  fsImpl.renameSync(tempPath, filePath);
}

function normalizeOwnershipState(state) {
  return {
    ownership: state.ownership && typeof state.ownership === "object" && !Array.isArray(state.ownership)
      ? state.ownership
      : {},
  };
}

function emptyOwnershipState() {
  return { ownership: {} };
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = { createThreadOwnershipStore };
