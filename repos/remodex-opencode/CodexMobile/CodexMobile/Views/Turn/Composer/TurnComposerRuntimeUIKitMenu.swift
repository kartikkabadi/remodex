// FILE: TurnComposerRuntimeUIKitMenu.swift
// Purpose: Builds the hierarchical UIKit menu for the composer runtime pill
//          (Model / Intelligence / Speed) consumed by UIKitMenuButton.
// Layer: View Helper
// Exports: TurnComposerRuntimeUIKitMenuBuilder
// Depends on: UIKit, TurnComposerRuntimeState, TurnComposerRuntimeActions,
//             TurnComposerMetaMapper, CodexModelOption, CodexServiceTier,
//             HapticFeedback, ComposerCapabilityCopy

import UIKit

enum TurnComposerRuntimeUIKitMenuBuilder {

    struct Input {
        let runtimeState: TurnComposerRuntimeState
        let runtimeActions: TurnComposerRuntimeActions
        let orderedModelOptions: [CodexModelOption]
        let selectedModelID: String?
        let selectedModelTitle: String
        let isLoadingModels: Bool
        let isRuntimeSelectionLoading: Bool
    }

    static func makeMenu(_ input: Input) -> UIMenu {
        var children: [UIMenuElement] = []

        children.append(modelMenu(input))

        if let agentMenu = agentMenu(input) {
            children.append(agentMenu)
        }

        if let intelligenceMenu = intelligenceMenu(input) {
            children.append(intelligenceMenu)
        }

        if let speedMenu = speedMenu(input) {
            children.append(speedMenu)
        }

        return UIMenu(title: "", options: [.displayInline], children: children)
    }

    // MARK: - Model

    private static func modelMenu(_ input: Input) -> UIMenu {
        let subtitle: String
        if input.selectedModelID == nil {
            subtitle = input.isRuntimeSelectionLoading ? "Loading..." : "Select model"
        } else {
            subtitle = input.selectedModelTitle
        }

        let modelChildren: [UIMenuElement] = {
            if input.isLoadingModels {
                return [
                    disabledInfoAction(title: "Loading models..."),
                ]
            }
            if input.orderedModelOptions.isEmpty {
                return [
                    disabledInfoAction(title: "No models available"),
                ]
            }

            return providerMenus(input)
        }()

        return UIMenu(
            title: "Model",
            subtitle: subtitle,
            image: RemodexIcon.menuUIImage(systemName: "cube"),
            options: [],
            children: modelChildren
        )
    }

    private static func modelAction(model: CodexModelOption, input: Input) -> UIAction {
        let title = TurnComposerMetaMapper.modelTitle(for: model)
        let image: UIImage? = model.supportsServiceTier(.fast)
            ? UIImage(systemName: CodexServiceTier.fast.iconName)
            : nil

        return UIAction(
            title: title,
            image: image,
            state: model.selectionKey == input.selectedModelID ? .on : .off
        ) { _ in
            HapticFeedback.shared.triggerImpactFeedback(style: .light)
            input.runtimeActions.selectModel(model.selectionKey)
        }
    }

    private static func providerMenus(_ input: Input) -> [UIMenuElement] {
        let grouped = Dictionary(grouping: input.orderedModelOptions, by: \.modelProvider)
        let providers = grouped.keys.sorted { lhs, rhs in
            let lhsRank = providerRank(lhs)
            let rhsRank = providerRank(rhs)
            if lhsRank == rhsRank {
                return TurnComposerMetaMapper.providerTitle(for: lhs) < TurnComposerMetaMapper.providerTitle(for: rhs)
            }
            return lhsRank < rhsRank
        }

        return providers.compactMap { provider in
            guard let models = grouped[provider], !models.isEmpty else { return nil }
            let providerTitle = TurnComposerMetaMapper.providerTitle(for: provider)
            let normalizedProvider = CodexModelOption.normalizedProvider(provider)

            if input.runtimeState.disabledProviderIDs.contains(normalizedProvider) {
                let rawReason = input.runtimeState.unavailableReasonByProviderID[normalizedProvider]
                let unavailable = ComposerCapabilityCopy.runtimeUnavailableMessage(rawReason)
                return UIMenu(
                    title: providerTitle,
                    image: RuntimeProviderLogo.menuUIImage(provider: provider),
                    options: [],
                    children: [disabledInfoAction(title: unavailable.title)]
                )
            }

            return UIMenu(
                title: providerTitle,
                image: RuntimeProviderLogo.menuUIImage(provider: provider),
                options: [.singleSelection],
                children: models.map { model in
                    modelAction(model: model, input: input)
                }
            )
        }
    }

    private static func providerRank(_ provider: String) -> Int {
        switch CodexModelOption.normalizedProvider(provider) {
        case "codex":
            return 0
        case "opencode":
            return 1
        case "claude":
            return 2
        default:
            return 100
        }
    }

    // MARK: - Agent

