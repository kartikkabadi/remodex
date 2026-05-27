// FILE: TurnComposerRuntimeUIKitMenu.swift
// Purpose: Builds the hierarchical UIKit menu for the composer runtime pill
//          (Model / Intelligence / Speed / Agent) consumed by UIKitMenuButton.
// Layer: View Helper
// Exports: TurnComposerRuntimeUIKitMenuBuilder
// Depends on: UIKit, TurnComposerRuntimeState, TurnComposerRuntimeActions,
//             TurnComposerMetaMapper, CodexModelOption, CodexServiceTier,
//             HapticFeedback
//
// Design notes
// ------------
// * Top-level menu has four submenus: Model, Intelligence, Speed, Agent. Each
//   parent carries `subtitle:` (current selection) so the row renders as the
//   "Label / Value / >" pill you see in the screenshot.
// * Submenus use `UIMenu.Options.singleSelection` so UIKit draws/clears the
//   checkmarks for us. We pass `.on` for the active item as a hint; UIKit
//   reconciles state when singleSelection is set.
// * Long model lists keep the existing "featured + Other models…" split so the
//   menu stays glanceable. The "Other models" action opens the existing
//   SwiftUI sheet via an injected callback.
// * The Agent submenu is visible only for OpenCode threads
//   (isOpenCodeThread == true). For Codex/standard threads it returns nil.
// * The Intelligence menu adapts to the runtime: variant selection for OpenCode,
//   reasoning effort for Codex.
// * The Speed menu adapts to the runtime: fast model selection for OpenCode,
//   service tier for Codex.
// * The Model menu groups options by providerId when the data is available.

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
        let featuredModelIdentifiers: Set<String>
        let onRequestAllModelsSheet: () -> Void
    }

    static func makeMenu(_ input: Input) -> UIMenu {
        var children: [UIMenuElement] = []

        children.append(modelMenu(input))

        if let intelligenceMenu = intelligenceMenu(input) {
            children.append(intelligenceMenu)
        }

        if let speedMenu = speedMenu(input) {
            children.append(speedMenu)
        }

        if let agentMenu = agentMenu(input) {
            children.append(agentMenu)
        }

        return UIMenu(title: "", options: [.displayInline], children: children)
    }

    // MARK: - Model

    private static func modelMenu(_ input: Input) -> UIMenu {
        let subtitle: String
        if input.selectedModelID == nil {
            subtitle = input.isRuntimeSelectionLoading ? "Loading…" : "Select model"
        } else {
            subtitle = input.selectedModelTitle
        }

        let modelChildren: [UIMenuElement] = {
            if input.isLoadingModels {
                return [
                    disabledInfoAction(title: "Loading models…"),
                ]
            }
            if input.orderedModelOptions.isEmpty {
                return [
                    disabledInfoAction(title: "No models available"),
                ]
            }

            let grouped = Dictionary(grouping: input.orderedModelOptions) { model in
                model.providerId ?? ""
            }
            let sortedKeys = grouped.keys.sorted()

            if sortedKeys.count > 1 || (sortedKeys.count == 1 && sortedKeys[0] != "") {
                var items: [UIMenuElement] = []
                for key in sortedKeys {
                    let models = grouped[key]!
                    let providerName = key.isEmpty ? "Other" : key
                    let providerChildren = models.map { model in
                        modelAction(model: model, input: input)
                    }
                    let submenu = UIMenu(
                        title: providerName,
                        options: [.singleSelection],
                        children: providerChildren
                    )
                    items.append(submenu)
                }
                return items
            }

            let featured = featuredOrderedModels(input)
            var items: [UIMenuElement] = featured.map { model in
                modelAction(model: model, input: input)
            }

            let hasOthers = input.orderedModelOptions.contains { model in
                !featured.contains(where: { $0.id == model.id })
            }
            if hasOthers {
                items.append(
                    UIAction(
                        title: "Other models…",
                        image: RemodexIcon.menuUIImage(systemName: "ellipsis")
                    ) { _ in
                        HapticFeedback.shared.triggerImpactFeedback(style: .light)
                        input.onRequestAllModelsSheet()
                    }
                )
            }
            return items
        }()

        return UIMenu(
            title: "Model",
            subtitle: subtitle,
            image: RemodexIcon.menuUIImage(systemName: "cube"),
            options: [.singleSelection],
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
            state: model.id == input.selectedModelID ? .on : .off
        ) { _ in
            HapticFeedback.shared.triggerImpactFeedback(style: .light)
            input.runtimeActions.selectModel(model.id)
        }
    }

    private static func featuredOrderedModels(_ input: Input) -> [CodexModelOption] {
        var seen = Set<String>()
        var result: [CodexModelOption] = []

        for model in input.orderedModelOptions {
            let normalizedID = model.id.lowercased()
            let normalizedModel = model.model.lowercased()
            let isFeatured = input.featuredModelIdentifiers.contains(normalizedID)
                || input.featuredModelIdentifiers.contains(normalizedModel)
            guard isFeatured, seen.insert(model.id).inserted else { continue }
            result.append(model)
        }

        if let selectedID = input.selectedModelID,
           seen.insert(selectedID).inserted,
           let selected = input.orderedModelOptions.first(where: { $0.id == selectedID }) {
            result.append(selected)
        }
        return result
    }

    // MARK: - Intelligence

    private static func intelligenceMenu(_ input: Input) -> UIMenu? {
        if input.runtimeState.isOpenCodeThread {
            return openCodeIntelligenceMenu(input)
        }
        return codexIntelligenceMenu(input)
    }

    private static func openCodeIntelligenceMenu(_ input: Input) -> UIMenu? {
        let variants = input.runtimeState.orderedVariantOptions
        guard !variants.isEmpty else { return nil }

        let actions: [UIMenuElement] = variants.map { variant in
            UIAction(
                title: variant.displayName,
                state: input.runtimeState.isSelectedVariant(variant.id) ? .on : .off
            ) { _ in
                HapticFeedback.shared.triggerImpactFeedback(style: .light)
                input.runtimeActions.selectVariant(variant.id)
            }
        }

        let subtitle = input.runtimeState.selectedVariantID
            .flatMap { id in variants.first(where: { $0.id == id })?.displayName }
            ?? "Select variant"

        return UIMenu(
            title: "Intelligence",
            subtitle: subtitle,
            image: RemodexIcon.menuUIImage(systemName: "brain"),
            options: [.singleSelection],
            children: actions
        )
    }

    private static func codexIntelligenceMenu(_ input: Input) -> UIMenu? {
        let options = input.runtimeState.reasoningDisplayOptions
        guard !options.isEmpty else { return nil }

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
        if input.runtimeState.isOpenCodeThread {
            return openCodeSpeedMenu(input)
        }
        return codexSpeedMenu(input)
    }

    private static func openCodeSpeedMenu(_ input: Input) -> UIMenu? {
        let fastModels = input.orderedModelOptions.filter { $0.supportsFastMode }
        guard !fastModels.isEmpty else { return nil }

        let actions: [UIMenuElement] = fastModels.map { model in
            let title = TurnComposerMetaMapper.modelTitle(for: model)
            return UIAction(
                title: title,
                state: model.id == input.selectedModelID ? .on : .off
            ) { _ in
                HapticFeedback.shared.triggerImpactFeedback(style: .light)
                input.runtimeActions.selectModel(model.id)
            }
        }

        let subtitle: String = {
            if let selectedID = input.selectedModelID,
               fastModels.contains(where: { $0.id == selectedID }),
               let model = input.orderedModelOptions.first(where: { $0.id == selectedID }) {
                return TurnComposerMetaMapper.modelTitle(for: model)
            }
            return "Select fast model"
        }()

        return UIMenu(
            title: "Speed",
            subtitle: subtitle,
            image: UIImage(systemName: "bolt.fill"),
            options: [.singleSelection],
            children: actions
        )
    }

    private static func codexSpeedMenu(_ input: Input) -> UIMenu? {
        guard input.runtimeState.supportsFastMode else { return nil }

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

    // MARK: - Agent

    private static func agentMenu(_ input: Input) -> UIMenu? {
        guard input.runtimeState.isOpenCodeThread else { return nil }
        let agents = input.runtimeState.orderedAgentOptions
        guard !agents.isEmpty else {
            if let errorMessage = input.runtimeState.agentsErrorMessage?
                .trimmingCharacters(in: .whitespacesAndNewlines),
               !errorMessage.isEmpty {
                return UIMenu(title: "Agent", subtitle: "Unavailable", children: [
                    disabledInfoAction(title: errorMessage),
                ])
            }
            if input.runtimeState.isAgentListLoading {
                return UIMenu(title: "Agent", subtitle: "Loading…", children: [
                    disabledInfoAction(title: "Loading agents…"),
                ])
            }
            return UIMenu(title: "Agent", subtitle: "No agents", children: [
                disabledInfoAction(title: "No agents available from this bridge."),
            ])
        }

        let actions: [UIMenuElement] = agents.map { agent in
            let action = UIAction(
                title: agent.displayName,
                state: input.runtimeState.isSelectedAgent(agent.id) ? .on : .off
            ) { _ in
                HapticFeedback.shared.triggerImpactFeedback(style: .light)
                input.runtimeActions.selectAgent(agent.id)
            }
            if input.runtimeState.agentMenuDisabled {
                action.attributes.insert(.disabled)
            }
            return action
        }

        return UIMenu(
            title: "Agent",
            subtitle: input.runtimeState.selectedAgentTitle,
            image: RemodexIcon.menuUIImage(systemName: "person.2"),
            options: [.singleSelection],
            children: actions
        )
    }

    // MARK: - Helpers

    private static func disabledInfoAction(title: String) -> UIAction {
        let action = UIAction(title: title) { _ in }
        action.attributes.insert(.disabled)
        return action
    }
}
