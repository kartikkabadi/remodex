// FILE: project-registry.test.js
// Purpose: Verifies registry allowlist gating and chmod 600 on known-projects.json writes.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProjectRegistry } = require("../src/project-registry");

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "remodex-project-registry-"));
}

function makeRegistry(homeDir) {
  const storagePath = path.join(homeDir, "remodex", "known-projects.json");
  return createProjectRegistry({ storagePath, homeDir });
}

test("rememberProjectPath skips paths outside the home root", () => {
  const homeDir = makeTempHome();
  const registry = makeRegistry(homeDir);
  const allowedDir = path.join(homeDir, "workspace", "allowed");
  fs.mkdirSync(allowedDir, { recursive: true });

  const allowed = registry.rememberProjectPath(allowedDir, {
    source: "test",
    provider: "codex",
  });
  const blocked = registry.rememberProjectPath("/etc/passwd", {
    source: "test",
    provider: "codex",
  });

  assert.ok(allowed);
  assert.equal(blocked, null);
  assert.equal(registry.listProjects().length, 1);
  assert.equal(registry.listProjects()[0].path, fs.realpathSync(allowedDir));
});

test("rememberProjectsFromThreads filters disallowed cwd values", () => {
  const homeDir = makeTempHome();
  const registry = makeRegistry(homeDir);
  const allowedDir = path.join(homeDir, "projects", "demo");
  fs.mkdirSync(allowedDir, { recursive: true });

  const remembered = registry.rememberProjectsFromThreads(
    [
      { cwd: allowedDir, modelProvider: "codex" },
      { cwd: "/var/tmp/outside-home", modelProvider: "opencode" },
    ],
    { source: "thread-list" },
  );

  assert.equal(remembered.length, 1);
  assert.equal(remembered[0].path, fs.realpathSync(allowedDir));
  assert.equal(registry.listProjects().length, 1);
});

test("rememberProjectPath rejects symlink targets outside the home root", () => {
  const homeDir = makeTempHome();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-outside-"));
  const linkPath = path.join(homeDir, "escape-link");
  fs.symlinkSync(outsideDir, linkPath, "dir");

  const registry = makeRegistry(homeDir);
  const remembered = registry.rememberProjectPath(linkPath, {
    source: "test",
    provider: "opencode",
  });

  assert.equal(remembered, null);
  assert.equal(registry.listProjects().length, 0);
});

test("writeRegistryState persists known-projects.json with mode 0o600", () => {
  const homeDir = makeTempHome();
  const registry = makeRegistry(homeDir);
  const projectDir = path.join(homeDir, "workspace", "secure-repo");
  fs.mkdirSync(projectDir, { recursive: true });

  registry.rememberProjectPath(projectDir, {
    source: "test",
    provider: "codex",
  });

  const mode = fs.statSync(registry.storagePath).mode & 0o777;
  assert.equal(mode, 0o600);
});