// FILE: bridge.test.js
// Purpose: Verifies relay watchdog helpers used to recover from stale sleep/wake sockets.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, fs, os, path, ../src/bridge

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildHeartbeatBridgeStatus,
  createMacOSBridgeWakeAssertion,
  disableUnsupportedReasoningSummaryForTurnStart,
  fetchAdaptiveThreadTurnsListForRelay,
  hasRelayConnectionGoneStale,
  normalizeRelayBoundJsonRpcMessage,
  persistBridgePreferences,
  sanitizeLiveGeneratedImageMessageForRelay,
  sanitizeThreadHistoryImagesForRelay,
} = require("../src/bridge");
const {
  buildTelegramApprovalResponseResult,
  buildTelegramCheckpointRestoreApplyParams,
  buildTelegramCollaborationModePayload,
  buildTelegramCodexInputRequest,
  buildTelegramManualCheckpointRef,
  buildTelegramReviewStartParams,
  buildTelegramRuntimeRequestAttempts,
  buildTelegramThreadForkParams,
  buildTelegramThreadResumeParams,
  buildTelegramThreadStartParams,
  extractTelegramTitleSeedText,
  filterTelegramThreads,
  isTelegramMissingRolloutError,
  normalizeTelegramCreatedThread,
  normalizeTelegramForkedThread,
  normalizeTelegramWorktreeThreadResult,
  summarizeTelegramDiff,
  summarizeTelegramThreadActivity,
} = require("../src/telegram-bridge-protocol");

function expectedGeneratedImagePath(threadId, fileName) {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "generated_images", threadId, fileName);
}

test("hasRelayConnectionGoneStale returns true once the relay silence crosses the timeout", () => {
  assert.equal(
    hasRelayConnectionGoneStale(1_000, {
      now: 26_000,
      staleAfterMs: 25_000,
    }),
    true
  );
});

test("buildTelegramCodexInputRequest starts idle active-thread input", () => {
  assert.deepEqual(
    buildTelegramCodexInputRequest({
      threadId: "thread-idle",
      text: "Ship the Telegram slice",
      threadPayload: {
        thread: {
          id: "thread-idle",
          turns: [{ id: "turn-old", status: "completed" }],
        },
      },
    }),
    {
      method: "turn/start",
      params: {
        threadId: "thread-idle",
        model: "gpt-5.5",
        effort: "medium",
        input: [{ type: "text", text: "Ship the Telegram slice" }],
      },
    }
  );
});

test("buildTelegramCodexInputRequest includes Telegram image input attachments", () => {
  assert.deepEqual(
    buildTelegramCodexInputRequest({
      threadId: "thread-image",
      text: "What changed in this screenshot?",
      attachments: [
        {
          type: "input_image",
          image_url: "data:image/png;base64,AAAA",
          detail: "high",
        },
        {
          type: "input_image",
          image_url: { url: "data:image/jpeg;base64,BBBB" },
        },
      ],
      threadPayload: {
        thread: {
          id: "thread-image",
          turns: [],
        },
      },
    }),
    {
      method: "turn/start",
      params: {
        threadId: "thread-image",
        model: "gpt-5.5",
        effort: "medium",
        input: [
          { type: "text", text: "What changed in this screenshot?" },
          { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "high" },
          { type: "input_image", image_url: "data:image/jpeg;base64,BBBB" },
        ],
      },
    }
  );
});

test("buildTelegramCodexInputRequest applies Telegram runtime preferences for idle turns", () => {
  assert.deepEqual(
    buildTelegramCodexInputRequest({
      threadId: "thread-runtime",
      text: "Use the selected runtime",
      runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high", serviceTier: "fast" },
      threadPayload: {
        thread: {
          id: "thread-runtime",
          turns: [],
        },
      },
    }),
    {
      method: "turn/start",
      params: {
        threadId: "thread-runtime",
        model: "gpt-5.4-mini",
        effort: "high",
        serviceTier: "fast",
        input: [{ type: "text", text: "Use the selected runtime" }],
      },
    }
  );
});

test("buildTelegramCodexInputRequest can start a native plan-mode turn", () => {
  assert.deepEqual(
    buildTelegramCollaborationModePayload({
      mode: "plan",
      runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high" },
    }),
    {
      mode: "plan",
      settings: {
        model: "gpt-5.4-mini",
        reasoning_effort: "high",
        developer_instructions: null,
      },
    }
  );
  assert.deepEqual(
    buildTelegramCodexInputRequest({
      threadId: "thread-plan",
      text: "Plan the Telegram hardening work",
      collaborationMode: "plan",
      runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high" },
      threadPayload: {
        thread: {
          id: "thread-plan",
          turns: [],
        },
      },
    }),
    {
      method: "turn/start",
      params: {
        threadId: "thread-plan",
        model: "gpt-5.4-mini",
        effort: "high",
        input: [{ type: "text", text: "Plan the Telegram hardening work" }],
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-5.4-mini",
            reasoning_effort: "high",
            developer_instructions: null,
          },
        },
      },
    }
  );
});

test("buildTelegram thread runtime params mirror Remodex app defaults", () => {
  assert.deepEqual(
    buildTelegramThreadStartParams({ cwd: "/Users/me/work/app" }),
    {
      model: "gpt-5.5",
      cwd: "/Users/me/work/app",
    }
  );
  assert.deepEqual(
    buildTelegramThreadResumeParams({ threadId: "thread-1", cwd: "/Users/me/work/app" }),
    {
      threadId: "thread-1",
      model: "gpt-5.5",
      cwd: "/Users/me/work/app",
      excludeTurns: true,
    }
  );
  assert.deepEqual(
    buildTelegramThreadResumeParams({ threadId: "thread-1", excludeTurns: false }),
    {
      threadId: "thread-1",
      model: "gpt-5.5",
    }
  );
});

test("buildTelegram thread runtime params accept Telegram runtime preferences", () => {
  assert.deepEqual(
    buildTelegramThreadStartParams({
      cwd: "/Users/me/work/app",
      runtimePreferences: { model: "gpt-5.3-codex-spark", reasoningEffort: "low", serviceTier: "fast" },
    }),
    {
      model: "gpt-5.3-codex-spark",
      serviceTier: "fast",
      cwd: "/Users/me/work/app",
    }
  );
  assert.deepEqual(
    buildTelegramThreadResumeParams({
      threadId: "thread-1",
      runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high", serviceTier: "fast" },
    }),
    {
      threadId: "thread-1",
      model: "gpt-5.4-mini",
      serviceTier: "fast",
      excludeTurns: true,
    }
  );
});

test("buildTelegramThreadForkParams uses native thread/fork minimal payload", () => {
  assert.deepEqual(
    buildTelegramThreadForkParams({ threadId: "thread-1" }),
    {
      threadId: "thread-1",
      excludeTurns: true,
    }
  );
  assert.deepEqual(
    buildTelegramThreadForkParams({ threadId: "thread-1", excludeTurns: false }),
    {
      threadId: "thread-1",
    }
  );
});

