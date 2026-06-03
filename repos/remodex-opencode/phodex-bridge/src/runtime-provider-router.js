// FILE: runtime-provider-router.js
// Purpose: Routes provider-aware Remodex RPCs between Codex app-server and local provider harnesses.
// Layer: Bridge runtime routing
// Exports: createRuntimeProviderRouter plus merge helpers used by tests
// Depends on: ./opencode-models, ./opencode-provider, ./provider-capabilities, ./thread-ownership-store

const { readString, resolvedParam } = require("./normalize");
const { createOpenCodeProvider } = require("./opencode-provider");
const {
  CODEX_PROVIDER_ID,
  DEFAULT_OPENCODE_MODEL,
  OPENCODE_PROVIDER_ID,
  buildOpenCodeModelOption,
  capOpenCodeModelsForMobileList,
  compareThreadsByUpdatedAt,
  isOpenCodeProvider,
  readModelProvider,
  readThreadId,
} = require("./opencode-models");
const { isOpenCodeRuntimeDisabled } = require("./opencode-runtime-policy");
const { START_TIMEOUT_MS, HEALTH_TIMEOUT_MS } = require("./opencode-server");
const {
  CODEX_CAPABILITIES,
  resolveModelCapabilities,
  resolveOpenCodeCatalogCapabilities,
} = require("./provider-capabilities");
const { createThreadOwnershipStore } = require("./thread-ownership-store");
const { buildOpenCodeRuntimeStatus } = require("./opencode-runtime-status");

const PROVIDER_FIELD_KEYS = [
  "modelProvider",
  "model_provider",
  "provider",
  "runtimeProvider",
  "runtime_provider",
  "harness",
];

const ROUTABLE_THREAD_METHODS = new Set([
  "thread/start",
  "thread/resume",
  "thread/read",
  "thread/turns/list",
  "thread/name/set",
  "thread/archive",
  "thread/unarchive",
  "thread/fork",
  "turn/start",
  "turn/interrupt",
]);

