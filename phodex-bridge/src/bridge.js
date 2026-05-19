// FILE: bridge.js
// Purpose: Runs Codex locally, bridges relay traffic, and coordinates desktop refreshes for Codex.app.
// Layer: CLI service
// Exports: startBridge
// Depends on: ws, crypto, os, ./bridge-status, ./codex-desktop-refresher, ./codex-transport, ./rollout-watch, ./voice-handler

const WebSocket = require("ws");
const { randomBytes } = require("crypto");
const { execFile, spawn } = require("child_process");
const path = require("path");
const os = require("os");
const { promisify } = require("util");
const {
  CodexDesktopRefresher,
  readBridgeConfig,
} = require("./codex-desktop-refresher");
const {
  buildHeartbeatBridgeStatus,
  createBridgeStatusPublisher,
  hasRelayConnectionGoneStale,
} = require("./bridge-status");
const { createCodexTransport } = require("./codex-transport");
const {
  createThreadRolloutActivityWatcher,
  findRecentRolloutFileForContextRead,
  readLatestContextWindowUsage,
  resolveSessionsRoot,
} = require("./rollout-watch");
const { printQR } = require("./qr");
const { readLastActiveThread, rememberActiveThread } = require("./session-state");
const { handleDesktopMethod, handleDesktopRequest } = require("./desktop-handler");
const { readDaemonConfig, writeDaemonConfig } = require("./daemon-state");
const {
  gitBranchesWithStatus,
  gitCheckout,
  gitCreateBranch,
  gitCreateWorktree,
  gitDiff,
  gitGenerateCommitMessage,
  gitGeneratePullRequestDraft,
  gitInit,
  gitLog,
  gitPull,
  gitRemoteUrl,
  gitResetToRemote,
  gitRunStackedAction,
  gitStash,
  gitStashPop,
  gitStatus,
  handleGitRequest,
  threadGenerateTitle,
  threadNameSet,
} = require("./git-handler");
const { handleThreadContextRequest } = require("./thread-context-handler");
const { handleWorkspaceMethod, handleWorkspaceRequest } = require("./workspace-handler");
const {
  handleProjectRequest,
  projectCreateDirectory,
  projectListDirectory,
  projectQuickLocations,
  projectSearchDirectories,
  projectValidatePath,
} = require("./project-handler");
const { handlePetMethod, handlePetRequest } = require("./pet-handler");
const { createNotificationsHandler } = require("./notifications-handler");
const { createVoiceHandler, resolveVoiceAuth, transcribeVoice } = require("./voice-handler");
const {
  composeSanitizedAuthStatusFromSettledResults,
} = require("./account-status");
const { createBridgePackageVersionStatusReader } = require("./package-version-status");
const { createPushNotificationServiceClient } = require("./push-notification-service-client");
const { createPushNotificationTracker } = require("./push-notification-tracker");
const { resolveCodexGeneratedImagesRoot } = require("./codex-home");
const {
  loadOrCreateBridgeDeviceState,
  rememberLastSeenPhoneAppVersion,
  resolveBridgeRelaySession,
} = require("./secure-device-state");
const { createBridgeSecureTransport } = require("./secure-transport");
const { createRolloutLiveMirrorController } = require("./rollout-live-mirror");
const {
  createDesktopIpcActionFollower,
} = require("./desktop-ipc-action-follower");
const { createTelegramAdapterFromBridgeConfig } = require("./telegram-adapter");
const { buildTelegramFeedbackMailtoUrl } = require("./telegram-feedback");
const { normalizeTelegramAccessMode } = require("./telegram-runtime-preferences");
const {
  buildTelegramApprovalResponseResult,
  buildTelegramCheckpointRestoreApplyParams,
  buildTelegramCodexInputRequest,
  buildTelegramManualCheckpointRef,
  buildTelegramReviewStartParams,
  buildTelegramRuntimeRequestAttempts,
  buildTelegramThreadForkParams,
  buildTelegramThreadResumeParams,
  buildTelegramThreadStartParams,
  extractTelegramTitleSeedText,
  filterTelegramThreads,
  findActiveTurnId,
  findTelegramThreadById,
  isTelegramMissingRolloutError,
  normalizeTelegramCreatedThread,
  normalizeTelegramForkedThread,
  normalizeTelegramThreadsList,
  normalizeTelegramWorktreeThreadResult,
  readTelegramThreadCwd,
  readThreadFromPayload,
  shouldRetryTelegramRuntimeRequest,
  shouldRetryTelegramRuntimeWithoutField,
  summarizeTelegramDiff,
  summarizeTelegramThreadActivity,
} = require("./telegram-bridge-protocol");
const { version: bridgePackageVersion = "" } = require("../package.json");
const {
  MINIMUM_SUPPORTED_IOS_APP_VERSION,
  buildCachedIOSAppCompatibilityWarning,
  buildIOSAppCompatibilitySnapshot,
  normalizeVersionString,
} = require("./ios-app-compatibility");
const { createShortPairingCode, SHORT_PAIRING_CODE_LENGTH } = require("./qr");
const {
  readThreadTurnsListPageFromSessionJsonl,
} = require("./session-jsonl-history");

