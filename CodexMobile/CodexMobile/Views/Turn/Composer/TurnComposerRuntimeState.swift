// FILE: TurnComposerRuntimeState.swift
// Purpose: Bundles the composer runtime selection state shared by the bottom bar and input context menu.
// Layer: View Helper
// Exports: TurnComposerRuntimeState
// Depends on: CodexService, TurnComposerMetaMapper, CodexServiceTier

import Foundation

struct TurnComposerRuntimeState: Equatable {
    let reasoningDisplayOptions: [TurnComposerReasoningDisplayOption]
    let effectiveReasoningEffort: String?
    let selectedReasoningEffort: String?
    let reasoningMenuDisabled: Bool
    let selectedServiceTier: CodexServiceTier?
    let supportsFastMode: Bool

    let orderedAgentOptions: [AgentOption]
    let selectedAgentID: String?
    let agentMenuDisabled: Bool
    let isAgentListLoading: Bool
    let agentsErrorMessage: String?
    let isOpenCodeBridgeConnected: Bool
    let supportsVariants: Bool

    let orderedVariantOptions: [VariantOption]
    let selectedVariantID: String?
    let variantMenuDisabled: Bool

    var selectedReasoningTitle: String {
        effectiveReasoningEffort.map(TurnComposerMetaMapper.reasoningTitle(for:)) ?? "Select reasoning"
    }

    var selectedAgentTitle: String {
        guard !orderedAgentOptions.isEmpty else {
            return "Select agent"
        }
        guard let id = selectedAgentID else { return "Select agent" }
        return orderedAgentOptions.first(where: { $0.id == id })?.displayName ?? id
    }

    var selectedVariantTitle: String {
        guard let id = selectedVariantID else { return "Select variant" }
        return orderedVariantOptions.first(where: { $0.id == id })?.displayName ?? id
    }

    var showsSpeedBadgeInModelMenu: Bool {
        supportsFastMode && selectedServiceTier != nil
    }

    func isSelectedReasoning(_ effort: String) -> Bool {
        effectiveReasoningEffort == effort
    }

    func isSelectedServiceTier(_ serviceTier: CodexServiceTier?) -> Bool {
        selectedServiceTier == serviceTier
    }

    func isSelectedAgent(_ agentID: String) -> Bool {
        selectedAgentID == agentID
    }

    func isSelectedVariant(_ variantID: String) -> Bool {
        selectedVariantID == variantID
    }

    static func resolve(
        codex: CodexService,
        reasoningDisplayOptions: [TurnComposerReasoningDisplayOption],
        threadId: String? = nil,
        collaborationMode: CodexCollaborationModeKind? = nil
    ) -> TurnComposerRuntimeState {
        let selectedModel = codex.selectedModelOption()
        let variants = selectedModel?.supportedVariants ?? []
        let isOpenCodeBridgeConnected = codex.isOpenCodeBridgeConnected
        let supportsVariants = codex.supportsVariants
        let showsAgentMenu = isOpenCodeBridgeConnected && codex.supportsAgents
        let showsVariantMenu = isOpenCodeBridgeConnected && supportsVariants

        return TurnComposerRuntimeState(
            reasoningDisplayOptions: reasoningDisplayOptions,
            effectiveReasoningEffort: codex.selectedReasoningEffortForSelectedModel(threadId: threadId),
            selectedReasoningEffort: codex.selectedReasoningEffort,
            reasoningMenuDisabled: reasoningDisplayOptions.isEmpty || selectedModel == nil || isOpenCodeBridgeConnected,
            selectedServiceTier: codex.effectiveServiceTier(for: threadId),
            supportsFastMode: codex.selectedModelSupportsServiceTier(.fast) && !isOpenCodeBridgeConnected,
            orderedAgentOptions: codex.availableAgents,
            selectedAgentID: codex.resolvedAgentId(for: threadId, collaborationMode: collaborationMode),
            agentMenuDisabled: !showsAgentMenu || codex.availableAgents.isEmpty,
            isAgentListLoading: codex.isAgentListLoading,
            agentsErrorMessage: codex.agentsErrorMessage,
            isOpenCodeBridgeConnected: isOpenCodeBridgeConnected,
            supportsVariants: supportsVariants,
            orderedVariantOptions: variants,
            selectedVariantID: codex.resolvedVariantId(for: threadId),
            variantMenuDisabled: variants.isEmpty || !showsVariantMenu
        )
    }
}