function createRuntimeProviderRouter({
  sendCodexRequest,
  sendApplicationResponse,
  sendRuntimeMessage,
  providers = null,
  projectRegistry = null,
  ownershipStore = null,
  logPrefix = "[remodex]",
} = {}) {
  const threadOwnership = ownershipStore || createThreadOwnershipStore();
  const runtimeProviders = resolveProviders({
    providers,
    env: process.env,
    createOpenCodeProvider,
    sendRuntimeMessage,
    sendApplicationResponse,
    projectRegistry,
    ownershipStore: threadOwnership,
    logPrefix,
  });

  const opencodeProvider = runtimeProviders.find((provider) => provider.id === OPENCODE_PROVIDER_ID);
  const skipOpenCodeWarmup =
    readString(process.env.REMODEX_TEST) === "1" || readString(process.env.NODE_ENV) === "test";
  if (opencodeProvider && typeof opencodeProvider.warmup === "function" && !skipOpenCodeWarmup) {
    void opencodeProvider.warmup();
  }

  function handleApplicationMessage(rawMessage) {
    const parsed = safeParseJSON(rawMessage);
    if (!parsed) {
      return false;
    }

    const responseProvider = runtimeProviders.find(
      (provider) =>
        parsed.id != null &&
        !parsed.method &&
        typeof provider.handleApplicationResponse === "function" &&
        provider.handleApplicationResponse(parsed),
    );
    if (responseProvider) {
      return true;
    }

    const method = readString(parsed.method);
    if (!method) {
      return false;
    }

    if (method === "model/list") {
      respondAsync(parsed, async () => {
        const params = parsed.params || {};
        const forceProviders = params.refreshProviders === true;
        const catalogOpenCode = catalogOpenCodeSnapshotForModelList(runtimeProviders, process.env);
        const [codexResult, providerListResult] = await Promise.all([
          withModelListBudget(
            sendCodexRequest("model/list", params).catch((error) => {
              console.warn(
                `${logPrefix} Codex model/list failed: ${error?.message || error}`,
              );
              return { items: [] };
            }),
            CODEX_MODEL_LIST_BUDGET_MS,
            { items: [] },
          ),
          listProviderModelsForModelList(runtimeProviders, logPrefix, {
            force: forceProviders,
          }),
        ]);
        const { models: providerModels, opencodeMeta } = providerListResult;
        const capped = providerModelsForModelList(
          providerModels,
          catalogOpenCode,
          opencodeMeta,
        );
        if (opencodeMeta) {
          opencodeMeta.modelCountBeforeCap = providerModels.filter(
            (model) => readModelProvider(model) === OPENCODE_PROVIDER_ID,
          ).length;
          opencodeMeta.modelCountAfterCap = capped.filter(
            (model) => readModelProvider(model) === OPENCODE_PROVIDER_ID,
          ).length;
        }
        return mergeModelListResult(codexResult, capped, { opencode: opencodeMeta });
      });
      return true;
    }

    if (method === "thread/list") {
      respondAsync(parsed, async () => {
        const codexResult = await sendCodexRequest("thread/list", parsed.params || {});
        const shouldIncludeProviders = !hasCursor(parsed.params);
        const providerThreads = shouldIncludeProviders
          ? await listProviderThreads(runtimeProviders, parsed.params || {})
          : [];
        registerThreadProjects(projectRegistry, threadsFromListResult(codexResult), {
          source: "codex-thread-list",
          provider: CODEX_PROVIDER_ID,
        });
        registerThreadProjects(projectRegistry, providerThreads, {
          source: "provider-thread-list",
        });
        return mergeThreadListResult(codexResult, providerThreads);
      });
      return true;
    }

    if (method === "runtime/catalog") {
      respondAsync(parsed, async () => buildRuntimeCatalog(runtimeProviders, process.env));
      return true;
    }

    if (method === "command/list") {
      respondAsync(parsed, async () => {
        const directory = readString(parsed.params?.directory || parsed.params?.cwd);
        const opencodeProvider = runtimeProviders.find((p) => p.id === "opencode");
        if (opencodeProvider && typeof opencodeProvider.listCommands === "function") {
          return { commands: await opencodeProvider.listCommands(directory) };
        }
        return { commands: [] };
      });
      return true;
    }

    if (method === "skills/list") {
      respondAsync(parsed, async () => mergeSkillsListResult(parsed.params || {}, runtimeProviders, sendCodexRequest));
      return true;
    }

    if (!ROUTABLE_THREAD_METHODS.has(method)) {
      return false;
    }

    const ownershipMismatch = resolveThreadOwnershipMismatch(parsed, threadOwnership);
    if (ownershipMismatch) {
      respondAsync(parsed, async () => {
        throw ownershipMismatch;
      });
      return true;
    }

    const provider = providerForRequest(parsed, runtimeProviders);
    if (!provider) {
      return false;
    }

    rememberProjectFromRequest(projectRegistry, parsed, {
      source: "provider-request",
      provider: provider.id,
    });
    respondAsync(parsed, () => provider.handleRequest(parsed));
    return true;
  }

  function respondAsync(request, resolveResult) {
    Promise.resolve()
      .then(resolveResult)
      .then((result) => {
        if (request.id != null) {
          sendApplicationResponse(
            JSON.stringify({
              id: request.id,
              result,
            }),
          );
        }
      })
      .catch((error) => {
        if (request.id != null) {
          sendApplicationResponse(
            createJsonRpcErrorResponse(
              request.id,
              error,
              error?.errorCode || "runtime_provider_failed",
            ),
          );
        }
      });
  }

  return {
    handleApplicationMessage,
    providers: runtimeProviders,
    shutdown() {
      for (const provider of runtimeProviders) {
        provider.shutdown?.();
      }
    },
  };
}

