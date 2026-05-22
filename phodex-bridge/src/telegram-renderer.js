// FILE: telegram-renderer.js
// Purpose: Renders compact Telegram control-surface messages without leaking sensitive payloads.
// Layer: CLI helper
// Exports: Telegram message renderers.

const {
  TELEGRAM_ACCESS_MODE_CHOICES,
  TELEGRAM_MODEL_CHOICES,
  TELEGRAM_REASONING_EFFORT_CHOICES,
  TELEGRAM_SERVICE_TIER_CHOICES,
  normalizeTelegramAccessMode,
  normalizeTelegramRuntimePreferences,
  telegramAccessModeLabel,
  telegramModelLabel,
  telegramReasoningEffortLabel,
  telegramServiceTierLabel,
} = require("./telegram-runtime-preferences");
const { TELEGRAM_MESSAGE_TEXT_MAX_CHARS } = require("./telegram-bot-api-client");

function renderTelegramStatus({
  bridgeStatus = null,
  activeThread = null,
  macName = "",
  gitStatus = null,
  contextWindow = null,
  runtimePreferences = null,
  queueState = null,
  access = null,
} = {}) {
  const bridgeLabel = normalizeNonEmptyString(bridgeStatus?.connectionStatus)
    || normalizeNonEmptyString(bridgeStatus?.state)
    || "unknown";
  const bridgeVersion = normalizeNonEmptyString(bridgeStatus?.bridgeVersion)
    || normalizeNonEmptyString(bridgeStatus?.version);
  const codexLabel = normalizeNonEmptyString(bridgeStatus?.codexLaunchState?.status)
    || normalizeNonEmptyString(bridgeStatus?.codexLaunchState?.state)
    || normalizeNonEmptyString(bridgeStatus?.codexLaunchState)
    || "unknown";
  const macLabel = normalizeNonEmptyString(macName)
    || normalizeNonEmptyString(bridgeStatus?.macName)
    || normalizeNonEmptyString(bridgeStatus?.displayName)
    || "Mac";
  const activeTitle = normalizeNonEmptyString(activeThread?.title)
    || normalizeNonEmptyString(activeThread?.name)
    || "none";
  const lines = [
    "Remodex status",
    `${macLabel} · ${bridgeLabel}`,
    `Bridge ${bridgeVersion || "unknown"} · Codex ${codexLabel}`,
    "",
    `Thread: ${truncateTelegramLine(activeTitle, 120)}`,
  ];

  const branch = normalizeNonEmptyString(gitStatus?.branch)
    || normalizeNonEmptyString(gitStatus?.currentBranch);
  if (gitStatus?.isRepo === false) {
    lines.push("Branch: not a git repository");
  } else if (branch) {
    lines.push(`Branch: ${truncateTelegramLine(branch, 96)}`);
  } else {
    lines.push("Branch: unavailable");
  }

  lines.push(renderTelegramContextWindow(contextWindow));

  if (runtimePreferences) {
    const runtime = normalizeTelegramRuntimePreferences(runtimePreferences);
    const accessMode = normalizeTelegramAccessMode(
      runtimePreferences.runtimeAccessMode || runtimePreferences.accessMode,
    ) || "on-request";
    const speedLabel = runtime.serviceTier
      ? telegramServiceTierLabel(runtime.serviceTier)
      : "Normal";
    lines.push(
      `Model: ${telegramModelLabel(runtime.model)} · ${telegramReasoningEffortLabel(runtime.reasoningEffort)} · ${speedLabel}`,
    );
    lines.push(`Access mode: ${telegramAccessModeLabel(accessMode)}`);
  }

  const queueLabel = renderTelegramQueueState(queueState);
  if (queueLabel) {
    lines.push(queueLabel);
  }

  const accessLabel = renderTelegramAccessStateLine(access);
  if (accessLabel) {
    lines.push(accessLabel);
  }

  return lines.join("\n");
}

function renderTelegramQueueState(queueState = {}) {
  const pendingApprovals = Number.isFinite(queueState?.pendingApprovals)
    ? queueState.pendingApprovals
    : 0;
  const pendingUserInput = Number.isFinite(queueState?.pendingUserInput)
    ? queueState.pendingUserInput
    : 0;
  const outboundQueued = Number.isFinite(queueState?.outboundQueued)
    ? queueState.outboundQueued
    : 0;
  const steerQueued = Number.isFinite(queueState?.steerQueued)
    ? queueState.steerQueued
    : 0;
  const runningTurn = queueState?.runningTurn === true;

  const parts = [];
  if (runningTurn) {
    parts.push("turn running");
  }
  if (steerQueued > 0) {
    parts.push(`${steerQueued} steered`);
  }
  if (pendingApprovals > 0) {
    parts.push(`${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"}`);
  }
  if (pendingUserInput > 0) {
    parts.push(`${pendingUserInput} prompt${pendingUserInput === 1 ? "" : "s"}`);
  }
  if (outboundQueued > 0) {
    parts.push(`${outboundQueued} outbound`);
  }

  if (parts.length === 0) {
    return "Queue: idle";
  }
  return `Queue: ${parts.join(", ")}`;
}

function renderTelegramQueueDetail({
  queueState = {},
  steerQueue = [],
  activeThreadTitle = "",
} = {}) {
  const lines = ["Remodex queue"];
  if (activeThreadTitle) {
    lines.push(`Thread: ${truncateTelegramLine(activeThreadTitle, 80)}`);
  }
  const summary = renderTelegramQueueState(queueState);
  if (summary) {
    lines.push(summary);
  }

  const steered = Array.isArray(steerQueue) ? steerQueue : [];
  if (steered.length > 0) {
    lines.push("");
    lines.push("Steered while running:");
    for (const [index, entry] of steered.entries()) {
      const preview = normalizeNonEmptyString(entry?.text);
      if (!preview) {
        continue;
      }
      lines.push(`${index + 1}. ${truncateTelegramLine(preview, 160)}`);
    }
  }

  if (
    !queueState?.runningTurn
    && (queueState?.pendingApprovals || 0) === 0
    && (queueState?.pendingUserInput || 0) === 0
    && (queueState?.outboundQueued || 0) === 0
    && steered.length === 0
  ) {
    lines.push("Nothing queued. Send text during a run to steer, or wait for Codex to ask.");
  } else if ((queueState?.pendingApprovals || 0) > 0 || (queueState?.pendingUserInput || 0) > 0) {
    lines.push("Use /pending to reopen prompts and approvals.");
  }

  return lines.join("\n");
}

function renderTelegramAccessStateLine(access = {}) {
  const allowed = access?.allowed !== false;
  const status = normalizeNonEmptyString(access?.status);
  if (allowed) {
    return status ? `Entitlement: ${status}` : "Entitlement: Pro active";
  }
  return status ? `Entitlement: ${status}` : "Entitlement: requires Pro";
}

function renderTelegramAccountStatus(status = {}) {
  const accountStatus = normalizeNonEmptyString(status.status) || "unknown";
  const authMethod = normalizeNonEmptyString(status.authMethod);
  const email = normalizeNonEmptyString(status.email);
  const planType = normalizeNonEmptyString(status.planType);
  const bridgeVersion = normalizeNonEmptyString(status.bridgeVersion);
  const latestVersion = normalizeNonEmptyString(status.bridgeLatestVersion);
  const lines = [`Account: ${accountStatus}`];
  if (email) {
    lines.push(`Email: ${truncateTelegramLine(email, 120)}`);
  }
  if (planType) {
    lines.push(`Plan: ${truncateTelegramLine(planType, 80)}`);
  }
  if (authMethod) {
    lines.push(`Auth: ${authMethod}${status.tokenReady ? " (token ready)" : ""}`);
  }
  if (status.needsReauth) {
    lines.push(status.tokenReady
      ? "Reauth recommended when convenient (Codex input still works)."
      : "Reauth required.");
  }
  if (status.loginInFlight) {
    lines.push("Login is in progress on this Mac.");
  }
  if (bridgeVersion || latestVersion) {
    lines.push(`Bridge: ${bridgeVersion || "unknown"}${latestVersion ? ` (latest ${latestVersion})` : ""}`);
  }
  return lines.join("\n");
}

