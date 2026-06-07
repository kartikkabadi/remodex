// FILE: opencode-attachments.test.js
// Purpose: Verifies attachment-store threat model and image prompt part wiring.
// Layer: Unit test

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createAttachmentStore,
  isAttachmentsEnabled,
  MAX_IMAGE_BYTES,
} = require("../src/attachment-store");
const { imageItemToPromptPart } = require("../src/opencode-models");

test("isAttachmentsEnabled respects REMODEX_OPENCODE_ATTACHMENTS", () => {
  assert.equal(isAttachmentsEnabled({ REMODEX_OPENCODE_ATTACHMENTS: "0" }), false);
  assert.equal(isAttachmentsEnabled({ REMODEX_OPENCODE_ATTACHMENTS: "1" }), true);
  assert.equal(isAttachmentsEnabled({}), true);
});

test("attachment store writes 0700 dir and UUID filenames", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-attach-"));
  const store = createAttachmentStore({ rootDir });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const stored = store.storeImageBuffer(png, { filename: "shot.png" });
  assert.match(path.basename(stored.path), /^[0-9a-f-]{36}\.png$/u);
  assert.equal(fs.existsSync(stored.path), true);
  const mode = fs.statSync(rootDir).mode & 0o777;
  assert.equal(mode, 0o700);
});

test("attachment store rejects oversize images", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-attach-"));
  const store = createAttachmentStore({ rootDir });
  const big = Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xff);
  assert.throws(() => store.storeImageBuffer(big), /4194304|too large/i);
});

test("imageItemToPromptPart stores data URLs via attachment store", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-attach-"));
  const store = createAttachmentStore({ rootDir });
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const part = imageItemToPromptPart(
    { type: "image", dataURL: dataUrl, filename: "pixel.png" },
    { attachmentStore: store, attachmentsEnabled: true },
  );
  assert.equal(part.type, "file");
  assert.match(part.url, /^file:\/\//);
  assert.equal(part.mime, "image/png");
});