async function listProviderModels(providers) {
  const settled = await Promise.allSettled(providers.map((provider) => provider.listModels()));
  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

const CODEX_MODEL_LIST_BUDGET_MS = 3_000;
const MODEL_LIST_PROVIDER_BUDGET_MS = 3_000;
// Cold `opencode serve` can take START_TIMEOUT_MS + health polling; 8s was too short on device.
const DEFAULT_OPENCODE_MODEL_LIST_BUDGET_MS =
  START_TIMEOUT_MS + HEALTH_TIMEOUT_MS + 5_000;
const RUNTIME_CATALOG_AGENT_BUDGET_MS = 2_000;
let lastOpenCodeCatalogAgents = [];

function readModelListBudgetMs(env, key, fallbackMs) {
  const numeric = Number(readString(env?.[key]));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallbackMs;
  }
  return Math.min(Math.floor(numeric), 60_000);
}

function opencodeModelListBudgetMs(env = process.env) {
  return readModelListBudgetMs(
    env,
    "REMODEX_MODEL_LIST_OPENCODE_BUDGET_MS",
    DEFAULT_OPENCODE_MODEL_LIST_BUDGET_MS,
  );
}

// Caps one leg of model/list so Codex and OpenCode discovery stay within mobile budgets.
function withModelListBudget(promise, budgetMs, fallback) {
  let timeoutId;
  const budget = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), budgetMs);
  });

  return Promise.race([promise, budget]).finally(() => {
    clearTimeout(timeoutId);
  });
}

// OpenCode model discovery can take several seconds; never block Codex on it.
async function listProviderModelsForModelList(
  providers,
  logPrefix = "[remodex]",
  options = {},
) {
  const env = options.env || process.env;
  const force = options.force === true;
  let opencodeMeta = null;
  const settled = await Promise.allSettled(
    providers.map((provider) => {
      const budgetMs =
        provider.id === OPENCODE_PROVIDER_ID
          ? opencodeModelListBudgetMs(env)
          : MODEL_LIST_PROVIDER_BUDGET_MS;
      const listPromise =
        provider.id === OPENCODE_PROVIDER_ID && force
          ? provider.listModels({ force: true, refreshProviders: true })
          : provider.listModels();
      return withModelListBudget(
        listPromise.catch((error) => {
          console.warn(
            `${logPrefix} ${provider.id} model/list failed: ${error?.message || error}`,
          );
          return provider.id === OPENCODE_PROVIDER_ID
            ? {
                models: [],
                meta: {
                  reasonCode: "provider_list_failed",
                  connectedProviderIds: [],
                  fetchedAt: new Date().toISOString(),
                  stale: false,
                  modelCountBeforeCap: 0,
                  modelCountAfterCap: 0,
                },
              }
            : [];
        }),
        budgetMs,
        provider.id === OPENCODE_PROVIDER_ID
          ? {
              models: [],
              meta: {
                reasonCode: "provider_list_failed",
                connectedProviderIds: [],
                fetchedAt: new Date().toISOString(),
                stale: false,
                modelCountBeforeCap: 0,
                modelCountAfterCap: 0,
              },
            }
          : [],
      );
    }),
  );

  const models = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") {
      continue;
    }
    const value = result.value;
    if (value && typeof value === "object" && Array.isArray(value.models)) {
      if (value.meta) {
        opencodeMeta = value.meta;
      }
      models.push(...value.models);
      continue;
    }
    if (Array.isArray(value)) {
      models.push(...value);
    }
  }

  if (!opencodeMeta) {
    const opencodeProvider = providers.find((provider) => provider.id === OPENCODE_PROVIDER_ID);
    if (opencodeProvider && typeof opencodeProvider.getLastModelListMeta === "function") {
      opencodeMeta = opencodeProvider.getLastModelListMeta();
    }
  }

  return { models, opencodeMeta };
}

