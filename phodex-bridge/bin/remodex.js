#!/usr/bin/env node
// FILE: remodex.js
// Purpose: CLI surface for foreground bridge runs, pairing reset, thread resume, and macOS service control.
// Layer: CLI binary
// Exports: none
// Depends on: ../src

const {
  getMacOSBridgeServiceStatus,
  printMacOSBridgePairingQr,
  printMacOSBridgeServiceStatus,
  readBridgeConfig,
  resetMacOSBridgePairing,
  runMacOSBridgeService,
  startBridge,
  startMacOSBridgeService,
  stopMacOSBridgeService,
  assertTelegramAccessAllowed,
  createTelegramLinkCode,
  describeTelegramAccess,
  readTelegramSessionState,
  renderTelegramLinkInstructions,
  unlinkTelegramChat,
  resetBridgePairing,
  openLastActiveThread,
  watchThreadRollout,
} = require("../src");
const { version } = require("../package.json");

const defaultDeps = {
  getMacOSBridgeServiceStatus,
  printMacOSBridgePairingQr,
  printMacOSBridgeServiceStatus,
  readBridgeConfig,
  resetMacOSBridgePairing,
  runMacOSBridgeService,
  startBridge,
  startMacOSBridgeService,
  stopMacOSBridgeService,
  assertTelegramAccessAllowed,
  createTelegramLinkCode,
  describeTelegramAccess,
  readTelegramSessionState,
  renderTelegramLinkInstructions,
  unlinkTelegramChat,
  resetBridgePairing,
  openLastActiveThread,
  watchThreadRollout,
};

if (require.main === module) {
  void runCli();
}

// ─── ENTRY POINT ─────────────────────────────────────────────

// Runs the CLI process and turns expected configuration failures into readable terminal output.
async function runCli({
  mainImpl = main,
  consoleImpl = console,
  exitImpl = process.exit,
} = {}) {
  try {
    await mainImpl();
  } catch (error) {
    const rawMessage = error && typeof error.message === "string"
      ? error.message.trim()
      : String(error || "Command failed");
    const message = rawMessage || "Command failed";
    consoleImpl.error(message.startsWith("[remodex]") ? message : `[remodex] ${message}`);
    exitImpl(1);
  }
}

async function main({
  argv = process.argv,
  platform = process.platform,
  consoleImpl = console,
  exitImpl = process.exit,
  deps = defaultDeps,
} = {}) {
  const { command, jsonOutput, subcommand, subcommandValue, watchThreadId } = parseCliArgs(argv.slice(2));

  if (isVersionCommand(command)) {
    emitVersion({ jsonOutput, consoleImpl });
    return;
  }

  if (command === "up") {
    if (platform === "darwin") {
      consoleImpl.log("[remodex] Starting bridge and pairing QR...");
      const result = await deps.startMacOSBridgeService({
        waitForPairing: true,
      });
      deps.printMacOSBridgePairingQr({
        pairingSession: result.pairingSession,
      });
      return;
    }

    deps.startBridge();
    return;
  }

  if (command === "run") {
    deps.startBridge();
    return;
  }

  if (command === "run-service") {
    deps.runMacOSBridgeService();
    return;
  }

  if (command === "start") {
    assertMacOSCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    deps.readBridgeConfig();
    const result = await deps.startMacOSBridgeService({
      waitForPairing: false,
    });
    emitResult({
      payload: {
        ok: true,
        currentVersion: version,
        plistPath: result?.plistPath,
        pairingSession: result?.pairingSession,
      },
      message: "[remodex] macOS bridge service is running.",
      jsonOutput,
      consoleImpl,
    });
    return;
  }

  if (command === "restart") {
    assertMacOSCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    deps.readBridgeConfig();
    const result = await deps.startMacOSBridgeService({
      waitForPairing: false,
    });
    emitResult({
      payload: {
        ok: true,
        currentVersion: version,
        plistPath: result?.plistPath,
        pairingSession: result?.pairingSession,
      },
      message: "[remodex] macOS bridge service restarted.",
      jsonOutput,
      consoleImpl,
    });
    return;
  }

  if (command === "stop") {
    assertMacOSCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    deps.stopMacOSBridgeService();
    emitResult({
      payload: {
        ok: true,
        currentVersion: version,
      },
      message: "[remodex] macOS bridge service stopped.",
      jsonOutput,
      consoleImpl,
    });
    return;
  }

  if (command === "status") {
    assertMacOSCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    if (jsonOutput) {
      emitJson({
        ...deps.getMacOSBridgeServiceStatus(),
        currentVersion: version,
      });
      return;
    }
    deps.printMacOSBridgeServiceStatus();
    return;
  }

  if (command === "telegram") {
    handleTelegramCommand({
      subcommand,
      subcommandValue,
      jsonOutput,
      consoleImpl,
      exitImpl,
      deps,
    });
    return;
  }

  if (command === "reset-pairing") {
    try {
      if (platform === "darwin") {
        deps.resetMacOSBridgePairing();
        emitResult({
          payload: {
            ok: true,
            currentVersion: version,
            platform: "darwin",
          },
          message: "[remodex] Stopped the macOS bridge service and cleared the saved pairing state. Run `remodex up` to pair again.",
          jsonOutput,
          consoleImpl,
        });
      } else {
        deps.resetBridgePairing();
        emitResult({
          payload: {
            ok: true,
            currentVersion: version,
            platform,
          },
          message: "[remodex] Cleared the saved pairing state. Run `remodex up` to pair again.",
          jsonOutput,
          consoleImpl,
        });
      }
    } catch (error) {
      consoleImpl.error(`[remodex] ${(error && error.message) || "Failed to clear the saved pairing state."}`);
      exitImpl(1);
    }
    return;
  }

  if (command === "resume") {
    try {
      const state = deps.openLastActiveThread();
      emitResult({
        payload: {
          ok: true,
          currentVersion: version,
          threadId: state.threadId,
          source: state.source || "unknown",
        },
        message: `[remodex] Opened last active thread: ${state.threadId} (${state.source || "unknown"})`,
        jsonOutput,
        consoleImpl,
      });
    } catch (error) {
      consoleImpl.error(`[remodex] ${(error && error.message) || "Failed to reopen the last thread."}`);
      exitImpl(1);
    }
    return;
  }

  if (command === "watch") {
    try {
      deps.watchThreadRollout(watchThreadId);
    } catch (error) {
      consoleImpl.error(`[remodex] ${(error && error.message) || "Failed to watch the thread rollout."}`);
      exitImpl(1);
    }
    return;
  }

  consoleImpl.error(`Unknown command: ${command}`);
  consoleImpl.error(
    "Usage: remodex up | remodex run | remodex start | remodex restart | remodex stop | remodex status | "
    + "remodex telegram link|status|unlink [chatId] | remodex reset-pairing | remodex resume | "
    + "remodex watch [threadId] | remodex --version | append --json for machine-readable output"
  );
  exitImpl(1);
}

