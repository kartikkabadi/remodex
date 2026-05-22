// FILE: telegram-renderer.test.js
// Purpose: Verifies compact Telegram rendering keeps sensitive data out by default.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/telegram-renderer

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  renderTelegramAccessRequired,
  renderTelegramAccountStatus,
  renderTelegramArchivedThreads,
  renderTelegramArchiveResult,
  renderTelegramApprovalRequest,
  renderTelegramBranches,
  renderTelegramCancelLoginResult,
  renderTelegramCheckoutResult,
  renderTelegramCheckpointResult,
  renderTelegramCheckpointRestoreApplyResult,
  renderTelegramCheckpointRestorePreview,
  renderTelegramCompactResult,
  renderTelegramCommitDraft,
  renderTelegramContextWindow,
  renderTelegramCreateBranchResult,
  renderTelegramDiffSummary,
  renderTelegramFeedbackResult,
  renderTelegramForkResult,
  renderTelegramGeneratedTitleResult,
  renderTelegramGitLog,
  renderTelegramGitStatus,
  renderTelegramGitInitResult,
  renderTelegramLinkHelp,
  renderTelegramLinkInstructions,
  renderTelegramLoginResult,
  renderTelegramCodexInputBlocked,
  shouldBlockTelegramCodexInput,
  renderTelegramLogoutConfirmation,
  renderTelegramLogoutResult,
  renderTelegramModelPreferences,
  renderTelegramOpenMacResult,
  renderTelegramPets,
  renderTelegramPlugins,
  renderTelegramRateLimits,
  renderTelegramPullResult,
  renderTelegramPullRequestDraft,
  renderTelegramPreferences,
  renderTelegramProjectCreateDirectoryResult,
  renderTelegramProjectDirectory,
  renderTelegramProjects,
  renderTelegramRenameResult,
  renderTelegramResumeResult,
  renderTelegramRemote,
  renderTelegramResetRemoteConfirmation,
  renderTelegramResetRemoteResult,
  renderTelegramSkills,
  renderTelegramStackedActionResult,
  renderTelegramStashPopResult,
  renderTelegramStashResult,
  renderTelegramStatus,
  renderTelegramQueueDetail,
  renderTelegramThreadActivity,
  renderTelegramThreadEvent,
  renderTelegramUnarchiveResult,
  renderTelegramUserInputRequest,
  renderTelegramUsageStatus,
  renderTelegramUpgradeInfo,
  renderTelegramVersionStatus,
  renderTelegramWakeMacResult,
  renderTelegramWorktreeThreadResult,
  renderUnauthorizedTelegramChat,
} = require("../src/telegram-renderer");

test("telegram renderer summarizes bridge status without leaking relay sessions", () => {
  const message = renderTelegramStatus({
    macName: "studio-mac",
    bridgeStatus: {
      connectionStatus: "connected",
      codexLaunchState: { status: "ready" },
      bridgeVersion: "1.5.2-beta.0",
    },
    activeThread: { title: "Remodex Telegram plan", id: "thread-sensitive" },
    gitStatus: { branch: "feat/telegram-bridge", isRepo: true },
    contextWindow: {
      usage: { tokensUsed: 12_400, tokenLimit: 128_000 },
    },
    runtimePreferences: {
      runtimeModel: "gpt-5.5",
      reasoningEffort: "medium",
      runtimeAccessMode: "on-request",
    },
    queueState: { pendingApprovals: 1, runningTurn: true },
    access: { allowed: true, status: "available" },
    relaySessionId: "session-sensitive-long-value",
  });

  assert.match(message, /Remodex status/);
  assert.match(message, /studio-mac · connected/);
  assert.match(message, /Bridge 1\.5\.2-beta\.0 · Codex ready/);
  assert.match(message, /Thread: Remodex Telegram plan/);
  assert.match(message, /Branch: feat\/telegram-bridge/);
  assert.match(message, /Context: 12,400 \/ 128,000 tokens \(10%\)/);
  assert.match(message, /Model: GPT-5\.5 · Medium · Normal/);
  assert.match(message, /Queue: turn running, 1 approval/);
  assert.doesNotMatch(message, /session-sensitive|thread-sensitive/);
});

