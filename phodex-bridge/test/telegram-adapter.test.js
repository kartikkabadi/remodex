// FILE: telegram-adapter.test.js
// Purpose: Verifies Telegram adapter command routing, allowlisting, and callback handling.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/telegram-adapter

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  TELEGRAM_ACTIVE_THREAD_COMMANDS,
  TELEGRAM_COMMAND_MENU,
  createTelegramAdapter,
  createTelegramAdapterFromBridgeConfig,
  parseTelegramCommand,
} = require("../src/telegram-adapter");
const {
  TELEGRAM_CALLBACK_COMMANDS,
  TELEGRAM_PRIMARY_COMMAND_HELP_GROUPS,
} = require("../src/telegram-command-catalog");
const {
  createTelegramLinkCode,
  linkTelegramChat,
  readTelegramSessionState,
  setTelegramActiveThread,
  unlinkTelegramChat,
} = require("../src/telegram-session-state");

test("parseTelegramCommand recognizes supported commands including continue", () => {
  assert.deepEqual(parseTelegramCommand("/status"), { name: "status", arg: "" });
  assert.deepEqual(parseTelegramCommand("/menu"), { name: "menu", arg: "" });
  assert.deepEqual(parseTelegramCommand("/account"), { name: "account", arg: "" });
  assert.deepEqual(parseTelegramCommand("/limits"), { name: "limits", arg: "" });
  assert.deepEqual(parseTelegramCommand("/usage"), { name: "usage", arg: "" });
  assert.deepEqual(parseTelegramCommand("/version"), { name: "version", arg: "" });
  assert.deepEqual(parseTelegramCommand("/upgrade"), { name: "upgrade", arg: "" });
  assert.deepEqual(parseTelegramCommand("/feedback The app feels great"), { name: "feedback", arg: "The app feels great" });
  assert.deepEqual(parseTelegramCommand("/login"), { name: "login", arg: "" });
  assert.deepEqual(parseTelegramCommand("/cancel_login"), { name: "cancel_login", arg: "" });
  assert.deepEqual(parseTelegramCommand("/logout"), { name: "logout", arg: "" });
  assert.deepEqual(parseTelegramCommand("/resume"), { name: "resume", arg: "" });
  assert.deepEqual(parseTelegramCommand("/start"), { name: "start", arg: "" });
  assert.deepEqual(parseTelegramCommand("/help git"), { name: "help", arg: "git" });
  assert.deepEqual(parseTelegramCommand("/threads telegram"), { name: "threads", arg: "telegram" });
  assert.deepEqual(parseTelegramCommand("/archived cleanup"), { name: "archived", arg: "cleanup" });
  assert.deepEqual(parseTelegramCommand("/thread 2"), { name: "thread", arg: "2" });
  assert.deepEqual(parseTelegramCommand("/thread 019e2f0f-12a2-7263-8936-9a74f86972ec"), {
    name: "thread",
    arg: "019e2f0f-12a2-7263-8936-9a74f86972ec",
  });
  assert.deepEqual(parseTelegramCommand("/rename Telegram support"), { name: "rename", arg: "Telegram support" });
  assert.deepEqual(parseTelegramCommand("/title Fix the sidebar title"), { name: "title", arg: "Fix the sidebar title" });
  assert.deepEqual(parseTelegramCommand("/projects remodex"), { name: "projects", arg: "remodex" });
  assert.deepEqual(parseTelegramCommand("/browse /Users/user/Documents"), { name: "browse", arg: "/Users/user/Documents" });
  assert.deepEqual(parseTelegramCommand("/mkdir New App"), { name: "mkdir", arg: "New App" });
  assert.deepEqual(parseTelegramCommand("/new"), { name: "new", arg: "" });
  assert.deepEqual(parseTelegramCommand("/new /Users/user/Documents/Projects/remodex"), {
    name: "new",
    arg: "/Users/user/Documents/Projects/remodex",
  });
  assert.deepEqual(parseTelegramCommand("/fork"), { name: "fork", arg: "" });
  assert.deepEqual(parseTelegramCommand("/activity"), { name: "activity", arg: "" });
  assert.deepEqual(parseTelegramCommand("/activity 8"), { name: "activity", arg: "8" });
  assert.deepEqual(parseTelegramCommand("/checkpoint"), { name: "checkpoint", arg: "" });
  assert.deepEqual(parseTelegramCommand("/compact"), { name: "compact", arg: "" });
  assert.deepEqual(parseTelegramCommand("/context"), { name: "context", arg: "" });
  assert.deepEqual(parseTelegramCommand("/open"), { name: "open", arg: "" });
  assert.deepEqual(parseTelegramCommand("/wake"), { name: "wake", arg: "" });
  assert.deepEqual(parseTelegramCommand("/prefs"), { name: "prefs", arg: "" });
  assert.deepEqual(parseTelegramCommand("/pets"), { name: "pets", arg: "" });
  assert.deepEqual(parseTelegramCommand("/skills refactor"), { name: "skills", arg: "refactor" });
  assert.deepEqual(parseTelegramCommand("/plugins github"), { name: "plugins", arg: "github" });
  assert.deepEqual(parseTelegramCommand("/model gpt-5.4-mini high"), { name: "model", arg: "gpt-5.4-mini high" });
  assert.deepEqual(parseTelegramCommand("/access full"), { name: "access", arg: "full" });
  assert.deepEqual(parseTelegramCommand("/keep_awake off"), { name: "keep_awake", arg: "off" });
  assert.deepEqual(parseTelegramCommand("/init"), { name: "init", arg: "" });
  assert.deepEqual(parseTelegramCommand("/log"), { name: "log", arg: "" });
  assert.deepEqual(parseTelegramCommand("/remote"), { name: "remote", arg: "" });
  assert.deepEqual(parseTelegramCommand("/branches"), { name: "branches", arg: "" });
  assert.deepEqual(parseTelegramCommand("/branch telegram-support"), { name: "branch", arg: "telegram-support" });
  assert.deepEqual(parseTelegramCommand("/worktree telegram-support"), { name: "worktree", arg: "telegram-support" });
  assert.deepEqual(parseTelegramCommand("/checkout feature/telegram"), { name: "checkout", arg: "feature/telegram" });
  assert.deepEqual(parseTelegramCommand("/pull"), { name: "pull", arg: "" });
  assert.deepEqual(parseTelegramCommand("/reset_remote"), { name: "reset_remote", arg: "" });
  assert.deepEqual(parseTelegramCommand("/stash"), { name: "stash", arg: "" });
  assert.deepEqual(parseTelegramCommand("/stash_pop"), { name: "stash_pop", arg: "" });
  assert.deepEqual(parseTelegramCommand("/commit Add Telegram support"), { name: "commit", arg: "Add Telegram support" });
  assert.deepEqual(parseTelegramCommand("/draft_commit"), { name: "draft_commit", arg: "" });
  assert.deepEqual(parseTelegramCommand("/push"), { name: "push", arg: "" });
  assert.deepEqual(parseTelegramCommand("/draft_pr"), { name: "draft_pr", arg: "" });
  assert.deepEqual(parseTelegramCommand("/pr"), { name: "pr", arg: "" });
  assert.deepEqual(parseTelegramCommand("/ship Add Telegram support"), { name: "ship", arg: "Add Telegram support" });
  assert.deepEqual(parseTelegramCommand("/review base main"), { name: "review", arg: "base main" });
  assert.deepEqual(parseTelegramCommand("/subagents audit the Telegram integration"), {
    name: "subagents",
    arg: "audit the Telegram integration",
  });
  assert.deepEqual(parseTelegramCommand("/pending"), { name: "pending", arg: "" });
  assert.deepEqual(parseTelegramCommand("/plan Deslop the Telegram integration"), { name: "plan", arg: "Deslop the Telegram integration" });
  assert.deepEqual(parseTelegramCommand("/continue later"), { name: "continue", arg: "later" });
  assert.deepEqual(parseTelegramCommand("/unlink"), { name: "unlink", arg: "" });
});

test("telegram adapter registers the bot command menu on start", async () => {
  const commandMenus = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot([], [], commandMenus),
    pollIntervalMs: 60_000,
  });

  await adapter.start();
  adapter.stop();

  assert.deepEqual(commandMenus, [TELEGRAM_COMMAND_MENU]);
  for (const command of commandMenus[0]) {
    assert.match(command.command, /^[a-z0-9_]{1,32}$/);
    assert.equal(typeof command.description, "string");
    assert.ok(command.description.length > 0 && command.description.length <= 256);
  }
});

test("telegram adapter discovers its bot username and ignores commands addressed to another bot", async () => {
  const messages = [];
  const commandMenus = [];
  const calls = [];
  const adapter = createTelegramAdapter({
    botClient: {
      ...fakeBot(messages, [], commandMenus),
      getMe: async () => ({ username: "RemodexBot" }),
      getUpdates: async () => [
        messageUpdate({ text: "/status@OtherBot", chatId: 42 }),
        messageUpdate({ text: "/status@RemodexBot", chatId: 42 }),
      ],
    },
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
    controlSurface: {
      readStatus: async () => {
        calls.push("readStatus");
        return { bridgeStatus: { connectionStatus: "connected" } };
      },
    },
    pollIntervalMs: 60_000,
  });

  await adapter.start();
  adapter.stop();

  assert.deepEqual(commandMenus, [TELEGRAM_COMMAND_MENU]);
  assert.deepEqual(calls, ["readStatus"]);
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /Bridge: connected/);
});

test("telegram adapter can use a configured bot username before polling starts", async () => {
  const messages = [];
  const calls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    botUsername: "@RemodexBot",
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
    controlSurface: {
      readStatus: async () => {
        calls.push("readStatus");
        return { bridgeStatus: { connectionStatus: "connected" } };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/status@OtherBot", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/status@RemodexBot", chatId: 42 }));

  assert.deepEqual(calls, ["readStatus"]);
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /Bridge: connected/);
});

test("telegram help stays aligned with the command picker source", async () => {
  const messages = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/help", chatId: 42 }));

  for (const group of TELEGRAM_PRIMARY_COMMAND_HELP_GROUPS) {
    for (const command of group.commands) {
      assert.match(messages[0].text, new RegExp(`/${command}\\b`));
    }
  }
  assert.match(messages[0].text, /^Remodex Telegram\nType a message to chat with Codex\./);
  assert.equal(callbackDataForButton(messages[0], "Status").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Threads").startsWith("a:"), true);
  assert.match(messages[0].text, /\/plan <message>/);
  assert.match(messages[0].text, /\/continue <message>/);
  assert.doesNotMatch(messages[0].text, /\/ship <message>/);
});

test("telegram help can focus a section without showing the whole catalog", async () => {
  const messages = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/help git", chatId: 42 }));

  assert.match(messages[0].text, /^Git commands:\n/);
  assert.match(messages[0].text, /\/branch <name>/);
  assert.match(messages[0].text, /\/review <changes\|base <branch>>/);
  assert.doesNotMatch(messages[0].text, /\/feedback/);
  assert.equal(callbackDataForButton(messages[0], "Status").startsWith("a:"), true);
});

test("telegram workflow help buttons render catalog-owned help topics", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const unlinked = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }], pendingLinkCode: null }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/help commit_ship", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/help git_maintenance", chatId: 42 }));

  assert.match(messages[0].text, /^Commit and Ship commands:\n/);
  assert.match(messages[0].text, /\/commit <message>/);
  assert.match(messages[0].text, /\/ship <message>/);
  assert.match(messages[1].text, /^Git Maintenance commands:\n/);
  assert.match(messages[1].text, /\/stash_pop/);
  assert.deepEqual(callbacks, []);
});

test("telegram command picker entries route as slash commands", async () => {
  for (const { command } of TELEGRAM_COMMAND_MENU) {
    const { adapter, messages } = createCommandPickerHarness();
    const beforeCount = messages.length;
    await adapter.handleUpdate(messageUpdate({ text: `/${command}`, chatId: 42 }));
    const lastText = messages.at(-1).text;
    assert.ok(messages.length > beforeCount, `/${command} should send a Telegram response`);
    assert.doesNotMatch(lastText, /^Remodex could not complete/, `/${command} should not hit command error handling`);
    assert.doesNotMatch(lastText, /Unsupported action|Action expired|is not a function|not wired/i);
    if (!["start", "help"].includes(command)) {
      assert.doesNotMatch(lastText, /^Commands:\n/, `/${command} should not fall back to generic help`);
    }
  }
});

test("telegram callback command catalog matches adapter command callback handlers", () => {
  const adapterSource = fs.readFileSync(path.join(__dirname, "../src/telegram-adapter.js"), "utf8");
  const handledCommandCallbacks = new Set(
    [...adapterSource.matchAll(/action\.type === "command\.([a-z0-9_]+)"/g)]
      .map((match) => match[1])
  );
  const catalogCommandCallbacks = new Set(TELEGRAM_CALLBACK_COMMANDS);

  assert.deepEqual(
    [...catalogCommandCallbacks].filter((command) => !handledCommandCallbacks.has(command)),
    [],
    "catalog callback commands should have adapter handlers",
  );
  assert.deepEqual(
    [...handledCommandCallbacks].filter((command) => !catalogCommandCallbacks.has(command)).sort(),
    [],
    "adapter command callback handlers should be declared in the catalog",
  );
});

