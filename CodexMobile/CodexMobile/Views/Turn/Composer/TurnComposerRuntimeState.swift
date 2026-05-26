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
    let selectedAgentRuntimeID: String
    let agentRuntimeOptions: [AgentRuntimeDescriptor]
    let agentRuntimeCapabilities: AgentRuntimeCapabilities
    let isAgentRuntimeLocked: Bool
    let openCodeAgentOptions: [OpenCodeAgentOption]
    let selectedOpenCodeBuildAgentID: String
    let selectedCursorModeID: String
    let agentRuntimeModelProviders: [AgentRuntimeModelProvider]

    var selectedReasoningTitle: String {
        effectiveReasoningEffort.map(TurnComposerMetaMapper.reasoningTitle(for:)) ?? "Select reasoning"
    }

    var selectedAgentRuntimeTitle: String {
        agentRuntimeOptions.first(where: { $0.id == selectedAgentRuntimeID })?.displayName ?? "Codex"
    }

    var selectedOpenCodeBuildAgentTitle: String {
        openCodeAgentOptions.first(where: { $0.id == selectedOpenCodeBuildAgentID })?.displayName
            ?? selectedOpenCodeBuildAgentID.capitalized
    }

    var selectedCursorModeTitle: String {
        CursorComposerModeOption.all.first(where: { $0.id == selectedCursorModeID })?.displayName ?? "None"
    }

    var selectedAgentRuntimeStatusMessage: String? {
        agentRuntimeOptions.first(where: { $0.id == selectedAgentRuntimeID })?.statusMessage
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
        reasoningDisplayOptions: [TurnComposerReasoningDisplayOption],
        thread: CodexThread?,
        isAgentRuntimeLocked: Bool
    ) -> TurnComposerRuntimeState {
        let lockedThread = isAgentRuntimeLocked ? thread : nil
        let runtimeID = codex.effectiveAgentRuntimeID(for: lockedThread)
        let selectedModel = codex.selectedModelOption(for: lockedThread)
        let effectiveReasoningEffort = runtimeID == "codex"
            ? codex.selectedReasoningEffortForSelectedModel(thread: lockedThread)
            : nil
        let selectedServiceTier = runtimeID == "codex"
            ? codex.effectiveServiceTier(for: lockedThread)
            : nil
        return TurnComposerRuntimeState(
            reasoningDisplayOptions: reasoningDisplayOptions,
            effectiveReasoningEffort: effectiveReasoningEffort,
            selectedReasoningEffort: effectiveReasoningEffort,
            reasoningMenuDisabled: runtimeID != "codex" || reasoningDisplayOptions.isEmpty || selectedModel == nil,
            selectedServiceTier: selectedServiceTier,
            supportsFastMode: runtimeID == "codex" && codex.selectedModelSupportsServiceTier(.fast, for: lockedThread),
            selectedAgentRuntimeID: runtimeID,
            agentRuntimeOptions: codex.agentRuntimeOptionsForComposer(),
            agentRuntimeCapabilities: codex.effectiveAgentRuntimeCapabilities(for: lockedThread),
            isAgentRuntimeLocked: isAgentRuntimeLocked,
            openCodeAgentOptions: codex.openCodeAgentOptions(for: lockedThread),
            selectedOpenCodeBuildAgentID: codex.effectiveOpenCodeBuildAgentName(for: lockedThread),
            selectedCursorModeID: codex.effectiveCursorMode(for: lockedThread),
            agentRuntimeModelProviders: codex.agentRuntimeModelProviders(for: lockedThread)
        )
    }
}
