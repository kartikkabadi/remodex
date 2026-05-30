// FILE: project-registry.test.js
// Purpose: Verifies provider-neutral project registry persistence and rootless filtering.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, fs, os, path, ../src/project-registry

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createProjectRegistry,
  isGeneratedProjectlessPath,
  normalizeProjectPath,
} = require("../src/project-registry");

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "remodex-project-registry-"));
}

function makeRegistry(homeDir) {
  return createProjectRegistry({
    codexHome: path.join(homeDir, ".codex"),
    homeDir,
    storagePath: path.join(homeDir, ".codex", "remodex", "known-projects.json"),
  });
}

test("rememberProjectPath persists and sorts available projects by last activity", () => {
  const homeDir = makeTempHome();
  const olderProject = path.join(homeDir, "older");
  const newerProject = path.join(homeDir, "newer");
  fs.mkdirSync(olderProject);
  fs.mkdirSync(newerProject);

  const registry = makeRegistry(homeDir);
  registry.rememberProjectPath(olderProject, {
    source: "codex-thread-list",
    provider: "codex",
    lastSeenAt: "2026-05-20T10:00:00.000Z",
  });
  registry.rememberProjectPath(newerProject, {
    source: "opencode-session-list",
    provider: "opencode",
    lastSeenAt: "2026-05-21T10:00:00.000Z",
  });

  const projects = registry.listProjects();

  assert.deepEqual(projects.map((project) => project.path), [
    fs.realpathSync(newerProject),
    fs.realpathSync(olderProject),
  ]);
  assert.deepEqual(projects[0].providerHints, ["opencode"]);
});

test("rememberProjectsFromThreads dedupes realpath aliases and keeps source history", () => {
  const homeDir = makeTempHome();
  const targetProject = path.join(homeDir, "ActualRepo");
  const linkedProject = path.join(homeDir, "LinkedRepo");
  fs.mkdirSync(targetProject);
  fs.symlinkSync(targetProject, linkedProject, "dir");

  const registry = makeRegistry(homeDir);
  registry.rememberProjectsFromThreads([
    {
      cwd: targetProject,
      provider: "codex",
      updatedAt: "2026-05-20T10:00:00.000Z",
    },
    {
      cwd: linkedProject,
      modelProvider: "opencode",
      updatedAt: "2026-05-21T10:00:00.000Z",
    },
  ], {
    source: "thread-list",
  });

  const projects = registry.listProjects();

  assert.equal(projects.length, 1);
  assert.equal(projects[0].path, fs.realpathSync(targetProject));
  assert.deepEqual(projects[0].sources, ["thread-list"]);
  assert.deepEqual(projects[0].providerHints, ["codex", "opencode"]);
});

test("registry skips generated projectless chat paths", () => {
  const homeDir = makeTempHome();
  const rootlessProject = path.join(homeDir, "Documents", "Codex", "2026-05-20", "quick-chat");
  const normalProject = path.join(homeDir, "Developer", "app");
  fs.mkdirSync(rootlessProject, { recursive: true });
  fs.mkdirSync(normalProject, { recursive: true });

  const registry = makeRegistry(homeDir);
  assert.equal(registry.rememberProjectPath(rootlessProject, { source: "test" }), null);
  assert.ok(registry.rememberProjectPath(normalProject, { source: "test" }));

  assert.deepEqual(registry.listProjects().map((project) => project.path), [
    fs.realpathSync(normalProject),
  ]);
  assert.equal(isGeneratedProjectlessPath(rootlessProject, { homeDir, codexHome: path.join(homeDir, ".codex") }), true);
});

test("normalizeProjectPath rejects pseudo project buckets", () => {
  const homeDir = makeTempHome();

  assert.equal(normalizeProjectPath("server", { homeDir }), null);
  assert.equal(normalizeProjectPath("_default", { homeDir }), null);
  assert.equal(normalizeProjectPath("~/Developer", { homeDir }), path.join(homeDir, "Developer"));
});