function renderTelegramRateLimits(result = {}, { now = new Date() } = {}) {
  const rows = visibleRateLimitRows(decodeRateLimitBuckets(result));
  if (rows.length === 0) {
    return "Rate limits: unavailable for this account.";
  }

  const lines = ["Rate limits:"];
  for (const row of rows.slice(0, 8)) {
    const reset = rateLimitResetLabel(row.window, now);
    lines.push(`- ${truncateTelegramLine(row.label, 64)}: ${row.window.remainingPercent}% left${reset ? ` (${reset})` : ""}`);
  }
  if (rows.length > 8) {
    lines.push(`...and ${rows.length - 8} more.`);
  }
  return lines.join("\n");
}

function renderTelegramUsageStatus(result = {}, { now = new Date() } = {}) {
  const lines = ["Usage:"];
  if (result.context) {
    lines.push(renderTelegramContextWindow(result.context));
  } else if (normalizeNonEmptyString(result.errors?.context)) {
    lines.push(`Context: ${truncateTelegramLine(result.errors.context, 120)}`);
  } else {
    lines.push("Context: no active thread selected.");
  }

  if (result.rateLimits) {
    lines.push(renderTelegramRateLimits(result.rateLimits, { now }));
  } else if (normalizeNonEmptyString(result.errors?.rateLimits)) {
    lines.push(`Rate limits: ${truncateTelegramLine(result.errors.rateLimits, 120)}`);
  } else {
    lines.push("Rate limits: unavailable for this account.");
  }
  return lines.join("\n");
}

function renderTelegramVersionStatus(status = {}) {
  const bridgeVersion = normalizeNonEmptyString(status.bridgeVersion);
  const latestVersion = normalizeNonEmptyString(status.bridgeLatestVersion);
  const lines = [`Bridge version: ${bridgeVersion || "unknown"}`];
  if (latestVersion) {
    lines.push(`Latest published: ${latestVersion}`);
    lines.push(bridgeVersion && bridgeVersion !== latestVersion
      ? "Update: available on npm."
      : "Update: current.");
  } else {
    lines.push("Latest published: unavailable right now.");
  }
  return lines.join("\n");
}

function renderTelegramFeedbackResult(result = {}) {
  if (result.openedOnMac) {
    return "Opened Remodex feedback email on the Mac.";
  }
  if (normalizeNonEmptyString(result.mailtoUrl)) {
    return "Prepared Remodex feedback email. Open Remodex on the Mac if the mail app did not appear.";
  }
  return "Prepared Remodex feedback email.";
}

function renderTelegramResumeResult(result = {}) {
  const title = normalizeNonEmptyString(result.title)
    || normalizeNonEmptyString(result.name)
    || normalizeNonEmptyString(result.threadId)
    || "selected thread";
  const lines = [`Active thread: ${truncateTelegramLine(title, 120)}`];
  const source = normalizeNonEmptyString(result.source);
  if (source) {
    lines.push(`Source: ${truncateTelegramLine(source, 80)}`);
  }
  return lines.join("\n");
}

function renderTelegramAccessRequired(access = {}) {
  const message = normalizeNonEmptyString(access.message)
    || "Remodex Telegram requires an active Remodex Pro entitlement.";
  const status = normalizeNonEmptyString(access.status) || "requires_pro";
  const allowed = access.allowed !== false;
  const lines = [
    message,
    `Access: ${status}`,
  ];
  lines.push(allowed
    ? "Use /account to refresh local account status."
    : "Use /account or /login to refresh the local entitlement, or /feedback if this looks wrong.");
  return lines.join("\n");
}

function renderTelegramUpgradeInfo(access = {}) {
  const allowed = access.allowed !== false;
  const lines = [
    "Remodex Telegram uses the Remodex Pro entitlement on this Mac.",
    allowed
      ? "This chat currently has Pro access."
      : "This chat does not currently have Pro access.",
    "Purchase or restore Pro in the Remodex Mac app, then run /account to refresh local status.",
    "There is no in-chat checkout. Billing stays on the Mac.",
  ];
  return lines.join("\n");
}

function renderTelegramGitStatus(status = {}) {
  if (status.isRepo === false) {
    return "Git: not a repository.";
  }
  const branch = normalizeNonEmptyString(status.branch) || normalizeNonEmptyString(status.currentBranch) || "unknown";
  const files = Array.isArray(status.files) ? status.files : [];
  const staged = files.filter((file) => isStagedGitFile(file)).length;
  const unstaged = Math.max(0, files.length - staged);
  return `Git: ${files.length} files changed on ${branch}. ${staged} staged, ${unstaged} unstaged.`;
}

function renderTelegramGitInitResult(result = {}) {
  const status = result.status || result;
  const branch = normalizeNonEmptyString(status.branch || status.currentBranch) || "main";
  const files = Array.isArray(status.files) ? status.files : [];
  const suffix = files.length > 0
    ? ` ${files.length} files are ready to commit.`
    : "";
  return `Git initialized on ${branch}.${suffix}`;
}

function renderTelegramDiffSummary(summary = {}) {
  const changedFiles = Number.isFinite(summary.changedFiles) ? summary.changedFiles : 0;
  if (changedFiles <= 0) {
    return "Diff: no changed files.";
  }

  const additions = Number.isFinite(summary.additions) ? summary.additions : 0;
  const deletions = Number.isFinite(summary.deletions) ? summary.deletions : 0;
  const files = Array.isArray(summary.files) ? summary.files : [];
  const lines = [`Diff: ${changedFiles} files changed (+${additions} -${deletions}).`];
  for (const file of files.slice(0, 6)) {
    const label = safeTelegramDiffPath(file.path);
    const binary = file.binary === true ? " binary" : "";
    const fileAdditions = Number.isFinite(file.additions) ? file.additions : 0;
    const fileDeletions = Number.isFinite(file.deletions) ? file.deletions : 0;
    lines.push(`- ${truncateTelegramLine(label, 96)} (+${fileAdditions} -${fileDeletions}${binary})`);
  }
  if (files.length > 6) {
    lines.push(`...and ${files.length - 6} more files.`);
  }
  lines.push("Open Remodex for full patch details.");
  return lines.join("\n");
}

function renderTelegramGitLog(logResult = {}) {
  const commits = Array.isArray(logResult.commits) ? logResult.commits : [];
  if (commits.length === 0) {
    return "Log: no commits found.";
  }
  const lines = ["Log:"];
  for (const commit of commits.slice(0, 5)) {
    const hash = normalizeNonEmptyString(commit.hash) || "unknown";
    const message = normalizeNonEmptyString(commit.message) || "(no subject)";
    lines.push(`- ${shortCommitHash(hash)} ${truncateTelegramLine(message, 90)}`);
  }
  if (commits.length > 5) {
    lines.push(`...and ${commits.length - 5} more commits.`);
  }
  return lines.join("\n");
}

