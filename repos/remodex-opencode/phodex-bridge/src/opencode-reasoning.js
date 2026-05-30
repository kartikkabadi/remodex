// FILE: opencode-reasoning.js
// Purpose: Extracts reasoning effort levels from OpenCode model variants using the cascade
//          proven in dpcode. Normalizes 8+ provider-specific key shapes into a flat
//          supportedReasoningEfforts[] list.
// Layer: Bridge runtime provider helper
// Exports: normalizeReasoningEfforts, inferDefaultReasoningEffort
// Depends on: none

function normalizeReasoningEfforts(variants) {
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) {
    return [];
  }

  const seen = new Set();
  const efforts = [];

  for (const [variantKey, variantValue] of Object.entries(variants)) {
    const effort = extractReasoningEffort(variantKey, variantValue);
    if (!effort) {
      continue;
    }

    const normalized = effort.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);

    efforts.push({
      reasoningEffort: effort,
      description: formatEffortDescription(variantKey, effort),
    });
  }

  return efforts;
}

function extractReasoningEffort(variantKey, variantValue) {
  if (!variantValue || typeof variantValue !== "object") {
    return undefined;
  }

  // 1. Direct reasoningEffort (OpenAI, AI Gateway, xAI Grok native, openai-compatible)
  const direct = readString(variantValue.reasoningEffort)
    || readString(variantValue.reasoning_effort)
    || readString(variantValue.effort);
  if (direct) {
    return direct;
  }

  // 2. thinkingConfig (Google Gemini)
  const thinkingLevel = readString(variantValue.thinkingConfig?.thinkingLevel)
    || readString(variantValue.thinkingConfig?.thinking_level)
    || readString(variantValue.thinking_config?.thinkingLevel)
    || readString(variantValue.thinking_config?.thinking_level);
  if (thinkingLevel) {
    return thinkingLevel;
  }

  // 3. reasoning.effort (OpenRouter)
  if (variantValue.reasoning && typeof variantValue.reasoning === "object") {
    const routerEffort = readString(variantValue.reasoning.effort);
    if (routerEffort) {
      return routerEffort;
    }
  }

  // 4. reasoningConfig (Bedrock)
  const maxEffort = readString(variantValue.reasoningConfig?.maxReasoningEffort)
    || readString(variantValue.reasoningConfig?.max_reasoning_effort)
    || readString(variantValue.reasoning_config?.maxReasoningEffort)
    || readString(variantValue.reasoning_config?.max_reasoning_effort);
  if (maxEffort) {
    return maxEffort;
  }

  // 5. thinking object exists (Anthropic: { thinking: { type, budgetTokens } } or { thinking: { type: "adaptive" }, effort: "high" })
  if (variantValue.thinking && typeof variantValue.thinking === "object") {
    const thinkingEffort = readString(variantValue.thinking.effort);
    if (thinkingEffort) {
      return thinkingEffort;
    }
    return variantKey;
  }

  // 6. thinkingConfig / reasoning / reasoningConfig keys exist — variant IS reasoning
  if (variantValue.thinkingConfig
    || variantValue.reasoning
    || variantValue.reasoningConfig
    || variantValue.thinking_config
    || variantValue.reasoning_config) {
    return variantKey;
  }

  // 7. Empty variant — use variant key as the effort value
  if (Object.keys(variantValue).length === 0) {
    return variantKey;
  }

  return undefined;
}

function inferDefaultReasoningEffort(efforts, upstreamProviderId) {
  if (!Array.isArray(efforts) || efforts.length === 0) {
    return null;
  }
  if (efforts.length === 1) {
    return efforts[0].reasoningEffort;
  }

  const values = efforts.map((e) => e.reasoningEffort);
  for (const pref of ["high", "medium", "low", "minimal"]) {
    if (values.includes(pref)) {
      return pref;
    }
  }
  return values[0];
}

function formatEffortDescription(variantKey, effortValue) {
  const lowered = effortValue.toLowerCase();

  switch (lowered) {
    case "minimal":
      return "Minimal reasoning";
    case "low":
      return "Low reasoning";
    case "medium":
      return "Medium reasoning";
    case "high":
      return "High reasoning";
    case "xhigh":
      return "Extra high reasoning";
    case "max":
      return "Maximum reasoning";
    default:
      return `${variantKey} reasoning`;
  }
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  extractReasoningEffort,
  formatEffortDescription,
  inferDefaultReasoningEffort,
  normalizeReasoningEfforts,
};