test("summarizeTelegramDiff returns file-level stats without patch contents", () => {
  assert.deepEqual(
    summarizeTelegramDiff({
      patch: [
        "diff --git a/src/app.js b/src/app.js",
        "index 111..222 100644",
        "--- a/src/app.js",
        "+++ b/src/app.js",
        "@@ -1,2 +1,3 @@",
        "-old",
        "+new",
        "+next",
        " context",
        "diff --git a/.env.local b/.env.local",
        "index 333..444 100644",
        "--- a/.env.local",
        "+++ b/.env.local",
        "@@ -1 +1 @@",
        "-TOKEN=old",
        "+TOKEN=new",
        "diff --git a/assets/icon.png b/assets/icon.png",
        "Binary files a/assets/icon.png and b/assets/icon.png differ",
      ].join("\n"),
    }),
    {
      changedFiles: 3,
      additions: 3,
      deletions: 2,
      files: [
        { path: "src/app.js", additions: 2, deletions: 1, binary: false },
        { path: ".env.local", additions: 1, deletions: 1, binary: false },
        { path: "assets/icon.png", additions: 0, deletions: 0, binary: true },
      ],
    }
  );
});

test("summarizeTelegramThreadActivity returns compact recent user and assistant messages", () => {
  const activity = summarizeTelegramThreadActivity({
    data: [
      {
        id: "turn-new",
        items: [
          {
            id: "user-new",
            type: "user_message",
            text: "Inspect this screenshot data:image/png;base64,AAAA and use Bearer super-secret-token",
          },
          {
            id: "assistant-new",
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "I found the issue in the Telegram adapter." }],
          },
          {
            id: "tool-call",
            type: "tool_call",
            name: "exec_command",
            arguments: { cmd: "cat .env" },
          },
          {
            id: "tool-output",
            type: "tool_call_output",
            output: "TOKEN=should-not-render",
          },
        ],
      },
    ],
  });

  assert.deepEqual(activity, {
    entries: [
      {
        role: "user",
        text: "Inspect this screenshot [attachment] and use Bearer [redacted]",
        turnId: "turn-new",
      },
      {
        role: "assistant",
        text: "I found the issue in the Telegram adapter.",
        turnId: "turn-new",
      },
      {
        role: "tool",
        text: "Ran exec_command",
        turnId: "turn-new",
      },
    ],
    omittedEntryCount: 0,
  });
  assert.doesNotMatch(JSON.stringify(activity), /TOKEN=should-not-render|super-secret-token|base64,AAAA|cat \.env/);
});

test("extractTelegramTitleSeedText reads the first user message for Telegram title generation", () => {
  assert.equal(
    extractTelegramTitleSeedText({
      data: [
        {
          items: [
            { role: "assistant", text: "Sure." },
            { role: "user", text: "Please make the Telegram title generation flow less awkward." },
          ],
        },
      ],
    }),
    "Please make the Telegram title generation flow less awkward."
  );
  assert.equal(extractTelegramTitleSeedText({ data: [{ items: [{ role: "assistant", text: "Done." }] }] }), "");
});

test("buildTelegramManualCheckpointRef stays inside the Remodex checkpoint namespace", () => {
  assert.equal(
    buildTelegramManualCheckpointRef("thread/with spaces", () => 1234, () => "safe_1"),
    "refs/remodex/checkpoints/dGhyZWFkL3dpdGggc3BhY2Vz/telegram-manual/1234-safe_1"
  );
  assert.throws(
    () => buildTelegramManualCheckpointRef(""),
    /thread id is required/
  );
});

test("buildTelegramCheckpointRestoreApplyParams requires explicit destructive restore confirmation", () => {
  assert.deepEqual(
    buildTelegramCheckpointRestoreApplyParams({
      threadId: "thread-1",
      cwd: "/Users/me/work/app",
      checkpointRef: "refs/remodex/checkpoints/thread/telegram-manual/1",
      expectedTargetCommit: "abcdef1234567890",
    }),
    {
      threadId: "thread-1",
      cwd: "/Users/me/work/app",
      targetCheckpointRef: "refs/remodex/checkpoints/thread/telegram-manual/1",
      expectedTargetCommit: "abcdef1234567890",
      confirmDestructiveRestore: true,
    }
  );
  assert.throws(
    () => buildTelegramCheckpointRestoreApplyParams({ checkpointRef: "refs/remodex/checkpoints/thread/telegram-manual/1" }),
    /thread id is required/
  );
  assert.throws(
    () => buildTelegramCheckpointRestoreApplyParams({ threadId: "thread-1" }),
    /checkpoint ref is required/
  );
});

test("buildTelegramRuntimeRequestAttempts retries app-style runtime compatibility envelopes", () => {
  assert.deepEqual(
    buildTelegramRuntimeRequestAttempts({ threadId: "thread-1" }),
    [
      {
        threadId: "thread-1",
        sandboxPolicy: {
          type: "workspaceWrite",
          networkAccess: true,
        },
        approvalPolicy: "on-request",
      },
      {
        threadId: "thread-1",
        sandboxPolicy: {
          type: "workspaceWrite",
          networkAccess: true,
        },
        approvalPolicy: "onRequest",
      },
      {
        threadId: "thread-1",
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
      },
      {
        threadId: "thread-1",
        sandbox: "workspace-write",
        approvalPolicy: "onRequest",
      },
      { threadId: "thread-1" },
    ]
  );
});

test("buildTelegramRuntimeRequestAttempts can fall back when plan mode is unsupported", () => {
  const attempts = buildTelegramRuntimeRequestAttempts({
    threadId: "thread-plan",
    input: [{ type: "text", text: "Plan this" }],
    collaborationMode: { mode: "plan", settings: { model: "gpt-5.5" } },
  }, {
    allowCollaborationModeFallback: true,
  });

  assert.equal(attempts.length, 8);
  assert.equal(attempts[0].collaborationMode.mode, "plan");
  assert.equal(attempts[4].collaborationMode.mode, "plan");
  assert.equal(attempts[5].collaborationMode, undefined);
  assert.equal(attempts[5].threadId, "thread-plan");
  assert.equal(attempts[7].collaborationMode, undefined);
});

test("buildTelegramRuntimeRequestAttempts can fall back when service tier is unsupported", () => {
  const attempts = buildTelegramRuntimeRequestAttempts({
    threadId: "thread-fast",
    input: [{ type: "text", text: "Fast please" }],
    serviceTier: "fast",
  });

  assert.equal(attempts.length, 10);
  assert.equal(attempts[0].serviceTier, "fast");
  assert.equal(attempts[4].serviceTier, "fast");
  assert.equal(attempts[5].serviceTier, undefined);
  assert.equal(attempts[9].serviceTier, undefined);
});

test("buildTelegramRuntimeRequestAttempts maps Telegram full access to native runtime access mode", () => {
  assert.deepEqual(
    buildTelegramRuntimeRequestAttempts({ threadId: "thread-full" }, { accessMode: "full-access" }),
    [
      {
        threadId: "thread-full",
        sandboxPolicy: { type: "dangerFullAccess" },
        approvalPolicy: "never",
      },
      {
        threadId: "thread-full",
        sandboxPolicy: { type: "dangerFullAccess" },
        approvalPolicy: "never",
      },
      {
        threadId: "thread-full",
        sandbox: "danger-full-access",
        approvalPolicy: "never",
      },
      {
        threadId: "thread-full",
        sandbox: "danger-full-access",
        approvalPolicy: "never",
      },
      { threadId: "thread-full" },
    ]
  );
});

test("buildTelegramReviewStartParams mirrors native inline review target payloads", () => {
  assert.deepEqual(
    buildTelegramReviewStartParams({ threadId: "thread-review", target: "uncommittedChanges" }),
    {
      threadId: "thread-review",
      delivery: "inline",
      target: { type: "uncommittedChanges" },
    }
  );
  assert.deepEqual(
    buildTelegramReviewStartParams({ threadId: "thread-review", target: "baseBranch", baseBranch: "main" }),
    {
      threadId: "thread-review",
      delivery: "inline",
      target: { type: "baseBranch", branch: "main" },
    }
  );
  assert.throws(
    () => buildTelegramReviewStartParams({ threadId: "thread-review", target: "baseBranch" }),
    /base branch is required/
  );
});