async function listProviderThreads(providers, params) {
  const settled = await Promise.allSettled(
    providers.map((provider) => provider.listThreads(params)),
  );
  return settled.flatMap((result) => {
    if (result.status !== "fulfilled") {
      return [];
    }
    const payload = result.value;
    return Array.isArray(payload?.data) ? payload.data : [];
  });
}

function resolveThreadOwnershipMismatch(request, ownershipStore) {
  const params = request.params || {};
  const threadId = readThreadId(params);
  if (!threadId) {
    return null;
  }

  const storedProvider = ownershipStore.getOwnership(threadId);
  if (!storedProvider) {
    return null;
  }

  const requestedProvider = readModelProvider(params);
  if (!requestedProvider) {
    return null;
  }

  const normalizedRequested = isOpenCodeProvider(requestedProvider)
    ? OPENCODE_PROVIDER_ID
    : CODEX_PROVIDER_ID;
  if (storedProvider === normalizedRequested) {
    return null;
  }

  const error = new Error(
    `Thread ${threadId} is owned by ${storedProvider}, not ${normalizedRequested}`,
  );
  error.errorCode = "thread_provider_mismatch";
  error.userMessage = `This chat is tied to ${storedProvider}. Start a new chat to switch providers.`;
  return error;
}

function providerForRequest(request, providers) {
  const params = request.params || {};
  const providerFromRequest = readModelProvider(params);
  const hasProviderField = hasExplicitProviderField(params);
  if (isOpenCodeProvider(providerFromRequest)) {
    return providers.find((provider) => provider.id === OPENCODE_PROVIDER_ID) || null;
  }
  if (hasProviderField) {
    return null;
  }

  const threadId = readThreadId(params);
  if (!threadId) {
    return null;
  }

  return providers.find((provider) => provider.ownsThread(threadId)) || null;
}

function mergeModelListResult(codexResult, providerModels, extras = {}) {
  const result = codexResult && typeof codexResult === "object" ? codexResult : {};
  const key = firstArrayKey(result, ["items", "data", "models"]) || "items";
  const codexModels = Array.isArray(result[key]) ? result[key] : [];
  const normalizedCodexModels = codexModels.map((model) => {
    const capabilities = resolveModelCapabilities(CODEX_PROVIDER_ID, model);
    return {
      ...model,
      modelProvider: CODEX_PROVIDER_ID,
      provider: CODEX_PROVIDER_ID,
      capabilities,
    };
  });
  const normalizedProviderModels = providerModels.map((model) => {
    const provider = readModelProvider(model) || OPENCODE_PROVIDER_ID;
    return {
      ...model,
      modelProvider: provider,
      provider,
      capabilities: model.capabilities ?? resolveModelCapabilities(provider, model),
    };
  });

  const merged = {
    ...result,
    [key]: [...normalizedCodexModels, ...normalizedProviderModels],
  };
  if (extras.opencode && typeof extras.opencode === "object") {
    merged.opencode = extras.opencode;
  }
  return merged;
}

function mergeThreadListResult(codexResult, providerThreads) {
  const result = codexResult && typeof codexResult === "object" ? codexResult : {};
  const key = firstArrayKey(result, ["data", "items", "threads"]) || "data";
  const codexThreads = Array.isArray(result[key]) ? result[key] : [];
  const merged = dedupeMergedThreads(codexThreads, providerThreads).toSorted(
    compareThreadsByUpdatedAt,
  );

  return {
    ...result,
    [key]: merged,
  };
}

function dedupeMergedThreads(codexThreads, providerThreads) {
  const mergedById = new Map();
  for (const thread of codexThreads) {
    const threadId = readThreadIdentifier(thread);
    if (threadId) {
      mergedById.set(threadId, thread);
    }
  }

  for (const thread of providerThreads) {
    const threadId = readThreadIdentifier(thread);
    if (!threadId) {
      continue;
    }

    if (!mergedById.has(threadId) || hasProviderThreadMetadata(thread)) {
      mergedById.set(threadId, thread);
    }
  }
  return Array.from(mergedById.values());
}