function renderTelegramRemote(remoteResult = {}) {
  const ownerRepo = normalizeNonEmptyString(remoteResult.ownerRepo);
  if (ownerRepo) {
    return `Remote: ${truncateTelegramLine(ownerRepo, 120)}`;
  }
  if (normalizeNonEmptyString(remoteResult.url)) {
    return "Remote: origin configured.";
  }
  return "Remote: none configured.";
}

function renderTelegramBranches(branchesResult = {}) {
  const status = branchesResult.status || {};
  if (status.isRepo === false) {
    return "Branches: not a git repository.";
  }

  const current = normalizeNonEmptyString(branchesResult.current || status.branch) || "unknown";
  const defaultBranch = normalizeNonEmptyString(branchesResult.defaultBranch || branchesResult.default);
  const branchNames = Array.isArray(branchesResult.branches) ? branchesResult.branches : [];
  const elsewhere = new Set(Array.isArray(branchesResult.branchesCheckedOutElsewhere)
    ? branchesResult.branchesCheckedOutElsewhere
    : []);
  const files = Array.isArray(status.files) ? status.files : [];
  const lines = [`Branches: current ${current}`];

  for (const branch of branchNames.slice(0, 10)) {
    const normalizedBranch = normalizeNonEmptyString(branch);
    if (!normalizedBranch) {
      continue;
    }
    const marker = normalizedBranch === current ? "*" : "-";
    const labels = [];
    if (normalizedBranch === defaultBranch) {
      labels.push("default");
    }
    if (elsewhere.has(normalizedBranch)) {
      labels.push("open elsewhere");
    }
    const suffix = labels.length ? ` (${labels.join(", ")})` : "";
    lines.push(`${marker} ${truncateTelegramLine(normalizedBranch, 80)}${suffix}`);
  }

  if (branchNames.length > 10) {
    lines.push(`...and ${branchNames.length - 10} more branches.`);
  }
  if (files.length > 0) {
    lines.push(`${files.length} changed files in the working tree.`);
  }
  return lines.join("\n");
}

function renderTelegramCheckoutResult(result = {}) {
  const current = normalizeNonEmptyString(result.current || result.branch || result.status?.branch) || "unknown";
  const files = Array.isArray(result.status?.files) ? result.status.files : [];
  const suffix = files.length > 0
    ? ` ${files.length} changed files remain in the working tree.`
    : "";
  return `Checked out ${current}.${suffix}`;
}

function renderTelegramCreateBranchResult(result = {}) {
  const branch = normalizeNonEmptyString(result.branch || result.status?.branch) || "unknown";
  const files = Array.isArray(result.status?.files) ? result.status.files : [];
  const suffix = files.length > 0
    ? ` ${files.length} changed files remain in the working tree.`
    : "";
  return `Created and switched to ${branch}.${suffix}`;
}

function renderTelegramPullResult(result = {}) {
  const status = result.status || {};
  const branch = normalizeNonEmptyString(status.branch) || "current branch";
  const files = Array.isArray(status.files) ? status.files : [];
  const suffix = files.length > 0
    ? ` ${files.length} changed files remain in the working tree.`
    : "";
  return `Pull: complete on ${branch}.${suffix}`;
}

function renderTelegramResetRemoteConfirmation(status = {}) {
  if (status.isRepo === false) {
    return "Reset to remote: not a git repository.";
  }
  const branch = normalizeNonEmptyString(status.branch || status.currentBranch) || "current branch";
  const files = Array.isArray(status.files) ? status.files : [];
  const staged = files.filter((file) => isStagedGitFile(file)).length;
  const unstaged = Math.max(0, files.length - staged);
  return [
    "Reset to remote?",
    `Branch: ${truncateTelegramLine(branch, 96)}`,
    `Local changes: ${files.length} files (${staged} staged, ${unstaged} unstaged).`,
    "This will discard local changes and untracked files in the active thread project.",
  ].join("\n");
}

function renderTelegramResetRemoteResult(result = {}) {
  const status = result.status || {};
  const branch = normalizeNonEmptyString(status.branch || status.currentBranch) || "current branch";
  const files = Array.isArray(status.files) ? status.files : [];
  return [
    "Reset to remote complete.",
    `Branch: ${truncateTelegramLine(branch, 96)}`,
    `Workspace now: ${files.length} changed files.`,
  ].join("\n");
}

function renderTelegramStashResult(result = {}) {
  return result.success
    ? "Stash: saved local changes."
    : "Stash: no local changes to save.";
}

function renderTelegramStashPopResult(result = {}) {
  return result.success
    ? "Stash pop: applied latest stash."
    : "Stash pop: no stash applied.";
}

function renderTelegramContextWindow(result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result) ? result : {};
  const usage = source.usage || {};
  const tokensUsed = Number.isFinite(usage.tokensUsed) ? usage.tokensUsed : null;
  const tokenLimit = Number.isFinite(usage.tokenLimit) ? usage.tokenLimit : null;
  if (tokensUsed == null || tokenLimit == null || tokenLimit <= 0) {
    return "Context: no recent usage found for the active thread.";
  }
  const percent = Math.min(100, Math.round((tokensUsed / tokenLimit) * 100));
  return `Context: ${formatCount(tokensUsed)} / ${formatCount(tokenLimit)} tokens (${percent}%).`;
}

function renderTelegramThreadActivity(result = {}) {
  const entries = Array.isArray(result.entries) ? result.entries : [];
  if (entries.length === 0) {
    return "Activity: no recent thread messages found.";
  }
  const lines = ["Activity:"];
  for (const entry of entries.slice(0, 8)) {
    const role = formatActivityRole(entry.role);
    const text = truncateTelegramLine(entry.text, 220);
    if (!text) {
      continue;
    }
    lines.push(`- ${role}: ${text}`);
  }
  if (Number.isFinite(result.omittedEntryCount) && result.omittedEntryCount > 0) {
    lines.push(`...and ${result.omittedEntryCount} more recent items.`);
  }
  lines.push("Open Remodex for the full timeline.");
  return lines.join("\n");
}

function renderTelegramArchivedThreads(result = {}) {
  const threads = Array.isArray(result.threads) ? result.threads : [];
  const query = normalizeNonEmptyString(result.query);
  if (threads.length === 0) {
    return query
      ? `Archived: no archived Remodex threads found matching "${truncateTelegramLine(query, 80)}".`
      : "Archived: no archived Remodex threads found.";
  }

  const lines = [query
    ? `Archived threads matching "${truncateTelegramLine(query, 80)}":`
    : "Archived threads:"];
  for (const [index, thread] of threads.slice(0, 10).entries()) {
    const title = normalizeNonEmptyString(thread.title || thread.name) || normalizeNonEmptyString(thread.id) || "Untitled";
    lines.push(`${index + 1}. ${truncateTelegramLine(title, 100)}`);
  }
  if (threads.length > 10) {
    lines.push(`...and ${threads.length - 10} more archived threads.`);
  }
  lines.push("Use /unarchive <number|id> to restore one.");
  return lines.join("\n");
}

function renderTelegramArchiveResult(result = {}) {
  const title = normalizeNonEmptyString(result.title || result.name) || "Active thread";
  return `Archived: ${truncateTelegramLine(title, 120)}.`;
}

function renderTelegramUnarchiveResult(result = {}) {
  const title = normalizeNonEmptyString(result.title || result.name) || "Thread";
  return `Restored archived thread: ${truncateTelegramLine(title, 120)}.`;
}