test("isTelegramMissingRolloutError recognizes fresh Telegram thread resume gaps", () => {
  assert.equal(
    isTelegramMissingRolloutError(new Error("no rollout found for thread id thread-new")),
    true
  );
  assert.equal(
    isTelegramMissingRolloutError(new Error("thread not found: thread-new")),
    false
  );
});

test("buildTelegramCodexInputRequest steers running active-thread input", () => {
  assert.deepEqual(
    buildTelegramCodexInputRequest({
      threadId: "thread-running",
      text: "Add a Telegram button for this",
      threadPayload: {
        conversation: {
          id: "thread-running",
          turns: [
            { id: "turn-done", status: "completed" },
            { turn_id: "turn-running", state: "in_progress" },
          ],
        },
      },
    }),
    {
      method: "turn/steer",
      params: {
        threadId: "thread-running",
        expectedTurnId: "turn-running",
        input: [{ type: "text", text: "Add a Telegram button for this" }],
      },
    }
  );
});

test("buildTelegramApprovalResponseResult mirrors native approval result shapes", () => {
  assert.deepEqual(
    buildTelegramApprovalResponseResult({
      method: "item/commandExecution/requestApproval",
      decision: "accept",
    }),
    { decision: "accept" }
  );
  assert.deepEqual(
    buildTelegramApprovalResponseResult({
      method: "item/fileChange/requestApproval",
      decision: "decline",
    }),
    { decision: "decline" }
  );
  assert.deepEqual(
    buildTelegramApprovalResponseResult({
      method: "item/permissions/requestApproval",
      params: { permissions: { network: { enabled: true } } },
      decision: "accept",
    }),
    {
      permissions: { network: { enabled: true } },
      scope: "turn",
    }
  );
  assert.deepEqual(
    buildTelegramApprovalResponseResult({
      method: "item/permissions/requestApproval",
      params: { permissions: { network: { enabled: true } } },
      decision: "decline",
    }),
    {
      permissions: {},
      scope: "turn",
    }
  );
});

test("normalizeTelegramCreatedThread preserves cwd fallback for Telegram new-thread flow", () => {
  assert.deepEqual(
    normalizeTelegramCreatedThread({
      thread: {
        id: "thread-new",
        title: "Fresh",
      },
    }, { cwd: "/Users/me/work/app" }),
    {
      thread: {
        id: "thread-new",
        title: "Fresh",
        cwd: "/Users/me/work/app",
      },
      threadId: "thread-new",
    }
  );
  assert.throws(
    () => normalizeTelegramCreatedThread({ thread: { title: "Missing id" } }),
    /thread\/start response missing thread/
  );
});

test("normalizeTelegramForkedThread marks fork origin and preserves cwd fallback", () => {
  assert.deepEqual(
    normalizeTelegramForkedThread({
      thread: {
        id: "fork-1",
        title: "Fork",
      },
    }, {
      sourceThreadId: "source-1",
      cwd: "/Users/me/work/app",
    }),
    {
      thread: {
        id: "fork-1",
        title: "Fork",
        cwd: "/Users/me/work/app",
        forkedFromThreadId: "source-1",
      },
      threadId: "fork-1",
    }
  );
});

test("normalizeTelegramWorktreeThreadResult keeps worktree metadata and normalized thread id", () => {
  assert.deepEqual(
    normalizeTelegramWorktreeThreadResult({
      worktree: {
        branch: "remodex/telegram-worktree",
        worktreePath: "/Users/me/.codex/worktrees/remodex/abc/app",
        alreadyExisted: true,
      },
      thread: {
        title: "Worktree thread",
        thread_id: "thread-worktree",
      },
    }),
    {
      worktree: {
        branch: "remodex/telegram-worktree",
        worktreePath: "/Users/me/.codex/worktrees/remodex/abc/app",
        alreadyExisted: true,
      },
      thread: {
        title: "Worktree thread",
        thread_id: "thread-worktree",
        id: "thread-worktree",
        threadId: "thread-worktree",
      },
      threadId: "thread-worktree",
    }
  );
});

test("filterTelegramThreads narrows thread choices by title id and cwd", () => {
  const threads = [
    { id: "thread-telegram", title: "Telegram hardening", cwd: "/Users/me/remodex" },
    { id: "thread-ios", title: "Native Remodex App", cwd: "/Users/me/mobile" },
    { thread_id: "thread-docs", name: "Docs cleanup", project_path: "/Users/me/kartik-hermes" },
  ];

  assert.deepEqual(filterTelegramThreads(threads, "telegram"), [threads[0]]);
  assert.deepEqual(filterTelegramThreads(threads, "THREAD-IOS"), [threads[1]]);
  assert.deepEqual(filterTelegramThreads(threads, "kartik"), [threads[2]]);
  assert.equal(filterTelegramThreads(threads, "missing").length, 0);
  assert.equal(filterTelegramThreads(threads, ""), threads);
});

test("normalizeRelayBoundJsonRpcMessage rewrites payload-only responses to result", () => {
  const normalized = normalizeRelayBoundJsonRpcMessage(JSON.stringify({
    id: "req-payload-only",
    payload: {
      data: [{ id: "turn-1" }],
      nextCursor: null,
    },
  }));

  assert.deepEqual(JSON.parse(normalized), {
    id: "req-payload-only",
    result: {
      data: [{ id: "turn-1" }],
      nextCursor: null,
    },
  });
});

test("normalizeRelayBoundJsonRpcMessage unwraps nested app-server result payloads", () => {
  const normalized = normalizeRelayBoundJsonRpcMessage(JSON.stringify({
    id: "req-nested-payload",
    result: {
      payload: {
        data: [{ id: "thread-1" }],
        nextCursor: null,
      },
    },
  }));

  assert.deepEqual(JSON.parse(normalized), {
    id: "req-nested-payload",
    result: {
      payload: {
        data: [{ id: "thread-1" }],
        nextCursor: null,
      },
      data: [{ id: "thread-1" }],
      nextCursor: null,
    },
  });
});

test("normalizeRelayBoundJsonRpcMessage drops non-RPC relay payloads before iOS decode", () => {
  assert.equal(normalizeRelayBoundJsonRpcMessage("not-json"), null);
  assert.equal(normalizeRelayBoundJsonRpcMessage(JSON.stringify({ kind: "debug" })), null);
});

test("normalizeRelayBoundJsonRpcMessage drops client-origin RPC requests before iOS handles them", () => {
  assert.equal(
    normalizeRelayBoundJsonRpcMessage(JSON.stringify({
      id: "req-thread-list",
      method: "thread/list",
      params: {},
    })),
    null
  );
});

