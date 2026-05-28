// FILE: runtime-provider-router.js
// Purpose: Routes provider-aware Remodex RPCs between Codex app-server and local provider harnesses.
// Layer: Bridge runtime routing
// Exports: createRuntimeProviderRouter plus merge helpers used by tests
// Depends on: ./opencode-models, ./opencode-provider

const { createOpenCodeProvider } = require("./opencode-provider");
const {
  CODEX_PROVIDER_ID,
  OPENCODE_PROVIDER_ID,
  isOpenCodeProvider,
  readModelProvider,
} = require("./opencode-models");

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
  "turn/start",
  "turn/interrupt",
]);

function createRuntimeProviderRouter({
  sendCodexRequest,
  sendApplicationResponse,
  sendRuntimeMessage,
  providers = null,
  projectRegistry = null,
  logPrefix = "[remodex]",
} = {}) {
  const runtimeProviders = providers || [
    createOpenCodeProvider({
      sendApplicationMessage: sendRuntimeMessage || sendApplicationResponse,
      projectRegistry,
      logPrefix,
    }),
  ];

  function handleApplicationMessage(rawMessage) {
    const parsed = safeParseJSON(rawMessage);
    if (!parsed) {
      return false;
    }

    const responseProvider = runtimeProviders.find((provider) => (
      parsed.id != null
      && !parsed.method
      && typeof provider.handleApplicationResponse === "function"
      && provider.handleApplicationResponse(parsed)
    ));
    if (responseProvider) {
      return true;
    }

    const method = readString(parsed.method);
    if (!method) {
      return false;
    }

    if (method === "model/list") {
      respondAsync(parsed, async () => {
        const codexResult = await sendCodexRequest("model/list", parsed.params || {});
        const providerModels = await listProviderModels(runtimeProviders);
        return mergeModelListResult(codexResult, providerModels);
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

    if (!ROUTABLE_THREAD_METHODS.has(method)) {
      return false;
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
          sendApplicationResponse(JSON.stringify({
            id: request.id,
            result,
          }));
        }
      })
      .catch((error) => {
        if (request.id != null) {
          sendApplicationResponse(createJsonRpcErrorResponse(
            request.id,
            error,
            error?.errorCode || "runtime_provider_failed"
          ));
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

async function listProviderThreads(providers, params) {
  const settled = await Promise.allSettled(providers.map((provider) => provider.listThreads(params)));
  return settled.flatMap((result) => {
    if (result.status !== "fulfilled") {
      return [];
    }
    const payload = result.value;
    return Array.isArray(payload?.data) ? payload.data : [];
  });
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

function mergeModelListResult(codexResult, providerModels) {
  const result = codexResult && typeof codexResult === "object" ? codexResult : {};
  const key = firstArrayKey(result, ["items", "data", "models"]) || "items";
  const codexModels = Array.isArray(result[key]) ? result[key] : [];
  const normalizedCodexModels = codexModels.map((model) => ({
    ...model,
    modelProvider: CODEX_PROVIDER_ID,
    provider: CODEX_PROVIDER_ID,
  }));

  return {
    ...result,
    [key]: [
      ...normalizedCodexModels,
      ...providerModels,
    ],
  };
}

function mergeThreadListResult(codexResult, providerThreads) {
  const result = codexResult && typeof codexResult === "object" ? codexResult : {};
  const key = firstArrayKey(result, ["data", "items", "threads"]) || "data";
  const codexThreads = Array.isArray(result[key]) ? result[key] : [];
  const merged = dedupeMergedThreads(codexThreads, providerThreads).sort(compareThreadsByUpdatedAt);

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
  const cwd = readString(params.cwd || params.current_working_directory || params.working_directory);
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
  if (!parsed || !parsed.params || typeof parsed.params !== "object" || Array.isArray(parsed.params)) {
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

function compareThreadsByUpdatedAt(lhs, rhs) {
  const lhsTime = Date.parse(lhs?.updatedAt || lhs?.updated_at || lhs?.createdAt || lhs?.created_at || 0) || 0;
  const rhsTime = Date.parse(rhs?.updatedAt || rhs?.updated_at || rhs?.createdAt || rhs?.created_at || 0) || 0;
  return rhsTime - lhsTime;
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

function readThreadId(params = {}) {
  return readString(params.threadId || params.thread_id || params.id);
}

function readThreadIdentifier(thread = {}) {
  return readString(thread.id || thread.threadId || thread.thread_id);
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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

module.exports = {
  createRuntimeProviderRouter,
  mergeModelListResult,
  mergeThreadListResult,
  providerForRequest,
  registerThreadProjects,
  stripRuntimeProviderFieldsForCodex,
  threadsFromListResult,
};
