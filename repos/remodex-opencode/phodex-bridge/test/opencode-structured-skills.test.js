// FILE: opencode-structured-skills.test.js
// Purpose: Verifies structured skill/mention turn input maps to OpenCode session.prompt parts.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/opencode-models, ../src/opencode-provider, ../src/provider-capabilities

const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("url");
const path = require("path");
const {
  buildPromptFromTurnInput,
  skillItemToPromptPart,
  mentionItemToPromptPart,
} = require("../src/opencode-models");
const { createOpenCodeProvider } = require("../src/opencode-provider");
const {
  CAPABILITIES,
  CODEX_CAPABILITIES,
  OPENCODE_CAPABILITIES,
  resolveModelCapabilities,
} = require("../src/provider-capabilities");

test("CAPABILITIES includes supportsStructuredSkillInput as 16th flag", () => {
  assert.equal(CAPABILITIES.length, 16);
  assert.equal(CAPABILITIES[13], "supportsStructuredSkillInput");
});

test("Codex enables structured skill input; OpenCode defaults false", () => {
  assert.equal(CODEX_CAPABILITIES.supportsStructuredSkillInput, true);
  assert.equal(OPENCODE_CAPABILITIES.supportsStructuredSkillInput, false);
  assert.equal(resolveModelCapabilities("opencode", {}).supportsStructuredSkillInput, false);
});

test("skill with path maps to file part for session.prompt", () => {
  const skillPath = "/tmp/project/.agents/skills/review/SKILL.md";
  const part = skillItemToPromptPart({
    type: "skill",
    id: "review",
    name: "review",
    path: skillPath,
  });

  assert.equal(part.type, "file");
  assert.equal(part.mime, "text/markdown");
  assert.equal(part.filename, "review");
  assert.equal(part.url, pathToFileURL(skillPath).href);
});

test("skill without path maps to $name text fallback", () => {
  const part = skillItemToPromptPart({ type: "skill", id: "deploy", name: "deploy" });
  assert.deepEqual(part, { type: "text", text: "$deploy" });
});

test("mention with path maps to file part", () => {
  const mentionPath = "/tmp/project/src/auth.ts";
  const part = mentionItemToPromptPart({
    type: "mention",
    name: "auth.ts",
    path: mentionPath,
  });

  assert.equal(part.type, "file");
  assert.equal(part.filename, "auth.ts");
  assert.equal(part.url, pathToFileURL(mentionPath).href);
});

test("buildPromptFromTurnInput preserves user text and attaches skill files", () => {
  const skillPath = path.join("/tmp/project", ".agents/skills/review/SKILL.md");
  const { inputText, prompt, parts } = buildPromptFromTurnInput([
    { type: "text", text: "Please review this change" },
    { type: "skill", id: "review", name: "review", path: skillPath },
  ]);

  assert.equal(inputText, "Please review this change");
  assert.equal(prompt, "Please review this change");
  assert.equal(parts.length, 2);
  assert.equal(parts[0].type, "text");
  assert.equal(parts[0].text, "Please review this change");
  assert.equal(parts[1].type, "file");
  assert.equal(parts[1].filename, "review");
  assert.equal(parts[1].url, pathToFileURL(skillPath).href);
});

test("skill-only structured input still produces prompt parts", () => {
  const skillPath = "/tmp/project/.agents/skills/plan/SKILL.md";
  const { prompt, parts } = buildPromptFromTurnInput([
    { type: "skill", id: "plan", name: "plan", path: skillPath },
  ]);

  assert.equal(prompt, "");
  assert.equal(parts.length, 2);
  assert.equal(parts[0].type, "text");
  assert.equal(parts[1].type, "file");
});

test("turn/start forwards structured parts to OpenCode session.prompt", async () => {
  const prompts = [];
  const provider = createOpenCodeProvider({
    sendApplicationMessage: () => {},
    serverFactory: () => ({
      get baseUrl() {
        return "http://127.0.0.1:4291";
      },
      get isRunning() {
        return true;
      },
      start: async () => {},
      stop: async () => {},
    }),
    clientFactory: async () => ({
      listModels: async () => [],
      listAgents: async () => [],
      createSession: async () => "ses_skill_test",
      getSession: async () => ({}),
      prompt: async (payload) => {
        prompts.push(payload);
      },
      setModel: async () => {},
      setMode: async () => {},
      setEffort: async () => {},
      abort: async () => {},
      fork: async () => "ses_fork",
      getMessages: async () => [],
      replyToPermission: async () => {},
      subscribeToEvents: () => () => {},
    }),
  });

  const start = await provider.handleRequest({
    id: 1,
    method: "thread/start",
    params: { cwd: "/tmp/project" },
  });

  await provider.handleRequest({
    id: 2,
    method: "turn/start",
    params: {
      threadId: start.thread.id,
      input: [
        { type: "text", text: "Run the skill" },
        {
          type: "skill",
          id: "review",
          name: "review",
          path: "/tmp/project/.agents/skills/review/SKILL.md",
        },
      ],
    },
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(prompts.length, 1);
  assert.ok(Array.isArray(prompts[0].parts));
  assert.equal(prompts[0].parts.length, 2);
  assert.equal(prompts[0].parts[0].type, "text");
  assert.equal(prompts[0].parts[1].type, "file");
  assert.equal(prompts[0].parts[1].filename, "review");
});