// FILE: telegram-keyboards.js
// Purpose: Telegram inline keyboard builders with row-limit and pagination policy.
// Layer: CLI helper
// Exports: createTelegramKeyboards, keyboard constants

const { normalizeTelegramActionType } = require('./telegram-command-catalog');
const {
  TELEGRAM_MODEL_CHOICES,
  TELEGRAM_REASONING_EFFORT_CHOICES,
  TELEGRAM_SERVICE_TIER_CHOICES,
  normalizeTelegramRuntimePreferences,
} = require('./telegram-runtime-preferences');

const MAX_KEYBOARD_ROWS = 4;
const MAX_PICKER_ITEMS = 5;
const TELEGRAM_BUTTON_TEXT_MAX_CHARS = 64;
const TELEGRAM_BUTTON_TEXT_TRUNCATION_SUFFIX = '...';
const TELEGRAM_ACTIVITY_DEFAULT_LIMIT = 3;
const TELEGRAM_ACTIVITY_MORE_LIMIT = 8;
const MODEL_PICKER_PAGE_SIZE = 3;

const NAV_BUTTONS = Object.freeze({
  menu: 'command.menu',
  status: 'command.status',
});

const SINGLE_USE_TELEGRAM_ACTION_TYPES = new Set([
  'approval.accept',
  'approval.reject',
  'user_input.answer',
  'thread.select',
  'thread.unarchive',
  'project.new_thread',
  'git.checkout',
  'checkpoint.restore_preview',
  'checkpoint.restore_apply',
  'git.reset_to_remote',
]);

