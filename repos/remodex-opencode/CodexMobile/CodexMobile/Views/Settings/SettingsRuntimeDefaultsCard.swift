// FILE: SettingsRuntimeDefaultsCard.swift
// Purpose: Presents default model, reasoning, speed, access, and git-writer settings.
// Layer: Settings UI component
// Exports: SettingsRuntimeDefaultsCard
// Depends on: SwiftUI, CodexService runtime configuration, TurnComposerMetaMapper

import SwiftUI

struct SettingsRuntimeDefaultsCard: View {
    @Environment(CodexService.self) private var codex

    private let runtimeAutoValue = "__AUTO__"
    private let runtimeNormalValue = "__NORMAL__"
    private let settingsAccentColor = Color.primary

    var body: some View {
        SettingsCard(title: "Runtime defaults") {
            Picker("Model", selection: runtimeModelSelection) {
                Text("Auto").tag(runtimeAutoValue)
                ForEach(runtimeModelOptions, id: \.selectionKey) { model in
                    Text(TurnComposerMetaMapper.settingsModelLabel(for: model))
                        .tag(model.selectionKey)
                }
            }
            .pickerStyle(.menu)
            .tint(settingsAccentColor)

            if showsOpenCodeAgentPicker {
                Picker("OpenCode agent", selection: defaultOpenCodeAgentSelection) {
                    ForEach(codex.availableAgents, id: \.id) { agent in
                        Text(TurnComposerMetaMapper.agentTitle(for: agent.id))
                            .tag(agent.id)
                    }
                }
                .pickerStyle(.menu)
                .tint(settingsAccentColor)

                Text("Default OpenCode agent for new chats.")
                    .font(AppFont.caption())
                    .foregroundStyle(.secondary)
            }

            Picker("Reasoning", selection: runtimeReasoningSelection) {
                Text("Auto").tag(runtimeAutoValue)
                ForEach(runtimeReasoningOptions, id: \.id) { option in
                    Text(option.title).tag(option.effort)
                }
            }
            .pickerStyle(.menu)
            .tint(settingsAccentColor)
            .disabled(runtimeReasoningOptions.isEmpty)

            if codex.selectedModelSupportsServiceTier(.fast) {
                Picker("Speed", selection: runtimeServiceTierSelection) {
                    Text("Normal").tag(runtimeNormalValue)
                    ForEach(CodexServiceTier.allCases, id: \.rawValue) { tier in
                        Text(tier.displayName).tag(tier.rawValue)
                    }
                }
                .pickerStyle(.menu)
                .tint(settingsAccentColor)
            }

            Picker("Access", selection: runtimeAccessSelection) {
                ForEach(CodexAccessMode.allCases, id: \.self) { mode in
                    Text(mode.displayName).tag(mode)
                }
            }
            .pickerStyle(.menu)
            .tint(settingsAccentColor)

            Picker("Git writer model", selection: gitWriterModelSelection) {
                ForEach(gitWriterModelOptions, id: \.selectionKey) { model in
                    Text(TurnComposerMetaMapper.modelTitle(for: model))
                        .tag(model.selectionKey)
                }
            }
            .pickerStyle(.menu)
            .tint(settingsAccentColor)
            .disabled(!isGitWriterModelPickerEnabled)

            Text("Used for AI-generated commit messages and PR drafts on Codex. OpenCode threads still use Codex git writer models on the bridge.")
                .font(AppFont.caption())
                .foregroundStyle(.secondary)

            if let opencodeRuntime = codex.availableRuntimes.first(where: {
                CodexModelOption.normalizedProvider($0.id) == "opencode"
            }) {
                Text(openCodeRuntimeFootnote(opencodeRuntime))
                    .font(AppFont.caption())
                    .foregroundStyle(.secondary)
            }

            Text("Configure MCP in OpenCode on your Mac — not from Remodex.")
                .font(AppFont.caption())
                .foregroundStyle(.secondary)
        }
        .task {
            guard codex.isConnected, codex.isInitialized else { return }
            await withTaskGroup(of: Void.self) { group in
                group.addTask { try? await codex.fetchRuntimeCatalog() }
                group.addTask { try? await codex.listModels(refreshProviders: true) }
            }
        }
    }