const execFileAsync = promisify(execFile);
const RELAY_WATCHDOG_PING_INTERVAL_MS = 10_000;
const RELAY_HISTORY_IMAGE_REFERENCE_URL = "remodex://history-image-elided";
const RELAY_THREAD_PAYLOAD_SOFT_LIMIT_BYTES = 4 * 1024 * 1024;
const RELAY_HISTORY_TEXT_TAIL_LIMIT_CHARS = 24_000;
const RELAY_HISTORY_RECENT_TURN_TARGET = 40;
const RELAY_TURNS_LIST_TARGET_BUDGET_MS = 5_500;
const RELAY_TURNS_LIST_BUDGET_RESERVE_MS = 1_000;
const RELAY_TURNS_LIST_MAX_INITIAL_LIMIT = 5;
const RELAY_TURNS_LIST_SAFE_RETRY_LIMIT = 5;
const MODELS_WITHOUT_REASONING_SUMMARY = new Set([
  "gpt-5.3-codex-spark",
]);
const RELAY_TURNS_LIST_RESULT_KEYS = ["data", "items", "turns"];
const RELAY_TURNS_LIST_PAGINATION_RESULT_KEYS = [
  "nextCursor",
  "next_cursor",
  "cursor",
  "hasNextCursor",
  "has_next_cursor",
  "hasNextPage",
  "has_next_page",
  "hasMore",
  "has_more",
  "prevCursor",
  "prev_cursor",
  "previousCursor",
  "previous_cursor",
];
function startBridge({
  config: explicitConfig = null,
  printPairingQr = true,
  onPairingSession = null,
  onBridgeStatus = null,
} = {}) {
  const config = explicitConfig || readBridgeConfig();
  config.keepMacAwakeEnabled = config.keepMacAwakeEnabled === true;
  const bridgeWakeAssertion = createMacOSBridgeWakeAssertion({
    enabled: config.keepMacAwakeEnabled,
  });
  const relayBaseUrl = config.relayUrl.replace(/\/+$/, "");
  if (!relayBaseUrl) {
    console.error("[remodex] No relay URL configured.");
    console.error("[remodex] In a source checkout, run ./run-local-remodex.sh or set REMODEX_RELAY.");
    process.exit(1);
  }

  let deviceState;
  try {
    deviceState = loadOrCreateBridgeDeviceState();
  } catch (error) {
    console.error(`[remodex] ${(error && error.message) || "Failed to load the saved bridge pairing state."}`);
    process.exit(1);
  }
  const relaySession = resolveBridgeRelaySession(deviceState);
  deviceState = relaySession.deviceState;
  let lastIOSAppCompatibilityWarning = "";
  const cachedIOSAppCompatibilityWarning = buildCachedIOSAppCompatibilityWarning({
    bridgeVersion: bridgePackageVersion,
    iosAppVersion: deviceState.lastSeenPhoneAppVersion,
  });
  logIOSAppCompatibilityWarning(cachedIOSAppCompatibilityWarning);
  const sessionId = relaySession.sessionId;
  const relaySessionUrl = `${relayBaseUrl}/${sessionId}`;
  const notificationSecret = randomBytes(24).toString("hex");
  const desktopRefresher = new CodexDesktopRefresher({
    enabled: config.refreshEnabled,
    debounceMs: config.refreshDebounceMs,
    refreshCommand: config.refreshCommand,
    bundleId: config.codexBundleId,
    appPath: config.codexAppPath,
  });
  const pushServiceClient = createPushNotificationServiceClient({
    baseUrl: config.pushServiceUrl,
    sessionId,
    notificationSecret,
  });
  const notificationsHandler = createNotificationsHandler({
    pushServiceClient,
  });
  const pushNotificationTracker = createPushNotificationTracker({
    sessionId,
    pushServiceClient,
    previewMaxChars: config.pushPreviewMaxChars,
  });
  const readBridgePackageVersionStatus = createBridgePackageVersionStatusReader();

  // Keep the local Codex runtime alive across transient relay disconnects.
  let socket = null;
  let isShuttingDown = false;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let relayWatchdogTimer = null;
  let lastRelayActivityAt = 0;
  let lastConnectionStatus = null;
  let codexLaunchState = config.codexEndpoint ? "connected" : "starting";
  let codexHandshakeState = config.codexEndpoint ? "warm" : "cold";
  let bridgeManagedInitializePromise = null;
  const forwardedInitializeRequestIds = new Set();
  const bridgeManagedCodexRequestWaiters = new Map();
  const forwardedRequestMethodsById = new Map();
  const relaySanitizedResponseMethodsById = new Map();
  const trackedForwardedRequestMethods = new Set([
    "account/login/start",
    "account/login/cancel",
    "account/logout",
  ]);
  const relaySanitizedRequestMethods = new Set([
    "thread/list",
    "thread/read",
    "thread/resume",
    "thread/turns/list",
  ]);
  const forwardedRequestMethodTTLms = 2 * 60_000;
  const pendingAuthLogin = {
    loginId: null,
    authUrl: null,
    requestId: null,
    startedAt: 0,
  };
  const secureTransport = createBridgeSecureTransport({
    sessionId,
    relayUrl: relayBaseUrl,
    deviceState,
    onTrustedPhoneUpdate(nextDeviceState) {
      deviceState = nextDeviceState;
      sendRelayRegistrationUpdate(nextDeviceState);
    },
  });
  // Keeps one stable sender identity across reconnects so buffered replay state
  // reflects what actually made it onto the current relay socket.
  function sendRelayWireMessage(wireMessage) {
    if (socket?.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(wireMessage);
    return true;
  }
  // Only the spawned local runtime needs rollout mirroring; a real endpoint
  // already provides the authoritative live stream for resumed threads.
  const rolloutLiveMirror = !config.codexEndpoint
    ? createRolloutLiveMirrorController({
      sendApplicationResponse: sendRolloutMirrorApplicationResponse,
    })
    : null;
  let telegramAdapter = null;
  const desktopIpcActionFollower = !config.codexEndpoint
    ? createDesktopIpcActionFollower({
      sendApplicationResponse: sendApplicationResponseWithTelegram,
      socketPath: config.desktopIpcSocketPath || undefined,
    })
    : null;
  let contextUsageWatcher = null;
  let watchedContextUsageKey = null;

  const codex = createCodexTransport({
    endpoint: config.codexEndpoint,
    env: process.env,
    appPath: config.codexAppPath,
    logPrefix: "[remodex]",
  });
  const voiceHandler = createVoiceHandler({
    sendCodexRequest,
    logPrefix: "[remodex]",
  });
  const bridgeStatusPublisher = createBridgeStatusPublisher({
    onBridgeStatus,
    getCodexLaunchState: () => codexLaunchState,
  });
  telegramAdapter = createTelegramAdapterFromBridgeConfig({
    config,
    controlSurface: createTelegramControlSurface(),
    logger: console,
  });
  bridgeStatusPublisher.startHeartbeat({
    shouldPublish: () => !isShuttingDown,
    getLastRelayActivityAt: () => lastRelayActivityAt,
  });
  publishBridgeStatus({
    state: "starting",
    connectionStatus: "starting",
    pid: process.pid,
    lastError: "",
  });

  codex.onError((error) => {
    codexLaunchState = "error";
    publishBridgeStatus({
      state: "error",
      connectionStatus: "error",
      pid: process.pid,
      lastError: error.message,
    });
    if (config.codexEndpoint) {
      console.error(`[remodex] Failed to connect to Codex endpoint: ${config.codexEndpoint}`);
    } else {
      console.error("[remodex] Failed to start `codex app-server`.");
      console.error(`[remodex] Launch command: ${codex.describe()}`);
      console.error("[remodex] Make sure the Codex CLI is installed, authenticated, and launchable on this OS.");
    }
    console.error(error.message);
    process.exit(1);
  });
  // Marks the local Codex runtime as launchable before relay/network recovery updates.
  codex.onStarted(() => {
    codexLaunchState = "connected";
    const lastPublishedBridgeStatus = bridgeStatusPublisher.latest();
    if (!lastPublishedBridgeStatus) {
      return;
    }

    publishBridgeStatus(lastPublishedBridgeStatus);
  });

  function clearReconnectTimer() {
    if (!reconnectTimer) {
      return;
    }

    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Tracks relay liveness locally so sleep/wake zombie sockets can be force-reconnected.
  function markRelayActivity() {
    lastRelayActivityAt = Date.now();
  }

  function clearRelayWatchdog() {
    if (!relayWatchdogTimer) {
      return;
    }

    clearInterval(relayWatchdogTimer);
    relayWatchdogTimer = null;
  }

  function startRelayWatchdog(trackedSocket) {
    clearRelayWatchdog();
    markRelayActivity();

    relayWatchdogTimer = setInterval(() => {
      if (isShuttingDown || socket !== trackedSocket) {
        clearRelayWatchdog();
        return;
      }

      if (trackedSocket.readyState !== WebSocket.OPEN) {
        return;
      }

      if (hasRelayConnectionGoneStale(lastRelayActivityAt)) {
        console.warn("[remodex] relay heartbeat stalled; forcing reconnect");
        logConnectionStatus("disconnected");
        trackedSocket.terminate();
        return;
      }

      try {
        trackedSocket.ping();
      } catch {
        trackedSocket.terminate();
      }
    }, RELAY_WATCHDOG_PING_INTERVAL_MS);
    relayWatchdogTimer.unref?.();
  }

  // Keeps npm start output compact by emitting only high-signal connection states.
  function logConnectionStatus(status) {
    if (lastConnectionStatus === status) {
      return;
    }

    lastConnectionStatus = status;
    publishBridgeStatus({
      state: "running",
      connectionStatus: status,
      pid: process.pid,
      lastError: "",
    });
    console.log(`[remodex] ${status}`);
  }

  // Retries the relay socket while preserving the active Codex process and session id.
  function scheduleRelayReconnect(closeCode) {
    if (isShuttingDown) {
      return;
    }

    if (closeCode === 4000 || closeCode === 4001) {
      logConnectionStatus("disconnected");
      shutdown(codex, () => socket, () => {
        isShuttingDown = true;
        bridgeWakeAssertion.stop();
        clearReconnectTimer();
        clearRelayWatchdog();
        bridgeStatusPublisher.stopHeartbeat();
      });
      return;
    }

    if (reconnectTimer) {
      return;
    }

    reconnectAttempt += 1;
    const delayMs = Math.min(1_000 * reconnectAttempt, 5_000);
    logConnectionStatus("connecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectRelay();
    }, delayMs);
  }

  function connectRelay() {
    if (isShuttingDown) {
      return;
    }

    logConnectionStatus("connecting");
    const nextSocket = new WebSocket(relaySessionUrl, {
      // The relay uses this per-session secret to authenticate the first push registration.
      headers: {
        "x-role": "mac",
        "x-notification-secret": notificationSecret,
        ...buildMacRegistrationHeaders(deviceState, pairingSession),
      },
    });
    socket = nextSocket;

    nextSocket.on("open", () => {
      markRelayActivity();
      clearReconnectTimer();
      reconnectAttempt = 0;
      startRelayWatchdog(nextSocket);
      logConnectionStatus("connected");
      secureTransport.bindLiveSendWireMessage(sendRelayWireMessage);
      sendRelayRegistrationUpdate(deviceState);
    });

    nextSocket.on("message", (data) => {
      markRelayActivity();
      const message = typeof data === "string" ? data : data.toString("utf8");
      if (secureTransport.handleIncomingWireMessage(message, {
        sendControlMessage(controlMessage) {
          if (nextSocket.readyState === WebSocket.OPEN) {
            nextSocket.send(JSON.stringify(controlMessage));
          }
        },
        onApplicationMessage(plaintextMessage) {
          handleApplicationMessage(plaintextMessage);
        },
      })) {
        return;
      }
    });

    nextSocket.on("ping", () => {
      markRelayActivity();
    });

    nextSocket.on("pong", () => {
      markRelayActivity();
    });

    nextSocket.on("close", (code) => {
      if (socket === nextSocket) {
        clearRelayWatchdog();
      }
      logConnectionStatus("disconnected");
      if (socket === nextSocket) {
        socket = null;
      }
      stopContextUsageWatcher();
      rolloutLiveMirror?.stopAll();
      desktopIpcActionFollower?.stopAll();
      desktopRefresher.handleTransportReset();
      scheduleRelayReconnect(code);
    });

    nextSocket.on("error", () => {
      if (socket === nextSocket) {
        clearRelayWatchdog();
      }
      logConnectionStatus("disconnected");
    });
  }

  const pairingPayload = secureTransport.createPairingPayload();
  const pairingSession = {
    pairingPayload,
    pairingCode: createShortPairingCode({ length: SHORT_PAIRING_CODE_LENGTH }),
  };
  onPairingSession?.(pairingSession);
  if (printPairingQr) {
    printQR(pairingSession);
  }
  pushServiceClient.logUnavailable();
  connectRelay();

  codex.onMessage((message) => {
    if (handleBridgeManagedCodexResponse(message)) {
      return;
    }
    notifyTelegramServerRequest(message);
    updatePendingAuthLoginFromCodexMessage(message);
    trackCodexHandshakeState(message);
    desktopRefresher.handleOutbound(message);
    pushNotificationTracker.handleOutbound(message);
    rememberThreadFromMessage("codex", message);
    secureTransport.queueOutboundApplicationMessage(
      sanitizeRelayBoundCodexMessage(message),
      sendRelayWireMessage
    );
  });

  function sendApplicationResponseWithTelegram(rawMessage) {
    notifyTelegramServerRequest(rawMessage);
    sendApplicationResponse(rawMessage);
  }

  function sendRolloutMirrorApplicationResponse(rawMessage) {
    notifyTelegramServerRequest(rawMessage, { rolloutMirror: true });
    sendApplicationResponse(rawMessage);
  }

  function notifyTelegramServerRequest(rawMessage, { rolloutMirror = false } = {}) {
    if (rolloutMirror && isTelegramRedundantRolloutLifecycle(rawMessage)) {
      return;
    }
    const notification = telegramAdapter?.sendServerRequest?.(rawMessage);
    if (!notification || typeof notification.catch !== "function") {
      return;
    }
    notification.catch((error) => {
      console.warn(`[remodex] Telegram request notification failed: ${error.message}`);
    });
  }

  function isTelegramRedundantRolloutLifecycle(rawMessage) {
    const message = safeParseJSON(rawMessage);
    const method = normalizeNonEmptyString(message?.method);
    return method === "turn/started" || method === "turn/completed";
  }

  codex.onClose(() => {
    const wasShuttingDown = isShuttingDown;
    clearRelayWatchdog();
    bridgeStatusPublisher.stopHeartbeat();
    logConnectionStatus("disconnected");
    const lastError = wasShuttingDown
      ? ""
      : "Codex transport closed unexpectedly.";
    publishBridgeStatus({
      state: wasShuttingDown ? "stopped" : "error",
      connectionStatus: "disconnected",
      pid: process.pid,
      lastError,
    });
    if (!wasShuttingDown) {
      console.error(`[remodex] ${lastError}`);
      process.exitCode = 1;
    }
    isShuttingDown = true;
    bridgeWakeAssertion.stop();
    clearReconnectTimer();
    stopContextUsageWatcher();
    rolloutLiveMirror?.stopAll();
    desktopIpcActionFollower?.stopAll();
    telegramAdapter?.stop?.();
    desktopRefresher.handleTransportReset();
    failBridgeManagedCodexRequests(new Error("Codex transport closed before the bridge request completed."));
    forwardedRequestMethodsById.clear();
    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  });

  telegramAdapter?.start();

  process.on("SIGINT", () => shutdown(codex, () => socket, () => {
    isShuttingDown = true;
    bridgeWakeAssertion.stop();
    clearReconnectTimer();
    clearRelayWatchdog();
    bridgeStatusPublisher.stopHeartbeat();
    telegramAdapter?.stop?.();
  }));
  process.on("SIGTERM", () => shutdown(codex, () => socket, () => {
    isShuttingDown = true;
    bridgeWakeAssertion.stop();
    clearReconnectTimer();
    clearRelayWatchdog();
    bridgeStatusPublisher.stopHeartbeat();
    telegramAdapter?.stop?.();
  }));

  // Routes decrypted app payloads through the same bridge handlers as before.
  function handleApplicationMessage(rawMessage) {
    if (handleBridgeManagedHandshakeMessage(rawMessage, sendApplicationResponse)) {
      return;
    }
    if (handleBridgeManagedAccountRequest(rawMessage, sendApplicationResponse)) {
      return;
    }
    if (voiceHandler.handleVoiceRequest(rawMessage, sendApplicationResponse)) {
      return;
    }
    if (handleThreadContextRequest(rawMessage, sendApplicationResponse)) {
      return;
    }
    if (handleWorkspaceRequest(rawMessage, sendApplicationResponse)) {
      return;
    }
    if (handleProjectRequest(rawMessage, sendApplicationResponse)) {
      return;
    }
    if (handlePetRequest(rawMessage, sendApplicationResponse)) {
      return;
    }
    if (notificationsHandler.handleNotificationsRequest(rawMessage, sendApplicationResponse)) {
      return;
    }
    if (handleDesktopRequest(rawMessage, sendApplicationResponse, {
      bundleId: config.codexBundleId,
      appPath: config.codexAppPath,
      readBridgePreferences,
      updateBridgePreferences,
    })) {
      return;
    }
    if (handleGitRequest(rawMessage, sendApplicationResponse, {
      codexAppPath: config.codexAppPath,
      onThreadNameSet: sendThreadNameUpdatedNotification,
    })) {
      return;
    }
    desktopRefresher.handleInbound(rawMessage);
    rolloutLiveMirror?.observeInbound(rawMessage);
    if (desktopIpcActionFollower?.observeInbound(rawMessage)) {
      return;
    }
    if (handleBridgeManagedThreadTurnsListRequest(rawMessage, sendApplicationResponse)) {
      return;
    }
    const codexRequest = disableUnsupportedReasoningSummaryForTurnStart(rawMessage);
    rememberForwardedRequestMethod(rawMessage);
    rememberThreadFromMessage("phone", codexRequest);
    codex.send(codexRequest);
  }

  // Encrypts bridge-generated responses instead of letting the relay see plaintext.
  function sendApplicationResponse(rawMessage) {
    secureTransport.queueOutboundApplicationMessage(
      sanitizeRelayBoundCodexMessage(rawMessage),
      sendRelayWireMessage
    );
  }

  // Mirrors accepted local renames back to the phone using the existing push-event shape.
  function sendThreadNameUpdatedNotification(result) {
    const threadId = readString(result?.threadId || result?.thread_id);
    const name = readString(result?.name || result?.title);
    if (!threadId || !name) {
      return;
    }

    sendApplicationResponse(JSON.stringify({
      method: "thread/name/updated",
      params: {
        threadId,
        thread_id: threadId,
        name,
        title: name,
      },
    }));
  }

  function handleBridgeManagedThreadTurnsListRequest(rawMessage, sendResponse = sendApplicationResponse) {
    const request = parseAdaptiveThreadTurnsListRequest(rawMessage);
    if (!request) {
      return false;
    }

    rememberThreadFromMessage("phone", rawMessage);
    (async () => {
      try {
        const response = await fetchAdaptiveThreadTurnsListForRelay(request, {
          fetchPage: (params) => sendCodexRequest("thread/turns/list", params),
        });
        const fallbackResponse = maybeBuildJsonlThreadTurnsListFallback(request, response);
        relaySanitizedResponseMethodsById.set(String(request.id), {
          method: "thread/turns/list",
          createdAt: Date.now(),
        });
        sendResponse(JSON.stringify(fallbackResponse ?? response));
      } catch (error) {
        sendResponse(createJsonRpcErrorResponse(
          request.id,
          error,
          "thread_turns_list_failed"
        ));
      }
    })();

    return true;
  }

  function maybeBuildJsonlThreadTurnsListFallback(request, response) {
    if (!isEmptyTurnsListResponse(response)) {
      return null;
    }

    const params = request?.params || {};
    const threadId = normalizeNonEmptyString(params.threadId)
      || normalizeNonEmptyString(params.thread_id);
    if (!threadId || hasRelayCursor(params.cursor)) {
      return null;
    }

    try {
      const rolloutPath = findRecentRolloutFileForContextRead(resolveSessionsRoot(), { threadId });
      if (!rolloutPath) {
        return null;
      }
      const result = readThreadTurnsListPageFromSessionJsonl(rolloutPath, {
        threadId,
        limit: params.limit,
        maxLimit: 1,
        cursor: params.cursor,
      });
      const turnsKey = findTurnsListResultKey(result);
      if (!turnsKey || result[turnsKey].length === 0) {
        return null;
      }

      return {
        id: request.id,
        result,
      };
    } catch (error) {
      console.warn(`[remodex] thread/turns/list jsonl fallback failed: ${error.message}`);
      return null;
    }
  }

  // ─── Bridge-owned auth snapshot ─────────────────────────────

  // Handles the bridge-owned auth status wrappers without exposing tokens to the phone.
  // This dispatcher stays synchronous so non-account messages can continue down the normal routing chain.
  function handleBridgeManagedAccountRequest(rawMessage, sendResponse) {
    let parsed = null;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      return false;
    }

    const method = typeof parsed?.method === "string" ? parsed.method.trim() : "";
    if (method !== "account/status/read"
      && method !== "getAuthStatus"
      && method !== "account/login/openOnMac"
      && method !== "voice/resolveAuth") {
      return false;
    }

    const requestId = parsed.id;
    const shouldRespond = requestId != null;
    readBridgeManagedAccountResult(method, parsed.params || {})
      .then((result) => {
        if (shouldRespond) {
          sendResponse(JSON.stringify({ id: requestId, result }));
        }
      })
      .catch((error) => {
        if (shouldRespond) {
          sendResponse(createJsonRpcErrorResponse(requestId, error, "auth_status_failed"));
        }
      });

    return true;
  }

  // Resolves bridge-owned account helpers like status reads and Mac-side browser opening.
  async function readBridgeManagedAccountResult(method, params) {
    switch (method) {
      case "account/status/read":
      case "getAuthStatus":
        return readSanitizedAuthStatus();
      case "account/login/openOnMac":
        return openPendingAuthLoginOnMac(params);
      case "voice/resolveAuth":
        return resolveVoiceAuth(sendCodexRequest);
      default:
        throw new Error(`Unsupported bridge-managed account method: ${method}`);
    }
  }

  // Combines account/read + getAuthStatus into one safe snapshot for the phone UI.
  // The two RPCs are settled independently so one transient failure does not hide the other.
  async function readSanitizedAuthStatus() {
    const [accountReadResult, authStatusResult, bridgeVersionInfoResult] = await Promise.allSettled([
      sendCodexRequest("account/read", {
        refreshToken: false,
      }),
      sendCodexRequest("getAuthStatus", {
        includeToken: true,
        refreshToken: true,
      }),
      readBridgePackageVersionStatus(),
    ]);

    return composeSanitizedAuthStatusFromSettledResults({
      accountReadResult: accountReadResult.status === "fulfilled"
        ? {
          status: "fulfilled",
          value: normalizeAccountRead(accountReadResult.value),
        }
        : accountReadResult,
      authStatusResult,
      loginInFlight: Boolean(pendingAuthLogin.loginId),
      bridgeVersionInfo: bridgeVersionInfoResult.status === "fulfilled"
        ? bridgeVersionInfoResult.value
        : null,
      transportMode: codex.mode,
      hostPlatform: process.platform,
    });
  }

  // Opens the ChatGPT sign-in URL in the default browser on the bridge Mac.
  async function openPendingAuthLoginOnMac(params) {
    if (process.platform !== "darwin") {
      const error = new Error("Opening ChatGPT sign-in on the bridge is only supported on macOS.");
      error.errorCode = "unsupported_platform";
      throw error;
    }

    const authUrl = readString(params?.authUrl) || pendingAuthLogin.authUrl;
    if (!authUrl) {
      const error = new Error("No pending ChatGPT sign-in URL is available on this bridge.");
      error.errorCode = "missing_auth_url";
      throw error;
    }

    await execFileAsync("open", [authUrl], { timeout: 15_000 });
    return {
      success: true,
      openedOnMac: true,
    };
  }

  async function cancelPendingAuthLoginOnMac() {
    const loginId = readString(pendingAuthLogin.loginId);
    if (!loginId) {
      return {
        success: false,
        cancelled: false,
        reason: "no_pending_login",
      };
    }

    await sendCodexRequest("account/login/cancel", { loginId });
    clearPendingAuthLogin();
    return {
      success: true,
      cancelled: true,
    };
  }

  async function logoutAccountOnMac() {
    await sendCodexRequest("account/logout", {});
    clearPendingAuthLogin();
    return {
      success: true,
      signedOut: true,
    };
  }

  async function openFeedbackEmailOnMac({ message = "", threadId = "" } = {}) {
    if (process.platform !== "darwin") {
      const error = new Error("Opening Remodex feedback on the bridge is only supported on macOS.");
      error.errorCode = "unsupported_platform";
      throw error;
    }

    const mailtoUrl = buildTelegramFeedbackMailtoUrl({
      message,
      threadId,
      bridgeStatus: bridgeStatusPublisher.latest(),
      bridgeVersion: bridgePackageVersion,
    });
    await execFileAsync("open", [mailtoUrl], { timeout: 15_000 });
    return {
      success: true,
      openedOnMac: true,
      mailtoUrl,
    };
  }

  function normalizeAccountRead(payload) {
    if (!payload || typeof payload !== "object") {
      return {
        account: null,
        requiresOpenaiAuth: true,
      };
    }

    return {
      account: payload.account && typeof payload.account === "object" ? payload.account : null,
      requiresOpenaiAuth: Boolean(payload.requiresOpenaiAuth),
    };
  }

  function createJsonRpcErrorResponse(requestId, error, defaultErrorCode) {
    return JSON.stringify({
      id: requestId,
      error: {
        code: -32000,
        message: error?.userMessage || error?.message || "Bridge request failed.",
        data: {
          errorCode: error?.errorCode || defaultErrorCode,
        },
      },
    });
  }

  function rememberForwardedRequestMethod(rawMessage) {
    const parsed = safeParseJSON(rawMessage);
    const method = typeof parsed?.method === "string" ? parsed.method.trim() : "";
    const requestId = parsed?.id;
    if (!method || requestId == null) {
      return;
    }

    pruneExpiredForwardedRequestMethods();
    if (trackedForwardedRequestMethods.has(method)) {
      forwardedRequestMethodsById.set(String(requestId), {
        method,
        createdAt: Date.now(),
      });
    }
    if (relaySanitizedRequestMethods.has(method)) {
      relaySanitizedResponseMethodsById.set(String(requestId), {
        method,
        createdAt: Date.now(),
      });
    }
  }

  // Replaces huge inline desktop-history images with lightweight references before relay encryption.
  function sanitizeRelayBoundCodexMessage(rawMessage) {
    pruneExpiredForwardedRequestMethods();
    const normalizedMessage = normalizeRelayBoundJsonRpcMessage(rawMessage, {
      pendingRequestMethodsById: relaySanitizedResponseMethodsById,
    });
    if (!normalizedMessage) {
      return null;
    }

    const parsed = safeParseJSON(normalizedMessage);
    const responseId = parsed?.id;
    if (responseId == null) {
      return sanitizeLiveGeneratedImageMessageForRelay(normalizedMessage);
    }

    const trackedRequest = relaySanitizedResponseMethodsById.get(String(responseId));
    if (!trackedRequest) {
      return normalizedMessage;
    }
    relaySanitizedResponseMethodsById.delete(String(responseId));

    return sanitizeThreadHistoryImagesForRelay(normalizedMessage, trackedRequest.method);
  }

  function updatePendingAuthLoginFromCodexMessage(rawMessage) {
    pruneExpiredForwardedRequestMethods();
    const parsed = safeParseJSON(rawMessage);
    const responseId = parsed?.id;
    if (responseId != null) {
      const trackedRequest = forwardedRequestMethodsById.get(String(responseId));
      if (trackedRequest) {
        forwardedRequestMethodsById.delete(String(responseId));
        const requestMethod = trackedRequest.method;

        if (requestMethod === "account/login/start") {
          const loginId = readString(parsed?.result?.loginId);
          const authUrl = readString(parsed?.result?.authUrl);
          if (!loginId || !authUrl) {
            clearPendingAuthLogin();
            return;
          }
          pendingAuthLogin.loginId = loginId || null;
          pendingAuthLogin.authUrl = authUrl || null;
          pendingAuthLogin.requestId = String(responseId);
          pendingAuthLogin.startedAt = Date.now();
          return;
        }

        if (requestMethod === "account/login/cancel" || requestMethod === "account/logout") {
          clearPendingAuthLogin();
          return;
        }
      }
    }

    const method = typeof parsed?.method === "string" ? parsed.method.trim() : "";
    if (method === "account/login/completed") {
      clearPendingAuthLogin();
      return;
    }

    if (method === "account/updated") {
      clearPendingAuthLogin();
    }
  }

  function clearPendingAuthLogin() {
    pendingAuthLogin.loginId = null;
    pendingAuthLogin.authUrl = null;
    pendingAuthLogin.requestId = null;
    pendingAuthLogin.startedAt = 0;
  }

  function pruneExpiredForwardedRequestMethods(now = Date.now()) {
    for (const [requestId, trackedRequest] of forwardedRequestMethodsById.entries()) {
      if (!trackedRequest || (now - trackedRequest.createdAt) >= forwardedRequestMethodTTLms) {
        forwardedRequestMethodsById.delete(requestId);
      }
    }
    for (const [requestId, trackedRequest] of relaySanitizedResponseMethodsById.entries()) {
      if (!trackedRequest || (now - trackedRequest.createdAt) >= forwardedRequestMethodTTLms) {
        relaySanitizedResponseMethodsById.delete(requestId);
      }
    }
  }

  function safeParseJSON(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function rememberThreadFromMessage(source, rawMessage) {
    const context = extractBridgeMessageContext(rawMessage);
    if (!context.threadId) {
      return;
    }

    rememberActiveThread(context.threadId, source);
    if (shouldStartContextUsageWatcher(context)) {
      ensureContextUsageWatcher(context);
    }
  }

  // Mirrors CodexMonitor's persisted token_count fallback so the phone keeps
  // receiving context-window usage even when the runtime omits live thread usage.
  function ensureContextUsageWatcher({ threadId, turnId }) {
    const normalizedThreadId = readString(threadId);
    const normalizedTurnId = readString(turnId);
    if (!normalizedThreadId) {
      return;
    }

    const nextWatcherKey = `${normalizedThreadId}|${normalizedTurnId || "pending-turn"}`;
    if (watchedContextUsageKey === nextWatcherKey && contextUsageWatcher) {
      return;
    }

    stopContextUsageWatcher();
    watchedContextUsageKey = nextWatcherKey;
    contextUsageWatcher = createThreadRolloutActivityWatcher({
      threadId: normalizedThreadId,
      turnId: normalizedTurnId,
      onUsage: ({ threadId: usageThreadId, usage }) => {
        sendContextUsageNotification(usageThreadId, usage);
      },
      onIdle: () => {
        if (watchedContextUsageKey === nextWatcherKey) {
          stopContextUsageWatcher();
        }
      },
      onTimeout: () => {
        if (watchedContextUsageKey === nextWatcherKey) {
          stopContextUsageWatcher();
        }
      },
      onError: () => {
        if (watchedContextUsageKey === nextWatcherKey) {
          stopContextUsageWatcher();
        }
      },
    });
  }

  function stopContextUsageWatcher() {
    if (contextUsageWatcher) {
      contextUsageWatcher.stop();
    }

    contextUsageWatcher = null;
    watchedContextUsageKey = null;
  }

  function sendContextUsageNotification(threadId, usage) {
    if (!threadId || !usage) {
      return;
    }

    sendApplicationResponse(JSON.stringify({
      method: "thread/tokenUsage/updated",
      params: {
        threadId,
        usage,
      },
    }));
  }

  // The spawned/shared Codex app-server stays warm across phone reconnects.
  // When iPhone reconnects it sends initialize again, but forwarding that to the
  // already-initialized Codex transport only produces "Already initialized".
  function handleBridgeManagedHandshakeMessage(rawMessage, sendResponse = sendApplicationResponse) {
    let parsed = null;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      return false;
    }

    const method = typeof parsed?.method === "string" ? parsed.method.trim() : "";
    if (!method) {
      return false;
    }

    if (method === "initialize" && parsed.id != null) {
      const compatibilityError = bridgeManagedInitializeCompatibilityError(parsed.params || {});
      if (compatibilityError) {
        sendResponse(JSON.stringify({
          id: parsed.id,
          error: compatibilityError,
        }));
        return true;
      }

      if (codexHandshakeState !== "warm") {
        forwardedInitializeRequestIds.add(String(parsed.id));
        return false;
      }

      sendResponse(JSON.stringify({
        id: parsed.id,
        result: {
          bridgeManaged: true,
        },
      }));
      return true;
    }

    if (method === "initialized") {
      return codexHandshakeState === "warm";
    }

    return false;
  }

  // Blocks bridge/app version skew before the phone starts calling newer bridge APIs.
  function bridgeManagedInitializeCompatibilityError(params) {
    const clientInfo = params && typeof params === "object" ? params.clientInfo : null;
    const clientName = normalizeNonEmptyString(clientInfo?.name);
    if (clientName !== "codexmobile_ios") {
      return null;
    }

    const clientVersion = normalizeVersionString(clientInfo?.version);
    if (clientVersion) {
      deviceState = rememberLastSeenPhoneAppVersion(deviceState, clientVersion);
    }

    const compatibility = buildIOSAppCompatibilitySnapshot({
      bridgeVersion: bridgePackageVersion,
      iosAppVersion: clientVersion,
    });
    if (!compatibility.requiresAppUpdate) {
      return null;
    }

    logIOSAppCompatibilityWarning(buildCachedIOSAppCompatibilityWarning({
      bridgeVersion: bridgePackageVersion,
      iosAppVersion: clientVersion,
    }));

    return {
      code: -32001,
      message: compatibility.message,
      data: {
        errorCode: "ios_app_update_required",
        minimumSupportedAppVersion: MINIMUM_SUPPORTED_IOS_APP_VERSION,
        bridgeVersion: normalizeVersionString(bridgePackageVersion) || null,
        clientVersion,
        compatibleBridgeVersion: compatibility.legacyBridgeVersion,
        downgradeCommand: compatibility.downgradeCommand,
      },
    };
  }

  function logIOSAppCompatibilityWarning(warning) {
    const normalizedWarning = typeof warning === "string" ? warning.trim() : "";
    if (!normalizedWarning || normalizedWarning === lastIOSAppCompatibilityWarning) {
      return;
    }

    lastIOSAppCompatibilityWarning = normalizedWarning;
    console.warn(normalizedWarning);
  }

  // Learns whether the underlying Codex transport has already completed its own MCP handshake.
  function trackCodexHandshakeState(rawMessage) {
    let parsed = null;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      return;
    }

    const responseId = parsed?.id;
    if (responseId == null) {
      return;
    }

    const responseKey = String(responseId);
    if (!forwardedInitializeRequestIds.has(responseKey)) {
      return;
    }

    forwardedInitializeRequestIds.delete(responseKey);

    if (parsed?.result != null) {
      codexHandshakeState = "warm";
      return;
    }

    const errorMessage = typeof parsed?.error?.message === "string"
      ? parsed.error.message.toLowerCase()
      : "";
    if (errorMessage.includes("already initialized")) {
      codexHandshakeState = "warm";
    }
  }

  // Runs bridge-private JSON-RPC calls against the local app-server so token-bearing responses
  // can power bridge features like transcription without ever reaching the phone.
  async function ensureBridgeManagedCodexInitialized() {
    if (codexHandshakeState === "warm") {
      return;
    }
    if (bridgeManagedInitializePromise) {
      await bridgeManagedInitializePromise;
      return;
    }

    bridgeManagedInitializePromise = (async () => {
      try {
        await sendCodexRequest("initialize", buildBridgeManagedInitializeParams(true), { skipInitialize: true });
      } catch (error) {
        if (isAlreadyInitializedCodexError(error)) {
          codexHandshakeState = "warm";
          return;
        }
        if (!shouldRetryBridgeManagedInitializeWithoutCapabilities(error)) {
          throw error;
        }
        await sendCodexRequest("initialize", buildBridgeManagedInitializeParams(false), { skipInitialize: true });
      }
      codexHandshakeState = "warm";
      codex.send(JSON.stringify({ method: "initialized" }));
    })();

    try {
      await bridgeManagedInitializePromise;
    } finally {
      bridgeManagedInitializePromise = null;
    }
  }

  function buildBridgeManagedInitializeParams(includeExperimentalApi) {
    const params = {
      clientInfo: {
        name: "remodex_telegram",
        title: "Remodex Telegram",
        version: bridgePackageVersion,
      },
    };
    if (includeExperimentalApi) {
      params.capabilities = { experimentalApi: true };
    }
    return params;
  }

  function shouldRetryBridgeManagedInitializeWithoutCapabilities(error) {
    const message = normalizeErrorMessage(error);
    return message.includes("capabilities")
      || message.includes("experimentalapi")
      || message.includes("invalid params")
      || message.includes("invalid request");
  }

  function isAlreadyInitializedCodexError(error) {
    return normalizeErrorMessage(error).includes("already initialized");
  }

  function normalizeErrorMessage(error) {
    return typeof error?.message === "string" ? error.message.toLowerCase() : "";
  }

  async function sendCodexRequest(method, params, options = {}) {
    if (!options.skipInitialize && method !== "initialize") {
      await ensureBridgeManagedCodexInitialized();
    }

    const requestId = `bridge-managed-${randomBytes(12).toString("hex")}`;
    const payload = JSON.stringify({
      id: requestId,
      method,
      params,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        bridgeManagedCodexRequestWaiters.delete(requestId);
        reject(new Error(`Codex request timed out: ${method}`));
      }, 20_000);

      bridgeManagedCodexRequestWaiters.set(requestId, {
        method,
        resolve,
        reject,
        timeout,
      });

      try {
        codex.send(payload);
      } catch (error) {
        clearTimeout(timeout);
        bridgeManagedCodexRequestWaiters.delete(requestId);
        reject(error);
      }
    });
  }

  // Intercepts responses for bridge-private requests so only user-visible app-server traffic
  // is forwarded back through secure transport.
  function handleBridgeManagedCodexResponse(rawMessage) {
    let parsed = null;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      return false;
    }

    const responseId = typeof parsed?.id === "string" ? parsed.id : null;
    if (!responseId) {
      return false;
    }

    const waiter = bridgeManagedCodexRequestWaiters.get(responseId);
    if (!waiter) {
      return false;
    }

    bridgeManagedCodexRequestWaiters.delete(responseId);
    clearTimeout(waiter.timeout);

    if (parsed.error) {
      const error = new Error(parsed.error.message || `Codex request failed: ${waiter.method}`);
      error.code = parsed.error.code;
      error.data = parsed.error.data;
      waiter.reject(error);
      return true;
    }

    waiter.resolve(readBridgeManagedSuccessPayload(parsed));
    return true;
  }

  // Normalizes private app-server responses before the bridge re-wraps them for iOS.
  function readBridgeManagedSuccessPayload(parsed) {
    if (Object.prototype.hasOwnProperty.call(parsed, "result")) {
      return parsed.result ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(parsed, "payload")) {
      return parsed.payload ?? null;
    }
    return null;
  }

  function failBridgeManagedCodexRequests(error) {
    bridgeManagedInitializePromise = null;
    for (const waiter of bridgeManagedCodexRequestWaiters.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    bridgeManagedCodexRequestWaiters.clear();
  }

  function publishBridgeStatus(status) {
    bridgeStatusPublisher.publish(status);
  }

  // Refreshes the relay's trusted-mac index after the QR bootstrap locks in a phone identity.
  function sendRelayRegistrationUpdate(nextDeviceState) {
    deviceState = nextDeviceState;
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({
      kind: "relayMacRegistration",
      registration: buildMacRegistration(nextDeviceState, pairingSession),
    }));
  }

  function readBridgePreferences() {
    return {
      success: true,
      preferences: {
        keepMacAwake: config.keepMacAwakeEnabled !== false,
      },
      applied: bridgeWakeAssertion.active,
    };
  }

  function updateBridgePreferences(preferences = {}) {
    const nextKeepMacAwakeEnabled = preferences.keepMacAwake !== false;
    config.keepMacAwakeEnabled = nextKeepMacAwakeEnabled;
    bridgeWakeAssertion.setEnabled?.(nextKeepMacAwakeEnabled);

    try {
      persistBridgePreferences({
        keepMacAwakeEnabled: nextKeepMacAwakeEnabled,
      });
    } catch (error) {
      const nextError = new Error("Could not save the bridge preference on this Mac.");
      nextError.errorCode = "bridge_preferences_persist_failed";
      nextError.userMessage = nextError.message;
      nextError.cause = error;
      throw nextError;
    }

    return readBridgePreferences();
  }

  function createTelegramControlSurface() {
    return {
      readStatus: async () => ({
        bridgeStatus: {
          ...bridgeStatusPublisher.latest(),
          bridgeVersion: normalizeVersionString(bridgePackageVersion) || bridgePackageVersion,
        },
      }),
      readAccountStatus: async () => readSanitizedAuthStatus(),
      readRateLimits: async () => readTelegramRateLimits(),
      readUsageStatus: async ({ threadId } = {}) => readTelegramUsageStatus({ threadId }),
      readVersionStatus: async () => readBridgePackageVersionStatus(),
      openLoginOnMac: async () => openPendingAuthLoginOnMac({}),
      cancelLoginOnMac: async () => cancelPendingAuthLoginOnMac(),
      logoutOnMac: async () => logoutAccountOnMac(),
      openFeedbackOnMac: async ({ message, threadId } = {}) => openFeedbackEmailOnMac({ message, threadId }),
      readLastActiveThread: async () => readLastActiveThread(),
      readContextWindow: async ({ threadId } = {}) => readTelegramContextWindow(threadId),
      readThreadActivity: async ({ threadId, limit } = {}) => readTelegramThreadActivity(threadId, limit),
      captureWorkspaceCheckpoint: async ({ threadId, cwd } = {}) => captureTelegramWorkspaceCheckpoint({ threadId, cwd }),
      previewWorkspaceCheckpointRestore: async ({ threadId, cwd, checkpointRef } = {}) => previewTelegramWorkspaceCheckpointRestore({ threadId, cwd, checkpointRef }),
      applyWorkspaceCheckpointRestore: async ({
        threadId,
        cwd,
        checkpointRef,
        expectedTargetCommit,
      } = {}) => applyTelegramWorkspaceCheckpointRestore({
        threadId,
        cwd,
        checkpointRef,
        expectedTargetCommit,
      }),
      compactThread: async ({ threadId } = {}) => compactTelegramThread(threadId),
      listSkills: async ({ threadId, cwd, query } = {}) => listTelegramSkills({ threadId, cwd, query }),
      listPlugins: async ({ threadId, cwd, query } = {}) => listTelegramPlugins({ threadId, cwd, query }),
      readPreferences: async () => readBridgePreferences(),
      updatePreferences: async (preferences = {}) => updateBridgePreferences(preferences),
      readPets: async () => handlePetMethod("pet/list", { metadataOnly: true }),
      listThreads: async ({ query } = {}) => listTelegramThreads({ query }),
      listArchivedThreads: async ({ query } = {}) => listTelegramThreads({ query, archived: true }),
      archiveThread: async ({ threadId } = {}) => archiveTelegramThread(threadId),
      unarchiveThread: async ({ threadId } = {}) => unarchiveTelegramThread(threadId),
      renameThread: async ({ threadId, title } = {}) => renameTelegramThread({ threadId, title }),
      generateThreadTitle: async ({
        threadId,
        cwd,
        message,
        runtimePreferences,
      } = {}) => generateTelegramThreadTitle({ threadId, cwd, message, runtimePreferences }),
      readGitStatus: async ({ threadId, cwd } = {}) => gitStatus(await resolveTelegramThreadCwd(threadId, cwd)),
      initGit: async ({ threadId, cwd } = {}) => gitInit(await resolveTelegramThreadCwd(threadId, cwd)),
      readGitDiffSummary: async ({ threadId, cwd } = {}) => summarizeTelegramDiff(await gitDiff(await resolveTelegramThreadCwd(threadId, cwd))),
      readGitLog: async ({ threadId, cwd } = {}) => gitLog(await resolveTelegramThreadCwd(threadId, cwd)),
      readGitRemote: async ({ threadId, cwd } = {}) => gitRemoteUrl(await resolveTelegramThreadCwd(threadId, cwd)),
      readGitBranches: async ({ threadId, cwd } = {}) => gitBranchesWithStatus(await resolveTelegramThreadCwd(threadId, cwd)),
      generateCommitDraft: async ({
        threadId,
        cwd,
        runtimePreferences,
      } = {}) => generateTelegramCommitDraft({ threadId, cwd, runtimePreferences }),
      generatePullRequestDraft: async ({
        threadId,
        cwd,
        runtimePreferences,
      } = {}) => generateTelegramPullRequestDraft({ threadId, cwd, runtimePreferences }),
      startReview: async ({
        threadId,
        runtimePreferences,
        target,
        baseBranch,
      } = {}) => startTelegramReview({ threadId, runtimePreferences, target, baseBranch }),
      listProjects: async ({ query } = {}) => listTelegramProjects(query),
      listProjectDirectory: async ({ path } = {}) => listTelegramProjectDirectory(path),
      createProjectDirectory: async ({ parentPath, name } = {}) => createTelegramProjectDirectory({ parentPath, name }),
      createBranch: async ({ threadId, cwd, name } = {}) => gitCreateBranch(await resolveTelegramThreadCwd(threadId, cwd), { name }),
      createWorktreeThread: async ({
        threadId,
        cwd,
        branch,
        runtimePreferences,
      } = {}) => createTelegramWorktreeThread({ threadId, cwd, branch, runtimePreferences }),
      checkoutBranch: async ({ threadId, cwd, branch } = {}) => gitCheckout(await resolveTelegramThreadCwd(threadId, cwd), { branch }),
      pullGit: async ({ threadId, cwd } = {}) => gitPull(await resolveTelegramThreadCwd(threadId, cwd)),
      resetGitToRemote: async ({ threadId, cwd } = {}) => gitResetToRemote(await resolveTelegramThreadCwd(threadId, cwd), { confirm: "discard_runtime_changes" }),
      stashGit: async ({ threadId, cwd } = {}) => gitStash(await resolveTelegramThreadCwd(threadId, cwd)),
      popGitStash: async ({ threadId, cwd } = {}) => gitStashPop(await resolveTelegramThreadCwd(threadId, cwd)),
      openThreadOnMac: async ({ threadId } = {}) => openTelegramThreadOnMac(threadId),
      wakeMac: async () => handleDesktopMethod("desktop/wakeDisplay", {}),
      runGitAction: async ({ threadId, cwd, action, message } = {}) => gitRunStackedAction(await resolveTelegramThreadCwd(threadId, cwd), {
        action,
        message,
        commitMessage: message,
      }),
      createThread: async ({
        sourceThreadId,
        sourceCwd,
        cwd,
        runtimePreferences,
      } = {}) => createTelegramThread({ sourceThreadId, sourceCwd, cwd, runtimePreferences }),
      forkThread: async ({
        threadId,
        cwd,
        runtimePreferences,
      } = {}) => forkTelegramThread({ threadId, cwd, runtimePreferences }),
      stopThread: async (threadId) => stopTelegramThread(threadId),
      continueThread: async ({
        threadId,
        text,
        attachments,
        runtimePreferences,
        collaborationMode,
      } = {}) => continueTelegramThread({ threadId, text, attachments, runtimePreferences, collaborationMode }),
      transcribeVoice: async ({ audioData, mimeType, durationMs } = {}) => transcribeTelegramVoice({ audioData, mimeType, durationMs }),
      resolveApproval: async (payload, decision) => resolveTelegramApproval(payload, decision),
      resolveUserInput: async (payload) => resolveTelegramUserInput(payload),
    };
  }

  async function archiveTelegramThread(threadId) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("Select an active Telegram thread before archiving.");
    }
    await sendCodexRequest("thread/archive", { threadId: normalizedThreadId });
    return { threadId: normalizedThreadId };
  }

  async function unarchiveTelegramThread(threadId) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("Choose an archived Telegram thread before restoring.");
    }
    await sendCodexRequest("thread/unarchive", { threadId: normalizedThreadId });
    return { threadId: normalizedThreadId };
  }

  async function readTelegramContextWindow(threadId) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("Select an active Telegram thread before running this command.");
    }
    const result = readLatestContextWindowUsage({ threadId: normalizedThreadId });
    return {
      threadId: normalizedThreadId,
      usage: result?.usage ?? null,
    };
  }

  async function readTelegramThreadActivity(threadId, limit) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("Select an active Telegram thread before running this command.");
    }
    const normalizedLimit = normalizeTelegramActivityLimit(limit);
    const result = await sendCodexRequest("thread/turns/list", {
      threadId: normalizedThreadId,
      limit: normalizedLimit,
      sortDirection: "desc",
    });
    return summarizeTelegramThreadActivity(result, {
      maxTurns: normalizedLimit,
      maxEntries: Math.min(20, normalizedLimit * 3),
    });
  }

  async function listTelegramSkills({ threadId, cwd, query } = {}) {
    const resolvedCwd = await resolveTelegramThreadCwd(threadId, cwd);
    const params = { cwds: [resolvedCwd] };
    const payload = await sendCodexRequest("skills/list", params)
      .catch((error) => {
        if (!shouldRetryDiscoveryListWithCwdFallback(error)) {
          throw error;
        }
        return sendCodexRequest("skills/list", { cwd: resolvedCwd });
      });
    return {
      ...payload,
      query: normalizeNonEmptyString(query),
    };
  }

  async function listTelegramPlugins({ threadId, cwd, query } = {}) {
    const resolvedCwd = await resolveTelegramThreadCwd(threadId, cwd);
    const payload = await sendCodexRequest("plugin/list", { cwds: [resolvedCwd] });
    return {
      ...payload,
      query: normalizeNonEmptyString(query),
    };
  }

  function shouldRetryDiscoveryListWithCwdFallback(error) {
    const code = Number(error?.code);
    if (code === -32600 || code === -32602) {
      return true;
    }
    const message = normalizeNonEmptyString(error?.message).toLowerCase();
    return message.includes("cwds") || message.includes("invalid params");
  }

  async function listTelegramThreads({ query = "", archived = false } = {}) {
    const threads = normalizeTelegramThreadsList(await sendCodexRequest("thread/list", {
      limit: normalizeNonEmptyString(query) ? 50 : 10,
      archived,
    }));
    return filterTelegramThreads(threads, query);
  }

  async function readTelegramRateLimits() {
    return sendCodexRequest("account/rateLimits/read", null)
      .catch((error) => {
        if (!shouldRetryRateLimitsWithEmptyObject(error)) {
          throw error;
        }
        return sendCodexRequest("account/rateLimits/read", {});
      });
  }

  async function readTelegramUsageStatus({ threadId } = {}) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    const [rateLimitsResult, contextResult] = await Promise.allSettled([
      readTelegramRateLimits(),
      normalizedThreadId ? readTelegramContextWindow(normalizedThreadId) : Promise.resolve(null),
    ]);
    const errors = {};
    if (rateLimitsResult.status === "rejected") {
      errors.rateLimits = safeTelegramUsageError(rateLimitsResult.reason);
    }
    if (contextResult.status === "rejected") {
      errors.context = safeTelegramUsageError(contextResult.reason);
    }
    return {
      context: contextResult.status === "fulfilled" ? contextResult.value : null,
      rateLimits: rateLimitsResult.status === "fulfilled" ? rateLimitsResult.value : null,
      errors,
    };
  }

  function safeTelegramUsageError(error) {
    const code = normalizeNonEmptyString(error?.code);
    const message = normalizeNonEmptyString(error?.userMessage)
      || normalizeNonEmptyString(error?.message)
      || "unavailable";
    return code ? `${code}: ${message}` : message;
  }

  function shouldRetryRateLimitsWithEmptyObject(error) {
    const code = Number(error?.code);
    if (code !== -32600 && code !== -32602) {
      return false;
    }
    const message = normalizeNonEmptyString(error?.message).toLowerCase();
    return message.includes("invalid params")
      || message.includes("invalid param")
      || message.includes("failed to parse")
      || message.includes("expected")
      || message.includes("missing field `params`")
      || message.includes("missing field params");
  }

  async function captureTelegramWorkspaceCheckpoint({ threadId, cwd } = {}) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("Select an active Telegram thread before capturing a checkpoint.");
    }
    const resolvedCwd = await resolveTelegramThreadCwd(normalizedThreadId, cwd);
    const checkpointRef = buildTelegramManualCheckpointRef(normalizedThreadId);
    const checkpoint = await handleWorkspaceMethod("workspace/checkpointCapture", {
      cwd: resolvedCwd,
      threadId: normalizedThreadId,
      checkpointRef,
      checkpointKind: "telegramManual",
    });
    const status = await gitStatus(resolvedCwd).catch(() => null);
    return { checkpoint, status };
  }

  async function previewTelegramWorkspaceCheckpointRestore({ threadId, cwd, checkpointRef } = {}) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    const normalizedCheckpointRef = normalizeNonEmptyString(checkpointRef);
    if (!normalizedThreadId) {
      throw new Error("Select an active Telegram thread before previewing checkpoint restore.");
    }
    if (!normalizedCheckpointRef) {
      throw new Error("Select a Telegram checkpoint before previewing restore.");
    }
    const resolvedCwd = await resolveTelegramThreadCwd(normalizedThreadId, cwd);
    return handleWorkspaceMethod("workspace/checkpointRestorePreview", {
      cwd: resolvedCwd,
      threadId: normalizedThreadId,
      checkpointRef: normalizedCheckpointRef,
    });
  }

  async function applyTelegramWorkspaceCheckpointRestore({
    threadId,
    cwd,
    checkpointRef,
    expectedTargetCommit,
  } = {}) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    const normalizedCheckpointRef = normalizeNonEmptyString(checkpointRef);
    if (!normalizedThreadId) {
      throw new Error("Select an active Telegram thread before applying checkpoint restore.");
    }
    if (!normalizedCheckpointRef) {
      throw new Error("Select a Telegram checkpoint before applying restore.");
    }
    const resolvedCwd = await resolveTelegramThreadCwd(normalizedThreadId, cwd);
    return handleWorkspaceMethod("workspace/checkpointRestoreApply", buildTelegramCheckpointRestoreApplyParams({
      cwd: resolvedCwd,
      threadId: normalizedThreadId,
      checkpointRef: normalizedCheckpointRef,
      expectedTargetCommit,
    }));
  }

  async function compactTelegramThread(threadId) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("Select an active Telegram thread before compacting context.");
    }
    const result = await sendCodexRequest("thread/compact/start", { threadId: normalizedThreadId });
    return {
      ...(result && typeof result === "object" && !Array.isArray(result) ? result : {}),
      threadId: normalizedThreadId,
    };
  }

  async function renameTelegramThread({ threadId, title } = {}) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    const normalizedTitle = normalizeNonEmptyString(title);
    if (!normalizedThreadId) {
      throw new Error("Select an active Telegram thread before renaming.");
    }
    if (!normalizedTitle) {
      throw new Error("A thread title is required.");
    }
    const result = {
      threadId: normalizedThreadId,
      thread_id: normalizedThreadId,
      name: normalizedTitle,
      title: normalizedTitle,
    };
    sendThreadNameUpdatedNotification(result);
    return result;
  }

  async function generateTelegramThreadTitle({
    threadId,
    cwd,
    message,
    runtimePreferences,
  } = {}) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("Select an active Telegram thread before generating a title.");
    }
    const titleSeed = normalizeNonEmptyString(message) || await readTelegramThreadTitleSeed(normalizedThreadId);
    if (!titleSeed) {
      throw new Error("No user message found for the selected Telegram thread. Send /title <message> instead.");
    }
    const resolvedCwd = await resolveTelegramThreadCwd(normalizedThreadId, cwd).catch(() => normalizeNonEmptyString(cwd));
    const generated = await threadGenerateTitle({
      message: titleSeed,
      cwd: resolvedCwd,
      model: runtimePreferences?.model,
    }, {
      codexAppPath: config.codexAppPath,
    });
    const result = threadNameSet({
      threadId: normalizedThreadId,
      title: generated.title,
    });
    sendThreadNameUpdatedNotification(result);
    return result;
  }

  async function readTelegramThreadTitleSeed(threadId) {
    const result = await sendCodexRequest("thread/turns/list", {
      threadId,
      limit: 20,
      sortDirection: "asc",
    });
    return extractTelegramTitleSeedText(result);
  }

  async function openTelegramThreadOnMac(threadId) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("Select an active Telegram thread before running this command.");
    }
    return handleDesktopMethod("desktop/continueOnMac", { threadId: normalizedThreadId });
  }

  async function listTelegramProjects(query = "") {
    const normalizedQuery = normalizeNonEmptyString(query);
    if (normalizedQuery) {
      const result = await projectSearchDirectories({
        query: normalizedQuery,
        limit: 8,
        maxDepth: 6,
      });
      return {
        query: normalizedQuery,
        projects: result.entries || [],
      };
    }
    const result = await projectQuickLocations();
    return {
      projects: result.locations || [],
    };
  }

  async function listTelegramProjectDirectory(projectPath = "") {
    const normalizedPath = normalizeNonEmptyString(projectPath);
    if (!normalizedPath) {
      const result = await projectQuickLocations();
      return {
        isRoot: true,
        entries: result.locations || [],
      };
    }
    const result = await projectListDirectory({
      path: normalizedPath,
      limit: 12,
    });
    return {
      path: result.path,
      parentPath: result.parentPath,
      entries: result.entries || [],
    };
  }

  async function createTelegramProjectDirectory({ parentPath, name } = {}) {
    const result = await projectCreateDirectory({ parentPath, name });
    return {
      ...result,
      entries: [],
    };
  }

  async function transcribeTelegramVoice({ audioData, mimeType, durationMs } = {}) {
    const audioBuffer = Buffer.isBuffer(audioData)
      ? audioData
      : Buffer.from(audioData || []);
    if (!audioBuffer.length) {
      throw new Error("Telegram voice message did not include audio.");
    }

    const normalizedMimeType = normalizeNonEmptyString(mimeType).toLowerCase();
    const wavBuffer = normalizedMimeType === "audio/wav" || normalizedMimeType === "audio/x-wav"
      ? audioBuffer
      : await convertTelegramAudioToWav(audioBuffer);

    return transcribeVoice({
      mimeType: "audio/wav",
      audioBase64: wavBuffer.toString("base64"),
      sampleRateHz: 24_000,
      durationMs,
    }, {
      sendCodexRequest,
      fetchImpl: globalThis.fetch,
      FormDataImpl: globalThis.FormData,
      BlobImpl: globalThis.Blob,
    });
  }

  async function continueTelegramThread({
    threadId,
    text,
    attachments,
    runtimePreferences,
    collaborationMode,
  } = {}) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    const trimmedText = normalizeNonEmptyString(text);
    if (!normalizedThreadId) {
      throw new Error("A Telegram active thread is required before continuing.");
    }
    if (!trimmedText) {
      throw new Error("Telegram continue text is required.");
    }
    observeTelegramThreadRollout(normalizedThreadId);
    let threadPayload;
    try {
      await resumeTelegramThreadForInput(normalizedThreadId, runtimePreferences);
      threadPayload = await sendCodexRequest("thread/read", { threadId: normalizedThreadId });
    } catch (error) {
      if (!isTelegramMissingRolloutError(error)) {
        throw error;
      }
      threadPayload = { thread: { id: normalizedThreadId, turns: [] } };
    }
    const request = buildTelegramCodexInputRequest({
      threadId: normalizedThreadId,
      text: trimmedText,
      threadPayload,
      attachments,
      runtimePreferences,
      collaborationMode,
    });
    if (request.method === "turn/start") {
      return sendTelegramRuntimeRequest(request.method, request.params, {
        accessMode: telegramRuntimeAccessMode(runtimePreferences),
        allowCollaborationModeFallback: normalizeNonEmptyString(collaborationMode).toLowerCase() === "plan",
      });
    }
    if (normalizeNonEmptyString(collaborationMode).toLowerCase() === "plan") {
      return sendTelegramRuntimeRequest(request.method, request.params, {
        accessMode: telegramRuntimeAccessMode(runtimePreferences),
        allowCollaborationModeFallback: true,
      });
    }
    return sendCodexRequest(request.method, request.params);
  }

  function observeTelegramThreadRollout(threadId) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      return;
    }
    rolloutLiveMirror?.observeInbound(JSON.stringify({
      method: "thread/resume",
      params: { threadId: normalizedThreadId },
    }));
  }

  async function stopTelegramThread(threadId) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("A Telegram active thread is required before stop.");
    }
    const threadPayload = await sendCodexRequest("thread/read", { threadId: normalizedThreadId });
    const turnId = findActiveTurnId(threadPayload);
    if (!turnId) {
      throw new Error("No active turn found for the selected Telegram thread.");
    }
    return sendCodexRequest("turn/interrupt", { threadId: normalizedThreadId, turnId });
  }

  async function createTelegramThread({
    sourceThreadId,
    sourceCwd,
    cwd: requestedCwd,
    runtimePreferences,
  } = {}) {
    const normalizedSourceThreadId = normalizeNonEmptyString(sourceThreadId);
    const explicitCwd = normalizeNonEmptyString(requestedCwd);
    const cwd = explicitCwd
      ? await validateTelegramProjectCwd(explicitCwd)
      : await resolveTelegramCreateThreadCwd(normalizedSourceThreadId, sourceCwd);
    const startPayload = await sendTelegramRuntimeRequest(
      "thread/start",
      buildTelegramThreadStartParams({ cwd, runtimePreferences }),
      { accessMode: telegramRuntimeAccessMode(runtimePreferences) }
    );
    return normalizeTelegramCreatedThread(startPayload, { cwd });
  }

  async function forkTelegramThread({ threadId, cwd, runtimePreferences } = {}) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("Select an active Telegram thread before forking.");
    }
    const forkPayload = await sendTelegramThreadForkRequest(normalizedThreadId);
    const forked = normalizeTelegramForkedThread(forkPayload, {
      sourceThreadId: normalizedThreadId,
      cwd,
    });
    await resumeTelegramForkedThread({
      threadId: forked.threadId,
      cwd: readTelegramThreadCwd(forked.thread),
      runtimePreferences,
    });
    return forked;
  }

  async function createTelegramWorktreeThread({
    threadId,
    cwd,
    branch,
    runtimePreferences,
  } = {}) {
    const normalizedBranch = normalizeNonEmptyString(branch);
    if (!normalizedBranch) {
      throw new Error("A worktree branch name is required.");
    }

    const sourceCwd = await resolveTelegramThreadCwd(threadId, cwd);
    const worktree = await gitCreateWorktree(sourceCwd, {
      name: normalizedBranch,
      changeTransfer: "copy",
    });
    const created = await createTelegramThread({
      sourceThreadId: threadId,
      sourceCwd,
      cwd: worktree.worktreePath,
      runtimePreferences,
    });

    return normalizeTelegramWorktreeThreadResult({
      worktree,
      thread: created.thread,
      threadId: created.threadId,
    });
  }

  async function generateTelegramCommitDraft({ threadId, cwd, runtimePreferences } = {}) {
    const resolvedCwd = await resolveTelegramThreadCwd(threadId, cwd);
    return gitGenerateCommitMessage(resolvedCwd, {
      model: runtimePreferences?.model,
    }, {
      codexAppPath: config.codexAppPath,
    });
  }

  async function generateTelegramPullRequestDraft({ threadId, cwd, runtimePreferences } = {}) {
    const resolvedCwd = await resolveTelegramThreadCwd(threadId, cwd);
    return gitGeneratePullRequestDraft(resolvedCwd, {
      model: runtimePreferences?.model,
    }, {
      codexAppPath: config.codexAppPath,
    });
  }

  async function startTelegramReview({
    threadId,
    runtimePreferences,
    target,
    baseBranch,
  } = {}) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("Select an active Telegram thread before starting review.");
    }
    observeTelegramThreadRollout(normalizedThreadId);
    await resumeTelegramThreadForInput(normalizedThreadId, runtimePreferences);
    const params = buildTelegramReviewStartParams({
      threadId: normalizedThreadId,
      target,
      baseBranch,
    });
    const result = await sendTelegramRuntimeRequest("review/start", params, {
      accessMode: telegramRuntimeAccessMode(runtimePreferences),
    });
    return {
      ...result,
      target: params.target,
    };
  }

  async function sendTelegramThreadForkRequest(threadId) {
    let includeExcludeTurns = true;
    while (true) {
      try {
        return await sendCodexRequest(
          "thread/fork",
          buildTelegramThreadForkParams({ threadId, excludeTurns: includeExcludeTurns })
        );
      } catch (error) {
        if (includeExcludeTurns && shouldRetryTelegramRuntimeWithoutField(error)) {
          includeExcludeTurns = false;
          continue;
        }
        throw error;
      }
    }
  }

  async function resumeTelegramForkedThread({ threadId, cwd, runtimePreferences } = {}) {
    let includeExcludeTurns = true;
    while (true) {
      try {
        return await sendTelegramRuntimeRequest(
          "thread/resume",
          buildTelegramThreadResumeParams({
            threadId,
            cwd,
            excludeTurns: includeExcludeTurns,
            runtimePreferences,
          }),
          { accessMode: telegramRuntimeAccessMode(runtimePreferences) }
        );
      } catch (error) {
        if (includeExcludeTurns && shouldRetryTelegramRuntimeWithoutField(error)) {
          includeExcludeTurns = false;
          continue;
        }
        throw error;
      }
    }
  }

  async function validateTelegramProjectCwd(candidatePath) {
    const validation = await projectValidatePath({ path: candidatePath });
    if (!validation?.isAllowed) {
      throw new Error("That Telegram project folder is outside the allowed local project locations.");
    }
    if (!validation.exists) {
      throw new Error("That Telegram project folder does not exist on this Mac.");
    }
    if (!validation.isDirectory) {
      throw new Error("That Telegram project path is not a folder.");
    }
    return validation.path;
  }

  async function resumeTelegramThreadForInput(threadId, runtimePreferences) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("A Telegram active thread is required before continuing.");
    }
    let thread = null;
    let cwd = "";
    try {
      thread = findTelegramThreadById(
        normalizeTelegramThreadsList(await sendCodexRequest("thread/list", { limit: 50 })),
        normalizedThreadId
      );
      cwd = readTelegramThreadCwd(thread);
    } catch {
      // thread/resume can still succeed from the id alone.
    }

    let includeExcludeTurns = true;
    while (true) {
      try {
        return await sendTelegramRuntimeRequest(
          "thread/resume",
          buildTelegramThreadResumeParams({
            threadId: normalizedThreadId,
            cwd,
            excludeTurns: includeExcludeTurns,
            runtimePreferences,
          }),
          { accessMode: telegramRuntimeAccessMode(runtimePreferences) }
        );
      } catch (error) {
        if (includeExcludeTurns && shouldRetryTelegramRuntimeWithoutField(error)) {
          includeExcludeTurns = false;
          continue;
        }
        throw error;
      }
    }
  }

  async function sendTelegramRuntimeRequest(method, baseParams, options = {}) {
    const attempts = buildTelegramRuntimeRequestAttempts(baseParams, options);
    let lastError = null;
    for (let index = 0; index < attempts.length; index += 1) {
      try {
        return await sendCodexRequest(method, attempts[index]);
      } catch (error) {
        lastError = error;
        const hasMoreAttempts = index < attempts.length - 1;
        if (!hasMoreAttempts || !shouldRetryTelegramRuntimeRequest(error)) {
          throw error;
        }
      }
    }
    throw lastError || new Error(`Codex request failed: ${method}`);
  }

  async function resolveTelegramCreateThreadCwd(sourceThreadId, sourceCwd) {
    if (sourceThreadId) {
      return resolveTelegramThreadCwd(sourceThreadId, sourceCwd);
    }
    const fallbackCwd = normalizeNonEmptyString(sourceCwd);
    if (fallbackCwd) {
      return fallbackCwd;
    }
    const recentThreads = normalizeTelegramThreadsList(await sendCodexRequest("thread/list", { limit: 10 }));
    for (const thread of recentThreads) {
      const cwd = readTelegramThreadCwd(thread);
      if (cwd) {
        return cwd;
      }
      const threadId = normalizeNonEmptyString(thread?.id || thread?.threadId || thread?.thread_id);
      if (!threadId) {
        continue;
      }
      try {
        const threadPayload = await sendCodexRequest("thread/read", { threadId });
        const resolvedCwd = readTelegramThreadCwd(readThreadFromPayload(threadPayload));
        if (resolvedCwd) {
          return resolvedCwd;
        }
      } catch {
        // Try the next recent thread before giving up on first-run Telegram /new.
      }
    }
    throw new Error("No recent Remodex thread has a local project path. Select a thread with /threads first.");
  }

  async function resolveTelegramThreadCwd(threadId, fallbackCwd = "") {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("Select an active Telegram thread before running this command.");
    }
    const normalizedFallbackCwd = normalizeNonEmptyString(fallbackCwd);
    let thread = null;
    try {
      thread = findTelegramThreadById(
        normalizeTelegramThreadsList(await sendCodexRequest("thread/list", { limit: 50 })),
        normalizedThreadId
      ) || readThreadFromPayload(await sendCodexRequest("thread/read", { threadId: normalizedThreadId }));
    } catch (error) {
      if (normalizedFallbackCwd) {
        return normalizedFallbackCwd;
      }
      throw error;
    }
    const cwd = readTelegramThreadCwd(thread);
    if (!cwd) {
      if (normalizedFallbackCwd) {
        return normalizedFallbackCwd;
      }
      throw new Error("The selected Telegram thread does not have a local project path.");
    }
    return cwd;
  }

  async function resolveTelegramApproval(payload, decision) {
    const requestId = payload?.requestId;
    if (requestId == null) {
      throw new Error("Telegram approval callback is missing a request id.");
    }
    return handleApplicationMessage(JSON.stringify({
      id: requestId,
      result: buildTelegramApprovalResponseResult({
        method: payload?.method,
        params: payload?.params,
        decision,
      }),
    }));
  }

  async function resolveTelegramUserInput(payload = {}) {
    const requestId = normalizeNonEmptyString(payload.requestId);
    const answers = payload.answers && typeof payload.answers === "object" && !Array.isArray(payload.answers)
      ? payload.answers
      : null;
    if (!requestId) {
      throw new Error("Telegram input callback is missing a request id.");
    }
    if (!answers || Object.keys(answers).length === 0) {
      throw new Error("Telegram input callback is missing answers.");
    }

    const handled = desktopIpcActionFollower?.observeInbound(JSON.stringify({
      id: requestId,
      result: { answers },
    }));
    if (!handled) {
      throw new Error("No active desktop input request found for this Telegram answer.");
    }
    return { success: true };
  }

  function stopBridge() {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    bridgeWakeAssertion.stop();
    clearReconnectTimer();
    clearRelayWatchdog();
    bridgeStatusPublisher.stopHeartbeat();
    stopContextUsageWatcher();
    rolloutLiveMirror?.stopAll();
    desktopIpcActionFollower?.stopAll();
    telegramAdapter?.stop?.();
    desktopRefresher.handleTransportReset();
    failBridgeManagedCodexRequests(new Error("Bridge stopped before the request completed."));
    forwardedRequestMethodsById.clear();

    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
    codex.shutdown();
  }

  return {
    stop: stopBridge,
  };
}

