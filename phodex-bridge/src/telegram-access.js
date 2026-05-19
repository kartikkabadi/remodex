// FILE: telegram-access.js
// Purpose: Centralizes the local entitlement gate for the Remodex Telegram client surface.
// Layer: CLI helper
// Exports: assertTelegramAccessAllowed, describeTelegramAccess

const {
  TELEGRAM_RESTRICTED_ACCESS_CALLBACK_COMMANDS,
  TELEGRAM_RESTRICTED_ACCESS_COMMANDS,
} = require("./telegram-command-catalog");

const TELEGRAM_PRO_REQUIRED_MESSAGE = "Remodex Telegram requires an active Remodex Pro entitlement.";
const TELEGRAM_ACCESS_AVAILABLE_STATUS = "available";
const TELEGRAM_ACCESS_REQUIRES_PRO_STATUS = "requires_pro";
const TELEGRAM_RESTRICTED_ACCESS_ACTIONS = Object.freeze(TELEGRAM_RESTRICTED_ACCESS_CALLBACK_COMMANDS
  .map((command) => `command.${command}`));
const TELEGRAM_PRO_BILLING_OPTIONS = Object.freeze([
  {
    id: "app_subscription",
    label: "Use the existing Remodex app subscription entitlement.",
  },
  {
    id: "web_billing",
    label: "Unlock Remodex Pro through web billing.",
  },
  {
    id: "telegram_payments",
    label: "Unlock Remodex Pro through Telegram Payments.",
  },
]);

function assertTelegramAccessAllowed(config = {}) {
  const access = describeTelegramAccess(config);
  if (!access.allowed) {
    const error = new Error(access.message || TELEGRAM_PRO_REQUIRED_MESSAGE);
    error.code = "telegram_pro_entitlement_required";
    error.access = access;
    throw error;
  }
  return access;
}

function describeTelegramAccess(config = {}) {
  const proEntitlementRequired = config.telegramProEntitlementRequired === true;
  const proEntitled = config.telegramProEntitled === true;
  const allowed = !proEntitlementRequired || proEntitled;
  const status = allowed ? TELEGRAM_ACCESS_AVAILABLE_STATUS : TELEGRAM_ACCESS_REQUIRES_PRO_STATUS;
  return {
    allowed,
    status,
    proEntitlementRequired,
    proEntitled,
    message: allowed
      ? "Remodex Telegram is available on this bridge."
      : TELEGRAM_PRO_REQUIRED_MESSAGE,
    upgradeOptions: allowed ? [] : TELEGRAM_PRO_BILLING_OPTIONS.map((option) => ({ ...option })),
  };
}

function normalizeTelegramAccessDescription(access) {
  const fallback = describeTelegramAccess({});
  if (!access || typeof access !== "object" || Array.isArray(access)) {
    return fallback;
  }
  return {
    ...fallback,
    ...access,
    upgradeOptions: Array.isArray(access.upgradeOptions)
      ? access.upgradeOptions.map((option) => ({ ...option }))
      : fallback.upgradeOptions,
  };
}

function isTelegramAccessAllowed(access) {
  return normalizeTelegramAccessDescription(access).allowed !== false;
}

function canUseTelegramCommandWithAccess(commandName, access) {
  if (isTelegramAccessAllowed(access)) {
    return true;
  }
  return TELEGRAM_RESTRICTED_ACCESS_COMMANDS.includes(normalizeAccessKey(commandName));
}

function canUseTelegramActionWithAccess(actionType, access) {
  if (isTelegramAccessAllowed(access)) {
    return true;
  }
  return TELEGRAM_RESTRICTED_ACCESS_ACTIONS.includes(normalizeAccessKey(actionType));
}

function normalizeAccessKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

module.exports = {
  TELEGRAM_ACCESS_AVAILABLE_STATUS,
  TELEGRAM_ACCESS_REQUIRES_PRO_STATUS,
  TELEGRAM_PRO_BILLING_OPTIONS,
  TELEGRAM_PRO_REQUIRED_MESSAGE,
  TELEGRAM_RESTRICTED_ACCESS_ACTIONS,
  TELEGRAM_RESTRICTED_ACCESS_COMMANDS,
  assertTelegramAccessAllowed,
  canUseTelegramActionWithAccess,
  canUseTelegramCommandWithAccess,
  describeTelegramAccess,
  isTelegramAccessAllowed,
  normalizeTelegramAccessDescription,
};