    private func openCodeRuntimeFootnote(_ runtime: RuntimeInfo) -> String {
        let details = runtime.opencode
        let discoveryReason = codex.openCodeProviderDiscoveryReasonCode
            ?? details?.providerDiscoveryReasonCode

        if discoveryReason == "no_connected_providers" {
            return "Connect providers in OpenCode on your Mac."
        }

        if discoveryReason == "provider_list_failed" || discoveryReason == "unknown" {
            return runtime.unavailableReason ?? "OpenCode provider list is unavailable on this Mac."
        }

        if runtime.enabled {
            var summary = ComposerCapabilityCopy.openCodeStatusSummary(
                version: details?.version,
                minVersion: details?.minVersion,
                handoffEnvEnabled: details?.handoffEnvEnabled ?? false
            )
            if discoveryReason == "ok",
               let connected = details?.connectedProviders,
               !connected.isEmpty {
                let names = connected.map(\.displayName).joined(separator: ", ")
                summary += " · Connected on Mac: \(names)"
            } else if let auth = details?.authConfigured {
                summary += auth ? " · Providers connected on Mac" : " · No providers connected on Mac"
            } else {
                summary += " · Provider status unknown"
            }
            if details?.versionBelowMinimum == true {
                summary += " · Upgrade OpenCode on your Mac"
            }
            return summary
        }
        return runtime.unavailableReason ?? "OpenCode is not available on this Mac bridge."
    }

    private var showsOpenCodeAgentPicker: Bool {
        guard let opencodeRuntime = codex.availableRuntimes.first(where: {
            CodexModelOption.normalizedProvider($0.id) == "opencode"
        }) else {
            return false
        }
        return opencodeRuntime.enabled && !codex.availableAgents.isEmpty
    }

    private var runtimeModelOptions: [CodexModelOption] {
        TurnComposerMetaMapper.orderedModels(from: codex.availableModels)
    }

    private var runtimeReasoningOptions: [TurnComposerReasoningDisplayOption] {
        TurnComposerMetaMapper.reasoningDisplayOptions(
            from: codex.supportedReasoningEffortsForSelectedModel().map(\.reasoningEffort)
        )
    }

    private var runtimeModelSelection: Binding<String> {
        Binding(
            get: { codex.selectedModelOption()?.selectionKey ?? runtimeAutoValue },
            set: { selection in
                codex.setSelectedModelId(selection == runtimeAutoValue ? nil : selection)
            }
        )
    }

    private var defaultOpenCodeAgentSelection: Binding<String> {
        Binding(
            get: {
                codex.defaultOpenCodeAgentId
                    ?? codex.availableAgents.first?.id
                    ?? "build"
            },
            set: { codex.setDefaultOpenCodeAgent($0) }
        )
    }

    private var runtimeReasoningSelection: Binding<String> {
        Binding(
            get: { codex.selectedReasoningEffort ?? runtimeAutoValue },
            set: { selection in
                codex.setSelectedReasoningEffort(selection == runtimeAutoValue ? nil : selection)
            }
        )
    }

    private var runtimeAccessSelection: Binding<CodexAccessMode> {
        Binding(
            get: { codex.selectedAccessMode },
            set: { codex.setSelectedAccessMode($0) }
        )
    }

    private var runtimeServiceTierSelection: Binding<String> {
        Binding(
            get: { codex.selectedServiceTier?.rawValue ?? runtimeNormalValue },
            set: { selection in
                codex.setSelectedServiceTier(
                    selection == runtimeNormalValue ? nil : CodexServiceTier(rawValue: selection)
                )
            }
        )
    }

    private var gitWriterModelOptions: [CodexModelOption] {
        let codexOnly = codex.availableModels.filter {
            CodexModelOption.normalizedProvider($0.modelProvider) == "codex"
        }
        return TurnComposerMetaMapper.orderedModels(from: codexOnly)
    }

    private var isGitWriterModelPickerEnabled: Bool {
        !gitWriterModelOptions.isEmpty
    }

    private var gitWriterModelSelection: Binding<String> {
        Binding(
            get: { codex.selectedGitWriterModelOption()?.selectionKey ?? gitWriterModelOptions.first?.selectionKey ?? "" },
            set: { codex.setSelectedGitWriterModelId($0.isEmpty ? nil : $0) }
        )
    }
}
