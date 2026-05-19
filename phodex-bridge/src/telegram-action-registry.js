// FILE: telegram-action-registry.js
// Purpose: Keeps Telegram callback payloads opaque by resolving local action IDs.
// Layer: CLI helper
// Exports: createTelegramActionRegistry
// Depends on: crypto

const { randomBytes } = require("crypto");

const TELEGRAM_ACTION_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TELEGRAM_ACTION_ID_LENGTH = 10;
const DEFAULT_TELEGRAM_ACTION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_TELEGRAM_ACTIONS = 2_000;
const TELEGRAM_ACTION_ID_MAX_ATTEMPTS = 32;

function createTelegramActionRegistry({
  now = () => Date.now(),
  randomBytesImpl = randomBytes,
  maxActions = DEFAULT_MAX_TELEGRAM_ACTIONS,
} = {}) {
  const actions = new Map();

  function createAction({
    chatId,
    type,
    payload = {},
    ttlMs = DEFAULT_TELEGRAM_ACTION_TTL_MS,
    singleUse = true,
  } = {}) {
    const normalizedChatId = normalizeNonEmptyString(chatId);
    const normalizedType = normalizeNonEmptyString(type);
    if (!normalizedChatId) {
      throw new Error("Telegram action chat id is required.");
    }
    if (!normalizedType) {
      throw new Error("Telegram action type is required.");
    }
    pruneExpiredActions(now());
    pruneOldestActions(maxActions - 1);

    const id = createUniqueActionId();
    actions.set(id, {
      chatId: normalizedChatId,
      type: normalizedType,
      payload,
      expiresAt: now() + ttlMs,
      used: false,
      singleUse: singleUse !== false,
    });
    return `a:${id}`;
  }

  function consumeAction(callbackData, { chatId, now: readNow = now } = {}) {
    const id = parseCallbackActionId(callbackData);
    const currentNow = readNow();
    const action = actions.get(id);
    if (!action) {
      throw new Error("Unknown Telegram action.");
    }
    if (action.chatId !== normalizeNonEmptyString(chatId)) {
      throw new Error("Telegram action is not allowed for this chat.");
    }
    if (action.singleUse && action.used) {
      throw new Error("Telegram action was already used.");
    }
    if (action.expiresAt <= currentNow) {
      actions.delete(id);
      throw new Error("Telegram action expired.");
    }

    if (action.singleUse) {
      action.used = true;
    }
    return {
      type: action.type,
      payload: action.payload,
    };
  }

  return {
    createAction,
    consumeAction,
  };

  function pruneExpiredActions(currentNow) {
    for (const [id, action] of actions) {
      if (action.expiresAt <= currentNow) {
        actions.delete(id);
      }
    }
  }

  function pruneOldestActions(limit) {
    if (!Number.isFinite(limit) || limit < 1) {
      actions.clear();
      return;
    }
    while (actions.size > limit) {
      const oldestId = actions.keys().next().value;
      actions.delete(oldestId);
    }
  }

  function createUniqueActionId() {
    for (let attempt = 0; attempt < TELEGRAM_ACTION_ID_MAX_ATTEMPTS; attempt += 1) {
      const id = createActionId({ randomBytesImpl });
      if (!actions.has(id)) {
        return id;
      }
    }
    throw new Error("Unable to create a unique Telegram action callback.");
  }
}

function createActionId({
  length = TELEGRAM_ACTION_ID_LENGTH,
  randomBytesImpl = randomBytes,
} = {}) {
  const bytes = normalizeRandomBytes(randomBytesImpl(length));
  if (bytes.length < length) {
    throw new Error("Telegram action entropy source returned too few bytes.");
  }
  let id = "";
  for (let index = 0; index < length; index += 1) {
    id += TELEGRAM_ACTION_ID_ALPHABET[bytes[index] % TELEGRAM_ACTION_ID_ALPHABET.length];
  }
  return id;
}

function normalizeRandomBytes(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  return Buffer.alloc(0);
}

function parseCallbackActionId(callbackData) {
  const normalized = normalizeNonEmptyString(callbackData);
  if (!normalized.startsWith("a:")) {
    throw new Error("Invalid Telegram action callback.");
  }
  const id = normalized.slice(2);
  if (!id) {
    throw new Error("Invalid Telegram action callback.");
  }
  return id;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : String(value ?? "").trim();
}

module.exports = {
  DEFAULT_MAX_TELEGRAM_ACTIONS,
  DEFAULT_TELEGRAM_ACTION_TTL_MS,
  createTelegramActionRegistry,
};