function renderTelegramCompactResult(result = {}) {
  const turnId = normalizeNonEmptyString(result.turnId || result.turn_id || result.turn?.id);
  const lines = ["Context compaction started for the active thread."];
  if (turnId) {
    lines.push(`Turn: ${truncateTelegramLine(turnId, 80)}`);
  }
  lines.push("Older context will be summarized in Remodex.");
  return lines.join("\n");
}

function renderTelegramCheckpointResult(result = {}) {
  const checkpoint = result.checkpoint || result;
  const commit = normalizeNonEmptyString(checkpoint.commit);
  const status = result.status || {};
  const branch = normalizeNonEmptyString(status.branch || status.currentBranch);
  const files = Array.isArray(status.files) ? status.files : [];
  const lines = ["Checkpoint captured."];
  if (commit) {
    lines.push(`Commit: ${shortCommitHash(commit)}`);
  }
  if (branch || files.length > 0) {
    lines.push(`Workspace: ${files.length} changed files${branch ? ` on ${truncateTelegramLine(branch, 80)}` : ""}.`);
  }
  lines.push("Telegram can preview restore impact before any destructive restore.");
  return lines.join("\n");
}

function renderTelegramCheckpointRestorePreview(result = {}) {
  if (result.canRestore === false) {
    return "Checkpoint restore preview is unavailable for this workspace checkpoint.";
  }
  const commit = normalizeNonEmptyString(result.commit);
  const affectedFiles = Array.isArray(result.affectedFiles) ? result.affectedFiles.length : 0;
  const stagedFiles = Array.isArray(result.stagedFiles) ? result.stagedFiles.length : 0;
  const untrackedFiles = Array.isArray(result.untrackedFiles) ? result.untrackedFiles.length : 0;
  const lines = ["Checkpoint restore preview:"];
  if (commit) {
    lines.push(`Commit: ${shortCommitHash(commit)}`);
  }
  lines.push(`Affected files: ${affectedFiles}.`);
  if (stagedFiles || untrackedFiles) {
    lines.push(`Workspace now: ${stagedFiles} staged, ${untrackedFiles} untracked.`);
  }
  lines.push("Review carefully; Apply Restore will revert local files to this checkpoint.");
  return lines.join("\n");
}

function renderTelegramCheckpointRestoreApplyResult(result = {}) {
  const restoredFiles = Array.isArray(result.restoredFiles) ? result.restoredFiles.length : 0;
  const backupCommit = normalizeNonEmptyString(result.backupCommit);
  const status = result.status || {};
  const branch = normalizeNonEmptyString(status.branch || status.currentBranch);
  const files = Array.isArray(status.files) ? status.files : [];
  const lines = [result.success === false ? "Checkpoint restore did not complete." : "Checkpoint restored."];
  lines.push(`Restored files: ${restoredFiles}.`);
  if (backupCommit) {
    lines.push(`Safety backup: ${shortCommitHash(backupCommit)}.`);
  }
  if (branch || files.length > 0) {
    lines.push(`Workspace now: ${files.length} changed files${branch ? ` on ${truncateTelegramLine(branch, 80)}` : ""}.`);
  }
  lines.push("Open Remodex on the Mac for file-level review.");
  return lines.join("\n");
}

function renderTelegramOpenMacResult(result = {}) {
  if (result.success) {
    return result.relaunched
      ? "Opened the active thread on Mac after relaunching Codex."
      : "Opened the active thread on Mac.";
  }
  return "Could not open the active thread on Mac.";
}

function renderTelegramLoginResult(result = {}) {
  return result.success || result.openedOnMac
    ? "Opened ChatGPT sign-in on the Mac."
    : "Could not open ChatGPT sign-in on the Mac.";
}

function shouldBlockTelegramCodexInput(status = {}) {
  if (!status || typeof status !== "object") {
    return false;
  }
  if (status.loginInFlight) {
    return true;
  }
  // Bridge has a usable auth token — Codex turns can run even when refresh is recommended.
  if (status.tokenReady) {
    return false;
  }
  if (status.needsReauth || normalizeNonEmptyString(status.status) === "expired") {
    return true;
  }
  return normalizeNonEmptyString(status.status) === "not_logged_in";
}

function renderTelegramCodexInputBlocked(status = {}) {
  if (status.loginInFlight) {
    return "ChatGPT sign-in is in progress on this Mac. Send your message again after completing login.";
  }
  if (status.needsReauth || normalizeNonEmptyString(status.status) === "expired") {
    return "Your ChatGPT login expired. Reauth on this Mac before chatting with Codex from Telegram. Tap Open Login below.";
  }
  if (normalizeNonEmptyString(status.status) === "not_logged_in") {
    return "Sign in to ChatGPT on this Mac before chatting with Codex from Telegram. Tap Open Login below.";
  }
  return "ChatGPT sign-in is required before chatting with Codex from Telegram. Tap Open Login below.";
}

function renderTelegramCancelLoginResult(result = {}) {
  if (result.success || result.cancelled) {
    return "Cancelled the pending ChatGPT sign-in on the Mac.";
  }
  return "No pending ChatGPT sign-in to cancel.";
}

function renderTelegramLogoutConfirmation() {
  return "Sign out of ChatGPT on this Mac? Remodex Telegram, voice, and account-limited controls will need sign-in again.";
}

function renderTelegramLogoutResult(result = {}) {
  return result.success || result.signedOut
    ? "Signed out of ChatGPT on this Mac."
    : "Could not sign out of ChatGPT on this Mac.";
}

function renderTelegramWakeMacResult(result = {}) {
  const duration = Number.isFinite(result.durationSeconds) ? result.durationSeconds : 30;
  return result.success
    ? `Woke the Mac display for ${duration}s.`
    : "Could not wake the Mac display.";
}

function renderTelegramPreferences(result = {}) {
  const preferences = result.preferences || result;
  const keepMacAwake = preferences.keepMacAwake !== false;
  const applied = result.applied === true;
  return [
    "Preferences:",
    `Keep Mac awake: ${keepMacAwake ? "on" : "off"}${applied ? " (active)" : ""}`,
  ].join("\n");
}

function renderTelegramPets(result = {}) {
  const pets = Array.isArray(result.pets)
    ? result.pets
    : Array.isArray(result.avatars)
      ? result.avatars
      : [];
  const errors = Array.isArray(result.errors) ? result.errors : [];
  if (pets.length === 0) {
    return errors.length > 0
      ? `Codex pets: none available. ${errors.length} local package errors. Open Remodex on the Mac for details.`
      : "Codex pets: none found on this Mac.";
  }

  const lines = [`Codex pets: ${pets.length} available.`];
  for (const pet of pets.slice(0, 8)) {
    const name = normalizeNonEmptyString(pet.displayName || pet.name || pet.folderName) || "Untitled";
    const kind = normalizeNonEmptyString(pet.kind);
    lines.push(`- ${truncateTelegramLine(name, 80)}${kind ? ` (${truncateTelegramLine(kind, 24)})` : ""}`);
  }
  if (pets.length > 8) {
    lines.push(`...and ${pets.length - 8} more.`);
  }
  if (errors.length > 0) {
    lines.push(`${errors.length} local package errors hidden.`);
  }
  lines.push("Open Remodex on the Mac to preview or choose one.");
  return lines.join("\n");
}

