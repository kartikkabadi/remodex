// FILE: telegram-streaming-bubble.js
// Purpose: Live assistant bubble via throttled editMessageText for Telegram.
// Layer: CLI helper
// Exports: createTelegramStreamingBubble, parseTelegramStreamingDelta, extractAssistantDeltaText
// Depends on: none

const { TELEGRAM_EMPTY_REPLY_MARKUP } = require("./telegram-bot-api-client");
const { renderTelegramActivityFooterLine } = require("./telegram-file-change-summary");
const { telegramEnvelopeEvent } = require("./telegram-codex-envelope");

const STREAMING_PLACEHOLDER = "…";
const DEFAULT_THROTTLE_MS = 400;

const STREAMING_DELTA_METHODS = new Set([
  "item/agentMessage/delta",
  "codex/event/agent_message_content_delta",
  "codex/event/agent_message_delta",
]);

function createTelegramStreamingBubble({
  botClient,
  makeStopReplyMarkup,
  throttleMs = DEFAULT_THROTTLE_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  logger = console,
} = {}) {
  const bubbles = new Map();

  function bubbleKey(chatId, turnId) {
    return `${String(chatId)}:${String(turnId || "active")}`;
  }

  function getBubble(chatId, turnId) {
    return bubbles.get(bubbleKey(chatId, turnId));
  }

  function isLiveTurn(chatId, turnId) {
    const bubble = getBubble(chatId, turnId);
    return Boolean(
      bubble?.messageId
      || bubble?.ensurePromise
      || bubble?.turnStarted
    );
  }

  function isStreaming(chatId, turnId) {
    const bubble = getBubble(chatId, turnId);
    return Boolean(bubble?.messageId || bubble?.ensurePromise);
  }

  function rememberBubble(chatId, turnId, bubble) {
    bubbles.set(bubbleKey(chatId, turnId), bubble);
    while (bubbles.size > 500) {
      const oldestKey = bubbles.keys().next().value;
      bubbles.delete(oldestKey);
    }
  }

  async function ensureBubble({ chatId, threadId, turnId, linkedChat, initialText = STREAMING_PLACEHOLDER }) {
    const existing = getBubble(chatId, turnId);
    if (existing?.messageId) {
      return existing;
    }
    if (existing?.ensurePromise) {
      return existing.ensurePromise;
    }
    if (typeof botClient?.sendMessage !== "function") {
      return null;
    }
    const ensurePromise = (async () => {
      const current = getBubble(chatId, turnId);
      if (current?.messageId) {
        return current;
      }
      const replyMarkup = typeof makeStopReplyMarkup === "function"
        ? makeStopReplyMarkup({ chatId, threadId, linkedChat, turnId })
        : undefined;
      const result = await botClient.sendMessage({
        chatId,
        text: initialText,
        replyMarkup,
      });
      const bubble = {
        chatId: String(chatId),
        threadId,
        turnId,
        messageId: result?.message_id ?? result?.messageId,
        text: initialText,
        createdAt: now(),
        lastEditAt: 0,
        pendingText: "",
        editTimer: null,
        stopReplyMarkup: replyMarkup,
        turnStarted: current?.turnStarted || false,
        turnCompletedPending: current?.turnCompletedPending || false,
      };
      rememberBubble(chatId, turnId, bubble);
      return bubble;
    })();
    rememberBubble(chatId, turnId, {
      ...(existing || {
        chatId: String(chatId),
        threadId,
        turnId,
        messageId: null,
        text: "",
        createdAt: now(),
        lastEditAt: 0,
        pendingText: "",
        editTimer: null,
      }),
      ensurePromise,
    });
    try {
      return await ensurePromise;
    } finally {
      const settled = getBubble(chatId, turnId);
      if (settled?.ensurePromise === ensurePromise) {
        delete settled.ensurePromise;
      }
    }
  }

  function resolveBubbleForCompletion(chatId, turnId) {
    const keysToTry = [bubbleKey(chatId, turnId)];
    if (turnId) {
      keysToTry.push(bubbleKey(chatId, ""));
    }
    for (const key of keysToTry) {
      const bubble = bubbles.get(key);
      if (bubble) {
        return { bubble, key };
      }
    }
    return null;
  }

  async function finalizeBubbleAtKey(key, bubble) {
    if (!bubble) {
      return;
    }
    if (!bubble.messageId) {
      bubble.turnCompletedPending = true;
      return;
    }
    markBubbleFinalized(bubble);
    if (bubble.editTimer) {
      clearTimer(bubble.editTimer);
      bubble.editTimer = null;
    }
    try {
      await flushEdit(bubble, { finalize: true });
    } catch (error) {
      warnStreamingBubble(
        `failed to finalize streaming text for chat ${bubble.chatId} message ${bubble.messageId}`,
        error
      );
      try {
        await clearStopMarkup(bubble);
      } catch (markupError) {
        warnStreamingBubble(
          `failed to clear Stop markup after finalize error for chat ${bubble.chatId} message ${bubble.messageId}`,
          markupError
        );
      }
    }
    bubbles.delete(key);
  }

  async function finalizeOtherBubblesForChat(chatId, keepTurnId) {
    const normalizedChatId = String(chatId);
    const keepKey = bubbleKey(chatId, keepTurnId);
    for (const [key, bubble] of [...bubbles.entries()]) {
      if (String(bubble?.chatId) !== normalizedChatId || key === keepKey) {
        continue;
      }
      await finalizeBubbleAtKey(key, bubble);
    }
  }

  function markBubbleFinalized(bubble) {
    if (!bubble || bubble.finalized) {
      return;
    }
    bubble.finalized = true;
    bubble.stopReplyMarkup = undefined;
  }

  function warnStreamingBubble(message, error) {
    const detail = error?.message ? `: ${error.message}` : "";
    logger.warn?.(`[remodex] Telegram streaming bubble ${message}${detail}`);
  }

  function composeBubbleText(bubble) {
    const mainText = finalizeTextWithoutFooter(bubble.pendingText || bubble.text || STREAMING_PLACEHOLDER);
    const footer = renderTelegramActivityFooterLine(bubble.activityFooter);
    if (!footer) {
      return mainText;
    }
    return mainText ? `${mainText}\n\n${footer}` : footer;
  }

  function finalizeTextWithoutFooter(text) {
    const normalized = String(text || "");
    const footerIndex = normalized.lastIndexOf("\n\n↳ ");
    if (footerIndex === -1) {
      return normalized;
    }
    return normalized.slice(0, footerIndex).trimEnd() || STREAMING_PLACEHOLDER;
  }

  async function flushEdit(bubble, { finalize = false } = {}) {
    if (!bubble?.messageId || typeof botClient?.editMessageText !== "function") {
      return false;
    }
    if (bubble.finalized && !finalize) {
      return false;
    }
    const text = composeBubbleText(bubble);
    bubble.text = text;
    bubble.pendingText = "";
    const replyMarkup = finalize || bubble.finalized
      ? TELEGRAM_EMPTY_REPLY_MARKUP
      : bubble.stopReplyMarkup;
    try {
      await botClient.editMessageText({
        chatId: bubble.chatId,
        messageId: bubble.messageId,
        text,
        replyMarkup,
      });
    } catch (error) {
      if (!isTelegramMessageNotModifiedError(error)) {
        throw error;
      }
    }
    bubble.lastEditAt = now();
    if (finalize) {
      markBubbleFinalized(bubble);
      await clearStopMarkup(bubble);
    }
    return true;
  }

  function scheduleEdit(bubble, text, { finalize = false } = {}) {
    bubble.pendingText = text;
    if (finalize) {
      if (bubble.editTimer) {
        clearTimer(bubble.editTimer);
        bubble.editTimer = null;
      }
      return flushEdit(bubble, { finalize: true });
    }
    const throttleAnchor = bubble.lastEditAt || bubble.createdAt;
    const elapsed = typeof throttleAnchor === "number" ? now() - throttleAnchor : 0;
    if (elapsed >= throttleMs) {
      if (bubble.editTimer) {
        clearTimer(bubble.editTimer);
        bubble.editTimer = null;
      }
      return flushEdit(bubble);
    }
    if (bubble.editTimer) {
      return Promise.resolve(false);
    }
    bubble.editTimer = setTimer(async () => {
      bubble.editTimer = null;
      if (bubble.finalized) {
        return;
      }
      try {
        await flushEdit(bubble);
      } catch (error) {
        warnStreamingBubble("background edit failed", error);
      }
    }, throttleMs - elapsed);
    if (bubble.editTimer && typeof bubble.editTimer.unref === "function") {
      bubble.editTimer.unref();
    }
    return Promise.resolve(false);
  }

  async function setActivityFooter({ chatId, turnId, activity = "" }) {
    const bubble = getBubble(chatId, turnId);
    if (!bubble || bubble.finalized) {
      return false;
    }
    bubble.activityFooter = String(activity || "").trim();
    if (!bubble.messageId) {
      return true;
    }
    return scheduleEdit(bubble, composeBubbleText(bubble));
  }

  async function appendDelta({ chatId, threadId, turnId, linkedChat, delta, fullText, finalizeTurn = false }) {
    const normalizedDelta = String(delta || "");
    if (!normalizedDelta && !fullText) {
      return false;
    }
    let bubble = getBubble(chatId, turnId);
    if (bubble?.ensurePromise) {
      try {
        await bubble.ensurePromise;
      } catch {
        // A failed placeholder send can be retried by a later delta.
      }
      bubble = getBubble(chatId, turnId);
    }
    const currentText = bubble?.pendingText
      || (bubble?.text && bubble.text !== STREAMING_PLACEHOLDER ? bubble.text : "");
    const nextText = fullText || `${currentText}${normalizedDelta}`;
    const ensured = await ensureBubble({
      chatId,
      threadId,
      turnId,
      linkedChat,
      initialText: nextText || STREAMING_PLACEHOLDER,
    });
    if (!ensured) {
      return false;
    }
    if (fullText) {
      if (ensured.editTimer) {
        clearTimer(ensured.editTimer);
        ensured.editTimer = null;
      }
      ensured.pendingText = nextText || STREAMING_PLACEHOLDER;
      const shouldFinalize = Boolean(finalizeTurn || ensured.turnCompletedPending);
      const flushed = await flushEdit(ensured, { finalize: shouldFinalize });
      if (shouldFinalize && ensured.messageId) {
        const key = bubbleKey(chatId, turnId);
        await finalizeBubbleAtKey(key, ensured);
      }
      return flushed;
    }
    return scheduleEdit(ensured, nextText || STREAMING_PLACEHOLDER);
  }

  async function finalizeAgentMessage({ chatId, threadId, turnId, message }) {
    const resolved = resolveBubbleForCompletion(chatId, turnId);
    const bubble = resolved?.bubble;
    if (!bubble?.messageId) {
      return false;
    }
    markBubbleFinalized(bubble);
    if (bubble.editTimer) {
      clearTimer(bubble.editTimer);
      bubble.editTimer = null;
    }
    await scheduleEdit(bubble, message, { finalize: true });
    bubbles.delete(resolved.key);
    return true;
  }

  async function clearStopMarkup(bubble) {
    if (!bubble?.messageId || typeof botClient?.editMessageReplyMarkup !== "function") {
      return;
    }
    try {
      await botClient.editMessageReplyMarkup({
        chatId: bubble.chatId,
        messageId: bubble.messageId,
        replyMarkup: TELEGRAM_EMPTY_REPLY_MARKUP,
      });
    } catch (error) {
      if (!isTelegramMessageNotModifiedError(error)) {
        warnStreamingBubble(
          `failed to clear Stop markup for chat ${bubble.chatId} message ${bubble.messageId}`,
          error
        );
        throw error;
      }
    }
  }

  async function handleTurnStarted({ chatId, threadId, turnId }) {
    const activeKey = bubbleKey(chatId, "");
    const turnKey = bubbleKey(chatId, turnId);
    const activeBubble = bubbles.get(activeKey);
    if (activeBubble && turnId && activeKey !== turnKey) {
      bubbles.delete(activeKey);
      rememberBubble(chatId, turnId, {
        ...activeBubble,
        turnId,
        turnStarted: true,
      });
    }

    await finalizeOtherBubblesForChat(chatId, turnId);

    const existing = getBubble(chatId, turnId);
    if (!existing) {
      rememberBubble(chatId, turnId, {
        chatId: String(chatId),
        threadId,
        turnId,
        messageId: null,
        text: "",
        createdAt: now(),
        lastEditAt: 0,
        pendingText: "",
        editTimer: null,
        turnStarted: true,
      });
      return true;
    }
    existing.turnStarted = true;
    return true;
  }

  async function markTurnCompleted({ chatId, turnId }) {
    const resolved = resolveBubbleForCompletion(chatId, turnId);
    if (!resolved?.bubble) {
      rememberBubble(chatId, turnId, {
        chatId: String(chatId),
        turnId,
        messageId: null,
        text: "",
        createdAt: now(),
        lastEditAt: 0,
        pendingText: "",
        editTimer: null,
        turnStarted: true,
        turnCompletedPending: true,
      });
      return true;
    }
    resolved.bubble.turnCompletedPending = true;
    if (resolved.bubble.messageId) {
      await finalizeBubbleAtKey(resolved.key, resolved.bubble);
    }
    return true;
  }

  async function handleTurnCompleted({ chatId, turnId }) {
    return markTurnCompleted({ chatId, turnId });
  }

  return {
    isStreaming,
    isLiveTurn,
    appendDelta,
    setActivityFooter,
    finalizeAgentMessage,
    handleTurnStarted,
    handleTurnCompleted,
    markTurnCompleted,
    clear(chatId, turnId) {
      const bubble = getBubble(chatId, turnId);
      if (bubble?.editTimer) {
        clearTimer(bubble.editTimer);
      }
      bubbles.delete(bubbleKey(chatId, turnId));
    },
  };
}

