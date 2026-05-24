// FILE: TurnComposerRuntimeActions.swift
// Purpose: Centralizes the composer runtime selection callbacks shared across nested views.
// Layer: View Helper
// Exports: TurnComposerRuntimeActions
// Depends on: CodexService, CodexServiceTier

import Foundation

struct TurnComposerRuntimeActions {
    let selectModel: (String) -> Void
    let selectProvider: (String) -> Void
    let selectAutomaticReasoning: () -> Void
    let selectReasoning: (String) -> Void
    let selectServiceTier: (CodexServiceTier?) -> Void
    let selectAgentRuntime: (String) -> Void

    static func resolve(codex: CodexService, thread: CodexThread?) -> TurnComposerRuntimeActions {
        TurnComposerRuntimeActions(
            selectModel: { modelID in codex.setSelectedRuntimeModelId(modelID, for: thread) },
            selectProvider: { providerID in codex.setSelectedRuntimeProviderId(providerID, for: thread) },
            selectAutomaticReasoning: { codex.setSelectedReasoningEffort(nil) },
            selectReasoning: { effort in codex.setSelectedReasoningEffort(effort) },
            selectServiceTier: codex.setSelectedServiceTier,
            selectAgentRuntime: codex.setSelectedAgentRuntimeForNewThreads
        )
    }
}
