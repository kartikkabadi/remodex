// FILE: resolvedParam.test.js
// Purpose: Tests for the resolvedParam normalization helper.
// Layer: Bridge test

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolvedParam } = require("../src/normalize");

describe("resolvedParam", () => {
  it("returns the value of a single matching key", () => {
    assert.strictEqual(resolvedParam({ cwd: "/home/project" }, "cwd"), "/home/project");
  });

  it("falls back to the second key when the first is missing", () => {
    assert.strictEqual(
      resolvedParam({ current_working_directory: "/alt" }, "cwd", "current_working_directory"),
      "/alt",
    );
  });

  it("falls back to the third key when the first two are missing", () => {
    assert.strictEqual(
      resolvedParam({ working_directory: "/third" }, "cwd", "current_working_directory", "working_directory"),
      "/third",
    );
  });

  it("skips empty-string values and falls through to the next key", () => {
    assert.strictEqual(
      resolvedParam({ cwd: "", current_working_directory: "/real" }, "cwd", "current_working_directory"),
      "/real",
    );
  });

  it("skips whitespace-only string values and falls through", () => {
    assert.strictEqual(
      resolvedParam({ cwd: "   ", current_working_directory: "/real" }, "cwd", "current_working_directory"),
      "/real",
    );
  });

  it("returns the first truthy value even when later keys also exist", () => {
    assert.strictEqual(
      resolvedParam(
        { cwd: "/first", current_working_directory: "/second" },
        "cwd",
        "current_working_directory",
      ),
      "/first",
    );
  });

  it("returns empty string when params is undefined", () => {
    assert.strictEqual(resolvedParam(undefined, "cwd", "current_working_directory"), "");
  });

  it("returns empty string when params is null", () => {
    assert.strictEqual(resolvedParam(null, "cwd", "current_working_directory"), "");
  });

  it("returns empty string when no keys match", () => {
    assert.strictEqual(resolvedParam({}, "cwd", "current_working_directory"), "");
  });

  it("returns empty string when all matched keys have empty-string values", () => {
    assert.strictEqual(
      resolvedParam({ cwd: "", current_working_directory: "" }, "cwd", "current_working_directory"),
      "",
    );
  });

  it("returns empty string when all matched keys have whitespace-only values", () => {
    assert.strictEqual(
      resolvedParam({ cwd: "   ", current_working_directory: "\t" }, "cwd", "current_working_directory"),
      "",
    );
  });

  it("returns empty string when no keys are provided", () => {
    assert.strictEqual(resolvedParam({ cwd: "/exists" }), "");
  });

  it("resolves threadId / thread_id / id fallback", () => {
    assert.strictEqual(
      resolvedParam({ threadId: "t1" }, "threadId", "thread_id", "id"),
      "t1",
    );
    assert.strictEqual(
      resolvedParam({ thread_id: "t2" }, "threadId", "thread_id", "id"),
      "t2",
    );
    assert.strictEqual(
      resolvedParam({ id: "t3" }, "threadId", "thread_id", "id"),
      "t3",
    );
  });

  it("resolves sessionId / session_id fallback", () => {
    assert.strictEqual(
      resolvedParam({ sessionId: "s1" }, "sessionId", "session_id"),
      "s1",
    );
    assert.strictEqual(
      resolvedParam({ session_id: "s2" }, "sessionId", "session_id"),
      "s2",
    );
  });

  it("resolves name / title fallback", () => {
    assert.strictEqual(resolvedParam({ name: "n1" }, "name", "title"), "n1");
    assert.strictEqual(resolvedParam({ title: "t1" }, "name", "title"), "t1");
  });

  it("resolves sortDirection / sort_direction fallback", () => {
    assert.strictEqual(
      resolvedParam({ sortDirection: "asc" }, "sortDirection", "sort_direction"),
      "asc",
    );
    assert.strictEqual(
      resolvedParam({ sort_direction: "desc" }, "sortDirection", "sort_direction"),
      "desc",
    );
  });

  it("resolves reasoningEffort / reasoning_effort / effort fallback", () => {
    assert.strictEqual(
      resolvedParam({ reasoningEffort: "high" }, "reasoningEffort", "reasoning_effort", "effort"),
      "high",
    );
    assert.strictEqual(
      resolvedParam({ reasoning_effort: "medium" }, "reasoningEffort", "reasoning_effort", "effort"),
      "medium",
    );
    assert.strictEqual(
      resolvedParam({ effort: "low" }, "reasoningEffort", "reasoning_effort", "effort"),
      "low",
    );
  });

  it("resolves agent / mode fallback", () => {
    assert.strictEqual(resolvedParam({ agent: "build" }, "agent", "mode"), "build");
    assert.strictEqual(resolvedParam({ mode: "plan" }, "agent", "mode"), "plan");
  });

  it("resolves image path/url fallback", () => {
    assert.strictEqual(
      resolvedParam({ path: "/img.png" }, "path", "url", "image_url", "dataURL"),
      "/img.png",
    );
    assert.strictEqual(
      resolvedParam({ url: "https://example.com/img.png" }, "path", "url", "image_url", "dataURL"),
      "https://example.com/img.png",
    );
    assert.strictEqual(
      resolvedParam({ image_url: "https://example.com/img2.png" }, "path", "url", "image_url", "dataURL"),
      "https://example.com/img2.png",
    );
    assert.strictEqual(
      resolvedParam({ dataURL: "data:image/png;base64,..." }, "path", "url", "image_url", "dataURL"),
      "data:image/png;base64,...",
    );
  });
});
