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

    var selectedReasoningTitle: String {
        effectiveReasoningEffort.map(TurnComposerMetaMapper.reasoningTitle(for:)) ?? "Select reasoning"
    }

    var showsSpeedBadgeInModelMenu: Bool {
        supportsFastMode && selectedServiceTier != nil
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
        return TurnComposerRuntimeState(
            reasoningDisplayOptions: reasoningDisplayOptions,
            effectiveReasoningEffort: codex.selectedReasoningEffortForSelectedModel(threadId: threadId),
            selectedReasoningEffort: threadOverride?.overridesReasoning == true
                ? threadOverride?.reasoningEffort
                : codex.selectedReasoningEffort,
            reasoningMenuDisabled: reasoningDisplayOptions.isEmpty || selectedModel == nil,
            selectedServiceTier: codex.effectiveServiceTier(for: threadId),
            supportsFastMode: codex.selectedModelSupportsServiceTier(.fast, threadId: threadId)
        )
    }
}
