// FILE: remodex-cli.test.js
// Purpose: Verifies the public CLI exposes version, service control, and machine-readable status output.
// Layer: Integration-lite test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, child_process, path, ../package.json, ../bin/remodex

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const path = require("path");
const { version } = require("../package.json");
const { main, runCli } = require("../bin/remodex");

test("remodex --version prints the package version", () => {
  const cliPath = path.join(__dirname, "..", "bin", "remodex.js");
  const output = execFileSync(process.execPath, [cliPath, "--version"], {
    encoding: "utf8",
  }).trim();

  assert.equal(output, version);
});

test("remodex restart reuses the macOS service start flow", async () => {
  const calls = [];
  const messages = [];

  await main({
    argv: ["node", "remodex", "restart"],
    platform: "darwin",
    consoleImpl: {
      log(message) {
        messages.push(message);
      },
      error(message) {
        messages.push(message);
      },
    },
    exitImpl(code) {
      throw new Error(`unexpected exit ${code}`);
    },
    deps: {
      readBridgeConfig() {
        calls.push("read-config");
      },
      async startMacOSBridgeService(options) {
        calls.push(["start-service", options]);
        return {
          plistPath: "/tmp/remodex.plist",
          pairingSession: { relay: "ws://127.0.0.1:9000/relay" },
        };
      },
    },
  });

  assert.deepEqual(calls, [
    "read-config",
    ["start-service", { waitForPairing: false }],
  ]);
  assert.deepEqual(messages, [
    "[remodex] macOS bridge service restarted.",
  ]);
});

test("remodex up shows a startup indicator while waiting for the pairing QR", async () => {
  const calls = [];
  const messages = [];

  await main({
    argv: ["node", "remodex", "up"],
    platform: "darwin",
    consoleImpl: {
      log(message) {
        messages.push(message);
      },
      error(message) {
        messages.push(message);
      },
    },
    exitImpl(code) {
      throw new Error(`unexpected exit ${code}`);
    },
    deps: {
      async startMacOSBridgeService(options) {
        calls.push(["start-service", options]);
        return {
          pairingSession: { pairingPayload: { sessionId: "session-up" } },
        };
      },
      printMacOSBridgePairingQr(options) {
        calls.push(["print-qr", options]);
      },
    },
  });

  assert.deepEqual(messages, [
    "[remodex] Starting bridge and pairing QR...",
  ]);
  assert.deepEqual(calls, [
    ["start-service", { waitForPairing: true }],
    ["print-qr", { pairingSession: { pairingPayload: { sessionId: "session-up" } } }],
  ]);
});