test("telegram renderer lists steered input in queue detail", () => {
  const message = renderTelegramQueueDetail({
    queueState: { runningTurn: true, steerQueued: 1, pendingApprovals: 0 },
    steerQueue: [{ text: "Also fix the tests" }],
    activeThreadTitle: "Telegram polish",
  });

  assert.match(message, /Remodex queue/);
  assert.match(message, /Thread: Telegram polish/);
  assert.match(message, /turn running, 1 steered/);
  assert.match(message, /Steered while running/);
  assert.match(message, /Also fix the tests/);
});

test("telegram renderer accepts string Codex launch state from bridge status", () => {
  const message = renderTelegramStatus({
    bridgeStatus: {
      connectionStatus: "connected",
      codexLaunchState: "connected",
    },
  });

  assert.match(message, /Codex connected/);
});

test("telegram renderer summarizes sanitized account status", () => {
  const message = renderTelegramAccountStatus({
    status: "authenticated",
    authMethod: "chatgpt",
    email: "user@example.com",
    planType: "plus",
    tokenReady: true,
    bridgeVersion: "1.5.2",
    bridgeLatestVersion: "1.5.3",
    authToken: "secret-token",
  });

  assert.equal(
    message,
    "Account: authenticated\nEmail: user@example.com\nPlan: plus\nAuth: chatgpt (token ready)\nBridge: 1.5.2 (latest 1.5.3)"
  );
  assert.doesNotMatch(message, /secret-token/);
});

test("telegram renderer summarizes pending login cancellation", () => {
  assert.equal(
    renderTelegramCancelLoginResult({ success: true }),
    "Cancelled the pending ChatGPT sign-in on the Mac.",
  );
  assert.equal(
    renderTelegramCancelLoginResult({ success: false, reason: "no_pending_login" }),
    "No pending ChatGPT sign-in to cancel.",
  );
});

test("telegram renderer summarizes ChatGPT logout confirmation and result", () => {
  assert.match(renderTelegramLogoutConfirmation(), /Sign out of ChatGPT on this Mac/);
  assert.equal(renderTelegramLogoutResult({ success: true }), "Signed out of ChatGPT on this Mac.");
  assert.equal(renderTelegramLogoutResult({ success: false }), "Could not sign out of ChatGPT on this Mac.");
});

test("telegram renderer summarizes rate limits without raw account payload fields", () => {
  const message = renderTelegramRateLimits({
    rateLimitsByLimitId: {
      codex_5h: {
        limitId: "codex_5h",
        limitName: "codex_5h",
        primary: {
          usedPercent: 3,
          windowDurationMins: 300,
          resetsAt: 1_742_000_000,
          bearerToken: "secret-token",
        },
      },
      codex_7d: {
        primary: {
          used_percent: 6,
          window_duration_mins: 10_080,
        },
      },
    },
  }, { now: new Date("2025-03-14T00:00:00Z") });

  assert.match(message, /Rate limits:/);
  assert.match(message, /- 5h: 97% left/);
  assert.match(message, /- Weekly: 94% left/);
  assert.doesNotMatch(message, /codex_5h|bearerToken|secret-token|limitId/);
  assert.equal(renderTelegramRateLimits({}), "Rate limits: unavailable for this account.");
});

test("telegram renderer summarizes Mac thread resume without workspace paths", () => {
  const message = renderTelegramResumeResult({
    threadId: "thread-1",
    title: "Telegram native parity",
    source: "desktop",
    cwd: "/Users/user/Documents/Projects/remodex",
  });

  assert.equal(message, "Active thread: Telegram native parity\nSource: desktop");
  assert.doesNotMatch(message, /Users|Documents|Projects|remodex/);
});

test("telegram renderer explains a Pro-required access gate without billing secrets", () => {
  const message = renderTelegramAccessRequired({
    allowed: false,
    status: "requires_pro",
    message: "Remodex Telegram requires an active Remodex Pro entitlement.",
    upgradeOptions: [
      { id: "app_subscription", label: "Use the existing Remodex app subscription entitlement." },
      { id: "web_billing", label: "Unlock Remodex Pro through web billing." },
      { id: "telegram_payments", label: "Unlock Remodex Pro through Telegram Payments." },
    ],
  });

  assert.match(message, /active Remodex Pro entitlement/);
  assert.match(message, /Access: requires_pro/);
  assert.doesNotMatch(message, /Unlock routes|web billing|Telegram Payments/);
  assert.doesNotMatch(message, /session|token|chatId/i);

  const upgradeMessage = renderTelegramUpgradeInfo({
    allowed: false,
    status: "requires_pro",
  });
  assert.match(upgradeMessage, /no in-chat checkout/i);
  assert.match(upgradeMessage, /Remodex Mac app/i);
});

