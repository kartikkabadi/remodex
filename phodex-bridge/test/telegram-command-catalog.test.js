// FILE: telegram-command-catalog.test.js
// Purpose: Verifies Telegram command catalog invariants shared by menu, parser, and help.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/telegram-command-catalog

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TELEGRAM_ACTIVE_THREAD_COMMANDS,
  TELEGRAM_CALLBACK_COMMANDS,
  TELEGRAM_COMMAND_HELP_GROUPS,
  TELEGRAM_COMMAND_HELP_TOPICS,
  TELEGRAM_COMMAND_MENU,
  TELEGRAM_CONTROL_COMMANDS,
  TELEGRAM_PRIMARY_COMMAND_HELP_GROUPS,
  TELEGRAM_RESTRICTED_ACCESS_CALLBACK_COMMANDS,
  TELEGRAM_RESTRICTED_ACCESS_COMMANDS,
  normalizeTelegramActionType,
  parseTelegramCommand,
  renderTelegramCommandHelp,
} = require("../src/telegram-command-catalog");

test("telegram command catalog is valid for Bot API command menus", () => {
  const commandNames = TELEGRAM_CONTROL_COMMANDS.map(({ command }) => command);

  assert.equal(new Set(commandNames).size, commandNames.length);
  const commandMenuNames = TELEGRAM_COMMAND_MENU.map(({ command }) => command);
  const primaryHelpNames = TELEGRAM_PRIMARY_COMMAND_HELP_GROUPS.flatMap(({ commands }) => commands);
  const primaryCommandNames = TELEGRAM_CONTROL_COMMANDS
    .filter((command) => command.primary)
    .map((command) => command.command);
  assert.deepEqual(new Set(commandMenuNames), new Set(primaryHelpNames));
  assert.deepEqual(commandMenuNames, primaryCommandNames);
  assert.equal(TELEGRAM_COMMAND_MENU.length < TELEGRAM_CONTROL_COMMANDS.length, true);

  for (const command of TELEGRAM_CONTROL_COMMANDS) {
    assert.match(command.command, /^[a-z0-9_]{1,32}$/);
    assert.equal(typeof command.description, "string");
    assert.ok(command.description.length > 0 && command.description.length <= 256);
    if (command.usage) {
      assert.equal(command.usage.startsWith(`/${command.command}`), true);
    }
    assert.equal(typeof command.requiresActiveThread, command.requiresActiveThread == null ? "undefined" : "boolean");
    assert.equal(typeof command.allowedWhenProMissing, command.allowedWhenProMissing == null ? "undefined" : "boolean");
    assert.equal(typeof command.callbackAction, command.callbackAction == null ? "undefined" : "boolean");
    assert.equal(typeof command.primary, command.primary == null ? "undefined" : "boolean");
    if (command.activeThreadSample) {
      assert.equal(command.requiresActiveThread, true);
      assert.equal(command.activeThreadSample.startsWith(`/${command.command}`), true);
    }
  }
});

test("telegram command help groups cover every command exactly once", () => {
  const commandNames = TELEGRAM_CONTROL_COMMANDS.map(({ command }) => command);
  const groupedNames = TELEGRAM_COMMAND_HELP_GROUPS.flatMap(({ commands }) => commands);

  assert.deepEqual(new Set(groupedNames), new Set(commandNames));
  assert.equal(groupedNames.length, commandNames.length);
  for (const group of TELEGRAM_COMMAND_HELP_GROUPS) {
    assert.equal(typeof group.title, "string");
    assert.ok(group.title.length > 0);
    assert.match(group.slug, /^[a-z0-9_]+$/);
    assert.ok(Array.isArray(group.aliases));
    assert.equal(group.aliases.every((alias) => /^[a-z0-9_]+$/.test(alias)), true);
    assert.ok(Array.isArray(group.commands));
    assert.ok(group.commands.length > 0);
  }

  const groupKeys = TELEGRAM_COMMAND_HELP_GROUPS.flatMap((group) => [
    group.slug,
    ...group.aliases,
  ]);
  assert.equal(new Set(groupKeys).size, groupKeys.length);
});

test("telegram command help workflow topics point at real commands", () => {
  const commandNames = new Set(TELEGRAM_CONTROL_COMMANDS.map(({ command }) => command));
  const topicKeys = TELEGRAM_COMMAND_HELP_TOPICS.flatMap((topic) => [
    topic.slug,
    ...topic.aliases,
  ]);

  assert.equal(new Set(topicKeys).size, topicKeys.length);
  for (const topic of TELEGRAM_COMMAND_HELP_TOPICS) {
    assert.equal(typeof topic.title, "string");
    assert.match(topic.slug, /^[a-z0-9_]+$/);
    assert.ok(Array.isArray(topic.aliases));
    assert.equal(topic.aliases.every((alias) => /^[a-z0-9_]+$/.test(alias)), true);
    assert.ok(topic.commands.length > 1);
    for (const command of topic.commands) {
      assert.equal(commandNames.has(command), true);
    }
  }
});