test("runCli prints expected failures without a Node stack trace", async () => {
  const messages = [];
  let exitCode = null;

  await runCli({
    async mainImpl() {
      throw new Error("No relay URL configured. Run ./run-local-remodex.sh.");
    },
    consoleImpl: {
      error(message) {
        messages.push(message);
      },
    },
    exitImpl(code) {
      exitCode = code;
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(messages, [
    "[remodex] No relay URL configured. Run ./run-local-remodex.sh.",
  ]);
  assert.equal(messages.join("\n").includes("at "), false);
});

test("remodex status --json exposes daemon metadata for companion apps", async () => {
  const writes = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = (chunk, encoding, callback) => {
    writes.push(String(chunk));
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };

  try {
    await main({
      argv: ["node", "remodex", "status", "--json"],
      platform: "darwin",
      consoleImpl: {
        log() {},
        error(message) {
          throw new Error(`unexpected error: ${message}`);
        },
      },
      exitImpl(code) {
        throw new Error(`unexpected exit ${code}`);
      },
      deps: {
        getMacOSBridgeServiceStatus() {
          return {
            daemonConfig: {
              relayUrl: "ws://127.0.0.1:9000/relay",
              telegramBotToken: "<redacted>",
            },
            bridgeStatus: {
              connectionStatus: "connected",
              pid: 77,
            },
            pairingSession: {
              pairingPayload: {
                relay: "ws://127.0.0.1:9000/relay",
                sessionId: "<redacted>",
              },
            },
          };
        },
        printMacOSBridgeServiceStatus() {
          throw new Error("status printer should not run for --json");
        },
      },
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const payload = JSON.parse(writes.join("").trim());
  assert.equal(payload.currentVersion, version);
  assert.equal(payload.daemonConfig?.relayUrl, "ws://127.0.0.1:9000/relay");
  assert.equal(payload.daemonConfig?.telegramBotToken, "<redacted>");
  assert.equal(payload.bridgeStatus?.connectionStatus, "connected");
  assert.equal(payload.pairingSession?.pairingPayload?.sessionId, "<redacted>");
});

test("remodex telegram link prints a short-lived code without the bot token", async () => {
  const messages = [];

  await main({
    argv: ["node", "remodex", "telegram", "link"],
    platform: "darwin",
    consoleImpl: {
      log(message) {
        messages.push(message);
      },
      error(message) {
        throw new Error(`unexpected error: ${message}`);
      },
    },
    exitImpl(code) {
      throw new Error(`unexpected exit ${code}`);
    },
    deps: {
      createTelegramLinkCode() {
        return {
          pendingLinkCode: {
            code: "ABC234",
            expiresAt: 1_800_000_300_000,
          },
        };
      },
      renderTelegramLinkInstructions({ code, expiresAt }) {
        return `Telegram link code: ${code} expires ${expiresAt}`;
      },
    },
  });

  assert.deepEqual(messages, ["Telegram link code: ABC234 expires 1800000300000"]);
  assert.doesNotMatch(messages.join("\n"), /token|secret/i);
});

test("remodex telegram link honors the Pro entitlement gate", async () => {
  await assert.rejects(
    () => main({
      argv: ["node", "remodex", "telegram", "link"],
      platform: "darwin",
      consoleImpl: {
        log(message) {
          throw new Error(`unexpected log: ${message}`);
        },
        error(message) {
          throw new Error(`unexpected error: ${message}`);
        },
      },
      exitImpl(code) {
        throw new Error(`unexpected exit ${code}`);
      },
      deps: {
        readBridgeConfig() {
          return {
            telegramProEntitlementRequired: true,
            telegramProEntitled: false,
          };
        },
        describeTelegramAccess(config) {
          return {
            allowed: false,
            proEntitlementRequired: config.telegramProEntitlementRequired,
            proEntitled: config.telegramProEntitled,
          };
        },
        assertTelegramAccessAllowed() {
          const error = new Error("Remodex Telegram requires an active Remodex Pro entitlement.");
          error.code = "telegram_pro_entitlement_required";
          throw error;
        },
        createTelegramLinkCode() {
          throw new Error("link code should not be created when Telegram access is blocked");
        },
      },
    }),
    /active Remodex Pro entitlement/
  );
});

test("remodex telegram status reports linked chat count as json", async () => {
  const writes = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = (chunk, encoding, callback) => {
    writes.push(String(chunk));
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };

  try {
    await main({
      argv: ["node", "remodex", "telegram", "status", "--json"],
      platform: "darwin",
      consoleImpl: {
        log() {},
        error(message) {
          throw new Error(`unexpected error: ${message}`);
        },
      },
      exitImpl(code) {
        throw new Error(`unexpected exit ${code}`);
      },
      deps: {
        readTelegramSessionState() {
          return {
            linkedChats: [{ chatId: "42", chatTitle: "Kartik" }],
            pendingLinkCode: { code: "ABC234", expiresAt: 1_800_000_300_000 },
          };
        },
      },
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const payload = JSON.parse(writes.join("").trim());
  assert.equal(payload.currentVersion, version);
  assert.equal(payload.telegram.linkedChatCount, 1);
  assert.equal(payload.telegram.hasPendingLinkCode, true);
  assert.deepEqual(payload.telegram.access, {
    allowed: true,
    status: "available",
    proEntitlementRequired: false,
    proEntitled: false,
    message: "Remodex Telegram is available on this bridge.",
    upgradeOptions: [],
  });
});

test("remodex telegram unlink removes a selected linked chat", async () => {
  const messages = [];
  const calls = [];

  await main({
    argv: ["node", "remodex", "telegram", "unlink", "42"],
    platform: "darwin",
    consoleImpl: {
      log(message) {
        messages.push(message);
      },
      error(message) {
        throw new Error(`unexpected error: ${message}`);
      },
    },
    exitImpl(code) {
      throw new Error(`unexpected exit ${code}`);
    },
    deps: {
      unlinkTelegramChat({ chatId }) {
        calls.push(chatId);
        return {
          linkedChats: [{ chatId: "84", chatTitle: "Backup" }],
          pendingLinkCode: null,
        };
      },
    },
  });

  assert.deepEqual(calls, ["42"]);
  assert.deepEqual(messages, ["[remodex] Unlinked Telegram chat: 42"]);
});

test("remodex telegram unlink can clear all linked chats as json", async () => {
  const writes = [];
  const calls = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = (chunk, encoding, callback) => {
    writes.push(String(chunk));
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };

  try {
    await main({
      argv: ["node", "remodex", "telegram", "unlink", "--json"],
      platform: "darwin",
      consoleImpl: {
        log() {},
        error(message) {
          throw new Error(`unexpected error: ${message}`);
        },
      },
      exitImpl(code) {
        throw new Error(`unexpected exit ${code}`);
      },
      deps: {
        unlinkTelegramChat({ chatId }) {
          calls.push(chatId);
          return {
            linkedChats: [],
            pendingLinkCode: null,
          };
        },
      },
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const payload = JSON.parse(writes.join("").trim());
  assert.deepEqual(calls, [""]);
  assert.equal(payload.currentVersion, version);
  assert.equal(payload.telegram.linkedChatCount, 0);
});
