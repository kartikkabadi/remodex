// FILE: opencode-models.js
// Purpose: Normalizes OpenCode CLI model metadata into Remodex provider-aware model entries.
//          Also provides shared serialization, turn parsing, and comparator helpers
//          used by the bridge and provider harness.
// Layer: Bridge runtime provider helper
// Exports: OpenCode provider constants plus model/provider parsing, serialization, and sort helpers.
// Depends on: ./normalize

const { readString } = require("./normalize");

const CODEX_PROVIDER_ID = "codex";
const OPENCODE_PROVIDER_ID = "opencode";
const DEFAULT_OPENCODE_MODEL = "opencode/gpt-5.5";

function normalizeRuntimeProvider(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "":
      return CODEX_PROVIDER_ID;
    case "open-code":
    case "open_code":
      return OPENCODE_PROVIDER_ID;
    default:
      return normalized;
  }
}

function readModelProvider(value = {}) {
  if (!value || typeof value !== "object") {
    return CODEX_PROVIDER_ID;
  }

  return normalizeRuntimeProvider(
    value.modelProvider ||
      value.model_provider ||
      value.provider ||
      value.runtimeProvider ||
      value.runtime_provider ||
      value.harness ||
      value.collaborationMode?.settings?.modelProvider ||
      value.collaborationMode?.settings?.model_provider ||
      value.collaborationMode?.settings?.provider ||
      value.collaboration_mode?.settings?.modelProvider ||
      value.collaboration_mode?.settings?.model_provider ||
      value.collaboration_mode?.settings?.provider,
  );
}

function isOpenCodeProvider(value) {
  return normalizeRuntimeProvider(value) === OPENCODE_PROVIDER_ID;
}

function isCodexProvider(value) {
  return normalizeRuntimeProvider(value) === CODEX_PROVIDER_ID;
}

function buildOpenCodeModelOption(modelReference, { isDefault = false } = {}) {
  const normalizedReference = normalizeOpenCodeModelReference(modelReference);
  if (!normalizedReference) {
    return null;
  }

  return {
    id: normalizedReference,
    model: normalizedReference,
    modelProvider: OPENCODE_PROVIDER_ID,
    provider: OPENCODE_PROVIDER_ID,
    displayName: displayNameForOpenCodeModel(normalizedReference),
    description: `OpenCode local provider model (${normalizedReference})`,
    isDefault,
    supportsFastMode: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
  };
}

function parseOpenCodeModelsOutput(output) {
  const seen = new Set();
  const models = [];
  const lines = String(output || "").split(/\r?\n/);

  for (const line of lines) {
    const modelReference = normalizeOpenCodeModelReference(line);
    if (!modelReference || seen.has(modelReference)) {
      continue;
    }

    seen.add(modelReference);
    models.push(
      buildOpenCodeModelOption(modelReference, {
        isDefault: modelReference === DEFAULT_OPENCODE_MODEL,
      }),
    );
  }

  return models.filter(Boolean);
}

