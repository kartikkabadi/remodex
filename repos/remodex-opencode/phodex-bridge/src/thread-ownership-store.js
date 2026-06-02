// FILE: thread-ownership-store.js
// Purpose: Persists durable thread → provider mappings so a thread created in OpenCode
//          remains owned by OpenCode across bridge restarts.
// Layer: Persistence helper
// Exports: createThreadOwnershipStore
// Depends on: os, json-file-store, normalize

const os = require("os");
const { readString } = require("./normalize");
const { createJsonFileStore } = require("./json-file-store");

function createThreadOwnershipStore({
  storagePath = "",
  homeDir = os.homedir(),
  fsImpl,
  nowMs = Date.now,
} = {}) {
  const store = createJsonFileStore({
    filePath: storagePath,
    defaultFileName: "thread-ownership.json",
    homeDir,
    key: "ownership",
    fsImpl,
  });

  let ownership = store.read();
  pruneStaleEntries();

  function setOwnership(threadId, providerId) {
    const normalizedThreadId = readString(threadId);
    const normalizedProviderId = readString(providerId);
    if (!normalizedThreadId || !normalizedProviderId) {
      return false;
    }

    ownership[normalizedThreadId] = {
      providerId: normalizedProviderId,
      assignedAt: new Date(nowMs()).toISOString(),
    };
    store.write(ownership);
    return true;
  }

  function getOwnership(threadId) {
    const normalizedThreadId = readString(threadId);
    return ownership[normalizedThreadId]?.providerId || null;
  }

  function ownsThread(threadId, providerId) {
    const owner = getOwnership(threadId);
    return owner !== null && owner === readString(providerId);
  }

  function removeOwnership(threadId) {
    const normalizedThreadId = readString(threadId);
    if (!normalizedThreadId || !ownership[normalizedThreadId]) {
      return false;
    }

    delete ownership[normalizedThreadId];
    store.write(ownership);
    return true;
  }

  function getAllOwnedBy(providerId) {
    const normalizedProviderId = readString(providerId);
    if (!normalizedProviderId) {
      return [];
    }

    return Object.entries(ownership)
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
    for (const [threadId, entry] of Object.entries(ownership)) {
      const assignedTime = Date.parse(entry?.assignedAt || "");
      if (Number.isFinite(assignedTime) && assignedTime < cutoff) {
        delete ownership[threadId];
        didChange = true;
      }
    }

    if (didChange) {
      store.write(ownership);
    }
    return didChange;
  }

  function size() {
    return Object.keys(ownership).length;
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

module.exports = { createThreadOwnershipStore };