test("normalizeRelayBoundJsonRpcMessage converts tracked method-bearing responses for iOS", () => {
  const pendingRequestMethodsById = new Map([
    ["req-thread-list", {
      method: "thread/list",
      createdAt: Date.now(),
    }],
    ["req-turns-list", {
      method: "thread/turns/list",
      createdAt: Date.now(),
    }],
  ]);

  const threadListResponse = normalizeRelayBoundJsonRpcMessage(JSON.stringify({
    id: "req-thread-list",
    method: "thread/list",
    payload: {
      data: [{ id: "thread-1" }],
      nextCursor: null,
    },
  }), { pendingRequestMethodsById });

  assert.deepEqual(JSON.parse(threadListResponse), {
    id: "req-thread-list",
    result: {
      data: [{ id: "thread-1" }],
      nextCursor: null,
    },
  });

  const turnsListResponse = normalizeRelayBoundJsonRpcMessage(JSON.stringify({
    id: "req-turns-list",
    method: "thread/turns/list",
    result: {
      payload: {
        data: [{ id: "turn-1" }],
        nextCursor: null,
      },
    },
  }), { pendingRequestMethodsById });

  assert.deepEqual(JSON.parse(turnsListResponse), {
    id: "req-turns-list",
    result: {
      payload: {
        data: [{ id: "turn-1" }],
        nextCursor: null,
      },
      data: [{ id: "turn-1" }],
      nextCursor: null,
    },
  });
});

test("normalizeRelayBoundJsonRpcMessage keeps server-origin approval requests", () => {
  const raw = JSON.stringify({
    id: "approval-1",
    method: "item/fileChange/requestApproval",
    params: {
      threadId: "thread-1",
    },
  });

  assert.equal(normalizeRelayBoundJsonRpcMessage(raw), raw);
});

test("disableUnsupportedReasoningSummaryForTurnStart disables summaries for Codex Spark", () => {
  const raw = JSON.stringify({
    id: "req-turn-start",
    method: "turn/start",
    params: {
      threadId: "thread-1",
      model: "gpt-5.3-codex-spark",
      effort: "medium",
      input: [{ type: "text", text: "Ship it" }],
    },
  });

  const normalized = JSON.parse(disableUnsupportedReasoningSummaryForTurnStart(raw));

  assert.equal(normalized.params.model, "gpt-5.3-codex-spark");
  assert.equal(normalized.params.summary, "none");
});

test("disableUnsupportedReasoningSummaryForTurnStart detects plan-mode Codex Spark model", () => {
  const raw = JSON.stringify({
    id: "req-turn-start-plan",
    method: "turn/start",
    params: {
      threadId: "thread-1",
      input: [{ type: "text", text: "Plan it" }],
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex-spark",
          reasoning_effort: "medium",
        },
      },
    },
  });

  const normalized = JSON.parse(disableUnsupportedReasoningSummaryForTurnStart(raw));

  assert.equal(normalized.params.summary, "none");
  assert.equal(normalized.params.collaborationMode.settings.model, "gpt-5.3-codex-spark");
});

test("disableUnsupportedReasoningSummaryForTurnStart leaves other models untouched", () => {
  const raw = JSON.stringify({
    id: "req-turn-start-gpt55",
    method: "turn/start",
    params: {
      threadId: "thread-1",
      model: "gpt-5.5",
      input: [{ type: "text", text: "Ship it" }],
    },
  });

  assert.equal(disableUnsupportedReasoningSummaryForTurnStart(raw), raw);
});

test("hasRelayConnectionGoneStale returns false for fresh or missing activity timestamps", () => {
  assert.equal(
    hasRelayConnectionGoneStale(1_000, {
      now: 25_999,
      staleAfterMs: 25_000,
    }),
    false
  );
  assert.equal(hasRelayConnectionGoneStale(Number.NaN), false);
});

test("hasRelayConnectionGoneStale default threshold waits 25 seconds", () => {
  assert.equal(
    hasRelayConnectionGoneStale(1_000, {
      now: 25_999,
    }),
    false
  );
  assert.equal(
    hasRelayConnectionGoneStale(1_000, {
      now: 26_000,
    }),
    true
  );
});

test("buildHeartbeatBridgeStatus downgrades stale connected snapshots", () => {
  assert.deepEqual(
    buildHeartbeatBridgeStatus(
      {
        state: "running",
        connectionStatus: "connected",
        pid: 123,
        lastError: "",
      },
      1_000,
      {
        now: 26_500,
        staleAfterMs: 25_000,
        staleMessage: "Relay heartbeat stalled; reconnect pending.",
      }
    ),
    {
      state: "running",
      connectionStatus: "disconnected",
      pid: 123,
      lastError: "Relay heartbeat stalled; reconnect pending.",
    }
  );
});

test("buildHeartbeatBridgeStatus leaves fresh or already-disconnected snapshots unchanged", () => {
  const freshStatus = {
    state: "running",
    connectionStatus: "connected",
    pid: 123,
    lastError: "",
  };
  assert.deepEqual(
    buildHeartbeatBridgeStatus(freshStatus, 1_000, {
      now: 20_000,
      staleAfterMs: 25_000,
    }),
    freshStatus
  );

  const disconnectedStatus = {
    state: "running",
    connectionStatus: "disconnected",
    pid: 123,
    lastError: "",
  };
  assert.deepEqual(buildHeartbeatBridgeStatus(disconnectedStatus, 1_000), disconnectedStatus);
});

function makeTurns(start, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `turn-${start + index}`,
    items: [
      {
        id: `item-${start + index}`,
        type: "assistant_message",
        text: `message ${start + index}`,
      },
    ],
  }));
}

test("fetchAdaptiveThreadTurnsListForRelay caps initial mobile pages to five turns", async () => {
  const request = {
    id: "req-turns-list",
    method: "thread/turns/list",
    params: {
      threadId: "thread-small",
      limit: 20,
      sortDirection: "desc",
    },
  };
  const fetches = [];
  const pages = [
    { data: makeTurns(1, 1), nextCursor: "cursor-after-1", stableMeta: "first-page" },
    { data: makeTurns(2, 4), nextCursor: "cursor-after-5", stableMeta: "second-page" },
    { data: makeTurns(6, 15), nextCursor: "cursor-after-20", stableMeta: "third-page" },
  ];

  const response = await fetchAdaptiveThreadTurnsListForRelay(request, {
    fetchPage: async (params) => {
      fetches.push(params);
      return pages.shift();
    },
  });

  assert.equal(response.id, "req-turns-list");
  assert.equal(response.result.data.length, 5);
  assert.deepEqual(
    response.result.data.map((turn) => turn.id),
    makeTurns(1, 5).map((turn) => turn.id)
  );
  assert.equal(
    response.result.data.some((turn) => turn.id.startsWith("remodex-history-compacted-")),
    false
  );
  assert.equal(response.result.stableMeta, undefined);
  assert.equal(response.result.nextCursor, "cursor-after-5");
  assert.deepEqual(
    fetches.map((params) => ({ limit: params.limit, cursor: params.cursor })),
    [
      { limit: 1, cursor: undefined },
      { limit: 4, cursor: "cursor-after-1" },
    ]
  );
});

test("fetchAdaptiveThreadTurnsListForRelay returns a compacted single turn when one huge first turn is still too large", async () => {
  const request = {
    id: "req-turns-list-large-first",
    method: "thread/turns/list",
    params: {
      threadId: "thread-large",
      limit: 20,
      sortDirection: "desc",
    },
  };
  const fetches = [];

  const response = await fetchAdaptiveThreadTurnsListForRelay(request, {
    fetchPage: async (params) => {
      fetches.push(params);
      return {
        data: [
          {
            id: "turn-1",
            items: [
              {
                id: "item-1",
                type: "function_call_output",
                text: "A".repeat(4 * 1024 * 1024),
              },
            ],
          },
        ],
        nextCursor: "cursor-after-1",
      };
    },
    sanitizeForRelay: (raw) => raw,
    payloadSoftLimitBytes: 1_000,
  });

  assert.deepEqual(
    response.result.data.map((turn) => turn.id),
    ["turn-1"]
  );
  assert.equal(response.result.data[0].remodexEmergencySingleTurnForRelay, true);
  assert.equal(response.result.data[0].items.length, 1);
  assert.equal(response.result.data[0].items[0].relayPayloadTruncated, true);
  assert.equal(response.result.nextCursor, "cursor-after-1");
  assert.equal(Buffer.byteLength(JSON.stringify(response), "utf8") < 1_000, true);
  assert.equal(fetches.length, 1);
});