function hasProviderThreadMetadata(thread) {
  return readModelProvider(thread) !== CODEX_PROVIDER_ID;
}

function threadsFromListResult(result) {
  const key = firstArrayKey(result, ["data", "items", "threads"]);
  return key && Array.isArray(result?.[key]) ? result[key] : [];
}

function registerThreadProjects(projectRegistry, threads, metadata = {}) {
  if (!projectRegistry || !Array.isArray(threads) || !threads.length) {
    return;
  }

  try {
    projectRegistry.rememberProjectsFromThreads(threads, metadata);
  } catch {
    // Project history is a cache; provider routing should not fail when it cannot be persisted.
  }
}

function rememberProjectFromRequest(projectRegistry, request, metadata = {}) {
  if (!projectRegistry) {
    return;
  }

  const params = request?.params || {};
  const cwd = resolvedParam(params, 'cwd', 'current_working_directory', 'working_directory');
  if (!cwd) {
    return;
  }

  try {
    projectRegistry.rememberProjectPath(cwd, metadata);
  } catch {
    // Best-effort cache write; the runtime request remains authoritative.
  }
}

function stripRuntimeProviderFieldsForCodex(rawMessage) {
  const parsed = safeParseJSON(rawMessage);
  if (
    !parsed ||
    !parsed.params ||
    typeof parsed.params !== "object" ||
    Array.isArray(parsed.params)
  ) {
    return rawMessage;
  }

  const params = stripProviderFieldsFromObject(parsed.params);
  return JSON.stringify({
    ...parsed,
    params,
  });
}

function stripProviderFieldsFromObject(value) {
  const result = { ...value };
  delete result.modelProvider;
  delete result.model_provider;
  delete result.provider;
  delete result.runtimeProvider;
  delete result.runtime_provider;
  delete result.harness;

  for (const key of ["collaborationMode", "collaboration_mode"]) {
    if (!result[key] || typeof result[key] !== "object" || Array.isArray(result[key])) {
      continue;
    }
    const collaborationMode = { ...result[key] };
    if (collaborationMode.settings && typeof collaborationMode.settings === "object") {
      collaborationMode.settings = stripProviderFieldsFromObject(collaborationMode.settings);
    }
    result[key] = collaborationMode;
  }

  return result;
}

function firstArrayKey(value, keys) {
  return keys.find((key) => Array.isArray(value?.[key])) || "";
}

function hasCursor(params = {}) {
  const cursor = params.cursor ?? params.nextCursor ?? params.next_cursor;
  return cursor != null && cursor !== "" && cursor !== false;
}

function hasExplicitProviderField(params = {}) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return false;
  }
  if (PROVIDER_FIELD_KEYS.some((key) => readString(params[key]))) {
    return true;
  }

  for (const key of ["collaborationMode", "collaboration_mode"]) {
    const settings = params[key]?.settings;
    if (settings && typeof settings === "object" && !Array.isArray(settings)) {
      return PROVIDER_FIELD_KEYS.some((providerKey) => readString(settings[providerKey]));
    }
  }

  return false;
}

function readThreadIdentifier(thread = {}) {
  return resolvedParam(thread, 'id', 'threadId', 'thread_id');
}

function createJsonRpcErrorResponse(requestId, error, defaultErrorCode) {
  return JSON.stringify({
    id: requestId,
    error: {
      code: -32000,
      message: error?.userMessage || error?.message || "Runtime provider request failed.",
      data: {
        errorCode: error?.errorCode || defaultErrorCode,
      },
    },
  });
}

function safeParseJSON(rawMessage) {
  try {
    return JSON.parse(rawMessage);
  } catch {
    return null;
  }
}