test("telegram adapter lists local Codex pets without exposing preview assets", async () => {
  const messages = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
    controlSurface: {
      readPets: async () => ({
        pets: [{
          displayName: "Icarus",
          kind: "pet",
          spritesheetDataUrl: "data:image/png;base64,SECRET",
          spritesheetPath: "/Users/user/.codex/pets/icarus/spritesheet.png",
        }],
        errors: [{ folderName: "broken-pet", errorCode: "pet_spritesheet_path_invalid" }],
      }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/pets", chatId: 42 }));

  assert.match(messages[0].text, /Codex pets: 1 available\./);
  assert.match(messages[0].text, /- Icarus \(pet\)/);
  assert.match(messages[0].text, /1 local package errors hidden\./);
  assert.doesNotMatch(messages[0].text, /data:image|SECRET|\/Users\/user|spritesheet/);
  assert.equal(callbackDataForButton(messages[0], "Refresh").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Menu").startsWith("a:"), true);
});

test("telegram adapter lists active-thread skills and plugins without local paths", async () => {
  const messages = [];
  const calls = [];
  const state = {
    linkedChats: [{ chatId: "42", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: { read: () => state },
    controlSurface: {
      listSkills: async ({ threadId, cwd, query }) => {
        calls.push(["skills", threadId, cwd, query]);
        return {
          data: [{
            skills: [{
              name: "frontend-refactor",
              description: "Improve existing client surfaces.",
              path: "/Users/user/.agents/skills/frontend-refactor/SKILL.md",
              enabled: true,
            }],
          }],
        };
      },
      listPlugins: async ({ threadId, cwd, query }) => {
        calls.push(["plugins", threadId, cwd, query]);
        return {
          marketplaces: [{
            name: "openai-curated",
            path: "/Users/user/.codex/plugins/cache/openai-curated",
            plugins: [{
              name: "github",
              installed: true,
              interface: { displayName: "GitHub", shortDescription: "Inspect repositories." },
            }],
          }],
        };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/skills front", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/plugins git", chatId: 42 }));

  assert.deepEqual(calls, [
    ["skills", "thread-1", "/tmp/current", "front"],
    ["plugins", "thread-1", "/tmp/current", "git"],
  ]);
  assert.match(messages[0].text, /Skills matching "front": 1 available\./);
  assert.match(messages[0].text, /frontend-refactor/);
  assert.doesNotMatch(messages[0].text, /\/Users\/user|SKILL\.md/);
  assert.equal(callbackDataForButton(messages[0], "Refresh").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Plugins").startsWith("a:"), true);
  assert.match(messages[1].text, /Plugins matching "git": 1 available\./);
  assert.match(messages[1].text, /GitHub/);
  assert.doesNotMatch(messages[1].text, /\/Users\/user|plugins\/cache/);
  assert.equal(callbackDataForButton(messages[1], "Refresh").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[1], "Skills").startsWith("a:"), true);
});

test("telegram adapter shows account rate limits without raw account payload fields", async () => {
  const messages = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
    controlSurface: {
      readRateLimits: async () => ({
        rateLimitsByLimitId: {
          codex_5h: {
            limitId: "codex_5h",
            primary: {
              usedPercent: 20,
              windowDurationMins: 300,
              token: "secret-token",
            },
          },
        },
      }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/limits", chatId: 42 }));

  assert.equal(messages[0].text, "Rate limits:\n- 5h: 80% left");
  assert.doesNotMatch(messages[0].text, /codex_5h|secret-token/);
  assert.equal(callbackDataForButton(messages[0], "Refresh").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Account").startsWith("a:"), true);
});

test("telegram adapter shows combined usage for the active linked thread", async () => {
  const messages = [];
  const callbacks = [];
  const calls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    sessionState: {
      read: () => ({
        linkedChats: [{
          chatId: "42",
          activeThreadId: "thread-usage",
          activeThreadCwd: "/tmp/current",
        }],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      readUsageStatus: async ({ threadId }) => {
        calls.push(threadId);
        return {
          context: { usage: { tokensUsed: 200_930, tokenLimit: 258_400 } },
          rateLimits: {
            rateLimitsByLimitId: {
              codex_5h: {
                limitId: "codex_5h",
                primary: {
                  usedPercent: 20,
                  windowDurationMins: 300,
                  token: "secret-token",
                },
              },
            },
          },
        };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/usage", chatId: 42 }));
  const refreshCallback = callbackDataForButton(messages[0], "Refresh");
  await adapter.handleUpdate(callbackUpdate({
    callbackData: refreshCallback,
    chatId: 42,
    callbackQueryId: "cb-usage",
  }));

  assert.deepEqual(calls, ["thread-usage", "thread-usage"]);
  assert.equal(
    messages[0].text,
    "Usage:\nContext: 200,930 / 258,400 tokens (78%).\nRate limits:\n- 5h: 80% left"
  );
  assert.doesNotMatch(messages[0].text, /codex_5h|secret-token/);
  assert.equal(callbackDataForButton(messages[0], "Limits").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Context").startsWith("a:"), true);
  assert.equal(messages[1].text, messages[0].text);
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-usage", text: "Usage refreshed." }]);
});

test("telegram adapter shows usage without requiring an active thread", async () => {
  const messages = [];
  const calls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
    controlSurface: {
      readUsageStatus: async ({ threadId }) => {
        calls.push(threadId);
        return {
          context: null,
          rateLimits: {
            rateLimitsByLimitId: {
              codex_5h: { primary: { usedPercent: 20, windowDurationMins: 300 } },
            },
          },
        };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/usage", chatId: 42 }));

  assert.deepEqual(calls, [undefined]);
  assert.equal(messages[0].text, "Usage:\nContext: no active thread selected.\nRate limits:\n- 5h: 80% left");
  assert.equal(callbackDataForButton(messages[0], "Refresh").startsWith("a:"), true);
  assert.throws(() => callbackDataForButton(messages[0], "Context"), /button not found/);
});

test("telegram adapter links a chat by pending code before allowlist checks", async () => {
  const messages = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [], pendingLinkCode: { code: "ABC234", expiresAt: 2_000 } }),
      link: ({ chatId, code }) => ({ linkedChats: [{ chatId: String(chatId), chatTitle: "Kartik", linkedAt: 1_000 }], code }),
    },
    now: () => 1_000,
  });

  await adapter.handleUpdate(messageUpdate({ text: "/link ABC234", chatId: 42, chatTitle: "Kartik" }));

  assert.deepEqual(messages, [{ chatId: "42", text: "Linked this Telegram chat to Remodex." }]);
});

test("telegram adapter unlinks the current linked chat", async () => {
  const messages = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => state,
      unlink: ({ chatId }) => {
        state.linkedChats = state.linkedChats.filter((chat) => chat.chatId !== String(chatId));
        return state;
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/unlink", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/status", chatId: 42 }));

  assert.deepEqual(messages, [
    { chatId: "42", text: "Unlinked this Telegram chat from Remodex." },
    { chatId: "42", text: "This Telegram chat is not linked to this Remodex bridge." },
  ]);
});

test("telegram adapter rejects unauthorized chats generically", async () => {
  const messages = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [], pendingLinkCode: null }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/status", chatId: 99 }));

  assert.deepEqual(messages, [{ chatId: "99", text: "This Telegram chat is not linked to this Remodex bridge." }]);
});

test("telegram adapter gives local-first pairing help to unlinked start help and bare link", async () => {
  const messages = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [], pendingLinkCode: { code: "SECRET1", expiresAt: 2_000 } }),
    },
    now: () => 1_000,
  });

  await adapter.handleUpdate(messageUpdate({ text: "/start", chatId: 99 }));
  await adapter.handleUpdate(messageUpdate({ text: "/help", chatId: 99 }));
  await adapter.handleUpdate(messageUpdate({ text: "/link", chatId: 99 }));

  for (const message of messages) {
    assert.equal(message.chatId, "99");
    assert.match(message.text, /not linked/);
    assert.match(message.text, /remodex telegram link/);
    assert.match(message.text, /\/link <code>/);
    assert.doesNotMatch(message.text, /SECRET1/);
  }
});

test("telegram adapter handles read-only commands and active thread selection", async () => {
  const messages = [];
  const activityCalls = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/recovered" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
      setRuntimePreferences: ({ model, reasoningEffort, serviceTier, accessMode }) => {
        state.linkedChats[0].runtimeModel = model;
        state.linkedChats[0].reasoningEffort = reasoningEffort;
        state.linkedChats[0].runtimeServiceTier = serviceTier || "";
        state.linkedChats[0].runtimeAccessMode = accessMode || state.linkedChats[0].runtimeAccessMode;
        return state;
      },
    },
    controlSurface: {
      readStatus: async () => ({ bridgeStatus: { connectionStatus: "connected", codexLaunchState: { status: "ready" } } }),
      readVersionStatus: async () => ({ bridgeVersion: "1.5.2", bridgeLatestVersion: "1.5.3" }),
      readLastActiveThread: async () => ({ threadId: "thread-1", source: "desktop" }),
      listThreads: async () => ([{ id: "thread-1", title: "One", cwd: "/tmp/one" }, { id: "thread-2", title: "Two", cwd: "/tmp/two" }]),
      readGitStatus: async () => ({ branch: "main", files: [{ status: " M", path: "a.js" }] }),
      readGitDiffSummary: async () => ({
        changedFiles: 2,
        additions: 5,
        deletions: 1,
        files: [
          { path: "src/app.js", additions: 4, deletions: 1 },
          { path: ".env.local", additions: 1, deletions: 0 },
        ],
      }),
      readThreadActivity: async ({ threadId, limit }) => {
        activityCalls.push({ threadId, limit });
        return {
        entries: [
          { role: "user", text: "Please check the Telegram bridge." },
          { role: "assistant", text: "The bridge is connected." },
        ],
        };
      },
      captureWorkspaceCheckpoint: async () => ({
        checkpoint: {
          commit: "abcdef1234567890",
          checkpointRef: "refs/remodex/checkpoints/thread-2/telegram-manual/1",
        },
        status: { branch: "main", files: [{ path: "a.js", status: "M" }] },
      }),
      readGitBranches: async () => ({
        current: "main",
        defaultBranch: "main",
        branches: ["feature/telegram", "main"],
        branchesCheckedOutElsewhere: ["feature/telegram"],
        status: { files: [{ path: "a.js", status: "M" }] },
      }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/status", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/resume", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/threads", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/thread 2", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/version", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/git", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/diff", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/activity 8", chatId: 42 }));
  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(messages[7], "More"),
    chatId: 42,
    callbackQueryId: "cb-activity-more",
  }));
  await adapter.handleUpdate(messageUpdate({ text: "/checkpoint", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/branches", chatId: 42 }));

  assert.match(messages[0].text, /Bridge: connected/);
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][0].text, "Chat");
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][1].text, "Threads");
  assert.equal(messages[0].replyMarkup.inline_keyboard[1][0].text, "Git");
  assert.equal(messages[0].replyMarkup.inline_keyboard[1][1].text, "Settings");
  assert.equal(messages[1].text, "Active thread: One\nSource: desktop");
  assert.equal(messages[2].text, "Threads:\n1. One\n2. Two");
  assert.equal(messages[2].replyMarkup.inline_keyboard[1][0].text, "2. Two");
  assert.equal(messages[3].text, "Active thread: Two");
  assert.equal(messages[3].replyMarkup.inline_keyboard[0][0].text, "Stop");
  assert.equal(messages[3].replyMarkup.inline_keyboard[0][1].text, "Status");
  assert.equal(state.linkedChats[0].activeThreadCwd, "/tmp/two");
  assert.equal(messages[4].text, "Bridge version: 1.5.2\nLatest published: 1.5.3\nUpdate: available on npm.");
  assert.equal(callbackDataForButton(messages[4], "Refresh").startsWith("a:"), true);
  assert.equal(messages[5].text, "Git: 1 files changed on main. 0 staged, 1 unstaged.");
  assert.equal(
    messages[6].text,
    "Diff: 2 files changed (+5 -1).\n- src/app.js (+4 -1)\n- [sensitive path] (+1 -0)\nOpen Remodex for full patch details."
  );
  assert.equal(messages[7].text, "Activity:\n- You: Please check the Telegram bridge.\n- Assistant: The bridge is connected.\nOpen Remodex for the full timeline.");
  assert.equal(callbackDataForButton(messages[7], "More").startsWith("a:"), true);
  assert.equal(messages[8].text, "Activity:\n- You: Please check the Telegram bridge.\n- Assistant: The bridge is connected.\nOpen Remodex for the full timeline.");
  assert.deepEqual(activityCalls, [
    { threadId: "thread-2", limit: 8 },
    { threadId: "thread-2", limit: 8 },
  ]);
  assert.equal(messages[9].text, "Checkpoint captured.\nCommit: abcdef123456\nWorkspace: 1 changed files on main.\nTelegram can preview restore impact before any destructive restore.");
  assert.equal(callbackDataForButton(messages[9], "Preview Restore").startsWith("a:"), true);
  assert.equal(messages[10].text, "Branches: current main\n- feature/telegram (open elsewhere)\n* main (default)\n1 changed files in the working tree.");
});

test("telegram adapter previews checkpoint restore impact from checkpoint buttons", async () => {
  const messages = [];
  const callbacks = [];
  const previewCalls = [];
  const applyCalls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    sessionState: {
      read: () => ({
        linkedChats: [{ chatId: "42", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      captureWorkspaceCheckpoint: async () => ({
        checkpoint: {
          checkpointRef: "refs/remodex/checkpoints/thread-1/telegram-manual/1",
          commit: "abcdef1234567890abcdef",
        },
        status: { branch: "main", files: [{ path: ".env.local", status: "M" }] },
      }),
      previewWorkspaceCheckpointRestore: async ({ threadId, cwd, checkpointRef }) => {
        previewCalls.push({ threadId, cwd, checkpointRef });
        return {
          canRestore: true,
          checkpointRef,
          commit: "abcdef1234567890abcdef",
          affectedFiles: ["src/app.js", ".env.local"],
          stagedFiles: ["src/app.js"],
          untrackedFiles: [".env.local"],
        };
      },
      applyWorkspaceCheckpointRestore: async ({
        threadId,
        cwd,
        checkpointRef,
        expectedTargetCommit,
      }) => {
        applyCalls.push({ threadId, cwd, checkpointRef, expectedTargetCommit });
        return {
          success: true,
          checkpointRef,
          backupCommit: "1234567890abcdef",
          restoredFiles: ["src/app.js", ".env.local"],
          status: { branch: "main", files: [{ path: "src/app.js", status: "M" }] },
        };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/checkpoint", chatId: 42 }));
  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(messages[0], "Preview Restore"),
    chatId: 42,
    callbackQueryId: "cb-preview-restore",
  }));

  assert.equal(
    messages[0].text,
    "Checkpoint captured.\nCommit: abcdef123456\nWorkspace: 1 changed files on main.\nTelegram can preview restore impact before any destructive restore."
  );
  assert.deepEqual(previewCalls, [{
    threadId: "thread-1",
    cwd: "/tmp/current",
    checkpointRef: "refs/remodex/checkpoints/thread-1/telegram-manual/1",
  }]);
  assert.equal(
    messages[1].text,
    "Checkpoint restore preview:\nCommit: abcdef123456\nAffected files: 2.\nWorkspace now: 1 staged, 1 untracked.\nReview carefully; Apply Restore will revert local files to this checkpoint."
  );
  assert.doesNotMatch(messages[1].text, /\.env\.local|src\/app\.js/);
  assert.equal(callbackDataForButton(messages[1], "Apply Restore").startsWith("a:"), true);

  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(messages[1], "Apply Restore"),
    chatId: 42,
    callbackQueryId: "cb-apply-restore",
  }));

  assert.deepEqual(applyCalls, [{
    threadId: "thread-1",
    cwd: "/tmp/current",
    checkpointRef: "refs/remodex/checkpoints/thread-1/telegram-manual/1",
    expectedTargetCommit: "abcdef1234567890abcdef",
  }]);
  assert.equal(
    messages[2].text,
    "Checkpoint restored.\nRestored files: 2.\nSafety backup: 1234567890ab.\nWorkspace now: 1 changed files on main.\nOpen Remodex on the Mac for file-level review."
  );
  assert.doesNotMatch(messages[2].text, /\.env\.local|src\/app\.js/);
  assert.deepEqual(callbacks, [
    { callbackQueryId: "cb-preview-restore", text: "Restore preview sent." },
    { callbackQueryId: "cb-apply-restore", text: "Checkpoint restored." },
  ]);
});

test("telegram adapter filters recent and archived thread pickers by query", async () => {
  const messages = [];
  const calls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
    controlSurface: {
      listThreads: async ({ query }) => {
        calls.push(["threads", query]);
        return [
          { id: "thread-telegram", title: "Telegram hardening", cwd: "/tmp/telegram" },
        ];
      },
      listArchivedThreads: async ({ query }) => {
        calls.push(["archived", query]);
        return [
          { id: "thread-archived", title: "Archived cleanup", cwd: "/tmp/archive" },
        ];
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/threads telegram", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/archived cleanup", chatId: 42 }));

  assert.deepEqual(calls, [
    ["threads", "telegram"],
    ["archived", "cleanup"],
  ]);
  assert.equal(messages[0].text, "Threads matching \"telegram\":\n1. Telegram hardening");
  assert.equal(callbackDataForButton(messages[0], "1. Telegram hardening").startsWith("a:"), true);
  assert.equal(messages[1].text, [
    "Archived threads matching \"cleanup\":",
    "1. Archived cleanup",
    "Use /unarchive <number|id> to restore one.",
  ].join("\n"));
  assert.equal(callbackDataForButton(messages[1], "Unarchive 1. Archived cleanup").startsWith("a:"), true);
});

test("telegram adapter bounds dynamic inline button labels centrally", async () => {
  const messages = [];
  const longTitle = `Telegram ${"🧪".repeat(80)}`;
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
    controlSurface: {
      listThreads: async () => ([{ id: "thread-long", title: longTitle, cwd: "/tmp/telegram" }]),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/threads", chatId: 42 }));

  const button = messages[0].replyMarkup.inline_keyboard[0][0];
  assert.equal(Array.from(button.text).length, 64);
  assert.match(button.text, /^1\. Telegram /);
  assert.equal(button.text.endsWith("..."), true);
  assert.equal(button.callback_data.startsWith("a:"), true);
});

test("telegram adapter reports when no Mac active thread is remembered", async () => {
  const messages = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => state,
    },
    controlSurface: {
      readLastActiveThread: async () => null,
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/resume", chatId: 42 }));

  assert.equal(messages[0].text, "No remembered Remodex thread found yet. Run /threads or /new.");
  assert.equal(callbackDataForButton(messages[0], "Threads").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "New").startsWith("a:"), true);
});

test("telegram adapter selects explicit thread identifiers outside the recent list", async () => {
  const messages = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
      clearActiveThread: () => {
        delete state.linkedChats[0].activeThreadId;
        delete state.linkedChats[0].activeThreadCwd;
        return state;
      },
    },
    controlSurface: {
      readStatus: async () => ({ bridgeStatus: { connectionStatus: "connected", codexLaunchState: "ready" } }),
      listThreads: async () => ([{ id: "thread-1", title: "One" }]),
    },
  });

  await adapter.handleUpdate(messageUpdate({
    text: "/thread 019e2f0f-12a2-7263-8936-9a74f86972ec",
    chatId: 42,
  }));
  await adapter.handleUpdate(messageUpdate({ text: "/status", chatId: 42 }));

  assert.equal(state.linkedChats[0].activeThreadId, "019e2f0f-12a2-7263-8936-9a74f86972ec");
  assert.equal(messages[0].text, "Active thread: 019e2f0f-12a2-7263-8936-9a74f86972ec");
  assert.equal(callbackDataForButton(messages[0], "Menu").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Activity").startsWith("a:"), true);
  assert.match(messages[1].text, /Active: 019e2f0f-12a2-7263-8936-9a74f86972ec/);
});

test("telegram adapter archives active threads and restores archived threads", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const archiveCalls = [];
  const unarchiveCalls = [];
  const state = {
    linkedChats: [{ chatId: "42", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const archivedThreads = [
    { id: "thread-1", title: "Archived Telegram Work", cwd: "/tmp/current" },
    { id: "thread-2", title: "Older Chat", cwd: "/tmp/older" },
  ];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
      clearActiveThread: ({ chatId }) => {
        assert.equal(chatId, "42");
        delete state.linkedChats[0].activeThreadId;
        delete state.linkedChats[0].activeThreadCwd;
        return state;
      },
    },
    controlSurface: {
      listThreads: async () => ([{ id: "thread-1", title: "Telegram Work", cwd: "/tmp/current" }]),
      listArchivedThreads: async () => archivedThreads,
      archiveThread: async ({ threadId }) => {
        archiveCalls.push(threadId);
        return { threadId, title: "Telegram Work" };
      },
      unarchiveThread: async ({ threadId }) => {
        unarchiveCalls.push(threadId);
        return { threadId };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/archive", chatId: 42 }));
  assert.deepEqual(archiveCalls, ["thread-1"]);
  assert.equal(state.linkedChats[0].activeThreadId, undefined);
  assert.equal(messages[0].text, "Archived: Telegram Work.");
  assert.equal(callbackDataForButton(messages[0], "Archived").startsWith("a:"), true);

  await adapter.handleUpdate(messageUpdate({ text: "/archived", chatId: 42 }));
  assert.equal(messages[1].text, [
    "Archived threads:",
    "1. Archived Telegram Work",
    "2. Older Chat",
    "Use /unarchive <number|id> to restore one.",
  ].join("\n"));
  assert.equal(callbackDataForButton(messages[1], "Unarchive 1. Archived Telegram Work").startsWith("a:"), true);

  await adapter.handleUpdate(messageUpdate({ text: "/unarchive 2", chatId: 42 }));
  assert.deepEqual(unarchiveCalls, ["thread-2"]);
  assert.equal(state.linkedChats[0].activeThreadId, "thread-2");
  assert.equal(state.linkedChats[0].activeThreadCwd, "/tmp/older");
  assert.equal(messages[2].text, "Restored archived thread: Older Chat.");

  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(messages[1], "Unarchive 1. Archived Telegram Work"),
    chatId: 42,
    callbackQueryId: "cb-unarchive",
  }));
  assert.deepEqual(unarchiveCalls, ["thread-2", "thread-1"]);
  assert.equal(state.linkedChats[0].activeThreadId, "thread-1");
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-unarchive", text: "Thread restored." }]);
});