test("telegram renderer summarizes bridge version status", () => {
  assert.equal(
    renderTelegramVersionStatus({
      bridgeVersion: "1.5.2",
      bridgeLatestVersion: "1.5.3",
      registryUrl: "https://registry.npmjs.org/remodex/latest",
    }),
    "Bridge version: 1.5.2\nLatest published: 1.5.3\nUpdate: available on npm."
  );
  assert.equal(
    renderTelegramVersionStatus({
      bridgeVersion: "1.5.3",
      bridgeLatestVersion: "1.5.3",
    }),
    "Bridge version: 1.5.3\nLatest published: 1.5.3\nUpdate: current."
  );
  assert.equal(
    renderTelegramVersionStatus({
      bridgeVersion: "1.5.3",
    }),
    "Bridge version: 1.5.3\nLatest published: unavailable right now."
  );
});

test("telegram renderer summarizes feedback handoff without dumping mailto body", () => {
  const message = renderTelegramFeedbackResult({
    openedOnMac: true,
    mailtoUrl: "mailto:person@example.com?body=thread-sensitive-token",
  });

  assert.equal(message, "Opened Remodex feedback email on the Mac.");
  assert.doesNotMatch(message, /thread-sensitive-token|person@example/);
});

test("telegram renderer keeps git status compact", () => {
  const message = renderTelegramGitStatus({
    branch: "main",
    files: [
      { path: "a.js", status: "M" },
      { path: "b.js", status: "A" },
      { path: "secret.env", status: "M" },
    ],
  });

  assert.equal(message, "Git: 3 files changed on main. 0 staged, 3 unstaged.");
  assert.doesNotMatch(message, /secret.env/);
  assert.equal(renderTelegramGitStatus({ isRepo: false }), "Git: not a repository.");
  assert.equal(
    renderTelegramGitInitResult({ status: { branch: "main", files: [{ status: "??", path: "README.md" }] } }),
    "Git initialized on main. 1 files are ready to commit."
  );
});

test("telegram renderer summarizes diff stats without patch contents or sensitive paths", () => {
  const message = renderTelegramDiffSummary({
    changedFiles: 3,
    additions: 12,
    deletions: 4,
    files: [
      { path: "src/app.js", additions: 10, deletions: 2 },
      { path: ".env.local", additions: 1, deletions: 1 },
      { path: "assets/icon.png", additions: 0, deletions: 0, binary: true },
    ],
  });

  assert.equal(
    message,
    "Diff: 3 files changed (+12 -4).\n- src/app.js (+10 -2)\n- [sensitive path] (+1 -1)\n- assets/icon.png (+0 -0 binary)\nOpen Remodex for full patch details."
  );
  assert.doesNotMatch(message, /\.env\.local|TOKEN=/);
});

test("telegram renderer summarizes active thread activity compactly", () => {
  const message = renderTelegramThreadActivity({
    entries: [
      { role: "user", text: "Please finish the Telegram command picker." },
      { role: "assistant", text: "I added /activity and wired the button." },
      { role: "tool", text: "Ran npm test" },
    ],
    omittedEntryCount: 2,
  });

  assert.equal(
    message,
    "Activity:\n- You: Please finish the Telegram command picker.\n- Assistant: I added /activity and wired the button.\n- Tool: Ran npm test\n...and 2 more recent items.\nOpen Remodex for the full timeline."
  );
  assert.equal(
    renderTelegramThreadActivity({ entries: [] }),
    "Activity: no recent thread messages found."
  );
});

test("telegram renderer summarizes archived threads without payload details", () => {
  const message = renderTelegramArchivedThreads({
    threads: [
      { id: "thread-secret", title: "Telegram archive cleanup", cwd: "/Users/user/Documents/Projects/remodex" },
      { id: "thread-two", name: "Older work" },
    ],
  });

  assert.equal(
    message,
    "Archived threads:\n1. Telegram archive cleanup\n2. Older work\nUse /unarchive <number|id> to restore one."
  );
  assert.doesNotMatch(message, /thread-secret|Documents\/Projects/);
  assert.equal(
    renderTelegramArchivedThreads({ threads: [] }),
    "Archived: no archived Remodex threads found."
  );
  assert.equal(
    renderTelegramArchivedThreads({ threads: [{ title: "Telegram cleanup" }], query: "telegram" }),
    "Archived threads matching \"telegram\":\n1. Telegram cleanup\nUse /unarchive <number|id> to restore one."
  );
  assert.equal(
    renderTelegramArchivedThreads({ threads: [], query: "telegram" }),
    "Archived: no archived Remodex threads found matching \"telegram\"."
  );
  assert.equal(renderTelegramArchiveResult({ title: "Telegram archive cleanup" }), "Archived: Telegram archive cleanup.");
  assert.equal(renderTelegramUnarchiveResult({ title: "Telegram archive cleanup" }), "Restored archived thread: Telegram archive cleanup.");
});

