// FILE: telegram-bot-api-client.test.js
// Purpose: Verifies Telegram Bot API client request shaping and retry hints.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/telegram-bot-api-client

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TELEGRAM_CALLBACK_ANSWER_TEXT_MAX_CHARS,
  TELEGRAM_MESSAGE_TEXT_MAX_CHARS,
  TELEGRAM_TRUNCATION_SUFFIX,
  createTelegramBotApiClient,
} = require("../src/telegram-bot-api-client");

test("telegram bot api client sends messages without exposing the token in errors", async () => {
  const requests = [];
  const client = createTelegramBotApiClient({
    botToken: "123456:secret-token",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ ok: true, result: { message_id: 7 } });
    },
  });

  const result = await client.sendMessage({ chatId: "42", text: "Bridge: connected" });

  assert.equal(result.message_id, 7);
  assert.equal(requests[0].url, "https://api.telegram.org/bot123456:secret-token/sendMessage");
  assert.deepEqual(JSON.parse(requests[0].options.body), { chat_id: "42", text: "Bridge: connected" });
});

test("telegram bot api client registers the command menu", async () => {
  const requests = [];
  const client = createTelegramBotApiClient({
    botToken: "123456:secret-token",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ ok: true, result: true });
    },
  });

  const commands = [{ command: "status", description: "Show status" }];
  const result = await client.setMyCommands({ commands });

  assert.equal(result, true);
  assert.equal(requests[0].url, "https://api.telegram.org/bot123456:secret-token/setMyCommands");
  assert.deepEqual(JSON.parse(requests[0].options.body), { commands });
});

test("telegram bot api client reads the bot identity", async () => {
  const requests = [];
  const client = createTelegramBotApiClient({
    botToken: "123456:secret-token",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ ok: true, result: { id: 123456, username: "RemodexBot" } });
    },
  });

  const result = await client.getMe();

  assert.deepEqual(result, { id: 123456, username: "RemodexBot" });
  assert.equal(requests[0].url, "https://api.telegram.org/bot123456:secret-token/getMe");
  assert.deepEqual(JSON.parse(requests[0].options.body), {});
});

test("telegram bot api client bounds message and edit text", async () => {
  const requests = [];
  const client = createTelegramBotApiClient({
    botToken: "123456:secret-token",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ ok: true, result: { message_id: 7 } });
    },
  });

  const longText = "A".repeat(TELEGRAM_MESSAGE_TEXT_MAX_CHARS + 10);
  await client.sendMessage({ chatId: "42", text: longText });
  await client.editMessageText({ chatId: "42", messageId: 7, text: longText });

  const sentPayload = JSON.parse(requests[0].options.body);
  const editedPayload = JSON.parse(requests[1].options.body);
  assert.equal(sentPayload.text.length, TELEGRAM_MESSAGE_TEXT_MAX_CHARS);
  assert.equal(editedPayload.text.length, TELEGRAM_MESSAGE_TEXT_MAX_CHARS);
  assert.equal(sentPayload.text.endsWith(TELEGRAM_TRUNCATION_SUFFIX), true);
  assert.equal(editedPayload.text.endsWith(TELEGRAM_TRUNCATION_SUFFIX), true);
});

test("telegram bot api client bounds callback answer text", async () => {
  const requests = [];
  const client = createTelegramBotApiClient({
    botToken: "123456:secret-token",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ ok: true, result: true });
    },
  });

  const longText = `${"A".repeat(TELEGRAM_CALLBACK_ANSWER_TEXT_MAX_CHARS)}extra`;
  const result = await client.answerCallbackQuery({ callbackQueryId: "callback-1", text: longText });

  assert.equal(result, true);
  assert.equal(requests[0].url, "https://api.telegram.org/bot123456:secret-token/answerCallbackQuery");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    callback_query_id: "callback-1",
    text: "A".repeat(TELEGRAM_CALLBACK_ANSWER_TEXT_MAX_CHARS),
  });
});

test("telegram bot api client resolves and downloads files without leaking the token", async () => {
  const requests = [];
  const client = createTelegramBotApiClient({
    botToken: "123456:secret-token",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/getFile")) {
        return jsonResponse({ ok: true, result: { file_path: "photos/file_1.jpg" } });
      }
      return binaryResponse(Buffer.from("image-bytes"), { contentType: "image/jpeg" });
    },
  });

  const file = await client.getFile({ fileId: "photo-file-id" });
  const downloaded = await client.downloadFile({ filePath: file.file_path });

  assert.deepEqual(file, { file_path: "photos/file_1.jpg" });
  assert.equal(downloaded.data.toString("utf8"), "image-bytes");
  assert.equal(downloaded.contentType, "image/jpeg");
  assert.equal(requests[0].url, "https://api.telegram.org/bot123456:secret-token/getFile");
  assert.deepEqual(JSON.parse(requests[0].options.body), { file_id: "photo-file-id" });
  assert.equal(requests[1].url, "https://api.telegram.org/file/bot123456:secret-token/photos/file_1.jpg");
  assert.equal(requests[1].options.method, "GET");
});

