// FILE: telegram-bot-api-client.js
// Purpose: Minimal Telegram Bot API client for local Remodex long-polling control.
// Layer: CLI helper
// Exports: createTelegramBotApiClient
// Depends on: global fetch

const DEFAULT_TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TELEGRAM_CALLBACK_ANSWER_TEXT_MAX_CHARS = 200;
const TELEGRAM_MESSAGE_TEXT_MAX_CHARS = 4096;
const TELEGRAM_TRUNCATION_SUFFIX = "\n[truncated by Remodex Telegram]";
const TELEGRAM_EMPTY_REPLY_MARKUP = Object.freeze({ inline_keyboard: [] });

function createTelegramBotApiClient({
  botToken,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = DEFAULT_TELEGRAM_API_BASE_URL,
} = {}) {
  const token = normalizeRequiredString(botToken, "Telegram bot token is required.");
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for Telegram Bot API calls.");
  }

  async function call(method, payload = {}) {
    let response;
    try {
      response = await fetchImpl(`${apiBaseUrl}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new Error(`Telegram Bot API ${method} failed: ${sanitizeTelegramErrorMessage(error?.message)}`);
    }
    const body = await readTelegramJsonResponse(response, method);
    if (!body?.ok) {
      const description = sanitizeTelegramErrorMessage(body?.description || response.status || "unknown error");
      const error = new Error(`Telegram Bot API ${method} failed: ${description}`);
      if (Number.isFinite(body?.parameters?.retry_after)) {
        error.retryAfterSeconds = body.parameters.retry_after;
      }
      throw error;
    }
    return body.result;
  }

  async function callIgnoringNotModified(method, payload = {}) {
    try {
      return await call(method, payload);
    } catch (error) {
      if (isTelegramMessageNotModifiedError(error)) {
        return null;
      }
      throw error;
    }
  }

  return {
    getMe() {
      return call("getMe");
    },
    getWebhookInfo() {
      return call("getWebhookInfo");
    },
    deleteWebhook({ dropPendingUpdates = false } = {}) {
      return call("deleteWebhook", { drop_pending_updates: dropPendingUpdates === true });
    },
    getUpdates({ offset = 0, timeout = 20, limit = 100 } = {}) {
      return call("getUpdates", { offset, timeout, limit });
    },
    getFile({ fileId }) {
      return call("getFile", {
        file_id: normalizeRequiredString(fileId, "Telegram file id is required."),
      });
    },
    async downloadFile({ filePath }) {
      const normalizedFilePath = normalizeRequiredString(filePath, "Telegram file path is required.").replace(/^\/+/, "");
      let response;
      try {
        response = await fetchImpl(`${apiBaseUrl}/file/bot${token}/${normalizedFilePath}`, {
          method: "GET",
        });
      } catch (error) {
        throw new Error(`Telegram Bot API file download failed: ${sanitizeTelegramErrorMessage(error?.message)}`);
      }
      if (!response?.ok) {
        throw new Error(`Telegram Bot API file download failed: ${response?.status || "unknown error"}`);
      }
      let arrayBuffer;
      try {
        arrayBuffer = await response.arrayBuffer();
      } catch (error) {
        throw new Error(`Telegram Bot API file download failed: ${sanitizeTelegramErrorMessage(error?.message)}`);
      }
      return {
        data: Buffer.from(arrayBuffer),
        contentType: typeof response.headers?.get === "function" ? response.headers.get("content-type") || "" : "",
      };
    },
    sendMessage({ chatId, text, replyMarkup }) {
      const payload = {
        chat_id: normalizeRequiredString(chatId, "Telegram chat id is required."),
        text: truncateTelegramMessageText(text),
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }
      return call("sendMessage", payload);
    },
    sendChatAction({ chatId, action = "typing" }) {
      return call("sendChatAction", {
        chat_id: normalizeRequiredString(chatId, "Telegram chat id is required."),
        action: normalizeRequiredString(action, "Telegram chat action is required."),
      });
    },
    editMessageText({ chatId, messageId, text, replyMarkup }) {
      const payload = {
        chat_id: normalizeRequiredString(chatId, "Telegram chat id is required."),
        message_id: messageId,
        text: truncateTelegramMessageText(text),
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }
      return callIgnoringNotModified("editMessageText", payload);
    },
    editMessageReplyMarkup({ chatId, messageId, replyMarkup = TELEGRAM_EMPTY_REPLY_MARKUP }) {
      const payload = {
        chat_id: normalizeRequiredString(chatId, "Telegram chat id is required."),
        message_id: messageId,
        reply_markup: replyMarkup || TELEGRAM_EMPTY_REPLY_MARKUP,
      };
      return callIgnoringNotModified("editMessageReplyMarkup", payload);
    },
    answerCallbackQuery({ callbackQueryId, text = "" }) {
      return call("answerCallbackQuery", {
        callback_query_id: normalizeRequiredString(callbackQueryId, "Telegram callback query id is required."),
        text: truncateTelegramText(text, TELEGRAM_CALLBACK_ANSWER_TEXT_MAX_CHARS),
      });
    },
    setMyCommands({ commands = [] } = {}) {
      return call("setMyCommands", { commands });
    },
  };
}

function isTelegramMessageNotModifiedError(error) {
  return /MESSAGE_NOT_MODIFIED/i.test(String(error?.message || ""));
}

function sanitizeTelegramErrorMessage(message) {
  return String(message || "network error")
    .replace(/\/bot[^/\s]+/g, "/bot<redacted>")
    .replace(/\bbot\d+:[A-Za-z0-9:_-]+/g, "bot<redacted>");
}

async function readTelegramJsonResponse(response, method) {
  if (typeof response?.json !== "function") {
    throw new Error(`Telegram Bot API ${method} failed: invalid JSON response`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`Telegram Bot API ${method} failed: invalid JSON response`);
  }
}

function normalizeRequiredString(value, message) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function truncateTelegramText(value, maxChars) {
  const text = String(value ?? "");
  if (!Number.isFinite(maxChars) || maxChars < 1) {
    return "";
  }
  return Array.from(text).slice(0, maxChars).join("");
}

function truncateTelegramMessageText(value) {
  const text = String(value ?? "");
  const chars = Array.from(text);
  if (chars.length <= TELEGRAM_MESSAGE_TEXT_MAX_CHARS) {
    return text;
  }
  const suffixLength = Array.from(TELEGRAM_TRUNCATION_SUFFIX).length;
  return `${chars.slice(0, TELEGRAM_MESSAGE_TEXT_MAX_CHARS - suffixLength).join("")}${TELEGRAM_TRUNCATION_SUFFIX}`;
}

module.exports = {
  TELEGRAM_CALLBACK_ANSWER_TEXT_MAX_CHARS,
  TELEGRAM_EMPTY_REPLY_MARKUP,
  TELEGRAM_MESSAGE_TEXT_MAX_CHARS,
  TELEGRAM_TRUNCATION_SUFFIX,
  createTelegramBotApiClient,
  isTelegramMessageNotModifiedError,
};
