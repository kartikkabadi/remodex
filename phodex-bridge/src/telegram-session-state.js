// FILE: telegram-session-state.js
// Purpose: Persists local Telegram linked-chat state and short-lived link codes.
// Layer: CLI helper
// Exports: Telegram session state path and link/unlink helpers.
// Depends on: fs, os, path, crypto

const fs = require("fs");
const path = require("path");
const { randomBytes } = require("crypto");
const { resolveRemodexStateDir } = require("./daemon-state");
const {
  normalizeTelegramAccessMode,
  normalizeTelegramModel,
  normalizeTelegramReasoningEffort,
  normalizeTelegramRuntimePreferences,
  normalizeTelegramServiceTier,
} = require("./telegram-runtime-preferences");

const TELEGRAM_SESSION_FILE = "telegram-session.json";
const TELEGRAM_LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TELEGRAM_LINK_CODE_LENGTH = 6;
const TELEGRAM_LINK_CODE_TTL_MS = 5 * 60 * 1000;
const TELEGRAM_LINK_CODE_PATTERN = new RegExp(`^[${TELEGRAM_LINK_CODE_ALPHABET}]{${TELEGRAM_LINK_CODE_LENGTH}}$`);

function resolveTelegramSessionStatePath(options = {}) {
  return path.join(resolveRemodexStateDir(options), TELEGRAM_SESSION_FILE);
}

function readTelegramSessionState(options = {}) {
  const stored = readJsonFile(resolveTelegramSessionStatePath(options), options);
  return normalizeTelegramSessionState(stored);
}

function writeTelegramSessionState(state, options = {}) {
  const normalized = normalizeTelegramSessionState(state);
  writeJsonFile(resolveTelegramSessionStatePath(options), normalized, options);
  return normalized;
}

function createTelegramLinkCode({
  botToken: _botToken = "",
  now = () => Date.now(),
  randomBytesImpl = randomBytes,
  ...options
} = {}) {
  const state = readTelegramSessionState(options);
  state.pendingLinkCode = {
    code: createLinkCode({ randomBytesImpl }),
    createdAt: now(),
    expiresAt: now() + TELEGRAM_LINK_CODE_TTL_MS,
  };
  return writeTelegramSessionState(state, options);
}

function linkTelegramChat({
  chatId,
  chatTitle = "",
  code,
  now = () => Date.now(),
  ...options
} = {}) {
  const normalizedChatId = normalizeNonEmptyString(chatId);
  const normalizedCode = normalizeNonEmptyString(code).toUpperCase();
  if (!normalizedChatId) {
    throw new Error("Telegram chat id is required.");
  }
  if (!normalizedCode) {
    throw new Error("Telegram link code is required.");
  }
  if (!isValidTelegramLinkCode(normalizedCode)) {
    throw new Error("Invalid Telegram link code.");
  }

  const state = readTelegramSessionState(options);
  const pending = state.pendingLinkCode;
  if (!pending?.code || pending.code !== normalizedCode) {
    throw new Error("Invalid Telegram link code.");
  }
  if (!Number.isFinite(pending.expiresAt) || pending.expiresAt <= now()) {
    throw new Error("Telegram link code expired.");
  }

  const existingChat = state.linkedChats.find((chat) => chat.chatId === normalizedChatId) || {};
  const normalizedChatTitle = normalizeNonEmptyString(chatTitle);
  const linkedChat = {
    ...existingChat,
    chatId: normalizedChatId,
    chatTitle: normalizedChatTitle || normalizeNonEmptyString(existingChat.chatTitle),
    linkedAt: now(),
  };
  state.linkedChats = [
    linkedChat,
    ...state.linkedChats.filter((chat) => chat.chatId !== normalizedChatId),
  ];
  state.pendingLinkCode = null;
  return writeTelegramSessionState(state, options);
}

function unlinkTelegramChat({ chatId = "", ...options } = {}) {
  const normalizedChatId = normalizeNonEmptyString(chatId);
  const state = readTelegramSessionState(options);
  state.linkedChats = normalizedChatId
    ? state.linkedChats.filter((chat) => chat.chatId !== normalizedChatId)
    : [];
  return writeTelegramSessionState(state, options);
}

function setTelegramActiveThread({ chatId, threadId, cwd = "", ...options } = {}) {
  const normalizedChatId = normalizeNonEmptyString(chatId);
  const normalizedThreadId = normalizeNonEmptyString(threadId);
  if (!normalizedChatId) {
    throw new Error("Telegram chat id is required.");
  }
  if (!normalizedThreadId) {
    throw new Error("Active thread id is required.");
  }
  const state = readTelegramSessionState(options);
  state.linkedChats = state.linkedChats.map((chat) => (
    chat.chatId === normalizedChatId
      ? { ...chat, activeThreadId: normalizedThreadId, activeThreadCwd: normalizeNonEmptyString(cwd) }
      : chat
  ));
  return writeTelegramSessionState(state, options);
}

function clearTelegramActiveThread({ chatId, ...options } = {}) {
  const normalizedChatId = normalizeNonEmptyString(chatId);
  if (!normalizedChatId) {
    throw new Error("Telegram chat id is required.");
  }
  const state = readTelegramSessionState(options);
  state.linkedChats = state.linkedChats.map((chat) => {
    if (chat.chatId !== normalizedChatId) {
      return chat;
    }
    const {
      activeThreadId: _activeThreadId,
      activeThreadCwd: _activeThreadCwd,
      ...rest
    } = chat;
    return rest;
  });
  return writeTelegramSessionState(state, options);
}