test("telegram bot api client sanitizes file download transport failures", async () => {
  const client = createTelegramBotApiClient({
    botToken: "123456:secret-token",
    fetchImpl: async () => {
      throw new Error("request failed for https://api.telegram.org/file/bot123456:secret-token/photos/file_1.jpg");
    },
  });

  await assert.rejects(
    () => client.downloadFile({ filePath: "photos/file_1.jpg" }),
    (error) => {
      assert.doesNotMatch(error.message, /bot123456/);
      assert.doesNotMatch(error.message, /secret-token/);
      assert.match(error.message, /Telegram Bot API file download failed/);
      return true;
    }
  );
});

test("telegram bot api client sanitizes file download body failures", async () => {
  const client = createTelegramBotApiClient({
    botToken: "123456:secret-token",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/jpeg" },
      async arrayBuffer() {
        throw new Error("body read failed for https://api.telegram.org/file/bot123456:secret-token/photos/file_1.jpg");
      },
    }),
  });

  await assert.rejects(
    () => client.downloadFile({ filePath: "photos/file_1.jpg" }),
    (error) => {
      assert.doesNotMatch(error.message, /bot123456/);
      assert.doesNotMatch(error.message, /secret-token/);
      assert.match(error.message, /Telegram Bot API file download failed/);
      assert.match(error.message, /bot<redacted>/);
      return true;
    }
  );
});

test("telegram bot api client sanitizes api error descriptions", async () => {
  const client = createTelegramBotApiClient({
    botToken: "123456:secret-token",
    fetchImpl: async () => jsonResponse({
      ok: false,
      description: "Bad request for bot123456:secret-token via https://api.telegram.org/bot123456:secret-token/sendMessage",
    }, { status: 400 }),
  });

  await assert.rejects(
    () => client.sendMessage({ chatId: "42", text: "Bridge: connected" }),
    (error) => {
      assert.doesNotMatch(error.message, /bot123456/);
      assert.doesNotMatch(error.message, /secret-token/);
      assert.match(error.message, /Telegram Bot API sendMessage failed/);
      assert.match(error.message, /bot<redacted>/);
      return true;
    }
  );
});

test("telegram bot api client sanitizes malformed json api responses", async () => {
  const client = createTelegramBotApiClient({
    botToken: "123456:secret-token",
    fetchImpl: async () => ({
      ok: false,
      status: 502,
      async json() {
        throw new Error("Unexpected HTML from https://api.telegram.org/bot123456:secret-token/getUpdates");
      },
    }),
  });

  await assert.rejects(
    () => client.getUpdates(),
    (error) => {
      assert.equal(error.message, "Telegram Bot API getUpdates failed: invalid JSON response");
      assert.doesNotMatch(error.message, /bot123456/);
      assert.doesNotMatch(error.message, /secret-token/);
      assert.doesNotMatch(error.message, /Unexpected HTML/);
      return true;
    }
  );
});

test("telegram bot api client throws retry_after without leaking token", async () => {
  const client = createTelegramBotApiClient({
    botToken: "123456:secret-token",
    fetchImpl: async () => jsonResponse({
      ok: false,
      description: "Too Many Requests",
      parameters: { retry_after: 3 },
    }, { status: 429 }),
  });

  await assert.rejects(
    () => client.getUpdates({ offset: 10, timeout: 20 }),
    (error) => {
      assert.equal(error.retryAfterSeconds, 3);
      assert.doesNotMatch(error.message, /secret-token/);
      return true;
    }
  );
});

test("telegram bot api client sanitizes transport failures", async () => {
  const client = createTelegramBotApiClient({
    botToken: "123456:secret-token",
    fetchImpl: async () => {
      throw new Error("request failed for https://api.telegram.org/bot123456:secret-token/getUpdates");
    },
  });

  await assert.rejects(
    () => client.getUpdates(),
    (error) => {
      assert.doesNotMatch(error.message, /secret-token/);
      assert.match(error.message, /Telegram Bot API getUpdates failed/);
      return true;
    }
  );
});

function jsonResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function binaryResponse(buffer, { status = 200, contentType = "application/octet-stream" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? contentType : "";
      },
    },
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}
