// FILE: runtime-provider-router.js
// Purpose: Routes provider-aware Remodex RPCs between Codex app-server and local runtime providers.
// Layer: Bridge runtime routing
// Exports: createRuntimeProviderRouter plus merge helpers used by focused tests.
// Depends on: ./cursor-provider, ./runtime-provider-models

const { createCursorProvider } = require("./cursor-provider");
const {
  CODEX_PROVIDER_ID,
  readModelProvider,
  stripProviderFields,
} = require("./runtime-provider-models");

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
  logPrefix = "[remodex]",
} = {}) {
  const runtimeProviders = providers || [
    createCursorProvider({
      sendApplicationMessage: sendRuntimeMessage || sendApplicationResponse,
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
        const codexResult = await sendCodexRequest("model/list", stripProviderFields(parsed.params || {}));
        const providerModels = await listProviderModels(runtimeProviders);
        return mergeModelListResult(codexResult, providerModels);
      });
      return true;
    }

    if (method === "thread/list") {
      respondAsync(parsed, async () => {
        const codexResult = await sendCodexRequest("thread/list", stripProviderFields(parsed.params || {}));
        const providerThreads = hasCursor(parsed.params)
          ? []
          : await listProviderThreads(runtimeProviders, parsed.params || {});
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
  if (providerFromRequest !== CODEX_PROVIDER_ID) {
    return providers.find((provider) => provider.canHandleProvider?.(providerFromRequest)) || null;
  }
  if (hasExplicitProviderField(params)) {
    return null;
  }

  const threadId = readThreadId(params);
  if (!threadId) {
    return null;
  }

  return providers.find((provider) => provider.ownsThread?.(threadId)) || null;
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
    if (!mergedById.has(threadId) || readModelProvider(thread) !== CODEX_PROVIDER_ID) {
      mergedById.set(threadId, thread);
    }
  }
  return Array.from(mergedById.values());
}

function stripRuntimeProviderFieldsForCodex(rawMessage) {
  const parsed = safeParseJSON(rawMessage);
  if (!parsed || !parsed.params || typeof parsed.params !== "object" || Array.isArray(parsed.params)) {
    return rawMessage;
  }

  return JSON.stringify({
    ...parsed,
    params: stripProviderFields(parsed.params),
  });
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
  const cursor = params?.cursor ?? params?.nextCursor ?? params?.next_cursor;
  return cursor != null && cursor !== "" && cursor !== false;
}

function hasExplicitProviderField(params = {}) {
  return readModelProvider(params) !== CODEX_PROVIDER_ID
    || providerFieldHasValue(params)
    || providerFieldHasValue(params.collaborationMode?.settings)
    || providerFieldHasValue(params.collaboration_mode?.settings);
}

function providerFieldHasValue(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return [
    "modelProvider",
    "model_provider",
    "provider",
    "runtimeProvider",
    "runtime_provider",
    "harness",
  ].some((key) => readString(value[key]));
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
  stripRuntimeProviderFieldsForCodex,
};
