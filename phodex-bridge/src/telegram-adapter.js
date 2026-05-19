// FILE: telegram-adapter.js
// Purpose: Runs the local Telegram command surface against injected Remodex bridge controls.
// Layer: CLI helper
// Exports: createTelegramAdapter, parseTelegramCommand
// Depends on: telegram-session-state, telegram-action-registry, telegram-renderer

const {
  clearTelegramActiveThread,
  linkTelegramChat,
  readTelegramSessionState,
  setTelegramActiveThread,
  setTelegramProjectBrowsePath,
  setTelegramRuntimePreferences,
  unlinkTelegramChat,
} = require("./telegram-session-state");
const {
  canUseTelegramActionWithAccess,
  canUseTelegramCommandWithAccess,
  describeTelegramAccess,
  isTelegramAccessAllowed,
  normalizeTelegramAccessDescription,
} = require("./telegram-access");
const { createTelegramActionRegistry } = require("./telegram-action-registry");
const { createTelegramKeyboards } = require("./telegram-keyboards");
const {
  TELEGRAM_ACTIVE_THREAD_COMMANDS,
  TELEGRAM_COMMAND_MENU,
  normalizeTelegramActionType,
  parseTelegramCommand,
  renderTelegramCommandHelp,
} = require("./telegram-command-catalog");
const {
  renderTelegramAccessRequired,
  renderTelegramUpgradeInfo,
  renderTelegramAccountStatus,
  renderTelegramArchivedThreads,
  renderTelegramArchiveResult,
  renderTelegramApprovalRequest,
  renderTelegramBranches,
  renderTelegramCancelLoginResult,
  renderTelegramCheckoutResult,
  renderTelegramCheckpointResult,
  renderTelegramCheckpointRestoreApplyResult,
  renderTelegramCheckpointRestorePreview,
  renderTelegramCompactResult,
  renderTelegramCommitDraft,
  renderTelegramContextWindow,
  renderTelegramCreateBranchResult,
  renderTelegramDiffSummary,
  renderTelegramFeedbackResult,
  renderTelegramForkResult,
  renderTelegramGeneratedTitleResult,
  renderTelegramGitLog,
  renderTelegramGitStatus,
  renderTelegramGitInitResult,
  renderTelegramLinkHelp,
  renderTelegramLoginResult,
  renderTelegramLogoutConfirmation,
  renderTelegramLogoutResult,
  renderTelegramModelPreferences,
  renderTelegramOpenMacResult,
  renderTelegramPets,
  renderTelegramPlugins,
  renderTelegramPullResult,
  renderTelegramPullRequestDraft,
  renderTelegramThreadActivity,
  renderTelegramRateLimits,
  renderTelegramPreferences,
  renderTelegramProjectCreateDirectoryResult,
  renderTelegramProjectDirectory,
  renderTelegramProjects,
  renderTelegramRenameResult,
  renderTelegramResumeResult,
  renderTelegramReviewStartResult,
  renderTelegramRemote,
  renderTelegramResetRemoteConfirmation,
  renderTelegramResetRemoteResult,
  renderTelegramSkills,
  renderTelegramStackedActionResult,
  renderTelegramStashPopResult,
  renderTelegramStashResult,
  renderTelegramStatus,
  renderTelegramThreadEvent,
  renderTelegramUnarchiveResult,
  renderTelegramUserInputRequest,
  renderTelegramUsageStatus,
  renderTelegramVersionStatus,
  renderTelegramWakeMacResult,
  renderTelegramWorktreeThreadResult,
  renderUnauthorizedTelegramChat,
} = require("./telegram-renderer");
const { createTelegramBotApiClient } = require("./telegram-bot-api-client");
const {
  TELEGRAM_DEFAULT_ACCESS_MODE,
  TELEGRAM_MODEL_CHOICES,
  TELEGRAM_REASONING_EFFORT_CHOICES,
  TELEGRAM_SERVICE_TIER_CHOICES,
  normalizeTelegramAccessMode,
  normalizeTelegramModel,
  normalizeTelegramReasoningEffort,
  normalizeTelegramRuntimePreferences,
  normalizeTelegramServiceTier,
} = require("./telegram-runtime-preferences");

const APPROVAL_REQUEST_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/fileRead/requestApproval",
  "item/permissions/requestApproval",
]);
const USER_INPUT_REQUEST_METHODS = new Set([
  "item/tool/requestUserInput",
]);
const THREAD_EVENT_METHODS = new Set([
  "turn/started",
  "turn/completed",
  "codex/event/agent_message",
]);
const MAX_SENT_THREAD_EVENT_KEYS = 500;
const MAX_PENDING_APPROVAL_REQUESTS_PER_CHAT = 8;
const TELEGRAM_ACTIVITY_DEFAULT_LIMIT = 3;
const TELEGRAM_ACTIVITY_MORE_LIMIT = 8;
const TELEGRAM_ACTIVITY_MAX_LIMIT = 10;
const MAX_TELEGRAM_IMAGE_BYTES = 8 * 1024 * 1024;
const TELEGRAM_BUTTON_TEXT_MAX_CHARS = 64;
const TELEGRAM_BUTTON_TEXT_TRUNCATION_SUFFIX = "...";
const DEFAULT_TELEGRAM_IMAGE_PROMPT = "Please inspect the attached Telegram image.";
const TELEGRAM_SUBAGENTS_PROMPT = "Run subagents for different tasks. Delegate distinct work in parallel when helpful and then synthesize the results.";
const TELEGRAM_RETRY_AFTER_MS = 1_000;
const SINGLE_USE_TELEGRAM_ACTION_TYPES = new Set([
  "approval.accept",
  "approval.reject",
  "command.archive",
  "command.cancel_login",
  "command.checkpoint",
  "command.compact",
  "command.draft_commit",
  "command.draft_pr",
  "command.fork",
  "command.init",
  "command.new",
  "command.pr",
  "command.pull",
  "command.push",
  "command.review",
  "command.stash",
  "command.stash_pop",
  "command.stop",
  "command.title",
  "command.unlink",
  "checkpoint.restore_apply",
  "git.checkout",
  "git.reset_to_remote",
  "prefs.keep_awake",
  "project.new_thread",
  "runtime.access",
  "runtime.effort",
  "runtime.model",
  "runtime.service_tier",
  "thread.unarchive",
  "user_input.answer",
]);
const TELEGRAM_IMAGE_MIME_TYPES_BY_EXTENSION = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".heic", "image/heic"],
  [".heif", "image/heif"],
]);

function canLogoutFromAccountStatus(status = {}) {
  const accountStatus = String(status?.status ?? "").trim().toLowerCase();
  return status.tokenReady === true
    || accountStatus === "authenticated"
    || accountStatus === "signed_in"
    || accountStatus === "logged_in";
}

