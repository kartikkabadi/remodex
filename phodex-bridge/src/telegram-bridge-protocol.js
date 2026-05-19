// FILE: telegram-bridge-protocol.js
// Purpose: Normalizes Telegram Secondary Client payloads into bridge-owned Codex and Git protocol shapes.
// Layer: CLI helper
// Exports: Telegram protocol builders and compact summarizers.
// Depends on: crypto, telegram-runtime-preferences

const { randomBytes } = require("crypto");
const {
  normalizeTelegramAccessMode,
  normalizeTelegramRuntimePreferences,
} = require("./telegram-runtime-preferences");

function normalizeTelegramThreadsList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.threads)) {
    return payload.threads;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  return [];
}

function filterTelegramThreads(threads, query = "") {
  const normalizedQuery = normalizeNonEmptyString(query).toLowerCase();
  const normalizedThreads = Array.isArray(threads) ? threads : [];
  if (!normalizedQuery) {
    return normalizedThreads;
  }
  return normalizedThreads.filter((thread) => (
    threadSearchText(thread).includes(normalizedQuery)
  ));
}

function threadSearchText(thread) {
  return [
    thread?.title,
    thread?.name,
    thread?.id,
    thread?.threadId,
    thread?.thread_id,
    thread?.cwd,
    thread?.projectPath,
    thread?.project_path,
  ].map((value) => normalizeNonEmptyString(value).toLowerCase())
    .filter(Boolean)
    .join(" ");
}

function findTelegramThreadById(threads, threadId) {
  return threads.find((thread) => normalizeNonEmptyString(thread?.id || thread?.threadId || thread?.thread_id) === threadId) || null;
}

function readThreadFromPayload(payload) {
  return payload?.thread || payload?.conversation || payload?.data || payload || null;
}

function readTelegramThreadCwd(thread) {
  return normalizeNonEmptyString(thread?.cwd || thread?.projectPath || thread?.project_path);
}

function normalizeTelegramCreatedThread(payload, { cwd = "" } = {}) {
  const thread = readThreadFromPayload(payload) || {};
  const threadId = normalizeNonEmptyString(thread?.id || thread?.threadId || thread?.thread_id);
  if (!threadId) {
    throw new Error("thread/start response missing thread");
  }
  const threadCwd = normalizeNonEmptyString(thread?.cwd || thread?.projectPath || thread?.project_path) || normalizeNonEmptyString(cwd);
  return {
    thread: {
      ...thread,
      id: threadId,
      cwd: threadCwd || thread?.cwd,
    },
    threadId,
  };
}

function normalizeTelegramForkedThread(payload, { sourceThreadId = "", cwd = "" } = {}) {
  const created = normalizeTelegramCreatedThread(payload, { cwd });
  return {
    ...created,
    thread: {
      ...created.thread,
      forkedFromThreadId: normalizeNonEmptyString(created.thread.forkedFromThreadId)
        || normalizeNonEmptyString(created.thread.forked_from_thread_id)
        || normalizeNonEmptyString(sourceThreadId),
    },
  };
}

function normalizeTelegramWorktreeThreadResult({ worktree = {}, thread = {}, threadId = "" } = {}) {
  const normalizedThreadId = normalizeNonEmptyString(threadId || thread.id || thread.threadId || thread.thread_id);
  return {
    worktree: {
      branch: normalizeNonEmptyString(worktree.branch),
      worktreePath: normalizeNonEmptyString(worktree.worktreePath),
      alreadyExisted: worktree.alreadyExisted === true,
    },
    thread: {
      ...thread,
      id: normalizedThreadId || normalizeNonEmptyString(thread.id),
      threadId: normalizedThreadId || normalizeNonEmptyString(thread.threadId),
    },
    threadId: normalizedThreadId,
  };
}

function findActiveTurnId(payload) {
  const thread = readThreadFromPayload(payload);
  const direct = normalizeNonEmptyString(thread?.activeTurnId || thread?.active_turn_id || thread?.turnId || thread?.turn_id);
  if (direct) {
    return direct;
  }
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const activeTurn = [...turns].reverse().find((turn) => {
    const status = normalizeNonEmptyString(turn?.status || turn?.state).toLowerCase();
    return ["running", "in_progress", "active", "pending"].includes(status);
  });
  return normalizeNonEmptyString(activeTurn?.id || activeTurn?.turnId || activeTurn?.turn_id);
}

