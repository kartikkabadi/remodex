// FILE: telegram-codex-envelope.js
// Purpose: Shared helpers for parsing nested Codex event envelopes in Telegram bridge code.
// Layer: CLI helper
// Exports: telegramEnvelopeEvent

function telegramEnvelopeEvent(params = {}) {
  if (params?.msg && typeof params.msg === "object" && !Array.isArray(params.msg)) {
    return params.msg;
  }
  if (params?.event && typeof params.event === "object" && !Array.isArray(params.event)) {
    return params.event;
  }
  return null;
}

module.exports = {
  telegramEnvelopeEvent,
};