test("telegram renderer summarizes workspace checkpoints without file paths", () => {
  const message = renderTelegramCheckpointResult({
    checkpoint: {
      commit: "abcdef1234567890abcdef",
      checkpointRef: "refs/remodex/checkpoints/thread/telegram-manual/1",
    },
    status: {
      branch: "remodex/telegram-support",
      files: [
        { path: "src/app.js", status: "M" },
        { path: ".env.local", status: "M" },
      ],
    },
  });

  assert.equal(
    message,
    "Checkpoint captured.\nCommit: abcdef123456\nWorkspace: 2 changed files on remodex/telegram-support.\nTelegram can preview restore impact before any destructive restore."
  );
  assert.doesNotMatch(message, /\.env\.local/);
});

test("telegram renderer summarizes checkpoint restore previews without file paths", () => {
  const message = renderTelegramCheckpointRestorePreview({
    canRestore: true,
    commit: "abcdef1234567890abcdef",
    affectedFiles: ["src/app.js", ".env.local"],
    stagedFiles: ["src/app.js"],
    untrackedFiles: [".env.local"],
  });

  assert.equal(
    message,
    "Checkpoint restore preview:\nCommit: abcdef123456\nAffected files: 2.\nWorkspace now: 1 staged, 1 untracked.\nReview carefully; Apply Restore will revert local files to this checkpoint."
  );
  assert.doesNotMatch(message, /\.env\.local|src\/app\.js/);
});

test("telegram renderer summarizes checkpoint restore apply without file paths", () => {
  const message = renderTelegramCheckpointRestoreApplyResult({
    success: true,
    backupCommit: "1234567890abcdef",
    restoredFiles: ["src/app.js", ".env.local"],
    status: {
      branch: "remodex/telegram-support",
      files: [{ path: "src/app.js", status: "M" }],
    },
  });

  assert.equal(
    message,
    "Checkpoint restored.\nRestored files: 2.\nSafety backup: 1234567890ab.\nWorkspace now: 1 changed files on remodex/telegram-support.\nOpen Remodex on the Mac for file-level review."
  );
  assert.doesNotMatch(message, /\.env\.local|src\/app\.js/);
});

test("telegram renderer summarizes context compaction without transcript details", () => {
  const message = renderTelegramCompactResult({
    threadId: "thread-secret",
    turnId: "turn-compact-123",
    replacementHistory: "Sensitive transcript",
  });

  assert.equal(
    message,
    "Context compaction started for the active thread.\nTurn: turn-compact-123\nOlder context will be summarized in Remodex."
  );
  assert.doesNotMatch(message, /thread-secret|Sensitive transcript/);
});

test("telegram renderer summarizes git log compactly", () => {
  const message = renderTelegramGitLog({
    commits: [
      { hash: "abcdef1234567890", message: "Add Telegram command picker support" },
      { hash: "1234567", message: "Wire bridge control surface" },
    ],
  });

  assert.equal(
    message,
    "Log:\n- abcdef123456 Add Telegram command picker support\n- 1234567 Wire bridge control surface"
  );
});

test("telegram renderer summarizes remotes without leaking raw URLs", () => {
  const ownerRepoMessage = renderTelegramRemote({
    ownerRepo: "acme/remodex",
    url: "https://token@example.com/acme/remodex.git",
  });
  const configuredMessage = renderTelegramRemote({
    url: "https://token@example.com/acme/remodex.git",
  });

  assert.equal(ownerRepoMessage, "Remote: acme/remodex");
  assert.doesNotMatch(ownerRepoMessage, /token|example\.com/);
  assert.equal(configuredMessage, "Remote: origin configured.");
  assert.doesNotMatch(configuredMessage, /token|example\.com/);
});