function convertTelegramAudioToWav(audioBuffer, { spawnImpl = spawn, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      child = spawnImpl("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-ac",
        "1",
        "-ar",
        "24000",
        "-f",
        "wav",
        "pipe:1",
      ], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(telegramVoiceConversionError(error));
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill?.();
      reject(telegramVoiceConversionError(new Error("ffmpeg timed out while converting Telegram voice audio.")));
    }, timeoutMs);
    timeout.unref?.();

    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });
    child.on?.("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(telegramVoiceConversionError(error));
    });
    child.on?.("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const wavBuffer = Buffer.concat(stdoutChunks);
      if (code === 0 && wavBuffer.length > 0) {
        resolve(wavBuffer);
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(telegramVoiceConversionError(new Error(stderr || `ffmpeg exited with code ${code}`)));
    });

    child.stdin?.end(audioBuffer);
  });
}

function telegramVoiceConversionError(cause) {
  const error = new Error("Telegram voice transcription requires ffmpeg to convert voice notes on this Mac.");
  error.errorCode = "telegram_voice_conversion_failed";
  error.cause = cause;
  return error;
}

function telegramRuntimeAccessMode(runtimePreferences = {}) {
  return normalizeTelegramAccessMode(runtimePreferences?.accessMode || runtimePreferences?.runtimeAccessMode) || "on-request";
}