function renderTelegramSkills(result = {}) {
  const query = normalizeNonEmptyString(result.query);
  const skills = filterDiscoveryEntries(normalizeSkillEntries(result), query, skillSearchText);
  if (skills.length === 0) {
    return query
      ? `Skills: no active-thread matches for "${truncateTelegramLine(query, 60)}".`
      : "Skills: none available for the active thread.";
  }

  const total = skills.length;
  const lines = [`Skills${query ? ` matching "${truncateTelegramLine(query, 60)}"` : ""}: ${total} available.`];
  for (const skill of skills.slice(0, 10)) {
    const name = normalizeNonEmptyString(skill.name) || "Untitled";
    const description = normalizeNonEmptyString(skill.description);
    const scope = normalizeNonEmptyString(skill.scope);
    const state = skill.enabled === false ? " disabled" : "";
    const details = [scope, state.trim()].filter(Boolean).join(", ");
    lines.push(`- ${truncateTelegramLine(name, 72)}${details ? ` (${truncateTelegramLine(details, 40)})` : ""}`);
    if (description) {
      lines.push(`  ${truncateTelegramLine(description, 110)}`);
    }
  }
  if (total > 10) {
    lines.push(`...and ${total - 10} more.`);
  }
  lines.push("Use the Native Remodex App for rich skill autocomplete and selection.");
  return lines.join("\n");
}

function renderTelegramPlugins(result = {}) {
  const query = normalizeNonEmptyString(result.query);
  const plugins = filterDiscoveryEntries(normalizePluginEntries(result), query, pluginSearchText);
  if (plugins.length === 0) {
    return query
      ? `Plugins: no active-thread matches for "${truncateTelegramLine(query, 60)}".`
      : "Plugins: none available for the active thread.";
  }

  const total = plugins.length;
  const lines = [`Plugins${query ? ` matching "${truncateTelegramLine(query, 60)}"` : ""}: ${total} available.`];
  for (const plugin of plugins.slice(0, 10)) {
    const name = normalizeNonEmptyString(plugin.displayName || plugin.interface?.displayName || plugin.name) || "Untitled";
    const marketplace = normalizeNonEmptyString(plugin.marketplaceName || plugin.marketplace);
    const description = normalizeNonEmptyString(plugin.shortDescription || plugin.interface?.shortDescription);
    lines.push(`- ${truncateTelegramLine(name, 72)}${marketplace ? ` (${truncateTelegramLine(marketplace, 40)})` : ""}`);
    if (description) {
      lines.push(`  ${truncateTelegramLine(description, 110)}`);
    }
  }
  if (total > 10) {
    lines.push(`...and ${total - 10} more.`);
  }
  lines.push("Use the Native Remodex App for rich plugin autocomplete and selection.");
  return lines.join("\n");
}

function renderTelegramModelPreferences(preferences = {}) {
  const runtime = normalizeTelegramRuntimePreferences(preferences);
  const accessMode = normalizeTelegramAccessMode(preferences.runtimeAccessMode || preferences.accessMode) || "on-request";
  return [
    "Runtime:",
    `Model: ${telegramModelLabel(runtime.model)} (${runtime.model})`,
    `Reasoning: ${telegramReasoningEffortLabel(runtime.reasoningEffort)} (${runtime.reasoningEffort})`,
    `Speed: ${telegramServiceTierLabel(runtime.serviceTier)} (${runtime.serviceTier || "normal"})`,
    `Access: ${telegramAccessModeLabel(accessMode)} (${accessMode})`,
    `Usage: /model <${TELEGRAM_MODEL_CHOICES.map((choice) => choice.id).join("|")}> [${TELEGRAM_REASONING_EFFORT_CHOICES.map((choice) => choice.id).join("|")}] [${TELEGRAM_SERVICE_TIER_CHOICES.map((choice) => choice.id).join("|")}]`,
    `Access: /access <${TELEGRAM_ACCESS_MODE_CHOICES.map((choice) => choice.id).join("|")}>`,
  ].join("\n");
}

function renderTelegramRenameResult(result = {}) {
  const title = normalizeNonEmptyString(result.name || result.title) || "Untitled";
  return `Renamed active thread: ${truncateTelegramLine(title, 120)}`;
}

function renderTelegramGeneratedTitleResult(result = {}) {
  const title = normalizeNonEmptyString(result.name || result.title) || "Untitled";
  return `Generated active thread title: ${truncateTelegramLine(title, 120)}`;
}

function renderTelegramForkResult(result = {}) {
  const thread = result.thread || result;
  const title = normalizeNonEmptyString(thread.title || thread.name) || "Forked thread";
  const cwd = normalizeNonEmptyString(thread.cwd || thread.projectPath || thread.project_path);
  return cwd
    ? `Forked active thread: ${truncateTelegramLine(title, 120)}\nProject: ${truncateTelegramLine(projectParentLabel(cwd) || cwd, 80)}`
    : `Forked active thread: ${truncateTelegramLine(title, 120)}`;
}

function renderTelegramWorktreeThreadResult(result = {}) {
  const worktree = result.worktree || {};
  const thread = result.thread || {};
  const branch = normalizeNonEmptyString(worktree.branch) || "new branch";
  const title = normalizeNonEmptyString(thread.title || thread.name) || "New thread";
  const cwd = normalizeNonEmptyString(thread.cwd || thread.projectPath || thread.project_path || worktree.worktreePath);
  const lines = [
    worktree.alreadyExisted
      ? `Opened existing worktree: ${truncateTelegramLine(branch, 80)}`
      : `Created worktree: ${truncateTelegramLine(branch, 80)}`,
    `New active thread: ${truncateTelegramLine(title, 120)}`,
  ];
  if (cwd) {
    lines.push(`Project: ${truncateTelegramLine(projectParentLabel(cwd) || cwd, 80)}`);
  }
  return lines.join("\n");
}

function renderTelegramProjects(result = {}) {
  const projects = normalizeProjectEntries(result);
  if (projects.length === 0) {
    return "Projects: no matching local folders found.";
  }

  const header = result.query
    ? `Projects matching "${truncateTelegramLine(result.query, 48)}":`
    : "Projects:";
  const lines = [header];
  for (const project of projects.slice(0, 8)) {
    const name = normalizeNonEmptyString(project.name || project.label) || "Untitled";
    const parent = projectParentLabel(project.path);
    lines.push(parent
      ? `- ${truncateTelegramLine(name, 72)} (${truncateTelegramLine(parent, 48)})`
      : `- ${truncateTelegramLine(name, 72)}`);
  }
  if (projects.length > 8) {
    lines.push(`...and ${projects.length - 8} more folders.`);
  }
  return lines.join("\n");
}

function renderTelegramProjectDirectory(result = {}) {
  const entries = normalizeProjectEntries(result);
  if (entries.length === 0) {
    return result.path ? "Folder: no child project folders found." : "Project folders: no local roots found.";
  }

  const header = result.isRoot
    ? "Project folders:"
    : `Folder: ${truncateTelegramLine(projectLeafLabel(result.path) || "Project", 80)}`;
  const lines = [header];
  for (const entry of entries.slice(0, 12)) {
    const name = normalizeNonEmptyString(entry.name || entry.label) || "Untitled";
    lines.push(`- ${truncateTelegramLine(name, 72)}`);
  }
  if (entries.length > 12) {
    lines.push(`...and ${entries.length - 12} more folders.`);
  }
  return lines.join("\n");
}

function renderTelegramProjectCreateDirectoryResult(result = {}) {
  const name = normalizeNonEmptyString(result.name) || projectLeafLabel(result.path) || "New folder";
  const parent = projectLeafLabel(result.parentPath);
  const lines = [`Created folder: ${truncateTelegramLine(name, 80)}`];
  if (parent) {
    lines.push(`In: ${truncateTelegramLine(parent, 80)}`);
  }
  lines.push("Use the buttons below to open it or start a thread there.");
  return lines.join("\n");
}