test("fetchAdaptiveThreadTurnsListForRelay stops after a huge second turns-list batch", async () => {
  const request = {
    id: "req-turns-list-large-second",
    method: "thread/turns/list",
    params: {
      threadId: "thread-mixed",
      limit: 20,
      sortDirection: "desc",
    },
  };
  const fetches = [];
  const pages = [
    { data: makeTurns(1, 1), nextCursor: "cursor-after-1" },
    {
      data: makeTurns(2, 4).map((turn) => ({
        ...turn,
        items: [
          {
            id: `${turn.id}-item`,
            type: "function_call_output",
            text: "B".repeat(1024 * 1024),
          },
        ],
      })),
      nextCursor: "cursor-after-5",
    },
  ];

  const response = await fetchAdaptiveThreadTurnsListForRelay(request, {
    fetchPage: async (params) => {
      fetches.push(params);
      return pages.shift();
    },
  });

  assert.deepEqual(
    response.result.data.map((turn) => turn.id),
    makeTurns(1, 5).map((turn) => turn.id)
  );
  assert.equal(response.result.nextCursor, "cursor-after-5");
  assert.deepEqual(
    fetches.map((params) => params.limit),
    [1, 4]
  );
});

test("fetchAdaptiveThreadTurnsListForRelay forwards input and returned cursors", async () => {
  const request = {
    id: "req-turns-list-older",
    method: "thread/turns/list",
    params: {
      threadId: "thread-large",
      limit: 6,
      sortDirection: "desc",
      cursor: "cursor-before-page",
    },
  };
  const fetches = [];
  const pages = [
    { items: makeTurns(1, 1), nextCursor: "cursor-after-first" },
    { items: makeTurns(2, 4), nextCursor: "cursor-after-second" },
    { items: makeTurns(6, 1), nextCursor: "cursor-after-third" },
  ];

  const response = await fetchAdaptiveThreadTurnsListForRelay(request, {
    fetchPage: async (params) => {
      fetches.push(params);
      return pages.shift();
    },
  });

  assert.equal(response.result.items.length, 5);
  assert.equal(response.result.nextCursor, "cursor-after-second");
  assert.deepEqual(
    fetches.map((params) => ({ limit: params.limit, cursor: params.cursor })),
    [
      { limit: 1, cursor: "cursor-before-page" },
      { limit: 4, cursor: "cursor-after-first" },
    ]
  );
});

test("fetchAdaptiveThreadTurnsListForRelay reads nested result payload pages", async () => {
  const response = await fetchAdaptiveThreadTurnsListForRelay({
    id: "req-turns-list-nested-payload",
    method: "thread/turns/list",
    params: {
      threadId: "thread-nested-payload",
      limit: 5,
    },
  }, {
    fetchPage: async () => ({
      payload: {
        data: makeTurns(1, 1),
        nextCursor: null,
      },
    }),
  });

  assert.deepEqual(
    response.result.data.map((turn) => turn.id),
    ["turn-1"]
  );
  assert.equal(response.result.nextCursor, null);
});

test("fetchAdaptiveThreadTurnsListForRelay preserves turns-list response array shapes", async () => {
  for (const turnsKey of ["data", "items", "turns"]) {
    const response = await fetchAdaptiveThreadTurnsListForRelay({
      id: `req-${turnsKey}`,
      method: "thread/turns/list",
      params: {
        threadId: `thread-${turnsKey}`,
        limit: 1,
      },
    }, {
      fetchPage: async () => ({
        [turnsKey]: makeTurns(1, 1),
        nextCursor: `cursor-${turnsKey}`,
      }),
    });

    assert.equal(Array.isArray(response.result[turnsKey]), true);
    assert.equal(response.result[turnsKey][0].id, "turn-1");
    for (const otherKey of ["data", "items", "turns"].filter((key) => key !== turnsKey)) {
      assert.equal(response.result[otherKey], undefined);
    }
    assert.equal(response.result.nextCursor, `cursor-${turnsKey}`);
  }
});

test("fetchAdaptiveThreadTurnsListForRelay returns fetched turns when a later batch fails", async () => {
  const response = await fetchAdaptiveThreadTurnsListForRelay({
    id: "req-turns-list-later-error",
    method: "thread/turns/list",
    params: {
      threadId: "thread-later-error",
      limit: 5,
    },
  }, {
    fetchPage: async (params) => {
      if (params.cursor === "cursor-after-first") {
        throw new Error("app-server failed");
      }
      return {
        data: makeTurns(1, 1),
        nextCursor: "cursor-after-first",
      };
    },
  });

  assert.deepEqual(
    response.result.data.map((turn) => turn.id),
    ["turn-1"]
  );
  assert.equal(response.result.nextCursor, "cursor-after-first");
});

test("fetchAdaptiveThreadTurnsListForRelay retries the first page with a safe limit after an error", async () => {
  const fetches = [];
  const response = await fetchAdaptiveThreadTurnsListForRelay({
    id: "req-turns-list-first-error",
    method: "thread/turns/list",
    params: {
      threadId: "thread-first-error",
      limit: 20,
      sortDirection: "desc",
    },
  }, {
    fetchPage: async (params) => {
      fetches.push(params);
      if (fetches.length === 1) {
        throw new Error("missing payload");
      }
      return {
        data: makeTurns(1, 5),
        nextCursor: "cursor-after-safe",
      };
    },
  });

  assert.deepEqual(
    response.result.data.map((turn) => turn.id),
    ["turn-1", "turn-2", "turn-3", "turn-4", "turn-5"]
  );
  assert.equal(response.result.nextCursor, "cursor-after-safe");
  assert.deepEqual(
    fetches.map((params) => ({ limit: params.limit, cursor: params.cursor })),
    [
      { limit: 1, cursor: undefined },
      { limit: 5, cursor: undefined },
    ]
  );
});

test("fetchAdaptiveThreadTurnsListForRelay retries malformed first pages with a safe limit", async () => {
  const fetches = [];
  const response = await fetchAdaptiveThreadTurnsListForRelay({
    id: "req-turns-list-first-malformed",
    method: "thread/turns/list",
    params: {
      threadId: "thread-first-malformed",
      limit: 20,
      sortDirection: "desc",
    },
  }, {
    fetchPage: async (params) => {
      fetches.push(params);
      if (fetches.length === 1) {
        return {
          unexpected: "server-shape",
          nextCursor: "cursor-that-should-not-survive",
        };
      }
      return {
        data: makeTurns(1, 5),
        nextCursor: "cursor-after-safe",
      };
    },
  });

  assert.deepEqual(
    response.result.data.map((turn) => turn.id),
    ["turn-1", "turn-2", "turn-3", "turn-4", "turn-5"]
  );
  assert.equal(response.result.nextCursor, "cursor-after-safe");
  assert.deepEqual(
    fetches.map((params) => ({ limit: params.limit, cursor: params.cursor })),
    [
      { limit: 1, cursor: undefined },
      { limit: 5, cursor: undefined },
    ]
  );
});