// Holds a single macOS idle-sleep assertion for as long as the bridge process stays alive.
function createMacOSBridgeWakeAssertion({
  platform = process.platform,
  pid = process.pid,
  spawnImpl = spawn,
  consoleImpl = console,
  enabled = true,
} = {}) {
  if (platform !== "darwin") {
    return {
      active: false,
      enabled: false,
      setEnabled() {
        return { active: false, enabled: false };
      },
      stop() {},
    };
  }

  let desiredEnabled = Boolean(enabled);
  let child = null;

  function stop() {
    if (!child || child.killed || typeof child.kill !== "function") {
      child = null;
      return;
    }

    try {
      child.kill();
    } catch {}
    child = null;
  }

  function start() {
    if (!desiredEnabled || child) {
      return;
    }

    try {
      const nextChild = spawnImpl("/usr/bin/caffeinate", ["-i", "-w", String(pid)], {
        stdio: "ignore",
      });

      nextChild.on?.("error", (error) => {
        consoleImpl.warn(`[remodex] Failed to hold the Mac awake while the bridge is active: ${error.message}`);
      });
      nextChild.on?.("exit", () => {
        if (child === nextChild) {
          child = null;
        }
      });
      nextChild.unref?.();
      child = nextChild;
    } catch (error) {
      consoleImpl.warn(
        `[remodex] Failed to start the bridge wake assertion: ${(error && error.message) || "unknown error"}`
      );
      child = null;
    }
  }

  function setEnabled(nextEnabled) {
    desiredEnabled = Boolean(nextEnabled);
    if (desiredEnabled) {
      start();
    } else {
      stop();
    }

    return {
      active: Boolean(child && !child.killed),
      enabled: desiredEnabled,
    };
  }

  start();

  return {
    get active() {
      return Boolean(child && !child.killed);
    },
    get enabled() {
      return desiredEnabled;
    },
    setEnabled,
    stop,
  };
}