function renderTelegramStackedActionResult(result = {}) {
  const action = normalizeNonEmptyString(result.action) || "git";
  const lines = [`Git ${formatStackedActionLabel(action)} completed.`];

  const branch = normalizeNonEmptyString(result.status?.branch || result.branch?.name);
  if (branch) {
    lines.push(`Branch: ${truncateTelegramLine(branch, 80)}`);
  }

  const commitSubject = normalizeNonEmptyString(result.commit?.subject);
  const commitSha = normalizeNonEmptyString(result.commit?.commitSha || result.commit?.hash);
  if (result.commit?.status === "created") {
    lines.push(`Commit: ${commitSubject || truncateTelegramLine(commitSha, 12) || "created"}`);
  } else if (result.commit?.status === "skipped_clean") {
    lines.push("Commit: skipped, no local changes.");
  }

  if (result.push?.state === "pushed" || result.push?.status === "pushed") {
    lines.push("Push: complete.");
  }

  const prUrl = normalizeNonEmptyString(result.pr?.url || result.pr?.html_url);
  if (prUrl) {
    lines.push(`PR: ${prUrl}`);
  } else if (result.pr?.status && result.pr.status !== "skipped_not_requested") {
    lines.push(`PR: ${truncateTelegramLine(result.pr.status, 80)}.`);
  }

  return lines.join("\n");
}

function renderTelegramCommitDraft(draft = {}) {
  const subject = normalizeNonEmptyString(draft.subject) || "Commit draft";
  const body = normalizeNonEmptyString(draft.body);
  const lines = [`Commit draft: ${truncateTelegramLine(subject, 120)}`];
  if (body) {
    lines.push(truncateTelegramBlock(body, 1200));
  }
  lines.push("Use /commit <message> to apply it.");
  return lines.join("\n");
}

function renderTelegramPullRequestDraft(draft = {}) {
  const title = normalizeNonEmptyString(draft.title) || "Pull request draft";
  const body = normalizeNonEmptyString(draft.body);
  const lines = [`PR draft: ${truncateTelegramLine(title, 120)}`];
  if (body) {
    lines.push(truncateTelegramBlock(body, 1500));
  }
  lines.push("Use /pr to create or open the pull request.");
  return lines.join("\n");
}

function renderTelegramReviewStartResult(result = {}) {
  const target = result.target || {};
  const targetType = normalizeNonEmptyString(target.type || result.targetType);
  const branch = normalizeNonEmptyString(target.branch || result.baseBranch);
  const turnId = normalizeNonEmptyString(result.turnId || result.turn_id || result.turn?.id);
  const lines = [
    targetType === "baseBranch"
      ? `Review started against ${truncateTelegramLine(branch || "base branch", 80)}.`
      : "Review started for uncommitted changes.",
  ];
  if (turnId) {
    lines.push(`Turn: ${truncateTelegramLine(turnId, 80)}`);
  }
  lines.push("Findings will arrive in the active thread.");
  return lines.join("\n");
}

function renderTelegramApprovalRequest({ method = "", params = {}, context = {} } = {}) {
  const kind = approvalKind(method);
  const lines = [`Approval needed: ${kind}`];

  const threadTitle = normalizeNonEmptyString(context.threadTitle);
  const threadId = normalizeNonEmptyString(context.threadId);
  if (threadTitle || threadId) {
    lines.push(`Thread: ${truncateTelegramLine(threadTitle || threadId, 80)}`);
  }
  const branch = normalizeNonEmptyString(context.branch);
  if (branch) {
    lines.push(`Branch: ${truncateTelegramLine(branch, 80)}`);
  }

  const reason = normalizeNonEmptyString(params.reason);
  if (reason) {
    lines.push(`Why: ${truncateTelegramLine(reason, 180)}`);
  }

  const command = normalizeNonEmptyString(params.command);
  if (command) {
    lines.push(`Command: ${truncateTelegramLine(command, 220)}`);
  } else {
    const target = normalizeNonEmptyString(params.path)
      || normalizeNonEmptyString(params.grantRoot)
      || normalizeNonEmptyString(params.cwd);
    if (target) {
      lines.push(`Target: ${truncateTelegramLine(target, 180)}`);
    }
  }

  lines.push("Approve or decline below — works from your lock screen.");
  return lines.join("\n");
}

function renderTelegramUserInputRequest({ params = {} } = {}) {
  const questions = Array.isArray(params.questions) ? params.questions : [];
  const lines = ["Codex needs input."];

  for (const [index, question] of questions.slice(0, 3).entries()) {
    const header = normalizeNonEmptyString(question.header);
    const prompt = normalizeNonEmptyString(question.question);
    lines.push(`${questions.length > 1 ? `${index + 1}. ` : ""}${truncateTelegramLine(header || "Question", 80)}${prompt ? `: ${truncateTelegramLine(prompt, 180)}` : ""}`);

    const options = Array.isArray(question.options) ? question.options : [];
    for (const option of options.slice(0, 4)) {
      const label = normalizeNonEmptyString(option.label);
      const description = normalizeNonEmptyString(option.description);
      if (!label) {
        continue;
      }
      lines.push(`- ${truncateTelegramLine(label, 80)}${description ? `: ${truncateTelegramLine(description, 120)}` : ""}`);
    }
    if (options.length > 4) {
      lines.push(`...and ${options.length - 4} more options.`);
    }
  }

  if (questions.length === 1 && answerableTelegramQuestion(questions[0])) {
    lines.push("Choose an option below.");
  } else if (questions.length === 1 && answerableByTelegramCommand(questions[0])) {
    lines.push("Reply with /answer <response>.");
  } else if (questions.length > 1 && questions.slice(0, 3).every(answerableByTelegramCommand)) {
    lines.push("Reply with /answer and put one response per line.");
  } else {
    lines.push("Open Remodex on the Mac to answer this prompt.");
  }
  return lines.join("\n");
}

function renderTelegramThreadEvent({ method = "", params = {} } = {}) {
  const normalizedMethod = normalizeNonEmptyString(method);
  if (normalizedMethod === "turn/started") {
    return "";
  }
  if (normalizedMethod === "turn/completed") {
    const status = normalizeNonEmptyString(params.status || params.state || params.turn?.status || params.turn?.state);
    return status && !["completed", "complete", "done"].includes(status.toLowerCase())
      ? `Remodex finished the active turn: ${truncateTelegramLine(status, 80)}.`
      : "Remodex finished the active turn.";
  }
  if (normalizedMethod === "codex/event/agent_message") {
    const message = normalizeNonEmptyString(params.message || params.text);
    if (!message) {
      return "";
    }
    return truncateTelegramLine(message, TELEGRAM_MESSAGE_TEXT_MAX_CHARS);
  }
  return "";
}

function answerableTelegramQuestion(question = {}) {
  const options = Array.isArray(question.options) ? question.options : [];
  return options.some((option) => normalizeNonEmptyString(option.label));
}

function answerableByTelegramCommand(question = {}) {
  return Boolean(normalizeNonEmptyString(question.id));
}

function renderTelegramLinkInstructions({ code, expiresAt } = {}) {
  const normalizedCode = normalizeNonEmptyString(code);
  const expiresDate = new Date(expiresAt);
  const expiresLabel = Number.isFinite(expiresDate.getTime()) ? expiresDate.toISOString() : "soon";
  return `Telegram link code: ${normalizedCode}\nSend /link ${normalizedCode} to your Remodex Telegram bot. Expires: ${expiresLabel}`;
}

