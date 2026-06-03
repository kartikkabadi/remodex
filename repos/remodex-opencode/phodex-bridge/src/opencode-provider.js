// FILE: opencode-provider.js
// Purpose: Adapts OpenCode SDK (opencode serve + @opencode-ai/sdk/v2) to Remodex
//          provider-aware thread/turn RPCs. Manages server lifecycle, session
//          mapping, event streaming, and permission bridging.
// Layer: Bridge runtime provider
// Exports: createOpenCodeProvider
// Depends on: ./opencode-server, ./opencode-client, ./opencode-models, ./provider-capabilities, ./thread-ownership-store

const { readString, resolvedParam } = require("./normalize");
const { createOpenCodeServer } = require("./opencode-server");
const { createOpenCodeClient } = require("./opencode-client");
const {
  DEFAULT_OPENCODE_MODEL,
  OPENCODE_PROVIDER_ID,
  appendNonEmpty,
  boundedPositiveInteger,
  buildPromptFromTurnInput,
  compareThreadsByUpdatedAt,
  messagesToTurns,
  normalizeOpenCodeModel,
  publicThread,
  readThreadId,
  removeUndefinedValues,
  textContent,
} = require("./opencode-models");
const { createThreadOwnershipStore } = require("./thread-ownership-store");
const { createOpenCodeSessionStore } = require("./opencode-session-store");
const {
  buildOpenCodeRuntimeStatus,
  isVersionBelowMinimum,
  OPENCODE_MIN_CLI_VERSION,
} = require("./opencode-runtime-status");
const { isOpenCodeHandoffEnabled } = require("./opencode-handoff");
const { parseOpenCodeModelSlug } = require("./opencode-model-slug");
const { resolveOpenCodeVariantForPrompt } = require("./opencode-variant-resolve");

const ERROR_CODES = {
  OPENCODE_NOT_INSTALLED: { errorCode: "opencode_not_installed", action: "show_install_instructions" },
  OPENCODE_SERVER_UNREACHABLE: { errorCode: "opencode_server_unreachable", action: "show_retry" },
  OPENCODE_MODEL_UNAVAILABLE: { errorCode: "opencode_model_unavailable", action: "pick_different_model" },
  OPENCODE_AGENT_UNAVAILABLE: { errorCode: "opencode_agent_unavailable", action: "pick_different_agent" },
  OPENCODE_SESSION_EXPIRED: { errorCode: "opencode_session_expired", action: "restart_thread" },
  OPENCODE_TURN_FAILED: { errorCode: "opencode_turn_failed", action: "show_retry" },
  OPENCODE_PERMISSION_TIMEOUT: { errorCode: "opencode_permission_timeout", action: "show_timeout" },
};

const HEALTH_RESTART_WINDOW_MS = 5 * 60 * 1000;
const HEALTH_MAX_RESTARTS = 3;
const HEALTH_IDLE_SHUTDOWN_MS = 10 * 60 * 1000;
const LIST_THREADS_SESSION_VALIDATE_CAP = 5;
const STARTUP_PRUNE_SESSION_VALIDATE_CAP = 20;
const OPENCODE_TURN_WATCHDOG_MS = 120 * 1000;

function assertOwnershipPersisted(ok, threadId) {
  if (ok) {
    return;
  }
  const error = new Error(`Failed to persist thread ownership for ${threadId}`);
  error.errorCode = "thread_ownership_persist_failed";
  throw error;
}