function buildTelegramCodexInputRequest({
  threadId,
  text,
  threadPayload,
  attachments,
  runtimePreferences,
  collaborationMode = "",
} = {}) {
  const normalizedThreadId = normalizeNonEmptyString(threadId);
  const trimmedText = normalizeNonEmptyString(text);
  const activeTurnId = findActiveTurnId(threadPayload);
  const runtime = normalizeTelegramRuntimePreferences(runtimePreferences);
  const collaborationModePayload = buildTelegramCollaborationModePayload({
    mode: collaborationMode,
    runtimePreferences: runtime,
  });
  const params = {
    threadId: normalizedThreadId,
    input: buildTelegramCodexInputItems({ text: trimmedText, attachments }),
  };
  if (collaborationModePayload) {
    params.collaborationMode = collaborationModePayload;
  }

  if (activeTurnId) {
    return {
      method: "turn/steer",
      params: {
        ...params,
        expectedTurnId: activeTurnId,
      },
    };
  }

  return {
    method: "turn/start",
    params: {
      ...params,
      model: runtime.model,
      effort: runtime.reasoningEffort,
      ...telegramServiceTierParam(runtime),
    },
  };
}

function buildTelegramCollaborationModePayload({ mode = "", runtimePreferences } = {}) {
  const normalizedMode = normalizeNonEmptyString(mode).toLowerCase();
  if (normalizedMode !== "plan") {
    return null;
  }
  const runtime = normalizeTelegramRuntimePreferences(runtimePreferences);
  return {
    mode: "plan",
    settings: {
      model: runtime.model,
      reasoning_effort: runtime.reasoningEffort,
      developer_instructions: null,
    },
  };
}

function buildTelegramCodexInputItems({ text, attachments } = {}) {
  const input = [{ type: "text", text: normalizeNonEmptyString(text) }];
  for (const attachment of normalizeTelegramInputAttachments(attachments)) {
    input.push(attachment);
  }
  return input;
}

function normalizeTelegramInputAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }
  return attachments
    .map((attachment) => {
      if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
        return null;
      }
      const type = normalizeNonEmptyString(attachment.type);
      const imageUrl = normalizeTelegramImageUrl(attachment.image_url || attachment.imageUrl || attachment.url);
      if (type !== "input_image" || !imageUrl) {
        return null;
      }
      const item = {
        type: "input_image",
        image_url: imageUrl,
      };
      const detail = normalizeNonEmptyString(attachment.detail);
      if (detail) {
        item.detail = detail;
      }
      return item;
    })
    .filter(Boolean);
}

function normalizeTelegramImageUrl(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return normalizeNonEmptyString(value.url);
  }
  return "";
}

function buildTelegramThreadStartParams({ cwd = "", runtimePreferences } = {}) {
  const runtime = normalizeTelegramRuntimePreferences(runtimePreferences);
  const params = {
    model: runtime.model,
    ...telegramServiceTierParam(runtime),
  };
  const normalizedCwd = normalizeNonEmptyString(cwd);
  if (normalizedCwd) {
    params.cwd = normalizedCwd;
  }
  return params;
}

function buildTelegramThreadForkParams({ threadId, excludeTurns = true } = {}) {
  const params = {
    threadId: normalizeNonEmptyString(threadId),
  };
  if (excludeTurns) {
    params.excludeTurns = true;
  }
  return params;
}

function buildTelegramThreadResumeParams({
  threadId,
  cwd = "",
  excludeTurns = true,
  runtimePreferences,
} = {}) {
  const runtime = normalizeTelegramRuntimePreferences(runtimePreferences);
  const params = {
    threadId: normalizeNonEmptyString(threadId),
    model: runtime.model,
    ...telegramServiceTierParam(runtime),
  };
  const normalizedCwd = normalizeNonEmptyString(cwd);
  if (normalizedCwd) {
    params.cwd = normalizedCwd;
  }
  if (excludeTurns) {
    params.excludeTurns = true;
  }
  return params;
}