function renderUnauthorizedTelegramChat() {
  return "This Telegram chat is not linked to this Remodex bridge.";
}

function renderTelegramLinkHelp() {
  return [
    renderUnauthorizedTelegramChat(),
    "On the Mac, run: remodex telegram link",
    "Then send the short-lived code here with /link <code>.",
    "Keep the code private.",
  ].join("\n");
}

function isStagedGitFile(file) {
  const status = typeof file?.status === "string" ? file.status : "";
  return status.length >= 2 && status[0] !== " " && status[0] !== "?";
}

function approvalKind(method) {
  const normalized = normalizeNonEmptyString(method);
  if (normalized.includes("commandExecution")) {
    return "command";
  }
  if (normalized.includes("fileRead")) {
    return "file read";
  }
  if (normalized.includes("fileChange")) {
    return "file change";
  }
  if (normalized.includes("permissions")) {
    return "permission";
  }
  return "action";
}

function safeTelegramDiffPath(filePath) {
  const normalized = normalizeNonEmptyString(filePath);
  if (!normalized) {
    return "unknown";
  }
  return isSensitivePathLabel(normalized) ? "[sensitive path]" : normalized;
}

function isSensitivePathLabel(filePath) {
  const normalized = filePath.toLowerCase();
  return /(^|\/)\.env($|[./-])/.test(normalized)
    || /(^|\/)(id_rsa|id_ed25519|known_hosts)$/.test(normalized)
    || /\.(pem|p12|pfx|key)$/i.test(filePath);
}

function truncateTelegramLine(value, maxChars) {
  const normalized = normalizeNonEmptyString(value).replace(/\s+/g, " ");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function truncateTelegramBlock(value, maxChars) {
  const normalized = normalizeNonEmptyString(value).trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function shortCommitHash(value) {
  const normalized = normalizeNonEmptyString(value).replace(/\s+/g, "");
  return normalized.length > 12 ? normalized.slice(0, 12) : normalized;
}

function formatCount(value) {
  return Number(value).toLocaleString("en-US");
}

function normalizeProjectEntries(result = {}) {
  if (Array.isArray(result.projects)) {
    return result.projects;
  }
  if (Array.isArray(result.entries)) {
    return result.entries;
  }
  if (Array.isArray(result.locations)) {
    return result.locations;
  }
  return [];
}

function normalizeSkillEntries(result = {}) {
  const source = result.result || result;
  const entries = [];
  if (Array.isArray(source.skills)) {
    entries.push(...source.skills);
  }
  if (Array.isArray(source.entries)) {
    entries.push(...source.entries);
  }
  if (Array.isArray(source.data)) {
    for (const item of source.data) {
      if (Array.isArray(item?.skills)) {
        entries.push(...item.skills);
      } else if (item && typeof item === "object") {
        entries.push(item);
      }
    }
  }

  const byName = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const name = normalizeNonEmptyString(entry.name);
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || (existing.enabled === false && entry.enabled !== false)) {
      byName.set(key, entry);
    }
  }
  return Array.from(byName.values())
    .sort((left, right) => normalizeNonEmptyString(left.name).localeCompare(
      normalizeNonEmptyString(right.name),
      undefined,
      { sensitivity: "base" }
    ));
}

function normalizePluginEntries(result = {}) {
  const source = result.result || result;
  const entries = [];
  if (Array.isArray(source.plugins)) {
    entries.push(...source.plugins);
  }
  if (Array.isArray(source.entries)) {
    entries.push(...source.entries);
  }
  if (Array.isArray(source.marketplaces)) {
    for (const marketplace of source.marketplaces) {
      const marketplaceName = normalizeNonEmptyString(marketplace?.name);
      for (const plugin of Array.isArray(marketplace?.plugins) ? marketplace.plugins : []) {
        entries.push({ ...plugin, marketplaceName });
      }
    }
  }

  const byPath = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const name = normalizeNonEmptyString(entry.name);
    const marketplaceName = normalizeNonEmptyString(entry.marketplaceName || entry.marketplace);
    if (!name) {
      continue;
    }
    if (entry.installed === false && entry.enabled !== true && entry.installPolicy !== "INSTALLED_BY_DEFAULT") {
      continue;
    }
    const key = `${name.toLowerCase()}@${marketplaceName.toLowerCase()}`;
    if (!byPath.has(key)) {
      byPath.set(key, entry);
    }
  }
  return Array.from(byPath.values())
    .sort((left, right) => normalizeNonEmptyString(left.displayName || left.interface?.displayName || left.name).localeCompare(
      normalizeNonEmptyString(right.displayName || right.interface?.displayName || right.name),
      undefined,
      { sensitivity: "base" }
    ));
}

function decodeRateLimitBuckets(result = {}) {
  const source = result.result || result;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return [];
  }

  const keyedBuckets = objectValue(source.rateLimitsByLimitId || source.rate_limits_by_limit_id);
  if (keyedBuckets) {
    return Object.entries(keyedBuckets)
      .map(([limitId, value]) => decodeRateLimitBucket(limitId, value))
      .filter(Boolean);
  }

  const nestedBuckets = objectValue(source.rateLimits || source.rate_limits);
  if (nestedBuckets) {
    if (containsDirectRateLimitWindows(nestedBuckets)) {
      return decodeDirectRateLimitBuckets(nestedBuckets);
    }
    const nestedBucket = decodeRateLimitBucket(null, nestedBuckets);
    return nestedBucket ? [nestedBucket] : [];
  }

  const nestedResult = objectValue(source.result);
  if (nestedResult) {
    return decodeRateLimitBuckets(nestedResult);
  }

  if (containsDirectRateLimitWindows(source)) {
    return decodeDirectRateLimitBuckets(source);
  }

  return [];
}

function decodeRateLimitBucket(explicitLimitId, value) {
  const object = objectValue(value);
  if (!object) {
    return null;
  }
  const primary = decodeRateLimitWindow(object.primary || object.primary_window);
  const secondary = decodeRateLimitWindow(object.secondary || object.secondary_window);
  if (!primary && !secondary) {
    return null;
  }
  const limitId = normalizeNonEmptyString(explicitLimitId)
    || normalizeNonEmptyString(object.limitId || object.limit_id || object.id)
    || normalizeNonEmptyString(object.limitName || object.limit_name || object.name)
    || "limit";
  return {
    limitId,
    limitName: normalizeNonEmptyString(object.limitName || object.limit_name || object.name),
    primary,
    secondary,
  };
}

function decodeDirectRateLimitBuckets(object = {}) {
  const buckets = [];
  const primary = decodeRateLimitWindow(object.primary || object.primary_window);
  if (primary) {
    buckets.push({
      limitId: "primary",
      limitName: normalizeNonEmptyString(object.limitName || object.limit_name || object.name),
      primary,
      secondary: null,
    });
  }
  const secondary = decodeRateLimitWindow(object.secondary || object.secondary_window);
  if (secondary) {
    buckets.push({
      limitId: "secondary",
      limitName: normalizeNonEmptyString(object.secondaryName || object.secondary_name),
      primary: secondary,
      secondary: null,
    });
  }
  return buckets;
}

function decodeRateLimitWindow(value) {
  const object = objectValue(value);
  if (!object) {
    return null;
  }
  const usedPercent = clampPercent(readNumber(object.usedPercent ?? object.used_percent) ?? 0);
  const windowDurationMins = readNumber(
    object.windowDurationMins
      ?? object.window_duration_mins
      ?? object.windowMinutes
      ?? object.window_minutes
  );
  const resetsAt = normalizeRateLimitResetDate(
    object.resetsAt ?? object.resets_at ?? object.resetAt ?? object.reset_at
  );
  return {
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    windowDurationMins: Number.isFinite(windowDurationMins) ? Math.trunc(windowDurationMins) : null,
    resetsAt,
  };
}