test("telegram adapter handles inline thread and status control buttons", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/recovered" }],
    pendingLinkCode: null,
  };
  const gitCalls = [];
  const branchCalls = [];
  const checkoutCalls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: {
      readStatus: async () => ({ bridgeStatus: { connectionStatus: "connected", codexLaunchState: "ready" } }),
      listThreads: async () => ([{ id: "thread-1", title: "One", cwd: "/tmp/one" }, { id: "thread-2", title: "Two", cwd: "/tmp/two" }]),
      readGitStatus: async ({ threadId, cwd }) => {
        gitCalls.push({ threadId, cwd });
        return { branch: "feature/telegram", files: [] };
      },
      readGitBranches: async ({ threadId, cwd }) => {
        branchCalls.push({ threadId, cwd });
        return {
          current: "feature/telegram",
          branches: ["feature/telegram", "main"],
          defaultBranch: "main",
          status: { files: [] },
        };
      },
      checkoutBranch: async ({ threadId, cwd, branch }) => {
        checkoutCalls.push({ threadId, cwd, branch });
        return { current: branch, status: { branch, files: [] } };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/threads", chatId: 42 }));
  const selectThreadCallback = callbackDataForButton(messages[0], "2. Two");
  await adapter.handleUpdate(callbackUpdate({ callbackData: selectThreadCallback, chatId: 42, callbackQueryId: "cb-thread" }));

  assert.equal(state.linkedChats[0].activeThreadId, "thread-2");
  assert.equal(state.linkedChats[0].activeThreadCwd, "/tmp/two");
  assert.equal(messages[1].text, "Active thread: Two");
  assert.deepEqual(callbacks[0], { callbackQueryId: "cb-thread", text: "Thread selected." });

  await adapter.handleUpdate(messageUpdate({ text: "/status", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/git", chatId: 42 }));

  assert.deepEqual(gitCalls, [{ threadId: "thread-2", cwd: "/tmp/two" }]);
  assert.equal(messages[3].text, "Git: 0 files changed on feature/telegram. 0 staged, 0 unstaged.");

  await adapter.handleUpdate(messageUpdate({ text: "/branches", chatId: 42 }));

  assert.deepEqual(branchCalls, [{ threadId: "thread-2", cwd: "/tmp/two" }]);
  assert.equal(messages[4].text, "Branches: current feature/telegram\n* feature/telegram\n- main (default)");
  assert.equal(messages[4].replyMarkup.inline_keyboard[0][0].text, "Checkout main");

  const checkoutCallback = callbackDataForButton(messages[4], "Checkout main");
  await adapter.handleUpdate(callbackUpdate({ callbackData: checkoutCallback, chatId: 42, callbackQueryId: "cb-checkout" }));

  assert.deepEqual(checkoutCalls, [{ threadId: "thread-2", cwd: "/tmp/two", branch: "main" }]);
  assert.equal(messages[5].text, "Checked out main.");
  assert.deepEqual(callbacks, [
    { callbackQueryId: "cb-thread", text: "Thread selected." },
    { callbackQueryId: "cb-checkout", text: "Branch checkout requested." },
  ]);
});

test("telegram adapter keeps normal control buttons reusable", async () => {
  const messages = [];
  const callbacks = [];
  const statusReads = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    sessionState: {
      read: () => ({
        linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1" }],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      readStatus: async () => {
        statusReads.push("status");
        return { bridgeStatus: { connectionStatus: "connected", codexLaunchState: "ready" } };
      },
      listThreads: async () => ([{ id: "thread-1", title: "One" }]),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/status", chatId: 42 }));
  const statusCallback = callbackDataForButton(messages[0], "Status");
  await adapter.handleUpdate(callbackUpdate({ callbackData: statusCallback, chatId: 42, callbackQueryId: "cb-status-1" }));
  await adapter.handleUpdate(callbackUpdate({ callbackData: statusCallback, chatId: 42, callbackQueryId: "cb-status-2" }));

  assert.deepEqual(statusReads, ["status", "status", "status"]);
  assert.equal(messages.length, 3);
  assert.deepEqual(callbacks, [
    { callbackQueryId: "cb-status-1", text: "Status refreshed." },
    { callbackQueryId: "cb-status-2", text: "Status refreshed." },
  ]);
});

test("telegram adapter lists project choices and creates a new thread in a selected local folder", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const calls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: {
      listProjects: async ({ query }) => {
        calls.push(["projects", query]);
        return {
          query,
          projects: [
            { name: "remodex", path: "/Users/user/Documents/Projects/remodex" },
            { name: "phodex-bridge", path: "/Users/user/Documents/Projects/remodex/phodex-bridge" },
          ],
        };
      },
      createThread: async ({ sourceThreadId, sourceCwd, cwd }) => {
        calls.push(["new", sourceThreadId, sourceCwd, cwd]);
        return { threadId: "thread-project", thread: { id: "thread-project", title: "Project thread", cwd } };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/projects remodex", chatId: 42 }));

  assert.deepEqual(calls[0], ["projects", "remodex"]);
  assert.equal(
    messages[0].text,
    'Projects matching "remodex":\n- remodex (Projects)\n- phodex-bridge (remodex)'
  );
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][0].text, "New: remodex");

  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(messages[0], "New: remodex"),
    chatId: 42,
    callbackQueryId: "cb-project-new",
  }));

  assert.deepEqual(calls[1], [
    "new",
    "thread-1",
    "/tmp/current",
    "/Users/user/Documents/Projects/remodex",
  ]);
  assert.equal(state.linkedChats[0].activeThreadId, "thread-project");
  assert.equal(state.linkedChats[0].activeThreadCwd, "/Users/user/Documents/Projects/remodex");
  assert.equal(messages[1].text, "New active thread: Project thread");
  assert.equal(callbackDataForButton(messages[1], "Menu").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[1], "Activity").startsWith("a:"), true);
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-project-new", text: "New project thread created." }]);
});

test("telegram adapter browses local project folders and creates a thread from a browsed folder", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const calls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
      setProjectBrowsePath: ({ path }) => {
        state.linkedChats[0].projectBrowsePath = path;
        return state;
      },
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: {
      listProjectDirectory: async ({ path }) => {
        calls.push(["browse", path]);
        if (!path) {
          return {
            isRoot: true,
            entries: [{ label: "Documents", path: "/Users/user/Documents" }],
          };
        }
        return {
          path,
          parentPath: "/Users/user",
          entries: [{ name: "remodex", path: "/Users/user/Documents/Projects/remodex" }],
        };
      },
      createProjectDirectory: async ({ parentPath, name }) => {
        calls.push(["mkdir", parentPath, name]);
        return {
          path: `${parentPath}/${name}`,
          parentPath,
          name,
        };
      },
      createThread: async ({ sourceThreadId, sourceCwd, cwd }) => {
        calls.push(["new", sourceThreadId, sourceCwd, cwd]);
        return { threadId: "thread-browse", thread: { id: "thread-browse", title: "Browsed project", cwd } };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/browse", chatId: 42 }));

  assert.deepEqual(calls[0], ["browse", ""]);
  assert.equal(messages[0].text, "Project folders:\n- Documents");
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][0].text, "Open: Documents");
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][1].text, "New: Documents");

  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(messages[0], "Open: Documents"),
    chatId: 42,
    callbackQueryId: "cb-browse-docs",
  }));

  assert.deepEqual(calls[1], ["browse", "/Users/user/Documents"]);
  assert.equal(state.linkedChats[0].projectBrowsePath, "/Users/user/Documents");
  assert.equal(messages[1].text, "Folder: Documents\n- remodex");
  assert.equal(messages[1].replyMarkup.inline_keyboard[0][0].text, "New here");
  assert.equal(messages[1].replyMarkup.inline_keyboard[0][1].text, "New folder");
  assert.equal(messages[1].replyMarkup.inline_keyboard[1][0].text, "Parent");
  assert.equal(messages[1].replyMarkup.inline_keyboard[2][0].text, "Open: remodex");
  assert.equal(messages[1].replyMarkup.inline_keyboard[2][1].text, "New: remodex");

  await adapter.handleUpdate(messageUpdate({ text: "/mkdir Client App", chatId: 42 }));

  assert.deepEqual(calls[2], ["mkdir", "/Users/user/Documents", "Client App"]);
  assert.equal(state.linkedChats[0].projectBrowsePath, "/Users/user/Documents/Client App");
  assert.equal(messages[2].text, "Created folder: Client App\nIn: Documents\nUse the buttons below to open it or start a thread there.");

  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(messages[1], "New: remodex"),
    chatId: 42,
    callbackQueryId: "cb-new-remodex",
  }));

  assert.deepEqual(calls[3], [
    "new",
    "thread-1",
    "/tmp/current",
    "/Users/user/Documents/Projects/remodex",
  ]);
  assert.equal(state.linkedChats[0].activeThreadId, "thread-browse");
  assert.equal(state.linkedChats[0].activeThreadCwd, "/Users/user/Documents/Projects/remodex");
  assert.equal(messages[3].text, "New active thread: Browsed project");
  assert.equal(callbackDataForButton(messages[3], "Menu").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[3], "Activity").startsWith("a:"), true);
  assert.deepEqual(callbacks, [
    { callbackQueryId: "cb-browse-docs", text: "Folder opened." },
    { callbackQueryId: "cb-new-remodex", text: "New project thread created." },
  ]);
});

test("telegram adapter routes the explicit browse command", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const browseCalls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
      setProjectBrowsePath: ({ path }) => {
        state.linkedChats[0].projectBrowsePath = path;
        return state;
      },
    },
    controlSurface: {
      listProjectDirectory: async ({ path }) => {
        browseCalls.push(path);
        return {
          isRoot: true,
          entries: [{ label: "Documents", path: "/Users/user/Documents" }],
        };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/browse", chatId: 42 }));

  assert.deepEqual(browseCalls, [""]);
  assert.equal(messages[0].text, "Project folders:\n- Documents");
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][0].text, "Open: Documents");
  assert.deepEqual(callbacks, []);
});

test("telegram adapter creates a new thread from an explicit /new folder", async () => {
  const messages = [];
  const calls = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: {
      createThread: async ({ sourceThreadId, sourceCwd, cwd }) => {
        calls.push({ sourceThreadId, sourceCwd, cwd });
        return { thread: { id: "thread-explicit", title: "Explicit project", cwd } };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({
    text: "/new /Users/user/Documents/Projects/remodex/phodex-bridge",
    chatId: 42,
  }));

  assert.deepEqual(calls, [{
    sourceThreadId: "thread-1",
    sourceCwd: "/tmp/current",
    cwd: "/Users/user/Documents/Projects/remodex/phodex-bridge",
  }]);
  assert.equal(messages[0].text, "New active thread: Explicit project");
  assert.equal(callbackDataForButton(messages[0], "Menu").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Activity").startsWith("a:"), true);
  assert.equal(state.linkedChats[0].activeThreadCwd, "/Users/user/Documents/Projects/remodex/phodex-bridge");
});

test("telegram adapter forks the active thread and selects the fork", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{
      chatId: "42",
      chatTitle: "Kartik",
      activeThreadId: "thread-1",
      activeThreadCwd: "/tmp/current",
      runtimeModel: "gpt-5.4-mini",
      reasoningEffort: "high",
    }],
    pendingLinkCode: null,
  };
  const forkCalls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: {
      forkThread: async ({ threadId, cwd, runtimePreferences }) => {
        forkCalls.push({ threadId, cwd, runtimePreferences });
        return {
          threadId: "thread-fork",
          thread: {
            id: "thread-fork",
            title: "Forked Telegram work",
            cwd: "/tmp/forked",
            forkedFromThreadId: threadId,
          },
        };
      },
    },
  });

  const staleForkCallback = actions.registry.createAction({
    chatId: "42",
    type: "command.fork",
    payload: { threadId: "thread-1" },
  });
  await adapter.handleUpdate(messageUpdate({ text: "/fork", chatId: 42 }));

  assert.deepEqual(forkCalls, [{
    threadId: "thread-1",
    cwd: "/tmp/current",
    runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high" },
  }]);
  assert.equal(state.linkedChats[0].activeThreadId, "thread-fork");
  assert.equal(state.linkedChats[0].activeThreadCwd, "/tmp/forked");
  assert.match(messages[0].text, /Forked active thread: Forked Telegram work/);
  assert.equal(callbackDataForButton(messages[0], "Activity").startsWith("a:"), true);

  await adapter.handleUpdate(callbackUpdate({ callbackData: staleForkCallback, chatId: 42, callbackQueryId: "cb-fork-stale" }));

  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-fork-stale", text: "Thread changed. Run /status." }]);
});

test("telegram adapter creates a worktree thread and selects it", async () => {
  const messages = [];
  const state = {
    linkedChats: [{
      chatId: "42",
      chatTitle: "Kartik",
      activeThreadId: "thread-1",
      activeThreadCwd: "/tmp/current",
      runtimeModel: "gpt-5.4-mini",
      reasoningEffort: "high",
    }],
    pendingLinkCode: null,
  };
  const worktreeCalls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: {
      createWorktreeThread: async ({ threadId, cwd, branch, runtimePreferences }) => {
        worktreeCalls.push({ threadId, cwd, branch, runtimePreferences });
        return {
          worktree: {
            branch: "remodex/telegram-support",
            worktreePath: "/Users/user/.codex/worktrees/remodex/abc123/phodex-bridge",
          },
          threadId: "thread-worktree",
          thread: {
            id: "thread-worktree",
            title: "Telegram worktree",
            cwd: "/Users/user/.codex/worktrees/remodex/abc123/phodex-bridge",
          },
        };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/worktree telegram-support", chatId: 42 }));

  assert.deepEqual(worktreeCalls, [{
    threadId: "thread-1",
    cwd: "/tmp/current",
    branch: "telegram-support",
    runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high" },
  }]);
  assert.equal(state.linkedChats[0].activeThreadId, "thread-worktree");
  assert.equal(state.linkedChats[0].activeThreadCwd, "/Users/user/.codex/worktrees/remodex/abc123/phodex-bridge");
  assert.equal(
    messages[0].text,
    "Created worktree: remodex/telegram-support\nNew active thread: Telegram worktree\nProject: abc123"
  );
  assert.equal(callbackDataForButton(messages[0], "Activity").startsWith("a:"), true);
});

test("telegram adapter renames the active thread", async () => {
  const messages = [];
  const renameCalls = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => state,
    },
    controlSurface: {
      renameThread: async ({ threadId, title }) => {
        renameCalls.push({ threadId, title });
        return { threadId, title };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/rename Polish Telegram support", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/rename", chatId: 42 }));

  assert.deepEqual(renameCalls, [{ threadId: "thread-1", title: "Polish Telegram support" }]);
  assert.equal(messages[0].text, "Renamed active thread: Polish Telegram support");
  assert.equal(messages[1].text, "Usage: /rename <title>");
});

test("telegram adapter generates the active thread title by command and button", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const titleCalls = [];
  const state = {
    linkedChats: [{
      chatId: "42",
      chatTitle: "Kartik",
      activeThreadId: "thread-1",
      activeThreadCwd: "/tmp/current",
      runtimeModel: "gpt-5.4-mini",
      reasoningEffort: "high",
    }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
    },
    controlSurface: {
      listThreads: async () => ([{ id: "thread-1", title: "One", cwd: "/tmp/current" }]),
      generateThreadTitle: async ({ threadId, cwd, message, runtimePreferences }) => {
        titleCalls.push({ threadId, cwd, message, runtimePreferences });
        return { threadId, title: message ? "Fix Sidebar Title" : "Generated From Thread" };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/title Fix the sidebar title please", chatId: 42 }));
  const titleCallback = actions.registry.createAction({
    chatId: "42",
    type: "command.title",
    payload: { threadId: "thread-1" },
  });
  await adapter.handleUpdate(callbackUpdate({
    callbackData: titleCallback,
    chatId: 42,
    callbackQueryId: "cb-title",
  }));

  assert.deepEqual(titleCalls, [
    {
      threadId: "thread-1",
      cwd: "/tmp/current",
      message: "Fix the sidebar title please",
      runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high" },
    },
    {
      threadId: "thread-1",
      cwd: "/tmp/current",
      message: "",
      runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high" },
    },
  ]);
  assert.equal(messages[0].text, "Generated active thread title: Fix Sidebar Title");
  assert.equal(messages[1].text, "Generated active thread title: Generated From Thread");
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-title", text: "Title generated." }]);
});

test("telegram adapter opens a primary action menu with callbacks for supported commands", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const activityCalls = [];
  const openCalls = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
    },
    controlSurface: {
      readStatus: async () => ({ bridgeStatus: { connectionStatus: "connected", codexLaunchState: "ready" } }),
      listThreads: async () => ([{ id: "thread-1", title: "One", cwd: "/tmp/current" }]),
      readLastActiveThread: async () => ({ threadId: "thread-1", source: "desktop" }),
      readThreadActivity: async ({ threadId, limit }) => {
        activityCalls.push({ threadId, limit });
        return { entries: [{ role: "assistant", text: "Telegram activity is ready." }] };
      },
      openThreadOnMac: async ({ threadId }) => {
        openCalls.push({ threadId });
        return { success: true, relaunched: false };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/menu", chatId: 42 }));

  assert.equal(messages[0].text, "Remodex hub\nActive thread selected.");
  assert.equal(callbackDataForButton(messages[0], "Chat").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Threads").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Git").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Settings").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Help").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Menu").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Status").startsWith("a:"), true);
  assert.throws(() => callbackDataForButton(messages[0], "Projects"), /button not found/);

  const catalogCommandActions = new Set(TELEGRAM_COMMAND_MENU.map(({ command }) => `command.${command}`));
  for (const action of actions.actions.values()) {
    if (action.type.startsWith("command.")) {
      assert.equal(catalogCommandActions.has(action.type), true, `${action.type} should match a primary Telegram Control Command`);
    }
  }
  const chatHubCallback = callbackDataForButton(messages[0], "Chat");
  await adapter.handleUpdate(callbackUpdate({
    callbackData: chatHubCallback,
    chatId: 42,
    callbackQueryId: "cb-chat-hub",
  }));
  const chatHubMessage = messages.at(-1);
  assert.equal(actionForButton(actions, chatHubMessage, "Open Mac").type, "command.open");

  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(chatHubMessage, "Activity"),
    chatId: 42,
    callbackQueryId: "cb-activity",
  }));
  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(chatHubMessage, "Open Mac"),
    chatId: 42,
    callbackQueryId: "cb-open",
  }));
  await adapter.handleUpdate(messageUpdate({ text: "/help all", chatId: 42 }));

  assert.deepEqual(activityCalls, [{ threadId: "thread-1", limit: 3 }]);
  assert.deepEqual(openCalls, [{ threadId: "thread-1" }]);
  assert.equal(messages.at(-3).text, "Activity:\n- Assistant: Telegram activity is ready.\nOpen Remodex for the full timeline.");
  assert.equal(messages.at(-2).text, "Opened the active thread on Mac.");
  assert.match(messages.at(-1).text, /^All commands:\n/);
  assert.match(messages.at(-1).text, /Git: .*\/ship <message>/);
  assert.deepEqual(callbacks, [
    { callbackQueryId: "cb-chat-hub", text: "Hub opened." },
    { callbackQueryId: "cb-activity", text: "Activity refreshed." },
    { callbackQueryId: "cb-open", text: "Mac handoff requested." },
  ]);
});

test("telegram adapter sends worktree usage from focused help", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: { read: () => state },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/help worktree", chatId: 42 }));

  assert.match(messages[0].text, /\/worktree <branch>/);
  assert.deepEqual(callbacks, []);
});

