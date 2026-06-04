// FILE: opencode-provider-inventory.test.js
// Purpose: Connected-only OpenCode provider inventory (CR-1 fixtures).

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolvePreferredProviders,
  flattenConnectedProviderModels,
  discoveryReasonCodeFromInventory,
  buildInventoryMeta,
  buildProviderInventory,
  resolveLogoProviderId,
} = require("../src/opencode-provider-inventory");

function makeProvider({ id, name, source = "api", models = {} }) {
  return { id, name, source, models, env: [] };
}

describe("resolvePreferredProviders — MVP credentialProviderIDs: []", () => {
  test("Mac A: only connected anthropic models, not env openai in all", () => {
    const inventory = {
      connected: ["anthropic"],
      all: [
        makeProvider({
          id: "anthropic",
          name: "Anthropic",
          models: { "claude-sonnet": { id: "claude-sonnet", name: "Claude Sonnet" } },
        }),
        makeProvider({
          id: "openai",
          name: "OpenAI",
          source: "env",
          models: { "gpt-4": { id: "gpt-4", name: "GPT-4" } },
        }),
      ],
    };

    const preferred = resolvePreferredProviders(inventory, { credentialProviderIDs: [] });
    assert.deepEqual(
      preferred.map((p) => p.id),
      ["anthropic"],
    );
    const models = flattenConnectedProviderModels(preferred);
    assert.equal(models.length, 1);
    assert.equal(models[0].upstreamProviderId, "anthropic");
    assert.equal(models[0].upstreamProviderDisplayName, "Anthropic");
  });

  test("Mac B: env-only openai connected shows models (tier 5 fallback)", () => {
    const inventory = {
      connected: ["openai"],
      all: [
        makeProvider({
          id: "openai",
          name: "OpenAI",
          source: "env",
          models: { "gpt-4": { id: "gpt-4", name: "GPT-4" } },
        }),
      ],
    };

    const preferred = resolvePreferredProviders(inventory, { credentialProviderIDs: [] });
    assert.deepEqual(preferred.map((p) => p.id), ["openai"]);
    assert.equal(flattenConnectedProviderModels(preferred).length, 1);
  });

  test("Mac C: empty connected returns no preferred providers", () => {
    const inventory = {
      connected: [],
      all: [
        makeProvider({
          id: "anthropic",
          name: "Anthropic",
          models: { x: { id: "x", name: "X" } },
        }),
      ],
    };

    assert.deepEqual(resolvePreferredProviders(inventory), []);
    assert.equal(discoveryReasonCodeFromInventory(inventory), "no_connected_providers");
    const meta = buildInventoryMeta({ inventory, models: [] });
    assert.equal(meta.reasonCode, "no_connected_providers");
    assert.deepEqual(meta.connectedProviderIds, []);
  });

  test("prefers OpenCode-managed over generic api when no credentials", () => {
    const inventory = {
      connected: ["openai", "opencode"],
      all: [
        makeProvider({ id: "openai", name: "OpenAI", source: "api", models: { a: { id: "a", name: "A" } } }),
        makeProvider({
          id: "opencode",
          name: "OpenCode",
          source: "api",
          models: { free: { id: "free", name: "Free" } },
        }),
      ],
    };

    const preferred = resolvePreferredProviders(inventory, { credentialProviderIDs: [] });
    assert.deepEqual(preferred.map((p) => p.id), ["opencode"]);
  });

  test("falls back to non-env connected when no opencode-managed", () => {
    const inventory = {
      connected: ["cloudflare-ai-gateway", "openai"],
      all: [
        makeProvider({
          id: "cloudflare-ai-gateway",
          name: "Cloudflare",
          source: "env",
          models: {},
        }),
        makeProvider({
          id: "openai",
          name: "OpenAI",
          source: "api",
          models: { gpt: { id: "gpt", name: "GPT" } },
        }),
      ],
    };

    const preferred = resolvePreferredProviders(inventory, { credentialProviderIDs: [] });
    assert.deepEqual(preferred.map((p) => p.id), ["openai"]);
  });
});

describe("resolveInventoryReasonCode", () => {
  test("orphaned connected IDs without models yield unknown not ok", () => {
    const { resolveInventoryReasonCode } = require("../src/opencode-provider-inventory");
    const inventory = {
      connected: ["missing-provider"],
      all: [
        makeProvider({
          id: "anthropic",
          name: "Anthropic",
          models: { x: { id: "x", name: "X" } },
        }),
      ],
    };
    assert.equal(resolveInventoryReasonCode(inventory, []), "unknown");
  });

  test("connected with models stays ok", () => {
    const { resolveInventoryReasonCode, flattenConnectedProviderModels, resolvePreferredProviders } =
      require("../src/opencode-provider-inventory");
    const inventory = {
      connected: ["anthropic"],
      all: [
        makeProvider({
          id: "anthropic",
          name: "Anthropic",
          models: { x: { id: "x", name: "X" } },
        }),
      ],
    };
    const preferred = resolvePreferredProviders(inventory, { credentialProviderIDs: [] });
    const models = flattenConnectedProviderModels(preferred);
    assert.equal(resolveInventoryReasonCode(inventory, models), "ok");
  });
});