test("telegram renderer keeps branch lists compact and path-free", () => {
  const message = renderTelegramBranches({
    current: "feature/telegram",
    defaultBranch: "main",
    branches: ["feature/telegram", "main", "worktree/other"],
    branchesCheckedOutElsewhere: ["worktree/other"],
    worktreePathByBranch: {
      "worktree/other": "/private/path/to/worktree",
    },
    status: {
      files: [{ path: "secret.env", status: "M" }],
    },
  });

  assert.equal(
    message,
    "Branches: current feature/telegram\n* feature/telegram\n- main (default)\n- worktree/other (open elsewhere)\n1 changed files in the working tree."
  );
  assert.doesNotMatch(message, /private\/path|secret\.env/);
});

test("telegram renderer summarizes checkout results", () => {
  assert.equal(
    renderTelegramCheckoutResult({
      current: "feature/telegram",
      status: { files: [{ path: "a.js", status: " M" }] },
    }),
    "Checked out feature/telegram. 1 changed files remain in the working tree."
  );
});

test("telegram renderer summarizes create branch results", () => {
  assert.equal(
    renderTelegramCreateBranchResult({
      branch: "remodex/telegram-support",
      status: { files: [{ path: "a.js", status: " M" }, { path: "secret.env", status: "??" }] },
    }),
    "Created and switched to remodex/telegram-support. 2 changed files remain in the working tree."
  );
});

test("telegram renderer summarizes pull and stash results", () => {
  assert.equal(
    renderTelegramPullResult({
      status: { branch: "main", files: [{ path: "a.js", status: " M" }] },
    }),
    "Pull: complete on main. 1 changed files remain in the working tree."
  );
  assert.equal(renderTelegramStashResult({ success: true }), "Stash: saved local changes.");
  assert.equal(renderTelegramStashResult({ success: false }), "Stash: no local changes to save.");
  assert.equal(renderTelegramStashPopResult({ success: true }), "Stash pop: applied latest stash.");
  assert.equal(renderTelegramStashPopResult({ success: false }), "Stash pop: no stash applied.");
});

test("telegram renderer summarizes reset-to-remote confirmation and result without paths", () => {
  const confirmation = renderTelegramResetRemoteConfirmation({
    branch: "main",
    files: [
      { path: "src/app.js", status: "M " },
      { path: ".env.local", status: " M" },
      { path: "scratch.txt", status: "??" },
    ],
  });
  const result = renderTelegramResetRemoteResult({
    status: {
      branch: "main",
      files: [{ path: ".env.local", status: " M" }],
    },
  });

  assert.equal(
    confirmation,
    "Reset to remote?\nBranch: main\nLocal changes: 3 files (1 staged, 2 unstaged).\nThis will discard local changes and untracked files in the active thread project."
  );
  assert.doesNotMatch(confirmation, /\.env\.local|src\/app\.js|scratch\.txt/);
  assert.equal(
    result,
    "Reset to remote complete.\nBranch: main\nWorkspace now: 1 changed files."
  );
  assert.doesNotMatch(result, /\.env\.local/);
  assert.equal(renderTelegramResetRemoteConfirmation({ isRepo: false }), "Reset to remote: not a git repository.");
});

test("telegram renderer summarizes context and Mac controls", () => {
  assert.equal(
    renderTelegramContextWindow({ usage: { tokensUsed: 200_930, tokenLimit: 258_400 } }),
    "Context: 200,930 / 258,400 tokens (78%)."
  );
  assert.equal(renderTelegramContextWindow({ usage: null }), "Context: no recent usage found for the active thread.");
  assert.equal(
    renderTelegramOpenMacResult({ success: true, relaunched: true }),
    "Opened the active thread on Mac after relaunching Codex."
  );
  assert.equal(renderTelegramWakeMacResult({ success: true, durationSeconds: 30 }), "Woke the Mac display for 30s.");
});

test("telegram renderer summarizes combined usage without raw rate limit fields", () => {
  const text = renderTelegramUsageStatus({
    context: { usage: { tokensUsed: 200_930, tokenLimit: 258_400 } },
    rateLimits: {
      rateLimitsByLimitId: {
        codex_5h: {
          limitId: "codex_5h",
          primary: {
            usedPercent: 20,
            windowDurationMins: 300,
            token: "secret-token",
          },
        },
      },
    },
  });

  assert.equal(text, "Usage:\nContext: 200,930 / 258,400 tokens (78%).\nRate limits:\n- 5h: 80% left");
  assert.doesNotMatch(text, /codex_5h|secret-token/);
  assert.equal(
    renderTelegramUsageStatus({ rateLimits: null }),
    "Usage:\nContext: no active thread selected.\nRate limits: unavailable for this account."
  );
});

