// FILE: telegram-notification-policy.js
// Purpose: Turn notification budget rules for conversation-first Telegram UX.
// Layer: CLI helper
// Exports: decideThreadNotification, formatAgentMessageText
// Depends on: telegram-bot-api-client

const { TELEGRAM_MESSAGE_TEXT_MAX_CHARS } = require("./telegram-bot-api-client");
const { telegramEnvelopeEvent } = require("./telegram-codex-envelope");

const AGENT_MESSAGE_TEXT_MAX_CHARS = TELEGRAM_MESSAGE_TEXT_MAX_CHARS;

function decideThreadNotification({
  method = "",
  params = {},
  linkedChat = {},
  implicitCodexInput = false,
  renderedText = "",
  streamingActive = false,
} = {}) {
  if (implicitCodexInput) {
    return notificationDecision({ suppress: true });
  }

  const normalizedMethod = String(method || "").trim();
  if (normalizedMethod === "turn/started") {
    return notificationDecision({ suppress: true, showTyping: true, markupSurface: "running_turn" });
  }

  if (normalizedMethod === "codex/event/agent_message") {
    const text = formatAgentMessageText(params);
    if (!text) {
      return notificationDecision({ suppress: true });
    }
    if (streamingActive) {
      return notificationDecision({
        suppress: true,
        text,
        markupSurface: "turn_output",
        mergeWithStreamingBubble: true,
      });
    }
    return notificationDecision({
      text,
      markupSurface: "turn_output",
    });
  }

  if (normalizedMethod === "turn/completed") {
    if (streamingActive) {
      return notificationDecision({
        suppress: true,
        deferStreamingFinalize: true,
      });
    }
    // Conversation-first: finalize the live bubble only; no extra "finished" banner.
    return notificationDecision({
      suppress: true,
      finalizeStreaming: true,
    });
  }

  return notificationDecision({
    suppress: !renderedText,
    text: renderedText,
  });
}

function formatAgentMessageText(params = {}) {
  const envelope = telegramEnvelopeEvent(params);
  const message = String(
    params.message
    || params.text
    || envelope?.message
    || envelope?.text
    || ""
  ).trim();
  if (!message) {
    return "";
  }
  return truncateTelegramLine(message, AGENT_MESSAGE_TEXT_MAX_CHARS);
}

function notificationDecision({
  suppress = false,
  text = "",
  markupSurface = "",
  mergeWithStreamingBubble = false,
  showTyping = false,
  finalizeStreaming = false,
  deferStreamingFinalize = false,
} = {}) {
  return {
    suppress,
    text,
    markupSurface,
    mergeWithStreamingBubble,
    showTyping,
    finalizeStreaming,
    deferStreamingFinalize,
  };
}

function truncateTelegramLine(value, maxChars) {
  const text = String(value ?? "");
  if (!Number.isFinite(maxChars) || maxChars < 1) {
    return "";
  }
  return Array.from(text).slice(0, maxChars).join("");
}

module.exports = {
  AGENT_MESSAGE_TEXT_MAX_CHARS,
  decideThreadNotification,
  formatAgentMessageText,
};