function resolveProviders({
  providers,
  env,
  createOpenCodeProvider,
  sendRuntimeMessage,
  sendApplicationResponse,
  projectRegistry,
  ownershipStore,
  logPrefix,
}) {
  if (providers !== null && providers !== undefined) {
    return providers;
  }
  if (isOpenCodeRuntimeDisabled(env)) {
    return [];
  }
  return [
    createOpenCodeProvider({
      sendApplicationMessage: sendRuntimeMessage || sendApplicationResponse,
      projectRegistry,
      ownershipStore,
      logPrefix,
    }),
  ];
}

function buildCatalogOpenCodePlaceholderModels() {
  const model = buildOpenCodeModelOption(DEFAULT_OPENCODE_MODEL, { isDefault: true });
  if (!model) {
    return [];
  }
  return [
    {
      ...model,
      capabilities: resolveModelCapabilities(OPENCODE_PROVIDER_ID, model),
    },
  ];
}

function providerModelsForModelList(providerModels, catalogOpenCode, opencodeMeta = null) {
  const opencodeModels = providerModels.filter(
    (model) => readModelProvider(model) === OPENCODE_PROVIDER_ID,
  );
  const connectedProviderIds = opencodeMeta?.connectedProviderIds || null;
  const cappedOpenCode = capOpenCodeModelsForMobileList(
    opencodeModels,
    process.env,
    connectedProviderIds,
  );
  const placeholderModels =
    catalogOpenCode && !catalogOpenCode.enabled && cappedOpenCode.length === 0
      ? buildCatalogOpenCodePlaceholderModels()
      : [];
  return [...cappedOpenCode, ...placeholderModels];
}

function readOpenCodeCatalogAvailability(opencodeProvider) {
  if (!opencodeProvider || typeof opencodeProvider.getCatalogAvailability !== "function") {
    return null;
  }
  return opencodeProvider.getCatalogAvailability();
}

function catalogOpenCodeSnapshotForModelList(providers, env) {
  if (isOpenCodeRuntimeDisabled(env)) {
    return null;
  }
  const opencodeProvider = providers.find((provider) => provider.id === OPENCODE_PROVIDER_ID);
  if (!opencodeProvider) {
    return null;
  }
  const availability = readOpenCodeCatalogAvailability(opencodeProvider);
  return {
    id: OPENCODE_PROVIDER_ID,
    enabled: !availability?.unavailableReason,
  };
}

