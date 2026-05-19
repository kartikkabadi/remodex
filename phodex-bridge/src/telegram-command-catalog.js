// FILE: telegram-command-catalog.js
// Purpose: Owns the Telegram Control Command picker, parser, and help text.
// Layer: CLI helper
// Exports: Telegram command catalog helpers.

const TELEGRAM_CONTROL_COMMANDS = [
  {
    command: "start",
    description: "Open Remodex Telegram help and pairing guidance",
    allowedWhenProMissing: true,
    primary: true,
  },
  {
    command: "status",
    description: "Show bridge, Codex, and active thread status",
    allowedWhenProMissing: true,
    callbackAction: true,
    primary: true,
  },
  { command: "menu", description: "Open Telegram action buttons", callbackAction: true, primary: true },
  {
    command: "account",
    description: "Show sanitized ChatGPT account and bridge status",
    allowedWhenProMissing: true,
    callbackAction: true,
  },
  {
    command: "limits",
    description: "Show current ChatGPT rate limits",
    allowedWhenProMissing: true,
    callbackAction: true,
  },
  {
    command: "usage",
    description: "Show context usage and ChatGPT rate limits",
    allowedWhenProMissing: true,
    callbackAction: true,
  },
  {
    command: "version",
    description: "Show bridge version and update status",
    allowedWhenProMissing: true,
    callbackAction: true,
  },
  {
    command: "upgrade",
    description: "Show Remodex Pro entitlement and unlock routes",
    allowedWhenProMissing: true,
    callbackAction: true,
  },
  {
    command: "feedback",
    description: "Open a Remodex feedback email on the Mac",
    usage: "/feedback [message]",
    allowedWhenProMissing: true,
    callbackAction: true,
  },
  {
    command: "login",
    description: "Open a pending ChatGPT sign-in on the Mac",
    allowedWhenProMissing: true,
    callbackAction: true,
  },
  {
    command: "cancel_login",
    description: "Cancel a pending ChatGPT sign-in on the Mac",
    allowedWhenProMissing: true,
    callbackAction: true,
  },
  {
    command: "logout",
    description: "Sign out of ChatGPT on this Mac after confirmation",
    allowedWhenProMissing: true,
    callbackAction: true,
  },
  { command: "threads", description: "Choose a recent Remodex thread", usage: "/threads [search]", callbackAction: true, primary: true },
  { command: "resume", description: "Select the Mac's last active Remodex thread", callbackAction: true, primary: true },
  { command: "thread", description: "Select a thread by number or thread id", usage: "/thread <number|id>", primary: true },
  { command: "archived", description: "Show archived Remodex threads with restore buttons", usage: "/archived [search]", callbackAction: true },
  {
    command: "archive",
    description: "Archive the active Remodex thread",
    requiresActiveThread: true,
    callbackAction: true,
  },
  { command: "unarchive", description: "Restore an archived thread by number or id", usage: "/unarchive <number|id>" },
  {
    command: "rename",
    description: "Rename the active Remodex thread",
    usage: "/rename <title>",
    requiresActiveThread: true,
    activeThreadSample: "/rename Telegram work",
  },
  {
    command: "title",
    description: "Generate and set a title for the active thread",
    usage: "/title [message]",
    requiresActiveThread: true,
    activeThreadSample: "/title Telegram work",
    callbackAction: true,
  },
  { command: "projects", description: "Choose a local project folder for a new thread", usage: "/projects [search]", callbackAction: true },
  { command: "browse", description: "Browse local project folders with buttons", usage: "/browse [folder]", callbackAction: true },
  { command: "mkdir", description: "Create a local project folder in the browsed folder", usage: "/mkdir <folder name>" },
  { command: "new", description: "Create a new Remodex thread in the active or selected project", usage: "/new [folder]", callbackAction: true, primary: true },
  { command: "fork", description: "Fork the active Remodex thread", requiresActiveThread: true, callbackAction: true },
  {
    command: "activity",
    description: "Show recent active thread activity",
    usage: "/activity [count]",
    requiresActiveThread: true,
    activeThreadSample: "/activity 8",
    callbackAction: true,
    primary: true,
  },
  { command: "checkpoint", description: "Capture a local workspace checkpoint", requiresActiveThread: true, callbackAction: true },
  { command: "compact", description: "Summarize older context for the active thread", requiresActiveThread: true, callbackAction: true },
  { command: "context", description: "Show active thread context window usage", requiresActiveThread: true, callbackAction: true },
  { command: "open", description: "Open the active Remodex thread on this Mac", requiresActiveThread: true, callbackAction: true, primary: true },
  { command: "wake", description: "Wake the Mac display from Telegram", callbackAction: true },
  { command: "prefs", description: "Show bridge preferences", callbackAction: true },
  { command: "pets", description: "List local Codex pets without spritesheet data", callbackAction: true },
  {
    command: "skills",
    description: "List active-thread Codex skills",
    usage: "/skills [search]",
    requiresActiveThread: true,
    activeThreadSample: "/skills refactor",
    callbackAction: true,
  },
  {
    command: "plugins",
    description: "List active-thread Codex plugins",
    usage: "/plugins [search]",
    requiresActiveThread: true,
    activeThreadSample: "/plugins github",
    callbackAction: true,
  },
  { command: "model", description: "Choose the model and reasoning effort for Telegram turns", usage: "/model [model] [effort]", callbackAction: true },
  { command: "access", description: "Choose on-request or full-access mode for Telegram turns", usage: "/access <on-request|full-access>", callbackAction: true },
  { command: "keep_awake", description: "Turn the Mac keep-awake preference on or off", usage: "/keep_awake <on|off>" },
  { command: "git", description: "Summarize git state for the active thread", requiresActiveThread: true, callbackAction: true },
  { command: "init", description: "Initialize Git in the active thread project", requiresActiveThread: true, callbackAction: true },
  { command: "diff", description: "Summarize changed files for the active thread", requiresActiveThread: true, callbackAction: true },
  { command: "log", description: "Show recent commits for the active thread", requiresActiveThread: true, callbackAction: true },
  { command: "remote", description: "Show the active thread repository remote", requiresActiveThread: true, callbackAction: true },
  { command: "branches", description: "List local branches for the active thread", requiresActiveThread: true, callbackAction: true },
  {
    command: "branch",
    description: "Create and switch to a local branch",
    usage: "/branch <name>",
    requiresActiveThread: true,
    activeThreadSample: "/branch telegram-support",
  },
  {
    command: "worktree",
    description: "Create a managed worktree and new thread",
    usage: "/worktree <branch>",
    requiresActiveThread: true,
    activeThreadSample: "/worktree telegram-support",
  },
  {
    command: "checkout",
    description: "Switch the active thread project to a local branch",
    usage: "/checkout <branch>",
    requiresActiveThread: true,
    activeThreadSample: "/checkout main",
  },
  { command: "pull", description: "Pull with rebase for the active branch", requiresActiveThread: true, callbackAction: true },
  {
    command: "reset_remote",
    description: "Review and confirm discarding local changes to match remote",
    requiresActiveThread: true,
    callbackAction: true,
  },
  { command: "stash", description: "Stash active-thread local changes", requiresActiveThread: true, callbackAction: true },
  { command: "stash_pop", description: "Apply the latest stash to the active thread", requiresActiveThread: true, callbackAction: true },
  {
    command: "commit",
    description: "Commit active-thread changes with a message",
    usage: "/commit <message>",
    requiresActiveThread: true,
    activeThreadSample: "/commit Telegram support",
  },
  { command: "draft_commit", description: "Draft a commit message for active-thread changes", requiresActiveThread: true, callbackAction: true },
  { command: "push", description: "Push the active branch", requiresActiveThread: true, callbackAction: true },
  { command: "draft_pr", description: "Draft pull request text for the active branch", requiresActiveThread: true, callbackAction: true },
  { command: "pr", description: "Create or open a pull request", requiresActiveThread: true, callbackAction: true },
  {
    command: "ship",
    description: "Commit, push, and create a pull request",
    usage: "/ship <message>",
    requiresActiveThread: true,
    activeThreadSample: "/ship Telegram support",
  },
  {
    command: "review",
    description: "Start a native inline code review",
    usage: "/review <changes|base <branch>>",
    requiresActiveThread: true,
    activeThreadSample: "/review changes",
    callbackAction: true,
  },
  {
    command: "subagents",
    description: "Ask Codex to delegate distinct work in parallel",
    usage: "/subagents <task>",
    requiresActiveThread: true,
    activeThreadSample: "/subagents Audit the Telegram integration",
  },
  { command: "stop", description: "Stop the active Remodex turn", requiresActiveThread: true, callbackAction: true, primary: true },
  { command: "pending", description: "Reopen the current Codex prompt or approval", requiresActiveThread: true, callbackAction: true, primary: true },
  {
    command: "plan",
    description: "Send a plan-mode request to the active or new Remodex thread",
    usage: "/plan <message>",
    primary: true,
  },
  {
    command: "continue",
    description: "Send text to the active or new Remodex thread",
    usage: "/continue <message>",
    primary: true,
  },
  {
    command: "answer",
    description: "Answer a pending Codex input prompt",
    usage: "/answer <response>",
    requiresActiveThread: true,
    activeThreadSample: "/answer Continue with the smallest safe change",
    primary: true,
  },
  {
    command: "link",
    description: "Link this Telegram chat to your local bridge",
    usage: "/link <code>",
    allowedWhenProMissing: true,
    primary: true,
  },
  {
    command: "unlink",
    description: "Unlink this Telegram chat from the local bridge",
    allowedWhenProMissing: true,
    callbackAction: true,
    primary: true,
  },
  {
    command: "help",
    description: "Show available Remodex Telegram commands",
    allowedWhenProMissing: true,
    callbackAction: true,
    primary: true,
  },
];