function createTelegramKeyboards({
  actionRegistry,
  telegramAccessModeFor = () => 'on-request',
  canLogoutFromAccountStatus = () => false,
} = {}) {
  if (!actionRegistry) {
    throw new Error('Telegram keyboards require an action registry.');
  }

  function normalizeChatId(value) {
    return String(value ?? '').trim();
  }

  function threadTitle(thread) {
    return thread?.title || thread?.name || thread?.id || 'Untitled';
  }

  function projectTitle(project) {
    return normalizeChatId(project?.label || project?.name || project?.path) || 'Project';
  }

  function normalizeProjectEntries(result = {}) {
    if (Array.isArray(result.projects)) return result.projects;
    if (Array.isArray(result.entries)) return result.entries;
    if (Array.isArray(result.locations)) return result.locations;
    return [];
  }

  function compactKeyboard(rows) {
    return { inline_keyboard: rows.filter((row) => row.length > 0).slice(0, MAX_KEYBOARD_ROWS) };
  }

  function navRow(chatId) {
    return [
      makeActionButton(chatId, 'Menu', NAV_BUTTONS.menu),
      makeActionButton(chatId, 'Status', NAV_BUTTONS.status),
    ];
  }

  function hubRow(chatId, left, right) {
    return [
      makeActionButton(chatId, left.label, left.type, left.payload),
      makeActionButton(chatId, right.label, right.type, right.payload),
    ];
  }

  function paginateRows(chatId, { page = 0, pageCount = 1, listType, listPayload = {} }) {
    const rows = [];
    if (pageCount > 1) {
      const controls = [];
      if (page > 0) {
        controls.push(makeActionButton(chatId, 'Prev', 'picker.page', { listType, page: page - 1, ...listPayload }));
      }
      if (page < pageCount - 1) {
        controls.push(makeActionButton(chatId, 'Next', 'picker.page', { listType, page: page + 1, ...listPayload }));
      }
      controls.push(makeActionButton(chatId, 'Menu', NAV_BUTTONS.menu));
      if (controls.length) rows.push(controls.slice(0, 3));
    } else {
      rows.push([makeActionButton(chatId, 'Menu', NAV_BUTTONS.menu)]);
    }
    return rows;
  }

  function pageCount(itemCount, pageSize = MAX_PICKER_ITEMS) {
    return Math.max(1, Math.ceil(itemCount / pageSize));
  }

  function paginateItems(items, page = 0, pageSize = MAX_PICKER_ITEMS) {
    const start = page * pageSize;
    return items.slice(start, start + pageSize);
  }

  function normalizeTelegramActivityLimit(value) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return TELEGRAM_ACTIVITY_DEFAULT_LIMIT;
    }
    return Math.min(parsed, TELEGRAM_ACTIVITY_MORE_LIMIT);
  }

  function singleAnswerableTelegramQuestion(params = {}) {
    const questions = Array.isArray(params.questions) ? params.questions : [];
    if (questions.length !== 1) {
      return null;
    }
    const question = questions[0] || {};
    const questionId = normalizeChatId(question.id);
    const options = Array.isArray(question.options)
      ? question.options.filter((option) => normalizeChatId(option?.label))
      : [];
    if (!questionId || options.length === 0) {
      return null;
    }
    return { ...question, options };
  }

  function makeActionButton(chatId, text, type, payload = {}) {
    const actionType = normalizeTelegramActionType(type);
    return {
      text: truncateTelegramButtonText(text),
      callback_data: actionRegistry.createAction({
        chatId,
        type: actionType,
        payload,
        singleUse: isSingleUseTelegramAction(actionType, payload),
      }),
    };
  }

  function truncateTelegramButtonText(value) {
    const text = normalizeChatId(value).replace(/\s+/g, " ");
    const chars = Array.from(text);
    if (chars.length <= TELEGRAM_BUTTON_TEXT_MAX_CHARS) {
      return text || "Action";
    }
    const suffixChars = Array.from(TELEGRAM_BUTTON_TEXT_TRUNCATION_SUFFIX);
    return `${chars.slice(0, TELEGRAM_BUTTON_TEXT_MAX_CHARS - suffixChars.length).join("")}${TELEGRAM_BUTTON_TEXT_TRUNCATION_SUFFIX}`;
  }

  function isSingleUseTelegramAction(type, payload = {}) {
    return SINGLE_USE_TELEGRAM_ACTION_TYPES.has(type)
      || (type === "command.logout" && payload?.confirm === true);
  }

  function buildHomeHubReplyMarkup(chatId, linkedChat) {
    return compactKeyboard([
      hubRow(chatId,
        { label: "Chat", type: "hub.open", payload: { hub: "chat" } },
        { label: "Threads", type: "hub.open", payload: { hub: "threads" } }),
      hubRow(chatId,
        { label: "Git", type: "hub.open", payload: { hub: "git" } },
        { label: "Settings", type: "hub.open", payload: { hub: "settings" } }),
      [makeActionButton(chatId, "Help", "command.help")],
      navRow(chatId),
    ]);
  }

  function buildChatHubReplyMarkup(chatId, linkedChat) {
    const rows = [];
    if (linkedChat?.activeThreadId) {
      rows.push([
        makeActionButton(chatId, "Stop", "command.stop", { threadId: linkedChat.activeThreadId }),
        makeActionButton(chatId, "Pending", "command.pending", { threadId: linkedChat.activeThreadId }),
      ]);
      rows.push([
        makeActionButton(chatId, "Plan", "command.help", { topic: "plan" }),
        makeActionButton(chatId, "Activity", "command.activity", { threadId: linkedChat.activeThreadId }),
      ]);
      rows.push([
        makeActionButton(chatId, "Open Mac", "command.open", { threadId: linkedChat.activeThreadId }),
      ]);
    } else {
      rows.push([
        makeActionButton(chatId, "New", "command.new"),
        makeActionButton(chatId, "Resume Mac", "command.resume"),
      ]);
    }
    rows.push(navRow(chatId));
    return compactKeyboard(rows);
  }

  function buildThreadsHubReplyMarkup(chatId, linkedChat) {
    return compactKeyboard([
      [
        makeActionButton(chatId, "Threads", "command.threads"),
        makeActionButton(chatId, "Resume Mac", "command.resume"),
      ],
      [
        makeActionButton(chatId, "New", "command.new", linkedChat?.activeThreadId
          ? { sourceThreadId: linkedChat.activeThreadId }
          : undefined),
        makeActionButton(chatId, "Archived", "command.archived"),
      ],
      navRow(chatId),
    ]);
  }

  function buildGitHubReplyMarkup(chatId, linkedChat) {
    const threadPayload = linkedChat?.activeThreadId ? { threadId: linkedChat.activeThreadId } : {};
    return compactKeyboard([
      [
        makeActionButton(chatId, "Diff", "command.diff", threadPayload),
        makeActionButton(chatId, "Branches", "command.branches", threadPayload),
      ],
      [
        makeActionButton(chatId, "Draft", "command.draft_commit", threadPayload),
        makeActionButton(chatId, "Push", "command.push", threadPayload),
      ],
      [
        makeActionButton(chatId, "Stash", "command.stash", threadPayload),
        makeActionButton(chatId, "Git", "command.git", threadPayload),
      ],
      navRow(chatId),
    ]);
  }

  function buildSettingsHubReplyMarkup(chatId) {
    return compactKeyboard([
      [
        makeActionButton(chatId, "Model", "command.model"),
        makeActionButton(chatId, "Access", "command.access"),
      ],
      [
        makeActionButton(chatId, "Account", "command.account"),
        makeActionButton(chatId, "Prefs", "command.prefs"),
      ],
      [makeActionButton(chatId, "Advanced (Mac)", "hub.open", { hub: "advanced" })],
      navRow(chatId),
    ]);
  }

  function buildAdvancedMacHubReplyMarkup(chatId, linkedChat) {
    const threadPayload = linkedChat?.activeThreadId ? { threadId: linkedChat.activeThreadId } : {};
    return compactKeyboard([
      [
        makeActionButton(chatId, "Skills", "command.skills", threadPayload),
        makeActionButton(chatId, "Plugins", "command.plugins", threadPayload),
      ],
      [makeActionButton(chatId, "Pets", "command.pets")],
      navRow(chatId),
    ]);
  }

  function buildStatusReplyMarkup(chatId, linkedChat) {
    return buildHomeHubReplyMarkup(chatId, linkedChat);
  }

  function buildActionMenuReplyMarkup(chatId, linkedChat) {
    return buildHomeHubReplyMarkup(chatId, linkedChat);
  }

  function buildMissingThreadReplyMarkup(chatId) {
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Threads", "command.threads"),
          makeActionButton(chatId, "Help", "command.help"),
        ],
        [
          makeActionButton(chatId, "New", "command.new"),
          makeActionButton(chatId, "Status", "command.status"),
        ],
      ],
    };
  }

  function buildContinueReplyMarkup(chatId, linkedChat) {
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Stop", "command.stop", { threadId: linkedChat.activeThreadId }),
          makeActionButton(chatId, "Status", "command.status"),
        ],
        [
          makeActionButton(chatId, "Activity", "command.activity", { threadId: linkedChat.activeThreadId }),
          makeActionButton(chatId, "Pending", "command.pending", { threadId: linkedChat.activeThreadId }),
        ],
        [
          makeActionButton(chatId, "Menu", "command.menu"),
          makeActionButton(chatId, "Open Mac", "command.open", { threadId: linkedChat.activeThreadId }),
        ],
      ],
    };
  }

  function buildThreadActivityReplyMarkup(chatId, linkedChat, limit = TELEGRAM_ACTIVITY_DEFAULT_LIMIT) {
    const normalizedLimit = normalizeTelegramActivityLimit(limit);
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Refresh", "command.activity", { threadId: linkedChat.activeThreadId, limit: normalizedLimit }),
          makeActionButton(chatId, "More", "command.activity", { threadId: linkedChat.activeThreadId, limit: TELEGRAM_ACTIVITY_MORE_LIMIT }),
        ],
        [
          makeActionButton(chatId, "Help", "command.help"),
        ],
        [
          makeActionButton(chatId, "Open Mac", "command.open", { threadId: linkedChat.activeThreadId }),
          makeActionButton(chatId, "Status", "command.status"),
        ],
      ],
    };
  }

  function buildCheckpointReplyMarkup(chatId, linkedChat, result = {}) {
    const checkpoint = result.checkpoint || result || {};
    const checkpointRef = normalizeChatId(checkpoint.checkpointRef);
    const commit = normalizeChatId(checkpoint.commit);
    const rows = [];
    if (checkpointRef) {
      rows.push([
        makeActionButton(chatId, "Preview Restore", "checkpoint.restore_preview", {
          threadId: linkedChat.activeThreadId,
          checkpointRef,
          commit,
        }),
      ]);
    }
    rows.push([
      makeActionButton(chatId, "Activity", "command.activity", { threadId: linkedChat.activeThreadId }),
      makeActionButton(chatId, "Git", "command.git", { threadId: linkedChat.activeThreadId }),
    ]);
    rows.push([
      makeActionButton(chatId, "Open Mac", "command.open", { threadId: linkedChat.activeThreadId }),
      makeActionButton(chatId, "Status", "command.status"),
    ]);
    return { inline_keyboard: rows };
  }

  function buildCheckpointPreviewReplyMarkup(chatId, linkedChat, result = {}) {
    const checkpointRef = normalizeChatId(result.checkpointRef);
    const expectedTargetCommit = normalizeChatId(result.commit);
    const rows = [];
    if (result.canRestore !== false && checkpointRef) {
      rows.push([
        makeActionButton(chatId, "Apply Restore", "checkpoint.restore_apply", {
          threadId: linkedChat.activeThreadId,
          checkpointRef,
          expectedTargetCommit,
        }),
      ]);
    }
    rows.push([
      makeActionButton(chatId, "Open Mac", "command.open", { threadId: linkedChat.activeThreadId }),
      makeActionButton(chatId, "Checkpoint", "command.checkpoint", { threadId: linkedChat.activeThreadId }),
    ]);
    rows.push([
      makeActionButton(chatId, "Status", "command.status"),
      makeActionButton(chatId, "Git", "command.git", { threadId: linkedChat.activeThreadId }),
    ]);
    return { inline_keyboard: rows };
  }

  function buildCheckpointAppliedReplyMarkup(chatId, linkedChat) {
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Git", "command.git", { threadId: linkedChat.activeThreadId }),
          makeActionButton(chatId, "Activity", "command.activity", { threadId: linkedChat.activeThreadId }),
        ],
        [
          makeActionButton(chatId, "Open Mac", "command.open", { threadId: linkedChat.activeThreadId }),
          makeActionButton(chatId, "Status", "command.status"),
        ],
      ],
    };
  }

  function buildAccountReplyMarkup(chatId, status = {}) {
    const rows = [
      [
        makeActionButton(chatId, "Open Login", "command.login"),
        makeActionButton(chatId, "Refresh", "command.account"),
      ],
    ];
    if (status.loginInFlight) {
      rows.push([
        makeActionButton(chatId, "Cancel Login", "command.cancel_login"),
      ]);
    }
    if (canLogoutFromAccountStatus(status)) {
      rows.push([
        makeActionButton(chatId, "Sign Out", "command.logout"),
      ]);
    }
    rows.push(
      [
        makeActionButton(chatId, "Limits", "command.limits"),
      ],
      [
        makeActionButton(chatId, "Menu", "command.menu"),
        makeActionButton(chatId, "Version", "command.version"),
      ],
    );
    return { inline_keyboard: rows };
  }

  function buildLogoutConfirmationReplyMarkup(chatId) {
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Confirm Sign Out", "command.logout", { confirm: true }),
        ],
        [
          makeActionButton(chatId, "Account", "command.account"),
          makeActionButton(chatId, "Status", "command.status"),
        ],
      ],
    };
  }

  function buildRateLimitsReplyMarkup(chatId) {
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Refresh", "command.limits"),
          makeActionButton(chatId, "Usage", "command.usage"),
        ],
        [
          makeActionButton(chatId, "Account", "command.account"),
        ],
        [
          makeActionButton(chatId, "Status", "command.status"),
          makeActionButton(chatId, "Menu", "command.menu"),
        ],
      ],
    };
  }

  function buildUsageReplyMarkup(chatId, linkedChat) {
    const rows = [
      [
        makeActionButton(chatId, "Refresh", "command.usage", linkedChat?.activeThreadId
          ? { threadId: linkedChat.activeThreadId }
          : undefined),
        makeActionButton(chatId, "Limits", "command.limits"),
      ],
      [
        makeActionButton(chatId, "Account", "command.account"),
        makeActionButton(chatId, "Status", "command.status"),
      ],
    ];
    if (linkedChat?.activeThreadId) {
      rows.push([
        makeActionButton(chatId, "Context", "command.context", { threadId: linkedChat.activeThreadId }),
        makeActionButton(chatId, "Open Mac", "command.open", { threadId: linkedChat.activeThreadId }),
      ]);
    }
    rows.push([
      makeActionButton(chatId, "Menu", "command.menu"),
    ]);
    return { inline_keyboard: rows };
  }

  function buildVersionReplyMarkup(chatId) {
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Refresh", "command.version"),
          makeActionButton(chatId, "Account", "command.account"),
        ],
        [
          makeActionButton(chatId, "Status", "command.status"),
          makeActionButton(chatId, "Menu", "command.menu"),
        ],
      ],
    };
  }

  function buildFeedbackReplyMarkup(chatId) {
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Status", "command.status"),
          makeActionButton(chatId, "Menu", "command.menu"),
        ],
      ],
    };
  }

  function buildAccessRequiredReplyMarkup(chatId) {
    return buildAccessStatusReplyMarkup(chatId);
  }

  function buildAccessStatusReplyMarkup(chatId) {
    return compactKeyboard([
      [
        makeActionButton(chatId, "Upgrade", "command.upgrade"),
        makeActionButton(chatId, "Help", "command.help"),
      ],
      [
        makeActionButton(chatId, "Account", "command.account"),
        makeActionButton(chatId, "Menu", NAV_BUTTONS.menu),
      ],
      navRow(chatId),
    ]);
  }

  function buildUpgradeReplyMarkup(chatId) {
    return buildAccessStatusReplyMarkup(chatId);
  }

  function buildPreferencesReplyMarkup(chatId) {
    return compactKeyboard([
      [
        makeActionButton(chatId, "Keep Awake On", "prefs.keep_awake", { value: true }),
        makeActionButton(chatId, "Keep Awake Off", "prefs.keep_awake", { value: false }),
      ],
      [
        makeActionButton(chatId, "Model", "command.model"),
        makeActionButton(chatId, "Access", "command.access"),
      ],
      navRow(chatId),
    ]);
  }

  function buildPetsReplyMarkup(chatId) {
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Refresh", "command.pets"),
          makeActionButton(chatId, "Menu", "command.menu"),
        ],
      ],
    };
  }

  function buildDiscoveryReplyMarkup(chatId, linkedChat, kind, query = "") {
    const actionType = kind === "plugins" ? "command.plugins" : "command.skills";
    const payload = { threadId: linkedChat?.activeThreadId, query: normalizeChatId(query) };
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Refresh", actionType, payload),
          makeActionButton(chatId, kind === "plugins" ? "Skills" : "Plugins", kind === "plugins" ? "command.skills" : "command.plugins", {
            threadId: linkedChat?.activeThreadId,
          }),
        ],
        [
          makeActionButton(chatId, "Open Mac", "command.open", { threadId: linkedChat?.activeThreadId }),
          makeActionButton(chatId, "Menu", "command.menu"),
        ],
      ],
    };
  }

  function buildModelReplyMarkup(chatId, linkedChat = {}, { page = 0, section = "model" } = {}) {
    if (section === "summary") {
      return compactKeyboard([
        [
          makeActionButton(chatId, "Pick Model", "runtime.model_picker", { page: 0 }),
          makeActionButton(chatId, "Effort", "runtime.model_picker", { page: 0, section: "effort" }),
        ],
        [
          makeActionButton(chatId, "Tier", "runtime.model_picker", { page: 0, section: "tier" }),
          makeActionButton(chatId, "Access", "runtime.model_picker", { page: 0, section: "access" }),
        ],
        navRow(chatId),
      ]);
    }
    return buildModelPickerReplyMarkup(chatId, linkedChat, { page, section });
  }

  function buildModelPickerReplyMarkup(chatId, linkedChat = {}, { page = 0, section = "model" } = {}) {
    const runtime = normalizeTelegramRuntimePreferences(linkedChat);
    const accessMode = telegramAccessModeFor(linkedChat);
    const rows = [];

    if (section === "model") {
      const choices = paginateItems(TELEGRAM_MODEL_CHOICES, page, MODEL_PICKER_PAGE_SIZE);
      for (const choice of choices) {
        rows.push([
          makeActionButton(
            chatId,
            `${choice.id === runtime.model ? "* " : ""}${choice.label}`,
            "runtime.model",
            { model: choice.id }
          ),
        ]);
      }
      rows.push(...paginateRows(chatId, {
        page,
        pageCount: pageCount(TELEGRAM_MODEL_CHOICES.length, MODEL_PICKER_PAGE_SIZE),
        listType: "model",
        listPayload: { section: "model" },
      }));
    } else if (section === "effort") {
      rows.push(
        TELEGRAM_REASONING_EFFORT_CHOICES.map((choice) => makeActionButton(
          chatId,
          `${choice.id === runtime.reasoningEffort ? "* " : ""}${choice.label}`,
          "runtime.effort",
          { reasoningEffort: choice.id }
        ))
      );
      rows.push(navRow(chatId));
    } else if (section === "tier") {
      rows.push(
        TELEGRAM_SERVICE_TIER_CHOICES.map((choice) => makeActionButton(
          chatId,
          `${choice.value === runtime.serviceTier ? "* " : ""}${choice.label}`,
          "runtime.service_tier",
          { serviceTier: choice.id }
        ))
      );
      rows.push(navRow(chatId));
    } else if (section === "access") {
      rows.push([
        makeActionButton(chatId, `${accessMode === "on-request" ? "* " : ""}On-Request`, "runtime.access", { accessMode: "on-request" }),
        makeActionButton(chatId, `${accessMode === "full-access" ? "* " : ""}Full Access`, "runtime.access", { accessMode: "full-access" }),
      ]);
      rows.push(navRow(chatId));
    }

    return compactKeyboard(rows);
  }

  function buildDraftCommitReplyMarkup(chatId, linkedChat, draft = {}) {
    const subject = normalizeChatId(draft.subject);
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Refresh Draft", "command.draft_commit", { threadId: linkedChat.activeThreadId }),
          makeActionButton(chatId, "Git", "command.git", { threadId: linkedChat.activeThreadId }),
        ],
        [
          makeActionButton(chatId, subject ? "Commit Help" : "Commit/Ship", "command.help", { topic: "commit_ship" }),
          makeActionButton(chatId, "Menu", "command.menu"),
        ],
      ],
    };
  }

  function buildDraftPullRequestReplyMarkup(chatId, linkedChat) {
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Refresh Draft", "command.draft_pr", { threadId: linkedChat.activeThreadId }),
          makeActionButton(chatId, "PR", "command.pr", { threadId: linkedChat.activeThreadId }),
        ],
        [
          makeActionButton(chatId, "Push", "command.push", { threadId: linkedChat.activeThreadId }),
          makeActionButton(chatId, "Menu", "command.menu"),
        ],
      ],
    };
  }

  function buildReviewReplyMarkup(chatId, linkedChat) {
    const rows = [];
    if (linkedChat?.activeThreadId) {
      rows.push([
        makeActionButton(chatId, "Review Changes", "command.review", { threadId: linkedChat.activeThreadId, target: "changes" }),
        makeActionButton(chatId, "Git", "command.git", { threadId: linkedChat.activeThreadId }),
      ]);
    }
    rows.push([
      makeActionButton(chatId, "Branches", "command.branches", linkedChat?.activeThreadId ? { threadId: linkedChat.activeThreadId } : {}),
      makeActionButton(chatId, "Menu", "command.menu"),
    ]);
    return { inline_keyboard: rows };
  }

  function buildThreadChoiceReplyMarkup(chatId, threads, { page = 0, query = "" } = {}) {
    const filtered = threads.filter((thread) => thread?.id);
    const pages = pageCount(filtered.length);
    const pageItems = paginateItems(filtered, page);
    const rows = pageItems.map((thread, index) => ([
      makeActionButton(
        chatId,
        `${page * MAX_PICKER_ITEMS + index + 1}. ${threadTitle(thread)}`,
        "thread.select",
        { threadId: thread.id, title: threadTitle(thread) }
      ),
    ]));
    rows.push(...paginateRows(chatId, { page, pageCount: pages, listType: "threads", listPayload: { query } }));
    return rows.length ? { inline_keyboard: rows } : undefined;
  }

  function buildArchivedThreadReplyMarkup(chatId, threads, { page = 0, query = "" } = {}) {
    const filtered = threads.filter((thread) => thread?.id);
    const pages = pageCount(filtered.length);
    const pageItems = paginateItems(filtered, page);
    const rows = pageItems.map((thread, index) => ([
      makeActionButton(
        chatId,
        `Unarchive ${page * MAX_PICKER_ITEMS + index + 1}. ${threadTitle(thread)}`,
        "thread.unarchive",
        { threadId: thread.id, title: threadTitle(thread) }
      ),
    ]));
    rows.push(...paginateRows(chatId, { page, pageCount: pages, listType: "archived", listPayload: { query } }));
    return { inline_keyboard: rows };
  }

  function buildArchivedActionReplyMarkup(chatId) {
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Archived", "command.archived"),
          makeActionButton(chatId, "Threads", "command.threads"),
        ],
        [
          makeActionButton(chatId, "New", "command.new"),
          makeActionButton(chatId, "Menu", "command.menu"),
        ],
      ],
    };
  }

  function buildProjectChoiceReplyMarkup(chatId, result = {}, { page = 0, query = "" } = {}) {
    const projects = normalizeProjectEntries(result)
      .filter((project) => normalizeChatId(project?.path));
    const pages = pageCount(projects.length);
    const pageItems = paginateItems(projects, page);
    const rows = pageItems.map((project) => ([
      makeActionButton(
        chatId,
        `New: ${projectTitle(project)}`,
        "project.new_thread",
        { cwd: project.path }
      ),
    ]));
    rows.push(...paginateRows(chatId, { page, pageCount: pages, listType: "projects", listPayload: { query } }));
    return rows.length ? { inline_keyboard: rows } : undefined;
  }

  function buildProjectDirectoryReplyMarkup(chatId, result = {}, { page = 0 } = {}) {
    const currentPath = normalizeChatId(result.path);
    const parentPath = normalizeChatId(result.parentPath);
    const entries = normalizeProjectEntries(result).filter((entry) => normalizeChatId(entry?.path));
    const rows = [];
    if (currentPath) {
      rows.push([
        makeActionButton(chatId, "New here", "project.new_thread", { cwd: currentPath }),
        makeActionButton(chatId, "New folder", "project.mkdir_help", { path: currentPath }),
      ]);
      rows.push([
        parentPath
          ? makeActionButton(chatId, "Parent", "project.browse", { path: parentPath })
          : makeActionButton(chatId, "Roots", "command.browse"),
      ]);
    }
    const pageItems = paginateItems(entries, page);
    for (const entry of pageItems) {
      rows.push([
        makeActionButton(chatId, `Open: ${projectTitle(entry)}`, "project.browse", { path: entry.path }),
        makeActionButton(chatId, `New: ${projectTitle(entry)}`, "project.new_thread", { cwd: entry.path }),
      ]);
    }
    rows.push(...paginateRows(chatId, {
      page,
      pageCount: pageCount(entries.length),
      listType: "browse",
      listPayload: { path: currentPath },
    }));
    return { inline_keyboard: rows };
  }

  function buildCreatedProjectDirectoryReplyMarkup(chatId, result = {}) {
    const folderPath = normalizeChatId(result.path);
    const rows = [];
    if (folderPath) {
      rows.push([
        makeActionButton(chatId, "Open folder", "project.browse", { path: folderPath }),
        makeActionButton(chatId, "New thread", "project.new_thread", { cwd: folderPath }),
      ]);
    }
    rows.push([
      makeActionButton(chatId, "Browse", "command.browse"),
      makeActionButton(chatId, "Status", "command.status"),
    ]);
    return { inline_keyboard: rows };
  }

  function buildBranchesReplyMarkup(chatId, linkedChat, branchesResult = {}, { page = 0 } = {}) {
    const current = normalizeChatId(branchesResult.current || branchesResult.status?.branch);
    const elsewhere = new Set(Array.isArray(branchesResult.branchesCheckedOutElsewhere)
      ? branchesResult.branchesCheckedOutElsewhere.map(normalizeChatId)
      : []);
    const branches = (Array.isArray(branchesResult.branches) ? branchesResult.branches : [])
      .map(normalizeChatId)
      .filter((branch) => branch && branch !== current && !elsewhere.has(branch));
    const pages = pageCount(branches.length);
    const pageItems = paginateItems(branches, page);
    const rows = pageItems.map((branch) => ([
      makeActionButton(
        chatId,
        `Checkout ${branch}`,
        "git.checkout",
        { threadId: linkedChat.activeThreadId, branch }
      ),
    ]));
    rows.push(...paginateRows(chatId, {
      page,
      pageCount: pages,
      listType: "branches",
      listPayload: { threadId: linkedChat.activeThreadId },
    }));
    return rows.length ? { inline_keyboard: rows } : undefined;
  }

  function buildGitInitReplyMarkup(chatId, linkedChat) {
    return {
      inline_keyboard: [[
        makeActionButton(chatId, "Init Git", "command.init", { threadId: linkedChat.activeThreadId }),
        makeActionButton(chatId, "Projects", "command.projects"),
      ]],
    };
  }

  function buildResetRemoteConfirmationReplyMarkup(chatId, linkedChat) {
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Discard Changes", "git.reset_to_remote", { threadId: linkedChat.activeThreadId }),
        ],
        [
          makeActionButton(chatId, "Git", "command.git", { threadId: linkedChat.activeThreadId }),
          makeActionButton(chatId, "Stash", "command.stash", { threadId: linkedChat.activeThreadId }),
        ],
        [
          makeActionButton(chatId, "Status", "command.status"),
          makeActionButton(chatId, "Menu", "command.menu"),
        ],
      ],
    };
  }

  function buildApprovalReplyMarkup(chatId, request) {
    return {
      inline_keyboard: [[
        makeActionButton(chatId, "Approve", "approval.accept", {
          requestId: request.id,
          method: request.method,
          params: request.params,
        }),
        makeActionButton(chatId, "Decline", "approval.reject", {
          requestId: request.id,
          method: request.method,
          params: request.params,
        }),
      ]],
    };
  }

  function buildUserInputReplyMarkup(chatId, request) {
    const rows = [];
    const question = singleAnswerableTelegramQuestion(request.params);
    if (question) {
      const questionId = normalizeChatId(question.id);
      for (const option of question.options.slice(0, 8)) {
        const label = normalizeChatId(option.label);
        if (!label) {
          continue;
        }
        rows.push([
          makeActionButton(chatId, label, "user_input.answer", {
            requestId: request.id,
            method: request.method,
            params: request.params,
            answers: {
              [questionId]: { answers: [label] },
            },
          }),
        ]);
      }
    }

    const threadId = normalizeChatId(request.params?.threadId || request.params?.thread_id);
    if (threadId) {
      rows.push([
        makeActionButton(chatId, "Open Mac", "command.open", { threadId }),
        makeActionButton(chatId, "Activity", "command.activity", { threadId }),
      ]);
    }
    return rows.length ? { inline_keyboard: rows } : undefined;
  }

  function buildMissingPendingUserInputReplyMarkup(chatId, linkedChat) {
    const rows = [];
    if (linkedChat?.activeThreadId) {
      rows.push([
        makeActionButton(chatId, "Activity", "command.activity", { threadId: linkedChat.activeThreadId }),
        makeActionButton(chatId, "Open Mac", "command.open", { threadId: linkedChat.activeThreadId }),
      ]);
    }
    rows.push([
      makeActionButton(chatId, "Status", "command.status"),
      makeActionButton(chatId, "Menu", "command.menu"),
    ]);
    return { inline_keyboard: rows };
  }

  function buildThreadEventReplyMarkup(chatId, event) {
    if (event.method === "turn/started") {
      return {
        inline_keyboard: [[
          makeActionButton(chatId, "Stop", "command.stop", { threadId: event.threadId }),
          makeActionButton(chatId, "Status", "command.status"),
        ]],
      };
    }
    if (event.method === "codex/event/agent_message" || event.method === "turn/completed") {
      return buildPostTurnReplyMarkup(chatId, event.threadId);
    }
    return undefined;
  }

  function buildPostTurnReplyMarkup(chatId, threadId) {
    return {
      inline_keyboard: [
        [
          makeActionButton(chatId, "Activity", "command.activity", { threadId }),
          makeActionButton(chatId, "Pending", "command.pending", { threadId }),
        ],
        [
          makeActionButton(chatId, "Menu", "command.menu"),
          makeActionButton(chatId, "Open Mac", "command.open", { threadId }),
        ],
        [
          makeActionButton(chatId, "Status", "command.status"),
        ],
      ],
    };
  }

  return {
    MAX_KEYBOARD_ROWS,
    MAX_PICKER_ITEMS,
    NAV_BUTTONS,
    makeActionButton,
    buildHomeHubReplyMarkup,
    buildChatHubReplyMarkup,
    buildThreadsHubReplyMarkup,
    buildGitHubReplyMarkup,
    buildSettingsHubReplyMarkup,
    buildAdvancedMacHubReplyMarkup,
    buildStatusReplyMarkup,
    buildActionMenuReplyMarkup,
    buildMissingThreadReplyMarkup,
    buildContinueReplyMarkup,
    buildThreadActivityReplyMarkup,
    buildCheckpointReplyMarkup,
    buildCheckpointPreviewReplyMarkup,
    buildCheckpointAppliedReplyMarkup,
    buildAccountReplyMarkup,
    buildLogoutConfirmationReplyMarkup,
    buildRateLimitsReplyMarkup,
    buildUsageReplyMarkup,
    buildVersionReplyMarkup,
    buildFeedbackReplyMarkup,
    buildAccessRequiredReplyMarkup,
    buildAccessStatusReplyMarkup,
    buildUpgradeReplyMarkup,
    buildPreferencesReplyMarkup,
    buildPetsReplyMarkup,
    buildDiscoveryReplyMarkup,
    buildModelReplyMarkup,
    buildModelPickerReplyMarkup,
    buildDraftCommitReplyMarkup,
    buildDraftPullRequestReplyMarkup,
    buildReviewReplyMarkup,
    buildThreadChoiceReplyMarkup,
    buildArchivedThreadReplyMarkup,
    buildArchivedActionReplyMarkup,
    buildProjectChoiceReplyMarkup,
    buildProjectDirectoryReplyMarkup,
    buildCreatedProjectDirectoryReplyMarkup,
    buildBranchesReplyMarkup,
    buildGitInitReplyMarkup,
    buildResetRemoteConfirmationReplyMarkup,
    buildApprovalReplyMarkup,
    buildUserInputReplyMarkup,
    buildMissingPendingUserInputReplyMarkup,
    buildThreadEventReplyMarkup,
    buildPostTurnReplyMarkup,
  };
}

module.exports = {
  MAX_KEYBOARD_ROWS,
  MAX_PICKER_ITEMS,
  NAV_BUTTONS,
  createTelegramKeyboards,
};
