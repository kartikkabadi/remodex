// FILE: telegram-reply-policy.js
// Purpose: Table-driven reply markup policy for conversation-first Telegram UX.
// Layer: CLI helper
// Exports: resolveReplyMarkup
// Depends on: none

function resolveReplyMarkup({
  surface = "",
  phase = "",
  linkedChat = {},
  event = {},
  keyboards = {},
} = {}) {
  const normalizedSurface = String(surface || "").trim().toLowerCase();
  const normalizedPhase = String(phase || "").trim().toLowerCase();

  if (normalizedSurface === "codex_input" && normalizedPhase === "ack") {
    return undefined;
  }
  if (normalizedSurface === "turn_output" && normalizedPhase === "assistant") {
    return undefined;
  }
  if (normalizedSurface === "running_turn" && normalizedPhase === "active") {
    return buildStopOnlyReplyMarkup(keyboards, linkedChat, event);
  }
  if (normalizedSurface === "error" || normalizedSurface === "missing_thread") {
    const chatId = linkedChat?.chatId;
    return typeof keyboards.buildMissingThreadReplyMarkup === "function" && chatId
      ? keyboards.buildMissingThreadReplyMarkup(chatId)
      : undefined;
  }
  if (normalizedSurface === "control") {
    if (keyboards.delegatedReplyMarkup) {
      return keyboards.delegatedReplyMarkup;
    }
    if (typeof keyboards.resolveControlReplyMarkup === "function") {
      return keyboards.resolveControlReplyMarkup({ phase: normalizedPhase, linkedChat, event });
    }
  }
  if (normalizedSurface === "approval" && event?.request) {
    const chatId = linkedChat?.chatId;
    return typeof keyboards.buildApprovalReplyMarkup === "function" && chatId
      ? keyboards.buildApprovalReplyMarkup(chatId, event.request)
      : undefined;
  }
  if (normalizedSurface === "user_input" && event?.request) {
    const chatId = linkedChat?.chatId;
    return typeof keyboards.buildUserInputReplyMarkup === "function" && chatId
      ? keyboards.buildUserInputReplyMarkup(chatId, event.request)
      : undefined;
  }
  return undefined;
}

function buildStopOnlyReplyMarkup(keyboards, linkedChat, event = {}) {
  const chatId = linkedChat?.chatId;
  const threadId = linkedChat?.activeThreadId || event.threadId;
  if (!chatId || !threadId || typeof keyboards.makeActionButton !== "function") {
    return undefined;
  }
  return {
    inline_keyboard: [[
      keyboards.makeActionButton(chatId, "Stop", "command.stop", { threadId }),
    ]],
  };
}

module.exports = {
  resolveReplyMarkup,
};