test("telegram active-thread command list is derived from catalog metadata", () => {
  assert.deepEqual(
    TELEGRAM_ACTIVE_THREAD_COMMANDS,
    TELEGRAM_CONTROL_COMMANDS
      .filter((command) => command.requiresActiveThread)
      .map((command) => ({
        command: command.command,
        sample: command.activeThreadSample || `/${command.command}`,
      })),
  );
  assert.deepEqual(
    TELEGRAM_ACTIVE_THREAD_COMMANDS.map(({ command }) => command),
    [
      "archive",
      "rename",
      "title",
      "fork",
      "activity",
      "checkpoint",
      "compact",
      "context",
      "open",
      "skills",
      "plugins",
      "git",
      "init",
      "diff",
      "log",
      "remote",
      "branches",
      "branch",
      "worktree",
      "checkout",
      "pull",
      "reset_remote",
      "stash",
      "stash_pop",
      "commit",
      "draft_commit",
      "push",
      "draft_pr",
      "pr",
      "ship",
      "review",
      "subagents",
      "stop",
      "pending",
      "answer",
    ],
  );
});

test("telegram restricted access command list is derived from catalog metadata", () => {
  assert.deepEqual(
    TELEGRAM_RESTRICTED_ACCESS_COMMANDS,
    TELEGRAM_CONTROL_COMMANDS
      .filter((command) => command.allowedWhenProMissing)
      .map((command) => command.command),
  );
  assert.deepEqual(
    TELEGRAM_RESTRICTED_ACCESS_COMMANDS,
    ["start", "status", "account", "limits", "usage", "version", "upgrade", "feedback", "login", "cancel_login", "logout", "link", "unlink", "help"],
  );
});

test("telegram callback command list is derived from catalog metadata", () => {
  assert.deepEqual(
    TELEGRAM_CALLBACK_COMMANDS,
    TELEGRAM_CONTROL_COMMANDS
      .filter((command) => command.callbackAction)
      .map((command) => command.command),
  );
  assert.deepEqual(
    TELEGRAM_RESTRICTED_ACCESS_CALLBACK_COMMANDS,
    TELEGRAM_CONTROL_COMMANDS
      .filter((command) => command.allowedWhenProMissing && command.callbackAction)
      .map((command) => command.command),
  );
  assert.equal(TELEGRAM_CALLBACK_COMMANDS.includes("status"), true);
  assert.equal(TELEGRAM_CALLBACK_COMMANDS.includes("reset_remote"), true);
  assert.equal(TELEGRAM_CALLBACK_COMMANDS.includes("rename"), false);
  assert.equal(TELEGRAM_CALLBACK_COMMANDS.includes("commit"), false);
  assert.equal(TELEGRAM_CALLBACK_COMMANDS.includes("keep_awake"), false);
  assert.equal(TELEGRAM_RESTRICTED_ACCESS_CALLBACK_COMMANDS.includes("link"), false);
  assert.equal(TELEGRAM_RESTRICTED_ACCESS_CALLBACK_COMMANDS.includes("unlink"), true);
});

test("telegram command help renders primary chat-first usage", () => {
  const help = renderTelegramCommandHelp();

  assert.match(help, /^Remodex Telegram\nType a message to chat with Codex\./);
  assert.match(help, /\nChat: /);
  assert.match(help, /\nThreads: /);
  assert.match(help, /\nSetup: /);
  assert.match(help, /Use \/help <section\|command> for focused help\./);
  assert.match(help, /Use \/help all for the full command catalog\./);
  assert.match(help, /Use \/menu for buttons\.$/);
  assert.ok(help.length < 4096);
  for (const commandName of TELEGRAM_PRIMARY_COMMAND_HELP_GROUPS.flatMap(({ commands }) => commands)) {
    const command = TELEGRAM_CONTROL_COMMANDS.find(({ command: name }) => name === commandName);
    assert.match(help, new RegExp(escapeRegExp(command.usage || `/${command.command}`)));
  }
  assert.doesNotMatch(help, /\/ship <message>/);
});

test("telegram command help can still render every catalog usage", () => {
  const help = renderTelegramCommandHelp("all");

  assert.match(help, /^All commands:\nSetup: /);
  assert.match(help, /\nGit: /);
  assert.match(help, /Use \/menu for primary buttons\.$/);
  assert.ok(help.length < 4096);
  for (const command of TELEGRAM_CONTROL_COMMANDS) {
    assert.match(help, new RegExp(escapeRegExp(command.usage || `/${command.command}`)));
  }
});

test("telegram command help renders focused section topics", () => {
  const help = renderTelegramCommandHelp("git");

  assert.match(help, /^Git commands:\n/);
  assert.match(help, /- \/branch <name>: Create and switch to a local branch Requires an active thread\./);
  assert.match(help, /- \/reset_remote: Review and confirm discarding local changes to match remote Requires an active thread\./);
  assert.match(help, /- \/review <changes\|base <branch>>: Start a native inline code review Requires an active thread\./);
  assert.doesNotMatch(help, /\/feedback/);
  assert.match(help, /Use \/help for all sections\.$/);
});

