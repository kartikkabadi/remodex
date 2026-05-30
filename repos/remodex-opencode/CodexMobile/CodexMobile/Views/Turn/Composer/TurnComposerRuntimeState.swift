// FILE: TurnComposerRuntimeState.swift
// Purpose: Bundles the composer runtime selection state shared by the bottom bar and input context menu.
// Layer: View Helper
// Exports: TurnComposerRuntimeState, AgentOption
// Depends on: CodexService, TurnComposerMetaMapper, CodexServiceTier

import Foundation

struct AgentOption: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let displayName: String

    init(id: String, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

struct TurnComposerRuntimeState: Equatable {
    let reasoningDisplayOptions: [TurnComposerReasoningDisplayOption]
    let effectiveReasoningEffort: String?
    let selectedReasoningEffort: String?
    let reasoningMenuDisabled: Bool
    let selectedServiceTier: CodexServiceTier?
    let capabilities: ProviderCapabilities
    let availableAgents: [AgentOption]
    let selectedAgent: String?
    let isRuntimeEnabled: Bool
    let runtimeUnavailableReason: String?
    let disabledProviderIDs: Set<String>
    let unavailableReasonByProviderID: [String: String]
    let showsBetaLabel: Bool

    var selectedReasoningTitle: String {
        effectiveReasoningEffort.map(TurnComposerMetaMapper.reasoningTitle(for:)) ?? "Select reasoning"
    }

    var showsSpeedBadgeInModelMenu: Bool {
        capabilities.supportsFastMode && selectedServiceTier != nil
    }

    func isSelectedReasoning(_ effort: String) -> Bool {
        (selectedReasoningEffort ?? effectiveReasoningEffort) == effort
    }

    func isSelectedServiceTier(_ serviceTier: CodexServiceTier?) -> Bool {
        selectedServiceTier == serviceTier
    }

    static func resolve(
        codex: CodexService,
        threadId: String? = nil,
        reasoningDisplayOptions: [TurnComposerReasoningDisplayOption]
    ) -> TurnComposerRuntimeState {
        let selectedModel = codex.selectedModelOption(threadId: threadId)
        let threadOverride = codex.threadRuntimeOverride(for: threadId)
        let capabilities = selectedModel?.capabilities
        let currentProviderId = CodexModelOption.normalizedProvider(selectedModel?.modelProvider ?? "codex")
        let runtimeInfo = codex.availableRuntimes.first(where: {
            CodexModelOption.normalizedProvider($0.id) == currentProviderId
        })
        let isRuntimeEnabled = runtimeInfo?.enabled ?? true
        let runtimeUnavailableReason = runtimeInfo?.unavailableReason
        let resolvedCapabilities = capabilities ?? ProviderCapabilities.defaultCodex
        let disabledProviderIDs = Set(
            codex.availableRuntimes
                .filter { !$0.enabled }
                .map { CodexModelOption.normalizedProvider($0.id) }
        )
        let unavailableReasonByProviderID: [String: String] = Dictionary(
            uniqueKeysWithValues: codex.availableRuntimes.compactMap { runtime -> (String, String)? in
                guard !runtime.enabled else { return nil }
                let providerID = CodexModelOption.normalizedProvider(runtime.id)
                return (providerID, runtime.unavailableReason ?? "")
            }
        )
        return TurnComposerRuntimeState(
            reasoningDisplayOptions: reasoningDisplayOptions,
            effectiveReasoningEffort: codex.selectedReasoningEffortForSelectedModel(threadId: threadId),
            selectedReasoningEffort: threadOverride?.overridesReasoning == true
                ? threadOverride?.reasoningEffort
                : codex.selectedReasoningEffort,
            reasoningMenuDisabled: reasoningDisplayOptions.isEmpty || selectedModel == nil,
            selectedServiceTier: codex.effectiveServiceTier(for: threadId),
            capabilities: resolvedCapabilities,
            availableAgents: codex.availableAgents,
            selectedAgent: codex.effectiveOpenCodeAgent(threadId: threadId),
            isRuntimeEnabled: isRuntimeEnabled,
            runtimeUnavailableReason: runtimeUnavailableReason,
            disabledProviderIDs: disabledProviderIDs,
            unavailableReasonByProviderID: unavailableReasonByProviderID,
            showsBetaLabel: codex.showsBetaLabel(forProvider: currentProviderId)
        )
    }
}
