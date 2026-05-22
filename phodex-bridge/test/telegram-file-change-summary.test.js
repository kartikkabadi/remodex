// FILE: telegram-file-change-summary.test.js
// Purpose: Verifies turn file-change parsing and rendering for Telegram.
// Layer: Unit Test

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mergeFileChangeSummaryText,
  parseTelegramFileChangeSummary,
  renderTelegramActivityFooterLine,
  renderTelegramTurnFileChangeSummary,
} = require("../src/telegram-file-change-summary");

test("parseTelegramFileChangeSummary consolidates inline edited rows", () => {
  const summary = parseTelegramFileChangeSummary([
    "Edited src/auth.ts +18 -3",
    "Edited tests/auth.test.ts +42 -0",
  ].join("\n"));

  assert.equal(summary.entries.length, 2);
  assert.equal(summary.entries[0].path, "src/auth.ts");
  assert.equal(summary.entries[0].additions, 18);
  assert.equal(summary.entries[0].deletions, 3);
});

test("renderTelegramTurnFileChangeSummary matches TurnFileChangeSummary style", () => {
  const text = renderTelegramTurnFileChangeSummary({
    entries: [
      { path: "src/auth.ts", additions: 18, deletions: 3, action: "Edited" },
      { path: "tests/auth.test.ts", additions: 42, deletions: 0, action: "Edited" },
    ],
  });

  assert.equal(
    text,
    "Edited 2 files:\n• auth.ts  +18 / -3\n• auth.test.ts  +42 / -0",
  );
});

test("mergeFileChangeSummaryText appends streaming deltas without duplication", () => {
  const merged = mergeFileChangeSummaryText("Edited src/auth.ts +1 -0", "+2 -1");
  assert.equal(merged, "Edited src/auth.ts +1 -0+2 -1");
  assert.equal(mergeFileChangeSummaryText("same", "same"), "same");
});

test("renderTelegramActivityFooterLine stays single-line", () => {
  assert.equal(
    renderTelegramActivityFooterLine("running tests in auth/"),
    "↳ running tests in auth/",
  );
});