// Registers the canonical Mac identity and the one trusted phone allowed for auto-resolve.
function buildMacRegistrationHeaders(deviceState, pairingSession) {
  const registration = buildMacRegistration(deviceState, pairingSession);
  const headers = {
    "x-mac-device-id": registration.macDeviceId,
    "x-mac-identity-public-key": registration.macIdentityPublicKey,
    "x-machine-name": registration.displayName,
    "x-pairing-code": registration.pairingCode,
    "x-pairing-version": registration.pairingVersion ? String(registration.pairingVersion) : "",
    "x-pairing-expires-at": registration.pairingExpiresAt ? String(registration.pairingExpiresAt) : "",
  };
  if (registration.trustedPhoneDeviceId && registration.trustedPhonePublicKey) {
    headers["x-trusted-phone-device-id"] = registration.trustedPhoneDeviceId;
    headers["x-trusted-phone-public-key"] = registration.trustedPhonePublicKey;
  }
  return headers;
}

function buildMacRegistration(deviceState, pairingSession) {
  const trustedPhoneEntry = Object.entries(deviceState?.trustedPhones || {})[0] || null;
  return {
    macDeviceId: normalizeNonEmptyString(deviceState?.macDeviceId),
    macIdentityPublicKey: normalizeNonEmptyString(deviceState?.macIdentityPublicKey),
    displayName: normalizeNonEmptyString(os.hostname()),
    trustedPhoneDeviceId: normalizeNonEmptyString(trustedPhoneEntry?.[0]),
    trustedPhonePublicKey: normalizeNonEmptyString(trustedPhoneEntry?.[1]),
    pairingCode: normalizeNonEmptyString(pairingSession?.pairingCode),
    pairingVersion: Number.isInteger(pairingSession?.pairingPayload?.v) ? pairingSession.pairingPayload.v : 0,
    pairingExpiresAt: Number.isFinite(pairingSession?.pairingPayload?.expiresAt)
      ? pairingSession.pairingPayload.expiresAt
      : 0,
  };
}