function buildTelegramReviewStartParams({
  threadId,
  target = "uncommittedChanges",
  baseBranch = "",
} = {}) {
  const normalizedTarget = normalizeNonEmptyString(target);
  const targetObject = normalizedTarget === "baseBranch"
    ? {
      type: "baseBranch",
      branch: normalizeNonEmptyString(baseBranch),
    }
    : {
      type: "uncommittedChanges",
    };
  if (targetObject.type === "baseBranch" && !targetObject.branch) {
    throw new Error("A base branch is required for Telegram code review.");
  }
  return {
    threadId: normalizeNonEmptyString(threadId),
    delivery: "inline",
    target: targetObject,
  };
}

function buildTelegramRuntimeRequestAttempts(baseParams = {}, {
  accessMode = "on-request",
  allowCollaborationModeFallback = false,
} = {}) {
  const normalizedAccessMode = normalizeTelegramAccessMode(accessMode) || "on-request";
  const attempts = buildTelegramRuntimeRequestAttemptSet(baseParams, normalizedAccessMode);
  if (baseParams?.serviceTier) {
    attempts.push(...buildTelegramRuntimeRequestAttemptSet(withoutTelegramServiceTier(baseParams), normalizedAccessMode));
  }
  if (allowCollaborationModeFallback && baseParams?.collaborationMode) {
    const fallbackParams = withoutTelegramCollaborationMode(baseParams);
    attempts.push(...buildTelegramRuntimeRequestCompatibilityFallbackAttemptSet(fallbackParams, normalizedAccessMode));
    if (fallbackParams?.serviceTier) {
      attempts.push(...buildTelegramRuntimeRequestCompatibilityFallbackAttemptSet(withoutTelegramServiceTier(fallbackParams), normalizedAccessMode));
    }
  }
  return attempts;
}

function buildTelegramRuntimeRequestAttemptSet(baseParams = {}, accessMode = "on-request") {
  return [
    {
      ...baseParams,
      sandboxPolicy: buildTelegramSandboxPolicy(accessMode),
      approvalPolicy: firstTelegramApprovalPolicy(accessMode),
    },
    {
      ...baseParams,
      sandboxPolicy: buildTelegramSandboxPolicy(accessMode),
      approvalPolicy: secondTelegramApprovalPolicy(accessMode),
    },
    {
      ...baseParams,
      sandbox: telegramSandboxLegacyValue(accessMode),
      approvalPolicy: firstTelegramApprovalPolicy(accessMode),
    },
    {
      ...baseParams,
      sandbox: telegramSandboxLegacyValue(accessMode),
      approvalPolicy: secondTelegramApprovalPolicy(accessMode),
    },
    { ...baseParams },
  ];
}

function buildTelegramRuntimeRequestCompatibilityFallbackAttemptSet(baseParams = {}, accessMode = "on-request") {
  return [
    {
      ...baseParams,
      sandboxPolicy: buildTelegramSandboxPolicy(accessMode),
      approvalPolicy: firstTelegramApprovalPolicy(accessMode),
    },
    {
      ...baseParams,
      sandbox: telegramSandboxLegacyValue(accessMode),
      approvalPolicy: firstTelegramApprovalPolicy(accessMode),
    },
    { ...baseParams },
  ];
}

function buildTelegramSandboxPolicy(accessMode) {
  return accessMode === "full-access"
    ? { type: "dangerFullAccess" }
    : { type: "workspaceWrite", networkAccess: true };
}

function telegramSandboxLegacyValue(accessMode) {
  return accessMode === "full-access" ? "danger-full-access" : "workspace-write";
}

function firstTelegramApprovalPolicy(accessMode) {
  return accessMode === "full-access" ? "never" : "on-request";
}

function secondTelegramApprovalPolicy(accessMode) {
  return accessMode === "full-access" ? "never" : "onRequest";
}

function withoutTelegramCollaborationMode(params = {}) {
  const { collaborationMode, ...rest } = params || {};
  void collaborationMode;
  return rest;
}

function withoutTelegramServiceTier(params = {}) {
  const { serviceTier, ...rest } = params || {};
  void serviceTier;
  return rest;
}

function telegramServiceTierParam(runtime = {}) {
  const serviceTier = normalizeNonEmptyString(runtime.serviceTier);
  return serviceTier ? { serviceTier } : {};
}