function setTelegramProjectBrowsePath({ chatId, path: browsePath = "", ...options } = {}) {
  const normalizedChatId = normalizeNonEmptyString(chatId);
  if (!normalizedChatId) {
    throw new Error("Telegram chat id is required.");
  }
  const state = readTelegramSessionState(options);
  state.linkedChats = state.linkedChats.map((chat) => (
    chat.chatId === normalizedChatId
      ? { ...chat, projectBrowsePath: normalizeNonEmptyString(browsePath) }
      : chat
  ));
  return writeTelegramSessionState(state, options);
}

function setTelegramRuntimePreferences({
  chatId,
  accessMode,
  model,
  reasoningEffort,
  effort,
  serviceTier,
  speed,
  ...options
} = {}) {
  const normalizedChatId = normalizeNonEmptyString(chatId);
  if (!normalizedChatId) {
    throw new Error("Telegram chat id is required.");
  }
  const state = readTelegramSessionState(options);
  state.linkedChats = state.linkedChats.map((chat) => {
    if (chat.chatId !== normalizedChatId) {
      return chat;
    }
    const runtimePreferences = normalizeTelegramRuntimePreferences({
      model,
      reasoningEffort: reasoningEffort || effort,
      serviceTier: serviceTier || speed,
    }, chat);
    return {
      ...chat,
      runtimeModel: runtimePreferences.model,
      reasoningEffort: runtimePreferences.reasoningEffort,
      runtimeServiceTier: runtimePreferences.serviceTier,
      runtimeAccessMode: normalizeTelegramAccessMode(accessMode) || normalizeTelegramAccessMode(chat.runtimeAccessMode),
    };
  });
  return writeTelegramSessionState(state, options);
}

function createLinkCode({
  length = TELEGRAM_LINK_CODE_LENGTH,
  randomBytesImpl = randomBytes,
} = {}) {
  const bytes = normalizeRandomBytes(randomBytesImpl(length));
  if (bytes.length < length) {
    throw new Error("Telegram link code entropy source returned too few bytes.");
  }
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += TELEGRAM_LINK_CODE_ALPHABET[bytes[index] % TELEGRAM_LINK_CODE_ALPHABET.length];
  }
  return code;
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

function normalizeTelegramSessionState(value) {
  const linkedChats = Array.isArray(value?.linkedChats)
    ? value.linkedChats.map(normalizeLinkedChat).filter(Boolean)
    : [];
  const pendingLinkCode = normalizePendingLinkCode(value?.pendingLinkCode);
  return {
    linkedChats,
    pendingLinkCode,
  };
}

function normalizeLinkedChat(value) {
  const chatId = normalizeNonEmptyString(value?.chatId);
  if (!chatId) {
    return null;
  }
  return {
    chatId,
    chatTitle: normalizeNonEmptyString(value?.chatTitle),
    activeThreadId: normalizeNonEmptyString(value?.activeThreadId),
    activeThreadCwd: normalizeNonEmptyString(value?.activeThreadCwd),
    projectBrowsePath: normalizeNonEmptyString(value?.projectBrowsePath),
    runtimeModel: normalizeTelegramModel(value?.runtimeModel || value?.model),
    reasoningEffort: normalizeTelegramReasoningEffort(value?.reasoningEffort || value?.effort),
    runtimeServiceTier: normalizeTelegramServiceTier(value?.runtimeServiceTier || value?.serviceTier || value?.speed),
    runtimeAccessMode: normalizeTelegramAccessMode(value?.runtimeAccessMode || value?.accessMode),
    linkedAt: Number.isFinite(value?.linkedAt) ? value.linkedAt : null,
  };
}

function normalizePendingLinkCode(value) {
  const code = normalizeNonEmptyString(value?.code).toUpperCase();
  if (!isValidTelegramLinkCode(code)) {
    return null;
  }
  return {
    code,
    createdAt: Number.isFinite(value?.createdAt) ? value.createdAt : null,
    expiresAt: Number.isFinite(value?.expiresAt) ? value.expiresAt : null,
  };
}

function isValidTelegramLinkCode(value) {
  return TELEGRAM_LINK_CODE_PATTERN.test(normalizeNonEmptyString(value).toUpperCase());
}

function writeJsonFile(targetPath, value, { fsImpl = fs } = {}) {
  fsImpl.mkdirSync(path.dirname(targetPath), { recursive: true });
  fsImpl.writeFileSync(targetPath, JSON.stringify(value, null, 2), { mode: 0o600 });
  try {
    fsImpl.chmodSync(targetPath, 0o600);
  } catch {
    // Best-effort only on filesystems without POSIX mode support.
  }
}

function readJsonFile(targetPath, { fsImpl = fs } = {}) {
  if (!fsImpl.existsSync(targetPath)) {
    return null;
  }
  try {
    return JSON.parse(fsImpl.readFileSync(targetPath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : String(value ?? "").trim();
}

module.exports = {
  TELEGRAM_LINK_CODE_LENGTH,
  TELEGRAM_LINK_CODE_TTL_MS,
  clearTelegramActiveThread,
  createTelegramLinkCode,
  linkTelegramChat,
  readTelegramSessionState,
  resolveTelegramSessionStatePath,
  setTelegramActiveThread,
  setTelegramProjectBrowsePath,
  setTelegramRuntimePreferences,
  unlinkTelegramChat,
  writeTelegramSessionState,
};
