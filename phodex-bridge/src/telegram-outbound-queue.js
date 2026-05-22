// FILE: telegram-outbound-queue.js
// Purpose: Per-chat Telegram outbound pacing with retry_after handling.
// Layer: CLI helper
// Exports: createTelegramOutboundQueue, wrapTelegramBotClientWithOutboundQueue
// Depends on: telegram-bot-api-client

const DEFAULT_MIN_INTERVAL_MS = 1000;
const QUEUED_BOT_METHODS = new Set([
  "sendMessage",
  "editMessageText",
  "sendChatAction",
]);

function createTelegramOutboundQueue({
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
} = {}) {
  const chats = new Map();

  function chatState(chatId) {
    const key = String(chatId ?? "");
    if (!chats.has(key)) {
      chats.set(key, {
        pending: [],
        draining: false,
        lastSentAt: 0,
      });
    }
    return chats.get(key);
  }

  async function runWithRetry(task) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        const retryAfterSeconds = Number(error?.retryAfterSeconds);
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          await sleep(Math.ceil(retryAfterSeconds * 1000));
          continue;
        }
        throw error;
      }
    }
    throw new Error("Telegram outbound queue exceeded retry budget.");
  }

  async function drain(chatId) {
    const state = chatState(chatId);
    if (state.draining) {
      return;
    }
    state.draining = true;
    try {
      while (state.pending.length > 0) {
        const elapsed = now() - state.lastSentAt;
        const waitMs = minIntervalMs - elapsed;
        if (waitMs > 0) {
          await sleep(waitMs);
        }
        const job = state.pending.shift();
        if (!job) {
          continue;
        }
        try {
          const result = await runWithRetry(job.run);
          state.lastSentAt = now();
          job.resolve(result);
        } catch (error) {
          job.reject(error);
        }
      }
    } finally {
      state.draining = false;
      const followUp = chatState(chatId);
      if (followUp.pending.length > 0 && !followUp.draining) {
        drain(chatId).catch(() => {});
      }
    }
  }

  function enqueue(chatId, run) {
    return new Promise((resolve, reject) => {
      const state = chatState(chatId);
      state.pending.push({ run, resolve, reject });
      drain(chatId).catch(reject);
    });
  }

  return {
    enqueue,
    pendingCount(chatId) {
      return chatState(chatId).pending.length;
    },
  };
}

function wrapTelegramBotClientWithOutboundQueue(botClient, queue = createTelegramOutboundQueue()) {
  if (!botClient || typeof botClient !== "object") {
    throw new Error("Telegram bot client is required for outbound queue wrapping.");
  }

  const wrapped = { ...botClient };
  for (const methodName of QUEUED_BOT_METHODS) {
    const original = botClient[methodName];
    if (typeof original !== "function") {
      continue;
    }
    wrapped[methodName] = (args = {}) => queue.enqueue(
      args.chatId,
      () => original.call(botClient, args),
    );
  }
  wrapped.__telegramOutboundQueue = queue;
  return wrapped;
}

module.exports = {
  DEFAULT_MIN_INTERVAL_MS,
  QUEUED_BOT_METHODS,
  createTelegramOutboundQueue,
  wrapTelegramBotClientWithOutboundQueue,
};