function createOpenCodeProvider({
  sendApplicationMessage,
  env = process.env,
  projectRegistry = null,
  ownershipStore = null,
  sessionStore = null,
  logPrefix = "[remodex]",
  serverFactory = null,
  clientFactory = null,
} = {}) {
  const server = serverFactory
    ? serverFactory({ env, logPrefix: `${logPrefix}:server` })
    : createOpenCodeServer({ env, logPrefix: `${logPrefix}:server` });
  const ownership = ownershipStore || createThreadOwnershipStore();
  const sessions = sessionStore || createOpenCodeSessionStore();

  let client = null;
  let healthy = false;
  let restartCount = 0;
  let restartWindowStart = 0;
  let lastActivityAt = 0;
  let idleTimer = null;
  let catalogUnavailable = null;
  let cachedAuthConfigured = null;
  let lastModelListMeta = null;
  let lastConnectedProviders = [];
  let lastListedModels = [];
  let lastCatalogAgents = [];
  let lastProviderInventory = [];
  let lastAuthDiscoveryReasonCode = "ok";
  let lastProviderInventoryPartial = false;

  const threads = new Map();
  const activeTurns = new Map();
  const inFlightThreadIds = new Set();
  const eventUnsubscribers = new Map();
  const completedTurnIds = new Set();
  const invalidSessionThreadIds = new Set();

  function removeOrphanOpenCodeThread(threadId, reason = "opencode_ownership_orphan_removed") {
    const removedOwnership = ownership.removeOwnership(threadId);
    const removedSession = sessions.remove(threadId);
    invalidSessionThreadIds.delete(threadId);
    if (removedOwnership || removedSession) {
      console.log(
        JSON.stringify({
          event: reason,
          threadId,
          removedOwnership: Boolean(removedOwnership),
          removedSession: Boolean(removedSession),
        }),
      );
    }
    return { removedOwnership: Boolean(removedOwnership), removedSession: Boolean(removedSession) };
  }

  function ownershipStubFromStore(threadId, storeEntry) {
    const updatedAt = readString(storeEntry?.updatedAt) || new Date().toISOString();
    return {
      id: threadId,
      title: readString(storeEntry?.title) || "OpenCode chat",
      name: readString(storeEntry?.title) || "OpenCode chat",
      model: normalizeOpenCodeModel(storeEntry?.model) || DEFAULT_OPENCODE_MODEL,
      modelProvider: OPENCODE_PROVIDER_ID,
      provider: OPENCODE_PROVIDER_ID,
      createdAt: updatedAt,
      updatedAt,
      archived: false,
    };
  }

  async function validateOwnedThreadSession(sessionId) {
    try {
      await client.getSession(sessionId);
      return true;
    } catch (error) {
      if (isInvalidOpenCodeSessionError(error)) {
        return false;
      }
      throw error;
    }
  }

  async function pruneOpenCodeStorageMismatch({
    maxSessionValidations = STARTUP_PRUNE_SESSION_VALIDATE_CAP,
  } = {}) {
    let ownershipWithoutSession = 0;
    let sessionWithoutOwnership = 0;
    let sdkValidations = 0;

    for (const { threadId } of ownership.getAllOwnedBy(OPENCODE_PROVIDER_ID)) {
      if (threads.has(threadId)) {
        continue;
      }
      if (!sessions.get(threadId)) {
        ownershipWithoutSession += 1;
        removeOrphanOpenCodeThread(threadId);
      }
    }

    for (const [threadId] of sessions.entries()) {
      if (threads.has(threadId)) {
        continue;
      }
      if (!ownership.ownsThread(threadId, OPENCODE_PROVIDER_ID)) {
        sessionWithoutOwnership += 1;
        sessions.remove(threadId);
        continue;
      }
      if (invalidSessionThreadIds.has(threadId)) {
        removeOrphanOpenCodeThread(threadId);
        continue;
      }
      if (sdkValidations >= maxSessionValidations) {
        continue;
      }
      const sessionId = sessions.get(threadId);
      if (!sessionId) {
        continue;
      }
      sdkValidations += 1;
      const valid = await validateOwnedThreadSession(sessionId);
      if (!valid) {
        invalidSessionThreadIds.add(threadId);
        removeOrphanOpenCodeThread(threadId);
      }
    }

    console.log(
      JSON.stringify({
        event: "opencode_storage_mismatch",
        ownership_without_session: ownershipWithoutSession,
        session_without_ownership: sessionWithoutOwnership,
        sdk_validations: sdkValidations,
      }),
    );
  }

  async function ensureStarted() {
    if (healthy && client) return;

    if (server.isRunning && !client) {
      client = clientFactory
        ? await clientFactory({ baseUrl: server.baseUrl, logPrefix: `${logPrefix}:sdk` })
        : await createOpenCodeClient({ baseUrl: server.baseUrl, logPrefix: `${logPrefix}:sdk` });
      healthy = true;
      await refreshAuthConfigured({ forceInventory: true });
      await restoreSessions();
      if (readString(env.REMODEX_PRUNE_OPENCODE_OWNERSHIP) === "1") {
        await pruneOpenCodeStorageMismatch();
      }
      return;
    }

    if (!healthy) {
      try {
        await startServer();
      } catch (error) {
        const enriched = new Error(catalogUnavailable?.message || "OpenCode is not available on this Mac.");
        enriched.errorCode =
          catalogUnavailable?.reasonCode === "opencode_not_installed"
            ? ERROR_CODES.OPENCODE_NOT_INSTALLED.errorCode
            : ERROR_CODES.OPENCODE_SERVER_UNREACHABLE.errorCode;
        enriched.action =
          catalogUnavailable?.reasonCode === "opencode_not_installed"
            ? ERROR_CODES.OPENCODE_NOT_INSTALLED.action
            : ERROR_CODES.OPENCODE_SERVER_UNREACHABLE.action;
        enriched.reasonCode = catalogUnavailable?.reasonCode || enriched.errorCode;
        throw enriched;
      }
    }
  }

  async function startServer() {
    if (Date.now() - restartWindowStart > HEALTH_RESTART_WINDOW_MS) {
      restartCount = 0;
      restartWindowStart = Date.now();
    }

    if (restartCount >= HEALTH_MAX_RESTARTS) {
      catalogUnavailable = {
        unavailableReason:
          "OpenCode server could not stay running on this Mac. Check OpenCode logs.",
        reasonCode: "opencode_server_failed",
      };
      throw new Error(catalogUnavailable.unavailableReason);
    }

    restartCount++;
    console.log(
      `${logPrefix} Starting OpenCode server (attempt ${restartCount}/${HEALTH_MAX_RESTARTS})...`,
    );

    try {
      await server.start();
    } catch (error) {
      const failure = server.getLastStartFailure?.() || null;
      const reasonCode =
        readString(error?.reasonCode) ||
        readString(failure?.reasonCode) ||
        "opencode_server_failed";
      catalogUnavailable = {
        unavailableReason:
          readString(failure?.message) ||
          readString(error?.message) ||
          "OpenCode is not available on this Mac.",
        reasonCode,
      };
      throw error;
    }

    catalogUnavailable = null;
    client = clientFactory
      ? await clientFactory({ baseUrl: server.baseUrl, logPrefix: `${logPrefix}:sdk` })
      : await createOpenCodeClient({ baseUrl: server.baseUrl, logPrefix: `${logPrefix}:sdk` });
    healthy = true;
    await refreshAuthConfigured({ forceInventory: true });
    await restoreSessions();
    if (readString(env.REMODEX_PRUNE_OPENCODE_OWNERSHIP) === "1") {
      await pruneOpenCodeStorageMismatch();
    }

    resetIdleTimer();
  }

  async function refreshAuthConfigured({ forceInventory = false } = {}) {
    if (!client) {
      cachedAuthConfigured = null;
      lastModelListMeta = null;
      lastConnectedProviders = [];
      return;
    }
    if (typeof client.listProviderInventory === "function") {
      try {
        const result = await client.listProviderInventory({ force: forceInventory });
        const connectedIds = result?.meta?.connectedProviderIds || [];
        lastModelListMeta = result?.meta || null;
        lastConnectedProviders = result?.connectedProviders || [];
        if (Array.isArray(connectedIds) && connectedIds.length > 0) {
          cachedAuthConfigured = true;
          return;
        }
        if (result?.meta?.reasonCode === "no_connected_providers") {
          cachedAuthConfigured = false;
          return;
        }
        if (result?.meta?.reasonCode === "provider_list_failed") {
          cachedAuthConfigured = null;
          return;
        }
        if (result?.meta?.reasonCode === "unknown") {
          cachedAuthConfigured = null;
          return;
        }
        cachedAuthConfigured = false;
        return;
      } catch {
        cachedAuthConfigured = null;
        return;
      }
    }
    if (typeof client.probeConnectedProviders === "function") {
      const connected = await client.probeConnectedProviders();
      if (connected === true) {
        cachedAuthConfigured = true;
        return;
      }
      if (connected === false) {
        cachedAuthConfigured = false;
      }
    }
  }

  function persistSessionRecord(thread) {
    if (!thread?.id || !thread.sessionId) return;
    sessions.set(thread.id, thread.sessionId, {
      cwd: thread.cwd,
      model: thread.model,
      agent: thread.agent,
      title: thread.title,
    });
  }

  async function rehydrateThreadIfNeeded(threadId) {
    const normalizedThreadId = readThreadId({ threadId });
    if (!normalizedThreadId) {
      throw threadNotFoundError(threadId);
    }

    const existing = threads.get(normalizedThreadId);
    if (existing) {
      return existing;
    }

    if (!ownership.ownsThread(normalizedThreadId, OPENCODE_PROVIDER_ID)) {
      throw threadNotFoundError(normalizedThreadId);
    }

    const storeEntry = sessions.getEntry(normalizedThreadId);
    const sessionId = storeEntry?.sessionId || sessions.get(normalizedThreadId);
    if (!sessionId) {
      throw threadNotFoundError(normalizedThreadId);
    }

    await ensureStarted();

    let sdkSession = null;
    try {
      sdkSession = await client.getSession(sessionId);
    } catch (error) {
      if (!isInvalidOpenCodeSessionError(error)) {
        throw error;
      }
      sessions.remove(normalizedThreadId);
      ownership.removeOwnership(normalizedThreadId);
      invalidSessionThreadIds.add(normalizedThreadId);
      throw createOpenCodeSessionExpiredError(normalizedThreadId);
    }

    const now = new Date().toISOString();
    const cwd =
      readString(storeEntry?.cwd) ||
      readString(sdkSession?.directory) ||
      readString(sdkSession?.cwd) ||
      process.cwd();
    const thread = {
      id: normalizedThreadId,
      title: readString(storeEntry?.title) || "OpenCode chat",
      cwd,
      model: normalizeOpenCodeModel(storeEntry?.model || sdkSession?.model),
      agent: readString(storeEntry?.agent) || "build",
      createdAt: readString(storeEntry?.updatedAt) || now,
      updatedAt: now,
      archived: false,
      hasProjectCwd: Boolean(readString(storeEntry?.cwd)),
      turns: [],
      sessionId,
    };

    try {
      const messages = await client.getMessages(sessionId);
      if (messages && messages.length > 0) {
        thread.turns = messagesToTurns(messages, normalizedThreadId);
      }
    } catch {
      // In-memory turns stay empty; thread/read still succeeds.
    }

    threads.set(normalizedThreadId, thread);
    persistSessionRecord(thread);
    rememberThreadProject(thread, "opencode-rehydrate");
    return thread;
  }

  async function requireThread(threadId) {
    const normalizedThreadId = readThreadId({ threadId });
    const existing = threads.get(normalizedThreadId);
    if (existing) {
      return existing;
    }
    return rehydrateThreadIfNeeded(normalizedThreadId);
  }

  function ownsThread(threadId) {
    const normalized = readString(threadId);
    return ownership.ownsThread(normalized, OPENCODE_PROVIDER_ID) || threads.has(normalized);
  }

  function syncAuthAndMetaFromListResult(result) {
    if (!result || typeof result !== "object") {
      return;
    }
    if (result.meta && typeof result.meta === "object") {
      lastModelListMeta = result.meta;
    }
    if (Array.isArray(result.connectedProviders)) {
      lastConnectedProviders = result.connectedProviders;
    }

    const meta = result.meta || {};
    const reasonCode = readString(meta.reasonCode);
    const connectedIds = Array.isArray(meta.connectedProviderIds) ? meta.connectedProviderIds : [];
    const modelCount = Array.isArray(result.models) ? result.models.length : 0;

    if (reasonCode === "provider_list_failed" || reasonCode === "unknown") {
      cachedAuthConfigured = null;
      return;
    }
    if (reasonCode === "no_connected_providers") {
      cachedAuthConfigured = false;
      return;
    }
    if (reasonCode === "ok" && modelCount > 0) {
      cachedAuthConfigured = true;
      return;
    }
    if (connectedIds.length > 0 && modelCount === 0) {
      cachedAuthConfigured = null;
      return;
    }
    cachedAuthConfigured = false;
  }

  async function resolveAuthCredentialBundle() {
    const { readAuthProviderIds } = require("./opencode-auth-providers");
    const fromFile = readAuthProviderIds();
    let ids = fromFile.ids;
    let authDiscoveryReasonCode = fromFile.authDiscoveryReasonCode;
    let providerInventoryPartial = false;

    if (fromFile.authDiscoveryReasonCode !== "ok" || ids.length === 0) {
      try {
        await ensureStarted();
        const probeIds =
          typeof client.listAuthProviderIds === "function"
            ? await client.listAuthProviderIds()
            : [];
        if (probeIds.length > 0) {
          ids = probeIds;
          if (fromFile.authDiscoveryReasonCode !== "ok") {
            authDiscoveryReasonCode = "auth_probe_ok";
          }
        } else if (fromFile.authDiscoveryReasonCode !== "ok") {
          providerInventoryPartial = true;
        }
      } catch {
        if (fromFile.authDiscoveryReasonCode !== "ok") {
          providerInventoryPartial = true;
        }
      }
    }

    return { ids, authDiscoveryReasonCode, providerInventoryPartial };
  }

  async function listModels(options = {}) {
    try {
      await ensureStarted();
    } catch {
      return {
        models: [],
        meta: {
          reasonCode: "provider_list_failed",
          connectedProviderIds: [],
          fetchedAt: new Date().toISOString(),
          stale: false,
          modelCountBeforeCap: 0,
          modelCountAfterCap: 0,
        },
      };
    }
    const force = options.force === true || options.refreshProviders === true;
    const authBundle = await resolveAuthCredentialBundle();
    const result = await client.listModels({
      force,
      credentialProviderIDs: authBundle.ids,
      authDiscoveryReasonCode: authBundle.authDiscoveryReasonCode,
    });
    if (result && typeof result === "object" && Array.isArray(result.models)) {
      syncAuthAndMetaFromListResult(result);
      lastListedModels = result.models;
      if (Array.isArray(result.providerInventory)) {
        lastProviderInventory = result.providerInventory;
      }
      if (Array.isArray(result.connectedProviders)) {
        lastConnectedProviders = result.connectedProviders;
      }
      lastAuthDiscoveryReasonCode = readString(result.authDiscoveryReasonCode) || authBundle.authDiscoveryReasonCode;
      lastProviderInventoryPartial =
        result.providerInventoryPartial === true || authBundle.providerInventoryPartial;
      return result;
    }
    const models = Array.isArray(result) ? result : [];
    lastListedModels = models;
    return {
      models,
      meta: lastModelListMeta || {
        reasonCode: models.length > 0 ? "ok" : "unknown",
        connectedProviderIds: [],
        fetchedAt: new Date().toISOString(),
        stale: false,
        modelCountBeforeCap: models.length,
        modelCountAfterCap: models.length,
      },
    };
  }

  // Starts opencode serve in the background so the first model/list is not capped out.
  async function warmup() {
    try {
      await ensureStarted();
      console.log(`${logPrefix} OpenCode warmup complete`);
    } catch (error) {
      console.warn(
        `${logPrefix} OpenCode warmup failed: ${(error && error.message) || error}`,
      );
    }
  }

  async function listAgents() {
    try {
      await ensureStarted();
    } catch {
      return [];
    }
    const agents = await client.listAgents();
    rememberCatalogAgents(agents);
    return agents;
  }

  async function listCommands(directory) {
    try {
      await ensureStarted();
    } catch {
      return [];
    }
    return client.listCommands(directory);
  }

  async function listSkills(directory) {
    try {
      await ensureStarted();
    } catch {
      return [];
    }
    return client.listSkills(directory);
  }

  async function listThreads(params = {}) {
    const limit = boundedPositiveInteger(params.limit, 50);
    const includeArchived = params.includeArchived === true || params.include_archived === true;
    const includeFullRehydrate =
      params.includeFullRehydrate === true || params.include_full_rehydrate === true;

    let removedOrphanOwnership = 0;
    let removedOrphanSession = 0;
    let sdkValidations = 0;
    const sdkCap = LIST_THREADS_SESSION_VALIDATE_CAP;

    const localThreads = Array.from(threads.values())
      .filter((thread) => includeArchived || !thread.archived)
      .map((thread) => publicThread(thread));

    const ownedStubs = [];
    const canValidateSessions = healthy && client;

    try {
      const ownedThreads = ownership.getAllOwnedBy(OPENCODE_PROVIDER_ID);
      for (const entry of ownedThreads) {
        const threadId = entry.threadId;
        const live = threads.get(threadId);
        if (live) {
          if (!includeArchived && live.archived) {
            continue;
          }
          continue;
        }

        const storeEntry = sessions.getEntry(threadId);
        const sessionId = readString(storeEntry?.sessionId) || sessions.get(threadId);
        if (!sessionId) {
          const removed = removeOrphanOpenCodeThread(threadId);
          if (removed.removedOwnership) {
            removedOrphanOwnership += 1;
          }
          if (removed.removedSession) {
            removedOrphanSession += 1;
          }
          continue;
        }

        if (invalidSessionThreadIds.has(threadId)) {
          const removed = removeOrphanOpenCodeThread(threadId);
          if (removed.removedOwnership) {
            removedOrphanOwnership += 1;
          }
          if (removed.removedSession) {
            removedOrphanSession += 1;
          }
          continue;
        }

        let includeStub = false;
        if (canValidateSessions && sdkValidations < sdkCap) {
          sdkValidations += 1;
          try {
            const valid = await validateOwnedThreadSession(sessionId);
            if (!valid) {
              invalidSessionThreadIds.add(threadId);
              const removed = removeOrphanOpenCodeThread(threadId);
              if (removed.removedOwnership) {
                removedOrphanOwnership += 1;
              }
              if (removed.removedSession) {
                removedOrphanSession += 1;
              }
              continue;
            }
            includeStub = true;
          } catch (error) {
            console.log(
              JSON.stringify({
                event: "opencode_list_threads_validation_error",
                threadId,
                message: readString(error?.message) || "OpenCode session validation failed",
              }),
            );
            continue;
          }
        } else if (includeFullRehydrate && canValidateSessions) {
          try {
            const thread = await rehydrateThreadIfNeeded(threadId);
            ownedStubs.push(publicThread(thread));
          } catch {
            // Skip rows that cannot be rehydrated.
          }
          continue;
        } else {
          for (const active of activeTurns.values()) {
            if (active.thread.id === threadId) {
              includeStub = true;
              break;
            }
          }
        }

        if (includeStub) {
          ownedStubs.push(ownershipStubFromStore(threadId, storeEntry));
        }
      }
    } catch {
      // Return in-memory threads when ownership or OpenCode is unavailable.
    }

    console.log(
      JSON.stringify({
        event: "opencode_list_threads_filtered",
        ownership: ownership.getAllOwnedBy(OPENCODE_PROVIDER_ID).length,
        listed: localThreads.length + ownedStubs.length,
        removed_orphan_ownership: removedOrphanOwnership,
        removed_orphan_session: removedOrphanSession,
        sdk_validations: sdkValidations,
        sdk_validations_cap: sdkCap,
      }),
    );

    const seen = new Set();
    const data = [...localThreads, ...ownedStubs]
      .filter((thread) => {
        if (!thread?.id || seen.has(thread.id)) return false;
        seen.add(thread.id);
        return true;
      })
      .toSorted(compareThreadsByUpdatedAt)
      .slice(0, limit);

    return { data, nextCursor: null };
  }

  async function handleRequest(request) {
    const method = readString(request?.method);
    switch (method) {
      case "thread/start":
        return threadStart(request);
      case "thread/resume":
      case "thread/read":
        return threadRead(request);
      case "thread/turns/list":
        return threadTurnsList(request);
      case "thread/name/set":
        return threadNameSet(request);
      case "thread/archive":
        return threadArchive(request, true);
      case "thread/unarchive":
        return threadArchive(request, false);
      case "thread/fork":
        return threadFork(request);
      case "turn/start":
        return turnStart(request);
      case "turn/interrupt":
        return turnInterrupt(request);
      case "permission/reply":
        return permissionReply(request);
      default:
        throw unsupportedMethodError(method);
    }
  }

  function handleApplicationResponse() {
    return false;
  }

  async function shutdown() {
    stopIdleTimer();
    for (const [, unsubscribe] of eventUnsubscribers) {
      unsubscribe();
    }
    eventUnsubscribers.clear();
    activeTurns.clear();
    inFlightThreadIds.clear();
    completedTurnIds.clear();
    await server.stop();
    client = null;
    healthy = false;
  }

  async function threadStart(request) {
    const params = request.params || {};
    const now = new Date().toISOString();
    const requestedCwd = resolvedParam(params, 'cwd', 'current_working_directory', 'working_directory');
    const threadId = `${OPENCODE_PROVIDER_ID}-thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resolvedSessionId = resolvedParam(params, 'sessionId', 'session_id');
    const thread = {
      id: threadId,
      title: readString(params.title) || "OpenCode chat",
      cwd: requestedCwd || process.cwd(),
      model: normalizeOpenCodeModel(params.model),
      agent: readString(params.agent) || "build",
      createdAt: now,
      updatedAt: now,
      archived: false,
      hasProjectCwd: Boolean(requestedCwd),
      turns: [],
      sessionId: resolvedSessionId || "",
    };
    threads.set(threadId, thread);
    assertOwnershipPersisted(
      ownership.setOwnership(threadId, OPENCODE_PROVIDER_ID),
      threadId,
    );
    if (resolvedSessionId) {
      thread.sessionId = resolvedSessionId;
      persistSessionRecord(thread);
    }
    rememberThreadProject(thread, "opencode-thread-start");
    return { thread: publicThread(thread) };
  }

  async function threadRead(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const thread = await requireThread(threadId);

    rememberThreadProject(thread, "opencode-thread-read");
    const responseThread = { ...publicThread(thread) };
    if (params.includeTurns === true || params.include_turns === true) {
      responseThread.turns = thread.turns || [];
    }
    return { thread: responseThread };
  }

  async function threadTurnsList(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const thread = await requireThread(threadId);

    const limit = boundedPositiveInteger(params.limit, 50);
    const sortDirection = resolvedParam(params, 'sortDirection', 'sort_direction') || "desc";
    const turns = [...(thread.turns || [])];
    if (sortDirection === "asc") turns.reverse();

    // Try SDK messages if session exists
    if (thread.sessionId) {
      try {
        await ensureStarted();
        const messages = await client.getMessages(thread.sessionId);
        if (messages && messages.length > 0) {
          const sdkTurns = messagesToTurns(messages, threadId);
          return { data: sdkTurns.slice(0, limit), nextCursor: null };
        }
      } catch {
        // Fall through to in-memory turns
      }
    }

    return { data: turns.slice(0, limit), nextCursor: null };
  }

  async function turnStart(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const thread = await requireThread(threadId);

    for (const [, active] of activeTurns) {
      if (active.thread.id === threadId) throw activeTurnError(threadId);
    }
    if (inFlightThreadIds.has(threadId)) {
      throw activeTurnError(threadId);
    }

    const model = normalizeOpenCodeModel(params.model || thread.model);
    const { inputText, prompt, parts } = buildPromptFromTurnInput(params.input);
    if (!prompt && (!Array.isArray(parts) || parts.length === 0)) {
      const error = new Error("OpenCode turn/start requires text input.");
      error.errorCode = "opencode_input_required";
      throw error;
    }

    thread.model = model;
    thread.agent = resolvedParam(params, 'agent', 'mode') || thread.agent || "build";
    thread.updatedAt = new Date().toISOString();

    const turnId = `${OPENCODE_PROVIDER_ID}-turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const effort = resolvedParam(params, 'reasoningEffort', 'reasoning_effort', 'effort');
    const now = new Date().toISOString();
    const assistantItemId = `${OPENCODE_PROVIDER_ID}-agent-${turnId}`;

    const turn = {
      id: turnId,
      model,
      status: "running",
      createdAt: now,
      items: [
        {
          id: `${OPENCODE_PROVIDER_ID}-user-${turnId}`,
          type: "userMessage",
          role: "user",
          text: inputText,
          content: textContent(inputText),
          createdAt: now,
        },
        {
          id: assistantItemId,
          type: "agentMessage",
          role: "assistant",
          phase: "final",
          text: "",
          content: textContent(""),
          createdAt: now,
        },
      ],
      metadata: { threadId, provider: OPENCODE_PROVIDER_ID },
    };
    thread.turns.push(turn);

    const active = {
      agent: thread.agent,
      assistantItemId,
      effort,
      sessionId: "",
      thread,
      turn,
      started: false,
      completed: false,
    };
    activeTurns.set(turnId, active);
    assertOwnershipPersisted(
      ownership.setOwnership(thread.id, OPENCODE_PROVIDER_ID),
      thread.id,
    );

    emit("turn/started", { threadId: thread.id, turnId, turn: { id: turnId, status: "running" } });

    setImmediate(() => executeTurn(active, model, thread.agent, effort, prompt, parts, thread.cwd));
    return { turnId, turn: { id: turnId, threadId: thread.id, status: "running" } };
  }

  async function executeTurn(active, model, agent, effort, prompt, parts, cwd) {
    const threadId = active.thread.id;
    inFlightThreadIds.add(threadId);
    try {
      await ensureStarted();

      if (!active.thread.sessionId) {
        const sessionId = await client.createSession({ cwd });
        if (!readString(sessionId)) {
          const error = new Error(
            "OpenCode createSession returned no session id; cannot persist session or send prompt.",
          );
          error.errorCode = ERROR_CODES.OPENCODE_TURN_FAILED.errorCode;
          error.action = ERROR_CODES.OPENCODE_TURN_FAILED.action;
          throw error;
        }
        active.sessionId = sessionId;
        active.thread.sessionId = sessionId;
        persistSessionRecord(active.thread);
      } else {
        active.sessionId = active.thread.sessionId;
      }

      if (!readString(active.sessionId)) {
        const error = new Error(
          "OpenCode turn requires a session id before prompt; session id is missing.",
        );
        error.errorCode = ERROR_CODES.OPENCODE_TURN_FAILED.errorCode;
        error.action = ERROR_CODES.OPENCODE_TURN_FAILED.action;
        throw error;
      }

      const clearWatchdog = () => {
        if (active.watchdogTimer) {
          clearTimeout(active.watchdogTimer);
          active.watchdogTimer = null;
        }
      };

      const scheduleWatchdog = () => {
        clearWatchdog();
        active.watchdogTimer = setTimeout(() => {
          if (!active.completed) {
            completeTurn({
              status: "failed",
              errorMessage: "OpenCode turn timed out waiting for completion.",
              errorCode: "opencode_turn_watchdog_timeout",
              active,
              source: "watchdog",
            });
          }
        }, OPENCODE_TURN_WATCHDOG_MS);
        if (readString(process.env.REMODEX_TEST) === "1" && typeof active.watchdogTimer?.unref === "function") {
          active.watchdogTimer.unref();
        }
      };

      const unsubscribe = client.subscribeToEvents((method, params) => {
        if (active.completed) return;

        const eventTurnId = readString(params.turnId || params.turnID);
        if (method === "turn/completed" && completedTurnIds.has(active.turn.id)) {
          return;
        }

        console.log(
          JSON.stringify({
            event: "opencode_turn_event",
            sseType: method,
            threadId: active.thread.id,
            turnId: active.turn.id,
            hasTurnId: Boolean(eventTurnId),
          }),
        );

        const enriched = {
          ...params,
          threadId: active.thread.id,
          turnId: active.turn.id,
        };

        if (method === "item/agentMessage/delta") {
          const assistantItem = active.turn.items.find((item) => item.type === "agentMessage");
          if (assistantItem) {
            assistantItem.text += readString(params.delta || "");
          }
        }

        if (method === "turn/failed") {
          if (eventTurnId && eventTurnId !== active.turn.id) {
            return;
          }
          completeTurn({
            status: "failed",
            errorMessage: readString(params.message) || "OpenCode session error",
            active,
            source: "turn_failed",
          });
          clearWatchdog();
          return;
        }

        if (method === "turn/completed") {
          if (eventTurnId && eventTurnId !== active.turn.id) {
            return;
          }
          completeTurn({
            status: readString(params.status) || "completed",
            active,
            source: "turn_completed",
          });
          clearWatchdog();
          return;
        }

        emit(method, enriched);
      });
      eventUnsubscribers.set(active.turn.id, unsubscribe);

      const parsedModel = parseOpenCodeModelSlug(model);
      const catalogModel = lastListedModels.find(
        (entry) => readString(entry.id || entry.model) === readString(model),
      );
      const { variant, omittedReason } = resolveOpenCodeVariantForPrompt({
        effort,
        modelRecord: catalogModel?.serveVariants
          ? { variants: catalogModel.serveVariants }
          : null,
      });
      if (omittedReason) {
        console.log(
          JSON.stringify({
            event: "opencode_turn_prompt",
            variant_omitted_reason: omittedReason,
            effort: readString(effort) || null,
          }),
        );
      }

      if (active.completed) {
        return;
      }

      scheduleWatchdog();

      await client.prompt({
        sessionID: active.sessionId,
        prompt,
        parts,
        cwd,
        model: parsedModel || model,
        agent,
        variant,
        threadId: active.thread.id,
        turnId: active.turn.id,
      });
      if (active.completed) {
        return;
      }
      active.started = true;
      try {
        const messages = await client.getMessages(active.sessionId);
        const hasAssistantText =
          Array.isArray(messages) &&
          messages.some((message) => {
            const role = readString(message?.role).toLowerCase();
            const text = readString(message?.text || message?.content);
            return text.length > 0 && (role === "assistant" || role === "");
          });
        if (hasAssistantText) {
          completeTurn({ status: "completed", active, source: "prompt_return_messages" });
        }
      } catch {
        // Watchdog armed before prompt() covers hung prompt and getMessages failures.
      }
    } catch (error) {
      if (!active.completed) {
        completeTurn({
          errorMessage: error?.message || "OpenCode SDK turn failed.",
          errorCode: error?.errorCode || ERROR_CODES.OPENCODE_TURN_FAILED.errorCode,
          action: error?.action || ERROR_CODES.OPENCODE_TURN_FAILED.action,
          status: "failed",
          active,
        });
      }
    } finally {
      inFlightThreadIds.delete(threadId);
    }
  }

  function completeTurn({
    errorMessage = "",
    errorCode = "",
    action = "",
    status,
    active,
    source = "",
  }) {
    const turnId = active.turn.id;
    if (active.completed || completedTurnIds.has(turnId)) return false;
    active.completed = true;
    completedTurnIds.add(turnId);

    if (active.watchdogTimer) {
      clearTimeout(active.watchdogTimer);
      active.watchdogTimer = null;
    }

    const unsubscribe = eventUnsubscribers.get(turnId);
    if (unsubscribe) {
      unsubscribe();
      eventUnsubscribers.delete(turnId);
    }

    activeTurns.delete(turnId);
    active.thread.updatedAt = new Date().toISOString();
    active.turn.status = status;
    active.turn.completedAt = active.thread.updatedAt;

    if (errorMessage) {
      active.turn.error = { message: errorMessage, errorCode: errorCode || null, action: action || null };
    }

    const assistantItem = active.turn.items.find((item) => item.type === "agentMessage");
    if (assistantItem && assistantItem.text) {
      emit("item/completed", {
        threadId: active.thread.id,
        turnId,
        itemId: assistantItem.id,
        message: assistantItem.text,
        assistantPhase: "final_answer",
        item: {
          id: assistantItem.id,
          turnId,
          type: "agentMessage",
          phase: "final",
          text: assistantItem.text,
        },
      });
    }

    emit("turn/completed", {
      threadId: active.thread.id,
      turnId,
      model: active.thread.model,
      status,
      turn: { id: turnId, status, error: errorMessage ? { message: errorMessage } : undefined },
    });

    const completionEvent = status === "failed" ? "opencode_turn_failed" : "opencode_turn_completed";
    console.log(
      JSON.stringify({
        event: completionEvent,
        threadId: active.thread.id,
        turnId,
        status,
        source: readString(source) || null,
        assistantLen: readString(assistantItem?.text).length,
        ...(errorMessage
          ? { message: errorMessage, errorCode: errorCode || null }
          : {}),
      }),
    );

    resetIdleTimer();
    return true;
  }

  async function permissionReply(request) {
    const params = request.params || {};
    const permissionId = readString(
      params.permissionId || params.permission_id || params.requestId,
    );
    const allow = params.allow === true || params.approved === true || params.accept === true;
    if (!permissionId) {
      return { success: false, reason: "Missing permission ID" };
    }
    try {
      await ensureStarted();
      await client.replyToPermission(permissionId, allow);
      return { success: true, permissionId, allow };
    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  async function turnInterrupt(request) {
    const params = request.params || {};
    const turnId = readString(params.turnId || params.turn_id);
    const threadId = readThreadId(params);
    const resolvedTurnId = turnId || findActiveTurnByThread(threadId);
    const active = activeTurns.get(resolvedTurnId);
    if (!active) return { success: true, interrupted: false };

    try {
      if (readString(active.sessionId)) {
        await ensureStarted();
        await client.abort(active.sessionId);
      }
    } catch {
      // Best effort
    }

    completeTurn({ status: "stopped", active });
    return { success: true, interrupted: true };
  }

  function findActiveTurnByThread(threadId) {
    for (const [turnId, active] of activeTurns) {
      if (active.thread.id === threadId) return turnId;
    }
    return "";
  }

  async function threadNameSet(request) {
    const params = request.params || {};
    const thread = await requireThread(readThreadId(params));

    const name = resolvedParam(params, 'name', 'title');
    if (name) {
      thread.title = name;
      thread.updatedAt = new Date().toISOString();
      persistSessionRecord(thread);
    }

    const publicValue = publicThread(thread);
    emit("thread/name/updated", {
      threadId: publicValue.id,
      thread_id: publicValue.id,
      name: publicValue.name,
      title: publicValue.title,
    });
    return { thread: publicValue };
  }

  async function threadArchive(request, archived) {
    const threadId = readThreadId(request.params);
    const inMemory = threads.get(threadId);
    if (inMemory) {
      inMemory.archived = archived;
      inMemory.updatedAt = new Date().toISOString();
      persistSessionRecord(inMemory);
      return { thread: publicThread(inMemory) };
    }

    if (!ownership.ownsThread(threadId, OPENCODE_PROVIDER_ID)) {
      throw threadNotFoundError(threadId);
    }

    if (archived) {
      removeOrphanOpenCodeThread(threadId, "opencode_thread_archived_stub_removed");
      return {
        thread: {
          id: threadId,
          title: "OpenCode chat",
          archived: true,
          provider: OPENCODE_PROVIDER_ID,
          modelProvider: OPENCODE_PROVIDER_ID,
        },
      };
    }

    throw threadNotFoundError(threadId);
  }

  async function threadFork(request) {
    const params = request.params || {};
    const threadId = readThreadId(params);
    const thread = await requireThread(threadId);
    if (!thread.sessionId) {
      const error = new Error("OpenCode fork requires a session on the source thread");
      error.errorCode = "opencode_fork_requires_session";
      throw error;
    }

    try {
      await ensureStarted();
    } catch (error) {
      if (error.errorCode === ERROR_CODES.OPENCODE_NOT_INSTALLED.errorCode) {
        const forkError = new Error("OpenCode server is unreachable. Fork could not complete.");
        forkError.errorCode = ERROR_CODES.OPENCODE_SERVER_UNREACHABLE.errorCode;
        forkError.action = ERROR_CODES.OPENCODE_SERVER_UNREACHABLE.action;
        throw forkError;
      }
      throw error;
    }
    const newSessionId = await client.fork(thread.sessionId);
    if (!readString(newSessionId)) {
      const error = new Error(
        "OpenCode session.fork returned no session id; cannot start forked thread.",
      );
      error.errorCode = "opencode_fork_empty_session";
      throw error;
    }
    return threadStart({
      params: {
        sessionId: newSessionId,
        model: thread.model,
        agent: thread.agent,
        cwd: thread.cwd,
      },
    });
  }

  function resetIdleTimer() {
    stopIdleTimer();
    idleTimer = setTimeout(() => {
      const idleDuration = Date.now() - lastActivityAt;
      if (idleDuration >= HEALTH_IDLE_SHUTDOWN_MS && activeTurns.size === 0) {
        console.log(
          `${logPrefix} OpenCode server idle for ${Math.round(idleDuration / 60000)}min, shutting down.`,
        );
        server.stop().then(() => {
          client = null;
          healthy = false;
        });
      }
    }, HEALTH_IDLE_SHUTDOWN_MS);
    // Unit tests create many short-lived providers; do not hold the process open for 10 minutes.
    if (readString(process.env.REMODEX_TEST) === "1" && typeof idleTimer?.unref === "function") {
      idleTimer.unref();
    }
  }

  function stopIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  async function restoreSessions() {
    for (const [threadId, entry] of sessions.entries()) {
      const sessionId =
        typeof entry === "string" ? entry : readString(entry?.sessionId);
      const thread = threads.get(threadId);
      if (thread) {
        if (sessionId) {
          thread.sessionId = sessionId;
        }
        continue;
      }
      try {
        await rehydrateThreadIfNeeded(threadId);
      } catch (error) {
        console.warn(
          `${logPrefix} OpenCode session rehydrate skipped for ${threadId}: ${
            (error && error.message) || error
          }`,
        );
      }
    }
  }

  function rememberThreadProject(thread, source) {
    if (!projectRegistry || !thread?.hasProjectCwd) return;
    try {
      projectRegistry.rememberProjectPath(thread.cwd, {
        source,
        provider: OPENCODE_PROVIDER_ID,
        lastSeenAt: thread.updatedAt || thread.createdAt,
      });
    } catch {}
  }

  function emit(method, params) {
    sendApplicationMessage?.(
      JSON.stringify({ method, params: removeUndefinedValues(params || {}) }),
    );
  }

  function getCatalogAvailability() {
    if (catalogUnavailable) {
      return { ...catalogUnavailable };
    }
    const runtimeVersion = readString(server.version);
    if (runtimeVersion && server.isRunning) {
      if (isVersionBelowMinimum(runtimeVersion, OPENCODE_MIN_CLI_VERSION)) {
        return {
          unavailableReason: `OpenCode ${runtimeVersion} is below minimum ${OPENCODE_MIN_CLI_VERSION}. Upgrade OpenCode on this Mac.`,
          reasonCode: "opencode_version_below_minimum",
          version: runtimeVersion,
        };
      }
    }
    return runtimeVersion ? { version: runtimeVersion } : null;
  }

  function getRuntimeStatus(env = process.env) {
    const availability = getCatalogAvailability();
    return buildOpenCodeRuntimeStatus({
      enabled: healthy && !availability?.unavailableReason,
      serveUrl: server.baseUrl,
      version: readString(server.version) || readString(availability?.version),
      sessionCount: threads.size,
      lastError: readString(availability?.unavailableReason),
      command: readString(env.REMODEX_OPENCODE_COMMAND) || "opencode",
      handoffEnvEnabled: isOpenCodeHandoffEnabled(env),
      authConfigured: cachedAuthConfigured,
      connectedProviders: lastConnectedProviders,
      providerDiscoveryReasonCode: readString(lastModelListMeta?.reasonCode) || null,
      providerInventory: lastProviderInventory,
      authDiscoveryReasonCode: lastAuthDiscoveryReasonCode,
      providerInventoryPartial: lastProviderInventoryPartial,
    });
  }

  function getLastCatalogAgents() {
    return lastCatalogAgents;
  }

  function rememberCatalogAgents(agents) {
    if (Array.isArray(agents) && agents.length > 0) {
      lastCatalogAgents = agents;
    }
  }

  function getLastModelListMeta() {
    return lastModelListMeta ? { ...lastModelListMeta } : null;
  }

  async function getHandoffContext(threadId, { sessionId = "", directory = "" } = {}) {
    const normalizedThreadId = readThreadId({ threadId });
    if (!normalizedThreadId) {
      throw threadNotFoundError(threadId);
    }

    const thread = await requireThread(normalizedThreadId);
    // Client-supplied sessionId/directory are hints only; never override owned thread state.
    const requestedSessionId = readString(sessionId);
    const requestedDirectory = readString(directory);
    if (requestedSessionId && requestedSessionId !== thread.sessionId) {
      console.warn(
        `${logPrefix} Ignoring untrusted handoff sessionId for thread ${normalizedThreadId}`,
      );
    }
    if (requestedDirectory && requestedDirectory !== thread.cwd) {
      console.warn(
        `${logPrefix} Ignoring untrusted handoff directory for thread ${normalizedThreadId}`,
      );
    }

    if (!thread.sessionId) {
      const expired = new Error("OpenCode session is missing for this thread.");
      expired.errorCode = ERROR_CODES.OPENCODE_SESSION_EXPIRED.errorCode;
      expired.action = ERROR_CODES.OPENCODE_SESSION_EXPIRED.action;
      throw expired;
    }

    return {
      threadId: thread.id,
      sessionId: thread.sessionId,
      cwd: thread.cwd,
      model: thread.model,
      agent: thread.agent,
      title: thread.title,
    };
  }

  async function selectTuiSession(sessionId) {
    const normalizedSessionId = readString(sessionId);
    if (!normalizedSessionId) {
      return false;
    }
    await ensureStarted();
    if (!client || typeof client.selectTuiSession !== "function") {
      return false;
    }
    return client.selectTuiSession(normalizedSessionId);
  }

  return {
    id: OPENCODE_PROVIDER_ID,
    ownsThread,
    listModels,
    listAgents,
    listCommands,
    listSkills,
    listThreads,
    handleRequest,
    handleApplicationResponse,
    warmup,
    shutdown,
    getCatalogAvailability,
    getRuntimeStatus,
    getLastModelListMeta,
    getLastCatalogAgents,
    getHandoffContext,
    selectTuiSession,
  };
}

function isInvalidOpenCodeSessionError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const status = Number(error.status ?? error.statusCode ?? error.response?.status);
  if (status === 404) {
    return true;
  }

  const message = readString(error.message).toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes("session not found") ||
    message.includes("unknown session") ||
    message.includes("invalid session") ||
    message.includes("session does not exist") ||
    message.includes("session id not found")
  );
}

function createOpenCodeSessionExpiredError(threadId) {
  const expired = new Error(
    `OpenCode session expired for thread ${threadId}. Start a new thread.`,
  );
  expired.errorCode = ERROR_CODES.OPENCODE_SESSION_EXPIRED.errorCode;
  expired.action = ERROR_CODES.OPENCODE_SESSION_EXPIRED.action;
  expired.reasonCode = "opencode_session_expired";
  return expired;
}

function unsupportedMethodError(method) {
  const error = new Error(`Unsupported OpenCode provider method: ${method || "unknown"}`);
  error.errorCode = "unsupported_opencode_method";
  return error;
}

function threadNotFoundError(threadId) {
  const error = new Error(`OpenCode thread not found: ${threadId || "unknown"}`);
  error.errorCode = "thread_not_found";
  return error;
}

function activeTurnError(threadId) {
  const error = new Error(`OpenCode thread already has a running turn: ${threadId}`);
  error.errorCode = "thread_turn_active";
  return error;
}

module.exports = { createOpenCodeProvider };