function shouldRetryTelegramRuntimeRequest(error) {
  const code = Number(error?.code);
  if (code !== -32600 && code !== -32602) {
    return false;
  }
  const message = normalizeNonEmptyString(error?.message).toLowerCase();
  return message.includes("sandbox")
    || message.includes("approval")
    || message.includes("unknown variant")
    || message.includes("expected one of")
    || message.includes("onrequest")
    || message.includes("on-request")
    || shouldRetryTelegramRuntimeWithoutField(error);
}

function shouldRetryTelegramRuntimeWithoutField(error) {
  const code = Number(error?.code);
  if (code !== -32600 && code !== -32602) {
    return false;
  }
  const message = normalizeNonEmptyString(error?.message).toLowerCase();
  if (message.includes("thread not found") || message.includes("unknown thread")) {
    return false;
  }
  return message.includes("invalid params")
    || message.includes("invalid param")
    || message.includes("unknown field")
    || message.includes("unexpected field")
    || message.includes("unrecognized field")
    || message.includes("failed to parse")
    || message.includes("unsupported");
}

function isTelegramMissingRolloutError(error) {
  const message = normalizeNonEmptyString(error?.message).toLowerCase();
  return message.includes("no rollout found")
    || message.includes("rollout not found")
    || message.includes("missing rollout");
}

function buildTelegramApprovalResponseResult({ method = "", params = {}, decision = "decline" } = {}) {
  const normalizedMethod = normalizeNonEmptyString(method);
  const accepted = decision === "accept";
  if (normalizedMethod === "item/permissions/requestApproval") {
    return {
      permissions: accepted && params?.permissions && typeof params.permissions === "object" && !Array.isArray(params.permissions)
        ? params.permissions
        : {},
      scope: "turn",
    };
  }
  return { decision: accepted ? "accept" : "decline" };
}

function summarizeTelegramDiff(diffResult) {
  const patch = normalizeNonEmptyString(diffResult?.patch);
  const files = [];
  let currentFile = null;
  for (const line of patch.split("\n")) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) {
      currentFile = {
        path: normalizeGitDiffPath(match[2]),
        additions: 0,
        deletions: 0,
        binary: false,
      };
      files.push(currentFile);
      continue;
    }
    if (!currentFile) {
      continue;
    }
    if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      currentFile.binary = true;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentFile.additions += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      currentFile.deletions += 1;
    }
  }
  return {
    changedFiles: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files,
  };
}