test("telegram adapter persists runtime model preferences and forwards them to thread work", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const createCalls = [];
  const continueCalls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
      setRuntimePreferences: ({ model, reasoningEffort, serviceTier, accessMode }) => {
        state.linkedChats[0].runtimeModel = model;
        state.linkedChats[0].reasoningEffort = reasoningEffort;
        state.linkedChats[0].runtimeServiceTier = serviceTier || "";
        state.linkedChats[0].runtimeAccessMode = accessMode || state.linkedChats[0].runtimeAccessMode;
        return state;
      },
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: {
      createThread: async ({ runtimePreferences }) => {
        createCalls.push(runtimePreferences);
        return { threadId: "thread-new", thread: { id: "thread-new", title: "New", cwd: "/tmp/current" } };
      },
      continueThread: async ({ text, runtimePreferences }) => {
        continueCalls.push({ text, runtimePreferences });
        return { success: true };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/model gpt-5.4-mini high fast", chatId: 42 }));
  assert.equal(state.linkedChats[0].runtimeModel, "gpt-5.4-mini");
  assert.equal(state.linkedChats[0].reasoningEffort, "high");
  assert.equal(state.linkedChats[0].runtimeServiceTier, "fast");
  assert.match(messages[0].text, /Model: GPT-5.4 Mini \(gpt-5.4-mini\)/);
  assert.match(messages[0].text, /Reasoning: High \(high\)/);
  assert.match(messages[0].text, /Speed: Fast \(fast\)/);
  assert.match(messages[0].text, /Access: On-Request \(on-request\)/);
  assert.equal(callbackDataForButton(messages[0], "Pick Model").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Effort").startsWith("a:"), true);

  await adapter.handleUpdate(messageUpdate({ text: "/access full", chatId: 42 }));
  assert.equal(state.linkedChats[0].runtimeAccessMode, "full-access");
  assert.match(messages[1].text, /Access: Full Access \(full-access\)/);
  assert.equal(callbackDataForButton(messages[1], "Access").startsWith("a:"), true);

  await adapter.handleUpdate(messageUpdate({ text: "/new", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/continue Ship with this runtime", chatId: 42 }));

  assert.deepEqual(createCalls, [{ model: "gpt-5.4-mini", reasoningEffort: "high", serviceTier: "fast", accessMode: "full-access" }]);
  assert.deepEqual(continueCalls, [{
    text: "Ship with this runtime",
    runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high", serviceTier: "fast", accessMode: "full-access" },
  }]);

  const effortCallback = callbackDataForButton(messages[0], "Effort");
  await adapter.handleUpdate(callbackUpdate({ callbackData: effortCallback, chatId: 42, callbackQueryId: "cb-effort-picker" }));
  const lowCallback = callbackDataForButton(messages.at(-1), "Low");
  await adapter.handleUpdate(callbackUpdate({ callbackData: lowCallback, chatId: 42, callbackQueryId: "cb-runtime-low" }));

  assert.equal(state.linkedChats[0].runtimeModel, "gpt-5.4-mini");
  assert.equal(state.linkedChats[0].reasoningEffort, "low");
  assert.equal(state.linkedChats[0].runtimeServiceTier, "fast");
  assert.match(messages.at(-1).text, /Reasoning: Low \(low\)/);
  const tierCallback = callbackDataForButton(messages.at(-1), "Tier");
  await adapter.handleUpdate(callbackUpdate({ callbackData: tierCallback, chatId: 42, callbackQueryId: "cb-tier-picker" }));
  const normalCallback = callbackDataForButton(messages.at(-1), "Normal");
  await adapter.handleUpdate(callbackUpdate({ callbackData: normalCallback, chatId: 42, callbackQueryId: "cb-speed-normal" }));

  assert.equal(state.linkedChats[0].runtimeServiceTier, "");
  assert.match(messages.at(-1).text, /Speed: Normal \(normal\)/);
  const accessCallback = callbackDataForButton(messages.at(-1), "Access");
  await adapter.handleUpdate(callbackUpdate({ callbackData: accessCallback, chatId: 42, callbackQueryId: "cb-access-picker" }));
  const askCallback = callbackDataForButton(messages.at(-1), "On-Request");
  await adapter.handleUpdate(callbackUpdate({ callbackData: askCallback, chatId: 42, callbackQueryId: "cb-access-ask" }));

  assert.equal(state.linkedChats[0].runtimeAccessMode, "on-request");
  assert.match(messages.at(-1).text, /Access: On-Request \(on-request\)/);
  assert.deepEqual(callbacks, [
    { callbackQueryId: "cb-effort-picker", text: "Picker opened." },
    { callbackQueryId: "cb-runtime-low", text: "Reasoning updated." },
    { callbackQueryId: "cb-tier-picker", text: "Picker opened." },
    { callbackQueryId: "cb-speed-normal", text: "Speed updated." },
    { callbackQueryId: "cb-access-picker", text: "Picker opened." },
    { callbackQueryId: "cb-access-ask", text: "Access updated." },
  ]);
});

test("telegram adapter routes visible buttons on primary surfaces", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  let nextThread = 1;
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: createButtonHarnessControlSurface({ state, nextThread: () => nextThread++ }),
  });

  const surfaces = [];
  for (const text of ["/status", "/menu", "/account", "/prefs", "/continue continue from Telegram", "/branches"]) {
    await adapter.handleUpdate(messageUpdate({ text, chatId: 42 }));
    surfaces.push(messages.at(-1));
  }

  let callbackIndex = 0;
  let expectedCallbacks = 0;
  for (const surface of surfaces) {
    for (const button of callbackButtonsForMessage(surface)) {
      expectedCallbacks += 1;
      callbackIndex += 1;
      await adapter.handleUpdate(callbackUpdate({
        callbackData: button.callbackData,
        chatId: 42,
        callbackQueryId: `cb-surface-${callbackIndex}`,
      }));
    }
  }

  assert.equal(callbacks.length, expectedCallbacks);
  assert.deepEqual(callbacks.filter((callback) => (
    /Unsupported action|Action expired|Cannot read|is not a function/i.test(callback.text)
  )), []);
});

test("telegram adapter routes visible buttons on result surfaces", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  let nextThread = 1;
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: createButtonHarnessControlSurface({ state, nextThread: () => nextThread++ }),
  });

  const surfaces = [];
  for (const text of [
    "/usage",
    "/limits",
    "/version",
    "/feedback",
    "/activity",
    "/checkpoint",
    "/draft_commit",
    "/draft_pr",
    "/review changes",
    "/archived",
    "/browse",
  ]) {
    await adapter.handleUpdate(messageUpdate({ text, chatId: 42 }));
    surfaces.push(messages.at(-1));
  }

  let callbackIndex = 0;
  let expectedCallbacks = 0;
  for (const surface of surfaces) {
    for (const button of callbackButtonsForMessage(surface)) {
      expectedCallbacks += 1;
      callbackIndex += 1;
      await adapter.handleUpdate(callbackUpdate({
        callbackData: button.callbackData,
        chatId: 42,
        callbackQueryId: `cb-result-surface-${callbackIndex}`,
      }));
    }
  }

  assert.equal(callbacks.length, expectedCallbacks);
  assert.deepEqual(callbacks.filter((callback) => (
    /Unsupported action|Action expired|Cannot read|is not a function/i.test(callback.text)
  )), []);
});

test("telegram adapter routes no-active-thread recovery buttons", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik" }],
    pendingLinkCode: null,
  };
  let nextThread = 1;
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: createButtonHarnessControlSurface({ state, nextThread: () => nextThread++ }),
  });

  await adapter.handleUpdate(messageUpdate({ text: "/status", chatId: 42 }));
  const statusSurface = messages.at(-1);
  assert.equal(callbackDataForButton(statusSurface, "Threads").startsWith("a:"), true);
  assert.equal(callbackDataForButton(statusSurface, "Chat").startsWith("a:"), true);

  await adapter.handleUpdate(messageUpdate({ text: "/continue continue from Telegram", chatId: 42 }));
  const missingThreadSurface = messages.at(-1);

  let callbackIndex = 0;
  let expectedCallbacks = 0;
  for (const surface of [statusSurface, missingThreadSurface]) {
    for (const button of callbackButtonsForMessage(surface)) {
      expectedCallbacks += 1;
      callbackIndex += 1;
      await adapter.handleUpdate(callbackUpdate({
        callbackData: button.callbackData,
        chatId: 42,
        callbackQueryId: `cb-no-thread-${callbackIndex}`,
      }));
    }
  }

  assert.equal(callbacks.length, expectedCallbacks);
  assert.deepEqual(callbacks.filter((callback) => (
    /Unsupported action|Action expired|Cannot read|is not a function/i.test(callback.text)
  )), []);
});

test("telegram adapter gives recovery buttons for active-thread command misses", async () => {
  const messages = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
  });

  for (const { sample } of TELEGRAM_ACTIVE_THREAD_COMMANDS) {
    await adapter.handleUpdate(messageUpdate({ text: sample, chatId: 42 }));
  }

  assert.equal(messages.length, TELEGRAM_ACTIVE_THREAD_COMMANDS.length);
  for (const [index, message] of messages.entries()) {
    const command = TELEGRAM_ACTIVE_THREAD_COMMANDS[index].command;
    assertNoActiveThreadRecovery(message, { allowNewThreadHint: command === "plan" || command === "continue" });
  }
});

test("telegram adapter handles git log remote pull and stash commands", async () => {
  const messages = [];
  const calls = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => state,
    },
    controlSurface: {
      readGitLog: async ({ threadId, cwd }) => {
        calls.push(["log", threadId, cwd]);
        return { commits: [{ hash: "abcdef1", message: "Add Telegram support" }] };
      },
      readGitRemote: async ({ threadId, cwd }) => {
        calls.push(["remote", threadId, cwd]);
        return { url: "https://token@example.com/acme/remodex.git", ownerRepo: "acme/remodex" };
      },
      pullGit: async ({ threadId, cwd }) => {
        calls.push(["pull", threadId, cwd]);
        return { success: true, status: { branch: "main", files: [] } };
      },
      stashGit: async ({ threadId, cwd }) => {
        calls.push(["stash", threadId, cwd]);
        return { success: true, message: "Saved working directory" };
      },
      popGitStash: async ({ threadId, cwd }) => {
        calls.push(["stash_pop", threadId, cwd]);
        return { success: true, message: "Dropped refs/stash@{0}" };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/log", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/remote", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/pull", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/stash", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/stash_pop", chatId: 42 }));

  assert.deepEqual(calls, [
    ["log", "thread-1", "/tmp/current"],
    ["remote", "thread-1", "/tmp/current"],
    ["pull", "thread-1", "/tmp/current"],
    ["stash", "thread-1", "/tmp/current"],
    ["stash_pop", "thread-1", "/tmp/current"],
  ]);
  assert.equal(messages[0].text, "Log:\n- abcdef1 Add Telegram support");
  assert.equal(messages[1].text, "Remote: acme/remodex");
  assert.doesNotMatch(messages[1].text, /token/);
  assert.equal(messages[2].text, "Pull: complete on main.");
  assert.equal(messages[3].text, "Stash: saved local changes.");
  assert.equal(messages[4].text, "Stash pop: applied latest stash.");
});

test("telegram adapter confirms reset-to-remote before discarding local changes", async () => {
  const messages = [];
  const callbacks = [];
  const calls = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
    },
    controlSurface: {
      readGitStatus: async ({ threadId, cwd }) => {
        calls.push(["status", threadId, cwd]);
        return {
          branch: "main",
          files: [
            { path: "src/app.js", status: "M " },
            { path: ".env.local", status: " M" },
            { path: "scratch.txt", status: "??" },
          ],
        };
      },
      resetGitToRemote: async ({ threadId, cwd }) => {
        calls.push(["reset", threadId, cwd]);
        return { success: true, status: { branch: "main", files: [] } };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/reset_remote", chatId: 42 }));
  assert.equal(
    messages[0].text,
    "Reset to remote?\nBranch: main\nLocal changes: 3 files (1 staged, 2 unstaged).\nThis will discard local changes and untracked files in the active thread project."
  );
  assert.doesNotMatch(messages[0].text, /\.env\.local|src\/app\.js|scratch\.txt/);
  assert.equal(callbackDataForButton(messages[0], "Discard Changes").startsWith("a:"), true);
  assert.equal(actionForButton(actions, messages[0], "Discard Changes").type, "git.reset_to_remote");

  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(messages[0], "Discard Changes"),
    chatId: 42,
    callbackQueryId: "cb-reset-remote",
  }));

  assert.deepEqual(calls, [
    ["status", "thread-1", "/tmp/current"],
    ["reset", "thread-1", "/tmp/current"],
  ]);
  assert.equal(messages[1].text, "Reset to remote complete.\nBranch: main\nWorkspace now: 0 changed files.");
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-reset-remote", text: "Reset complete." }]);
});

test("telegram adapter initializes git for the active thread", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const initCalls = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: { read: () => state },
    controlSurface: {
      readGitStatus: async () => ({ isRepo: false }),
      initGit: async ({ threadId, cwd }) => {
        initCalls.push({ threadId, cwd });
        return { status: { branch: "main", files: [{ status: "??", path: "README.md" }] } };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/git", chatId: 42 }));
  const initCallback = callbackDataForButton(messages[0], "Init Git");
  await adapter.handleUpdate(callbackUpdate({ callbackData: initCallback, chatId: 42, callbackQueryId: "cb-init-git" }));
  await adapter.handleUpdate(messageUpdate({ text: "/init", chatId: 42 }));

  assert.deepEqual(initCalls, [
    { threadId: "thread-1", cwd: "/tmp/current" },
    { threadId: "thread-1", cwd: "/tmp/current" },
  ]);
  assert.equal(messages[0].text, "Git: not a repository.");
  assert.equal(messages[1].text, "Git initialized on main. 1 files are ready to commit.");
  assert.equal(messages[2].text, "Git initialized on main. 1 files are ready to commit.");
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-init-git", text: "Git initialized." }]);
});

test("telegram adapter handles native account context and Mac control commands", async () => {
  const messages = [];
  const calls = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => state,
    },
    controlSurface: {
      readAccountStatus: async () => ({
        status: "authenticated",
        authMethod: "chatgpt",
        email: "user@example.com",
        tokenReady: true,
        authToken: "secret-token",
      }),
      openLoginOnMac: async () => {
        calls.push(["login"]);
        return { success: true, openedOnMac: true };
      },
      readContextWindow: async ({ threadId }) => {
        calls.push(["context", threadId]);
        return { usage: { tokensUsed: 200_930, tokenLimit: 258_400 } };
      },
      openThreadOnMac: async ({ threadId }) => {
        calls.push(["open", threadId]);
        return { success: true, relaunched: true };
      },
      wakeMac: async () => {
        calls.push(["wake"]);
        return { success: true, durationSeconds: 30 };
      },
      readPreferences: async () => {
        calls.push(["prefs"]);
        return { preferences: { keepMacAwake: true }, applied: true };
      },
      updatePreferences: async (preferences) => {
        calls.push(["keep_awake", preferences.keepMacAwake]);
        return { preferences, applied: preferences.keepMacAwake };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/account", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/login", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/context", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/open", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/wake", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/prefs", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/keep_awake off", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/keep_awake maybe", chatId: 42 }));

  assert.deepEqual(calls, [
    ["login"],
    ["context", "thread-1"],
    ["open", "thread-1"],
    ["wake"],
    ["prefs"],
    ["keep_awake", false],
  ]);
  assert.match(messages[0].text, /Account: authenticated/);
  assert.doesNotMatch(messages[0].text, /secret-token/);
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][0].text, "Open Login");
  assert.equal(messages[1].text, "Opened ChatGPT sign-in on the Mac.");
  assert.equal(messages[2].text, "Context: 200,930 / 258,400 tokens (78%).");
  assert.equal(messages[3].text, "Opened the active thread on Mac after relaunching Codex.");
  assert.equal(messages[4].text, "Woke the Mac display for 30s.");
  assert.equal(messages[5].text, "Preferences:\nKeep Mac awake: on (active)");
  assert.equal(messages[6].text, "Preferences:\nKeep Mac awake: off");
  assert.equal(messages[7].text, "Usage: /keep_awake <on|off>");
});

test("telegram adapter cancels a pending ChatGPT login from account buttons and slash command", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const calls = [];
  let loginInFlight = true;
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
    controlSurface: {
      readAccountStatus: async () => ({
        status: "pending_login",
        authMethod: "chatgpt",
        loginInFlight,
      }),
      cancelLoginOnMac: async () => {
        calls.push(["cancel_login", loginInFlight]);
        if (!loginInFlight) {
          return { success: false, reason: "no_pending_login" };
        }
        loginInFlight = false;
        return { success: true, cancelled: true };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/account", chatId: 42 }));
  assert.match(messages[0].text, /Login is in progress on this Mac\./);
  assert.equal(callbackDataForButton(messages[0], "Cancel Login").startsWith("a:"), true);

  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(messages[0], "Cancel Login"),
    chatId: 42,
    callbackQueryId: "cb-cancel-login",
  }));
  await adapter.handleUpdate(messageUpdate({ text: "/cancel_login", chatId: 42 }));

  assert.deepEqual(calls, [
    ["cancel_login", true],
    ["cancel_login", false],
  ]);
  assert.equal(messages[1].text, "Cancelled the pending ChatGPT sign-in on the Mac.");
  assert.throws(() => callbackDataForButton(messages[1], "Cancel Login"), /button not found/);
  assert.equal(messages[2].text, "No pending ChatGPT sign-in to cancel.");
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-cancel-login", text: "Login cancelled." }]);
});