test("fetchAdaptiveThreadTurnsListForRelay keeps only a safe slice when the combined page stays too large", async () => {
  const response = await fetchAdaptiveThreadTurnsListForRelay({
    id: "req-turns-list-large-combined",
    method: "thread/turns/list",
    params: {
      threadId: "thread-large-combined",
      limit: 20,
    },
  }, {
    fetchPage: async (params) => {
      if (params.cursor !== "cursor-after-first") {
        return {
          data: makeTurns(1, 1),
          nextCursor: "cursor-after-first",
        };
      }
      return {
        data: makeTurns(2, 10).map((turn, index) => ({
          ...turn,
          items: turn.items.map((item) => ({
            ...item,
            text: index < 4 ? "small-enough" : "X".repeat(1024 * 1024),
          })),
        })),
        nextCursor: "cursor-after-large",
      };
    },
    sanitizeForRelay: (raw) => raw,
    payloadSoftLimitBytes: 10_000,
  });

  assert.deepEqual(
    response.result.data.map((turn) => turn.id),
    ["turn-1", "turn-2", "turn-3", "turn-4", "turn-5"]
  );
  assert.equal(response.result.nextCursor, "cursor-after-large");
});

test("fetchAdaptiveThreadTurnsListForRelay falls back to one turn when five are still too large", async () => {
  const response = await fetchAdaptiveThreadTurnsListForRelay({
    id: "req-turns-list-large-five",
    method: "thread/turns/list",
    params: {
      threadId: "thread-large-five",
      limit: 20,
    },
  }, {
    fetchPage: async (params) => {
      if (params.cursor !== "cursor-after-first") {
        return {
          data: makeTurns(1, 1),
          nextCursor: "cursor-after-first",
        };
      }
      return {
        data: makeTurns(2, 10).map((turn) => ({
          ...turn,
          items: turn.items.map((item) => ({
            ...item,
            text: "X".repeat(1024 * 1024),
          })),
        })),
        nextCursor: "cursor-after-large",
      };
    },
    sanitizeForRelay: (raw) => raw,
    payloadSoftLimitBytes: 2_000,
  });

  assert.deepEqual(
    response.result.data.map((turn) => turn.id),
    ["turn-1"]
  );
  assert.equal(response.result.nextCursor, "cursor-after-large");
});

test("fetchAdaptiveThreadTurnsListForRelay returns an empty page when the first page has no payload", async () => {
  const response = await fetchAdaptiveThreadTurnsListForRelay({
    id: "req-turns-list-missing-payload",
    method: "thread/turns/list",
    params: {
      threadId: "thread-missing-payload",
      limit: 2,
      sortDirection: "desc",
    },
  }, {
    fetchPage: async () => null,
  });

  assert.equal(response.id, "req-turns-list-missing-payload");
  assert.deepEqual(response.result.data, []);
  assert.equal(response.result.nextCursor, null);
});

test("fetchAdaptiveThreadTurnsListForRelay returns an empty page when no fallback is available", async () => {
  const response = await fetchAdaptiveThreadTurnsListForRelay({
    id: "req-turns-list-empty-fallback",
    method: "thread/turns/list",
    params: {
      threadId: "thread-empty-fallback",
      limit: 10,
    },
  }, {
    fetchPage: async () => null,
  });

  assert.deepEqual(response, {
    id: "req-turns-list-empty-fallback",
    result: {
      data: [],
      nextCursor: null,
    },
  });
});

test("fetchAdaptiveThreadTurnsListForRelay does not copy malformed page fields into empty fallback", async () => {
  const response = await fetchAdaptiveThreadTurnsListForRelay({
    id: "req-turns-list-malformed-object",
    method: "thread/turns/list",
    params: {
      threadId: "thread-malformed-object",
      limit: 10,
    },
  }, {
    fetchPage: async () => ({
      unexpected: { nested: ["server-shape"] },
      next_cursor: "cursor-that-should-not-survive",
    }),
  });

  assert.deepEqual(response, {
    id: "req-turns-list-malformed-object",
    result: {
      data: [],
      nextCursor: null,
    },
  });
});

test("sanitizeThreadHistoryImagesForRelay replaces inline history images with lightweight references", () => {
  const rawMessage = JSON.stringify({
    id: "req-thread-read",
    result: {
      thread: {
        id: "thread-images",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "item-user",
                type: "user_message",
                content: [
                  {
                    type: "input_text",
                    text: "Look at this screenshot",
                  },
                  {
                    type: "image",
                    image_url: "data:image/png;base64,AAAA",
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });

  const sanitized = JSON.parse(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/read")
  );
  const content = sanitized.result.thread.turns[0].items[0].content;

  assert.deepEqual(content[0], {
    type: "input_text",
    text: "Look at this screenshot",
  });
  assert.deepEqual(content[1], {
    type: "image",
    url: "remodex://history-image-elided",
  });
});

test("sanitizeThreadHistoryImagesForRelay replaces input_image history data URLs", () => {
  const rawMessage = JSON.stringify({
    id: "req-thread-input-image",
    result: {
      thread: {
        id: "thread-input-image",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "item-user",
                type: "user_message",
                content: [
                  {
                    type: "input_image",
                    image_url: {
                      url: "data:image/png;base64,AAAA",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });

  const sanitized = JSON.parse(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/read")
  );
  const content = sanitized.result.thread.turns[0].items[0].content;

  assert.deepEqual(content[0], {
    type: "input_image",
    url: "remodex://history-image-elided",
  });
});

test("sanitizeThreadHistoryImagesForRelay annotates generated image calls with local paths", () => {
  const rawMessage = JSON.stringify({
    id: "req-thread-generated-image",
    result: {
      thread: {
        id: "thread-generated-image",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "ig_123",
                type: "image_generation_call",
                status: "generating",
                result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
              },
            ],
          },
        ],
      },
    },
  });

  const sanitized = JSON.parse(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/read")
  );
  const item = sanitized.result.thread.turns[0].items[0];

  assert.equal(
    item.saved_path,
    expectedGeneratedImagePath("thread-generated-image", "ig_123.png")
  );
  assert.equal(item.result, undefined);
  assert.equal(item.result_elided_for_relay, true);
});

test("sanitizeThreadHistoryImagesForRelay annotates image generation items with local paths", () => {
  const rawMessage = JSON.stringify({
    id: "req-thread-image-generation",
    result: {
      thread: {
        id: "thread-image-generation",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "ig_generation",
                type: "image_generation",
                result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
              },
            ],
          },
        ],
      },
    },
  });

  const sanitized = JSON.parse(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/read")
  );
  const item = sanitized.result.thread.turns[0].items[0];

  assert.equal(
    item.saved_path,
    expectedGeneratedImagePath("thread-image-generation", "ig_generation.png")
  );
  assert.equal(item.result, undefined);
  assert.equal(item.result_elided_for_relay, true);
});

test("sanitizeThreadHistoryImagesForRelay annotates image end history with local paths", () => {
  const rawMessage = JSON.stringify({
    id: "req-thread-generated-image-end",
    result: {
      thread: {
        id: "thread-generated-image-end",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "turn-1",
                type: "image_generation_end",
                call_id: "ig_end",
                result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
              },
            ],
          },
        ],
      },
    },
  });

  const sanitized = JSON.parse(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/read")
  );
  const item = sanitized.result.thread.turns[0].items[0];

  assert.equal(
    item.saved_path,
    expectedGeneratedImagePath("thread-generated-image-end", "ig_end.png")
  );
  assert.equal(item.result, undefined);
  assert.equal(item.result_elided_for_relay, true);
});