function normalizeOpenCodeModelReference(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.startsWith("{") || normalized.startsWith("[")) {
    return "";
  }
  if (!/^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function displayNameForOpenCodeModel(modelReference) {
  const normalized = normalizeOpenCodeModelReference(modelReference);
  const modelId = normalized.split("/").pop() || normalized;
  const lowered = modelId.toLowerCase();

  if (lowered.startsWith("gpt-")) {
    return `GPT-${modelId.slice(4)}`;
  }
  if (lowered.startsWith("claude-")) {
    return modelId
      .split("-")
      .map((part) => (part.length <= 2 ? part.toUpperCase() : titleCase(part)))
      .join(" ");
  }

  return modelId.split(/[-_]/).map(titleCase).join(" ");
}

function titleCase(value) {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeOpenCodeModel(value) {
  return normalizeOpenCodeModelReference(value) || DEFAULT_OPENCODE_MODEL;
}

function publicThread(thread) {
  return {
    id: thread.id,
    title: thread.title,
    name: thread.title,
    cwd: thread.hasProjectCwd !== false ? thread.cwd : null,
    model: thread.model || DEFAULT_OPENCODE_MODEL,
    modelProvider: OPENCODE_PROVIDER_ID,
    provider: OPENCODE_PROVIDER_ID,
    agent: thread.agent || "",
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    metadata: { provider: OPENCODE_PROVIDER_ID },
  };
}

function buildPromptFromTurnInput(input) {
  if (typeof input === "string") return { inputText: input.trim(), prompt: input.trim() };
  if (!Array.isArray(input)) return { inputText: "", prompt: "" };

  const textParts = [];
  for (const item of input) {
    if (typeof item === "string") {
      appendNonEmpty(textParts, item);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const type = readString(item.type).toLowerCase();
    if (type.includes("image")) {
      const imagePath = readString(item.path || item.url || item.image_url || item.dataURL);
      appendNonEmpty(textParts, imagePath ? `[image attached: ${imagePath}]` : "[image attached]");
      continue;
    }
    appendNonEmpty(textParts, item.text || item.content || item.message);
  }
  const prompt = textParts.join("\n\n").trim();
  return { inputText: prompt, prompt };
}

function messagesToTurns(messages, threadId) {
  const turns = [];
  let currentTurn = null;
  for (const msg of messages) {
    if (!msg) continue;
    const role = readString(msg.role);
    if (role === "user") {
      currentTurn = {
        id: `turn-${turns.length}`,
        model: "",
        status: "completed",
        createdAt: msg.createdAt || new Date().toISOString(),
        items: [
          {
            id: `user-${turns.length}`,
            type: "userMessage",
            role: "user",
            text: readString(msg.content || msg.text),
            content: textContent(readString(msg.content || msg.text)),
            createdAt: msg.createdAt || new Date().toISOString(),
          },
        ],
        metadata: { threadId, provider: OPENCODE_PROVIDER_ID },
      };
      turns.push(currentTurn);
    } else if (role === "assistant" && currentTurn) {
      currentTurn.items.push({
        id: `assistant-${turns.length}`,
        type: "agentMessage",
        role: "assistant",
        phase: "final",
        text: readString(msg.content || msg.text),
        content: textContent(readString(msg.content || msg.text)),
        createdAt: msg.createdAt || new Date().toISOString(),
      });
    }
  }
  return turns;
}

function textContent(text) {
  return [{ type: "text", text: text || "" }];
}

function compareThreadsByUpdatedAt(lhs, rhs) {
  const lhsTime =
    Date.parse(lhs?.updatedAt || lhs?.updated_at || lhs?.createdAt || lhs?.created_at || 0) || 0;
  const rhsTime =
    Date.parse(rhs?.updatedAt || rhs?.updated_at || rhs?.createdAt || rhs?.created_at || 0) || 0;
  return rhsTime - lhsTime;
}

function boundedPositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(Math.floor(numeric), 200);
}

function removeUndefinedValues(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) result[key] = removeUndefinedValues(child);
  }
  return result;
}

function appendNonEmpty(target, value) {
  const text = readString(value);
  if (text) target.push(text);
}

function readThreadId(params = {}) {
  return readString(params.threadId || params.thread_id || params.id);
}

module.exports = {
  CODEX_PROVIDER_ID,
  DEFAULT_OPENCODE_MODEL,
  OPENCODE_PROVIDER_ID,
  appendNonEmpty,
  boundedPositiveInteger,
  buildOpenCodeModelOption,
  buildPromptFromTurnInput,
  compareThreadsByUpdatedAt,
  displayNameForOpenCodeModel,
  isCodexProvider,
  isOpenCodeProvider,
  messagesToTurns,
  normalizeOpenCodeModel,
  normalizeOpenCodeModelReference,
  normalizeRuntimeProvider,
  parseOpenCodeModelsOutput,
  publicThread,
  readModelProvider,
  readThreadId,
  removeUndefinedValues,
  textContent,
};
