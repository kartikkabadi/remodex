// FILE: telegram-feedback.js
// Purpose: Builds sanitized Remodex Telegram feedback handoff URLs.
// Layer: CLI helper
// Exports: buildTelegramFeedbackMailtoUrl

const os = require("os");

const REMODEX_SUPPORT_EMAIL = "emandipietro@gmail.com";
const TELEGRAM_FEEDBACK_MESSAGE_LIMIT = 1_000;

function buildTelegramFeedbackMailtoUrl({
  message = "",
  threadId = "",
  bridgeStatus = {},
  bridgeVersion = "",
  now = () => new Date(),
} = {}) {
  const params = new URLSearchParams();
  params.set("subject", "Share Feedback on Remodex with the Developer");
  params.set("body", buildTelegramFeedbackBody({
    message,
    threadId,
    bridgeStatus,
    bridgeVersion,
    now,
  }));
  return `mailto:${REMODEX_SUPPORT_EMAIL}?${params.toString()}`;
}

function buildTelegramFeedbackBody({
  message = "",
  threadId = "",
  bridgeStatus = {},
  bridgeVersion = "",
  now = () => new Date(),
} = {}) {
  const lines = [
    "I want to share Remodex feedback:",
    "",
    "Feedback:",
    sanitizeTelegramFeedbackMessage(message) || "Write the feedback here.",
    "",
    "Context:",
    `- Time: ${now().toISOString()}`,
    "- Source: Remodex Telegram",
  ];
  const redactedThreadId = redactFeedbackThreadId(threadId);
  if (redactedThreadId) {
    lines.push(`- Thread: ${redactedThreadId}`);
  }
  const connectionStatus = normalizeNonEmptyString(bridgeStatus?.connectionStatus || bridgeStatus?.state);
  if (connectionStatus) {
    lines.push(`- Bridge: ${connectionStatus}`);
  }
  const codexStatus = normalizeNonEmptyString(
    bridgeStatus?.codexLaunchState?.status
    || bridgeStatus?.codexLaunchState?.state
    || bridgeStatus?.codexLaunchState
  );
  if (codexStatus) {
    lines.push(`- Codex: ${codexStatus}`);
  }
  const sanitizedVersion = sanitizeTelegramFeedbackVersion(bridgeVersion);
  if (sanitizedVersion) {
    lines.push(`- Remodex CLI: ${sanitizedVersion}`);
  }
  lines.push("");
  lines.push("Notes:");
  return lines.join("\n");
}

function sanitizeTelegramFeedbackMessage(message) {
  const normalized = normalizeNonEmptyString(message)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  if (!normalized) {
    return "";
  }
  return normalized
    .replaceAll(os.homedir(), "~")
    .slice(0, TELEGRAM_FEEDBACK_MESSAGE_LIMIT);
}

function sanitizeTelegramFeedbackVersion(version) {
  return normalizeNonEmptyString(version).slice(0, 40);
}

function redactFeedbackThreadId(threadId) {
  const normalized = normalizeNonEmptyString(threadId);
  if (normalized.length <= 12) {
    return "";
  }
  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  buildTelegramFeedbackMailtoUrl,
};