    private static func agentMenu(_ input: Input) -> UIMenu? {
        let agents = input.runtimeState.availableAgents
        guard !agents.isEmpty else { return nil }

        let selectedId = input.runtimeState.selectedAgent ?? agents.first?.id
        let actions: [UIMenuElement] = agents.map { agent in
            UIAction(
                title: agent.displayName,
                state: agent.id == selectedId ? .on : .off
            ) { _ in
                HapticFeedback.shared.triggerImpactFeedback(style: .light)
                input.runtimeActions.selectAgent(agent.id)
            }
        }

        let subtitle = agents.first(where: { $0.id == selectedId })?.displayName
            ?? agents.first?.displayName

        return UIMenu(
            title: "Agent",
            subtitle: subtitle,
            image: RemodexIcon.menuUIImage(systemName: "person.and.arrow.left.and.arrow.right"),
            options: [.singleSelection],
            children: actions
        )
    }

    private static func intelligenceMenu(_ input: Input) -> UIMenu? {
        let options = input.runtimeState.reasoningDisplayOptions
        if options.isEmpty {
            if input.runtimeState.capabilities.supportsReasoningEffort {
                return disabledSubmenu(
                    title: "Intelligence",
                    subtitle: "Unavailable",
                    image: RemodexIcon.menuUIImage(systemName: "brain"),
                    reason: ComposerCapabilityCopy.capabilityReason(for: .reasoningEffort)
                )
            }
            return nil
        }

        let actions: [UIMenuElement] = options.map { option in
            let action = UIAction(
                title: option.title,
                state: input.runtimeState.isSelectedReasoning(option.effort) ? .on : .off
            ) { _ in
                HapticFeedback.shared.triggerImpactFeedback(style: .light)
                input.runtimeActions.selectReasoning(option.effort)
            }
            if input.runtimeState.reasoningMenuDisabled {
                action.attributes.insert(.disabled)
            }
            return action
        }

        return UIMenu(
            title: "Intelligence",
            subtitle: input.runtimeState.selectedReasoningTitle,
            image: RemodexIcon.menuUIImage(systemName: "brain"),
            options: [.singleSelection],
            children: actions
        )
    }

    // MARK: - Speed

    private static func speedMenu(_ input: Input) -> UIMenu? {
        let selectedModelCapabilities = modelCapabilitiesForSelectedModel(input)
        guard input.runtimeState.capabilities.supportsFastMode else {
            return disabledSubmenu(
                title: "Speed",
                subtitle: "Unavailable",
                image: UIImage(systemName: "bolt.fill"),
                reason: ComposerCapabilityCopy.capabilityReason(for: .fastMode)
            )
        }
        guard selectedModelCapabilities?.supportsFastMode ?? true else {
            return disabledSubmenu(
                title: "Speed",
                subtitle: "Unavailable",
                image: UIImage(systemName: "bolt.fill"),
                reason: ComposerCapabilityCopy.capabilityReason(for: .fastMode)
            )
        }

        let normalAction = UIAction(
            title: "Normal",
            state: input.runtimeState.isSelectedServiceTier(nil) ? .on : .off
        ) { _ in
            HapticFeedback.shared.triggerImpactFeedback(style: .light)
            input.runtimeActions.selectServiceTier(nil)
        }

        let tierActions: [UIMenuElement] = CodexServiceTier.allCases.map { tier in
            UIAction(
                title: tier.displayName,
                image: tier == .fast
                    ? UIImage(systemName: tier.iconName)
                    : RemodexIcon.menuUIImage(systemName: tier.iconName),
                state: input.runtimeState.isSelectedServiceTier(tier) ? .on : .off
            ) { _ in
                HapticFeedback.shared.triggerImpactFeedback(style: .light)
                input.runtimeActions.selectServiceTier(tier)
            }
        }

        let subtitle: String = {
            if let tier = input.runtimeState.selectedServiceTier {
                return tier.displayName
            }
            return "Normal"
        }()

        return UIMenu(
            title: "Speed",
            subtitle: subtitle,
            image: UIImage(systemName: "bolt.fill"),
            options: [.singleSelection],
            children: [normalAction] + tierActions
        )
    }

    // MARK: - Helpers

    private static func modelCapabilitiesForSelectedModel(_ input: Input) -> ProviderCapabilities? {
        guard let selectedModelID = input.selectedModelID else { return nil }
        let (provider, modelId) = CodexModelOption.splitSelectionKey(selectedModelID)
        return input.orderedModelOptions.first(where: { option in
            option.modelProvider == provider && option.id == (modelId ?? option.id)
        })?.capabilities
    }

    private static func disabledSubmenu(
        title: String,
        subtitle: String,
        image: UIImage?,
        reason: String
    ) -> UIMenu {
        let action = disabledInfoAction(title: reason)
        return UIMenu(
            title: title,
            subtitle: subtitle,
            image: image,
            options: [],
            children: [action]
        )
    }

    private static func disabledInfoAction(title: String) -> UIAction {
        let action = UIAction(title: title) { _ in }
        action.attributes.insert(.disabled)
        return action
    }
}