test("telegram adapter signs out of ChatGPT only after explicit confirmation", async () => {
  const messages = [];
  const callbacks = [];
  const logoutCalls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
    controlSurface: {
      readAccountStatus: async () => ({
        status: "authenticated",
        authMethod: "chatgpt",
        tokenReady: true,
      }),
      logoutOnMac: async () => {
        logoutCalls.push("logout");
        return { success: true, signedOut: true };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/account", chatId: 42 }));
  assert.equal(callbackDataForButton(messages[0], "Sign Out").startsWith("a:"), true);

  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(messages[0], "Sign Out"),
    chatId: 42,
    callbackQueryId: "cb-logout-open",
  }));
  assert.deepEqual(logoutCalls, []);
  assert.match(messages[1].text, /Sign out of ChatGPT on this Mac/);
  assert.equal(callbackDataForButton(messages[1], "Confirm Sign Out").startsWith("a:"), true);

  const confirmCallback = callbackDataForButton(messages[1], "Confirm Sign Out");
  await adapter.handleUpdate(callbackUpdate({
    callbackData: confirmCallback,
    chatId: 42,
    callbackQueryId: "cb-logout-confirm",
  }));
  await adapter.handleUpdate(callbackUpdate({
    callbackData: confirmCallback,
    chatId: 42,
    callbackQueryId: "cb-logout-confirm-again",
  }));
  await adapter.handleUpdate(messageUpdate({ text: "/logout", chatId: 42 }));

  assert.deepEqual(logoutCalls, ["logout"]);
  assert.equal(messages[2].text, "Signed out of ChatGPT on this Mac.");
  assert.throws(() => callbackDataForButton(messages[2], "Sign Out"), /button not found/);
  assert.match(messages[3].text, /Sign out of ChatGPT on this Mac/);
  assert.deepEqual(callbacks, [
    { callbackQueryId: "cb-logout-open", text: "Confirm sign-out." },
    { callbackQueryId: "cb-logout-confirm", text: "Signed out." },
    { callbackQueryId: "cb-logout-confirm-again", text: "Telegram action was already used." },
  ]);
});

test("telegram adapter requires an active thread before git maintenance commands", async () => {
  const messages = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
    controlSurface: {
      pullGit: async () => {
        throw new Error("pullGit should not be called without an active thread");
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/pull", chatId: 42 }));

  assertNoActiveThreadRecovery(messages[0]);
});

test("telegram adapter runs stacked git commands from explicit slash commands", async () => {
  const messages = [];
  const runCalls = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => state,
    },
    controlSurface: {
      runGitAction: async ({ threadId, cwd, action, message }) => {
        runCalls.push({ threadId, cwd, action, message });
        return {
          action,
          status: { branch: "remodex/telegram" },
          commit: message ? { status: "created", subject: message, commitSha: "abc123" } : { status: "skipped_not_requested" },
          push: action === "push" || action === "commit_push_pr" ? { state: "pushed" } : { status: "skipped_not_requested" },
          pr: action === "create_pr" || action === "commit_push_pr" ? { url: "https://github.com/acme/remodex/pull/7" } : { status: "skipped_not_requested" },
        };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/commit Add Telegram support", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/push", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/pr", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/ship Ship Telegram support", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/commit", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/ship", chatId: 42 }));

  assert.deepEqual(runCalls, [
    { threadId: "thread-1", cwd: "/tmp/current", action: "commit", message: "Add Telegram support" },
    { threadId: "thread-1", cwd: "/tmp/current", action: "push", message: "" },
    { threadId: "thread-1", cwd: "/tmp/current", action: "create_pr", message: "" },
    { threadId: "thread-1", cwd: "/tmp/current", action: "commit_push_pr", message: "Ship Telegram support" },
  ]);
  assert.match(messages[0].text, /Git commit completed/);
  assert.match(messages[1].text, /Git push completed/);
  assert.match(messages[1].text, /Push: complete/);
  assert.match(messages[2].text, /Git PR completed/);
  assert.match(messages[2].text, /https:\/\/github.com\/acme\/remodex\/pull\/7/);
  assert.match(messages[3].text, /Git ship completed/);
  assert.equal(messages[4].text, "Usage: /commit <message>");
  assert.equal(messages[5].text, "Usage: /ship <commit message>");
});

test("telegram adapter requires an active thread before stacked git commands", async () => {
  const messages = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
    controlSurface: {
      runGitAction: async () => {
        throw new Error("runGitAction should not be called without an active thread");
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/push", chatId: 42 }));

  assertNoActiveThreadRecovery(messages[0]);
});

test("telegram adapter checks out branches by command and refuses stale branch buttons", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const checkoutCalls = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
    },
    controlSurface: {
      readGitBranches: async () => ({
        current: "main",
        branches: ["main", "feature/telegram", "worktree/other"],
        branchesCheckedOutElsewhere: ["worktree/other"],
        status: { branch: "main", files: [] },
      }),
      checkoutBranch: async ({ threadId, cwd, branch }) => {
        checkoutCalls.push({ threadId, cwd, branch });
        return {
          current: branch,
          status: { branch, files: [{ path: "a.js", status: " M" }] },
        };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/checkout feature/telegram", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/checkout", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/branches", chatId: 42 }));

  assert.deepEqual(checkoutCalls, [{ threadId: "thread-1", cwd: "/tmp/current", branch: "feature/telegram" }]);
  assert.equal(messages[0].text, "Checked out feature/telegram. 1 changed files remain in the working tree.");
  assert.equal(messages[1].text, "Usage: /checkout <branch>");
  assert.ok(messages[2].replyMarkup.inline_keyboard.length >= 1);
  assert.equal(messages[2].replyMarkup.inline_keyboard[0][0].text, "Checkout feature/telegram");

  const checkoutCallback = callbackDataForButton(messages[2], "Checkout feature/telegram");
  state.linkedChats[0].activeThreadId = "thread-2";
  await adapter.handleUpdate(callbackUpdate({ callbackData: checkoutCallback, chatId: 42, callbackQueryId: "cb-stale-checkout" }));

  assert.deepEqual(checkoutCalls, [{ threadId: "thread-1", cwd: "/tmp/current", branch: "feature/telegram" }]);
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-stale-checkout", text: "Thread changed. Run /branches." }]);
});

test("telegram adapter creates branches by command only", async () => {
  const messages = [];
  const createBranchCalls = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => state,
    },
    controlSurface: {
      createBranch: async ({ threadId, cwd, name }) => {
        createBranchCalls.push({ threadId, cwd, name });
        return {
          branch: `remodex/${name}`,
          status: { branch: `remodex/${name}`, files: [{ path: "a.js", status: " M" }] },
        };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/branch telegram-support", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/branch", chatId: 42 }));

  assert.deepEqual(createBranchCalls, [{ threadId: "thread-1", cwd: "/tmp/current", name: "telegram-support" }]);
  assert.deepEqual(messages, [
    { chatId: "42", text: "Created and switched to remodex/telegram-support. 1 changed files remain in the working tree." },
    { chatId: "42", text: "Usage: /branch <name>" },
  ]);
});

test("telegram adapter requires an active thread before creating branches", async () => {
  const messages = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
    controlSurface: {
      createBranch: async () => {
        throw new Error("createBranch should not be called without an active thread");
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/branch telegram-support", chatId: 42 }));

  assertNoActiveThreadRecovery(messages[0]);
});

test("telegram adapter creates a new active thread from command and inline button", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  const createCalls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: {
      readStatus: async () => ({ bridgeStatus: { connectionStatus: "connected", codexLaunchState: "ready" } }),
      listThreads: async () => ([{ id: state.linkedChats[0].activeThreadId, title: "Current", cwd: state.linkedChats[0].activeThreadCwd }]),
      createThread: async ({ sourceThreadId, sourceCwd }) => {
        createCalls.push({ sourceThreadId, sourceCwd });
        const nextId = `thread-new-${createCalls.length}`;
        return { threadId: nextId, thread: { id: nextId, title: `New ${createCalls.length}`, cwd: `/tmp/new-${createCalls.length}` } };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/new", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/status", chatId: 42 }));
  const threadsHubCallback = callbackDataForButton(messages[1], "Threads");
  await adapter.handleUpdate(callbackUpdate({ callbackData: threadsHubCallback, chatId: 42, callbackQueryId: "cb-threads-hub" }));
  const newCallback = callbackDataForButton(messages[2], "New");
  await adapter.handleUpdate(callbackUpdate({ callbackData: newCallback, chatId: 42, callbackQueryId: "cb-new" }));

  assert.deepEqual(createCalls, [
    { sourceThreadId: "thread-1", sourceCwd: "/tmp/current" },
    { sourceThreadId: "thread-new-1", sourceCwd: "/tmp/new-1" },
  ]);
  assert.equal(state.linkedChats[0].activeThreadId, "thread-new-2");
  assert.equal(state.linkedChats[0].activeThreadCwd, "/tmp/new-2");
  assert.equal(messages[0].text, "New active thread: New 1");
  assert.equal(callbackDataForButton(messages[0], "Menu").startsWith("a:"), true);
  assert.equal(messages[3].text, "New active thread: New 2");
  assert.deepEqual(callbacks, [
    { callbackQueryId: "cb-threads-hub", text: "Hub opened." },
    { callbackQueryId: "cb-new", text: "New thread created." },
  ]);
});

test("telegram adapter creates a first active thread without an existing selection", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik" }],
    pendingLinkCode: null,
  };
  const createCalls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: {
      readStatus: async () => ({ bridgeStatus: { connectionStatus: "connected", codexLaunchState: "ready" } }),
      listThreads: async () => (
        state.linkedChats[0].activeThreadId
          ? [{ id: state.linkedChats[0].activeThreadId, title: "Fresh", cwd: state.linkedChats[0].activeThreadCwd }]
          : []
      ),
      createThread: async ({ sourceThreadId, sourceCwd }) => {
        createCalls.push({ sourceThreadId, sourceCwd });
        const nextId = `thread-new-${createCalls.length}`;
        return { threadId: nextId, thread: { id: nextId, title: `Fresh ${createCalls.length}`, cwd: `/tmp/fresh-${createCalls.length}` } };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/status", chatId: 42 }));
  const threadsHubCallback = callbackDataForButton(messages[0], "Threads");
  await adapter.handleUpdate(callbackUpdate({ callbackData: threadsHubCallback, chatId: 42, callbackQueryId: "cb-threads-hub" }));
  const newCallback = callbackDataForButton(messages[1], "New");
  await adapter.handleUpdate(callbackUpdate({ callbackData: newCallback, chatId: 42, callbackQueryId: "cb-new" }));
  await adapter.handleUpdate(messageUpdate({ text: "/new", chatId: 42 }));

  assert.equal(messages[0].replyMarkup.inline_keyboard[0][0].text, "Chat");
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][1].text, "Threads");
  assert.equal(messages[1].replyMarkup.inline_keyboard[0][0].text, "Threads");
  assert.equal(messages[1].replyMarkup.inline_keyboard[1][0].text, "New");
  assert.deepEqual(createCalls, [
    { sourceThreadId: undefined, sourceCwd: undefined },
    { sourceThreadId: "thread-new-1", sourceCwd: "/tmp/fresh-1" },
  ]);
  assert.equal(state.linkedChats[0].activeThreadId, "thread-new-2");
  assert.equal(state.linkedChats[0].activeThreadCwd, "/tmp/fresh-2");
  assert.equal(messages[2].text, "New active thread: Fresh 1");
  assert.equal(messages[3].text, "New active thread: Fresh 2");
  assert.deepEqual(callbacks, [
    { callbackQueryId: "cb-threads-hub", text: "Hub opened." },
    { callbackQueryId: "cb-new", text: "New thread created." },
  ]);
});

test("telegram adapter sends approval buttons only to linked chats on the active thread", async () => {
  const messages = [];
  const callbacks = [];
  const approvals = [];
  const actions = createFakeActionRegistry();
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => ({
        linkedChats: [
          { chatId: "42", activeThreadId: "thread-1" },
          { chatId: "99", activeThreadId: "thread-2" },
        ],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      resolveApproval: async (payload, decision) => approvals.push({ payload, decision }),
    },
  });

  const didSend = await adapter.sendServerRequest(JSON.stringify({
    id: "approval-1",
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      command: "npm test",
      reason: "Verify the Telegram bridge",
    },
  }));
  const didSkip = await adapter.sendServerRequest(JSON.stringify({
    id: "approval-2",
    method: "item/fileChange/requestApproval",
    params: { threadId: "thread-missing" },
  }));

  assert.equal(didSend, true);
  assert.equal(didSkip, false);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].chatId, "42");
  assert.match(messages[0].text, /Approval requested: command/);
  assert.match(messages[0].text, /Command: npm test/);
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][0].text, "Approve");
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][1].text, "Decline");

  const approveCallback = messages[0].replyMarkup.inline_keyboard[0][0].callback_data;
  await adapter.handleUpdate(callbackUpdate({ callbackData: approveCallback, chatId: 42, callbackQueryId: "cb-approval" }));

  assert.deepEqual(approvals, [{
    payload: {
      requestId: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-1",
        command: "npm test",
        reason: "Verify the Telegram bridge",
      },
    },
    decision: "accept",
  }]);
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-approval", text: "Approval sent." }]);
});

test("telegram adapter reopens pending approval requests with fresh buttons", async () => {
  const messages = [];
  const callbacks = [];
  const approvals = [];
  const actions = createFakeActionRegistry();
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => ({
        linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      resolveApproval: async (payload, decision) => approvals.push({ payload, decision }),
    },
  });

  await adapter.sendServerRequest(JSON.stringify({
    id: "approval-reopen-1",
    method: "item/fileChange/requestApproval",
    params: {
      threadId: "thread-1",
      reason: "Apply local edits",
    },
  }));

  await adapter.handleUpdate(messageUpdate({ text: "/pending", chatId: 42 }));

  assert.equal(messages.length, 2);
  assert.match(messages[1].text, /Approval requested: file change/);
  assert.match(messages[1].text, /Reason: Apply local edits/);
  assert.equal(callbackDataForButton(messages[1], "Approve").startsWith("a:"), true);

  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(messages[1], "Approve"),
    chatId: 42,
    callbackQueryId: "cb-approval-reopened",
  }));

  assert.deepEqual(approvals, [{
    payload: {
      requestId: "approval-reopen-1",
      method: "item/fileChange/requestApproval",
      params: {
        threadId: "thread-1",
        reason: "Apply local edits",
      },
    },
    decision: "accept",
  }]);
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-approval-reopened", text: "Approval sent." }]);

  await adapter.handleUpdate(messageUpdate({ text: "/pending", chatId: 42 }));

  assert.match(messages[2].text, /No pending Codex prompt or approval/);
});

test("telegram adapter reports approval callback routing gaps instead of claiming success", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => ({
        linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }],
        pendingLinkCode: null,
      }),
    },
  });

  await adapter.sendServerRequest(JSON.stringify({
    id: "approval-missing-resolver",
    method: "item/fileChange/requestApproval",
    params: {
      threadId: "thread-1",
      reason: "Apply local changes",
    },
  }));
  const approveCallback = messages[0].replyMarkup.inline_keyboard[0][0].callback_data;

  await adapter.handleUpdate(callbackUpdate({
    callbackData: approveCallback,
    chatId: 42,
    callbackQueryId: "cb-approval-missing-resolver",
  }));

  assert.deepEqual(callbacks, [{
    callbackQueryId: "cb-approval-missing-resolver",
    text: "Telegram approval replies are not available on this bridge.",
  }]);
});

test("telegram adapter sends and resolves single-question user input buttons", async () => {
  const messages = [];
  const callbacks = [];
  const userInputs = [];
  const actions = createFakeActionRegistry();
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => ({
        linkedChats: [
          { chatId: "42", activeThreadId: "thread-1" },
          { chatId: "99", activeThreadId: "thread-2" },
        ],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      resolveUserInput: async (payload) => userInputs.push(payload),
    },
  });

  const didSend = await adapter.sendServerRequest(JSON.stringify({
    id: "input-1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [{
        id: "q1",
        header: "Mode",
        question: "Choose the next step",
        options: [
          { label: "Continue", description: "Proceed" },
          { label: "Stop", description: "Pause" },
        ],
      }],
    },
  }));

  assert.equal(didSend, true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].chatId, "42");
  assert.match(messages[0].text, /Codex needs input/);
  assert.match(messages[0].text, /Mode: Choose the next step/);
  assert.equal(callbackDataForButton(messages[0], "Continue").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Open Mac").startsWith("a:"), true);

  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(messages[0], "Continue"),
    chatId: 42,
    callbackQueryId: "cb-input",
  }));

  assert.deepEqual(userInputs, [{
    requestId: "input-1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [{
        id: "q1",
        header: "Mode",
        question: "Choose the next step",
        options: [
          { label: "Continue", description: "Proceed" },
          { label: "Stop", description: "Pause" },
        ],
      }],
    },
    answers: {
      q1: { answers: ["Continue"] },
    },
  }]);
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-input", text: "Answer sent." }]);
});

test("telegram adapter reopens a pending user input prompt with fresh buttons", async () => {
  const messages = [];
  const callbacks = [];
  const userInputs = [];
  const actions = createFakeActionRegistry();
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => ({
        linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      resolveUserInput: async (payload) => userInputs.push(payload),
    },
  });

  await adapter.sendServerRequest(JSON.stringify({
    id: "input-reopen-1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [{
        id: "q1",
        header: "Mode",
        question: "Choose the next step",
        options: [
          { label: "Continue", description: "Proceed" },
          { label: "Stop", description: "Pause" },
        ],
      }],
    },
  }));

  await adapter.handleUpdate(messageUpdate({ text: "/pending", chatId: 42 }));

  assert.equal(messages.length, 2);
  assert.match(messages[1].text, /Codex needs input/);
  assert.match(messages[1].text, /Mode: Choose the next step/);
  assert.equal(callbackDataForButton(messages[1], "Continue").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[1], "Open Mac").startsWith("a:"), true);

  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(messages[1], "Continue"),
    chatId: 42,
    callbackQueryId: "cb-input-reopened",
  }));

  assert.deepEqual(userInputs, [{
    requestId: "input-reopen-1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [{
        id: "q1",
        header: "Mode",
        question: "Choose the next step",
        options: [
          { label: "Continue", description: "Proceed" },
          { label: "Stop", description: "Pause" },
        ],
      }],
    },
    answers: {
      q1: { answers: ["Continue"] },
    },
  }]);
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-input-reopened", text: "Answer sent." }]);
});

test("telegram adapter rejects typed answers outside pending input options", async () => {
  const messages = [];
  const userInputs = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({
        linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      resolveUserInput: async (payload) => userInputs.push(payload),
    },
  });

  await adapter.sendServerRequest(JSON.stringify({
    id: "input-options-typed",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [{
        id: "q1",
        header: "Mode",
        question: "Choose the next step",
        options: [
          { label: "Continue", description: "Proceed" },
          { label: "Stop", description: "Pause" },
        ],
      }],
    },
  }));

  await adapter.handleUpdate(messageUpdate({ text: "/answer Something else", chatId: 42 }));
  assert.equal(userInputs.length, 0);
  assert.equal(messages[1].text, "Usage: /answer <Continue|Stop>\nOrder: 1. Mode");

  await adapter.handleUpdate(messageUpdate({ text: "/answer continue", chatId: 42 }));
  assert.deepEqual(userInputs, [{
    requestId: "input-options-typed",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [{
        id: "q1",
        header: "Mode",
        question: "Choose the next step",
        options: [
          { label: "Continue", description: "Proceed" },
          { label: "Stop", description: "Pause" },
        ],
      }],
    },
    answers: {
      q1: { answers: ["Continue"] },
    },
  }]);
  assert.equal(messages[2].text, "Answer sent to Codex.");
});

