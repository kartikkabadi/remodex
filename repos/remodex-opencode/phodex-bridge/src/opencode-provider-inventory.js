// FILE: opencode-provider-inventory.js
// Purpose: Connected-only OpenCode provider/model discovery from GET /provider (v1).
// Layer: Bridge runtime utility
// Exports: loadProviderListInventory, resolvePreferredProviders,
//          flattenConnectedProviderModels, refreshProviderInventory,
//          resolveProviderListPayload, buildInventoryMeta
// Depends on: ./opencode-client (buildModelFromAny, resolveProviderListPayload pattern)

const { readString } = require("./normalize");

function resolveProviderListPayload(response) {
  if (!response || typeof response !== "object") return response;

  if (Array.isArray(response.providers) || Array.isArray(response.all)) {
    return response;
  }

  const nested = response.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested;
  }

  return response;
}

function loadProviderListInventory(client) {
  if (!client || typeof client.provider?.list !== "function") {
    return Promise.reject(new Error("OpenCode client missing provider.list()"));
  }
  return client.provider.list().then((response) => {
    const payload = resolveProviderListPayload(response);
    if (!payload || typeof payload !== "object") {
      return { all: [], connected: [], default: {} };
    }
    return {
      all: Array.isArray(payload.all) ? payload.all : [],
      connected: Array.isArray(payload.connected) ? payload.connected : [],
      default: payload.default && typeof payload.default === "object" ? payload.default : {},
    };
  });
}

function isOpenCodeManagedProvider(provider) {
  const normalizedId = readString(provider?.id).trim().toLowerCase();
  const normalizedName = readString(provider?.name).trim().toLowerCase();
  const envVars = new Set(
    (Array.isArray(provider?.env) ? provider.env : [])
      .map((value) => readString(value).trim().toUpperCase())
      .filter(Boolean),
  );

  return (
    envVars.has("OPENCODE_API_KEY") ||
    normalizedId === "opencode" ||
    normalizedId.startsWith("opencode-") ||
    normalizedName.startsWith("opencode")
  );
}

function resolvePreferredProviders(inventory, options = {}) {
  const credentialProviderIDs = options.credentialProviderIDs || [];
  const consoleManagedProviders = options.consoleManagedProviders || [];

  const connected = new Set(
    Array.isArray(inventory?.connected) ? inventory.connected.map((id) => readString(id)) : [],
  );
  const all = Array.isArray(inventory?.all) ? inventory.all : [];
  const connectedProviders = all.filter((provider) => connected.has(readString(provider?.id)));

  if (connectedProviders.length === 0) {
    return [];
  }

  const credentialProviders = new Set(credentialProviderIDs.map((id) => readString(id)));
  const authenticatedConnectedProviders = connectedProviders.filter((provider) =>
    credentialProviders.has(readString(provider?.id)),
  );

  const consoleManaged = new Set(consoleManagedProviders.map((id) => readString(id)));
  const consoleManagedConnectedProviders = connectedProviders.filter((provider) =>
    consoleManaged.has(readString(provider?.id)),
  );

  const openCodeManagedConnectedProviders = connectedProviders.filter(isOpenCodeManagedProvider);

  const preferredProviderIDs = new Set(
    [
      ...authenticatedConnectedProviders,
      ...consoleManagedConnectedProviders,
      ...openCodeManagedConnectedProviders,
    ].map((provider) => readString(provider.id)),
  );

  if (preferredProviderIDs.size > 0) {
    return connectedProviders.filter((provider) => preferredProviderIDs.has(readString(provider.id)));
  }

  const nonEnvironmentConnectedProviders = connectedProviders.filter(
    (provider) => readString(provider?.source) !== "env",
  );
  if (nonEnvironmentConnectedProviders.length > 0) {
    return nonEnvironmentConnectedProviders;
  }

  return connectedProviders;
}

function modelsForProvider(provider) {
  const models = provider?.models;
  if (Array.isArray(models)) return models;
  if (models && typeof models === "object") return Object.values(models);
  return [];
}

function flattenConnectedProviderModels(preferredProviders) {
  const { buildModelFromAny } = require("./opencode-client");
  return preferredProviders.flatMap((provider) => {
    const providerId = readString(provider.id || provider.providerId || provider.providerID);
    const displayName = readString(provider.name) || undefined;
    return modelsForProvider(provider).map((model) => buildModelFromAny(model, provider));
  });
}