function shutdown(codex, getSocket, beforeExit = () => {}) {
  beforeExit();

  const socket = getSocket();
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    socket.close();
  }

  codex.shutdown();

  setTimeout(() => process.exit(0), 100);
}

// Forces app-server summary generation off for models whose Responses API calls
// reject reasoning.summary, while leaving the phone-facing runtime choice intact.
function disableUnsupportedReasoningSummaryForTurnStart(rawMessage) {
  const parsed = parseBridgeJSON(rawMessage);
  if (!parsed || parsed.method !== "turn/start") {
    return rawMessage;
  }

  const params = parsed.params && typeof parsed.params === "object" && !Array.isArray(parsed.params)
    ? parsed.params
    : null;
  if (!params || params.summary === "none") {
    return rawMessage;
  }

  const model = readTurnStartModel(params);
  if (!MODELS_WITHOUT_REASONING_SUMMARY.has(model)) {
    return rawMessage;
  }

  return JSON.stringify({
    ...parsed,
    params: {
      ...params,
      summary: "none",
    },
  });
}

function readTurnStartModel(params) {
  return normalizeNonEmptyString(params?.model).toLowerCase()
    || normalizeNonEmptyString(params?.collaborationMode?.settings?.model).toLowerCase()
    || normalizeNonEmptyString(params?.collaboration_mode?.settings?.model).toLowerCase();
}

function extractBridgeMessageContext(rawMessage) {
  let parsed = null;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return { method: "", threadId: null, turnId: null };
  }

  const method = parsed?.method;
  const params = parsed?.params;
  const threadId = extractThreadId(method, params);
  const turnId = extractTurnId(method, params);

  return {
    method: typeof method === "string" ? method : "",
    threadId,
    turnId,
  };
}

function shouldStartContextUsageWatcher(context) {
  if (!context?.threadId) {
    return false;
  }

  return context.method === "turn/start"
    || context.method === "turn/started";
}

function extractThreadId(method, params) {
  if (method === "turn/start" || method === "turn/started") {
    return (
      readString(params?.threadId)
      || readString(params?.thread_id)
      || readString(params?.turn?.threadId)
      || readString(params?.turn?.thread_id)
    );
  }

  if (method === "thread/start" || method === "thread/started") {
    return (
      readString(params?.threadId)
      || readString(params?.thread_id)
      || readString(params?.thread?.id)
      || readString(params?.thread?.threadId)
      || readString(params?.thread?.thread_id)
    );
  }

  if (method === "turn/completed") {
    return (
      readString(params?.threadId)
      || readString(params?.thread_id)
      || readString(params?.turn?.threadId)
      || readString(params?.turn?.thread_id)
    );
  }

  return null;
}

function extractTurnId(method, params) {
  if (method === "turn/started" || method === "turn/completed") {
    return (
      readString(params?.turnId)
      || readString(params?.turn_id)
      || readString(params?.id)
      || readString(params?.turn?.id)
      || readString(params?.turn?.turnId)
      || readString(params?.turn?.turn_id)
    );
  }

  return null;
}

function readString(value) {
  return typeof value === "string" && value ? value : null;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeTelegramActivityLimit(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 3;
  }
  return Math.min(Math.max(parsed, 1), 10);
}

function parseAdaptiveThreadTurnsListRequest(rawMessage) {
  const parsed = parseBridgeJSON(rawMessage);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  if (parsed.method !== "thread/turns/list") {
    return null;
  }

  if (parsed.id == null) {
    return null;
  }

  const params = parsed.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }

  if (!Number.isInteger(params.limit) || params.limit <= 0) {
    return null;
  }

  return parsed;
}

async function fetchAdaptiveThreadTurnsListForRelay(request, {
  fetchPage,
  now = Date.now,
  targetBudgetMs = RELAY_TURNS_LIST_TARGET_BUDGET_MS,
  budgetReserveMs = RELAY_TURNS_LIST_BUDGET_RESERVE_MS,
  rawPageSoftLimitBytes = RELAY_THREAD_PAYLOAD_SOFT_LIMIT_BYTES,
  payloadSoftLimitBytes = RELAY_THREAD_PAYLOAD_SOFT_LIMIT_BYTES,
  sanitizeForRelay = sanitizeThreadHistoryImagesForRelay,
} = {}) {
  if (typeof fetchPage !== "function") {
    throw new Error("fetchPage is required for adaptive turns-list pagination.");
  }

  const params = request?.params;
  const requestedLimit = Number.isInteger(params?.limit) && params.limit > 0
    ? Math.min(params.limit, RELAY_TURNS_LIST_MAX_INITIAL_LIMIT)
    : 1;
  const startedAt = now();
  let nextCursor = params?.cursor;
  let turnsKey = null;
  let firstResult = null;
  let lastResult = null;
  let combinedTurns = [];
  let response = null;

  while (combinedTurns.length < requestedLimit) {
    const remaining = requestedLimit - combinedTurns.length;
    const pageLimit = selectAdaptiveTurnsListBatchLimit(combinedTurns.length, remaining);
    const pageParams = buildAdaptiveTurnsListPageParams(params, pageLimit, nextCursor);
    let page;

    try {
      page = await fetchMeasuredAdaptiveTurnsListPage(fetchPage, pageParams, now);
    } catch (error) {
      if (response) {
        return response;
      }
      return await fetchSafeThreadTurnsListFallback(request, {
        fetchPage,
        now,
        sanitizeForRelay,
        payloadSoftLimitBytes,
      });
    }

    const pageResult = unwrapAppServerPayloadResult(page.result);
    const pageTurnsKey = findTurnsListResultKey(pageResult);
    if (!pageTurnsKey) {
      if (!response) {
        return await fetchSafeThreadTurnsListFallback(request, {
          fetchPage,
          now,
          sanitizeForRelay,
          payloadSoftLimitBytes,
        });
      }
      return response;
    }

    if (!turnsKey) {
      turnsKey = pageTurnsKey;
    }
    if (!firstResult) {
      firstResult = pageResult;
    }
    lastResult = pageResult;

    const pageTurns = pageResult[pageTurnsKey];
    combinedTurns = combinedTurns.concat(pageTurns);
    response = buildSafeTurnsListResponse(request.id, firstResult, lastResult, turnsKey, combinedTurns);

    if (measureSanitizedTurnsListResponseBytes(response, sanitizeForRelay) >= payloadSoftLimitBytes) {
      response = buildLargestSafeTurnsListResponse({
        requestId: request.id,
        firstResult,
        lastResult,
        turnsKey,
        turns: combinedTurns,
        maxTurns: RELAY_TURNS_LIST_SAFE_RETRY_LIMIT,
        sanitizeForRelay,
        payloadSoftLimitBytes,
      }) ?? buildEmptyTurnsListResponse(request);
      break;
    }

    nextCursor = readTurnsListNextCursor(pageResult);
    if (combinedTurns.length >= requestedLimit || !hasRelayCursor(nextCursor) || pageTurns.length === 0) {
      break;
    }

    const rawPageBytes = jsonByteLength(pageResult);
    const sanitizedResponseBytes = measureSanitizedTurnsListResponseBytes(response, sanitizeForRelay);
    const elapsedMs = Math.max(0, now() - startedAt);
    const remainingBudgetMs = Math.max(0, targetBudgetMs - elapsedMs);
    if (
      rawPageBytes >= rawPageSoftLimitBytes
      || sanitizedResponseBytes >= payloadSoftLimitBytes
      || page.elapsedMs >= Math.max(0, targetBudgetMs - budgetReserveMs)
      || remainingBudgetMs <= budgetReserveMs
    ) {
      break;
    }
  }

  return response ?? {
    id: request.id,
    result: {
      data: [],
    },
  };
}

function buildEmptyTurnsListResponse(request) {
  return {
    id: request.id,
    result: {
      data: [],
      nextCursor: null,
    },
  };
}

function isEmptyTurnsListResponse(response) {
  const turnsKey = findTurnsListResultKey(response?.result);
  return Boolean(turnsKey) && response.result[turnsKey].length === 0;
}

async function fetchSafeThreadTurnsListFallback(request, {
  fetchPage,
  now,
  sanitizeForRelay,
  payloadSoftLimitBytes,
}) {
  const params = request?.params;
  const requestedLimit = Number.isInteger(params?.limit) && params.limit > 0
    ? params.limit
    : RELAY_TURNS_LIST_SAFE_RETRY_LIMIT;
  const safeLimit = Math.min(requestedLimit, RELAY_TURNS_LIST_SAFE_RETRY_LIMIT);
  const safeParams = buildAdaptiveTurnsListPageParams(params, safeLimit, params?.cursor);

  try {
    const page = await fetchMeasuredAdaptiveTurnsListPage(fetchPage, safeParams, now);
    const pageResult = unwrapAppServerPayloadResult(page.result);
    const turnsKey = findTurnsListResultKey(pageResult);
    if (!turnsKey) {
      return buildEmptyTurnsListResponse(request);
    }

    // If the normal pagination path returns a bad first page, retry once with a small page.
    // The retry response is intentionally minimal so Swift does not decode stale server metadata.
    const response = buildLargestSafeTurnsListResponse({
      requestId: request.id,
      firstResult: pageResult,
      lastResult: pageResult,
      turnsKey,
      turns: pageResult[turnsKey],
      maxTurns: safeLimit,
      sanitizeForRelay,
      payloadSoftLimitBytes,
    });
    if (response) {
      return response;
    }
  } catch {
    // Fall through to a valid empty page: the phone can keep the thread open instead of crashing.
  }

  return buildEmptyTurnsListResponse(request);
}

async function fetchMeasuredAdaptiveTurnsListPage(fetchPage, params, now) {
  const startedAt = now();
  const result = await fetchPage(params);
  const elapsedMs = Math.max(0, now() - startedAt);
  return {
    result,
    elapsedMs,
  };
}

function selectAdaptiveTurnsListBatchLimit(fetchedTurnCount, remainingTurnCount) {
  if (fetchedTurnCount <= 0) {
    return Math.min(1, remainingTurnCount);
  }
  if (fetchedTurnCount <= 1) {
    return Math.min(4, remainingTurnCount);
  }
  return remainingTurnCount;
}