const TELEGRAM_COMMAND_HELP_GROUPS = Object.freeze([
  {
    title: "Setup",
    slug: "setup",
    aliases: ["pairing", "linking"],
    commands: ["start", "menu", "help", "link", "unlink"],
  },
  {
    title: "Status",
    slug: "status",
    aliases: ["account", "health"],
    commands: ["status", "account", "limits", "usage", "version", "upgrade", "feedback", "login", "cancel_login", "logout", "wake", "prefs", "pets"],
  },
  {
    title: "Threads",
    slug: "threads",
    aliases: ["thread", "chats", "history"],
    commands: ["threads", "resume", "thread", "archived", "archive", "unarchive", "rename", "title", "activity", "checkpoint", "compact", "context", "open", "pending", "stop"],
  },
  {
    title: "Projects",
    slug: "projects",
    aliases: ["folders", "workspace"],
    commands: ["projects", "browse", "mkdir", "new", "fork"],
  },
  {
    title: "Runtime",
    slug: "runtime",
    aliases: ["settings", "model", "preferences"],
    commands: ["model", "access", "keep_awake", "skills", "plugins"],
  },
  {
    title: "Git",
    slug: "git",
    aliases: ["repo", "repository"],
    commands: ["git", "init", "diff", "log", "remote", "branches", "branch", "worktree", "checkout", "pull", "reset_remote", "stash", "stash_pop", "commit", "draft_commit", "push", "draft_pr", "pr", "ship", "review", "subagents"],
  },
  {
    title: "Codex Input",
    slug: "input",
    aliases: ["codex", "chat"],
    commands: ["plan", "continue", "answer"],
  },
]);

