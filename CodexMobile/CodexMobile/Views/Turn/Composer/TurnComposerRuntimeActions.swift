// FILE: TurnComposerRuntimeActions.swift
// Purpose: Centralizes the composer runtime selection callbacks shared across nested views.
// Layer: View Helper
// Exports: TurnComposerRuntimeActions
// Depends on: CodexService, CodexServiceTier

import Foundation

struct TurnComposerRuntimeActions {
    let selectModel: (String) -> Void
    let selectAutomaticReasoning: () -> Void
    let selectReasoning: (String) -> Void
    let selectServiceTier: (CodexServiceTier?) -> Void
    let selectAgent: (String?) -> Void
    let selectVariant: (String?) -> Void

    static func resolve(
        codex: CodexService,
        threadId: String? = nil
    ) -> TurnComposerRuntimeActions {
        TurnComposerRuntimeActions(
            selectModel: codex.setSelectedModelId,
            selectAutomaticReasoning: {
                if let threadId {
                    codex.clearThreadReasoningEffortOverride(for: threadId)
                } else {
                    codex.setSelectedReasoningEffort(nil)
                }
            },
            selectReasoning: { effort in
                if let threadId {
                    codex.setThreadReasoningEffortOverride(effort, for: threadId)
                } else {
                    codex.setSelectedReasoningEffort(effort)
                }
            },
            selectServiceTier: { serviceTier in
                if let threadId {
                    codex.setThreadServiceTierOverride(serviceTier, for: threadId)
                } else {
                    codex.setSelectedServiceTier(serviceTier)
                }
            },
            selectAgent: { agentId in
                if let threadId {
                    codex.setThreadAgentIdOverride(agentId, for: threadId)
                } else {
                    codex.setSelectedAgentId(agentId)
                }
            },
            selectVariant: { variantId in
                if let threadId {
                    codex.setThreadVariantIdOverride(variantId, for: threadId)
                } else {
                    codex.setSelectedVariantId(variantId)
                }
            }
        )
    }
}