test("telegram renderer summarizes login and rename results", () => {
  assert.equal(renderTelegramLoginResult({ success: true }), "Opened ChatGPT sign-in on the Mac.");
  assert.equal(renderTelegramLoginResult({ success: false }), "Could not open ChatGPT sign-in on the Mac.");
  assert.equal(
    shouldBlockTelegramCodexInput({ status: "expired", needsReauth: true, tokenReady: false }),
    true,
  );
  assert.equal(
    shouldBlockTelegramCodexInput({ status: "expired", needsReauth: true, tokenReady: true }),
    false,
  );
  assert.equal(
    shouldBlockTelegramCodexInput({ status: "authenticated", tokenReady: true }),
    false,
  );
  assert.match(
    renderTelegramCodexInputBlocked({ status: "expired", needsReauth: true }),
    /login expired/i,
  );
  assert.equal(
    renderTelegramRenameResult({ title: "Ship Telegram controls" }),
    "Renamed active thread: Ship Telegram controls"
  );
  assert.equal(
    renderTelegramGeneratedTitleResult({ title: "Ship Telegram controls" }),
    "Generated active thread title: Ship Telegram controls"
  );
});

test("telegram renderer summarizes fork results without dumping full paths", () => {
  const message = renderTelegramForkResult({
    thread: {
      id: "thread-sensitive",
      title: "Forked work",
      cwd: "/Users/user/Documents/Projects/remodex/phodex-bridge",
    },
  });

  assert.equal(message, "Forked active thread: Forked work\nProject: remodex");
  assert.doesNotMatch(message, /thread-sensitive|Documents\/Projects/);
});

test("telegram renderer summarizes worktree thread results without dumping full paths", () => {
  const message = renderTelegramWorktreeThreadResult({
    worktree: {
      branch: "remodex/telegram-worktree",
      worktreePath: "/Users/user/.codex/worktrees/remodex/abc123/phodex-bridge",
    },
    thread: {
      id: "thread-sensitive",
      title: "Telegram worktree",
      cwd: "/Users/user/.codex/worktrees/remodex/abc123/phodex-bridge",
    },
  });

  assert.equal(
    message,
    "Created worktree: remodex/telegram-worktree\nNew active thread: Telegram worktree\nProject: abc123"
  );
  assert.doesNotMatch(message, /thread-sensitive|\.codex\/worktrees/);
});

test("telegram renderer summarizes bridge preferences", () => {
  assert.equal(
    renderTelegramPreferences({ preferences: { keepMacAwake: true }, applied: true }),
    "Preferences:\nKeep Mac awake: on (active)"
  );
  assert.equal(
    renderTelegramPreferences({ preferences: { keepMacAwake: false }, applied: false }),
    "Preferences:\nKeep Mac awake: off"
  );
});

test("telegram renderer summarizes local Codex pets without preview assets", () => {
  const message = renderTelegramPets({
    pets: [{
      displayName: "Icarus",
      kind: "pet",
      spritesheetDataUrl: "data:image/png;base64,SECRET",
      spritesheetPath: "/Users/user/.codex/pets/icarus/spritesheet.png",
    }],
    errors: [{ folderName: "broken-pet", errorCode: "pet_spritesheet_path_invalid" }],
  });

  assert.equal(
    message,
    "Codex pets: 1 available.\n- Icarus (pet)\n1 local package errors hidden.\nOpen Remodex on the Mac to preview or choose one."
  );
  assert.doesNotMatch(message, /data:image|SECRET|\/Users\/user|spritesheet/);
});

test("telegram renderer handles an empty local Codex pet inventory", () => {
  assert.equal(renderTelegramPets({ pets: [], errors: [] }), "Codex pets: none found on this Mac.");
  assert.equal(
    renderTelegramPets({ pets: [], errors: [{ folderName: "broken-pet" }] }),
    "Codex pets: none available. 1 local package errors. Open Remodex on the Mac for details."
  );
});

