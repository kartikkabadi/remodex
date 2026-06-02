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
    case skillAutocomplete
    case steer
    case queue
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
        case .skillAutocomplete:
            return "Skill-based instructions not supported by this runtime"
        case .steer:
            return "Mid-turn steering not supported by this runtime"
        case .queue:
            return "Queued follow-ups are not available for this runtime"
        }
    }

    static func capabilityReasonWhenAgentSelectionUnavailable(capabilities: ProviderCapabilities) -> String {
        capabilities.supportsAgentSelection
            ? "No agents available for this runtime"
            : capabilityReason(for: .agentSelection)
    }

    static func runtimeUnavailableMessage(_ rawReason: String?, reasonCode: String? = nil) -> (title: String, hint: String?) {
        if let code = reasonCode {
            switch code {
            case "opencode_not_enabled":
                return ("OpenCode is not enabled on this Mac", "Enable OpenCode on your Mac bridge to use this runtime.")
            case "opencode_agents_unavailable":
                return ("OpenCode agents could not be listed", "Check OpenCode on your Mac, then refresh the connection.")
            default:
                break
            }
        }

        let trimmed = rawReason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            return ("Runtime unavailable", nil)
        }
        return (trimmed, nil)
    }
}