test("telegram adapter answers a pending freeform user input request with slash command", async () => {
  const messages = [];
  const userInputs = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({
        linkedChats: [
          { chatId: "42", activeThreadId: "thread-1" },
          { chatId: "99", activeThreadId: "thread-2" },
        ],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      resolveUserInput: async (payload) => userInputs.push(payload),
      readThreadActivity: async () => ({ entries: [] }),
      openThreadOnMac: async () => ({ success: true }),
    },
  });

  const didSend = await adapter.sendServerRequest(JSON.stringify({
    id: "input-freeform-1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [{
        id: "q1",
        header: "Clarify",
        question: "What should Codex do next?",
      }],
    },
  }));

  assert.equal(didSend, true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].chatId, "42");
  assert.match(messages[0].text, /Reply with \/answer <response>/);
  assert.equal(callbackDataForButton(messages[0], "Open Mac").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Activity").startsWith("a:"), true);

  await adapter.handleUpdate(messageUpdate({ text: "/answer Keep the fix local-first", chatId: 42 }));

  assert.deepEqual(userInputs, [{
    requestId: "input-freeform-1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [{
        id: "q1",
        header: "Clarify",
        question: "What should Codex do next?",
      }],
    },
    answers: {
      q1: { answers: ["Keep the fix local-first"] },
    },
  }]);
  assert.equal(messages[1].text, "Answer sent to Codex.");

  await adapter.handleUpdate(messageUpdate({ text: "/answer This should not go anywhere", chatId: 42 }));
  assert.equal(userInputs.length, 1);
  assert.match(messages[2].text, /No pending Codex input prompt/);
  assert.equal(callbackDataForButton(messages[2], "Activity").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[2], "Open Mac").startsWith("a:"), true);
});

test("telegram adapter answers a pending freeform user input request with plain chat text", async () => {
  const messages = [];
  const userInputs = [];
  const continued = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({
        linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      resolveUserInput: async (payload) => userInputs.push(payload),
      continueThread: async (payload) => continued.push(payload),
    },
  });

  await adapter.sendServerRequest(JSON.stringify({
    id: "input-freeform-plain",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [{
        id: "q1",
        header: "Clarify",
        question: "What should Codex do next?",
      }],
    },
  }));

  await adapter.handleUpdate(messageUpdate({ text: "Keep the fix local-first", chatId: 42 }));

  assert.deepEqual(userInputs, [{
    requestId: "input-freeform-plain",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [{
        id: "q1",
        header: "Clarify",
        question: "What should Codex do next?",
      }],
    },
    answers: {
      q1: { answers: ["Keep the fix local-first"] },
    },
  }]);
  assert.deepEqual(continued, []);
  assert.equal(messages[1].text, "Answer sent to Codex.");
});

test("telegram adapter validates plain chat answers against pending input options", async () => {
  const messages = [];
  const userInputs = [];
  const continued = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({
        linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      resolveUserInput: async (payload) => userInputs.push(payload),
      continueThread: async (payload) => continued.push(payload),
    },
  });

  await adapter.sendServerRequest(JSON.stringify({
    id: "input-options-plain",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [{
        id: "q1",
        header: "Mode",
        question: "Choose the next step",
        options: [
          { label: "Continue", description: "Proceed" },
          { label: "Stop", description: "Pause" },
        ],
      }],
    },
  }));

  await adapter.handleUpdate(messageUpdate({ text: "Something else", chatId: 42 }));
  assert.equal(userInputs.length, 0);
  assert.deepEqual(continued, []);
  assert.equal(messages[1].text, "Usage: /answer <Continue|Stop>\nOrder: 1. Mode");

  await adapter.handleUpdate(messageUpdate({ text: "stop", chatId: 42 }));
  assert.deepEqual(userInputs, [{
    requestId: "input-options-plain",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [{
        id: "q1",
        header: "Mode",
        question: "Choose the next step",
        options: [
          { label: "Continue", description: "Proceed" },
          { label: "Stop", description: "Pause" },
        ],
      }],
    },
    answers: {
      q1: { answers: ["Stop"] },
    },
  }]);
  assert.deepEqual(continued, []);
  assert.equal(messages[2].text, "Answer sent to Codex.");
});

test("telegram adapter answers a pending multi-question user input request by line order", async () => {
  const messages = [];
  const userInputs = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({
        linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      resolveUserInput: async (payload) => userInputs.push(payload),
      readThreadActivity: async () => ({ entries: [] }),
      openThreadOnMac: async () => ({ success: true }),
    },
  });

  await adapter.sendServerRequest(JSON.stringify({
    id: "input-multi-1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [
        { id: "goal", header: "Goal", question: "What outcome should Codex optimize for?" },
        { id: "risk", header: "Risk", question: "What should Codex avoid?" },
      ],
    },
  }));

  assert.match(messages[0].text, /one response per line/);

  await adapter.handleUpdate(messageUpdate({ text: "/answer Useful chat first", chatId: 42 }));
  assert.equal(userInputs.length, 0);
  assert.match(messages[1].text, /Usage: \/answer <response>\n<response 2>/);

  await adapter.handleUpdate(messageUpdate({
    text: "/answer Useful chat first\nHosted-service drift",
    chatId: 42,
  }));

  assert.deepEqual(userInputs, [{
    requestId: "input-multi-1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [
        { id: "goal", header: "Goal", question: "What outcome should Codex optimize for?" },
        { id: "risk", header: "Risk", question: "What should Codex avoid?" },
      ],
    },
    answers: {
      goal: { answers: ["Useful chat first"] },
      risk: { answers: ["Hosted-service drift"] },
    },
  }]);
  assert.equal(messages[2].text, "Answer sent to Codex.");
});

test("telegram adapter validates option labels inside multi-question typed answers", async () => {
  const messages = [];
  const userInputs = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({
        linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      resolveUserInput: async (payload) => userInputs.push(payload),
    },
  });

  await adapter.sendServerRequest(JSON.stringify({
    id: "input-multi-options-1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [
        {
          id: "mode",
          header: "Mode",
          question: "How should Codex proceed?",
          options: [
            { label: "Continue", description: "Proceed" },
            { label: "Stop", description: "Pause" },
          ],
        },
        { id: "note", header: "Note", question: "What else should Codex know?" },
      ],
    },
  }));

  await adapter.handleUpdate(messageUpdate({
    text: "/answer Something else\nKeep it local-first",
    chatId: 42,
  }));
  assert.equal(userInputs.length, 0);
  assert.match(messages[1].text, /Usage: \/answer <Continue\|Stop>\n<response 2>/);

  await adapter.handleUpdate(messageUpdate({
    text: "/answer stop\nKeep it local-first",
    chatId: 42,
  }));
  assert.deepEqual(userInputs, [{
    requestId: "input-multi-options-1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      questions: [
        {
          id: "mode",
          header: "Mode",
          question: "How should Codex proceed?",
          options: [
            { label: "Continue", description: "Proceed" },
            { label: "Stop", description: "Pause" },
          ],
        },
        { id: "note", header: "Note", question: "What else should Codex know?" },
      ],
    },
    answers: {
      mode: { answers: ["Stop"] },
      note: { answers: ["Keep it local-first"] },
    },
  }]);
});

test("telegram adapter auto-approves active-thread requests in full access mode", async () => {
  const messages = [];
  const approvals = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({
        linkedChats: [
          { chatId: "42", activeThreadId: "thread-1", runtimeAccessMode: "full-access" },
        ],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      resolveApproval: async (payload, decision) => approvals.push({ payload, decision }),
    },
  });

  const didSend = await adapter.sendServerRequest(JSON.stringify({
    id: "approval-full",
    method: "item/fileChange/requestApproval",
    params: {
      threadId: "thread-1",
      reason: "Apply local changes",
    },
  }));

  assert.equal(didSend, true);
  assert.deepEqual(approvals, [{
    payload: {
      requestId: "approval-full",
      method: "item/fileChange/requestApproval",
      params: {
        threadId: "thread-1",
        reason: "Apply local changes",
      },
    },
    decision: "accept",
  }]);
  assert.deepEqual(messages, [{
    chatId: "42",
    text: "Auto-approved request because Telegram access mode is Full Access.",
  }]);
});

test("telegram adapter mirrors compact active-thread events to matching linked chats", async () => {
  const messages = [];
  const actions = createFakeActionRegistry();
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => ({
        linkedChats: [
          { chatId: "42", activeThreadId: "thread-1" },
          { chatId: "99", activeThreadId: "thread-2" },
        ],
        pendingLinkCode: null,
      }),
    },
  });

  assert.equal(await adapter.sendServerRequest(JSON.stringify({
    method: "turn/started",
    params: { threadId: "thread-1", turnId: "turn-1" },
  })), true);
  assert.equal(await adapter.sendServerRequest(JSON.stringify({
    method: "turn/started",
    params: { threadId: "thread-1", turnId: "turn-1" },
  })), false);
  assert.equal(await adapter.sendServerRequest(JSON.stringify({
    method: "codex/event/agent_message",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-final",
      message: "Ready from Telegram.",
    },
  })), true);
  assert.equal(await adapter.sendServerRequest(JSON.stringify({
    method: "turn/completed",
    params: { threadId: "thread-1", turnId: "turn-1" },
  })), false);
  assert.equal(await adapter.sendServerRequest(JSON.stringify({
    method: "turn/completed",
    params: { threadId: "thread-2", turnId: "turn-2" },
  })), true);

  assert.equal(messages.length, 3);
  assert.equal(messages[0].chatId, "42");
  assert.equal(messages[0].text, "Remodex started working on the active thread.");
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][0].text, "Stop");
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][1].text, "Status");
  assert.equal(callbackDataForButton(messages[0], "Stop").startsWith("a:"), true);
  assert.equal(messages[1].chatId, "42");
  assert.equal(messages[1].text, "Assistant:\nReady from Telegram.");
  assert.equal(messages[1].replyMarkup.inline_keyboard[0][0].text, "Activity");
  assert.equal(messages[1].replyMarkup.inline_keyboard[0][1].text, "Pending");
  assert.equal(messages[1].replyMarkup.inline_keyboard[1][0].text, "Menu");
  assert.equal(messages[1].replyMarkup.inline_keyboard[1][1].text, "Open Mac");
  assert.equal(callbackDataForButton(messages[1], "Activity").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[1], "Pending").startsWith("a:"), true);
  assert.equal(messages[2].chatId, "99");
  assert.equal(messages[2].text, "Remodex finished the active turn.");
  assert.equal(callbackDataForButton(messages[2], "Activity").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[2], "Menu").startsWith("a:"), true);
});

test("telegram adapter refuses stale thread-scoped post-turn buttons", async () => {
  const messages = [];
  const callbacks = [];
  const calls = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }],
    pendingLinkCode: null,
  };
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
    },
    controlSurface: {
      readThreadActivity: async () => calls.push("activity"),
      openThreadOnMac: async () => calls.push("open"),
    },
  });

  assert.equal(await adapter.sendServerRequest(JSON.stringify({
    method: "codex/event/agent_message",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      message: "Ready from Telegram.",
    },
  })), true);
  state.linkedChats[0].activeThreadId = "thread-2";

  for (const label of ["Activity", "Pending", "Open Mac"]) {
    await adapter.handleUpdate(callbackUpdate({
      callbackData: callbackDataForButton(messages[0], label),
      chatId: 42,
      callbackQueryId: `cb-stale-${label}`,
    }));
  }

  assert.deepEqual(calls, []);
  assert.deepEqual(callbacks, [
    { callbackQueryId: "cb-stale-Activity", text: "Thread changed. Run /status." },
    { callbackQueryId: "cb-stale-Pending", text: "Thread changed. Run /status." },
    { callbackQueryId: "cb-stale-Open Mac", text: "Thread changed. Run /status." },
  ]);
});

test("telegram adapter refuses stale stop buttons after the active thread changes", async () => {
  const messages = [];
  const callbacks = [];
  const actions = createFakeActionRegistry();
  const state = {
    linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }],
    pendingLinkCode: null,
  };
  const stopCalls = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    sessionState: {
      read: () => state,
    },
    controlSurface: {
      stopThread: async (threadId) => stopCalls.push(threadId),
    },
  });

  await adapter.sendServerRequest(JSON.stringify({
    method: "turn/started",
    params: { threadId: "thread-1", turnId: "turn-1" },
  }));
  const stopCallback = callbackDataForButton(messages[0], "Stop");
  state.linkedChats[0].activeThreadId = "thread-2";
  await adapter.handleUpdate(callbackUpdate({ callbackData: stopCallback, chatId: 42, callbackQueryId: "cb-stale-stop" }));

  assert.deepEqual(stopCalls, []);
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-stale-stop", text: "Thread changed. Run /status." }]);
});

test("telegram adapter stops active threads and resolves approval callbacks", async () => {
  const messages = [];
  const callbacks = [];
  const stopCalls = [];
  const approvals = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }], pendingLinkCode: null }),
    },
    actionRegistry: {
      consumeAction: (callbackData) => ({ type: "approval.accept", payload: { requestId: callbackData } }),
    },
    controlSurface: {
      stopThread: async (threadId) => stopCalls.push(threadId),
      resolveApproval: async (payload, decision) => approvals.push({ payload, decision }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/stop", chatId: 42 }));
  await adapter.handleUpdate(callbackUpdate({ callbackData: "a:ABC", chatId: 42, callbackQueryId: "cb-1" }));

  assert.deepEqual(stopCalls, ["thread-1"]);
  assert.equal(messages[0].text, "Stop requested for the active Remodex thread.");
  assert.deepEqual(approvals, [{ payload: { requestId: "a:ABC" }, decision: "accept" }]);
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-1", text: "Approval sent." }]);
});

test("telegram adapter gives recovery copy for expired or unknown callback buttons", async () => {
  const messages = [];
  const callbacks = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }], pendingLinkCode: null }),
    },
  });

  await adapter.handleUpdate(callbackUpdate({ callbackData: "a:MISSING", chatId: 42, callbackQueryId: "cb-missing" }));
  await adapter.handleUpdate(callbackUpdate({ callbackData: "not-an-action", chatId: 42, callbackQueryId: "cb-invalid" }));

  assert.deepEqual(callbacks, [
    { callbackQueryId: "cb-missing", text: "Button expired. Run /menu." },
    { callbackQueryId: "cb-invalid", text: "Button expired. Run /menu." },
  ]);
});

test("telegram adapter gives restricted recovery copy for expired callback buttons", async () => {
  const messages = [];
  const callbacks = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    telegramAccess: {
      allowed: false,
      status: "requires_pro",
      message: "Remodex Telegram requires an active Remodex Pro entitlement.",
      upgradeOptions: [],
    },
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }], pendingLinkCode: null }),
    },
  });

  await adapter.handleUpdate(callbackUpdate({ callbackData: "a:MISSING", chatId: 42, callbackQueryId: "cb-missing" }));
  await adapter.handleUpdate(callbackUpdate({ callbackData: "not-an-action", chatId: 42, callbackQueryId: "cb-invalid" }));

  assert.deepEqual(callbacks, [
    { callbackQueryId: "cb-missing", text: "Button expired. Run /help or /upgrade." },
    { callbackQueryId: "cb-invalid", text: "Button expired. Run /help or /upgrade." },
  ]);
});

test("telegram adapter continues the active thread with explicit text only", async () => {
  const messages = [];
  const continued = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }], pendingLinkCode: null }),
    },
    controlSurface: {
      continueThread: async ({ threadId, text }) => continued.push({ threadId, text }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/continue Ship the Telegram slice", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/continue", chatId: 42 }));

  assert.deepEqual(continued, [{ threadId: "thread-1", text: "Ship the Telegram slice" }]);
  assert.equal(messages[0].text, "Sent to the active Remodex thread.");
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][0].text, "Stop");
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][1].text, "Status");
  assert.equal(messages[0].replyMarkup.inline_keyboard[1][0].text, "Activity");
  assert.equal(messages[0].replyMarkup.inline_keyboard[2][0].text, "Menu");
  assert.equal(messages[0].replyMarkup.inline_keyboard[2][1].text, "Open Mac");
  assert.equal(messages[1].text, "Usage: /continue <message>");
});

test("telegram adapter sends plan-mode input to the active thread", async () => {
  const messages = [];
  const continued = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({
        linkedChats: [{
          chatId: "42",
          activeThreadId: "thread-1",
          runtimeModel: "gpt-5.4-mini",
          reasoningEffort: "high",
        }],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      continueThread: async ({
        threadId,
        text,
        runtimePreferences,
        collaborationMode,
      }) => continued.push({ threadId, text, runtimePreferences, collaborationMode }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/plan Find the smallest valuable Telegram refactor", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/plan", chatId: 42 }));

  assert.deepEqual(continued, [{
    threadId: "thread-1",
    text: "Find the smallest valuable Telegram refactor",
    runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high" },
    collaborationMode: "plan",
  }]);
  assert.equal(messages[0].text, "Sent plan-mode request to the active Remodex thread.");
  assert.equal(messages[1].text, "Usage: /plan <message>");
});

test("telegram adapter sends subagent delegation as active-thread input", async () => {
  const messages = [];
  const continued = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({
        linkedChats: [{
          chatId: "42",
          activeThreadId: "thread-1",
          activeThreadCwd: "/tmp/current",
          runtimeModel: "gpt-5.4-mini",
          reasoningEffort: "high",
        }],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      continueThread: async ({
        threadId,
        text,
        runtimePreferences,
        collaborationMode,
      }) => continued.push({ threadId, text, runtimePreferences, collaborationMode }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/subagents audit the Telegram integration", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/subagents", chatId: 42 }));

  assert.deepEqual(continued, [{
    threadId: "thread-1",
    text: "Run subagents for different tasks. Delegate distinct work in parallel when helpful and then synthesize the results.\n\nTask: audit the Telegram integration",
    runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high" },
    collaborationMode: "",
  }]);
  assert.equal(messages[0].text, "Sent subagent delegation request to the active Remodex thread.");
  assert.equal(messages[1].text, "Delegate parallel work with /subagents <task>.");
});