test("sanitizeThreadHistoryImagesForRelay uses CODEX_HOME for generated image fallbacks", (t) => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-codex-home-"));
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  t.after(() => {
    if (previousCodexHome == null) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    fs.rmSync(codexHome, { recursive: true, force: true });
  });

  const rawMessage = JSON.stringify({
    id: "req-thread-generated-image-codex-home",
    result: {
      thread: {
        id: "thread-generated-image-home",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "ig_home",
                type: "imageView",
                result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
              },
            ],
          },
        ],
      },
    },
  });

  const sanitized = JSON.parse(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/read")
  );
  const item = sanitized.result.thread.turns[0].items[0];

  assert.equal(
    item.saved_path,
    path.join(codexHome, "generated_images", "thread-generated-image-home", "ig_home.png")
  );
  assert.equal(item.result, undefined);
  assert.equal(item.result_elided_for_relay, true);
});

test("sanitizeThreadHistoryImagesForRelay preserves generated image file_path without saved_path", () => {
  const rawMessage = JSON.stringify({
    id: "req-thread-generated-image-file-path",
    result: {
      thread: {
        id: "thread-generated-image",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "ig_123",
                type: "image_generation_call",
                file_path: "/tmp/real-generated-image.png",
                status: "completed",
              },
            ],
          },
        ],
      },
    },
  });

  const sanitized = JSON.parse(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/read")
  );
  const item = sanitized.result.thread.turns[0].items[0];

  assert.equal(item.file_path, "/tmp/real-generated-image.png");
  assert.equal(item.saved_path, undefined);
});

test("sanitizeLiveGeneratedImageMessageForRelay annotates completed image items", () => {
  const rawMessage = JSON.stringify({
    method: "item/completed",
    params: {
      threadId: "thread-live-image",
      turnId: "turn-1",
      item: {
        id: "ig_live",
        type: "image_generation_call",
        result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      },
    },
  });

  const sanitized = JSON.parse(sanitizeLiveGeneratedImageMessageForRelay(rawMessage));
  const item = sanitized.params.item;

  assert.equal(
    item.saved_path,
    expectedGeneratedImagePath("thread-live-image", "ig_live.png")
  );
  assert.equal(item.result, undefined);
  assert.equal(item.result_elided_for_relay, true);
});

test("sanitizeLiveGeneratedImageMessageForRelay elides nested completed image items", () => {
  const rawMessage = JSON.stringify({
    method: "item/completed",
    params: {
      threadId: "thread-live-nested-image",
      turnId: "turn-1",
      event: {
        type: "item_completed",
        item: {
          id: "ig_nested",
          type: "image_generation",
          result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        },
      },
    },
  });

  const sanitized = JSON.parse(sanitizeLiveGeneratedImageMessageForRelay(rawMessage));
  const item = sanitized.params.event.item;

  assert.equal(
    item.saved_path,
    expectedGeneratedImagePath("thread-live-nested-image", "ig_nested.png")
  );
  assert.equal(item.result, undefined);
  assert.equal(item.result_elided_for_relay, true);
});

test("sanitizeLiveGeneratedImageMessageForRelay uses call id for image end events", () => {
  const rawMessage = JSON.stringify({
    method: "image_generation_end",
    params: {
      type: "image_generation_end",
      threadId: "thread-live-event",
      id: "turn-1",
      call_id: "ig_event",
      result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    },
  });

  const sanitized = JSON.parse(sanitizeLiveGeneratedImageMessageForRelay(rawMessage));

  assert.equal(
    sanitized.params.saved_path,
    expectedGeneratedImagePath("thread-live-event", "ig_event.png")
  );
  assert.equal(sanitized.params.result, undefined);
  assert.equal(sanitized.params.result_elided_for_relay, true);
});

test("sanitizeThreadHistoryImagesForRelay leaves unrelated RPC payloads unchanged", () => {
  const rawMessage = JSON.stringify({
    id: "req-other",
    result: {
      ok: true,
    },
  });

  assert.equal(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "turn/start"),
    rawMessage
  );
});

test("createMacOSBridgeWakeAssertion spawns a macOS caffeinate idle-sleep assertion tied to the bridge pid", () => {
  const spawnCalls = [];
  const fakeChild = {
    killed: false,
    on() {},
    unref() {},
    kill() {
      this.killed = true;
    },
  };

  const assertion = createMacOSBridgeWakeAssertion({
    platform: "darwin",
    pid: 4242,
    spawnImpl(command, args, options) {
      spawnCalls.push({ command, args, options });
      return fakeChild;
    },
  });

  assert.equal(assertion.active, true);
  assert.deepEqual(spawnCalls, [{
    command: "/usr/bin/caffeinate",
    args: ["-i", "-w", "4242"],
    options: { stdio: "ignore" },
  }]);

  assertion.stop();
  assert.equal(fakeChild.killed, true);
});

test("createMacOSBridgeWakeAssertion can toggle the caffeinate assertion on and off live", () => {
  const spawnCalls = [];
  const children = [];

  const assertion = createMacOSBridgeWakeAssertion({
    platform: "darwin",
    pid: 9001,
    enabled: false,
    spawnImpl(command, args, options) {
      const child = {
        killed: false,
        on() {},
        unref() {},
        kill() {
          this.killed = true;
        },
      };
      children.push(child);
      spawnCalls.push({ command, args, options });
      return child;
    },
  });

  assert.equal(assertion.active, false);
  assert.equal(assertion.enabled, false);
  assert.deepEqual(spawnCalls, []);

  assertion.setEnabled(true);
  assert.equal(assertion.enabled, true);
  assert.equal(assertion.active, true);
  assert.equal(spawnCalls.length, 1);

  assertion.setEnabled(false);
  assert.equal(assertion.enabled, false);
  assert.equal(assertion.active, false);
  assert.equal(children[0].killed, true);
});

test("createMacOSBridgeWakeAssertion is a no-op outside macOS", () => {
  let didSpawn = false;
  const assertion = createMacOSBridgeWakeAssertion({
    platform: "linux",
    spawnImpl() {
      didSpawn = true;
      throw new Error("should not spawn");
    },
  });

  assert.equal(assertion.active, false);
  assertion.stop();
  assert.equal(didSpawn, false);
});

test("persistBridgePreferences only saves the daemon preference field", () => {
  const writes = [];

  persistBridgePreferences(
    { keepMacAwakeEnabled: false },
    {
      readDaemonConfigImpl() {
        return {
          relayUrl: "ws://127.0.0.1:9000/relay",
          refreshEnabled: true,
        };
      },
      writeDaemonConfigImpl(config) {
        writes.push(config);
      },
    }
  );

  assert.deepEqual(writes, [{
    relayUrl: "ws://127.0.0.1:9000/relay",
    refreshEnabled: true,
    keepMacAwakeEnabled: false,
  }]);
});

