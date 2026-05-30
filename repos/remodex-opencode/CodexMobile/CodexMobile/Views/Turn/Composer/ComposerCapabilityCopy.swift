// FILE: ComposerCapabilityCopy.swift
// Purpose: User-facing capability grey-out and runtime-unavailable copy for the composer.
// Layer: View Helper
// Exports: ComposerCapability, ComposerCapabilityCopy
// Depends on: Foundation, ProviderCapabilities

import Foundation

enum ComposerCapability {
    case voice
    case planMode
    case fastMode
    case slashCommands
    case reasoningEffort
    case agentSelection
}

enum ComposerCapabilityCopy {
    static func capabilityReason(for capability: ComposerCapability) -> String {
        switch capability {
        case .voice:
            return "Voice not supported by this runtime"
        case .planMode:
            return "Plan mode not supported by this runtime"
        case .fastMode:
            return "Fast mode not supported by this model"
        case .slashCommands:
            return "Slash commands not supported by this runtime"
        case .reasoningEffort:
            return "This model does not support reasoning effort levels"
        case .agentSelection:
            return "Agent selection not supported by this runtime"
        }
    }

    static func capabilityReasonWhenAgentSelectionUnavailable(capabilities: ProviderCapabilities) -> String {
        capabilities.supportsAgentSelection
            ? "No agents available for this runtime"
            : capabilityReason(for: .agentSelection)
    }

    static func runtimeUnavailableMessage(_ rawReason: String?) -> (title: String, hint: String?) {
        let trimmed = rawReason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else {
            return ("Runtime unavailable", nil)
        }

        let normalized = trimmed.lowercased()
        if normalized.contains("not enabled") {
            return (trimmed, "Enable OpenCode on your Mac bridge to use this runtime.")
        }
        if normalized.contains("not installed") {
            return ("OpenCode isn't installed on your Mac", "Install OpenCode on the paired Mac, then reconnect.")
        }
        if normalized.contains("agents could not be listed") {
            return (trimmed, "Check OpenCode on your Mac, then refresh the connection.")
        }
        return (trimmed, nil)
    }
}