test("telegram adapter starts native code review from command targets", async () => {
  const messages = [];
  const reviews = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({
        linkedChats: [{
          chatId: "42",
          activeThreadId: "thread-1",
          activeThreadCwd: "/tmp/current",
          runtimeModel: "gpt-5.4-mini",
          reasoningEffort: "high",
          runtimeAccessMode: "full-access",
        }],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      startReview: async ({ threadId, cwd, target, baseBranch, runtimePreferences }) => {
        reviews.push({ threadId, cwd, target, baseBranch, runtimePreferences });
        return { turnId: `turn-${reviews.length}`, target: { type: target, branch: baseBranch } };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/review changes", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/review base main", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/review", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/review base", chatId: 42 }));

  assert.deepEqual(reviews, [
    {
      threadId: "thread-1",
      cwd: "/tmp/current",
      target: "uncommittedChanges",
      baseBranch: "",
      runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high", accessMode: "full-access" },
    },
    {
      threadId: "thread-1",
      cwd: "/tmp/current",
      target: "baseBranch",
      baseBranch: "main",
      runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high", accessMode: "full-access" },
    },
  ]);
  assert.equal(messages[0].text, "Review started for uncommitted changes.\nTurn: turn-1\nFindings will arrive in the active thread.");
  assert.equal(messages[1].text, "Review started against main.\nTurn: turn-2\nFindings will arrive in the active thread.");
  assert.equal(messages[2].text, "Usage: /review <changes|base <branch>>");
  assert.match(messages[3].text, /A base branch is required/);
});

test("telegram adapter treats ordinary chat text and captions as active-thread input", async () => {
  const messages = [];
  const continued = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }], pendingLinkCode: null }),
    },
    controlSurface: {
      continueThread: async ({ threadId, text }) => continued.push({ threadId, text }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "Ship the Telegram slice", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ caption: "Use this screenshot as context", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/unknown", chatId: 42 }));

  assert.deepEqual(continued, [
    { threadId: "thread-1", text: "Ship the Telegram slice" },
    { threadId: "thread-1", text: "Use this screenshot as context" },
  ]);
  assert.equal(messages[0].text, "Sent to the active Remodex thread.");
  assert.equal(messages[1].text, "Sent to the active Remodex thread.");
  assert.match(messages[2].text, /^Remodex Telegram\nType a message to chat with Codex\./);
  assert.match(messages[2].text, /Chat: .*\/continue <message>/);
});

test("telegram adapter sends Telegram photos and image documents as Codex image input", async () => {
  const messages = [];
  const continued = [];
  const files = [];
  const adapter = createTelegramAdapter({
    botClient: {
      ...fakeBot(messages),
      getFile: async ({ fileId }) => {
        files.push({ op: "getFile", fileId });
        return { file_path: fileId === "photo-large" ? "photos/photo-large.jpg" : "documents/wireframe.png" };
      },
      downloadFile: async ({ filePath }) => {
        files.push({ op: "downloadFile", filePath });
        return {
          data: Buffer.from(filePath.endsWith(".png") ? "png-bytes" : "jpg-bytes"),
          contentType: filePath.endsWith(".png") ? "image/png" : "image/jpeg",
        };
      },
    },
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }], pendingLinkCode: null }),
    },
    controlSurface: {
      continueThread: async ({ threadId, text, attachments }) => continued.push({ threadId, text, attachments }),
    },
  });

  await adapter.handleUpdate(messageUpdate({
    caption: "Use this screenshot as context",
    chatId: 42,
    photo: [
      { file_id: "photo-small", width: 100, height: 100, file_size: 1000 },
      { file_id: "photo-large", width: 1000, height: 1000, file_size: 2000 },
    ],
  }));
  await adapter.handleUpdate(messageUpdate({
    text: "/continue",
    chatId: 42,
    document: {
      file_id: "doc-image",
      file_name: "wireframe.png",
      mime_type: "image/png",
    },
  }));

  assert.deepEqual(files, [
    { op: "getFile", fileId: "photo-large" },
    { op: "downloadFile", filePath: "photos/photo-large.jpg" },
    { op: "getFile", fileId: "doc-image" },
    { op: "downloadFile", filePath: "documents/wireframe.png" },
  ]);
  assert.deepEqual(continued, [
    {
      threadId: "thread-1",
      text: "Use this screenshot as context",
      attachments: [
        {
          type: "input_image",
          image_url: `data:image/jpeg;base64,${Buffer.from("jpg-bytes").toString("base64")}`,
        },
      ],
    },
    {
      threadId: "thread-1",
      text: "Please inspect the attached Telegram image.",
      attachments: [
        {
          type: "input_image",
          image_url: `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`,
        },
      ],
    },
  ]);
  assert.equal(messages[0].text, "Sent to the active Remodex thread.");
  assert.equal(messages[1].text, "Sent to the active Remodex thread.");
});

test("telegram adapter does not treat unknown slash captions with attachments as Codex input", async () => {
  const messages = [];
  const continued = [];
  const files = [];
  const adapter = createTelegramAdapter({
    botClient: {
      ...fakeBot(messages),
      getFile: async ({ fileId }) => {
        files.push({ op: "getFile", fileId });
        return { file_path: "photos/photo-large.jpg" };
      },
      downloadFile: async ({ filePath }) => {
        files.push({ op: "downloadFile", filePath });
        return {
          data: Buffer.from("jpg-bytes"),
          contentType: "image/jpeg",
        };
      },
    },
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }], pendingLinkCode: null }),
    },
    controlSurface: {
      continueThread: async ({ threadId, text, attachments }) => continued.push({ threadId, text, attachments }),
    },
  });

  await adapter.handleUpdate(messageUpdate({
    caption: "/unknown",
    chatId: 42,
    photo: [
      { file_id: "photo-large", width: 1000, height: 1000, file_size: 2000 },
    ],
  }));

  assert.deepEqual(files, []);
  assert.deepEqual(continued, []);
  assert.match(messages[0].text, /^Remodex Telegram\nType a message to chat with Codex\./);
  assert.match(messages[0].text, /Chat: .*\/continue <message>/);
});

test("telegram adapter transcribes Telegram voice notes into active-thread input", async () => {
  const messages = [];
  const continued = [];
  const files = [];
  const transcriptions = [];
  const adapter = createTelegramAdapter({
    botClient: {
      ...fakeBot(messages),
      getFile: async ({ fileId }) => {
        files.push({ op: "getFile", fileId });
        return { file_path: "voice/file_1.oga" };
      },
      downloadFile: async ({ filePath }) => {
        files.push({ op: "downloadFile", filePath });
        return {
          data: Buffer.from("ogg-opus-bytes"),
          contentType: "audio/ogg",
        };
      },
    },
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42", activeThreadId: "thread-voice" }], pendingLinkCode: null }),
    },
    controlSurface: {
      transcribeVoice: async (payload) => {
        transcriptions.push(payload);
        return { text: "please summarize the latest diff" };
      },
      continueThread: async ({ threadId, text, attachments }) => continued.push({ threadId, text, attachments }),
    },
  });

  await adapter.handleUpdate(messageUpdate({
    chatId: 42,
    voice: {
      file_id: "voice-file-id",
      mime_type: "audio/ogg",
      duration: 3,
    },
  }));

  assert.deepEqual(files, [
    { op: "getFile", fileId: "voice-file-id" },
    { op: "downloadFile", filePath: "voice/file_1.oga" },
  ]);
  assert.equal(transcriptions.length, 1);
  assert.equal(transcriptions[0].audioData.toString("utf8"), "ogg-opus-bytes");
  assert.equal(transcriptions[0].mimeType, "audio/ogg");
  assert.equal(transcriptions[0].durationMs, 3000);
  assert.deepEqual(continued, [{
    threadId: "thread-voice",
    text: "please summarize the latest diff",
    attachments: [],
  }]);
  assert.equal(messages[0].text, "Sent to the active Remodex thread.");
});

test("telegram adapter combines voice transcripts with captions", async () => {
  const messages = [];
  const continued = [];
  const adapter = createTelegramAdapter({
    botClient: {
      ...fakeBot(messages),
      getFile: async () => ({ file_path: "voice/file_2.oga" }),
      downloadFile: async () => ({ data: Buffer.from("audio"), contentType: "audio/ogg" }),
    },
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42", activeThreadId: "thread-voice" }], pendingLinkCode: null }),
    },
    controlSurface: {
      transcribeVoice: async () => ({ text: "run the tests" }),
      continueThread: async ({ threadId, text }) => continued.push({ threadId, text }),
    },
  });

  await adapter.handleUpdate(messageUpdate({
    caption: "Context for this voice note",
    chatId: 42,
    voice: {
      file_id: "voice-file-id",
      mime_type: "audio/ogg",
      duration: 4,
    },
  }));

  assert.deepEqual(continued, [{
    threadId: "thread-voice",
    text: "Context for this voice note\n\nVoice transcript: run the tests",
  }]);
  assert.equal(messages[0].text, "Sent to the active Remodex thread.");
});

test("telegram adapter creates a first active thread for explicit continue input", async () => {
  const messages = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik" }],
    pendingLinkCode: null,
  };
  const created = [];
  const continued = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: {
      createThread: async ({ sourceThreadId, sourceCwd, runtimePreferences }) => {
        created.push({ sourceThreadId, sourceCwd, runtimePreferences });
        return { threadId: "thread-fresh", thread: { id: "thread-fresh", title: "Fresh chat", cwd: "/tmp/fresh" } };
      },
      continueThread: async ({ threadId, text, runtimePreferences }) => continued.push({ threadId, text, runtimePreferences }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/continue Ship it", chatId: 42 }));

  assert.deepEqual(created, [{
    sourceThreadId: undefined,
    sourceCwd: undefined,
    runtimePreferences: { model: "gpt-5.5", reasoningEffort: "medium" },
  }]);
  assert.deepEqual(continued, [{
    threadId: "thread-fresh",
    text: "Ship it",
    runtimePreferences: { model: "gpt-5.5", reasoningEffort: "medium" },
  }]);
  assert.equal(state.linkedChats[0].activeThreadId, "thread-fresh");
  assert.equal(state.linkedChats[0].activeThreadCwd, "/tmp/fresh");
  assert.equal(messages[0].text, "Created new active thread: Fresh chat\nSent to the active Remodex thread.");
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][0].text, "Stop");
});

test("telegram adapter creates a first active thread for explicit plan input", async () => {
  const messages = [];
  const state = {
    linkedChats: [{
      chatId: "42",
      chatTitle: "Kartik",
      runtimeModel: "gpt-5.4-mini",
      reasoningEffort: "high",
    }],
    pendingLinkCode: null,
  };
  const created = [];
  const continued = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: {
      createThread: async ({ runtimePreferences }) => {
        created.push({ runtimePreferences });
        return { threadId: "thread-plan", thread: { id: "thread-plan", title: "Planning chat", cwd: "/tmp/plan" } };
      },
      continueThread: async ({
        threadId,
        text,
        runtimePreferences,
        collaborationMode,
      }) => continued.push({ threadId, text, runtimePreferences, collaborationMode }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/plan Find the shape first", chatId: 42 }));

  assert.deepEqual(created, [{ runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high" } }]);
  assert.deepEqual(continued, [{
    threadId: "thread-plan",
    text: "Find the shape first",
    runtimePreferences: { model: "gpt-5.4-mini", reasoningEffort: "high" },
    collaborationMode: "plan",
  }]);
  assert.equal(messages[0].text, "Created new active thread: Planning chat\nSent plan-mode request to the active Remodex thread.");
});

test("telegram adapter creates a first active thread for implicit chat input", async () => {
  const messages = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik" }],
    pendingLinkCode: null,
  };
  const created = [];
  const continued = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => state,
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: {
      createThread: async ({ sourceThreadId, sourceCwd, runtimePreferences }) => {
        created.push({ sourceThreadId, sourceCwd, runtimePreferences });
        return { threadId: "thread-implicit", thread: { id: "thread-implicit", title: "Telegram chat", cwd: "/tmp/telegram" } };
      },
      continueThread: async ({ threadId, text, runtimePreferences }) => continued.push({ threadId, text, runtimePreferences }),
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "Ship it", chatId: 42 }));

  assert.deepEqual(created, [{
    sourceThreadId: undefined,
    sourceCwd: undefined,
    runtimePreferences: { model: "gpt-5.5", reasoningEffort: "medium" },
  }]);
  assert.deepEqual(continued, [{
    threadId: "thread-implicit",
    text: "Ship it",
    runtimePreferences: { model: "gpt-5.5", reasoningEffort: "medium" },
  }]);
  assert.equal(state.linkedChats[0].activeThreadId, "thread-implicit");
  assert.equal(state.linkedChats[0].activeThreadCwd, "/tmp/telegram");
  assert.equal(messages[0].text, "Created new active thread: Telegram chat\nSent to the active Remodex thread.");
  assert.equal(messages[0].replyMarkup.inline_keyboard[0][0].text, "Stop");
});

test("telegram adapter replies when command handling fails", async () => {
  const messages = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
    controlSurface: {
      listThreads: async () => {
        throw new Error("Codex request timed out: thread/list");
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/threads", chatId: 42 }));

  assert.deepEqual(messages, [{ chatId: "42", text: "Remodex could not complete /threads: Codex request timed out: thread/list" }]);
});

test("telegram adapter labels implicit chat failures as continue failures", async () => {
  const messages = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }], pendingLinkCode: null }),
    },
    controlSurface: {
      continueThread: async () => {
        throw new Error("Codex request timed out: turn/start");
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "Ship it", chatId: 42 }));

  assert.deepEqual(messages, [{ chatId: "42", text: "Remodex could not complete /continue: Codex request timed out: turn/start" }]);
});

test("telegram adapter reports not-initialized commands as bridge still warming", async () => {
  const messages = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => ({ linkedChats: [{ chatId: "42" }], pendingLinkCode: null }),
    },
    controlSurface: {
      listThreads: async () => {
        throw new Error("Not initialized");
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "/threads", chatId: 42 }));

  assert.deepEqual(messages, [{ chatId: "42", text: "Remodex is still warming up. Try /threads again in a moment." }]);
});

test("telegram adapter keeps Telegram conversational but blocks Codex controls when Pro is required", async () => {
  const messages = [];
  const callbacks = [];
  const continueCalls = [];
  const links = [];
  const actions = createFakeActionRegistry();
  const unlinked = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    actionRegistry: actions.registry,
    telegramAccess: {
      allowed: false,
      status: "requires_pro",
      message: "Remodex Telegram requires an active Remodex Pro entitlement.",
      upgradeOptions: [
        { id: "app_subscription", label: "Use the existing Remodex app subscription entitlement." },
        { id: "web_billing", label: "Unlock Remodex Pro through web billing." },
        { id: "telegram_payments", label: "Unlock Remodex Pro through Telegram Payments." },
      ],
    },
    sessionState: {
      read: () => ({
        linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }],
        pendingLinkCode: null,
      }),
      link: ({ chatId, code }) => {
        links.push({ chatId, code });
      },
      unlink: ({ chatId }) => {
        unlinked.push(chatId);
      },
    },
    controlSurface: {
      readStatus: async () => ({ bridgeStatus: { connectionStatus: "connected", codexLaunchState: "ready" } }),
      continueThread: async () => {
        continueCalls.push("continue");
        return { success: true };
      },
    },
  });

  await adapter.handleUpdate(messageUpdate({ text: "please continue", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/status", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/upgrade", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/help git", chatId: 42 }));
  await adapter.handleUpdate(messageUpdate({ text: "/link ABC123", chatId: 99 }));
  await adapter.handleUpdate(callbackUpdate({
    callbackData: callbackDataForButton(messages[0], "Help"),
    chatId: 42,
    callbackQueryId: "cb-restricted-help",
  }));
  await adapter.handleUpdate(messageUpdate({ text: "/unlink", chatId: 42 }));

  assert.deepEqual(continueCalls, []);
  assert.deepEqual(links, [{ chatId: "99", code: "ABC123" }]);
  assert.deepEqual(unlinked, ["42"]);
  assert.match(messages[0].text, /active Remodex Pro entitlement/);
  assert.doesNotMatch(messages[0].text, /Telegram Payments|Unlock routes/);
  assert.equal(callbackDataForButton(messages[0], "Help").startsWith("a:"), true);
  assert.equal(callbackDataForButton(messages[0], "Account").startsWith("a:"), true);
  assert.match(messages[1].text, /Bridge: connected/);
  assert.match(messages[1].text, /Access: requires_pro/);
  assert.match(messages[2].text, /no in-chat checkout/i);
  assert.equal(callbackDataForButton(messages[2], "Upgrade").startsWith("a:"), true);
  assert.match(messages[3].text, /^Git commands:\n/);
  assert.match(messages[3].text, /active Remodex Pro entitlement/);
  assert.doesNotMatch(messages[3].text, /Remodex could not complete/);
  assert.equal(messages[4].text, "Linked this Telegram chat to Remodex.");
  assert.match(messages[5].text, /^Remodex Telegram\n/);
  assert.match(messages[5].text, /Type a message to chat with Codex\./);
  assert.match(messages[5].text, /active Remodex Pro entitlement/);
  assert.equal(messages[6].text, "Unlinked this Telegram chat from Remodex.");
  assert.deepEqual(callbacks, [
    { callbackQueryId: "cb-restricted-help", text: "Help sent." },
  ]);
});

test("telegram adapter blocks callback actions while Pro access is missing", async () => {
  const messages = [];
  const callbacks = [];
  const actions = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    telegramAccess: {
      allowed: false,
      status: "requires_pro",
      message: "Remodex Telegram requires an active Remodex Pro entitlement.",
      upgradeOptions: [],
    },
    sessionState: {
      read: () => ({
        linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }],
        pendingLinkCode: null,
      }),
    },
    actionRegistry: {
      createAction({ type, payload = {} }) {
        return JSON.stringify({ type, payload });
      },
      consumeAction() {
        return { type: "command.new", payload: {} };
      },
    },
    controlSurface: {
      createThread: async () => {
        actions.push("createThread");
        return { threadId: "thread-new" };
      },
    },
  });

  await adapter.handleUpdate(callbackUpdate({ callbackData: "opaque", chatId: 42, callbackQueryId: "cb-pro" }));

  assert.deepEqual(actions, []);
  assert.match(messages[0].text, /active Remodex Pro entitlement/);
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-pro", text: "Requires Remodex Pro." }]);
});