test("telegram renderer summarizes active-thread skills without local paths", () => {
  const message = renderTelegramSkills({
    query: "front",
    data: [{
      cwd: "/Users/user/Documents/Projects/remodex",
      skills: [
        {
          name: "frontend-refactor",
          description: "Improve existing client surfaces without churn.",
          path: "/Users/user/.agents/skills/frontend-refactor/SKILL.md",
          scope: "project",
          enabled: true,
        },
        {
          name: "backend-cleanup",
          description: "Server internals.",
          path: "/Users/user/.agents/skills/backend-cleanup/SKILL.md",
        },
      ],
    }],
  });

  assert.match(message, /Skills matching "front": 1 available\./);
  assert.match(message, /- frontend-refactor \(project\)/);
  assert.match(message, /Improve existing client surfaces/);
  assert.doesNotMatch(message, /\/Users\/user|SKILL\.md|backend-cleanup/);
});

test("telegram renderer summarizes active-thread plugins without marketplace paths", () => {
  const message = renderTelegramPlugins({
    marketplaces: [{
      name: "openai-curated",
      path: "/Users/user/.codex/plugins/cache/openai-curated",
      plugins: [{
        id: "github@openai-curated",
        name: "github",
        installed: true,
        enabled: false,
        installPolicy: null,
        interface: {
          displayName: "GitHub",
          shortDescription: "Inspect repositories and pull requests.",
        },
      }],
    }],
  });

  assert.match(message, /Plugins: 1 available\./);
  assert.match(message, /- GitHub \(openai-curated\)/);
  assert.match(message, /Inspect repositories and pull requests\./);
  assert.doesNotMatch(message, /\/Users\/user|plugins\/cache|github@openai-curated/);
});

test("telegram renderer summarizes Telegram runtime preferences", () => {
  const message = renderTelegramModelPreferences({
    runtimeModel: "gpt-5.4-mini",
    reasoningEffort: "high",
    runtimeServiceTier: "fast",
    runtimeAccessMode: "full-access",
  });

  assert.match(message, /Model: GPT-5\.4 Mini \(gpt-5\.4-mini\)/);
  assert.match(message, /Reasoning: High \(high\)/);
  assert.match(message, /Speed: Fast \(fast\)/);
  assert.match(message, /Access: Full Access \(full-access\)/);
  assert.match(message, /Usage: \/model/);
  assert.match(message, /normal\|fast/);
  assert.match(message, /Access: \/access/);
});

test("telegram renderer summarizes local project choices without dumping full paths", () => {
  const message = renderTelegramProjects({
    query: "remodex",
    projects: [
      { name: "remodex", path: "/Users/user/Documents/Projects/remodex" },
      { label: "scratch", path: "/Users/user/Developer/scratch" },
    ],
  });

  assert.equal(
    message,
    'Projects matching "remodex":\n- remodex (Projects)\n- scratch (Developer)'
  );
  assert.doesNotMatch(message, /\/Users\/user/);
});

test("telegram renderer summarizes browsed project folders without dumping full paths", () => {
  const message = renderTelegramProjectDirectory({
    path: "/Users/user/Documents/Projects",
    parentPath: "/Users/user/Documents",
    entries: [
      { name: "remodex", path: "/Users/user/Documents/Projects/remodex" },
      { label: "scratch", path: "/Users/user/Documents/Projects/scratch" },
    ],
  });

  assert.equal(message, "Folder: Projects\n- remodex\n- scratch");
  assert.doesNotMatch(message, /\/Users\/user/);
});

test("telegram renderer summarizes created project folders without dumping full paths", () => {
  const message = renderTelegramProjectCreateDirectoryResult({
    name: "Client App",
    path: "/Users/user/Documents/Projects/Client App",
    parentPath: "/Users/user/Documents/Projects",
  });

  assert.equal(message, "Created folder: Client App\nIn: Projects\nUse the buttons below to open it or start a thread there.");
  assert.doesNotMatch(message, /\/Users\/user/);
});

test("telegram renderer summarizes stacked git action results", () => {
  assert.equal(
    renderTelegramStackedActionResult({
      action: "commit_push_pr",
      status: { branch: "remodex/telegram-support" },
      commit: { status: "created", subject: "Add Telegram support", commitSha: "abc123" },
      push: { state: "pushed" },
      pr: { url: "https://github.com/acme/remodex/pull/7" },
    }),
    [
      "Git ship completed.",
      "Branch: remodex/telegram-support",
      "Commit: Add Telegram support",
      "Push: complete.",
      "PR: https://github.com/acme/remodex/pull/7",
    ].join("\n")
  );
});