function buildAdaptiveTurnsListPageParams(baseParams, limit, cursor) {
  const params = {
    ...baseParams,
    limit,
  };
  if (hasRelayCursor(cursor)) {
    params.cursor = cursor;
  } else {
    delete params.cursor;
  }
  return params;
}

function findTurnsListResultKey(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  return RELAY_TURNS_LIST_RESULT_KEYS.find((key) => Array.isArray(result[key])) || null;
}

function buildSafeTurnsListResponse(requestId, firstResult, lastResult, turnsKey, turns) {
  return {
    id: requestId,
    result: buildAdaptiveTurnsListResult(firstResult, lastResult, turnsKey, turns),
  };
}

// Trims oversized history pages progressively: normal page -> 5 turns -> ... -> 1 turn.
function buildLargestSafeTurnsListResponse({
  requestId,
  firstResult,
  lastResult,
  turnsKey,
  turns,
  maxTurns,
  sanitizeForRelay,
  payloadSoftLimitBytes,
}) {
  const sliceLimit = Math.min(turns.length, maxTurns);
  for (let count = sliceLimit; count > 0; count -= 1) {
    const response = buildSafeTurnsListResponse(
      requestId,
      firstResult,
      lastResult,
      turnsKey,
      turns.slice(0, count)
    );
    if (measureSanitizedTurnsListResponseBytes(response, sanitizeForRelay) < payloadSoftLimitBytes) {
      return response;
    }
  }
  return buildEmergencySingleTurnResponse({
    requestId,
    lastResult,
    turnsKey,
    turn: turns[0],
    sanitizeForRelay,
    payloadSoftLimitBytes,
  });
}

function buildEmergencySingleTurnResponse({
  requestId,
  lastResult,
  turnsKey,
  turn,
  sanitizeForRelay,
  payloadSoftLimitBytes,
}) {
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
    return null;
  }

  for (const maxItems of [16, 4, 1]) {
    for (const maxChars of [
      RELAY_HISTORY_TEXT_TAIL_LIMIT_CHARS,
      Math.floor(RELAY_HISTORY_TEXT_TAIL_LIMIT_CHARS / 4),
      1_000,
      0,
    ]) {
      const response = {
        id: requestId,
        result: {
          ...buildAdaptiveTurnsListResult({}, lastResult, turnsKey, [
            compactEmergencySingleTurnForRelay(turn, maxChars, maxItems),
          ]),
          remodexEmergencySingleTurnForRelay: true,
        },
      };
      if (measureSanitizedTurnsListResponseBytes(response, sanitizeForRelay) < payloadSoftLimitBytes) {
        return response;
      }
    }
  }

  return null;
}

function compactEmergencySingleTurnForRelay(turn, maxChars, maxItems) {
  const safeTurn = {};
  for (const key of [
    "id",
    "turnId",
    "turn_id",
    "threadId",
    "thread_id",
    "createdAt",
    "created_at",
    "completedAt",
    "completed_at",
    "status",
    "role",
    "kind",
  ]) {
    const value = turn[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safeTurn[key] = value;
    }
  }

  const items = Array.isArray(turn.items) ? turn.items : [];
  safeTurn.items = items.slice(-maxItems).map((item) => compactHistoryItemForRelay(item, maxChars));
  safeTurn.remodexEmergencySingleTurnForRelay = true;
  safeTurn.remodexPageCompactedForRelay = true;
  return safeTurn;
}

function buildAdaptiveTurnsListResult(firstResult, lastResult, turnsKey, turns) {
  const result = {};
  result[turnsKey] = turns;

  for (const key of RELAY_TURNS_LIST_PAGINATION_RESULT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(lastResult, key)) {
      result[key] = lastResult[key];
    } else {
      delete result[key];
    }
  }

  return result;
}

function readTurnsListNextCursor(result) {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  if (hasRelayCursor(result.nextCursor)) {
    return result.nextCursor;
  }
  if (hasRelayCursor(result.next_cursor)) {
    return result.next_cursor;
  }
  return undefined;
}

function hasRelayCursor(cursor) {
  return cursor !== undefined && cursor !== null && cursor !== "";
}

function jsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function measureSanitizedTurnsListResponseBytes(response, sanitizeForRelay) {
  try {
    const rawResponse = JSON.stringify(response);
    const sanitizedResponse = sanitizeForRelay(rawResponse, "thread/turns/list");
    return Buffer.byteLength(sanitizedResponse, "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

// Keeps app-server responses in the JSON-RPC shape that the App Store iOS client decodes.
function normalizeRelayBoundJsonRpcMessage(rawMessage, {
  pendingRequestMethodsById = null,
} = {}) {
  const parsed = parseBridgeJSON(rawMessage);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const hasMethod = typeof parsed.method === "string" && parsed.method.length > 0;
  const hasResponseId = parsed.id !== undefined && parsed.id !== null;
  const hasResult = Object.prototype.hasOwnProperty.call(parsed, "result");
  const hasError = Object.prototype.hasOwnProperty.call(parsed, "error");
  const hasPayload = Object.prototype.hasOwnProperty.call(parsed, "payload");
  if (hasResponseId && !hasMethod && !hasResult && !hasError && hasPayload) {
    const { payload, ...rest } = parsed;
    return JSON.stringify({
      ...rest,
      result: payload ?? null,
    });
  }

  if (hasResponseId && !hasMethod && hasResult && !hasError) {
    const unwrappedResult = unwrapAppServerPayloadResult(parsed.result);
    if (unwrappedResult !== parsed.result) {
      return JSON.stringify({
        ...parsed,
        result: unwrappedResult,
      });
    }
  }

  if (hasMethod && hasResponseId && !isRelayBoundServerRequestMethod(parsed.method)) {
    const trackedRequest = pendingRequestMethodsById?.get(String(parsed.id));
    const isTrackedResponse = trackedRequest?.method === parsed.method
      && (hasResult || hasError || hasPayload);
    if (isTrackedResponse) {
      const { method, payload, ...rest } = parsed;
      if (!hasResult && !hasError && hasPayload) {
        return JSON.stringify({
          ...rest,
          result: payload ?? null,
        });
      }
      if (hasResult && !hasError) {
        return JSON.stringify({
          ...rest,
          result: unwrapAppServerPayloadResult(rest.result),
        });
      }
      return JSON.stringify(rest);
    }

    return null;
  }

  if (!hasMethod && !hasResponseId) {
    return null;
  }

  return rawMessage;
}

function unwrapAppServerPayloadResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  if (!Object.prototype.hasOwnProperty.call(value, "payload")) {
    return value;
  }

  const payload = value.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return value;
  }

  const directPayloadKeys = [
    "data",
    "items",
    "threads",
    "turns",
    "thread",
  ];
  const hasDirectResultPayload = directPayloadKeys.some((key) => (
    Object.prototype.hasOwnProperty.call(payload, key)
  ));
  if (!hasDirectResultPayload) {
    return value;
  }

  return {
    ...value,
    ...payload,
  };
}

function isRelayBoundServerRequestMethod(method) {
  return method === "item/tool/requestUserInput"
    || method === "tool/requestUserInput"
    || method.endsWith("requestApproval");
}

// Shrinks thread history snapshots/pages for mobile relay delivery.
// This elides bulky blobs and replaces oversized older history with a compact marker.
function sanitizeThreadHistoryImagesForRelay(rawMessage, requestMethod) {
  if (requestMethod === "thread/turns/list") {
    return sanitizeThreadTurnsListForRelay(rawMessage);
  }

  if (requestMethod !== "thread/read" && requestMethod !== "thread/resume") {
    return rawMessage;
  }

  const parsed = parseBridgeJSON(rawMessage);
  const thread = parsed?.result?.thread;
  if (!thread || typeof thread !== "object" || !Array.isArray(thread.turns)) {
    return rawMessage;
  }

  const threadId = normalizeNonEmptyString(thread.id)
    || normalizeNonEmptyString(thread.threadId)
    || normalizeNonEmptyString(thread.thread_id);
  const { turns: sanitizedTurns, didSanitize } = sanitizeRelayHistoryTurns(thread.turns, threadId);

  if (!didSanitize) {
    const trimmedPayload = trimThreadPayloadForRelay(parsed, thread);
    return trimmedPayload == null ? rawMessage : trimmedPayload;
  }

  const sanitizedPayload = JSON.stringify({
    ...parsed,
    result: {
      ...parsed.result,
      thread: {
        ...thread,
        turns: sanitizedTurns,
      },
    },
  });

  return trimThreadPayloadForRelay(parseBridgeJSON(sanitizedPayload), null) ?? sanitizedPayload;
}

function sanitizeThreadTurnsListForRelay(rawMessage) {
  const parsed = parseBridgeJSON(rawMessage);
  const result = parsed?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return rawMessage;
  }

  const turnsKey = ["data", "items", "turns"].find((key) => Array.isArray(result[key]));
  if (!turnsKey) {
    return rawMessage;
  }

  const threadId = normalizeNonEmptyString(result.threadId)
    || normalizeNonEmptyString(result.thread_id)
    || normalizeNonEmptyString(result.thread?.id)
    || normalizeNonEmptyString(result.thread?.threadId)
    || normalizeNonEmptyString(result.thread?.thread_id);
  const { turns: sanitizedTurns, didSanitize } = sanitizeRelayHistoryTurns(result[turnsKey], threadId);
  const sanitizedParsed = didSanitize
    ? {
      ...parsed,
      result: {
        ...result,
        [turnsKey]: sanitizedTurns,
      },
    }
    : parsed;

  return trimTurnsListPayloadForRelay(sanitizedParsed, turnsKey, didSanitize ? null : rawMessage);
}

function sanitizeRelayHistoryTurns(turns, threadId = "") {
  let didSanitize = false;
  const sanitizedTurns = turns.map((turn) => {
    const sanitizedTurn = sanitizeRelayHistoryTurn(turn, threadId);
    if (sanitizedTurn !== turn) {
      didSanitize = true;
    }
    return sanitizedTurn;
  });

  return { turns: sanitizedTurns, didSanitize };
}

function sanitizeRelayHistoryTurn(turn, threadId = "") {
  if (!turn || typeof turn !== "object" || !Array.isArray(turn.items)) {
    return turn;
  }

  let turnDidChange = false;
  const turnThreadId = normalizeNonEmptyString(threadId)
    || normalizeNonEmptyString(turn.threadId)
    || normalizeNonEmptyString(turn.thread_id);
  const sanitizedItems = turn.items.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }

    let itemDidChange = false;
    let sanitizedItem = annotateImageGenerationHistoryItem(item, turnThreadId);
    if (sanitizedItem !== item) {
      itemDidChange = true;
    }

    if (Array.isArray(sanitizedItem.content)) {
      const sanitizedContent = sanitizedItem.content.map((contentItem) => {
        const sanitizedEntry = sanitizeInlineHistoryImageContentItem(contentItem);
        if (sanitizedEntry !== contentItem) {
          itemDidChange = true;
        }
        return sanitizedEntry;
      });

      if (itemDidChange) {
        sanitizedItem = {
          ...sanitizedItem,
          content: sanitizedContent,
        };
      }
    }

    const sanitizedCompactionItem = sanitizeCompactionHistoryItem(sanitizedItem);
    if (sanitizedCompactionItem !== sanitizedItem) {
      sanitizedItem = sanitizedCompactionItem;
      itemDidChange = true;
    }

    if (itemDidChange) {
      turnDidChange = true;
    }

    return itemDidChange ? sanitizedItem : item;
  });

  return turnDidChange
    ? {
      ...turn,
      items: sanitizedItems,
    }
    : turn;
}

// Annotates live image-generation notifications so the phone can render a local-file
// preview and does not receive the bulky inline base64 result over the relay.
function sanitizeLiveGeneratedImageMessageForRelay(rawMessage) {
  const parsed = parseBridgeJSON(rawMessage);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return rawMessage;
  }

  const params = parsed.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return rawMessage;
  }

  const sanitizedParams = sanitizeLiveGeneratedImageParams(params);
  if (sanitizedParams === params) {
    return rawMessage;
  }

  return JSON.stringify({
    ...parsed,
    params: sanitizedParams,
  });
}

function sanitizeLiveGeneratedImageParams(params) {
  const threadId = liveGeneratedImageThreadId(params);
  let nextParams = params;
  let didChange = false;

  const item = params.item;
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const sanitizedItem = annotateImageGenerationPayload(item, threadId);
    if (sanitizedItem !== item) {
      nextParams = { ...nextParams, item: sanitizedItem };
      didChange = true;
    }
  }

  const event = params.event;
  if (event && typeof event === "object" && !Array.isArray(event)) {
    const sanitizedEvent = sanitizeNestedGeneratedImagePayloads(event, threadId);
    if (sanitizedEvent !== event) {
      nextParams = { ...nextParams, event: sanitizedEvent };
      didChange = true;
    }
  }

  const sanitizedDirectParams = annotateImageGenerationPayload(nextParams, threadId);
  if (sanitizedDirectParams !== nextParams) {
    nextParams = sanitizedDirectParams;
    didChange = true;
  }

  return didChange ? nextParams : params;
}

function sanitizeNestedGeneratedImagePayloads(value, threadId) {
  let nextValue = annotateImageGenerationPayload(value, threadId);
  let didChange = nextValue !== value;

  for (const key of ["item", "payload", "data"]) {
    const nested = nextValue?.[key];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
      continue;
    }
    const sanitizedNested = sanitizeNestedGeneratedImagePayloads(nested, threadId);
    if (sanitizedNested !== nested) {
      if (!didChange) {
        nextValue = { ...nextValue };
        didChange = true;
      }
      nextValue[key] = sanitizedNested;
    }
  }

  return didChange ? nextValue : value;
}

// Drops huge replacement-history blobs from compaction items because the phone only needs
// the compacted marker itself, not the entire pre-compaction transcript snapshot.
function sanitizeCompactionHistoryItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return item;
  }

  let sanitizedItem = omitCompactionReplacementHistory(item);
  const payload = sanitizedItem.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const sanitizedPayload = omitCompactionReplacementHistory(payload);
    if (sanitizedPayload !== payload) {
      sanitizedItem = {
        ...sanitizedItem,
        payload: sanitizedPayload,
      };
    }
  }

  return sanitizedItem;
}

function omitCompactionReplacementHistory(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  let nextValue = value;
  let didChange = false;
  for (const key of ["replacement_history", "replacementHistory"]) {
    if (Object.prototype.hasOwnProperty.call(nextValue, key)) {
      if (!didChange) {
        nextValue = { ...nextValue };
        didChange = true;
      }
      delete nextValue[key];
    }
  }

  return didChange ? nextValue : value;
}

function annotateImageGenerationHistoryItem(item, threadId) {
  if (!item || typeof item !== "object") {
    return item;
  }

  const normalizedType = normalizeRelayHistoryContentType(item.type);
  if (!isGeneratedImageRelayType(normalizedType)) {
    return item;
  }

  return annotateImageGenerationPayload(item, threadId);
}