test("sanitizeThreadHistoryImagesForRelay strips bulky compaction replacement history", () => {
  const rawMessage = JSON.stringify({
    id: "req-thread-resume",
    result: {
      thread: {
        id: "thread-compaction",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "item-compaction",
                type: "context_compaction",
                payload: {
                  message: "",
                  replacement_history: [
                    {
                      type: "message",
                      role: "assistant",
                      content: [{ type: "output_text", text: "very old transcript" }],
                    },
                  ],
                },
              },
              {
                id: "item-compaction-camel",
                type: "contextCompaction",
                replacementHistory: [
                  {
                    type: "message",
                    role: "user",
                    content: [{ type: "input_text", text: "older prompt" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });

  const sanitized = JSON.parse(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/resume")
  );
  const items = sanitized.result.thread.turns[0].items;

  assert.deepEqual(items[0], {
    id: "item-compaction",
    type: "context_compaction",
    payload: {
      message: "",
    },
  });
  assert.deepEqual(items[1], {
    id: "item-compaction-camel",
    type: "contextCompaction",
  });
});

test("sanitizeThreadHistoryImagesForRelay strips bulky compaction history from turns pages", () => {
  const rawMessage = JSON.stringify({
    id: "req-turns-list",
    result: {
      data: [
        {
          id: "turn-1",
          items: [
            {
              id: "item-compacted",
              type: "compacted",
              message: "",
              replacement_history: [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: "A".repeat(2 * 1024 * 1024) }],
                },
              ],
            },
          ],
        },
      ],
      nextCursor: "cursor-2",
    },
  });

  const sanitizedRaw = sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/turns/list");
  const sanitized = JSON.parse(sanitizedRaw);

  assert.equal(Buffer.byteLength(sanitizedRaw, "utf8") < 16 * 1024, true);
  assert.deepEqual(sanitized.result.data[0].items[0], {
    id: "item-compacted",
    type: "compacted",
    message: "",
  });
  assert.equal(sanitized.result.nextCursor, "cursor-2");
});

test("sanitizeThreadHistoryImagesForRelay compacts oversized turns pages", () => {
  const rawMessage = JSON.stringify({
    id: "req-turns-list-large",
    result: {
      items: [
        {
          id: "turn-1",
          items: [
            {
              id: "item-1",
              type: "assistant_message",
              text: "B".repeat(4 * 1024 * 1024),
            },
          ],
        },
      ],
    },
  });

  const sanitized = JSON.parse(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/turns/list")
  );
  const item = sanitized.result.items[0].items[0];

  assert.equal(sanitized.result.remodexPageCompactedForRelay, true);
  assert.deepEqual(
    sanitized.result.items.map((turn) => turn.id),
    ["turn-1"]
  );
  assert.equal(
    sanitized.result.items.some((turn) => turn.id.startsWith("remodex-history-compacted-")),
    false
  );
  assert.equal(sanitized.result.items[0].remodexPageCompactedForRelay, true);
  assert.equal(item.relayPayloadTruncated, true);
  assert.equal(item.text.startsWith("…\n"), true);
  assert.equal(item.text.length < 120_000, true);
});

test("sanitizeThreadHistoryImagesForRelay preserves oversized turns pages instead of replacing them with a marker", () => {
  const turns = Array.from({ length: 5 }, (_, turnIndex) => ({
    id: `turn-${turnIndex + 1}`,
    items: Array.from({ length: 900 }, (_, itemIndex) => ({
      id: `item-${turnIndex + 1}-${itemIndex + 1}`,
      type: "function_call_output",
      role: "tool",
      itemId: `call-${turnIndex + 1}-${itemIndex + 1}`,
      text: "C".repeat(1_500),
      payload: {
        blob: "D".repeat(1_200),
      },
    })),
  }));
  const rawMessage = JSON.stringify({
    id: "req-turns-list-impossible",
    result: {
      data: turns,
      nextCursor: "cursor-after-huge-page",
    },
  });

  const sanitizedRaw = sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/turns/list");
  const sanitized = JSON.parse(sanitizedRaw);

  assert.equal(Buffer.byteLength(sanitizedRaw, "utf8") <= 4 * 1024 * 1024, true);
  assert.deepEqual(
    sanitized.result.data.map((turn) => turn.id),
    turns.map((turn) => turn.id)
  );
  assert.equal(
    sanitized.result.data.some((turn) => turn.id.startsWith("remodex-history-compacted-")),
    false
  );
  assert.equal(sanitized.result.nextCursor, "cursor-after-huge-page");
  assert.equal(sanitized.result.data.every((turn) => turn.items.length === 900), true);
  assert.equal(
    sanitized.result.data.every((turn) => turn.items.every((item) => item.relayPayloadTruncated === true)),
    true
  );
});

test("sanitizeThreadHistoryImagesForRelay compacts oversized history before the newest turn tail", () => {
  const largeText = "A".repeat(4 * 1024 * 1024);
  const rawMessage = JSON.stringify({
    id: "req-thread-tail",
    result: {
      thread: {
        id: "thread-large-history",
        turns: [
          {
            id: "turn-old",
            items: [
              {
                id: "item-old",
                type: "assistant_message",
                text: largeText,
              },
            ],
          },
          {
            id: "turn-new",
            items: [
              {
                id: "item-new",
                type: "assistant_message",
                text: "latest reply",
              },
            ],
          },
        ],
      },
    },
  });

  const sanitized = JSON.parse(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/read")
  );

  assert.equal(sanitized.result.thread.historyTailTruncatedForRelay, true);
  assert.equal(sanitized.result.thread.remodexHistoryCompacted, true);
  assert.equal(sanitized.result.thread.remodexOmittedTurnCount, 1);
  assert.equal(sanitized.result.thread.remodexKeptTurnCount, 1);
  assert.deepEqual(
    sanitized.result.thread.turns.map((turn) => turn.id),
    ["remodex-history-compacted-turn-old", "turn-new"]
  );
  assert.equal(
    sanitized.result.thread.turns[0].items[0].text.includes("Older turns omitted: 1"),
    true
  );
});

test("sanitizeThreadHistoryImagesForRelay keeps the newest forty turns when compacting", () => {
  const largeText = "A".repeat(900 * 1024);
  const turns = Array.from({ length: 45 }, (_, index) => ({
    id: `turn-${index + 1}`,
    items: [
      {
        id: `item-${index + 1}`,
        type: "assistant_message",
        text: index < 5 ? largeText : `reply ${index + 1}`,
      },
    ],
  }));
  const rawMessage = JSON.stringify({
    id: "req-thread-recent-window",
    result: {
      thread: {
        id: "thread-recent-window",
        turns,
      },
    },
  });

  const sanitized = JSON.parse(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/read")
  );

  assert.equal(sanitized.result.thread.remodexHistoryCompacted, true);
  assert.equal(sanitized.result.thread.remodexOmittedTurnCount, 5);
  assert.equal(sanitized.result.thread.remodexKeptTurnCount, 40);
  assert.deepEqual(
    sanitized.result.thread.turns.map((turn) => turn.id),
    [
      "remodex-history-compacted-turn-1",
      ...turns.slice(5).map((turn) => turn.id),
    ]
  );
});

test("sanitizeThreadHistoryImagesForRelay truncates the newest oversized text item to its tail", () => {
  const largeText = `header\n${"B".repeat(4 * 1024 * 1024)}`;
  const rawMessage = JSON.stringify({
    id: "req-thread-text-tail",
    result: {
      thread: {
        id: "thread-large-item",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "item-1",
                type: "assistant_message",
                text: largeText,
              },
            ],
          },
        ],
      },
    },
  });

  const sanitized = JSON.parse(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/read")
  );
  const item = sanitized.result.thread.turns[0].items[0];

  assert.equal(sanitized.result.thread.historyTailTruncatedForRelay, true);
  assert.equal(item.relayTextTailTruncated, true);
  assert.equal(item.text.startsWith("…\n"), true);
  assert.equal(item.text.includes("header"), false);
});
