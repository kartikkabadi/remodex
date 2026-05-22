// FILE: telegram-bridge-coordinator.js
// Purpose: Future orchestration seam between inbound routing, timeline projection, and outbound delivery.
// Layer: CLI helper
// Exports: createTelegramBridgeCoordinator

/**
 * Placeholder coordinator. Wiring still lives in telegram-adapter.js until the
 * adapter split lands; callers can depend on this export without behavior change.
 */
function createTelegramBridgeCoordinator() {
  return {
    projectTimelineEvent() {
      throw new Error("telegram-bridge-coordinator is not wired yet.");
    },
  };
}

module.exports = {
  createTelegramBridgeCoordinator,
};