function discoveryReasonCodeFromInventory(inventory) {
  if (!inventory || typeof inventory !== "object") {
    return "unknown";
  }
  if (!Array.isArray(inventory.connected)) {
    return "unknown";
  }
  if (inventory.connected.length === 0) {
    return "no_connected_providers";
  }
  return "ok";
}

function resolveInventoryReasonCode(inventory, models) {
  const base = discoveryReasonCodeFromInventory(inventory);
  if (base !== "ok") {
    return base;
  }
  if (!Array.isArray(models) || models.length === 0) {
    return "unknown";
  }
  return "ok";
}

function buildInventoryMeta({ inventory, models, fetchedAt, stale = false }) {
  const connectedProviderIds = Array.isArray(inventory?.connected)
    ? inventory.connected.map((id) => readString(id)).filter(Boolean)
    : [];
  const reasonCode = resolveInventoryReasonCode(inventory, models);
  const modelCountBeforeCap = Array.isArray(models) ? models.length : 0;

  return {
    reasonCode,
    connectedProviderIds,
    fetchedAt: fetchedAt || new Date().toISOString(),
    stale: Boolean(stale),
    modelCountBeforeCap,
    modelCountAfterCap: modelCountBeforeCap,
  };
}

function buildConnectedProviderSummaries(preferredProviders) {
  return preferredProviders.map((provider) => {
    const id = readString(provider.id);
    return {
      id,
      displayName: readString(provider.name) || id,
      modelCount: modelsForProvider(provider).length,
    };
  });
}

async function refreshProviderInventory(client, options = {}) {
  const force = options.force === true;
  const credentialProviderIDs = options.credentialProviderIDs || [];
  const consoleManagedProviders = options.consoleManagedProviders || [];
  const cached = options.cached || null;
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) ? options.cacheTtlMs : 60_000;
  const now = Date.now();

  if (
    !force &&
    cached?.inventory &&
    cached?.fetchedAt &&
    now - cached.fetchedAt < cacheTtlMs
  ) {
    const models = cached.models || [];
    return {
      inventory: cached.inventory,
      models,
      meta: {
        ...(cached.meta || buildInventoryMeta({ inventory: cached.inventory, models })),
        stale: false,
      },
      connectedProviders: cached.connectedProviders || buildConnectedProviderSummaries(
        resolvePreferredProviders(cached.inventory, {
          credentialProviderIDs,
          consoleManagedProviders,
        }),
      ),
    };
  }

  try {
    const inventory = await loadProviderListInventory(client);
    const preferred = resolvePreferredProviders(inventory, {
      credentialProviderIDs,
      consoleManagedProviders,
    });
    const models = flattenConnectedProviderModels(preferred);
    const reasonCode = resolveInventoryReasonCode(inventory, models);

    if (reasonCode === "no_connected_providers" || reasonCode === "unknown") {
      const meta = buildInventoryMeta({ inventory, models: [], fetchedAt: new Date().toISOString() });
      if (reasonCode === "unknown") {
        meta.reasonCode = "unknown";
      }
      return {
        inventory,
        models: [],
        meta,
        connectedProviders: [],
      };
    }

    const meta = buildInventoryMeta({
      inventory,
      models,
      fetchedAt: new Date().toISOString(),
    });
    meta.reasonCode = reasonCode;
    return {
      inventory,
      models,
      meta,
      connectedProviders: buildConnectedProviderSummaries(preferred),
    };
  } catch (error) {
    if (cached?.inventory && Array.isArray(cached.models)) {
      return {
        inventory: cached.inventory,
        models: cached.models,
        meta: {
          ...(cached.meta || buildInventoryMeta({ inventory: cached.inventory, models: cached.models })),
          reasonCode: "provider_list_failed",
          stale: true,
        },
        connectedProviders: cached.connectedProviders || [],
        error,
      };
    }

    return {
      inventory: { all: [], connected: [], default: {} },
      models: [],
      meta: {
        reasonCode: "provider_list_failed",
        connectedProviderIds: [],
        fetchedAt: new Date().toISOString(),
        stale: false,
        modelCountBeforeCap: 0,
        modelCountAfterCap: 0,
      },
      connectedProviders: [],
      error,
    };
  }
}

module.exports = {
  loadProviderListInventory,
  resolvePreferredProviders,
  flattenConnectedProviderModels,
  refreshProviderInventory,
  buildInventoryMeta,
  buildConnectedProviderSummaries,
  discoveryReasonCodeFromInventory,
  resolveInventoryReasonCode,
  isOpenCodeManagedProvider,
  resolveProviderListPayload,
};