describe("buildProviderInventory", () => {
  test("authenticated disconnected provider appears once", () => {
    const inventory = {
      connected: ["opencode-go"],
      all: [
        makeProvider({
          id: "opencode-go",
          name: "OpenCode Go",
          models: { flash: { id: "flash", name: "Flash" } },
        }),
      ],
    };
    const rows = buildProviderInventory(inventory, {
      credentialProviderIDs: ["deepseek", "opencode-go"],
    });
    const deepseek = rows.find((row) => row.id === "deepseek");
    assert.ok(deepseek);
    assert.equal(deepseek.connectedOnServe, false);
    assert.equal(deepseek.authenticated, true);
    assert.equal(rows.filter((row) => row.id.toLowerCase() === "opencode-go").length, 1);
  });

  test("OpenCode Go inventory row gets logoProviderId opencode-go", () => {
    const inventory = {
      connected: ["opencode-go"],
      all: [
        makeProvider({
          id: "opencode-go",
          name: "OpenCode Go",
          models: { free: { id: "free", name: "Free" } },
        }),
      ],
    };
    const rows = buildProviderInventory(inventory, { credentialProviderIDs: [] });
    const go = rows.find((row) => row.id === "opencode-go");
    assert.ok(go);
    assert.equal(go.logoProviderId, "opencode-go");
    assert.equal(go.logoAssetId, "provider-opencode-go-logo");
    assert.equal(resolveLogoProviderId("opencode-go", "OpenCode Go"), "opencode-go");
  });

  test("OpenCode Zen inventory row gets logoProviderId opencode-zen", () => {
    const inventory = {
      connected: ["opencode"],
      all: [
        makeProvider({
          id: "opencode",
          name: "OpenCode Zen",
          models: { free: { id: "free", name: "Free" } },
        }),
      ],
    };
    const rows = buildProviderInventory(inventory, { credentialProviderIDs: [] });
    const zen = rows.find((row) => row.id === "opencode");
    assert.ok(zen);
    assert.equal(zen.displayName, "OpenCode Zen");
    assert.equal(zen.logoProviderId, "opencode-zen");
    assert.equal(zen.logoAssetId, "provider-opencode-zen-logo");
    assert.equal(resolveLogoProviderId("opencode", "OpenCode Zen"), "opencode-zen");
  });

  test("OpenCode Zenith does not get logoProviderId", () => {
    assert.equal(resolveLogoProviderId("opencode", "OpenCode Zenith"), undefined);
    const inventory = {
      connected: ["opencode"],
      all: [
        makeProvider({
          id: "opencode",
          name: "OpenCode Zenith",
          models: { free: { id: "free", name: "Free" } },
        }),
      ],
    };
    const rows = buildProviderInventory(inventory, { credentialProviderIDs: [] });
    const row = rows.find((entry) => entry.id === "opencode");
    assert.ok(row);
    assert.equal(row.displayName, "OpenCode Zenith");
    assert.equal(row.logoProviderId, undefined);
    assert.equal(row.logoAssetId, undefined);
  });

  test("generic opencode provider has no logoProviderId", () => {
    const inventory = {
      connected: ["opencode"],
      all: [
        makeProvider({
          id: "opencode",
          name: "OpenCode",
          models: { free: { id: "free", name: "Free" } },
        }),
      ],
    };
    const rows = buildProviderInventory(inventory, { credentialProviderIDs: [] });
    const row = rows.find((entry) => entry.id === "opencode");
    assert.ok(row);
    assert.equal(row.logoProviderId, undefined);
    assert.equal(row.logoAssetId, undefined);
  });

  test("dedupes canonical id casing from all[]", () => {
    const inventory = {
      connected: ["openai"],
      all: [makeProvider({ id: "OpenAI", name: "OpenAI", models: {} })],
    };
    const rows = buildProviderInventory(inventory, {
      credentialProviderIDs: ["openai"],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "OpenAI");
  });
});

describe("discoveryReasonCodeFromInventory", () => {
  test("unknown when connected key missing", () => {
    assert.equal(discoveryReasonCodeFromInventory({ all: [] }), "unknown");
  });

  test("ok when connected non-empty", () => {
    assert.equal(discoveryReasonCodeFromInventory({ connected: ["anthropic"], all: [] }), "ok");
  });
});