test("telegram adapter allows entitlement callbacks while Pro access is missing", async () => {
  const messages = [];
  const callbacks = [];
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages, callbacks),
    telegramAccess: {
      allowed: false,
      status: "requires_pro",
      message: "Remodex Telegram requires an active Remodex Pro entitlement.",
      upgradeOptions: [{ id: "web_billing", label: "Unlock Remodex Pro through web billing." }],
    },
    sessionState: {
      read: () => ({
        linkedChats: [{ chatId: "42", activeThreadId: "thread-1" }],
        pendingLinkCode: null,
      }),
    },
    actionRegistry: {
      createAction({ type, payload = {} }) {
        return JSON.stringify({ type, payload });
      },
      consumeAction() {
        return { type: "command.upgrade", payload: {} };
      },
    },
  });

  await adapter.handleUpdate(callbackUpdate({ callbackData: "opaque", chatId: 42, callbackQueryId: "cb-upgrade" }));

  assert.match(messages[0].text, /no in-chat checkout/i);
  assert.match(messages[0].text, /Remodex Mac app/i);
  assert.doesNotMatch(messages[0].text, /web billing|Telegram Payments/);
  assert.deepEqual(callbacks, [{ callbackQueryId: "cb-upgrade", text: "Entitlement shown." }]);
});

test("telegram adapter honors Bot API retry_after when scheduling polling", async () => {
  const delays = [];
  const warnings = [];
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback, delay) => {
    delays.push(delay);
    return { unref() {} };
  };

  try {
    const rateLimitError = new Error("Too Many Requests");
    rateLimitError.retryAfterSeconds = 3;
    const adapter = createTelegramAdapter({
      botClient: {
        getUpdates: async () => {
          throw rateLimitError;
        },
        setMyCommands: async () => {},
      },
      pollIntervalMs: 500,
      logger: {
        warn(message) {
          warnings.push(message);
        },
      },
    });

    await adapter.start();
    adapter.stop();

    assert.deepEqual(delays, [3_000]);
    assert.deepEqual(warnings, ["[remodex] Telegram polling failed: Too Many Requests"]);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("telegram adapter keeps processing a polling batch after one update handler fails", async () => {
  const messages = [];
  const warnings = [];
  const adapter = createTelegramAdapter({
    botClient: {
      getUpdates: async () => [
        { update_id: 10, message: { text: "/status", chat: { id: 41 } } },
        { update_id: 11, message: { text: "/status", chat: { id: 42 } } },
      ],
      sendMessage: async ({ chatId, text, replyMarkup }) => {
        if (String(chatId) === "41") {
          throw new Error("simulated send failure");
        }
        const message = { chatId: String(chatId), text };
        if (replyMarkup) {
          message.replyMarkup = replyMarkup;
        }
        messages.push(message);
      },
      setMyCommands: async () => {},
    },
    sessionState: {
      read: () => ({
        linkedChats: [{ chatId: "41" }, { chatId: "42" }],
        pendingLinkCode: null,
      }),
    },
    controlSurface: {
      readStatus: async () => ({ bridgeStatus: { connectionStatus: "connected", codexLaunchState: "ready" } }),
    },
    pollIntervalMs: 60_000,
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
  });

  await adapter.start();
  adapter.stop();

  assert.equal(messages.length, 1);
  assert.equal(messages[0].chatId, "42");
  assert.match(messages[0].text, /Bridge: connected/);
  assert.deepEqual(warnings, [
    "[remodex] Telegram update handling failed: simulated send failure",
  ]);
});

test("telegram adapter polling flow links chat and routes plain text to Codex first", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-telegram-polling-"));
  const stateOptions = { env: { REMODEX_DEVICE_STATE_DIR: rootDir } };
  const now = () => 1_000;
  const commandMenus = [];
  const messages = [];
  const getUpdatesCalls = [];
  const created = [];
  const continued = [];
  const originalSetTimeout = global.setTimeout;
  let updatesConsumed = false;

  createTelegramLinkCode({
    ...stateOptions,
    now,
    randomBytesImpl: () => Buffer.alloc(6),
  });

  global.setTimeout = () => ({ unref() {} });

  try {
    const adapter = createTelegramAdapter({
      botClient: {
        getUpdates: async (params) => {
          getUpdatesCalls.push(params);
          if (updatesConsumed) {
            return [];
          }
          updatesConsumed = true;
          return [
            messageUpdate({ text: "/link AAAAAA", chatId: 42, chatTitle: "Kartik" }),
            messageUpdate({ text: "Make chat with Codex work first", chatId: 42, chatTitle: "Kartik" }),
            messageUpdate({ text: "Keep Telegram simple", chatId: 42, chatTitle: "Kartik" }),
          ];
        },
        sendMessage: async ({ chatId, text, replyMarkup }) => {
          const message = { chatId: String(chatId), text };
          if (replyMarkup) {
            message.replyMarkup = replyMarkup;
          }
          messages.push(message);
        },
        setMyCommands: async ({ commands }) => commandMenus.push(commands),
      },
      sessionState: {
        read: () => readTelegramSessionState(stateOptions),
        link: (params) => linkTelegramChat({ ...params, ...stateOptions }),
        unlink: (params) => unlinkTelegramChat({ ...params, ...stateOptions }),
        setActiveThread: (params) => setTelegramActiveThread({ ...params, ...stateOptions }),
      },
      controlSurface: {
        createThread: async ({ sourceThreadId, sourceCwd, runtimePreferences }) => {
          created.push({ sourceThreadId, sourceCwd, runtimePreferences });
          return {
            threadId: "thread-telegram-1",
            thread: { id: "thread-telegram-1", title: "Telegram chat", cwd: "/tmp/remodex-telegram" },
          };
        },
        continueThread: async ({ threadId, text, runtimePreferences, collaborationMode }) => {
          continued.push({ threadId, text, runtimePreferences, collaborationMode });
          return { success: true };
        },
      },
      pollIntervalMs: 60_000,
      now,
    });

    await adapter.start();
    adapter.stop();

    const state = readTelegramSessionState(stateOptions);
    assert.deepEqual(getUpdatesCalls, [{ offset: 0, timeout: 20, limit: 100 }]);
    assert.deepEqual(commandMenus, [TELEGRAM_COMMAND_MENU]);
    assert.equal(state.pendingLinkCode, null);
    assert.equal(state.linkedChats.length, 1);
    assert.equal(state.linkedChats[0].chatId, "42");
    assert.equal(state.linkedChats[0].activeThreadId, "thread-telegram-1");
    assert.equal(state.linkedChats[0].activeThreadCwd, "/tmp/remodex-telegram");
    assert.deepEqual(created, [{
      sourceThreadId: "",
      sourceCwd: "",
      runtimePreferences: { model: "gpt-5.5", reasoningEffort: "medium" },
    }]);
    assert.deepEqual(continued, [
      {
        threadId: "thread-telegram-1",
        text: "Make chat with Codex work first",
        runtimePreferences: { model: "gpt-5.5", reasoningEffort: "medium" },
        collaborationMode: "",
      },
      {
        threadId: "thread-telegram-1",
        text: "Keep Telegram simple",
        runtimePreferences: { model: "gpt-5.5", reasoningEffort: "medium" },
        collaborationMode: "",
      },
    ]);
    assert.equal(messages[0].text, "Linked this Telegram chat to Remodex.");
    assert.equal(messages[1].text, "Created new active thread: Telegram chat\nSent to the active Remodex thread.");
    assert.equal(messages[2].text, "Sent to the active Remodex thread.");
    assert.deepEqual(
      callbackButtonsForMessage(messages[2]).map((button) => button.text),
      ["Stop", "Status", "Activity", "Pending", "Menu", "Open Mac"]
    );
  } finally {
    global.setTimeout = originalSetTimeout;
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("telegram adapter factory starts only when bridge config enables it", async () => {
  assert.equal(createTelegramAdapterFromBridgeConfig({ config: { telegramEnabled: false } }), null);

  const starts = [];
  const adapter = createTelegramAdapterFromBridgeConfig({
    config: {
      telegramEnabled: true,
      telegramBotToken: "123456:secret-token",
      telegramBotUsername: "RemodexBot",
      telegramPollIntervalMs: 500,
    },
    createBotClient() {
      return fakeBot([]);
    },
    createAdapter({ botUsername, pollIntervalMs }) {
      assert.equal(botUsername, "RemodexBot");
      return {
        start() {
          starts.push(pollIntervalMs);
        },
      };
    },
  });

  adapter.start();
  assert.deepEqual(starts, [500]);
  assert.throws(
    () => createTelegramAdapterFromBridgeConfig({ config: { telegramEnabled: true, telegramBotToken: "" } }),
    /REMODEX_TELEGRAM_BOT_TOKEN/
  );
  const warnings = [];
  const restrictedStarts = [];
  const restrictedAdapter = createTelegramAdapterFromBridgeConfig({
    config: {
      telegramEnabled: true,
      telegramBotToken: "123456:secret-token",
      telegramPollIntervalMs: 750,
      telegramProEntitlementRequired: true,
      telegramProEntitled: false,
    },
    createBotClient() {
      return fakeBot([]);
    },
    createAdapter({ telegramAccess, pollIntervalMs }) {
      assert.equal(telegramAccess.allowed, false);
      assert.equal(telegramAccess.status, "requires_pro");
      return {
        start() {
          restrictedStarts.push(pollIntervalMs);
        },
      };
    },
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
  });
  restrictedAdapter.start();
  assert.deepEqual(restrictedStarts, [750]);
  assert.deepEqual(warnings, [
    "[remodex] Telegram restricted: Remodex Telegram requires an active Remodex Pro entitlement.",
  ]);
});

function fakeBot(messages, callbacks = [], commandMenus = []) {
  return {
    getUpdates: async () => [],
    sendMessage: async ({ chatId, text, replyMarkup }) => {
      const message = { chatId: String(chatId), text };
      if (replyMarkup) {
        message.replyMarkup = replyMarkup;
      }
      messages.push(message);
    },
    answerCallbackQuery: async ({ callbackQueryId, text }) => callbacks.push({ callbackQueryId, text }),
    setMyCommands: async ({ commands }) => commandMenus.push(commands),
  };
}

function createFakeActionRegistry() {
  const actions = new Map();
  let nextId = 0;
  return {
    registry: {
      createAction({ chatId, type, payload = {} }) {
        nextId += 1;
        const callbackData = `a:TEST${nextId}`;
        actions.set(callbackData, { chatId: String(chatId), type, payload });
        return callbackData;
      },
      consumeAction(callbackData, { chatId }) {
        const action = actions.get(callbackData);
        assert.equal(action.chatId, String(chatId));
        return { type: action.type, payload: action.payload };
      },
    },
    actions,
  };
}

function callbackDataForButton(message, text) {
  for (const row of message.replyMarkup?.inline_keyboard || []) {
    for (const button of row) {
      if (button.text === text) {
        return button.callback_data;
      }
    }
  }

  throw new Error(`button not found: ${text}`);
}

function actionForButton(actions, message, text) {
  const callbackData = callbackDataForButton(message, text);
  const action = actions.actions.get(callbackData);
  assert.ok(action, `action not found for button: ${text}`);
  return action;
}

function assertNoActiveThreadRecovery(message, { allowNewThreadHint = false } = {}) {
  assert.equal(message.chatId, "42");
  assert.equal(
    message.text,
    allowNewThreadHint
      ? "No active Remodex thread selected. Run /threads first or /new to create one."
      : "No active Remodex thread selected. Run /threads first."
  );
  assert.equal(callbackDataForButton(message, "Threads").startsWith("a:"), true);
  assert.equal(callbackDataForButton(message, "Help").startsWith("a:"), true);
  assert.equal(callbackDataForButton(message, "New").startsWith("a:"), true);
  assert.equal(callbackDataForButton(message, "Status").startsWith("a:"), true);
}

function callbackButtonsForMessage(message) {
  return (message.replyMarkup?.inline_keyboard || [])
    .flat()
    .filter((button) => button?.callback_data)
    .map((button) => ({ text: button.text, callbackData: button.callback_data }));
}

function createCommandPickerHarness() {
  const messages = [];
  const state = {
    linkedChats: [{ chatId: "42", chatTitle: "Kartik", activeThreadId: "thread-1", activeThreadCwd: "/tmp/current" }],
    pendingLinkCode: null,
  };
  let nextThread = 1;
  const adapter = createTelegramAdapter({
    botClient: fakeBot(messages),
    sessionState: {
      read: () => state,
      link: () => {
        throw new Error("invalid code");
      },
      unlink: ({ chatId }) => {
        state.linkedChats = state.linkedChats.filter((chat) => chat.chatId !== String(chatId));
        return state;
      },
      setActiveThread: ({ threadId, cwd }) => {
        state.linkedChats[0].activeThreadId = threadId;
        state.linkedChats[0].activeThreadCwd = cwd;
        return state;
      },
    },
    controlSurface: createButtonHarnessControlSurface({ state, nextThread: () => nextThread++ }),
  });
  return { adapter, messages, state };
}

function createButtonHarnessControlSurface({ state, nextThread }) {
  return {
    readStatus: async () => ({ bridgeStatus: { connectionStatus: "connected", codexLaunchState: "ready" } }),
    listThreads: async () => ([{
      id: state.linkedChats[0].activeThreadId || "thread-1",
      title: "One",
      cwd: state.linkedChats[0].activeThreadCwd || "/tmp/current",
    }]),
    listArchivedThreads: async () => ([{ id: "thread-archived", title: "Archived", cwd: "/tmp/archived" }]),
    archiveThread: async ({ threadId }) => ({ threadId, title: "One" }),
    unarchiveThread: async ({ threadId }) => ({ threadId, title: "Archived" }),
    listProjects: async () => ({ projects: [{ name: "remodex", path: "/Users/user/Documents/Projects/remodex" }] }),
    listProjectDirectory: async () => ({
      isRoot: true,
      entries: [{ label: "Documents", path: "/Users/user/Documents" }],
    }),
    createThread: async ({ cwd }) => {
      const id = `thread-new-${nextThread()}`;
      return { threadId: id, thread: { id, title: "New", cwd: cwd || "/tmp/current" } };
    },
    forkThread: async ({ threadId, cwd }) => ({
      threadId: `${threadId || "thread"}-fork`,
      thread: {
        id: `${threadId || "thread"}-fork`,
        title: "Fork",
        cwd: cwd || "/tmp/current",
      },
    }),
    generateThreadTitle: async () => ({ threadId: state.linkedChats[0].activeThreadId, title: "Generated Thread" }),
    readAccountStatus: async () => ({ status: "authenticated", authMethod: "chatgpt", tokenReady: true }),
    readRateLimits: async () => ({
      rateLimitsByLimitId: {
        codex_5h: { primary: { usedPercent: 20, windowDurationMins: 300 } },
      },
    }),
    readUsageStatus: async () => ({
      total: { inputTokens: 1200, outputTokens: 340, totalTokens: 1540 },
      thread: { id: state.linkedChats[0].activeThreadId, inputTokens: 800, outputTokens: 200, totalTokens: 1000 },
    }),
    readVersionStatus: async () => ({ bridgeVersion: "1.5.2", bridgeLatestVersion: "1.5.2" }),
    openLoginOnMac: async () => ({ success: true, openedOnMac: true }),
    cancelLoginOnMac: async () => ({ success: false, reason: "no_pending_login" }),
    openFeedbackOnMac: async () => ({ success: true, openedOnMac: true }),
    readPreferences: async () => ({ preferences: { keepMacAwake: true }, applied: true }),
    updatePreferences: async (preferences) => ({ preferences, applied: Boolean(preferences.keepMacAwake) }),
    readPets: async () => ({ pets: [{ displayName: "Icarus", kind: "pet" }], errors: [] }),
    listSkills: async () => ({ skills: [{ name: "frontend-refactor", enabled: true }] }),
    listPlugins: async () => ({
      marketplaces: [{
        name: "openai-curated",
        plugins: [{ name: "github", installed: true, interface: { displayName: "GitHub" } }],
      }],
    }),
    continueThread: async () => ({ success: true }),
    stopThread: async () => ({ success: true }),
    readContextWindow: async () => ({ usage: { tokensUsed: 120, tokenLimit: 1_000 } }),
    readThreadActivity: async () => ({ entries: [{ role: "assistant", text: "Recent activity." }] }),
    compactThread: async ({ threadId }) => ({ threadId, turnId: "turn-compact" }),
    captureWorkspaceCheckpoint: async () => ({
      checkpoint: { commit: "abc1234" },
      status: { branch: "main", files: [] },
    }),
    openThreadOnMac: async () => ({ success: true, relaunched: false }),
    wakeMac: async () => ({ success: true, durationSeconds: 30 }),
    readGitStatus: async () => ({ branch: "main", files: [] }),
    initGit: async () => ({ status: { branch: "main", files: [] } }),
    readGitDiffSummary: async () => ({ changedFiles: 0 }),
    readGitLog: async () => ({ commits: [{ hash: "abc1234", message: "Add Telegram support" }] }),
    readGitRemote: async () => ({ ownerRepo: "acme/remodex" }),
    readGitBranches: async () => ({ current: "main", branches: ["main", "feature/telegram"] }),
    generateCommitDraft: async () => ({
      subject: "Add Telegram support",
      body: "- Wire commands",
      fullMessage: "Add Telegram support\n\n- Wire commands",
    }),
    generatePullRequestDraft: async () => ({
      title: "Add Telegram support",
      body: "## Summary\n- Wire commands\n\n## Testing\n- Node test\n\n## Notes\n- Harness",
    }),
    checkoutBranch: async ({ branch }) => ({ success: true, branch }),
    pullGit: async () => ({ success: true, status: { branch: "main", files: [] } }),
    stashGit: async () => ({ success: true, message: "Saved working directory" }),
    popGitStash: async () => ({ success: true, message: "Dropped refs/stash@{0}" }),
    runGitAction: async ({ action }) => (
      action === "create_pr"
        ? { action, pr: { url: "https://github.com/acme/remodex/pull/7" } }
        : { action, status: { branch: "main" }, push: { state: "pushed" } }
    ),
    startReview: async () => ({ turnId: "turn-review", target: { type: "uncommittedChanges", branch: "" } }),
  };
}

function messageUpdate({ text, caption, chatId, chatTitle = "", photo, document, voice, audio }) {
  return {
    update_id: 1,
    message: {
      text,
      caption,
      photo,
      document,
      voice,
      audio,
      chat: { id: chatId, title: chatTitle },
    },
  };
}

function callbackUpdate({ callbackData, chatId, callbackQueryId }) {
  return {
    update_id: 2,
    callback_query: {
      id: callbackQueryId,
      data: callbackData,
      message: { chat: { id: chatId } },
    },
  };
}