async function buildCatalogOpenCodeRuntime(providers, env) {
  if (isOpenCodeRuntimeDisabled(env)) {
    return null;
  }

  const opencodeProvider = providers.find((p) => p.id === OPENCODE_PROVIDER_ID);
  const hasCommand = readString(env.REMODEX_OPENCODE_COMMAND) || "opencode";
  let agents = [];
  let unavailableReason = null;
  let reasonCode = null;

  const serverAvailability = readOpenCodeCatalogAvailability(opencodeProvider);
  const runtimeStatus =
    typeof opencodeProvider?.getRuntimeStatus === "function"
      ? opencodeProvider.getRuntimeStatus(env)
      : buildOpenCodeRuntimeStatus({
          enabled: false,
          command: hasCommand,
          handoffEnvEnabled: readString(env.REMODEX_OPENCODE_HANDOFF).toLowerCase() === "1"
            || readString(env.REMODEX_OPENCODE_HANDOFF).toLowerCase() === "true",
        });

  if (serverAvailability?.unavailableReason) {
    return {
      id: OPENCODE_PROVIDER_ID,
      label: "OpenCode",
      enabled: false,
      showsBetaLabel: true,
      unavailableReason: serverAvailability.unavailableReason,
      reasonCode: serverAvailability.reasonCode || "opencode_server_failed",
      agents: [],
      capabilities: resolveOpenCodeCatalogCapabilities(env),
      opencode: {
        ...runtimeStatus,
        enabled: false,
        lastError: serverAvailability.unavailableReason,
        version: readString(serverAvailability.version) || runtimeStatus.version,
      },
    };
  }

  if (opencodeProvider) {
    try {
      const raw = await withModelListBudget(
        opencodeProvider.listAgents(),
        RUNTIME_CATALOG_AGENT_BUDGET_MS,
        null,
      );
      const mapped = (raw || []).map((a) => ({
        id: readString(a?.id || a),
        label: readString(a?.label || a?.name || a?.displayName || a?.id || a),
      }));
      if (mapped.length > 0) {
        lastOpenCodeCatalogAgents = mapped;
        agents = mapped;
      } else if (lastOpenCodeCatalogAgents.length > 0) {
        console.log(JSON.stringify({ event: "runtime_catalog_agents_stale" }));
        agents = lastOpenCodeCatalogAgents;
      } else if (
        typeof opencodeProvider.getLastCatalogAgents === "function" &&
        opencodeProvider.getLastCatalogAgents().length > 0
      ) {
        console.log(JSON.stringify({ event: "runtime_catalog_agents_stale" }));
        agents = opencodeProvider.getLastCatalogAgents().map((a) => ({
          id: readString(a?.id || a),
          label: readString(a?.label || a?.name || a?.displayName || a?.id || a),
        }));
        lastOpenCodeCatalogAgents = agents;
      } else {
        agents = [];
      }
    } catch {
      if (lastOpenCodeCatalogAgents.length > 0) {
        console.log(JSON.stringify({ event: "runtime_catalog_agents_stale" }));
        agents = lastOpenCodeCatalogAgents;
      } else {
        agents = [];
        unavailableReason = "OpenCode agents could not be listed";
      }
    }
  } else if (!hasCommand) {
    unavailableReason = "OpenCode command is not configured on this Mac";
  }

  const enabled = Boolean(opencodeProvider) && !unavailableReason && Boolean(hasCommand);
  if (!enabled && unavailableReason) {
    reasonCode = "opencode_agents_unavailable";
  } else if (!enabled) {
    reasonCode = "opencode_not_enabled";
  }

  return {
    id: OPENCODE_PROVIDER_ID,
    label: "OpenCode",
    enabled,
    showsBetaLabel: true,
    unavailableReason: enabled
      ? null
      : unavailableReason || "OpenCode is not available on this Mac",
    reasonCode,
    agents,
    capabilities: resolveOpenCodeCatalogCapabilities(env),
    opencode: {
      ...runtimeStatus,
      enabled: enabled && runtimeStatus.enabled !== false,
      lastError: enabled ? null : runtimeStatus.lastError || unavailableReason,
      connectedProviders: runtimeStatus.connectedProviders || null,
      providerDiscoveryReasonCode: runtimeStatus.providerDiscoveryReasonCode || null,
      providerInventory: runtimeStatus.providerInventory || null,
      authDiscoveryReasonCode: runtimeStatus.authDiscoveryReasonCode || null,
      providerInventoryPartial: runtimeStatus.providerInventoryPartial ?? null,
    },
  };
}

function resolveSkillsListCwds(params = {}) {
  const cwds = [];
  if (Array.isArray(params.cwds)) {
    for (const entry of params.cwds) {
      const cwd = readString(entry);
      if (cwd) {
        cwds.push(cwd);
      }
    }
  }
  const singleCwd = readString(params.cwd || params.directory);
  if (singleCwd) {
    cwds.push(singleCwd);
  }
  if (cwds.length === 0) {
    cwds.push(process.cwd());
  }
  return [...new Set(cwds)];
}

function dedupeSkillsByName(skills) {
  const byName = new Map();
  for (const skill of skills) {
    const name = readString(skill?.name);
    if (!name) {
      continue;
    }
    const existing = byName.get(name);
    if (!existing || (skill.enabled !== false && existing.enabled === false)) {
      byName.set(name, skill);
    }
  }
  return [...byName.values()].sort((a, b) =>
    readString(a.name).localeCompare(readString(b.name), undefined, { sensitivity: "base" }),
  );
}

