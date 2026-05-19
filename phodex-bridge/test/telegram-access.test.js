// FILE: telegram-access.test.js
// Purpose: Verifies the bridge-side entitlement boundary for Remodex Telegram.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/telegram-access

const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
} = require("../src/telegram-access");

test("telegram access is allowed unless a Pro entitlement is explicitly required", () => {
  assert.deepEqual(describeTelegramAccess({}), {
    allowed: true,
    status: TELEGRAM_ACCESS_AVAILABLE_STATUS,
    proEntitlementRequired: false,
    proEntitled: false,
    message: "Remodex Telegram is available on this bridge.",
    upgradeOptions: [],
  });
  assert.deepEqual(describeTelegramAccess({
    telegramProEntitlementRequired: true,
    telegramProEntitled: true,
  }), {
    allowed: true,
    status: TELEGRAM_ACCESS_AVAILABLE_STATUS,
    proEntitlementRequired: true,
    proEntitled: true,
    message: "Remodex Telegram is available on this bridge.",
    upgradeOptions: [],
  });
});

test("telegram access is blocked when Pro is required but missing", () => {
  assert.throws(
    () => assertTelegramAccessAllowed({
      telegramProEntitlementRequired: true,
      telegramProEntitled: false,
    }),
    (error) => error?.code === "telegram_pro_entitlement_required"
      && error.message === TELEGRAM_PRO_REQUIRED_MESSAGE
      && error.access?.status === TELEGRAM_ACCESS_REQUIRES_PRO_STATUS
  );
});

test("telegram access describes the supported Pro upgrade routes", () => {
  const access = describeTelegramAccess({
    telegramProEntitlementRequired: true,
    telegramProEntitled: false,
  });

  assert.deepEqual(access, {
    allowed: false,
    status: TELEGRAM_ACCESS_REQUIRES_PRO_STATUS,
    proEntitlementRequired: true,
    proEntitled: false,
    message: TELEGRAM_PRO_REQUIRED_MESSAGE,
    upgradeOptions: TELEGRAM_PRO_BILLING_OPTIONS.map((option) => ({ ...option })),
  });
  assert.deepEqual(
    access.upgradeOptions.map((option) => option.id),
    ["app_subscription", "web_billing", "telegram_payments"]
  );
});

test("telegram access normalizes partial descriptions without sharing upgrade option objects", () => {
  const input = {
    allowed: false,
    status: TELEGRAM_ACCESS_REQUIRES_PRO_STATUS,
    message: TELEGRAM_PRO_REQUIRED_MESSAGE,
    upgradeOptions: [{ id: "web_billing", label: "Unlock through web billing." }],
  };
  const access = normalizeTelegramAccessDescription(input);

  assert.equal(access.allowed, false);
  assert.equal(access.proEntitlementRequired, false);
  assert.equal(access.proEntitled, false);
  assert.deepEqual(access.upgradeOptions, [{ id: "web_billing", label: "Unlock through web billing." }]);
  assert.notEqual(access.upgradeOptions[0], input.upgradeOptions[0]);
  assert.equal(isTelegramAccessAllowed(access), false);
  assert.equal(isTelegramAccessAllowed({ allowed: true }), true);
  assert.equal(isTelegramAccessAllowed(null), true);
});

test("telegram access policy keeps restricted mode conversational but blocks control actions", () => {
  const blocked = describeTelegramAccess({
    telegramProEntitlementRequired: true,
    telegramProEntitled: false,
  });

  for (const command of TELEGRAM_RESTRICTED_ACCESS_COMMANDS) {
    assert.equal(canUseTelegramCommandWithAccess(command.toUpperCase(), blocked), true);
  }
  assert.equal(canUseTelegramCommandWithAccess("continue", blocked), false);
  assert.equal(canUseTelegramCommandWithAccess("new", blocked), false);
  assert.equal(canUseTelegramCommandWithAccess("pets", blocked), false);
  assert.equal(canUseTelegramCommandWithAccess("skills", blocked), false);
  assert.equal(canUseTelegramCommandWithAccess("plugins", blocked), false);
  assert.equal(canUseTelegramCommandWithAccess("reset_remote", blocked), false);
  assert.equal(canUseTelegramCommandWithAccess("resume", blocked), false);
  assert.equal(canUseTelegramCommandWithAccess("upgrade", blocked), true);
  assert.equal(canUseTelegramCommandWithAccess("limits", blocked), true);
  assert.equal(canUseTelegramCommandWithAccess("usage", blocked), true);
  assert.equal(canUseTelegramCommandWithAccess("link", blocked), true);
  assert.equal(canUseTelegramCommandWithAccess("logout", blocked), true);

  for (const action of TELEGRAM_RESTRICTED_ACCESS_ACTIONS) {
    assert.equal(canUseTelegramActionWithAccess(action.toUpperCase(), blocked), true);
  }
  assert.equal(canUseTelegramActionWithAccess("command.new", blocked), false);
  assert.equal(canUseTelegramActionWithAccess("command.pets", blocked), false);
  assert.equal(canUseTelegramActionWithAccess("command.skills", blocked), false);
  assert.equal(canUseTelegramActionWithAccess("command.plugins", blocked), false);
  assert.equal(canUseTelegramActionWithAccess("command.reset_remote", blocked), false);
  assert.equal(canUseTelegramActionWithAccess("git.reset_to_remote", blocked), false);
  assert.equal(canUseTelegramActionWithAccess("approval.accept", blocked), false);
  assert.equal(canUseTelegramActionWithAccess("command.upgrade", blocked), true);
  assert.equal(canUseTelegramActionWithAccess("command.limits", blocked), true);
  assert.equal(canUseTelegramActionWithAccess("command.usage", blocked), true);
  assert.equal(canUseTelegramActionWithAccess("command.link", blocked), false);
  assert.equal(canUseTelegramActionWithAccess("command.start", blocked), false);
  assert.equal(canUseTelegramActionWithAccess("command.logout", blocked), true);
  assert.equal(canUseTelegramCommandWithAccess("continue", describeTelegramAccess({})), true);
  assert.equal(canUseTelegramActionWithAccess("command.new", describeTelegramAccess({})), true);
});