const TELEGRAM_COMMAND_HELP_TOPICS = Object.freeze([
  {
    title: "Commit and Ship",
    slug: "commit_ship",
    aliases: ["commit_flow"],
    commands: ["draft_commit", "commit", "ship"],
  },
  {
    title: "Publish",
    slug: "publish",
    aliases: ["pull_request"],
    commands: ["push", "draft_pr", "pr", "ship"],
  },
  {
    title: "Git Maintenance",
    slug: "git_maintenance",
    aliases: ["maintenance"],
    commands: ["pull", "reset_remote", "stash", "stash_pop"],
  },
]);

const TELEGRAM_PRIMARY_COMMAND_HELP_GROUPS = Object.freeze([
  {
    title: "Chat",
    commands: ["continue", "plan", "answer"],
  },
  {
    title: "Threads",
    commands: ["status", "threads", "resume", "thread", "new", "activity", "open", "stop", "pending"],
  },
  {
    title: "Setup",
    commands: ["start", "menu", "link", "unlink", "help"],
  },
]);

const TELEGRAM_CONTROL_COMMANDS_BY_NAME = new Map(
  TELEGRAM_CONTROL_COMMANDS.map((command) => [command.command, command])
);
const TELEGRAM_COMMAND_MENU = TELEGRAM_CONTROL_COMMANDS
  .filter((command) => command.primary)
  .map(({ command, description }) => ({
    command,
    description,
  }));
const TELEGRAM_ACTIVE_THREAD_COMMANDS = TELEGRAM_CONTROL_COMMANDS.filter((command) => command.requiresActiveThread)
  .map((command) => ({
    command: command.command,
    sample: command.activeThreadSample || `/${command.command}`,
  }));
const TELEGRAM_RESTRICTED_ACCESS_COMMANDS = Object.freeze(TELEGRAM_CONTROL_COMMANDS
  .filter((command) => command.allowedWhenProMissing)
  .map((command) => command.command));
const TELEGRAM_CALLBACK_COMMANDS = Object.freeze(TELEGRAM_CONTROL_COMMANDS
  .filter((command) => command.callbackAction)
  .map((command) => command.command));
const TELEGRAM_RESTRICTED_ACCESS_CALLBACK_COMMANDS = Object.freeze(TELEGRAM_CONTROL_COMMANDS
  .filter((command) => command.allowedWhenProMissing && command.callbackAction)
  .map((command) => command.command));
const SUPPORTED_COMMANDS = new Set([
  ...TELEGRAM_CONTROL_COMMANDS.map((command) => command.command),
]);
const CALLBACK_COMMANDS = new Set(TELEGRAM_CALLBACK_COMMANDS);