function visibleRateLimitRows(buckets = []) {
  const byLabel = new Map();
  for (const bucket of buckets) {
    for (const row of rateLimitBucketRows(bucket)) {
      const existing = byLabel.get(row.label);
      byLabel.set(row.label, existing ? preferredRateLimitRow(existing, row) : row);
    }
  }
  return Array.from(byLabel.values())
    .sort((left, right) => {
      const leftDuration = left.window.windowDurationMins ?? Number.MAX_SAFE_INTEGER;
      const rightDuration = right.window.windowDurationMins ?? Number.MAX_SAFE_INTEGER;
      if (leftDuration === rightDuration) {
        return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
      }
      return leftDuration - rightDuration;
    });
}

function rateLimitBucketRows(bucket = {}) {
  const rows = [];
  if (bucket.primary) {
    rows.push({
      label: rateLimitWindowLabel(bucket.primary, bucket.limitName || bucket.limitId),
      window: bucket.primary,
    });
  }
  if (bucket.secondary) {
    rows.push({
      label: rateLimitWindowLabel(bucket.secondary, bucket.limitName || bucket.limitId),
      window: bucket.secondary,
    });
  }
  return rows;
}

function preferredRateLimitRow(current, candidate) {
  if (candidate.window.usedPercent !== current.window.usedPercent) {
    return candidate.window.usedPercent > current.window.usedPercent ? candidate : current;
  }
  if (!current.window.resetsAt && candidate.window.resetsAt) {
    return candidate;
  }
  if (current.window.resetsAt && !candidate.window.resetsAt) {
    return current;
  }
  if (current.window.resetsAt && candidate.window.resetsAt) {
    return candidate.window.resetsAt.getTime() < current.window.resetsAt.getTime() ? candidate : current;
  }
  return current;
}

function rateLimitWindowLabel(window, fallback) {
  return durationLabel(window?.windowDurationMins) || normalizeNonEmptyString(fallback) || "Limit";
}

function durationLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "";
  }
  const normalized = Math.trunc(minutes);
  const weekMinutes = 7 * 24 * 60;
  const dayMinutes = 24 * 60;
  if (normalized % weekMinutes === 0) {
    return normalized === weekMinutes ? "Weekly" : `${normalized / weekMinutes}w`;
  }
  if (normalized % dayMinutes === 0) {
    return `${normalized / dayMinutes}d`;
  }
  if (normalized % 60 === 0) {
    return `${normalized / 60}h`;
  }
  return `${normalized}m`;
}

function rateLimitResetLabel(window, now = new Date()) {
  const resetsAt = window?.resetsAt instanceof Date && !Number.isNaN(window.resetsAt.getTime())
    ? window.resetsAt
    : null;
  if (!resetsAt) {
    return "";
  }
  const sameUtcDay = resetsAt.getUTCFullYear() === now.getUTCFullYear()
    && resetsAt.getUTCMonth() === now.getUTCMonth()
    && resetsAt.getUTCDate() === now.getUTCDate();
  const hours = String(resetsAt.getUTCHours()).padStart(2, "0");
  const minutes = String(resetsAt.getUTCMinutes()).padStart(2, "0");
  if (sameUtcDay) {
    return `resets ${hours}:${minutes} UTC`;
  }
  const day = String(resetsAt.getUTCDate()).padStart(2, "0");
  const month = String(resetsAt.getUTCMonth() + 1).padStart(2, "0");
  return `resets ${resetsAt.getUTCFullYear()}-${month}-${day} ${hours}:${minutes} UTC`;
}

function containsDirectRateLimitWindows(object = {}) {
  return Boolean(
    objectValue(object)?.primary
      || objectValue(object)?.secondary
      || objectValue(object)?.primary_window
      || objectValue(object)?.secondary_window
  );
}

function normalizeRateLimitResetDate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const seconds = value > 10_000_000_000 ? value / 1000 : value;
    return new Date(seconds * 1000);
  }
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return null;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function readNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampPercent(value) {
  const number = Math.trunc(Number(value) || 0);
  return Math.min(Math.max(number, 0), 100);
}

function filterDiscoveryEntries(entries, query, searchTextForEntry) {
  const normalizedQuery = normalizeDiscoveryText(query);
  if (!normalizedQuery) {
    return entries;
  }
  return entries.filter((entry) => normalizeDiscoveryText(searchTextForEntry(entry)).includes(normalizedQuery));
}

function skillSearchText(skill = {}) {
  return [
    skill.name,
    skill.description,
    skill.scope,
  ].filter(Boolean).join(" ");
}

function pluginSearchText(plugin = {}) {
  return [
    plugin.name,
    plugin.displayName,
    plugin.interface?.displayName,
    plugin.shortDescription,
    plugin.interface?.shortDescription,
    plugin.marketplaceName,
    plugin.marketplace,
  ].filter(Boolean).join(" ");
}

function normalizeDiscoveryText(value) {
  return normalizeNonEmptyString(value)
    .toLowerCase()
    .replace(/[:/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function projectParentLabel(projectPath) {
  const normalized = normalizeNonEmptyString(projectPath);
  if (!normalized) {
    return "";
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) {
    return "";
  }
  return parts[parts.length - 2];
}

function projectLeafLabel(projectPath) {
  const normalized = normalizeNonEmptyString(projectPath);
  if (!normalized) {
    return "";
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function formatStackedActionLabel(action) {
  if (action === "commit_push_pr") {
    return "ship";
  }
  if (action === "create_pr") {
    return "PR";
  }
  return action.replace(/_/g, " ");
}

function formatActivityRole(role) {
  const normalized = normalizeNonEmptyString(role).toLowerCase();
  if (normalized === "assistant") {
    return "Assistant";
  }
  if (normalized === "user") {
    return "You";
  }
  if (normalized === "tool") {
    return "Tool";
  }
  return "Item";
}

module.exports = {
  renderTelegramAccessRequired,
  renderTelegramUpgradeInfo,
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
  renderTelegramContextWindow,
  renderTelegramCreateBranchResult,
  renderTelegramCommitDraft,
  renderTelegramForkResult,
  renderTelegramGeneratedTitleResult,
  renderTelegramGitLog,
  renderTelegramGitStatus,
  renderTelegramGitInitResult,
  renderTelegramDiffSummary,
  renderTelegramFeedbackResult,
  renderTelegramLinkInstructions,
  renderTelegramLinkHelp,
  renderTelegramLoginResult,
  renderTelegramCodexInputBlocked,
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
  renderTelegramReviewStartResult,
  renderTelegramRemote,
  renderTelegramResetRemoteConfirmation,
  renderTelegramResetRemoteResult,
  renderTelegramSkills,
  renderTelegramStackedActionResult,
  renderTelegramStashPopResult,
  renderTelegramStashResult,
  renderTelegramStatus,
  renderTelegramQueueState,
  renderTelegramQueueDetail,
  renderTelegramThreadActivity,
  renderTelegramThreadEvent,
  renderTelegramUnarchiveResult,
  renderTelegramUserInputRequest,
  renderTelegramUsageStatus,
  renderUnauthorizedTelegramChat,
  renderTelegramVersionStatus,
  renderTelegramWakeMacResult,
  renderTelegramWorktreeThreadResult,
  shouldBlockTelegramCodexInput,
};