test("telegram renderer summarizes commit and PR drafts without implying action was taken", () => {
  assert.equal(
    renderTelegramCommitDraft({
      subject: "Add Telegram draft commands",
      body: "- Wire commit draft output\n- Keep commits explicit",
      fullMessage: "Add Telegram draft commands\n\n- Wire commit draft output\n- Keep commits explicit",
    }),
    "Commit draft: Add Telegram draft commands\n- Wire commit draft output\n- Keep commits explicit\nUse /commit <message> to apply it."
  );
  assert.equal(
    renderTelegramPullRequestDraft({
      title: "Add Telegram draft commands",
      body: "## Summary\n- Wire PR draft output\n\n## Testing\n- node --test",
    }),
    "PR draft: Add Telegram draft commands\n## Summary\n- Wire PR draft output\n\n## Testing\n- node --test\nUse /pr to create or open the pull request."
  );
});

test("telegram renderer keeps approval requests compact but actionable", () => {
  const message = renderTelegramApprovalRequest({
    method: "item/commandExecution/requestApproval",
    params: {
      command: "npm test -- --watch=false",
      reason: "Verify the Telegram bridge before shipping",
      cwd: "/private/project",
    },
    context: {
      threadTitle: "Telegram bridge",
      threadId: "thread-1",
      branch: "feat/telegram-bridge",
    },
  });

  assert.match(message, /Approval needed: command/);
  assert.match(message, /Thread: Telegram bridge/);
  assert.match(message, /Branch: feat\/telegram-bridge/);
  assert.match(message, /Why: Verify the Telegram bridge/);
  assert.match(message, /Command: npm test/);
  assert.match(message, /lock screen/);
  assert.doesNotMatch(message, /private\/project/);
});

test("telegram renderer keeps user input requests compact and answerable", () => {
  const message = renderTelegramUserInputRequest({
    params: {
      questions: [{
        id: "q1",
        header: "Mode",
        question: "Choose the next step",
        options: [
          { label: "Continue", description: "Proceed with the current plan" },
          { label: "Stop", description: "Pause this turn" },
        ],
      }],
    },
  });

  assert.match(message, /Codex needs input/);
  assert.match(message, /Mode: Choose the next step/);
  assert.match(message, /Continue: Proceed with the current plan/);
  assert.match(message, /Choose an option below/);
});

test("telegram renderer tells chats how to answer freeform user input", () => {
  const message = renderTelegramUserInputRequest({
    params: {
      questions: [{
        id: "q1",
        header: "Clarify",
        question: "What should Codex do next?",
      }],
    },
  });

  assert.match(message, /Clarify: What should Codex do next/);
  assert.match(message, /Reply with \/answer <response>/);
});

test("telegram renderer tells chats how to answer multi-question user input", () => {
  const message = renderTelegramUserInputRequest({
    params: {
      questions: [
        { id: "goal", header: "Goal", question: "What outcome should Codex optimize for?" },
        { id: "risk", header: "Risk", question: "What should Codex avoid?" },
      ],
    },
  });

  assert.match(message, /1\. Goal: What outcome should Codex optimize for/);
  assert.match(message, /2\. Risk: What should Codex avoid/);
  assert.match(message, /Reply with \/answer and put one response per line/);
});

test("telegram renderer keeps active-thread events compact", () => {
  assert.equal(
    renderTelegramThreadEvent({ method: "turn/started", params: { threadId: "thread-1" } }),
    ""
  );
  assert.equal(
    renderTelegramThreadEvent({ method: "turn/completed", params: { threadId: "thread-1" } }),
    "Remodex finished the active turn."
  );
  assert.equal(
    renderTelegramThreadEvent({
      method: "codex/event/agent_message",
      params: { message: "Done without leaking relay session ids." },
    }),
    "Done without leaking relay session ids."
  );
});

test("telegram renderer emits safe link and unauthorized copy", () => {
  assert.equal(
    renderTelegramLinkInstructions({ code: "ABC234", expiresAt: 1_800_000_300_000 }),
    "Telegram link code: ABC234\nSend /link ABC234 to your Remodex Telegram bot. Expires: 2027-01-15T08:05:00.000Z"
  );
  assert.equal(renderUnauthorizedTelegramChat(), "This Telegram chat is not linked to this Remodex bridge.");
  assert.equal(
    renderTelegramLinkHelp(),
    "This Telegram chat is not linked to this Remodex bridge.\nOn the Mac, run: remodex telegram link\nThen send the short-lived code here with /link <code>.\nKeep the code private."
  );
  assert.doesNotMatch(renderTelegramLinkHelp(), /ABC234|sessionId|telegramBotToken/i);
});