function parseTelegramCommand(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  const match = trimmed.match(/^\/([A-Za-z0-9_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/);
  if (!match) {
    return { name: "unknown", arg: "" };
  }
  const name = match[1].toLowerCase();
  if (!SUPPORTED_COMMANDS.has(name)) {
    return { name: "unknown", arg: "" };
  }
  return { name, arg: (match[2] || "").trim() };
}

function normalizeTelegramActionType(type) {
  const normalized = normalizeNonEmptyString(type);
  if (!normalized.startsWith("command.")) {
    return normalized;
  }
  const commandName = normalized.slice("command.".length).toLowerCase();
  if (!CALLBACK_COMMANDS.has(commandName)) {
    throw new Error(`Unsupported Telegram callback command action: ${normalized}`);
  }
  return `command.${commandName}`;
}

function renderTelegramCommandHelp(topic = "") {
  const normalizedTopic = normalizeHelpTopic(topic);
  if (normalizedTopic) {
    if (normalizedTopic === "all" || normalizedTopic === "advanced") {
      return renderAllCommandHelp();
    }
    const group = findHelpGroup(normalizedTopic);
    if (group) {
      return renderCommandGroupHelp(group);
    }
    const command = TELEGRAM_CONTROL_COMMANDS_BY_NAME.get(normalizedTopic);
    if (command) {
      return renderCommandHelp(command);
    }
    const workflowTopic = findHelpTopic(normalizedTopic);
    if (workflowTopic) {
      return renderCommandTopicHelp(workflowTopic);
    }
    return [
      `Help topic not found: ${safeHelpTopicLabel(topic)}`,
      "Use /help for all sections.",
    ].join("\n");
  }

  const lines = [
    "Remodex Telegram",
    "Type a message to chat with Codex.",
  ];
  for (const group of TELEGRAM_PRIMARY_COMMAND_HELP_GROUPS) {
    lines.push(`${group.title}: ${group.commands.map(commandUsage).join(", ")}`);
  }
  lines.push("Use /help <section|command> for focused help.");
  lines.push("Use /help all for the full command catalog.");
  lines.push("Use /menu for buttons.");
  return lines.join("\n");
}

function renderAllCommandHelp() {
  const lines = ["All commands:"];
  for (const group of TELEGRAM_COMMAND_HELP_GROUPS) {
    lines.push(`${group.title}: ${group.commands.map(commandUsage).join(", ")}`);
  }
  lines.push("Use /help <section|command> for details.");
  lines.push("Use /menu for primary buttons.");
  return lines.join("\n");
}

function commandUsage(commandName) {
  const command = TELEGRAM_CONTROL_COMMANDS_BY_NAME.get(commandName);
  return command?.usage || `/${commandName}`;
}

function renderCommandGroupHelp(group) {
  const lines = [`${group.title} commands:`];
  appendCommandHelpLines(lines, group.commands);
  lines.push("Use /help for all sections.");
  return lines.join("\n");
}

function renderCommandTopicHelp(topic) {
  const lines = [`${topic.title} commands:`];
  appendCommandHelpLines(lines, topic.commands);
  lines.push("Use /help for all sections.");
  return lines.join("\n");
}

function renderCommandHelp(command) {
  return [
    `${commandUsage(command.command)}: ${command.description}${commandHelpSuffix(command)}`,
    "Use /help for all sections.",
  ].join("\n");
}

function commandHelpSuffix(command) {
  const notes = [];
  if (command.requiresActiveThread) {
    notes.push("Requires an active thread.");
  }
  if (command.allowedWhenProMissing) {
    notes.push("Available without Pro entitlement.");
  }
  return notes.length > 0 ? ` ${notes.join(" ")}` : "";
}

function appendCommandHelpLines(lines, commandNames) {
  for (const commandName of commandNames) {
    const command = TELEGRAM_CONTROL_COMMANDS_BY_NAME.get(commandName);
    if (command) {
      lines.push(`- ${commandUsage(commandName)}: ${command.description}${commandHelpSuffix(command)}`);
    }
  }
}

function findHelpGroup(topic) {
  return TELEGRAM_COMMAND_HELP_GROUPS.find((group) => {
    const groupKeys = [
      group.title,
      group.slug,
      ...(Array.isArray(group.aliases) ? group.aliases : []),
    ].map(normalizeHelpTopic);
    return groupKeys.includes(topic);
  });
}

function findHelpTopic(topic) {
  return TELEGRAM_COMMAND_HELP_TOPICS.find((group) => {
    const groupKeys = [
      group.title,
      group.slug,
      ...(Array.isArray(group.aliases) ? group.aliases : []),
    ].map(normalizeHelpTopic);
    return groupKeys.includes(topic);
  });
}

function normalizeHelpTopic(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized
    .replace(/^\/+/, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function safeHelpTopicLabel(value) {
  const label = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return label.slice(0, 80) || "unknown";
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : String(value ?? "").trim();
}

module.exports = {
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
};
