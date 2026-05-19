// FILE: telegram-feedback.test.js
// Purpose: Verifies Telegram feedback mailto construction stays useful and sanitized.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/telegram-feedback

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");

const {
  buildTelegramFeedbackMailtoUrl,
} = require("../src/telegram-feedback");

test("telegram feedback mailto includes useful sanitized context", () => {
  const mailto = buildTelegramFeedbackMailtoUrl({
    message: `It failed in ${os.homedir()}/Projects/remodex\nPlease check it.`,
    threadId: "019e2d3d-d98f-7772-9b0e-ccec66bfabbc",
    bridgeStatus: { connectionStatus: "connected", codexLaunchState: { status: "ready" } },
    bridgeVersion: "1.5.2-beta.0",
    now: () => new Date("2026-05-17T06:20:14.300Z"),
  });

  assert.match(mailto, /^mailto:emandipietro@gmail\.com\?/);
  const params = new URLSearchParams(mailto.split("?")[1]);
  const body = params.get("body");

  assert.equal(params.get("subject"), "Share Feedback on Remodex with the Developer");
  assert.match(body, /It failed in ~\/Projects\/remodex/);
  assert.match(body, /Please check it/);
  assert.match(body, /- Source: Remodex Telegram/);
  assert.match(body, /- Thread: 019e2d3d\.\.\.abbc/);
  assert.match(body, /- Bridge: connected/);
  assert.match(body, /- Codex: ready/);
  assert.match(body, /- Remodex CLI: 1\.5\.2-beta\.0/);
  assert.doesNotMatch(body, new RegExp(escapeRegExp(os.homedir())));
  assert.doesNotMatch(body, /019e2d3d-d98f-7772-9b0e-ccec66bfabbc/);
});

test("telegram feedback mailto falls back to an editable body", () => {
  const mailto = buildTelegramFeedbackMailtoUrl({
    now: () => new Date("2026-05-17T06:20:14.300Z"),
  });
  const body = new URLSearchParams(mailto.split("?")[1]).get("body");

  assert.match(body, /Write the feedback here/);
  assert.doesNotMatch(body, /Thread:/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