function handleTelegramCommand({
  subcommand = "status",
  subcommandValue = "",
  jsonOutput = false,
  consoleImpl = console,
  exitImpl = process.exit,
  deps = defaultDeps,
} = {}) {
  const config = typeof deps.readBridgeConfig === "function"
    ? deps.readBridgeConfig()
    : {};
  const describeTelegramAccessImpl = typeof deps.describeTelegramAccess === "function"
    ? deps.describeTelegramAccess
    : defaultDeps.describeTelegramAccess;
  const access = describeTelegramAccessImpl(config);

  if (subcommand === "link") {
    if (typeof deps.assertTelegramAccessAllowed === "function") {
      deps.assertTelegramAccessAllowed(config);
    }
    const state = deps.createTelegramLinkCode();
    const pendingLinkCode = state.pendingLinkCode;
    const payload = {
      ok: true,
      currentVersion: version,
      telegram: {
        pendingLinkCode,
      },
    };
    emitResult({
      payload,
      message: deps.renderTelegramLinkInstructions({
        code: pendingLinkCode.code,
        expiresAt: pendingLinkCode.expiresAt,
      }),
      jsonOutput,
      consoleImpl,
    });
    return;
  }

  if (subcommand === "status") {
    const state = deps.readTelegramSessionState();
    const accessLabel = access.allowed ? "available" : access.status || "blocked";
    emitResult({
      payload: {
        ok: true,
        currentVersion: version,
        telegram: {
          linkedChatCount: state.linkedChats.length,
          linkedChats: state.linkedChats.map((chat) => ({
            chatId: chat.chatId,
            chatTitle: chat.chatTitle,
            linkedAt: chat.linkedAt,
          })),
          hasPendingLinkCode: Boolean(state.pendingLinkCode),
          pendingLinkCodeExpiresAt: state.pendingLinkCode?.expiresAt ?? null,
          access,
        },
      },
      message: `[remodex] Telegram linked chats: ${state.linkedChats.length}; access: ${accessLabel}`,
      jsonOutput,
      consoleImpl,
    });
    return;
  }

  if (subcommand === "unlink") {
    const state = deps.unlinkTelegramChat({ chatId: subcommandValue });
    emitResult({
      payload: {
        ok: true,
        currentVersion: version,
        telegram: {
          linkedChatCount: state.linkedChats.length,
        },
      },
      message: subcommandValue
        ? `[remodex] Unlinked Telegram chat: ${subcommandValue}`
        : "[remodex] Unlinked all Telegram chats.",
      jsonOutput,
      consoleImpl,
    });
    return;
  }

  consoleImpl.error("[remodex] Unknown telegram command. Usage: remodex telegram link|status|unlink [chatId]");
  exitImpl(1);
}

function parseCliArgs(rawArgs) {
  const positionals = [];
  let jsonOutput = false;

  for (const arg of rawArgs) {
    if (arg === "--json") {
      jsonOutput = true;
      continue;
    }

    positionals.push(arg);
  }

  return {
    command: positionals[0] || "up",
    jsonOutput,
    subcommand: positionals[1] || "status",
    subcommandValue: positionals[2] || "",
    watchThreadId: positionals[1] || "",
  };
}

function emitVersion({
  jsonOutput = false,
  consoleImpl = console,
} = {}) {
  if (jsonOutput) {
    emitJson({
      currentVersion: version,
    });
    return;
  }

  consoleImpl.log(version);
}

function emitResult({
  payload,
  message,
  jsonOutput = false,
  consoleImpl = console,
} = {}) {
  if (jsonOutput) {
    emitJson(payload);
    return;
  }

  consoleImpl.log(message);
}

function emitJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function assertMacOSCommand(name, {
  platform = process.platform,
  consoleImpl = console,
  exitImpl = process.exit,
} = {}) {
  if (platform === "darwin") {
    return;
  }

  consoleImpl.error(`[remodex] \`${name}\` is only available on macOS. Use \`remodex up\` or \`remodex run\` for the foreground bridge on this OS.`);
  exitImpl(1);
}

function isVersionCommand(value) {
  return value === "-v" || value === "--v" || value === "-V" || value === "--version" || value === "version";
}

module.exports = {
  isVersionCommand,
  main,
  runCli,
};