test("telegram command help renders focused command topics", () => {
  const help = renderTelegramCommandHelp("review");

  assert.match(help, /^\/review <changes\|base <branch>>: Start a native inline code review Requires an active thread\./);
  assert.match(help, /Use \/help for all sections\.$/);
  assert.doesNotMatch(help, /\/branch <name>/);
});

test("telegram command help renders workflow topics from the catalog", () => {
  const help = renderTelegramCommandHelp("commit_ship");

  assert.match(help, /^Commit and Ship commands:\n/);
  assert.match(help, /- \/draft_commit: Draft a commit message/);
  assert.match(help, /- \/commit <message>: Commit active-thread changes/);
  assert.match(help, /- \/ship <message>: Commit, push, and create a pull request/);
  assert.doesNotMatch(help, /\/stash_pop/);
});

test("telegram command help renders safe fallback for unknown topics", () => {
  const help = renderTelegramCommandHelp("unknown topic with a lot of extra text that should not produce a giant Telegram response");

  assert.match(help, /^Help topic not found: unknown topic with a lot of extra text/);
  assert.match(help, /Use \/help for all sections\.$/);
  assert.ok(help.length < 180);
});

test("telegram command parser recognizes supported slash commands only", () => {
  assert.deepEqual(parseTelegramCommand("/start"), { name: "start", arg: "" });
  assert.deepEqual(parseTelegramCommand("/help git"), { name: "help", arg: "git" });
  assert.deepEqual(parseTelegramCommand("/limits"), { name: "limits", arg: "" });
  assert.deepEqual(parseTelegramCommand("/usage"), { name: "usage", arg: "" });
  assert.deepEqual(parseTelegramCommand("/threads telegram"), { name: "threads", arg: "telegram" });
  assert.deepEqual(parseTelegramCommand("/archived cleanup"), { name: "archived", arg: "cleanup" });
  assert.deepEqual(parseTelegramCommand("/review base main"), { name: "review", arg: "base main" });
  assert.deepEqual(parseTelegramCommand("/reset_remote"), { name: "reset_remote", arg: "" });
  assert.deepEqual(parseTelegramCommand("/activity 8"), { name: "activity", arg: "8" });
  assert.deepEqual(parseTelegramCommand("/compact"), { name: "compact", arg: "" });
  assert.deepEqual(parseTelegramCommand("/feedback The app feels great"), { name: "feedback", arg: "The app feels great" });
  assert.deepEqual(parseTelegramCommand("/upgrade"), { name: "upgrade", arg: "" });
  assert.deepEqual(parseTelegramCommand("/resume"), { name: "resume", arg: "" });
  assert.deepEqual(parseTelegramCommand("/pets"), { name: "pets", arg: "" });
  assert.deepEqual(parseTelegramCommand("/cancel_login"), { name: "cancel_login", arg: "" });
  assert.deepEqual(parseTelegramCommand("/logout"), { name: "logout", arg: "" });
  assert.deepEqual(parseTelegramCommand("/skills refactor"), { name: "skills", arg: "refactor" });
  assert.deepEqual(parseTelegramCommand("/plugins github"), { name: "plugins", arg: "github" });
  assert.deepEqual(parseTelegramCommand("/subagents audit the bridge"), { name: "subagents", arg: "audit the bridge" });
  assert.deepEqual(parseTelegramCommand("/pending"), { name: "pending", arg: "" });
  assert.deepEqual(parseTelegramCommand("/unarchive 2"), { name: "unarchive", arg: "2" });
  assert.deepEqual(parseTelegramCommand("/status@RemodexBot"), { name: "status", arg: "" });
  assert.deepEqual(parseTelegramCommand("/HELP"), { name: "help", arg: "" });
  assert.deepEqual(parseTelegramCommand("/not_real anything"), { name: "unknown", arg: "" });
  assert.deepEqual(parseTelegramCommand("continue without slash"), { name: "unknown", arg: "" });
});

test("telegram command action types must point at callback-supported catalog commands", () => {
  assert.equal(normalizeTelegramActionType("command.status"), "command.status");
  assert.equal(normalizeTelegramActionType("command.STATUS"), "command.status");
  assert.equal(normalizeTelegramActionType("runtime.model"), "runtime.model");
  assert.equal(normalizeTelegramActionType("checkpoint.restore_preview"), "checkpoint.restore_preview");
  assert.throws(
    () => normalizeTelegramActionType("command.rename"),
    /Unsupported Telegram callback command action: command\.rename/
  );
  assert.throws(
    () => normalizeTelegramActionType("command.commit"),
    /Unsupported Telegram callback command action: command\.commit/
  );
  assert.throws(
    () => normalizeTelegramActionType("command.open_mac"),
    /Unsupported Telegram callback command action: command\.open_mac/
  );
  assert.throws(
    () => normalizeTelegramActionType("command.not_real"),
    /Unsupported Telegram callback command action: command\.not_real/
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