function createTelegramAdapter({
  botClient,
  sessionState = defaultSessionState,
  actionRegistry = createTelegramActionRegistry(),
  controlSurface = {},
  telegramAccess = describeTelegramAccess({}),
  botUsername = "",
  pollIntervalMs = 1_000,
  logger = console,
  now = () => Date.now(),
} = {}) {
  let stopped = false;
  let nextOffset = 0;
  let pollTimer = null;
  const telegramAccessState = normalizeTelegramAccessDescription(telegramAccess);
  const keyboards = createTelegramKeyboards({
    actionRegistry,
    telegramAccessModeFor,
    canLogoutFromAccountStatus,
  });
  const {
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
    makeActionButton,
  } = keyboards;
  const sentThreadEventKeys = new Map();
  const agentMessageTurns = new Map();
  const pendingUserInputRequestsByChat = new Map();
  const pendingApprovalRequestsByChat = new Map();
  let telegramBotUsername = normalizeTelegramBotUsername(botUsername);

  async function handleUpdate(update) {
    if (update?.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return;
    }
    if (update?.message) {
      await handleMessage(update.message);
    }
  }

  async function sendServerRequest(rawRequest) {
    const request = parseTelegramServerRequest(rawRequest);
    if (request) {
      return sendApprovalRequest(request);
    }

    const userInputRequest = parseTelegramUserInputRequest(rawRequest);
    if (userInputRequest) {
      return sendUserInputRequest(userInputRequest);
    }

    const event = parseTelegramThreadEvent(rawRequest);
    if (event) {
      return sendThreadEvent(event);
    }

    return false;
  }

  async function sendApprovalRequest(request) {
    if (!telegramAccessAllowed()) {
      return false;
    }
    const threadId = normalizeChatId(request.params?.threadId || request.params?.thread_id);
    if (!threadId) {
      return false;
    }
    const state = sessionState.read();
    const targetChats = (state?.linkedChats || []).filter((chat) => (
      normalizeChatId(chat.activeThreadId) === threadId
    ));
    if (targetChats.length === 0) {
      return false;
    }

    const text = renderTelegramApprovalRequest({
      method: request.method,
      params: request.params,
    });
    for (const linkedChat of targetChats) {
      if (telegramAccessModeFor(linkedChat) === "full-access") {
        await resolveTelegramApprovalAction({
          requestId: request.id,
          method: request.method,
          params: request.params,
        }, "accept");
        await botClient.sendMessage({
          chatId: linkedChat.chatId,
          text: "Auto-approved request because Telegram access mode is Full Access.",
        });
        continue;
      }
      await botClient.sendMessage({
        chatId: linkedChat.chatId,
        text,
        replyMarkup: buildApprovalReplyMarkup(linkedChat.chatId, request),
      });
      rememberPendingApprovalRequest(linkedChat.chatId, {
        request,
        threadId,
        rememberedAt: now(),
      });
    }
    return true;
  }

  async function sendUserInputRequest(request) {
    if (!telegramAccessAllowed()) {
      return false;
    }
    const threadId = normalizeChatId(request.params?.threadId || request.params?.thread_id);
    if (!threadId) {
      return false;
    }
    const state = sessionState.read();
    const targetChats = (state?.linkedChats || []).filter((chat) => (
      normalizeChatId(chat.activeThreadId) === threadId
    ));
    if (targetChats.length === 0) {
      return false;
    }

    const text = renderTelegramUserInputRequest({ params: request.params });
    const commandQuestions = telegramCommandAnswerQuestions(request.params);
    for (const linkedChat of targetChats) {
      if (commandQuestions.length > 0) {
        rememberPendingUserInputRequest(linkedChat.chatId, {
          request,
          questions: commandQuestions,
          threadId,
        });
      } else {
        forgetPendingUserInputRequest(linkedChat.chatId);
      }
      await botClient.sendMessage({
        chatId: linkedChat.chatId,
        text,
        replyMarkup: buildUserInputReplyMarkup(linkedChat.chatId, request),
      });
    }
    return true;
  }

  async function sendThreadEvent(event) {
    if (!telegramAccessAllowed()) {
      return false;
    }
    const text = renderTelegramThreadEvent({
      method: event.method,
      params: event.params,
    });
    if (!text) {
      return false;
    }

    const state = sessionState.read();
    const targetChats = (state?.linkedChats || []).filter((chat) => (
      normalizeChatId(chat.activeThreadId) === event.threadId
    ));
    if (targetChats.length === 0) {
      return false;
    }

    let didSend = false;
    for (const linkedChat of targetChats) {
      if (shouldSkipThreadEventForChat(linkedChat.chatId, event)) {
        continue;
      }
      await botClient.sendMessage({
        chatId: linkedChat.chatId,
        text,
        replyMarkup: buildThreadEventReplyMarkup(linkedChat.chatId, event),
      });
      rememberSentThreadEvent(linkedChat.chatId, event);
      didSend = true;
    }
    return didSend;
  }

  async function handleMessage(message) {
    const chat = message.chat || {};
    const chatId = normalizeChatId(chat.id);
    const text = readTelegramMessageText(message);
    if (isTelegramCommandAddressedToAnotherBot(text, telegramBotUsername)) {
      return;
    }
    const command = parseTelegramCommand(text);
    const attachments = readTelegramImageAttachments(message);
    const voiceAttachment = readTelegramVoiceAttachment(message);

    if (command.name === "link") {
      if (!command.arg) {
        await botClient.sendMessage({ chatId, text: renderTelegramLinkHelp() });
        return;
      }
      await linkChat({ chatId, chatTitle: chat.title || chat.username || "", code: command.arg });
      return;
    }

    const state = sessionState.read();
    const linkedChat = linkedChatFor(state, chatId);
    if (!linkedChat) {
      await botClient.sendMessage({
        chatId,
        text: command.name === "start" || command.name === "help"
          ? renderTelegramLinkHelp()
          : renderUnauthorizedTelegramChat(),
      });
      return;
    }

    try {
      if (!canUseTelegramCommandWithAccess(command.name, telegramAccessState)) {
        await sendTelegramAccessRequired(chatId);
        return;
      }
      switch (command.name) {
        case "help":
          await sendHelp(chatId, linkedChat, command.arg);
          return;
        case "start":
          await sendHelp(chatId, linkedChat);
          return;
        case "status":
          await sendStatus(chatId, linkedChat);
          return;
        case "menu":
          await sendActionMenu(chatId, linkedChat);
          return;
        case "account":
          await sendAccountStatus(chatId);
          return;
        case "limits":
          await sendRateLimits(chatId);
          return;
        case "usage":
          await sendUsageStatus(chatId, linkedChat);
          return;
        case "version":
          await sendVersionStatus(chatId);
          return;
        case "upgrade":
          await sendUpgradeStatus(chatId);
          return;
        case "feedback":
          await openFeedbackOnMac(chatId, linkedChat, command.arg);
          return;
        case "login":
          await openLoginOnMac(chatId);
          return;
        case "cancel_login":
          await cancelLoginOnMac(chatId);
          return;
        case "logout":
          await sendLogoutConfirmation(chatId);
          return;
        case "threads":
          await sendThreads(chatId, command.arg);
          return;
        case "resume":
          await resumeLastActiveThread(chatId);
          return;
        case "thread":
          await selectThread(chatId, command.arg);
          return;
        case "archived":
          await sendArchivedThreads(chatId, command.arg);
          return;
        case "archive":
          await archiveActiveThread(chatId, linkedChat);
          return;
        case "unarchive":
          await unarchiveThread(chatId, command.arg);
          return;
        case "rename":
          await renameActiveThread(chatId, linkedChat, command.arg);
          return;
        case "title":
          await generateActiveThreadTitle(chatId, linkedChat, command.arg);
          return;
        case "projects":
          await sendProjects(chatId, command.arg);
          return;
        case "browse":
          await sendProjectDirectory(chatId, command.arg);
          return;
        case "mkdir":
          await createProjectDirectory(chatId, linkedChat, command.arg);
          return;
        case "new":
          await createNewThread(chatId, linkedChat, command.arg);
          return;
        case "fork":
          await forkActiveThread(chatId, linkedChat);
          return;
        case "activity":
          await sendThreadActivity(chatId, linkedChat, command.arg);
          return;
        case "checkpoint":
          await captureWorkspaceCheckpoint(chatId, linkedChat);
          return;
        case "compact":
          await compactActiveThread(chatId, linkedChat);
          return;
        case "context":
          await sendContextWindow(chatId, linkedChat);
          return;
        case "open":
          await openActiveThreadOnMac(chatId, linkedChat);
          return;
        case "wake":
          await wakeMac(chatId);
          return;
        case "prefs":
          await sendPreferences(chatId);
          return;
        case "pets":
          await sendPets(chatId);
          return;
        case "skills":
          await sendSkills(chatId, linkedChat, command.arg);
          return;
        case "plugins":
          await sendPlugins(chatId, linkedChat, command.arg);
          return;
        case "model":
          await updateRuntimePreferences(chatId, linkedChat, command.arg);
          return;
        case "access":
          await updateAccessModePreference(chatId, linkedChat, command.arg);
          return;
        case "keep_awake":
          await updateKeepAwakePreference(chatId, command.arg);
          return;
        case "git":
          await sendGitStatus(chatId, linkedChat);
          return;
        case "init":
          await initGit(chatId, linkedChat);
          return;
        case "diff":
          await sendDiffSummary(chatId, linkedChat);
          return;
        case "log":
          await sendGitLog(chatId, linkedChat);
          return;
        case "remote":
          await sendGitRemote(chatId, linkedChat);
          return;
        case "branches":
          await sendBranches(chatId, linkedChat);
          return;
        case "branch":
          await createBranch(chatId, linkedChat, command.arg);
          return;
        case "worktree":
          await createWorktreeThread(chatId, linkedChat, command.arg);
          return;
        case "checkout":
          await checkoutBranch(chatId, linkedChat, command.arg);
          return;
        case "pull":
          await pullGit(chatId, linkedChat);
          return;
        case "reset_remote":
          await sendResetRemoteConfirmation(chatId, linkedChat);
          return;
        case "stash":
          await stashGit(chatId, linkedChat);
          return;
        case "stash_pop":
          await popGitStash(chatId, linkedChat);
          return;
        case "commit":
          await runGitStackedAction(chatId, linkedChat, "commit", command.arg);
          return;
        case "draft_commit":
          await generateCommitDraft(chatId, linkedChat);
          return;
        case "push":
          await runGitStackedAction(chatId, linkedChat, "push", command.arg);
          return;
        case "draft_pr":
          await generatePullRequestDraft(chatId, linkedChat);
          return;
        case "pr":
          await runGitStackedAction(chatId, linkedChat, "create_pr", command.arg);
          return;
        case "ship":
          await runGitStackedAction(chatId, linkedChat, "commit_push_pr", command.arg);
          return;
        case "review":
          await startCodeReview(chatId, linkedChat, command.arg);
          return;
        case "subagents":
          await sendSubagentsRequest(chatId, linkedChat, command.arg);
          return;
        case "stop":
          await stopActiveThread(chatId, linkedChat);
          return;
        case "pending":
          await sendPendingRequests(chatId, linkedChat);
          return;
        case "plan":
          await continueActiveThread(chatId, linkedChat, command.arg, {
            implicit: false,
            attachments,
            voiceAttachment,
            collaborationMode: "plan",
          });
          return;
        case "continue":
          await continueActiveThread(chatId, linkedChat, command.arg, { implicit: false, attachments, voiceAttachment });
          return;
        case "answer":
          await answerPendingUserInput(chatId, linkedChat, command.arg);
          return;
        case "unlink":
          await unlinkChat(chatId);
          return;
        default:
          if (command.name !== "unknown") {
            await botClient.sendMessage({
              chatId,
              text: `/${command.name} is listed in Remodex Telegram but is not wired in this bridge. Run /help or update Remodex.`,
            });
            return;
          }
          if (shouldAnswerPendingUserInputWithPlainText(chatId, linkedChat, text, attachments, voiceAttachment)) {
            await answerPendingUserInput(chatId, linkedChat, text);
            return;
          }
          if (shouldRouteUnknownMessageAsCodexInput(text, attachments, voiceAttachment)) {
            await continueActiveThread(chatId, linkedChat, text, { implicit: true, attachments, voiceAttachment });
            return;
          }
          await sendHelp(chatId, linkedChat);
      }
    } catch (error) {
      const commandName = command.name === "unknown" && shouldRouteUnknownMessageAsCodexInput(text, attachments, voiceAttachment)
        ? "continue"
        : command.name;
      await botClient.sendMessage({ chatId, text: renderCommandError(commandName, error) });
    }
  }

  async function linkChat({ chatId, chatTitle, code }) {
    try {
      sessionState.link({ chatId, chatTitle, code, now });
      await botClient.sendMessage({ chatId, text: "Linked this Telegram chat to Remodex." });
    } catch {
      await botClient.sendMessage({ chatId, text: "Invalid or expired Remodex Telegram link code." });
    }
  }

  async function unlinkChat(chatId) {
    sessionState.unlink({ chatId });
    await botClient.sendMessage({ chatId, text: "Unlinked this Telegram chat from Remodex." });
  }

  async function sendStatus(chatId, linkedChat) {
    const status = await controlSurface.readStatus?.();
    const statusText = renderTelegramStatus({
      bridgeStatus: status?.bridgeStatus,
      activeThread: await activeThreadFor(linkedChat),
    });
    await botClient.sendMessage({
      chatId,
      text: telegramAccessAllowed()
        ? statusText
        : `${statusText}\n\n${renderTelegramAccessRequired(telegramAccessState)}`,
      replyMarkup: telegramAccessAllowed()
        ? buildStatusReplyMarkup(chatId, linkedChat)
        : buildAccessRequiredReplyMarkup(chatId),
    });
  }

  async function sendActionMenu(chatId, linkedChat) {
    if (!telegramAccessAllowed()) {
      await sendTelegramAccessRequired(chatId);
      return;
    }
    const activeLabel = linkedChat?.activeThreadId ? "Active thread selected." : "No active thread selected.";
    await botClient.sendMessage({
      chatId,
      text: `Remodex hub\n${activeLabel}`,
      replyMarkup: buildHomeHubReplyMarkup(chatId, linkedChat),
    });
  }

  async function sendHub(chatId, linkedChat, hub) {
    const labels = {
      chat: "Chat hub",
      threads: "Threads hub",
      git: "Git hub",
      settings: "Settings hub",
      advanced: "Advanced (Mac)",
    };
    const builders = {
      chat: buildChatHubReplyMarkup,
      threads: buildThreadsHubReplyMarkup,
      git: buildGitHubReplyMarkup,
      settings: buildSettingsHubReplyMarkup,
      advanced: buildAdvancedMacHubReplyMarkup,
    };
    const build = builders[hub];
    if (!build) {
      await sendActionMenu(chatId, linkedChat);
      return;
    }
    await botClient.sendMessage({
      chatId,
      text: labels[hub],
      replyMarkup: build(chatId, linkedChat),
    });
  }

  async function sendHelp(chatId, linkedChat, topic = "") {
    const helpText = renderTelegramCommandHelp(topic);
    await botClient.sendMessage({
      chatId,
      text: telegramAccessAllowed()
        ? helpText
        : `${helpText}\n\n${renderTelegramAccessRequired(telegramAccessState)}`,
      replyMarkup: telegramAccessAllowed()
        ? buildActionMenuReplyMarkup(chatId, linkedChat)
        : buildAccessRequiredReplyMarkup(chatId),
    });
  }

  async function sendAccountStatus(chatId) {
    const status = await controlSurface.readAccountStatus?.();
    await botClient.sendMessage({
      chatId,
      text: renderTelegramAccountStatus(status),
      replyMarkup: buildAccountReplyMarkup(chatId, status),
    });
  }

  async function sendRateLimits(chatId) {
    const result = await controlSurface.readRateLimits?.();
    await botClient.sendMessage({
      chatId,
      text: renderTelegramRateLimits(result),
      replyMarkup: buildRateLimitsReplyMarkup(chatId),
    });
  }

  async function sendUsageStatus(chatId, linkedChat) {
    const result = await controlSurface.readUsageStatus?.({
      threadId: linkedChat?.activeThreadId,
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramUsageStatus(result),
      replyMarkup: buildUsageReplyMarkup(chatId, linkedChat),
    });
  }

  async function sendVersionStatus(chatId) {
    const status = await controlSurface.readVersionStatus?.();
    await botClient.sendMessage({
      chatId,
      text: renderTelegramVersionStatus(status),
      replyMarkup: buildVersionReplyMarkup(chatId),
    });
  }

  async function sendUpgradeStatus(chatId) {
    await botClient.sendMessage({
      chatId,
      text: renderTelegramUpgradeInfo(telegramAccessState),
      replyMarkup: buildUpgradeReplyMarkup(chatId),
    });
  }

  async function openFeedbackOnMac(chatId, linkedChat, message) {
    const result = await controlSurface.openFeedbackOnMac?.({
      message,
      threadId: linkedChat?.activeThreadId,
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramFeedbackResult(result),
      replyMarkup: buildFeedbackReplyMarkup(chatId),
    });
  }

  async function openLoginOnMac(chatId) {
    const result = await controlSurface.openLoginOnMac?.();
    await botClient.sendMessage({ chatId, text: renderTelegramLoginResult(result) });
  }

  async function cancelLoginOnMac(chatId) {
    const result = await controlSurface.cancelLoginOnMac?.();
    await botClient.sendMessage({
      chatId,
      text: renderTelegramCancelLoginResult(result),
      replyMarkup: buildAccountReplyMarkup(chatId, { loginInFlight: false }),
    });
  }

  async function sendLogoutConfirmation(chatId) {
    await botClient.sendMessage({
      chatId,
      text: renderTelegramLogoutConfirmation(),
      replyMarkup: buildLogoutConfirmationReplyMarkup(chatId),
    });
  }

  async function logoutOnMac(chatId) {
    const result = await controlSurface.logoutOnMac?.();
    await botClient.sendMessage({
      chatId,
      text: renderTelegramLogoutResult(result),
      replyMarkup: buildAccountReplyMarkup(chatId, { status: "signed_out", tokenReady: false }),
    });
  }

  async function sendThreads(chatId, query = "", page = 0) {
    const normalizedQuery = normalizeChatId(query);
    const threads = await listThreads({ query: normalizedQuery });
    const pageSize = 5;
    const pageItems = threads.slice(page * pageSize, (page + 1) * pageSize);
    const lines = pageItems.map((thread, index) => `${page * pageSize + index + 1}. ${threadTitle(thread)}`);
    await botClient.sendMessage({
      chatId,
      text: renderThreadsText({ lines, query: normalizedQuery }),
      replyMarkup: buildThreadChoiceReplyMarkup(chatId, threads, { page, query: normalizedQuery }),
    });
  }

  async function selectThread(chatId, rawIndex) {
    const threads = await listThreads();
    const rawChoice = normalizeChatId(rawIndex);
    const index = Number.parseInt(rawChoice, 10) - 1;
    if (/^\d+$/.test(rawChoice)) {
      const thread = threads[index];
      if (!thread?.id) {
        await botClient.sendMessage({ chatId, text: "Thread not found. Run /threads and choose a number." });
        return;
      }
      sessionState.setActiveThread({ chatId, threadId: thread.id, cwd: threadCwd(thread) });
      forgetPendingRequests(chatId);
      await botClient.sendMessage({
        chatId,
        text: `Active thread: ${threadTitle(thread)}`,
        replyMarkup: buildContinueReplyMarkup(chatId, {
          activeThreadId: thread.id,
          activeThreadCwd: threadCwd(thread),
        }),
      });
      return;
    }

    const explicitThreadId = normalizeExplicitThreadId(rawChoice);
    if (!explicitThreadId) {
      await botClient.sendMessage({ chatId, text: "Thread not found. Run /threads and choose a number." });
      return;
    }
    const thread = findThreadById(threads, explicitThreadId);
    sessionState.setActiveThread({ chatId, threadId: explicitThreadId, cwd: threadCwd(thread) });
    forgetPendingRequests(chatId);
    await botClient.sendMessage({
      chatId,
      text: `Active thread: ${thread ? threadTitle(thread) : explicitThreadId}`,
      replyMarkup: buildContinueReplyMarkup(chatId, {
        activeThreadId: explicitThreadId,
        activeThreadCwd: threadCwd(thread),
      }),
    });
  }

  async function resumeLastActiveThread(chatId) {
    const lastThread = await controlSurface.readLastActiveThread?.();
    const threadId = normalizeExplicitThreadId(lastThread?.threadId);
    if (!threadId) {
      await botClient.sendMessage({
        chatId,
        text: "No remembered Remodex thread found yet. Run /threads or /new.",
        replyMarkup: buildMissingThreadReplyMarkup(chatId),
      });
      return;
    }
    const thread = findThreadById(await listThreads(), threadId);
    const selected = {
      ...lastThread,
      ...thread,
      threadId,
      title: thread ? threadTitle(thread) : lastThread.title || threadId,
    };
    sessionState.setActiveThread({ chatId, threadId, cwd: threadCwd(thread) });
    forgetPendingRequests(chatId);
    await botClient.sendMessage({
      chatId,
      text: renderTelegramResumeResult(selected),
      replyMarkup: buildContinueReplyMarkup(chatId, {
        activeThreadId: threadId,
        activeThreadCwd: threadCwd(thread),
      }),
    });
  }

  async function sendArchivedThreads(chatId, query = "", page = 0) {
    const normalizedQuery = normalizeChatId(query);
    const threads = await listArchivedThreads({ query: normalizedQuery });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramArchivedThreads({ threads, query: normalizedQuery }),
      replyMarkup: buildArchivedThreadReplyMarkup(chatId, threads, { page, query: normalizedQuery }),
    });
  }

  async function archiveActiveThread(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const activeThread = await activeThreadFor(linkedChat);
    const result = await controlSurface.archiveThread?.({
      threadId: linkedChat.activeThreadId,
    });
    sessionState.clearActiveThread?.({ chatId });
    forgetPendingRequests(chatId);
    await botClient.sendMessage({
      chatId,
      text: renderTelegramArchiveResult({
        ...activeThread,
        ...result,
        title: result?.title || result?.name || activeThread?.title || linkedChat.activeThreadId,
      }),
      replyMarkup: buildArchivedActionReplyMarkup(chatId),
    });
  }

  async function unarchiveThread(chatId, rawChoice) {
    const archivedThreads = await listArchivedThreads();
    const thread = resolveThreadChoice(archivedThreads, rawChoice);
    if (!thread?.id) {
      await botClient.sendMessage({
        chatId,
        text: "Archived thread not found. Run /archived and choose a number.",
        replyMarkup: buildArchivedThreadReplyMarkup(chatId, archivedThreads),
      });
      return;
    }
    const result = await controlSurface.unarchiveThread?.({ threadId: thread.id });
    const restoredThread = {
      ...thread,
      ...result,
      id: thread.id,
      title: result?.title || result?.name || threadTitle(thread),
    };
    sessionState.setActiveThread({ chatId, threadId: thread.id, cwd: threadCwd(restoredThread) });
    forgetPendingRequests(chatId);
    await botClient.sendMessage({
      chatId,
      text: renderTelegramUnarchiveResult(restoredThread),
      replyMarkup: buildContinueReplyMarkup(chatId, {
        activeThreadId: thread.id,
        activeThreadCwd: threadCwd(restoredThread),
      }),
    });
  }

  async function renameActiveThread(chatId, linkedChat, title) {
    const normalizedTitle = normalizeChatId(title);
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    if (!normalizedTitle) {
      await botClient.sendMessage({ chatId, text: "Usage: /rename <title>" });
      return;
    }
    const result = await controlSurface.renameThread?.({
      threadId: linkedChat.activeThreadId,
      title: normalizedTitle,
    });
    await botClient.sendMessage({ chatId, text: renderTelegramRenameResult(result) });
  }

  async function answerPendingUserInput(chatId, linkedChat, answerText) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const answer = normalizeChatId(answerText);
    if (!answer) {
      await botClient.sendMessage({ chatId, text: "Usage: /answer <response>" });
      return;
    }

    const pending = readPendingUserInputRequest(chatId);
    if (!pending || !isActionThreadCurrent(linkedChat, pending.threadId)) {
      forgetPendingUserInputRequest(chatId);
      await botClient.sendMessage({
        chatId,
        text: "No pending Codex input prompt. Wait for Codex to ask, or open Remodex on the Mac.",
        replyMarkup: buildMissingPendingUserInputReplyMarkup(chatId, linkedChat),
      });
      return;
    }

    const answers = buildPendingUserInputAnswers(pending, answer);
    if (!answers) {
      await botClient.sendMessage({
        chatId,
        text: `Usage: ${pendingAnswerUsage(pending)}`,
      });
      return;
    }

    await resolveTelegramUserInputAction({
      requestId: pending.request.id,
      method: pending.request.method,
      params: pending.request.params,
      answers,
    });
    forgetPendingUserInputRequest(chatId);
    await botClient.sendMessage({
      chatId,
      text: "Answer sent to Codex.",
      replyMarkup: buildContinueReplyMarkup(chatId, linkedChat),
    });
  }

  async function sendPendingRequests(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return false;
    }
    let didReplay = false;

    const pending = readPendingUserInputRequest(chatId);
    if (pending && isActionThreadCurrent(linkedChat, pending.threadId)) {
      await botClient.sendMessage({
        chatId,
        text: renderTelegramUserInputRequest({ params: pending.request.params }),
        replyMarkup: buildUserInputReplyMarkup(chatId, pending.request),
      });
      didReplay = true;
    } else if (pending) {
      forgetPendingUserInputRequest(chatId);
    }

    const approvals = readPendingApprovalRequestsForThread(chatId, linkedChat);
    for (const approval of approvals) {
      await botClient.sendMessage({
        chatId,
        text: renderTelegramApprovalRequest({
          method: approval.request.method,
          params: approval.request.params,
        }),
        replyMarkup: buildApprovalReplyMarkup(chatId, approval.request),
      });
      didReplay = true;
    }

    if (!didReplay) {
      await botClient.sendMessage({
        chatId,
        text: "No pending Codex prompt or approval. Wait for Codex to ask, or open Remodex on the Mac.",
        replyMarkup: buildMissingPendingUserInputReplyMarkup(chatId, linkedChat),
      });
    }
    return didReplay;
  }

  async function generateActiveThreadTitle(chatId, linkedChat, message = "") {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const result = await controlSurface.generateThreadTitle?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
      message: normalizeChatId(message),
      runtimePreferences: telegramRuntimePreferencesFor(linkedChat),
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramGeneratedTitleResult(result),
      replyMarkup: buildContinueReplyMarkup(chatId, linkedChat),
    });
  }

  async function sendGitStatus(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const status = await controlSurface.readGitStatus?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
    });
    const replyMarkup = status?.isRepo === false && linkedChat?.activeThreadId
      ? buildGitInitReplyMarkup(chatId, linkedChat)
      : buildGitHubReplyMarkup(chatId, linkedChat);
    await botClient.sendMessage({ chatId, text: renderTelegramGitStatus(status), replyMarkup });
  }

  async function initGit(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const result = await controlSurface.initGit?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramGitInitResult(result),
      replyMarkup: buildContinueReplyMarkup(chatId, linkedChat),
    });
  }

  async function sendProjects(chatId, query = "", page = 0) {
    const normalizedQuery = normalizeChatId(query);
    const result = await controlSurface.listProjects?.({ query: normalizedQuery });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramProjects({ ...result, query: normalizedQuery }),
      replyMarkup: buildProjectChoiceReplyMarkup(chatId, result, { page, query: normalizedQuery }),
    });
  }

  async function sendProjectDirectory(chatId, projectPath = "", page = 0) {
    const result = await controlSurface.listProjectDirectory?.({ path: normalizeChatId(projectPath) });
    const browsePath = normalizeChatId(result?.path);
    if (sessionState.setProjectBrowsePath) {
      sessionState.setProjectBrowsePath({ chatId, path: browsePath });
    }
    await botClient.sendMessage({
      chatId,
      text: renderTelegramProjectDirectory(result),
      replyMarkup: buildProjectDirectoryReplyMarkup(chatId, result, { page }),
    });
  }

  async function sendProjectMkdirHelp(chatId, projectPath = "") {
    const browsePath = normalizeChatId(projectPath);
    if (sessionState.setProjectBrowsePath) {
      sessionState.setProjectBrowsePath({ chatId, path: browsePath });
    }
    const parentLabel = projectTitle({ path: browsePath }) || "the browsed folder";
    await botClient.sendMessage({
      chatId,
      text: `Create a child folder in ${parentLabel} with /mkdir <folder name>.`,
    });
  }

  async function createProjectDirectory(chatId, linkedChat, folderName = "") {
    const normalizedName = normalizeChatId(folderName);
    if (!normalizedName) {
      await botClient.sendMessage({ chatId, text: "Usage: /mkdir <folder name>" });
      return;
    }
    const parentPath = normalizeChatId(linkedChat?.projectBrowsePath || linkedChat?.activeThreadCwd);
    if (!parentPath) {
      await botClient.sendMessage({
        chatId,
        text: "Browse a folder with /browse or select an active thread before creating a folder.",
        replyMarkup: buildMissingThreadReplyMarkup(chatId),
      });
      return;
    }
    const result = await controlSurface.createProjectDirectory?.({
      parentPath,
      name: normalizedName,
    });
    if (sessionState.setProjectBrowsePath) {
      sessionState.setProjectBrowsePath({ chatId, path: result?.path });
    }
    await botClient.sendMessage({
      chatId,
      text: renderTelegramProjectCreateDirectoryResult(result),
      replyMarkup: buildCreatedProjectDirectoryReplyMarkup(chatId, result),
    });
  }

  async function createNewThread(chatId, linkedChat, cwd = "") {
    const selection = await createThreadSelection(chatId, linkedChat, cwd);
    await botClient.sendMessage({
      chatId,
      text: `New active thread: ${selection.title}`,
      replyMarkup: buildContinueReplyMarkup(chatId, selection),
    });
  }

  async function createThreadSelection(chatId, linkedChat = {}, cwd = "") {
    const result = await controlSurface.createThread?.({
      sourceThreadId: linkedChat.activeThreadId,
      sourceCwd: linkedChat.activeThreadCwd,
      cwd: normalizeChatId(cwd),
      runtimePreferences: telegramRuntimePreferencesFor(linkedChat),
    });
    const thread = result?.thread || result || {};
    const threadId = normalizeChatId(result?.threadId || thread.id || thread.threadId || thread.thread_id);
    if (!threadId) {
      throw new Error("thread/start response missing thread");
    }
    const cwdForThread = threadCwd(thread);
    sessionState.setActiveThread({ chatId, threadId, cwd: cwdForThread });
    forgetPendingRequests(chatId);
    return {
      ...linkedChat,
      activeThreadId: threadId,
      activeThreadCwd: cwdForThread,
      title: threadTitle({ ...thread, id: threadId }),
    };
  }

  async function forkActiveThread(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const result = await controlSurface.forkThread?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
      runtimePreferences: telegramRuntimePreferencesFor(linkedChat),
    });
    const thread = result?.thread || result || {};
    const threadId = normalizeChatId(result?.threadId || thread.id || thread.threadId || thread.thread_id);
    if (!threadId) {
      throw new Error("thread/fork response missing thread");
    }
    sessionState.setActiveThread({ chatId, threadId, cwd: threadCwd(thread) });
    forgetPendingRequests(chatId);
    await botClient.sendMessage({
      chatId,
      text: renderTelegramForkResult({ ...result, thread: { ...thread, id: threadId } }),
      replyMarkup: buildContinueReplyMarkup(chatId, {
        ...linkedChat,
        activeThreadId: threadId,
        activeThreadCwd: threadCwd(thread),
      }),
    });
  }

  async function sendContextWindow(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const result = await controlSurface.readContextWindow?.({
      threadId: linkedChat.activeThreadId,
    });
    await botClient.sendMessage({ chatId, text: renderTelegramContextWindow(result) });
  }

  async function sendThreadActivity(chatId, linkedChat, rawLimit) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const limit = normalizeTelegramActivityLimit(rawLimit);
    const result = await controlSurface.readThreadActivity?.({
      threadId: linkedChat.activeThreadId,
      limit,
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramThreadActivity(result),
      replyMarkup: buildThreadActivityReplyMarkup(chatId, linkedChat, limit),
    });
  }

  async function captureWorkspaceCheckpoint(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const result = await controlSurface.captureWorkspaceCheckpoint?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramCheckpointResult(result),
      replyMarkup: buildCheckpointReplyMarkup(chatId, linkedChat, result),
    });
  }

  async function previewWorkspaceCheckpointRestore(chatId, linkedChat, payload = {}) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const checkpointRef = normalizeChatId(payload.checkpointRef);
    if (!checkpointRef) {
      await botClient.sendMessage({
        chatId,
        text: "Checkpoint restore preview is unavailable for this checkpoint.",
        replyMarkup: buildContinueReplyMarkup(chatId, linkedChat),
      });
      return;
    }
    if (typeof controlSurface.previewWorkspaceCheckpointRestore !== "function") {
      await botClient.sendMessage({
        chatId,
        text: "Checkpoint restore preview is not available in this bridge.",
        replyMarkup: buildContinueReplyMarkup(chatId, linkedChat),
      });
      return;
    }
    const result = await controlSurface.previewWorkspaceCheckpointRestore({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
      checkpointRef,
    });
    const previewResult = {
      checkpointRef,
      ...result,
    };
    await botClient.sendMessage({
      chatId,
      text: renderTelegramCheckpointRestorePreview(previewResult),
      replyMarkup: buildCheckpointPreviewReplyMarkup(chatId, linkedChat, previewResult),
    });
  }

  async function applyWorkspaceCheckpointRestore(chatId, linkedChat, payload = {}) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const checkpointRef = normalizeChatId(payload.checkpointRef);
    if (!checkpointRef) {
      await botClient.sendMessage({
        chatId,
        text: "Checkpoint restore is unavailable for this checkpoint.",
        replyMarkup: buildContinueReplyMarkup(chatId, linkedChat),
      });
      return;
    }
    if (typeof controlSurface.applyWorkspaceCheckpointRestore !== "function") {
      await botClient.sendMessage({
        chatId,
        text: "Checkpoint restore is not available in this bridge.",
        replyMarkup: buildContinueReplyMarkup(chatId, linkedChat),
      });
      return;
    }
    const result = await controlSurface.applyWorkspaceCheckpointRestore({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
      checkpointRef,
      expectedTargetCommit: payload.expectedTargetCommit,
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramCheckpointRestoreApplyResult(result),
      replyMarkup: buildCheckpointAppliedReplyMarkup(chatId, linkedChat),
    });
  }

  async function compactActiveThread(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const result = await controlSurface.compactThread?.({
      threadId: linkedChat.activeThreadId,
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramCompactResult(result),
      replyMarkup: buildContinueReplyMarkup(chatId, linkedChat),
    });
  }

  async function openActiveThreadOnMac(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const result = await controlSurface.openThreadOnMac?.({
      threadId: linkedChat.activeThreadId,
    });
    await botClient.sendMessage({ chatId, text: renderTelegramOpenMacResult(result) });
  }

  async function wakeMac(chatId) {
    const result = await controlSurface.wakeMac?.();
    await botClient.sendMessage({ chatId, text: renderTelegramWakeMacResult(result) });
  }

  async function sendPreferences(chatId) {
    const result = await controlSurface.readPreferences?.();
    await botClient.sendMessage({
      chatId,
      text: renderTelegramPreferences(result),
      replyMarkup: buildPreferencesReplyMarkup(chatId),
    });
  }

  async function sendPets(chatId) {
    const result = await controlSurface.readPets?.();
    await botClient.sendMessage({
      chatId,
      text: renderTelegramPets(result),
      replyMarkup: buildPetsReplyMarkup(chatId),
    });
  }

  async function sendSkills(chatId, linkedChat, query = "") {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const result = await controlSurface.listSkills?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
      query: normalizeChatId(query),
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramSkills({ ...result, query: normalizeChatId(query) }),
      replyMarkup: buildDiscoveryReplyMarkup(chatId, linkedChat, "skills", normalizeChatId(query)),
    });
  }

  async function sendPlugins(chatId, linkedChat, query = "") {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const result = await controlSurface.listPlugins?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
      query: normalizeChatId(query),
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramPlugins({ ...result, query: normalizeChatId(query) }),
      replyMarkup: buildDiscoveryReplyMarkup(chatId, linkedChat, "plugins", normalizeChatId(query)),
    });
  }

  async function updateRuntimePreferences(chatId, linkedChat, rawValue = "") {
    const parsed = parseRuntimePreferenceCommand(rawValue, linkedChat);
    if (parsed.error) {
      await botClient.sendMessage({
        chatId,
        text: `${parsed.error}\n${renderTelegramModelPreferences(linkedChat)}`,
        replyMarkup: buildModelReplyMarkup(chatId, linkedChat),
      });
      return;
    }

    let nextPreferences = telegramRuntimePreferencesFor(linkedChat);
    if (parsed.changed) {
      const nextState = sessionState.setRuntimePreferences?.({
        chatId,
        model: parsed.model,
        reasoningEffort: parsed.reasoningEffort,
        serviceTier: parsed.serviceTier,
      });
      const nextLinkedChat = linkedChatFor(nextState, chatId) || {
        ...linkedChat,
        runtimeModel: parsed.model,
        reasoningEffort: parsed.reasoningEffort,
        runtimeServiceTier: parsed.serviceTier,
      };
      nextPreferences = telegramRuntimePreferencesFor(nextLinkedChat);
    }

    await botClient.sendMessage({
      chatId,
      text: renderTelegramModelPreferences(nextPreferences),
      replyMarkup: buildModelReplyMarkup(chatId, {
        ...linkedChat,
        runtimeModel: nextPreferences.model,
        reasoningEffort: nextPreferences.reasoningEffort,
        runtimeServiceTier: nextPreferences.serviceTier,
        runtimeAccessMode: nextPreferences.accessMode,
      }, { section: "summary" }),
    });
  }

  async function updateAccessModePreference(chatId, linkedChat, rawValue = "") {
    const parsed = parseAccessModePreference(rawValue, linkedChat);
    if (parsed.error) {
      await botClient.sendMessage({
        chatId,
        text: `${parsed.error}\n${renderTelegramModelPreferences(linkedChat)}`,
        replyMarkup: buildModelReplyMarkup(chatId, linkedChat),
      });
      return;
    }

    let nextLinkedChat = linkedChat;
    if (parsed.changed) {
      const runtime = normalizeTelegramRuntimePreferences(linkedChat);
      const nextState = sessionState.setRuntimePreferences?.({
        chatId,
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort,
        serviceTier: runtime.serviceTier,
        accessMode: parsed.accessMode,
      });
      nextLinkedChat = linkedChatFor(nextState, chatId) || {
        ...linkedChat,
        runtimeAccessMode: parsed.accessMode,
      };
    }

    await botClient.sendMessage({
      chatId,
      text: renderTelegramModelPreferences(nextLinkedChat),
      replyMarkup: buildModelReplyMarkup(chatId, nextLinkedChat, { section: "summary" }),
    });
  }

  async function updateKeepAwakePreference(chatId, rawValue) {
    const nextValue = parseKeepAwakePreference(rawValue);
    if (nextValue == null) {
      await botClient.sendMessage({ chatId, text: "Usage: /keep_awake <on|off>" });
      return;
    }
    const result = await controlSurface.updatePreferences?.({ keepMacAwake: nextValue });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramPreferences(result),
      replyMarkup: buildPreferencesReplyMarkup(chatId),
    });
  }

  async function sendDiffSummary(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const summary = await controlSurface.readGitDiffSummary?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
    });
    await botClient.sendMessage({ chatId, text: renderTelegramDiffSummary(summary) });
  }

  async function sendGitLog(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const log = await controlSurface.readGitLog?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
    });
    await botClient.sendMessage({ chatId, text: renderTelegramGitLog(log) });
  }

  async function sendGitRemote(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const remote = await controlSurface.readGitRemote?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
    });
    await botClient.sendMessage({ chatId, text: renderTelegramRemote(remote) });
  }

  async function sendBranches(chatId, linkedChat, page = 0) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const branches = await controlSurface.readGitBranches?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramBranches(branches),
      replyMarkup: buildBranchesReplyMarkup(chatId, linkedChat, branches, { page }),
    });
  }

  async function checkoutBranch(chatId, linkedChat, branch) {
    const normalizedBranch = normalizeChatId(branch);
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    if (!normalizedBranch) {
      await botClient.sendMessage({ chatId, text: "Usage: /checkout <branch>" });
      return;
    }
    const result = await controlSurface.checkoutBranch?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
      branch: normalizedBranch,
    });
    await botClient.sendMessage({ chatId, text: renderTelegramCheckoutResult(result) });
  }

  async function createBranch(chatId, linkedChat, branchName) {
    const normalizedBranchName = normalizeChatId(branchName);
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    if (!normalizedBranchName) {
      await botClient.sendMessage({ chatId, text: "Usage: /branch <name>" });
      return;
    }
    const result = await controlSurface.createBranch?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
      name: normalizedBranchName,
    });
    await botClient.sendMessage({ chatId, text: renderTelegramCreateBranchResult(result) });
  }

  async function createWorktreeThread(chatId, linkedChat, branchName) {
    const normalizedBranchName = normalizeChatId(branchName);
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    if (!normalizedBranchName) {
      await botClient.sendMessage({ chatId, text: "Usage: /worktree <branch>" });
      return;
    }
    const result = await controlSurface.createWorktreeThread?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
      branch: normalizedBranchName,
      runtimePreferences: telegramRuntimePreferencesFor(linkedChat),
    });
    const thread = result?.thread || {};
    const threadId = normalizeChatId(result?.threadId || thread.id || thread.threadId || thread.thread_id);
    if (!threadId) {
      throw new Error("worktree thread response missing thread");
    }
    sessionState.setActiveThread({ chatId, threadId, cwd: threadCwd(thread) || result?.worktree?.worktreePath });
    forgetPendingRequests(chatId);
    await botClient.sendMessage({
      chatId,
      text: renderTelegramWorktreeThreadResult(result),
      replyMarkup: buildContinueReplyMarkup(chatId, {
        ...linkedChat,
        activeThreadId: threadId,
        activeThreadCwd: threadCwd(thread) || result?.worktree?.worktreePath,
      }),
    });
  }

  async function pullGit(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const result = await controlSurface.pullGit?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
    });
    await botClient.sendMessage({ chatId, text: renderTelegramPullResult(result) });
  }

  async function sendResetRemoteConfirmation(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const status = await controlSurface.readGitStatus?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramResetRemoteConfirmation(status),
      replyMarkup: status?.isRepo === false
        ? buildGitInitReplyMarkup(chatId, linkedChat)
        : buildResetRemoteConfirmationReplyMarkup(chatId, linkedChat),
    });
  }

  async function resetGitToRemote(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    if (typeof controlSurface.resetGitToRemote !== "function") {
      await botClient.sendMessage({
        chatId,
        text: "Reset to remote is not available in this bridge.",
        replyMarkup: buildContinueReplyMarkup(chatId, linkedChat),
      });
      return;
    }
    const result = await controlSurface.resetGitToRemote({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramResetRemoteResult(result),
      replyMarkup: buildContinueReplyMarkup(chatId, linkedChat),
    });
  }

  async function stashGit(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const result = await controlSurface.stashGit?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
    });
    await botClient.sendMessage({ chatId, text: renderTelegramStashResult(result) });
  }

  async function popGitStash(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const result = await controlSurface.popGitStash?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
    });
    await botClient.sendMessage({ chatId, text: renderTelegramStashPopResult(result) });
  }

  async function runGitStackedAction(chatId, linkedChat, action, text) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }

    const trimmedText = typeof text === "string" ? text.trim() : "";
    if ((action === "commit" || action === "commit_push_pr") && !trimmedText) {
      await botClient.sendMessage({
        chatId,
        text: action === "commit"
          ? "Usage: /commit <message>"
          : "Usage: /ship <commit message>",
      });
      return;
    }

    const result = await controlSurface.runGitAction?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
      action,
      message: trimmedText,
    });
    await botClient.sendMessage({ chatId, text: renderTelegramStackedActionResult(result) });
  }

  async function generateCommitDraft(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const result = await controlSurface.generateCommitDraft?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
      runtimePreferences: telegramRuntimePreferencesFor(linkedChat),
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramCommitDraft(result),
      replyMarkup: buildDraftCommitReplyMarkup(chatId, linkedChat, result),
    });
  }

  async function generatePullRequestDraft(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const result = await controlSurface.generatePullRequestDraft?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
      runtimePreferences: telegramRuntimePreferencesFor(linkedChat),
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramPullRequestDraft(result),
      replyMarkup: buildDraftPullRequestReplyMarkup(chatId, linkedChat),
    });
  }

  async function startCodeReview(chatId, linkedChat, rawTarget = "") {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }

    const parsed = parseReviewTargetCommand(rawTarget);
    if (parsed.needsHelp) {
      await botClient.sendMessage({
        chatId,
        text: "Usage: /review <changes|base <branch>>",
        replyMarkup: buildReviewReplyMarkup(chatId, linkedChat),
      });
      return;
    }
    if (parsed.error) {
      await botClient.sendMessage({
        chatId,
        text: `${parsed.error}\nUsage: /review <changes|base <branch>>`,
        replyMarkup: buildReviewReplyMarkup(chatId, linkedChat),
      });
      return;
    }

    const result = await controlSurface.startReview?.({
      threadId: linkedChat.activeThreadId,
      cwd: linkedChat.activeThreadCwd,
      target: parsed.target,
      baseBranch: parsed.baseBranch,
      runtimePreferences: telegramRuntimePreferencesFor(linkedChat),
    });
    await botClient.sendMessage({
      chatId,
      text: renderTelegramReviewStartResult({
        ...result,
        target: result?.target || {
          type: parsed.target,
          branch: parsed.baseBranch,
        },
      }),
      replyMarkup: buildContinueReplyMarkup(chatId, linkedChat),
    });
  }

  async function stopActiveThread(chatId, linkedChat) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    await controlSurface.stopThread?.(linkedChat.activeThreadId);
    await botClient.sendMessage({ chatId, text: "Stop requested for the active Remodex thread." });
  }

  async function sendSubagentsRequest(chatId, linkedChat, task) {
    if (!await requireActiveThread(chatId, linkedChat)) {
      return;
    }
    const trimmedTask = typeof task === "string" ? task.trim() : "";
    if (!trimmedTask) {
      await sendSubagentsHelp(chatId, linkedChat);
      return;
    }
    await continueActiveThread(chatId, linkedChat, `${TELEGRAM_SUBAGENTS_PROMPT}\n\nTask: ${trimmedTask}`, {
      implicit: false,
      confirmationText: "Sent subagent delegation request to the active Remodex thread.",
    });
  }

  async function sendSubagentsHelp(chatId, linkedChat) {
    await botClient.sendMessage({
      chatId,
      text: "Delegate parallel work with /subagents <task>.",
      replyMarkup: linkedChat?.activeThreadId ? buildContinueReplyMarkup(chatId, linkedChat) : buildMissingThreadReplyMarkup(chatId),
    });
  }

  async function continueActiveThread(chatId, linkedChat, text, {
    implicit = false,
    attachments = [],
    voiceAttachment = null,
    collaborationMode = "",
    confirmationText = "",
  } = {}) {
    const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
    const hasAttachments = normalizedAttachments.length > 0;
    const hasVoice = Boolean(voiceAttachment);
    let trimmedText = typeof text === "string" ? text.trim() : "";
    if (!trimmedText && !hasAttachments && !hasVoice) {
      await botClient.sendMessage({
        chatId,
        text: collaborationMode === "plan"
          ? "Usage: /plan <message>"
          : implicit
          ? "Send a text message or choose an active Remodex thread first."
          : "Usage: /continue <message>",
      });
      return;
    }
    if (!linkedChat.activeThreadId) {
      const nextLinkedChat = await createThreadSelection(chatId, linkedChat);
      await continueActiveThread(chatId, nextLinkedChat, trimmedText, {
        implicit,
        attachments: normalizedAttachments,
        voiceAttachment,
        collaborationMode,
        confirmationText: confirmationText || (collaborationMode === "plan"
          ? `Created new active thread: ${nextLinkedChat.title}\nSent plan-mode request to the active Remodex thread.`
          : `Created new active thread: ${nextLinkedChat.title}\nSent to the active Remodex thread.`),
      });
      return;
    }
    const inputAttachments = await downloadTelegramInputAttachments(normalizedAttachments);
    if (voiceAttachment) {
      const transcript = await transcribeTelegramVoiceAttachment(voiceAttachment);
      trimmedText = trimmedText
        ? `${trimmedText}\n\nVoice transcript: ${transcript}`
        : transcript;
    }
    if (!trimmedText && inputAttachments.length > 0) {
      trimmedText = DEFAULT_TELEGRAM_IMAGE_PROMPT;
    }
    await controlSurface.continueThread?.({
      threadId: linkedChat.activeThreadId,
      text: trimmedText,
      attachments: inputAttachments,
      runtimePreferences: telegramRuntimePreferencesFor(linkedChat),
      collaborationMode,
    });
    await botClient.sendMessage({
      chatId,
      text: confirmationText || (collaborationMode === "plan"
        ? "Sent plan-mode request to the active Remodex thread."
        : "Sent to the active Remodex thread."),
      replyMarkup: buildContinueReplyMarkup(chatId, linkedChat),
      });
  }

  async function transcribeTelegramVoiceAttachment(attachment) {
    if (typeof controlSurface.transcribeVoice !== "function") {
      throw new Error("Telegram voice transcription is not available in this bridge.");
    }
    if (typeof botClient?.getFile !== "function" || typeof botClient?.downloadFile !== "function") {
      throw new Error("Telegram voice downloads are not available in this bridge.");
    }
    const file = await botClient.getFile({ fileId: attachment.fileId });
    const filePath = normalizeChatId(file?.file_path || file?.filePath);
    if (!filePath) {
      throw new Error("Telegram voice file path missing.");
    }
    const downloaded = await botClient.downloadFile({ filePath });
    const data = Buffer.isBuffer(downloaded)
      ? downloaded
      : Buffer.from(downloaded?.data || []);
    const result = await controlSurface.transcribeVoice({
      audioData: data,
      mimeType: attachment.mimeType || downloaded?.contentType || "audio/ogg",
      durationMs: attachment.durationMs,
    });
    const text = normalizeChatId(result?.text);
    if (!text) {
      throw new Error("Telegram voice transcription returned no text.");
    }
    return text;
  }

  async function downloadTelegramInputAttachments(attachments) {
    if (attachments.length === 0) {
      return [];
    }
    if (typeof botClient?.getFile !== "function" || typeof botClient?.downloadFile !== "function") {
      throw new Error("Telegram image downloads are not available in this bridge.");
    }

    const inputItems = [];
    for (const attachment of attachments) {
      const file = await botClient.getFile({ fileId: attachment.fileId });
      const filePath = normalizeChatId(file?.file_path || file?.filePath);
      if (!filePath) {
        throw new Error("Telegram image file path missing.");
      }
      const downloaded = await botClient.downloadFile({ filePath });
      const data = Buffer.isBuffer(downloaded)
        ? downloaded
        : Buffer.from(downloaded?.data || []);
      if (data.byteLength > MAX_TELEGRAM_IMAGE_BYTES) {
        throw new Error("Telegram image is too large for Remodex input. Send an image under 8 MB.");
      }
      const mimeType = normalizeTelegramImageMimeType(
        attachment.mimeType,
        downloaded?.contentType,
        filePath
      );
      if (!isSupportedTelegramImageMimeType(mimeType)) {
        throw new Error("Only Telegram image attachments can be sent to Remodex.");
      }
      inputItems.push({
        type: "input_image",
        image_url: `data:${mimeType};base64,${data.toString("base64")}`,
      });
    }
    return inputItems;
  }

  async function handleCallbackQuery(callbackQuery) {
    const chatId = normalizeChatId(callbackQuery.message?.chat?.id);
    const state = sessionState.read();
    const linkedChat = linkedChatFor(state, chatId);
    if (!linkedChat) {
      await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Chat not linked." });
      return;
    }
    try {
      const action = actionRegistry.consumeAction(callbackQuery.data, { chatId, now });
      if (!canUseTelegramActionWithAccess(action.type, telegramAccessState)) {
        await sendTelegramAccessRequired(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Requires Remodex Pro." });
        return;
      }
      if (action.type === "thread.select") {
        await selectThreadById(chatId, action.payload?.threadId, action.payload?.title);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread selected." });
        return;
      }
      if (action.type === "command.status") {
        await sendStatus(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Status refreshed." });
        return;
      }
      if (action.type === "command.menu") {
        await sendActionMenu(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Menu opened." });
        return;
      }
      if (action.type === "hub.open") {
        await sendHub(chatId, linkedChat, normalizeChatId(action.payload?.hub));
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Hub opened." });
        return;
      }
      if (action.type === "picker.page") {
        const listType = normalizeChatId(action.payload?.listType);
        const page = Number.parseInt(String(action.payload?.page ?? "0"), 10) || 0;
        if (listType === "threads") {
          await sendThreads(chatId, action.payload?.query, page);
        } else if (listType === "archived") {
          await sendArchivedThreads(chatId, action.payload?.query, page);
        } else if (listType === "projects") {
          await sendProjects(chatId, action.payload?.query, page);
        } else if (listType === "browse") {
          await sendProjectDirectory(chatId, action.payload?.path, page);
        } else if (listType === "branches") {
          await sendBranches(chatId, linkedChat, page);
        } else if (listType === "model") {
          await botClient.sendMessage({
            chatId,
            text: renderTelegramModelPreferences(linkedChat),
            replyMarkup: buildModelPickerReplyMarkup(chatId, linkedChat, {
              page,
              section: normalizeChatId(action.payload?.section) || "model",
            }),
          });
        }
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Page updated." });
        return;
      }
      if (action.type === "runtime.model_picker") {
        const section = normalizeChatId(action.payload?.section) || "model";
        const page = Number.parseInt(String(action.payload?.page ?? "0"), 10) || 0;
        await botClient.sendMessage({
          chatId,
          text: renderTelegramModelPreferences(linkedChat),
          replyMarkup: buildModelPickerReplyMarkup(chatId, linkedChat, { page, section }),
        });
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Picker opened." });
        return;
      }
      if (action.type === "command.threads") {
        await sendThreads(chatId, action.payload?.query);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Threads opened." });
        return;
      }
      if (action.type === "command.resume") {
        await resumeLastActiveThread(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Last active thread selected." });
        return;
      }
      if (action.type === "command.archived") {
        await sendArchivedThreads(chatId, action.payload?.query);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Archived opened." });
        return;
      }
      if (action.type === "command.archive") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await archiveActiveThread(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread archived." });
        return;
      }
      if (action.type === "thread.unarchive") {
        await unarchiveThread(chatId, action.payload?.threadId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread restored." });
        return;
      }
      if (action.type === "command.projects") {
        await sendProjects(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Projects opened." });
        return;
      }
      if (action.type === "command.browse") {
        await sendProjectDirectory(chatId, action.payload?.path);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Folders opened." });
        return;
      }
      if (action.type === "command.new") {
        await createNewThread(chatId, {
          ...linkedChat,
          activeThreadId: action.payload?.sourceThreadId || linkedChat.activeThreadId,
        }, action.payload?.cwd);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "New thread created." });
        return;
      }
      if (action.type === "command.fork") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await forkActiveThread(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread forked." });
        return;
      }
      if (action.type === "project.new_thread") {
        await createNewThread(chatId, linkedChat, action.payload?.cwd);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "New project thread created." });
        return;
      }
      if (action.type === "project.browse") {
        await sendProjectDirectory(chatId, action.payload?.path);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Folder opened." });
        return;
      }
      if (action.type === "project.mkdir_help") {
        await sendProjectMkdirHelp(chatId, action.payload?.path);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Folder usage sent." });
        return;
      }
      if (action.type === "command.account") {
        await sendAccountStatus(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Account refreshed." });
        return;
      }
      if (action.type === "command.limits") {
        await sendRateLimits(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Limits refreshed." });
        return;
      }
      if (action.type === "command.usage") {
        if (action.payload?.threadId && !await requireActionThreadCurrent(callbackQuery, linkedChat, action, "/status")) {
          return;
        }
        await sendUsageStatus(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Usage refreshed." });
        return;
      }
      if (action.type === "command.version") {
        await sendVersionStatus(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Version refreshed." });
        return;
      }
      if (action.type === "command.upgrade") {
        await sendUpgradeStatus(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Entitlement shown." });
        return;
      }
      if (action.type === "command.feedback") {
        await openFeedbackOnMac(chatId, linkedChat, "");
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Feedback opened." });
        return;
      }
      if (action.type === "command.login") {
        await openLoginOnMac(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Login opened." });
        return;
      }
      if (action.type === "command.cancel_login") {
        await cancelLoginOnMac(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Login cancelled." });
        return;
      }
      if (action.type === "command.logout") {
        if (action.payload?.confirm === true) {
          await logoutOnMac(chatId);
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Signed out." });
          return;
        }
        await sendLogoutConfirmation(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Confirm sign-out." });
        return;
      }
      if (action.type === "command.context") {
        if (!await requireActionThreadCurrent(callbackQuery, linkedChat, action, "/status")) {
          return;
        }
        await sendContextWindow(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Context refreshed." });
        return;
      }
      if (action.type === "command.activity") {
        if (!await requireActionThreadCurrent(callbackQuery, linkedChat, action, "/status")) {
          return;
        }
        await sendThreadActivity(chatId, linkedChat, action.payload?.limit);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Activity refreshed." });
        return;
      }
      if (action.type === "command.pending") {
        if (!await requireActionThreadCurrent(callbackQuery, linkedChat, action, "/status")) {
          return;
        }
        const didReplay = await sendPendingRequests(chatId, linkedChat);
        await botClient.answerCallbackQuery({
          callbackQueryId: callbackQuery.id,
          text: didReplay ? "Pending prompt reopened." : "No pending prompt.",
        });
        return;
      }
      if (action.type === "command.checkpoint") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await captureWorkspaceCheckpoint(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Checkpoint captured." });
        return;
      }
      if (action.type === "checkpoint.restore_preview") {
        if (!await requireActionThreadCurrent(callbackQuery, linkedChat, action, "/status")) {
          return;
        }
        await previewWorkspaceCheckpointRestore(chatId, linkedChat, action.payload);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Restore preview sent." });
        return;
      }
      if (action.type === "checkpoint.restore_apply") {
        if (!await requireActionThreadCurrent(callbackQuery, linkedChat, action, "/status")) {
          return;
        }
        await applyWorkspaceCheckpointRestore(chatId, linkedChat, action.payload);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Checkpoint restored." });
        return;
      }
      if (action.type === "command.compact") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await compactActiveThread(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Compaction started." });
        return;
      }
      if (action.type === "command.open") {
        if (!await requireActionThreadCurrent(callbackQuery, linkedChat, action, "/status")) {
          return;
        }
        await openActiveThreadOnMac(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Mac handoff requested." });
        return;
      }
      if (action.type === "command.wake") {
        await wakeMac(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Wake requested." });
        return;
      }
      if (action.type === "command.prefs") {
        await sendPreferences(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Preferences opened." });
        return;
      }
      if (action.type === "command.pets") {
        await sendPets(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Pets listed." });
        return;
      }
      if (action.type === "command.skills") {
        if (!await requireActionThreadCurrent(callbackQuery, linkedChat, action, "/status")) {
          return;
        }
        await sendSkills(chatId, linkedChat, action.payload?.query);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Skills listed." });
        return;
      }
      if (action.type === "command.plugins") {
        if (!await requireActionThreadCurrent(callbackQuery, linkedChat, action, "/status")) {
          return;
        }
        await sendPlugins(chatId, linkedChat, action.payload?.query);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Plugins listed." });
        return;
      }
      if (action.type === "command.model") {
        await updateRuntimePreferences(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Runtime opened." });
        return;
      }
      if (action.type === "command.access") {
        await updateAccessModePreference(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Access opened." });
        return;
      }
      if (action.type === "runtime.model") {
        await updateRuntimePreferences(chatId, linkedChat, action.payload?.model);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Model updated." });
        return;
      }
      if (action.type === "runtime.effort") {
        await updateRuntimePreferences(chatId, linkedChat, action.payload?.reasoningEffort);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Reasoning updated." });
        return;
      }
      if (action.type === "runtime.service_tier") {
        await updateRuntimePreferences(chatId, linkedChat, action.payload?.serviceTier);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Speed updated." });
        return;
      }
      if (action.type === "runtime.access") {
        await updateAccessModePreference(chatId, linkedChat, action.payload?.accessMode);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Access updated." });
        return;
      }
      if (action.type === "prefs.keep_awake") {
        await updateKeepAwakePreference(chatId, action.payload?.value ? "on" : "off");
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Preference updated." });
        return;
      }
      if (action.type === "command.git") {
        if (!await requireActionThreadCurrent(callbackQuery, linkedChat, action, "/status")) {
          return;
        }
        await sendGitStatus(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Git refreshed." });
        return;
      }
      if (action.type === "command.init") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await initGit(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Git initialized." });
        return;
      }
      if (action.type === "command.diff") {
        if (!await requireActionThreadCurrent(callbackQuery, linkedChat, action, "/status")) {
          return;
        }
        await sendDiffSummary(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Diff refreshed." });
        return;
      }
      if (action.type === "command.log") {
        if (!await requireActionThreadCurrent(callbackQuery, linkedChat, action, "/status")) {
          return;
        }
        await sendGitLog(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Log refreshed." });
        return;
      }
      if (action.type === "command.remote") {
        if (!await requireActionThreadCurrent(callbackQuery, linkedChat, action, "/status")) {
          return;
        }
        await sendGitRemote(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Remote refreshed." });
        return;
      }
      if (action.type === "command.branches") {
        if (!await requireActionThreadCurrent(callbackQuery, linkedChat, action, "/status")) {
          return;
        }
        await sendBranches(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Branches refreshed." });
        return;
      }
      if (action.type === "command.pull") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await pullGit(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Pull requested." });
        return;
      }
      if (action.type === "command.reset_remote") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await sendResetRemoteConfirmation(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Reset confirmation sent." });
        return;
      }
      if (action.type === "git.reset_to_remote") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await resetGitToRemote(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Reset complete." });
        return;
      }
      if (action.type === "command.stash") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await stashGit(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Stash requested." });
        return;
      }
      if (action.type === "command.stash_pop") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await popGitStash(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Stash pop requested." });
        return;
      }
      if (action.type === "command.push") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await runGitStackedAction(chatId, linkedChat, "push", "");
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Push requested." });
        return;
      }
      if (action.type === "command.pr") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await runGitStackedAction(chatId, linkedChat, "create_pr", "");
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "PR requested." });
        return;
      }
      if (action.type === "command.title") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await generateActiveThreadTitle(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Title generated." });
        return;
      }
      if (action.type === "command.draft_commit") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await generateCommitDraft(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Commit draft generated." });
        return;
      }
      if (action.type === "command.draft_pr") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await generatePullRequestDraft(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "PR draft generated." });
        return;
      }
      if (action.type === "command.review") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await startCodeReview(chatId, linkedChat, normalizeChatId(action.payload?.target) || "changes");
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Review started." });
        return;
      }
      if (action.type === "command.help") {
        await sendHelp(chatId, linkedChat, action.payload?.topic);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Help sent." });
        return;
      }
      if (action.type === "command.unlink") {
        await unlinkChat(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Chat unlinked." });
        return;
      }
      if (action.type === "git.checkout") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /branches." });
          return;
        }
        await checkoutBranch(chatId, linkedChat, action.payload?.branch);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Branch checkout requested." });
        return;
      }
      if (action.type === "command.stop") {
        if (!isActionThreadCurrent(linkedChat, action.payload?.threadId)) {
          await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Thread changed. Run /status." });
          return;
        }
        await stopActiveThread(chatId, linkedChat);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Stop requested." });
        return;
      }
      if (action.type === "approval.accept") {
        await resolveTelegramApprovalAction(action.payload, "accept");
        forgetPendingApprovalRequest(chatId, action.payload?.requestId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Approval sent." });
        return;
      }
      if (action.type === "approval.reject") {
        await resolveTelegramApprovalAction(action.payload, "decline");
        forgetPendingApprovalRequest(chatId, action.payload?.requestId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Rejection sent." });
        return;
      }
      if (action.type === "user_input.answer") {
        await resolveTelegramUserInputAction(action.payload);
        forgetPendingUserInputRequest(chatId);
        await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Answer sent." });
        return;
      }
      await botClient.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Unsupported action." });
    } catch (error) {
      await botClient.answerCallbackQuery({
        callbackQueryId: callbackQuery.id,
        text: telegramCallbackErrorText(error, telegramAccessState),
      });
    }
  }

  function telegramCallbackErrorText(error, access = telegramAccessState) {
    const message = normalizeChatId(error?.message);
    const recoveryCommand = isTelegramAccessAllowed(access) ? "/menu" : "/help or /upgrade";
    if (/already used/i.test(message)) {
      return message;
    }
    if (/not allowed for this chat/i.test(message)) {
      return `Button unavailable. Run ${recoveryCommand}.`;
    }
    if (/Unknown Telegram action|Invalid Telegram action callback|Telegram action expired/i.test(message)) {
      return `Button expired. Run ${recoveryCommand}.`;
    }
    return truncateTelegramCallbackText(message || `Button expired. Run ${recoveryCommand}.`);
  }

  function truncateTelegramCallbackText(text) {
    const normalized = normalizeChatId(text);
    return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
  }

  async function resolveTelegramApprovalAction(payload, decision) {
    if (typeof controlSurface.resolveApproval !== "function") {
      throw new Error("Telegram approval replies are not available on this bridge.");
    }
    return controlSurface.resolveApproval(payload, decision);
  }

  async function resolveTelegramUserInputAction(payload) {
    if (typeof controlSurface.resolveUserInput !== "function") {
      throw new Error("Telegram input replies are not available on this bridge.");
    }
    return controlSurface.resolveUserInput(payload);
  }

  async function requireActionThreadCurrent(callbackQuery, linkedChat, action, refreshCommand = "/status") {
    const threadId = normalizeChatId(action?.payload?.threadId);
    if (!threadId || isActionThreadCurrent(linkedChat, threadId)) {
      return true;
    }
    await botClient.answerCallbackQuery({
      callbackQueryId: callbackQuery.id,
      text: `Thread changed. Run ${refreshCommand}.`,
    });
    return false;
  }

  async function start() {
    stopped = false;
    await refreshTelegramBotIdentity();
    await registerCommandMenu();
    await pollOnce();
  }

  function stop() {
    stopped = true;
    pendingUserInputRequestsByChat.clear();
    pendingApprovalRequestsByChat.clear();
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  async function pollOnce() {
    if (stopped || !botClient?.getUpdates) {
      return;
    }
    let nextPollDelayMs = pollIntervalMs;
    try {
      const updates = await botClient.getUpdates({ offset: nextOffset, timeout: 20, limit: 100 });
      await processTelegramUpdates(updates);
    } catch (error) {
      nextPollDelayMs = telegramPollRetryDelayMs(error, pollIntervalMs);
      logger.warn?.(`[remodex] Telegram polling failed: ${error.message}`);
    }
    if (!stopped) {
      pollTimer = setTimeout(() => { void pollOnce(); }, nextPollDelayMs);
      pollTimer.unref?.();
    }
  }

  async function processTelegramUpdates(updates = []) {
    for (const update of updates || []) {
      const nextUpdateOffset = Number.isInteger(update?.update_id)
        ? update.update_id + 1
        : null;
      try {
        await handleUpdate(update);
      } catch (error) {
        logger.warn?.(`[remodex] Telegram update handling failed: ${error.message}`);
      } finally {
        if (nextUpdateOffset != null) {
          nextOffset = Math.max(nextOffset, nextUpdateOffset);
        }
      }
    }
  }

  async function listThreads({ query = "" } = {}) {
    return await controlSurface.listThreads?.({ query }) || [];
  }

  async function listArchivedThreads({ query = "" } = {}) {
    return await controlSurface.listArchivedThreads?.({ query }) || [];
  }

  function resolveThreadChoice(threads, rawChoice) {
    const normalizedChoice = normalizeChatId(rawChoice);
    if (/^\d+$/.test(normalizedChoice)) {
      return threads[Number.parseInt(normalizedChoice, 10) - 1] || null;
    }
    const explicitThreadId = normalizeExplicitThreadId(normalizedChoice);
    if (!explicitThreadId) {
      return null;
    }
    return findThreadById(threads, explicitThreadId) || { id: explicitThreadId, title: explicitThreadId };
  }

  async function activeThreadFor(linkedChat) {
    if (!linkedChat?.activeThreadId) {
      return null;
    }
    const activeThreadId = normalizeChatId(linkedChat.activeThreadId);
    return findThreadById(await listThreads(), activeThreadId) || { id: activeThreadId, title: activeThreadId };
  }

  async function requireActiveThread(chatId, linkedChat) {
    if (linkedChat?.activeThreadId) {
      return true;
    }
    await botClient.sendMessage({
      chatId,
      text: "No active Remodex thread selected. Run /threads first.",
      replyMarkup: buildMissingThreadReplyMarkup(chatId),
    });
    return false;
  }

  async function selectThreadById(chatId, threadId, fallbackTitle = "") {
    const normalizedThreadId = normalizeChatId(threadId);
    if (!normalizedThreadId) {
      await botClient.sendMessage({ chatId, text: "Thread not found. Run /threads again." });
      return;
    }
    sessionState.setActiveThread({ chatId, threadId: normalizedThreadId, cwd: "" });
    forgetPendingRequests(chatId);
    const thread = findThreadById(await listThreads(), normalizedThreadId);
    if (thread) {
      sessionState.setActiveThread({ chatId, threadId: normalizedThreadId, cwd: threadCwd(thread) });
    }
    const title = thread
      ? threadTitle(thread)
      : normalizeChatId(fallbackTitle) || normalizedThreadId;
    await botClient.sendMessage({
      chatId,
      text: `Active thread: ${title}`,
      replyMarkup: buildContinueReplyMarkup(chatId, {
        activeThreadId: normalizedThreadId,
        activeThreadCwd: threadCwd(thread),
      }),
    });
  }

  async function registerCommandMenu() {
    if (typeof botClient?.setMyCommands !== "function") {
      return;
    }
    try {
      await botClient.setMyCommands({ commands: TELEGRAM_COMMAND_MENU });
    } catch (error) {
      logger.warn?.(`[remodex] Telegram command menu registration failed: ${error.message}`);
    }
  }

  async function refreshTelegramBotIdentity() {
    if (telegramBotUsername || typeof botClient?.getMe !== "function") {
      return;
    }
    try {
      const me = await botClient.getMe();
      telegramBotUsername = normalizeTelegramBotUsername(me?.username);
    } catch (error) {
      logger.warn?.(`[remodex] Telegram bot identity lookup failed: ${error.message}`);
    }
  }

  function shouldSkipThreadEventForChat(chatId, event) {
    if (hasSentThreadEvent(chatId, event)) {
      return true;
    }
    return event.method === "turn/completed" && hasAgentMessageForTurn(chatId, event);
  }

  function rememberSentThreadEvent(chatId, event) {
    const sentKey = threadEventKey(chatId, event);
    sentThreadEventKeys.set(sentKey, true);
    while (sentThreadEventKeys.size > MAX_SENT_THREAD_EVENT_KEYS) {
      const oldestKey = sentThreadEventKeys.keys().next().value;
      sentThreadEventKeys.delete(oldestKey);
    }
    if (event.method === "codex/event/agent_message") {
      rememberAgentMessageTurn(chatId, event);
    }
  }

  function hasSentThreadEvent(chatId, event) {
    return sentThreadEventKeys.has(threadEventKey(chatId, event));
  }

  function hasAgentMessageForTurn(chatId, event) {
    if (!event.turnId) {
      return false;
    }
    return agentMessageTurns.has(chatTurnKey(chatId, event));
  }

  function rememberAgentMessageTurn(chatId, event) {
    if (!event.turnId) {
      return;
    }
    agentMessageTurns.set(chatTurnKey(chatId, event), true);
    while (agentMessageTurns.size > MAX_SENT_THREAD_EVENT_KEYS) {
      const oldestKey = agentMessageTurns.keys().next().value;
      agentMessageTurns.delete(oldestKey);
    }
  }

  function isActionThreadCurrent(linkedChat, actionThreadId) {
    const normalizedActionThreadId = normalizeChatId(actionThreadId);
    return !normalizedActionThreadId
      || normalizeChatId(linkedChat?.activeThreadId) === normalizedActionThreadId;
  }

  function rememberPendingUserInputRequest(chatId, pending) {
    const normalizedChatId = normalizeChatId(chatId);
    if (
      !normalizedChatId
      || !pending?.request
      || !Array.isArray(pending.questions)
      || pending.questions.length === 0
      || !pending.threadId
    ) {
      return;
    }
    pendingUserInputRequestsByChat.set(normalizedChatId, pending);
  }

  function readPendingUserInputRequest(chatId) {
    return pendingUserInputRequestsByChat.get(normalizeChatId(chatId)) || null;
  }

  function shouldAnswerPendingUserInputWithPlainText(chatId, linkedChat, text, attachments, voiceAttachment) {
    const normalizedText = normalizeChatId(text);
    if (
      !normalizedText
      || isTelegramSlashCommand(normalizedText)
      || (Array.isArray(attachments) && attachments.length > 0)
      || voiceAttachment
    ) {
      return false;
    }
    const pending = readPendingUserInputRequest(chatId);
    return Boolean(pending && isActionThreadCurrent(linkedChat, pending.threadId));
  }

  function forgetPendingUserInputRequest(chatId) {
    pendingUserInputRequestsByChat.delete(normalizeChatId(chatId));
  }

  function rememberPendingApprovalRequest(chatId, pending) {
    const normalizedChatId = normalizeChatId(chatId);
    const requestId = normalizeChatId(pending?.request?.id);
    if (!normalizedChatId || !requestId || !pending?.request || !pending.threadId) {
      return;
    }
    const current = pendingApprovalRequestsByChat.get(normalizedChatId) || [];
    const next = [
      ...current.filter((entry) => normalizeChatId(entry?.request?.id) !== requestId),
      pending,
    ].slice(-MAX_PENDING_APPROVAL_REQUESTS_PER_CHAT);
    pendingApprovalRequestsByChat.set(normalizedChatId, next);
  }

  function readPendingApprovalRequestsForThread(chatId, linkedChat) {
    const normalizedChatId = normalizeChatId(chatId);
    const current = pendingApprovalRequestsByChat.get(normalizedChatId) || [];
    const retained = [];
    for (const entry of current) {
      if (!entry?.request || !entry.threadId) {
        continue;
      }
      if (isActionThreadCurrent(linkedChat, entry.threadId)) {
        retained.push(entry);
      }
    }
    if (retained.length > 0) {
      pendingApprovalRequestsByChat.set(normalizedChatId, retained);
    } else {
      pendingApprovalRequestsByChat.delete(normalizedChatId);
    }
    return retained;
  }

  function forgetPendingApprovalRequest(chatId, requestId) {
    const normalizedChatId = normalizeChatId(chatId);
    const normalizedRequestId = normalizeChatId(requestId);
    if (!normalizedChatId || !normalizedRequestId) {
      return;
    }
    const current = pendingApprovalRequestsByChat.get(normalizedChatId) || [];
    const next = current.filter((entry) => normalizeChatId(entry?.request?.id) !== normalizedRequestId);
    if (next.length > 0) {
      pendingApprovalRequestsByChat.set(normalizedChatId, next);
    } else {
      pendingApprovalRequestsByChat.delete(normalizedChatId);
    }
  }

  function forgetPendingRequests(chatId) {
    forgetPendingUserInputRequest(chatId);
    pendingApprovalRequestsByChat.delete(normalizeChatId(chatId));
  }

  function normalizeTelegramActivityLimit(rawLimit) {
    const normalized = normalizeChatId(rawLimit);
    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return TELEGRAM_ACTIVITY_DEFAULT_LIMIT;
    }
    return Math.min(Math.max(parsed, 1), TELEGRAM_ACTIVITY_MAX_LIMIT);
  }

  function buildPendingUserInputAnswers(pending, answerText) {
    const questions = Array.isArray(pending?.questions) ? pending.questions : [];
    if (questions.length === 0) {
      return null;
    }
    if (questions.length === 1) {
      const answer = normalizePendingQuestionAnswer(questions[0], answerText);
      if (!answer) {
        return null;
      }
      return {
        [questions[0].id]: { answers: [answer] },
      };
    }

    const answerLines = answerText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (answerLines.length !== questions.length) {
      return null;
    }

    const normalizedAnswers = questions.map((question, index) => (
      normalizePendingQuestionAnswer(question, answerLines[index])
    ));
    if (normalizedAnswers.some((answer) => !answer)) {
      return null;
    }

    return Object.fromEntries(questions.map((question, index) => ([
      question.id,
      { answers: [normalizedAnswers[index]] },
    ])));
  }

  function pendingAnswerUsage(pending) {
    const questions = Array.isArray(pending?.questions) ? pending.questions : [];
    const usage = questions.length <= 1
      ? `/answer ${pendingQuestionUsageLabel(questions[0], 1)}`
      : `/answer ${questions.map((question, index) => pendingQuestionUsageLabel(question, index + 1)).join("\n")}`;
    const order = pendingQuestionOrder(questions);
    return order ? `${usage}\nOrder: ${order}` : usage;
  }

  function pendingQuestionOrder(questions) {
    if (!Array.isArray(questions) || questions.length === 0) {
      return "";
    }
    return questions.map((question, index) => (
      `${index + 1}. ${pendingQuestionTitle(question, index + 1)}`
    )).join("; ");
  }

  function pendingQuestionTitle(question, index) {
    const title = normalizeChatId(question?.header)
      || normalizeChatId(question?.question)
      || normalizeChatId(question?.id)
      || `Question ${index}`;
    return title.length > 80 ? `${title.slice(0, 77)}...` : title;
  }

  function pendingQuestionUsageLabel(question, index) {
    if (!question) {
      return "<response>";
    }
    const optionLabels = Array.isArray(question?.optionLabels) ? question.optionLabels : [];
    if (optionLabels.length === 0) {
      return `<response${index > 1 ? ` ${index}` : ""}>`;
    }
    const labels = optionLabels.slice(0, 4).map((label) => label.slice(0, 40));
    const suffix = optionLabels.length > labels.length ? "|..." : "";
    return `<${labels.join("|")}${suffix}>`;
  }

  function normalizePendingQuestionAnswer(question, answerText) {
    const normalizedAnswer = normalizeChatId(answerText);
    if (!normalizedAnswer) {
      return "";
    }
    const optionLabels = Array.isArray(question?.optionLabels) ? question.optionLabels : [];
    if (optionLabels.length === 0) {
      return normalizedAnswer;
    }
    return optionLabels.find((label) => label.toLowerCase() === normalizedAnswer.toLowerCase()) || "";
  }

  function telegramAccessAllowed() {
    return isTelegramAccessAllowed(telegramAccessState);
  }

  async function sendTelegramAccessRequired(chatId) {
    await botClient.sendMessage({
      chatId,
      text: renderTelegramAccessRequired(telegramAccessState),
      replyMarkup: buildAccessRequiredReplyMarkup(chatId),
    });
  }

  return {
    handleUpdate,
    sendServerRequest,
    start,
    stop,
  };
}

function createTelegramAdapterFromBridgeConfig({
  config = {},
  controlSurface = {},
  createBotClient = createTelegramBotApiClient,
  createAdapter = createTelegramAdapter,
  logger = console,
} = {}) {
  if (!config.telegramEnabled) {
    return null;
  }
  const access = describeTelegramAccess(config);
  if (!access.allowed) {
    logger.warn?.(`[remodex] Telegram restricted: ${access.message}`);
  }
  if (!config.telegramBotToken) {
    throw new Error("REMODEX_TELEGRAM_BOT_TOKEN is required when REMODEX_TELEGRAM_ENABLED is set.");
  }
  return createAdapter({
    botClient: createBotClient({ botToken: config.telegramBotToken }),
    controlSurface,
    telegramAccess: access,
    botUsername: config.telegramBotUsername,
    pollIntervalMs: config.telegramPollIntervalMs,
    logger,
  });
}

const defaultSessionState = {
  read: readTelegramSessionState,
  clearActiveThread: clearTelegramActiveThread,
  link: linkTelegramChat,
  setActiveThread: setTelegramActiveThread,
  setProjectBrowsePath: setTelegramProjectBrowsePath,
  setRuntimePreferences: setTelegramRuntimePreferences,
  unlink: unlinkTelegramChat,
};

function readTelegramMessageText(message = {}) {
  if (typeof message.text === "string") {
    return message.text.trim();
  }
  if (typeof message.caption === "string") {
    return message.caption.trim();
  }
  return "";
}

function readTelegramImageAttachments(message = {}) {
  const attachments = [];
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const photo = [...message.photo].sort((left, right) => (
      telegramPhotoScore(right) - telegramPhotoScore(left)
    ))[0];
    const fileId = normalizeChatId(photo?.file_id);
    if (fileId) {
      attachments.push({
        fileId,
        fileName: `telegram-photo-${normalizeChatId(photo.file_unique_id) || fileId}.jpg`,
        mimeType: "image/jpeg",
      });
    }
  }

  const document = message.document;
  const documentMimeType = normalizeChatId(document?.mime_type || document?.mimeType).toLowerCase();
  const documentFileId = normalizeChatId(document?.file_id);
  if (documentFileId && documentMimeType.startsWith("image/")) {
    attachments.push({
      fileId: documentFileId,
      fileName: normalizeChatId(document.file_name || document.fileName),
      mimeType: documentMimeType,
    });
  }

  return attachments;
}

function readTelegramVoiceAttachment(message = {}) {
  const voice = message.voice || null;
  const voiceFileId = normalizeChatId(voice?.file_id);
  if (voiceFileId) {
    return {
      fileId: voiceFileId,
      mimeType: normalizeChatId(voice.mime_type || voice.mimeType) || "audio/ogg",
      durationMs: secondsToMilliseconds(voice.duration),
    };
  }

  const audio = message.audio || null;
  const audioFileId = normalizeChatId(audio?.file_id);
  const audioMimeType = normalizeChatId(audio?.mime_type || audio?.mimeType).toLowerCase();
  if (audioFileId && audioMimeType.startsWith("audio/")) {
    return {
      fileId: audioFileId,
      mimeType: audioMimeType,
      durationMs: secondsToMilliseconds(audio.duration),
    };
  }
  return null;
}

function secondsToMilliseconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
}

function telegramPhotoScore(photo = {}) {
  const fileSize = Number(photo.file_size || photo.fileSize);
  if (Number.isFinite(fileSize) && fileSize > 0) {
    return fileSize;
  }
  const width = Number(photo.width);
  const height = Number(photo.height);
  return (Number.isFinite(width) ? width : 0) * (Number.isFinite(height) ? height : 0);
}

function normalizeTelegramImageMimeType(...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeChatId(candidate).toLowerCase().split(";")[0].trim();
    if (normalized.startsWith("image/")) {
      return normalized;
    }
    const extensionMatch = normalized.match(/\.[a-z0-9]+(?:\?|#|$)/);
    if (extensionMatch) {
      const mimeType = TELEGRAM_IMAGE_MIME_TYPES_BY_EXTENSION.get(extensionMatch[0].replace(/[?#].*$/, ""));
      if (mimeType) {
        return mimeType;
      }
    }
  }
  return "image/jpeg";
}

function isSupportedTelegramImageMimeType(mimeType) {
  return Array.from(TELEGRAM_IMAGE_MIME_TYPES_BY_EXTENSION.values()).includes(mimeType);
}

function isTelegramSlashCommand(text) {
  return typeof text === "string" && text.trim().startsWith("/");
}

function isTelegramCommandAddressedToAnotherBot(text, botUsername = "") {
  const normalizedUsername = normalizeTelegramBotUsername(botUsername);
  if (!normalizedUsername) {
    return false;
  }
  const match = normalizeChatId(text).match(/^\/[A-Za-z0-9_]+@([A-Za-z0-9_]+)(?:\s|$)/);
  return Boolean(match && match[1].toLowerCase() !== normalizedUsername);
}

function normalizeTelegramBotUsername(value) {
  return normalizeChatId(value).replace(/^@+/, "").toLowerCase();
}

function shouldRouteUnknownMessageAsCodexInput(text, attachments = [], voiceAttachment = null) {
  if (isTelegramSlashCommand(text)) {
    return false;
  }
  return Boolean(
    normalizeChatId(text)
    || (Array.isArray(attachments) && attachments.length > 0)
    || voiceAttachment
  );
}

function parseKeepAwakePreference(rawValue) {
  const normalized = normalizeChatId(rawValue).toLowerCase();
  if (["on", "true", "yes", "1", "enable", "enabled"].includes(normalized)) {
    return true;
  }
  if (["off", "false", "no", "0", "disable", "disabled"].includes(normalized)) {
    return false;
  }
  return null;
}

function parseRuntimePreferenceCommand(rawValue, linkedChat = {}) {
  const normalized = normalizeChatId(rawValue);
  const current = normalizeTelegramRuntimePreferences(linkedChat);
  if (!normalized) {
    return { ...current, changed: false };
  }

  let model = current.model;
  let reasoningEffort = current.reasoningEffort;
  let serviceTier = current.serviceTier;
  for (const token of normalized.split(/\s+/).filter(Boolean)) {
    const normalizedModel = normalizeTelegramModel(token);
    if (normalizedModel) {
      model = normalizedModel;
      continue;
    }
    const normalizedEffort = normalizeTelegramReasoningEffort(token);
    if (normalizedEffort) {
      reasoningEffort = normalizedEffort;
      continue;
    }
    const parsedServiceTier = parseTelegramServiceTierToken(token);
    if (parsedServiceTier.recognized) {
      serviceTier = parsedServiceTier.serviceTier;
      continue;
    }
    return { ...current, changed: false, error: `Unsupported Telegram runtime option: ${token}` };
  }
  return {
    model,
    reasoningEffort,
    serviceTier,
    changed: model !== current.model
      || reasoningEffort !== current.reasoningEffort
      || serviceTier !== current.serviceTier,
  };
}

function parseTelegramServiceTierToken(token) {
  const normalized = normalizeChatId(token).toLowerCase().replaceAll("_", "-");
  if (["normal", "default", "standard", "off", "none", "fast", "speed", "faster", "fast-mode", "fastmode"].includes(normalized)) {
    return { recognized: true, serviceTier: normalizeTelegramServiceTier(normalized) };
  }
  return { recognized: false, serviceTier: "" };
}

function parseAccessModePreference(rawValue, linkedChat = {}) {
  const normalized = normalizeChatId(rawValue);
  const current = telegramAccessModeFor(linkedChat);
  if (!normalized) {
    return { accessMode: current, changed: false };
  }
  const accessMode = normalizeTelegramAccessMode(normalized);
  if (!accessMode) {
    return {
      accessMode: current,
      changed: false,
      error: `Unsupported Telegram access mode: ${normalized}`,
    };
  }
  return {
    accessMode,
    changed: accessMode !== current,
  };
}

function parseReviewTargetCommand(rawValue) {
  const normalized = normalizeChatId(rawValue);
  if (!normalized) {
    return { needsHelp: true };
  }
  const [firstToken = "", ...rest] = normalized.split(/\s+/);
  const target = firstToken.toLowerCase();
  if (["changes", "change", "uncommitted", "uncommittedchanges", "worktree", "working-tree"].includes(target)) {
    return { target: "uncommittedChanges", baseBranch: "" };
  }
  if (["base", "branch", "against"].includes(target)) {
    const baseBranch = rest.join(" ").trim();
    if (!baseBranch) {
      return { error: "A base branch is required for /review base." };
    }
    return { target: "baseBranch", baseBranch };
  }
  return { error: `Unsupported review target: ${firstToken}` };
}

function telegramRuntimePreferencesFor(linkedChat = {}) {
  const runtime = normalizeTelegramRuntimePreferences(linkedChat);
  const accessMode = telegramAccessModeFor(linkedChat);
  const compactRuntime = runtime.serviceTier
    ? runtime
    : {
      model: runtime.model,
      reasoningEffort: runtime.reasoningEffort,
    };
  return accessMode === TELEGRAM_DEFAULT_ACCESS_MODE
    ? compactRuntime
    : { ...compactRuntime, accessMode };
}

function telegramAccessModeFor(linkedChat = {}) {
  return normalizeTelegramAccessMode(linkedChat.runtimeAccessMode || linkedChat.accessMode)
    || TELEGRAM_DEFAULT_ACCESS_MODE;
}

function linkedChatFor(state, chatId) {
  return (state?.linkedChats || []).find((chat) => chat.chatId === normalizeChatId(chatId)) || null;
}

function findThreadById(threads, threadId) {
  const normalizedThreadId = normalizeChatId(threadId);
  return (threads || []).find((thread) => (
    normalizeChatId(thread?.id || thread?.threadId || thread?.thread_id) === normalizedThreadId
  )) || null;
}

function parseTelegramServerRequest(rawRequest) {
  const request = typeof rawRequest === "string" ? safeParseJSON(rawRequest) : rawRequest;
  const id = requestIdKey(request?.id);
  const method = normalizeChatId(request?.method);
  if (!id || !APPROVAL_REQUEST_METHODS.has(method)) {
    return null;
  }
  const params = request.params && typeof request.params === "object" && !Array.isArray(request.params)
    ? request.params
    : {};
  return {
    id,
    method,
    params,
  };
}

function parseTelegramUserInputRequest(rawRequest) {
  const request = typeof rawRequest === "string" ? safeParseJSON(rawRequest) : rawRequest;
  const id = requestIdKey(request?.id);
  const method = normalizeChatId(request?.method);
  if (!id || !USER_INPUT_REQUEST_METHODS.has(method)) {
    return null;
  }
  const params = request.params && typeof request.params === "object" && !Array.isArray(request.params)
    ? request.params
    : {};
  const questions = Array.isArray(params.questions) ? params.questions : [];
  if (questions.length === 0) {
    return null;
  }
  return {
    id,
    method,
    params,
  };
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

function telegramCommandAnswerQuestions(params = {}) {
  const questions = Array.isArray(params.questions) ? params.questions : [];
  if (questions.length === 0 || questions.length > 3) {
    return [];
  }
  const normalized = questions
    .map((question) => {
      const id = normalizeChatId(question?.id);
      const optionLabels = Array.isArray(question?.options)
        ? question.options.map((option) => normalizeChatId(option?.label)).filter(Boolean)
        : [];
      return id ? { ...question, id, optionLabels } : null;
    })
    .filter(Boolean);
  return normalized.length === questions.length ? normalized : [];
}

function parseTelegramThreadEvent(rawMessage) {
  const message = typeof rawMessage === "string" ? safeParseJSON(rawMessage) : rawMessage;
  const method = normalizeChatId(message?.method);
  if (!THREAD_EVENT_METHODS.has(method)) {
    return null;
  }
  const params = message?.params && typeof message.params === "object" && !Array.isArray(message.params)
    ? message.params
    : {};
  const threadId = readTelegramThreadId(params);
  if (!threadId) {
    return null;
  }
  const turnId = readTelegramTurnId(params);
  const event = {
    method,
    params,
    threadId,
    turnId,
    itemId: normalizeChatId(params.itemId || params.item_id),
  };
  if (method === "codex/event/agent_message" && !normalizeChatId(params.message || params.text)) {
    return null;
  }
  return event;
}

function safeParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function requestIdKey(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function readTelegramThreadId(params = {}) {
  return normalizeChatId(
    params.threadId
    || params.thread_id
    || params.turn?.threadId
    || params.turn?.thread_id
    || params.item?.threadId
    || params.item?.thread_id
  );
}

function readTelegramTurnId(params = {}) {
  return normalizeChatId(
    params.turnId
    || params.turn_id
    || params.id
    || params.turn?.id
    || params.turn?.turnId
    || params.turn?.turn_id
  );
}

function threadEventKey(chatId, event) {
  const itemKey = event.itemId || normalizeChatId(event.params?.message || event.params?.text).slice(0, 120);
  return [
    normalizeChatId(chatId),
    event.method,
    event.threadId,
    event.turnId,
    itemKey,
  ].join("|");
}

function chatTurnKey(chatId, event) {
  return [
    normalizeChatId(chatId),
    event.threadId,
    event.turnId,
  ].join("|");
}

function normalizeChatId(chatId) {
  return String(chatId ?? "").trim();
}

function normalizeExplicitThreadId(threadId) {
  const normalized = normalizeChatId(threadId);
  if (!normalized || normalized.length > 200 || /\s/.test(normalized)) {
    return "";
  }
  return normalized;
}

function threadTitle(thread) {
  return thread?.title || thread?.name || thread?.id || "Untitled";
}

function renderThreadsText({ lines = [], query = "" } = {}) {
  const normalizedQuery = normalizeChatId(query);
  if (lines.length === 0) {
    return normalizedQuery
      ? `No recent Remodex threads found matching "${truncateInline(normalizedQuery, 80)}".`
      : "No recent Remodex threads.";
  }
  const header = normalizedQuery
    ? `Threads matching "${truncateInline(normalizedQuery, 80)}":`
    : "Threads:";
  return `${header}\n${lines.join("\n")}`;
}

function truncateInline(value, maxLength) {
  const normalized = normalizeChatId(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function projectTitle(project) {
  return normalizeChatId(project?.label || project?.name || project?.path) || "Project";
}

function normalizeProjectEntries(result = {}) {
  if (Array.isArray(result.projects)) {
    return result.projects;
  }
  if (Array.isArray(result.entries)) {
    return result.entries;
  }
  if (Array.isArray(result.locations)) {
    return result.locations;
  }
  return [];
}

function threadCwd(thread) {
  return normalizeChatId(thread?.cwd || thread?.projectPath || thread?.project_path);
}

function renderCommandError(commandName, error) {
  const message = error?.message || "unknown error";
  if (message.toLowerCase().includes("not initialized")) {
    return `Remodex is still warming up. Try /${commandName} again in a moment.`;
  }
  return `Remodex could not complete /${commandName}: ${message}`;
}

function telegramPollRetryDelayMs(error, fallbackMs) {
  const fallbackDelayMs = normalizeTelegramPollDelayMs(fallbackMs);
  const retryAfterSeconds = Number(error?.retryAfterSeconds);
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return fallbackDelayMs;
  }
  const retryDelayMs = Math.ceil(retryAfterSeconds * TELEGRAM_RETRY_AFTER_MS);
  return Math.max(fallbackDelayMs, retryDelayMs);
}

function normalizeTelegramPollDelayMs(value) {
  const delayMs = Number(value);
  return Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 1_000;
}

module.exports = {
  TELEGRAM_ACTIVE_THREAD_COMMANDS,
  TELEGRAM_COMMAND_MENU,
  createTelegramAdapter,
  createTelegramAdapterFromBridgeConfig,
  parseTelegramCommand,
};
