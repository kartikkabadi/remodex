// FILE: json-file-store.js
// Purpose: Shared atomic JSON file persistence for domain stores.
//          Extracted from thread-ownership-store and opencode-session-store.
// Layer: Persistence helper
// Exports: createJsonFileStore
// Depends on: fs, os, path, normalize

const fs = require("fs");
const os = require("os");
const path = require("path");
const { readString } = require("./normalize");

function createJsonFileStore({
  filePath = "",
  defaultFileName,
  homeDir = os.homedir(),
  key,
  fsImpl = fs,
} = {}) {
  const resolvedHome = path.resolve(homeDir);
  const resolvedPath =
    readString(filePath) || path.join(resolvedHome, ".remodex", defaultFileName);

  function resolvePath() {
    return resolvedPath;
  }

  function read() {
    try {
      const raw = fsImpl.readFileSync(resolvedPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const value = parsed[key];
        return typeof value === "object" && !Array.isArray(value) ? value : {};
      }
    } catch {
      // File doesn't exist yet or is corrupted; start fresh.
    }
    return {};
  }

  function write(value) {
    const normalized =
      typeof value === "object" && !Array.isArray(value) ? value : {};
    const state = { [key]: normalized };
    const directory = path.dirname(resolvedPath);
    fsImpl.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      fsImpl.chmodSync(directory, 0o700);
    } catch {
      // Best-effort on platforms that restrict chmod.
    }
    const tempPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
    fsImpl.writeFileSync(
      tempPath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );
    fsImpl.renameSync(tempPath, resolvedPath);
  }

  return { resolvePath, read, write };
}

module.exports = { createJsonFileStore };