function parseTelegramStreamingDelta(rawMessage, { readThreadId, readTurnId, normalizeMethod } = {}) {
  const message = typeof rawMessage === "string" ? safeParseJSON(rawMessage) : rawMessage;
  const method = typeof normalizeMethod === "function"
    ? normalizeMethod(message?.method)
    : String(message?.method || "").trim();
  if (!STREAMING_DELTA_METHODS.has(method)) {
    return null;
  }
  const params = message?.params && typeof message.params === "object" && !Array.isArray(message.params)
    ? message.params
    : {};
  const threadId = typeof readThreadId === "function" ? readThreadId(params) : "";
  if (!threadId) {
    return null;
  }
  const delta = extractAssistantDeltaText(params, message);
  if (!delta) {
    return null;
  }
  return {
    method,
    params,
    threadId,
    turnId: typeof readTurnId === "function" ? readTurnId(params) : "",
    delta,
    itemId: String(params.itemId || params.item_id || "").trim(),
  };
}

function extractAssistantDeltaText(params = {}, eventObject = {}) {
  const envelope = telegramEnvelopeEvent(params);
  const candidates = [
    params?.delta,
    params?.textDelta,
    params?.text_delta,
    envelope?.delta,
    envelope?.textDelta,
    envelope?.text_delta,
    eventObject?.delta,
    eventObject?.text,
    params?.event?.delta,
    params?.event?.text,
  ];
  for (const candidate of candidates) {
    if (candidate == null) {
      continue;
    }
    const value = typeof candidate === "string" ? candidate : String(candidate);
    if (value.length > 0) {
      return value;
    }
  }
  return "";
}

function safeParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isTelegramMessageNotModifiedError(error) {
  return /MESSAGE_NOT_MODIFIED/i.test(String(error?.message || ""));
}

module.exports = {
  DEFAULT_THROTTLE_MS,
  STREAMING_DELTA_METHODS,
  STREAMING_PLACEHOLDER,
  createTelegramStreamingBubble,
  extractAssistantDeltaText,
  parseTelegramStreamingDelta,
};