function annotateImageGenerationPayload(item, threadId) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return item;
  }

  const normalizedType = normalizeRelayHistoryContentType(item.type);
  if (!isGeneratedImageRelayType(normalizedType)) {
    return item;
  }

  let nextItem = item;
  let didChange = false;
  const existingPath = normalizeNonEmptyString(item.saved_path)
    || normalizeNonEmptyString(item.savedPath)
    || normalizeNonEmptyString(item.path)
    || normalizeNonEmptyString(item.file_path);
  const generatedPath = existingPath || generatedImagePathForHistoryItem(item, threadId);
  if (generatedPath && !existingPath) {
    nextItem = {
      ...nextItem,
      saved_path: generatedPath,
    };
    didChange = true;
  }

  if (typeof nextItem.result === "string" && nextItem.result.length > 0) {
    const {
      result: _result,
      ...withoutInlineResult
    } = nextItem;
    nextItem = {
      ...withoutInlineResult,
      result_elided_for_relay: true,
    };
    didChange = true;
  }

  return didChange ? nextItem : item;
}

function generatedImagePathForHistoryItem(item, threadId) {
  const resolvedThreadId = normalizeNonEmptyString(threadId);
  const normalizedType = normalizeRelayHistoryContentType(item.type);
  const callId = normalizedType === "imagegenerationend"
    ? normalizeNonEmptyString(item.call_id)
      || normalizeNonEmptyString(item.callId)
      || normalizeNonEmptyString(item.itemId)
      || normalizeNonEmptyString(item.item_id)
      || normalizeNonEmptyString(item.id)
    : normalizeNonEmptyString(item.id)
      || normalizeNonEmptyString(item.call_id)
      || normalizeNonEmptyString(item.callId)
      || normalizeNonEmptyString(item.itemId)
      || normalizeNonEmptyString(item.item_id);
  if (!resolvedThreadId || !callId) {
    return "";
  }

  return path.join(resolveCodexGeneratedImagesRoot(), resolvedThreadId, `${callId}.png`);
}

function isGeneratedImageRelayType(normalizedType) {
  return normalizedType === "imagegeneration"
    || normalizedType === "imagegenerationcall"
    || normalizedType === "imagegenerationend"
    || normalizedType === "imageview";
}

function liveGeneratedImageThreadId(params) {
  const event = params?.event && typeof params.event === "object" && !Array.isArray(params.event)
    ? params.event
    : null;
  const item = params?.item && typeof params.item === "object" && !Array.isArray(params.item)
    ? params.item
    : null;

  return normalizeNonEmptyString(params?.threadId)
    || normalizeNonEmptyString(params?.thread_id)
    || normalizeNonEmptyString(params?.conversationId)
    || normalizeNonEmptyString(params?.conversation_id)
    || normalizeNonEmptyString(event?.threadId)
    || normalizeNonEmptyString(event?.thread_id)
    || normalizeNonEmptyString(event?.conversationId)
    || normalizeNonEmptyString(event?.conversation_id)
    || normalizeNonEmptyString(item?.threadId)
    || normalizeNonEmptyString(item?.thread_id)
    || "";
}

// Converts `data:image/...` history content into a tiny placeholder the iPhone can render safely.
function sanitizeInlineHistoryImageContentItem(contentItem) {
  if (!contentItem || typeof contentItem !== "object") {
    return contentItem;
  }

  const normalizedType = normalizeRelayHistoryContentType(contentItem.type);
  if (!isRelayHistoryImageContentType(normalizedType)) {
    return contentItem;
  }

  const hasInlineUrl = hasInlineHistoryImageDataURL(contentItem.url)
    || hasInlineHistoryImageDataURL(contentItem.image_url)
    || hasInlineHistoryImageDataURL(contentItem.path);
  if (!hasInlineUrl) {
    return contentItem;
  }

  const {
    url: _url,
    image_url: _imageUrl,
    path: _path,
    ...rest
  } = contentItem;

  return {
    ...rest,
    url: RELAY_HISTORY_IMAGE_REFERENCE_URL,
  };
}

function normalizeRelayHistoryContentType(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[\s_-]+/g, "")
    : "";
}

// Covers Codex history variants such as image, local_image, and input_image.
function isRelayHistoryImageContentType(normalizedType) {
  return normalizedType === "image"
    || normalizedType === "localimage"
    || normalizedType === "inputimage"
    || normalizedType === "outputimage";
}

function hasInlineHistoryImageDataURL(value) {
  if (typeof value === "string") {
    return value.toLowerCase().startsWith("data:image");
  }

  if (Array.isArray(value)) {
    return value.some(hasInlineHistoryImageDataURL);
  }

  if (value && typeof value === "object") {
    return Object.values(value).some(hasInlineHistoryImageDataURL);
  }

  return false;
}

function parseBridgeJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function trimThreadPayloadForRelay(parsed, explicitThread = undefined) {
  const thread = explicitThread ?? parsed?.result?.thread;
  if (!parsed || !thread || typeof thread !== "object" || !Array.isArray(thread.turns)) {
    return null;
  }

  let workingThread = thread;
  let encoded = encodeRelayThreadPayload(parsed, workingThread);
  if (encoded == null) {
    return null;
  }

  if (Buffer.byteLength(encoded, "utf8") <= RELAY_THREAD_PAYLOAD_SOFT_LIMIT_BYTES) {
    return explicitThread === undefined ? null : encoded;
  }

  const turns = thread.turns;
  let trimmedTurns = turns.length > RELAY_HISTORY_RECENT_TURN_TARGET
    ? turns.slice(-RELAY_HISTORY_RECENT_TURN_TARGET)
    : turns.slice();
  while (trimmedTurns.length > 1) {
    if (trimmedTurns.length === turns.length) {
      trimmedTurns = trimmedTurns.slice(1);
    }
    const candidateThread = buildRelayHistoryCompactedThread(
      thread,
      buildRelayCompactedHistoryTurns(turns, trimmedTurns),
      Math.max(0, turns.length - trimmedTurns.length),
      trimmedTurns.length
    );
    encoded = encodeRelayThreadPayload(parsed, candidateThread);
    if (encoded != null && Buffer.byteLength(encoded, "utf8") <= RELAY_THREAD_PAYLOAD_SOFT_LIMIT_BYTES) {
      return encoded;
    }
    workingThread = candidateThread;
    trimmedTurns = trimmedTurns.slice(1);
  }

  const newestTurn = trimmedTurns[0];
  if (!newestTurn || typeof newestTurn !== "object" || !Array.isArray(newestTurn.items)) {
    return encodeRelayThreadPayload(parsed, workingThread);
  }

  let trimmedItems = newestTurn.items.slice();
  while (trimmedItems.length > 1) {
    trimmedItems = trimmedItems.slice(1);
    const compactedTurnPrefix = buildRelayHistoryCompactionTurn(
      Math.max(0, turns.length - 1),
      1,
      thread
    );
    const candidateThread = buildRelayHistoryCompactedThread(
      thread,
      compactedTurnPrefix ? [compactedTurnPrefix, {
        ...newestTurn,
        items: trimmedItems,
      }] : [{
        ...newestTurn,
        items: trimmedItems,
      }],
      Math.max(0, turns.length - 1),
      1
    );
    encoded = encodeRelayThreadPayload(parsed, candidateThread);
    if (encoded != null && Buffer.byteLength(encoded, "utf8") <= RELAY_THREAD_PAYLOAD_SOFT_LIMIT_BYTES) {
      return encoded;
    }
    workingThread = candidateThread;
  }

  const mostRecentItem = trimmedItems[0];
  if (!mostRecentItem || typeof mostRecentItem !== "object") {
    return encodeRelayThreadPayload(parsed, workingThread);
  }

  const truncatedItem = truncateHistoryItemTextForRelay(
    mostRecentItem,
    RELAY_HISTORY_TEXT_TAIL_LIMIT_CHARS
  );
  let candidateThread = buildRelayHistoryCompactedThread(
    thread,
    [
      ...buildRelayCompactedHistoryTurns(turns, [newestTurn]).slice(0, -1),
      {
        ...newestTurn,
        items: [truncatedItem],
      },
    ],
    Math.max(0, turns.length - 1),
    1
  );
  encoded = encodeRelayThreadPayload(parsed, candidateThread);
  if (encoded != null && Buffer.byteLength(encoded, "utf8") <= RELAY_THREAD_PAYLOAD_SOFT_LIMIT_BYTES) {
    return encoded;
  }

  candidateThread = buildRelayHistoryCompactedThread(
    thread,
    [
      ...buildRelayCompactedHistoryTurns(turns, [newestTurn]).slice(0, -1),
      {
        ...newestTurn,
        items: [compactHistoryItemForRelay(mostRecentItem, RELAY_HISTORY_TEXT_TAIL_LIMIT_CHARS)],
      },
    ],
    Math.max(0, turns.length - 1),
    1
  );
  return encodeRelayThreadPayload(parsed, candidateThread);
}

function trimTurnsListPayloadForRelay(parsed, turnsKey, originalRawMessage = null) {
  const result = parsed?.result;
  const turns = result?.[turnsKey];
  if (!parsed || !result || !Array.isArray(turns)) {
    return originalRawMessage ?? JSON.stringify(parsed);
  }

  const encoded = JSON.stringify(parsed);
  if (Buffer.byteLength(encoded, "utf8") <= RELAY_THREAD_PAYLOAD_SOFT_LIMIT_BYTES) {
    return originalRawMessage ?? encoded;
  }

  let fallbackCompactedPayload = null;
  for (const maxChars of [
    RELAY_HISTORY_TEXT_TAIL_LIMIT_CHARS,
    Math.floor(RELAY_HISTORY_TEXT_TAIL_LIMIT_CHARS / 4),
    1_000,
    0,
  ]) {
    const compactedTurns = turns.map((turn) => compactTurnsListTurnForRelay(turn, maxChars));
    const compactedPayload = JSON.stringify({
      ...parsed,
      result: {
        ...result,
        [turnsKey]: compactedTurns,
        remodexPageCompactedForRelay: true,
      },
    });
    fallbackCompactedPayload = compactedPayload;
    if (Buffer.byteLength(compactedPayload, "utf8") <= RELAY_THREAD_PAYLOAD_SOFT_LIMIT_BYTES) {
      return compactedPayload;
    }
  }

  return fallbackCompactedPayload ?? (originalRawMessage ?? encoded);
}

function compactTurnsListTurnForRelay(turn, maxChars) {
  if (!turn || typeof turn !== "object" || !Array.isArray(turn.items)) {
    return turn;
  }

  return {
    ...turn,
    items: turn.items.map((item) => compactHistoryItemForRelay(item, maxChars)),
    remodexPageCompactedForRelay: true,
  };
}

function buildRelayHistoryCompactedThread(thread, turns, omittedTurnCount, keptTurnCount) {
  return {
    ...thread,
    turns,
    historyTailTruncatedForRelay: true,
    remodexHistoryCompacted: omittedTurnCount > 0,
    remodexOmittedTurnCount: omittedTurnCount,
    remodexKeptTurnCount: keptTurnCount,
  };
}

function buildRelayCompactedHistoryTurns(allTurns, keptTurns) {
  const omittedTurnCount = Math.max(0, allTurns.length - keptTurns.length);
  const compactionTurn = buildRelayHistoryCompactionTurn(
    omittedTurnCount,
    keptTurns.length,
    allTurns[0]
  );
  return compactionTurn ? [compactionTurn, ...keptTurns] : keptTurns;
}

function buildRelayHistoryCompactionTurn(omittedTurnCount, keptTurnCount, idSource = {}) {
  if (omittedTurnCount <= 0) {
    return null;
  }

  const baseId = normalizeNonEmptyString(idSource?.id)
    || normalizeNonEmptyString(idSource?.turnId)
    || normalizeNonEmptyString(idSource?.turn_id)
    || "history";
  const text = [
    "Earlier conversation compacted for mobile loading.",
    "",
    `Older turns omitted: ${omittedTurnCount}`,
    `Recent turns kept: ${keptTurnCount}`,
    "Full history remains available on the Mac runtime.",
  ].join("\n");

  return {
    id: `remodex-history-compacted-${baseId}`,
    remodexSynthetic: true,
    remodexHistoryCompacted: true,
    remodexOmittedTurnCount: omittedTurnCount,
    remodexKeptTurnCount: keptTurnCount,
    items: [
      {
        id: `remodex-history-compacted-item-${baseId}`,
        type: "assistant_message",
        role: "assistant",
        text,
        remodexSynthetic: true,
        remodexHistoryCompacted: true,
      },
    ],
  };
}

function encodeRelayThreadPayload(parsed, thread) {
  try {
    return JSON.stringify({
      ...parsed,
      result: {
        ...parsed.result,
        thread,
      },
    });
  } catch {
    return null;
  }
}

function truncateHistoryItemTextForRelay(item, maxChars) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return item;
  }

  let didChange = false;
  let nextItem = item;
  const textKeys = ["text", "message", "summary", "output", "outputText", "output_text"];

  for (const key of textKeys) {
    if (typeof item[key] === "string" && item[key].length > maxChars) {
      nextItem = {
        ...nextItem,
        [key]: truncateRelayTextTail(item[key], maxChars),
      };
      didChange = true;
    }
  }

  if (Array.isArray(item.content)) {
    const nextContent = item.content.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return entry;
      }

      const truncatedEntry = truncateHistoryItemTextForRelay(entry, maxChars);
      if (truncatedEntry !== entry) {
        didChange = true;
      }
      return truncatedEntry;
    });

    if (didChange) {
      nextItem = {
        ...nextItem,
        content: nextContent,
      };
    }
  }

  return didChange
    ? {
      ...nextItem,
      relayTextTailTruncated: true,
    }
    : item;
}

function compactHistoryItemForRelay(item, maxChars) {
  const compactItem = {
    id: typeof item?.id === "string" ? item.id : undefined,
    type: typeof item?.type === "string" ? item.type : "relay_truncated_item",
    role: typeof item?.role === "string" ? item.role : undefined,
    itemId: typeof item?.itemId === "string" ? item.itemId : undefined,
    relayPayloadTruncated: true,
  };
  const tailText = maxChars > 0 ? firstRelayTextTail(item, maxChars) : "";
  if (tailText) {
    compactItem.text = tailText;
  }

  return Object.fromEntries(
    Object.entries(compactItem).filter(([, value]) => value !== undefined)
  );
}

function firstRelayTextTail(value, maxChars) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  for (const key of ["text", "message", "summary", "output", "outputText", "output_text"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return truncateRelayTextTail(value[key], maxChars);
    }
  }

  if (Array.isArray(value.content)) {
    for (const entry of value.content) {
      const tail = firstRelayTextTail(entry, maxChars);
      if (tail) {
        return tail;
      }
    }
  }

  return "";
}

function truncateRelayTextTail(value, maxChars) {
  if (typeof value !== "string" || value.length <= maxChars) {
    return value;
  }

  const tail = value.slice(-maxChars).trimStart();
  return `…\n${tail}`;
}

function persistBridgePreferences(
  {
    keepMacAwakeEnabled,
  },
  {
    readDaemonConfigImpl = readDaemonConfig,
    writeDaemonConfigImpl = writeDaemonConfig,
  } = {}
) {
  writeDaemonConfigImpl({
    ...(readDaemonConfigImpl() || {}),
    keepMacAwakeEnabled,
  });
}

module.exports = {
  buildHeartbeatBridgeStatus,
  createMacOSBridgeWakeAssertion,
  disableUnsupportedReasoningSummaryForTurnStart,
  fetchAdaptiveThreadTurnsListForRelay,
  hasRelayConnectionGoneStale,
  normalizeRelayBoundJsonRpcMessage,
  persistBridgePreferences,
  sanitizeLiveGeneratedImageMessageForRelay,
  sanitizeThreadHistoryImagesForRelay,
  startBridge,
};
