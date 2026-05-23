// FILE: agent-runtime-registry.js
// Purpose: Dispatches bridge runtime routing, status, initialize payloads, and thread runtime projection.
// Layer: Bridge core
// Exports: createAgentRuntimeRegistry
// Depends on: child_process, util, ./agent-runtime-capabilities, ./codex-runtime-adapter, ./thread-agent-state

const { execFile } = require("child_process");
const { promisify } = require("util");
const {
  DEFAULT_AGENT_RUNTIME,
  OPENCODE_DEFAULT_BUILD_AGENT_NAME,
  OPENCODE_DEFAULT_PLAN_AGENT_NAME,
  buildRuntimeListEntry,
  normalizeAgentRuntimeId,
} = require("./agent-runtime-capabilities");
const { createCodexRuntimeAdapter } = require("./codex-runtime-adapter");
const { createThreadAgentStateStore } = require("./thread-agent-state");

const execFileAsync = promisify(execFile);

function createAgentRuntimeRegistry({
  threadAgentState = createThreadAgentStateStore(),
  codexAdapter = createCodexRuntimeAdapter(),
  execFileImpl = execFileAsync,
  logPrefix = "[remodex]",
  logImpl = console,
} = {}) {
  let cachedOpenCodeStatus = null;
  let cachedInitializeResult = null;
  const pendingThreadStartRequestIds = new Set();

  async function resolveOpenCodeStatus({ forceRefresh = false } = {}) {
    if (!forceRefresh && cachedOpenCodeStatus) {
      return cachedOpenCodeStatus;
    }

    try {
      await execFileImpl("opencode", ["--version"], {
        timeout: 3_000,
        maxBuffer: 256 * 1024,
      });
      cachedOpenCodeStatus = buildRuntimeListEntry({
        id: "opencode",
        status: "degraded",
        statusMessage: "OpenCode is installed; bridge spawn support lands in a later update.",
      });
    } catch (error) {
      if (isMissingCommandError(error)) {
        cachedOpenCodeStatus = buildRuntimeListEntry({
          id: "opencode",
          status: "not_installed",
          statusMessage: "Install OpenCode on this Mac to enable the OpenCode runtime.",
        });
      } else {
        logImpl.warn?.(`${logPrefix} OpenCode status probe failed without affecting Codex: ${error?.message || error}`);
        cachedOpenCodeStatus = buildRuntimeListEntry({
          id: "opencode",
          status: "error",
          statusMessage: "Could not determine OpenCode status on this Mac.",
        });
      }
    }

    return cachedOpenCodeStatus;
  }

  async function refreshInitializeCache() {
    cachedInitializeResult = {
      ...buildInitializePayload(),
      agentRuntimes: await listAgentRuntimes(),
    };
    return cachedInitializeResult;
  }

  function buildCachedInitializeResult() {
    if (cachedInitializeResult) {
      return cachedInitializeResult;
    }

    return {
      ...buildInitializePayload(),
      agentRuntimes: [
        buildRuntimeListEntry({ id: "codex", status: "ready" }),
        buildRuntimeListEntry({
          id: "opencode",
          status: "degraded",
          statusMessage: "Checking OpenCode status on this Mac.",
        }),
        buildRuntimeListEntry({
          id: "cursor",
          status: "not_installed",
          statusMessage: "Cursor runtime support lands in a later bridge update.",
        }),
      ],
    };
  }

  async function listAgentRuntimes() {
    const [codexEntry, openCodeEntry] = await Promise.all([
      codexAdapter.getRuntimeListEntry(),
      resolveOpenCodeStatus(),
    ]);

    return [
      codexEntry,
      openCodeEntry,
      buildRuntimeListEntry({
        id: "cursor",
        status: "not_installed",
        statusMessage: "Cursor runtime support lands in a later bridge update.",
      }),
    ];
  }

  function buildInitializePayload() {
    return {
      bridgeManaged: true,
      defaultAgentRuntime: DEFAULT_AGENT_RUNTIME,
    };
  }

  async function buildInitializeResult() {
    return refreshInitializeCache();
  }

  function buildWarmInitializeResult() {
    return buildCachedInitializeResult();
  }

  function parseJsonRpcMessage(rawMessage) {
    try {
      return JSON.parse(rawMessage);
    } catch {
      return null;
    }
  }

  function createJsonRpcResultResponse(requestId, result) {
    return JSON.stringify({
      id: requestId,
      result,
    });
  }

  function createJsonRpcErrorResponse(requestId, message, errorCode = "agent_runtime_error") {
    return JSON.stringify({
      id: requestId,
      error: {
        code: -32000,
        message,
        data: { errorCode },
      },
    });
  }

  async function handleInboundRequest(rawMessage, sendResponse) {
    const parsed = parseJsonRpcMessage(rawMessage);
    const method = typeof parsed?.method === "string" ? parsed.method.trim() : "";
    if (method !== "agent/runtime/list" || parsed.id == null) {
      return false;
    }

    sendResponse(createJsonRpcResultResponse(parsed.id, {
      defaultAgentRuntime: DEFAULT_AGENT_RUNTIME,
      agentRuntimes: await listAgentRuntimes(),
    }));
    return true;
  }

  function extractRequestedAgentRuntime(params = {}) {
    return normalizeAgentRuntimeId(params.agentRuntime)
      || normalizeAgentRuntimeId(params.agent_runtime)
      || DEFAULT_AGENT_RUNTIME;
  }

  function extractThreadIdFromParams(params = {}) {
    return readString(params.threadId)
      || readString(params.thread_id)
      || readString(params.thread?.id)
      || readString(params.thread?.threadId)
      || readString(params.thread?.thread_id);
  }

  function extractThreadCwd(params = {}) {
    return readString(params.cwd)
      || readString(params.workingDirectory)
      || readString(params.working_directory)
      || readString(params.thread?.cwd);
  }

  function validateThreadStartRequest(rawMessage) {
    const parsed = parseJsonRpcMessage(rawMessage);
    const method = typeof parsed?.method === "string" ? parsed.method.trim() : "";
    if (method !== "thread/start") {
      return { allowed: true };
    }

    const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
    const threadId = extractThreadIdFromParams(params);
    const requestedRuntime = extractRequestedAgentRuntime(params);

    if (parsed.id != null) {
      pendingThreadStartRequestIds.add(String(parsed.id));
    }

    if (threadId) {
      const existing = threadAgentState.get(threadId) || threadAgentState.getOrBackfillCodex(threadId, {
        cwd: extractThreadCwd(params),
      });

      if (existing?.runtimeLocked && existing.agentRuntime !== requestedRuntime) {
        return {
          allowed: false,
          requestId: parsed.id,
          message: `Thread ${threadId} is locked to agent runtime "${existing.agentRuntime}".`,
          errorCode: "agent_runtime_locked",
        };
      }
    }

    if (!codexAdapter.shouldHandleRuntime(requestedRuntime)) {
      return {
        allowed: false,
        requestId: parsed.id,
        message: `Agent runtime "${requestedRuntime}" is not available on this bridge yet.`,
        errorCode: "agent_runtime_unavailable",
      };
    }

    if (!threadId) {
      return { allowed: true, requestedRuntime };
    }

    const existing = threadAgentState.get(threadId) || threadAgentState.getOrBackfillCodex(threadId, {
      cwd: extractThreadCwd(params),
    });

    threadAgentState.upsert(threadId, {
      agentRuntime: requestedRuntime,
      agentSessionId: readString(params.agentSessionId)
        || readString(params.agent_session_id)
        || threadId,
      cwd: extractThreadCwd(params) || existing?.cwd || "",
      opencodeBuildAgentName: readString(params.opencodeBuildAgentName)
        || readString(params.opencode_build_agent_name)
        || existing?.opencodeBuildAgentName
        || OPENCODE_DEFAULT_BUILD_AGENT_NAME,
      opencodePlanAgentName: readString(params.opencodePlanAgentName)
        || readString(params.opencode_plan_agent_name)
        || existing?.opencodePlanAgentName
        || OPENCODE_DEFAULT_PLAN_AGENT_NAME,
      runtimeLocked: existing?.runtimeLocked === true,
    });

    return { allowed: true, requestedRuntime, threadId };
  }

  function observeOutboundMessage(rawMessage) {
    const parsed = parseJsonRpcMessage(rawMessage);
    if (!parsed) {
      return;
    }

    const responseId = parsed.id != null ? String(parsed.id) : "";
    if (responseId && pendingThreadStartRequestIds.has(responseId)) {
      pendingThreadStartRequestIds.delete(responseId);
      if (parsed.result != null) {
        lockRuntimeFromThreadStartResult(parsed.result);
      }
    }

    const method = typeof parsed?.method === "string" ? parsed.method.trim() : "";
    if (method === "thread/started") {
      lockRuntimeFromThreadStartedNotification(parsed.params);
    }
  }

  function lockRuntimeFromThreadStartResult(result) {
    const thread = result?.thread && typeof result.thread === "object" ? result.thread : result;
    const threadId = readString(thread?.id)
      || readString(thread?.threadId)
      || readString(thread?.thread_id)
      || readString(result?.threadId)
      || readString(result?.thread_id);
    if (!threadId) {
      return;
    }

    const existing = threadAgentState.get(threadId) || threadAgentState.getOrBackfillCodex(threadId);
    threadAgentState.lockRuntime(threadId, {
      agentRuntime: existing?.agentRuntime || DEFAULT_AGENT_RUNTIME,
      agentSessionId: existing?.agentSessionId || threadId,
      cwd: existing?.cwd || readString(thread?.cwd) || "",
      opencodeBuildAgentName: existing?.opencodeBuildAgentName || OPENCODE_DEFAULT_BUILD_AGENT_NAME,
      opencodePlanAgentName: existing?.opencodePlanAgentName || OPENCODE_DEFAULT_PLAN_AGENT_NAME,
    });
  }

  function lockRuntimeFromThreadStartedNotification(params = {}) {
    const threadId = extractThreadIdFromParams(params);
    if (!threadId) {
      return;
    }

    const existing = threadAgentState.get(threadId) || threadAgentState.getOrBackfillCodex(threadId);
    threadAgentState.lockRuntime(threadId, existing || {});
  }

  function enrichOutboundResponse(rawMessage, requestContext = {}) {
    const parsed = parseJsonRpcMessage(rawMessage);
    if (!parsed || parsed.id == null || parsed.result == null) {
      return rawMessage;
    }

    const requestMethod = readString(requestContext?.method);
    if (requestMethod === "initialize") {
      return enrichInitializeResponse(rawMessage, parsed);
    }

    if (requestMethod === "thread/list") {
      return enrichThreadListResponse(rawMessage, parsed);
    }

    return rawMessage;
  }

  function enrichInitializeResponse(rawMessage, parsed) {
    const mergedResult = {
      ...(parsed.result && typeof parsed.result === "object" ? parsed.result : {}),
      ...buildCachedInitializeResult(),
    };

    return JSON.stringify({
      ...parsed,
      result: mergedResult,
    });
  }

  function enrichThreadListResponse(rawMessage, parsed) {
    const result = parsed.result;
    const threads = extractThreadListEntries(result);
    if (!threads) {
      return rawMessage;
    }

    for (const thread of threads) {
      projectRuntimeFieldsIntoThread(thread);
    }

    return JSON.stringify({
      ...parsed,
      result: rewrapThreadListResult(result, threads),
    });
  }

  function projectRuntimeFieldsIntoThread(thread) {
    if (!thread || typeof thread !== "object") {
      return thread;
    }

    const threadId = readString(thread.id)
      || readString(thread.threadId)
      || readString(thread.thread_id);
    if (!threadId) {
      return thread;
    }

    const runtime = threadAgentState.getOrBackfillCodex(threadId, {
      cwd: readString(thread.cwd),
    });
    thread.agentRuntime = runtime.agentRuntime;
    thread.agentSessionId = runtime.agentSessionId;
    thread.opencodeBuildAgentName = runtime.opencodeBuildAgentName;
    thread.opencodePlanAgentName = runtime.opencodePlanAgentName;
    return thread;
  }

  function simulateOpenCodeStatusFailureForTests() {
    cachedOpenCodeStatus = null;
    return resolveOpenCodeStatus({
      forceRefresh: true,
    });
  }

  return {
    buildInitializePayload,
    buildInitializeResult,
    buildWarmInitializeResult,
    enrichOutboundResponse,
    handleInboundRequest,
    listAgentRuntimes,
    observeOutboundMessage,
    projectRuntimeFieldsIntoThread,
    refreshInitializeCache,
    resolveOpenCodeStatus,
    simulateOpenCodeStatusFailureForTests,
    threadAgentState,
    validateThreadStartRequest,
  };
}

function extractThreadListEntries(result) {
  if (!result) {
    return null;
  }

  if (Array.isArray(result)) {
    return result;
  }

  if (Array.isArray(result.data)) {
    return result.data;
  }

  if (Array.isArray(result.items)) {
    return result.items;
  }

  if (Array.isArray(result.threads)) {
    return result.threads;
  }

  return null;
}

function rewrapThreadListResult(result, threads) {
  if (Array.isArray(result)) {
    return threads;
  }

  if (Array.isArray(result.data)) {
    return { ...result, data: threads };
  }

  if (Array.isArray(result.items)) {
    return { ...result, items: threads };
  }

  if (Array.isArray(result.threads)) {
    return { ...result, threads };
  }

  return result;
}

function isMissingCommandError(error) {
  return error?.code === "ENOENT"
    || (typeof error?.message === "string" && error.message.includes("ENOENT"));
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  createAgentRuntimeRegistry,
  extractThreadListEntries,
};
