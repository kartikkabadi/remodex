// FILE: opencode-export.js
// Purpose: Parses OpenCode `export` JSON output into Remodex-compatible turn arrays.
//          Filters sanitized text placeholders and merges stored turns with exported history.
// Layer: Bridge runtime provider helper
// Exports: parseOpenCodeExport
// Depends on: none

function parseOpenCodeExport(output, thread) {
  const parsed = safeParseJSON(output);
  const messages = Array.isArray(parsed?.messages)
    ? parsed.messages.slice(-200)
    : [];
  const turns = [];
  let currentTurn = null;

  for (const message of messages) {
    const role = readString(message?.info?.role || message?.role).toLowerCase();
    const text = textFromExportedMessage(message);
    if (!text) {
      continue;
    }

    if (role === "user" || !currentTurn) {
      currentTurn = {
        id: readString(message?.info?.id) || `${turns.length + 1}`,
        status: "completed",
        createdAt: normalizeDateString(message?.info?.time?.created || message?.created),
        completedAt: normalizeDateString(message?.info?.time?.updated || message?.updated),
        items: [],
      };
      turns.push(currentTurn);
    }

    currentTurn.items.push({
      id: readString(message?.info?.id) || `${currentTurn.id}-${role || "message"}-${currentTurn.items.length}`,
      type: role === "user" ? "userMessage" : "agentMessage",
      role: role === "user" ? "user" : "assistant",
      phase: role === "assistant" ? "final" : undefined,
      text,
      content: textContent(text),
      createdAt: currentTurn.createdAt,
    });

    if (role === "assistant") {
      currentTurn = null;
    }
  }

  if (thread?.turns?.length) {
    return mergeStoredAndExportedTurns(thread.turns, turns);
  }
  return turns;
}

function mergeStoredAndExportedTurns(storedTurns, exportedTurns) {
  const result = [];
  const seenKeys = new Set();
  const storedByFingerprint = new Map();

  for (const turn of storedTurns) {
    const fingerprint = turnFingerprint(turn);
    if (fingerprint && !storedByFingerprint.has(fingerprint)) {
      storedByFingerprint.set(fingerprint, turn);
    }
  }

  for (const exportedTurn of exportedTurns) {
    const fingerprint = turnFingerprint(exportedTurn);
    const turn = (fingerprint && storedByFingerprint.get(fingerprint)) || exportedTurn;
    appendUniqueTurn(result, seenKeys, turn);
  }
  for (const turn of storedTurns) {
    appendUniqueTurn(result, seenKeys, turn);
  }
  return result;
}

function appendUniqueTurn(result, seenKeys, turn) {
  const keys = turnDeduplicationKeys(turn);
  if (!keys.length || keys.some((key) => seenKeys.has(key))) {
    return;
  }
  for (const key of keys) {
    seenKeys.add(key);
  }
  result.push(turn);
}

function turnDeduplicationKeys(turn) {
  if (!turn || typeof turn !== "object") {
    return [];
  }
  const keys = [];
  const id = readString(turn.id);
  if (id) {
    keys.push(`id:${id}`);
  }
  const fingerprint = turnFingerprint(turn);
  if (fingerprint) {
    keys.push(`fp:${fingerprint}`);
  }
  return keys;
}

function turnFingerprint(turn) {
  const userText = firstItemText(turn, "userMessage");
  const assistantText = firstItemText(turn, "agentMessage");
  if (!userText || !assistantText) {
    return "";
  }
  return `${normalizeFingerprintText(userText)}\n---\n${normalizeFingerprintText(assistantText)}`;
}

function firstItemText(turn, itemType) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (const item of items) {
    if (item?.type !== itemType) {
      continue;
    }
    const text = readString(item.text || item.message);
    if (text) {
      return text;
    }
  }
  return "";
}

function normalizeFingerprintText(value) {
  return readString(value).replace(/\s+/g, " ");
}

function textFromExportedMessage(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      if (part.type === "text" || part.type === "reasoning") {
        const text = readString(part.text);
        return isRedactedTextPlaceholder(text) ? "" : text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function textContent(text) {
  return [{ type: "text", text: text || "" }];
}

function normalizeDateString(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 10_000_000_000 ? value * 1000 : value;
    return new Date(milliseconds).toISOString();
  }
  const normalized = readString(value);
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function safeParseJSON(rawValue) {
  try {
    return JSON.parse(String(rawValue || ""));
  } catch {
    return null;
  }
}

function isRedactedTextPlaceholder(value) {
  return /^\[redacted:text:prt_[A-Za-z0-9_-]+\]$/.test(readString(value));
}

module.exports = { parseOpenCodeExport };