function normalizeGitDiffPath(filePath) {
  const normalized = normalizeNonEmptyString(filePath);
  if (!normalized) {
    return "";
  }
  return normalized
    .replace(/^"|"$/g, "")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function summarizeTelegramThreadActivity(payload, {
  maxTurns = 3,
  maxEntries = 8,
  maxTextChars = 320,
} = {}) {
  const turns = normalizeTelegramActivityTurns(payload).slice(0, maxTurns);
  const entries = [];
  for (const turn of turns) {
    const items = Array.isArray(turn?.items) ? turn.items : [];
    for (const item of items) {
      const entry = summarizeTelegramActivityItem(item, { maxTextChars });
      if (entry) {
        entries.push({
          ...entry,
          turnId: normalizeNonEmptyString(turn?.id || turn?.turnId || turn?.turn_id),
        });
      }
    }
  }
  return {
    entries: entries.slice(0, maxEntries),
    omittedEntryCount: Math.max(0, entries.length - maxEntries),
  };
}

function extractTelegramTitleSeedText(payload) {
  const turns = normalizeTelegramActivityTurns(payload);
  for (const turn of turns) {
    const items = Array.isArray(turn?.items) ? turn.items : [];
    for (const item of items) {
      if (readTelegramActivityRole(item) !== "user") {
        continue;
      }
      const text = sanitizeTelegramActivityText(readTelegramActivityText(item), { maxTextChars: 800 });
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function normalizeTelegramActivityTurns(payload) {
  const candidates = [
    payload?.data,
    payload?.payload?.data,
    payload?.result?.data,
    payload?.result?.payload?.data,
    payload?.turns,
    payload?.thread?.turns,
    payload?.conversation?.turns,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

function summarizeTelegramActivityItem(item, { maxTextChars } = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const role = readTelegramActivityRole(item);
  if (role === "tool") {
    const name = normalizeNonEmptyString(item.name || item.toolName || item.tool_name);
    return name ? { role, text: `Ran ${name}` } : null;
  }
  const text = sanitizeTelegramActivityText(readTelegramActivityText(item), { maxTextChars });
  if (!text) {
    return null;
  }
  return { role, text };
}

function readTelegramActivityRole(item) {
  const role = normalizeNonEmptyString(item.role).toLowerCase();
  if (role === "user" || role === "assistant") {
    return role;
  }
  const type = normalizeNonEmptyString(item.type).toLowerCase();
  if (type.includes("user")) {
    return "user";
  }
  if (type.includes("assistant") || type === "message") {
    return "assistant";
  }
  if (type.includes("tool") || type.includes("function")) {
    return "tool";
  }
  return "item";
}

function readTelegramActivityText(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  for (const key of ["text", "message", "summary", "output", "outputText", "output_text"]) {
    const direct = normalizeNonEmptyString(value[key]);
    if (direct) {
      return direct;
    }
  }
  if (Array.isArray(value.content)) {
    return value.content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        return readTelegramActivityText(entry);
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function sanitizeTelegramActivityText(value, { maxTextChars = 320 } = {}) {
  const normalized = normalizeNonEmptyString(value)
    .replace(/data:[^\s;,]+;base64,[A-Za-z0-9+/=_-]+/g, "[attachment]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[redacted-token]")
    .replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxTextChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxTextChars - 3))}...`;
}

function buildTelegramManualCheckpointRef(
  threadId,
  now = () => Date.now(),
  randomSuffix = () => randomBytes(4).toString("hex")
) {
  const threadSegment = encodeTelegramCheckpointSegment(threadId);
  if (!threadSegment) {
    throw new Error("A Telegram thread id is required for checkpoint capture.");
  }
  const timestamp = Math.max(0, Number(now()) || 0);
  const suffix = normalizeNonEmptyString(randomSuffix()).replace(/[^A-Za-z0-9_-]/g, "");
  return `refs/remodex/checkpoints/${threadSegment}/telegram-manual/${timestamp}-${suffix || "checkpoint"}`;
}

function encodeTelegramCheckpointSegment(value) {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return "";
  }
  return Buffer.from(normalized, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function buildTelegramCheckpointRestoreApplyParams({
  threadId,
  cwd,
  checkpointRef,
  expectedTargetCommit,
} = {}) {
  const normalizedThreadId = normalizeNonEmptyString(threadId);
  const normalizedCheckpointRef = normalizeNonEmptyString(checkpointRef);
  if (!normalizedThreadId) {
    throw new Error("A Telegram thread id is required for checkpoint restore.");
  }
  if (!normalizedCheckpointRef) {
    throw new Error("A Telegram checkpoint ref is required for checkpoint restore.");
  }
  const params = {
    threadId: normalizedThreadId,
    targetCheckpointRef: normalizedCheckpointRef,
    confirmDestructiveRestore: true,
  };
  const normalizedCwd = normalizeNonEmptyString(cwd);
  if (normalizedCwd) {
    params.cwd = normalizedCwd;
  }
  const normalizedExpectedTargetCommit = normalizeNonEmptyString(expectedTargetCommit);
  if (normalizedExpectedTargetCommit) {
    params.expectedTargetCommit = normalizedExpectedTargetCommit;
  }
  return params;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  buildTelegramApprovalResponseResult,
  buildTelegramCheckpointRestoreApplyParams,
  buildTelegramCollaborationModePayload,
  buildTelegramCodexInputRequest,
  buildTelegramSandboxPolicy,
  buildTelegramManualCheckpointRef,
  buildTelegramReviewStartParams,
  buildTelegramRuntimeRequestAttempts,
  buildTelegramThreadForkParams,
  buildTelegramThreadResumeParams,
  buildTelegramThreadStartParams,
  extractTelegramTitleSeedText,
  filterTelegramThreads,
  findActiveTurnId,
  findTelegramThreadById,
  isTelegramMissingRolloutError,
  normalizeTelegramCreatedThread,
  normalizeTelegramForkedThread,
  normalizeTelegramThreadsList,
  normalizeTelegramWorktreeThreadResult,
  readTelegramThreadCwd,
  readThreadFromPayload,
  shouldRetryTelegramRuntimeRequest,
  shouldRetryTelegramRuntimeWithoutField,
  summarizeTelegramDiff,
  summarizeTelegramThreadActivity,
};
