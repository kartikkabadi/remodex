// FILE: telegram-file-change-summary.js
// Purpose: Parse and render turn file-change summaries (TurnFileChangeSummary style).
// Layer: CLI helper
// Exports: parseTelegramFileChangeSummary, renderTelegramTurnFileChangeSummary, mergeFileChangeSummaryText

const INLINE_ACTION_PATTERN = /^(edited|updated|added|created|deleted|removed|renamed|moved)\s+(.+)$/i;
const INLINE_TOTALS_PATTERN = /\+(\d+)\s*[-−–—]\s*(\d+)\s*$/;
const TRAILING_TOTALS_PATTERN = /\s+\+(\d+)\s*[-−–—]\s*(\d+)\s*$/;

function mergeFileChangeSummaryText(existing = "", delta = "") {
  const prior = String(existing || "");
  const next = String(delta || "");
  if (!next) {
    return prior;
  }
  if (!prior) {
    return next;
  }
  if (prior.endsWith(next) || prior.includes(next)) {
    return prior;
  }
  return `${prior}${next}`;
}

function parseTelegramFileChangeSummary(text = "") {
  const normalized = String(text || "");
  if (!normalized.trim()) {
    return null;
  }

  const lines = normalized.split("\n");
  const entriesByPath = new Map();
  const orderedPaths = [];
  let currentPath = "";

  const rememberEntry = (path, additions, deletions, action) => {
    const normalizedPath = normalizeFileChangePath(path);
    if (!normalizedPath) {
      return;
    }
    if (!entriesByPath.has(normalizedPath)) {
      orderedPaths.push(normalizedPath);
    }
    const existing = entriesByPath.get(normalizedPath) || {
      path: normalizedPath,
      additions: 0,
      deletions: 0,
      action: action || "Edited",
    };
    existing.additions += additions;
    existing.deletions += deletions;
    if (action) {
      existing.action = action;
    }
    entriesByPath.set(normalizedPath, existing);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (/^path:/i.test(line)) {
      currentPath = normalizeFileChangePath(line.replace(/^path:\s*/i, ""));
      if (currentPath && !entriesByPath.has(currentPath)) {
        orderedPaths.push(currentPath);
        entriesByPath.set(currentPath, {
          path: currentPath,
          additions: 0,
          deletions: 0,
          action: "Edited",
        });
      }
      continue;
    }

    if (/^kind:/i.test(line) && currentPath) {
      const kind = line.replace(/^kind:\s*/i, "").trim().toLowerCase();
      const action = fileChangeActionFromKind(kind);
      if (action && entriesByPath.has(currentPath)) {
        entriesByPath.get(currentPath).action = action;
      }
      continue;
    }

    if (/^totals:/i.test(line) && currentPath) {
      const totals = parseInlineTotals(line.replace(/^totals:\s*/i, ""));
      if (totals && entriesByPath.has(currentPath)) {
        const entry = entriesByPath.get(currentPath);
        entry.additions += totals.additions;
        entry.deletions += totals.deletions;
      }
      continue;
    }

    const inline = parseInlineFileChangeLine(line);
    if (inline) {
      rememberEntry(inline.path, inline.additions, inline.deletions, inline.action);
      currentPath = inline.path;
    }
  }

  const entries = orderedPaths
    .map((path) => entriesByPath.get(path))
    .filter((entry) => entry && (entry.additions > 0 || entry.deletions > 0 || entry.action));

  if (entries.length === 0) {
    return null;
  }

  return { entries };
}

function parseInlineFileChangeLine(line) {
  let candidate = line.replace(/^[-*•]\s+/, "").replace(/`/g, "").trim();
  if (!candidate) {
    return null;
  }

  const totals = parseInlineTotals(candidate);
  const withoutTotals = stripInlineTotals(candidate).trim();
  const actionMatch = withoutTotals.match(INLINE_ACTION_PATTERN);
  if (actionMatch) {
    const action = fileChangeActionFromVerb(actionMatch[1]);
    const path = normalizeFileChangePath(actionMatch[2]);
    if (!action || !path) {
      return null;
    }
    return {
      path,
      additions: totals?.additions || 0,
      deletions: totals?.deletions || 0,
      action,
    };
  }

  if (!totals) {
    return null;
  }

  const path = normalizeFileChangePath(withoutTotals.split(/\s+/)[0] || "");
  if (!path) {
    return null;
  }

  return {
    path,
    additions: totals.additions,
    deletions: totals.deletions,
    action: "Edited",
  };
}

function parseInlineTotals(value) {
  const match = String(value || "").match(INLINE_TOTALS_PATTERN);
  if (!match) {
    return null;
  }
  return {
    additions: Number.parseInt(match[1], 10) || 0,
    deletions: Number.parseInt(match[2], 10) || 0,
  };
}

function stripInlineTotals(value) {
  return String(value || "").replace(TRAILING_TOTALS_PATTERN, "").trim();
}

function fileChangeActionFromVerb(verb) {
  const normalized = String(verb || "").trim().toLowerCase();
  if (["edited", "updated"].includes(normalized)) {
    return "Edited";
  }
  if (["added", "created"].includes(normalized)) {
    return "Added";
  }
  if (["deleted", "removed"].includes(normalized)) {
    return "Deleted";
  }
  if (["renamed", "moved"].includes(normalized)) {
    return "Renamed";
  }
  return "";
}

function fileChangeActionFromKind(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  if (["update", "updated", "edit", "edited"].includes(normalized)) {
    return "Edited";
  }
  if (["add", "added", "create", "created"].includes(normalized)) {
    return "Added";
  }
  if (["delete", "deleted", "remove", "removed"].includes(normalized)) {
    return "Deleted";
  }
  if (["rename", "renamed", "move", "moved"].includes(normalized)) {
    return "Renamed";
  }
  return "";
}

function normalizeFileChangePath(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\/g, "/");
  if (!normalized || /\s/.test(normalized) && !normalized.includes("/") && !normalized.includes(".")) {
    return "";
  }
  if (/^(file|path):/i.test(normalized)) {
    return "";
  }
  return normalized;
}

function compactFileChangePath(filePath) {
  const parts = String(filePath || "").split("/").filter(Boolean);
  return parts[parts.length - 1] || filePath;
}

function renderTelegramTurnFileChangeSummary(summary = {}) {
  const entries = Array.isArray(summary.entries) ? summary.entries : [];
  if (entries.length === 0) {
    return "";
  }

  const lines = [`Edited ${entries.length} file${entries.length === 1 ? "" : "s"}:`];
  for (const entry of entries.slice(0, 8)) {
    const label = compactFileChangePath(entry.path);
    const additions = Number.isFinite(entry.additions) ? entry.additions : 0;
    const deletions = Number.isFinite(entry.deletions) ? entry.deletions : 0;
    lines.push(`• ${label}  +${additions} / -${deletions}`);
  }
  if (entries.length > 8) {
    lines.push(`...and ${entries.length - 8} more.`);
  }
  return lines.join("\n");
}

function renderTelegramActivityFooterLine(activity = "") {
  const normalized = String(activity || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  const truncated = normalized.length > 96
    ? `${normalized.slice(0, 93)}...`
    : normalized;
  return `↳ ${truncated}`;
}

module.exports = {
  mergeFileChangeSummaryText,
  parseTelegramFileChangeSummary,
  renderTelegramActivityFooterLine,
  renderTelegramTurnFileChangeSummary,
};