async function mergeSkillsListResult(params, providers, sendCodexRequest) {
  const cwds = resolveSkillsListCwds(params);
  const codexParams = { ...params };
  if (!Array.isArray(codexParams.cwds) || codexParams.cwds.length === 0) {
    codexParams.cwds = cwds;
  }

  const [codexResult, opencodeBuckets] = await Promise.all([
    sendCodexRequest("skills/list", codexParams).catch((error) => {
      console.warn(`[remodex] Codex skills/list failed: ${error?.message || error}`);
      return { data: [] };
    }),
    listOpenCodeSkillsBuckets(providers, cwds),
  ]);

  const codexBuckets = normalizeSkillsBuckets(codexResult);
  const mergedBuckets = mergeSkillsBuckets(codexBuckets, opencodeBuckets);
  if (Array.isArray(codexResult?.data)) {
    return { ...codexResult, data: mergedBuckets };
  }
  if (Array.isArray(codexResult?.skills)) {
    return {
      skills: dedupeSkillsByName(mergedBuckets.flatMap((bucket) => bucket.skills || [])),
    };
  }
  return { data: mergedBuckets };
}

async function listOpenCodeSkillsBuckets(providers, cwds) {
  const opencodeProvider = providers.find((p) => p.id === OPENCODE_PROVIDER_ID);
  if (!opencodeProvider || typeof opencodeProvider.listSkills !== "function") {
    return [];
  }
  const buckets = [];
  for (const cwd of cwds) {
    const skills = await opencodeProvider.listSkills(cwd);
    if (skills.length > 0) {
      buckets.push({ cwd, skills });
    }
  }
  return buckets;
}

function normalizeSkillsBuckets(result) {
  if (Array.isArray(result?.data)) {
    return result.data.map((bucket) => ({
      cwd: readString(bucket?.cwd) || "",
      skills: Array.isArray(bucket?.skills) ? bucket.skills : [],
    }));
  }
  if (Array.isArray(result?.skills)) {
    return [{ cwd: "", skills: result.skills }];
  }
  return [];
}

function mergeSkillsBuckets(primaryBuckets, secondaryBuckets) {
  const byCwd = new Map();
  for (const bucket of [...primaryBuckets, ...secondaryBuckets]) {
    const cwd = readString(bucket?.cwd) || "";
    const existing = byCwd.get(cwd) || { cwd, skills: [] };
    existing.skills = dedupeSkillsByName([...(existing.skills || []), ...(bucket.skills || [])]);
    byCwd.set(cwd, existing);
  }
  return [...byCwd.values()];
}

async function buildRuntimeCatalog(providers, env) {
  const runtimes = [
    {
      id: "codex",
      label: "Codex",
      enabled: true,
      showsBetaLabel: false,
      reasonCode: null,
      agents: [],
      capabilities: { ...CODEX_CAPABILITIES },
    },
  ];

  const opencodeRuntime = await buildCatalogOpenCodeRuntime(providers, env);
  if (opencodeRuntime) {
    runtimes.push(opencodeRuntime);
  }

  return { runtimes };
}

module.exports = {
  buildCatalogOpenCodeRuntime,
  readOpenCodeCatalogAvailability,
  buildCatalogOpenCodePlaceholderModels,
  CODEX_MODEL_LIST_BUDGET_MS,
  DEFAULT_OPENCODE_MODEL_LIST_BUDGET_MS,
  MODEL_LIST_PROVIDER_BUDGET_MS,
  opencodeModelListBudgetMs,
  createRuntimeProviderRouter,
  capOpenCodeModelsForMobileList,
  catalogOpenCodeSnapshotForModelList,
  listProviderModelsForModelList,
  withModelListBudget,
  mergeModelListResult,
  mergeSkillsListResult,
  mergeThreadListResult,
  providerForRequest,
  providerModelsForModelList,
  registerThreadProjects,
  stripRuntimeProviderFieldsForCodex,
  threadsFromListResult,
};
