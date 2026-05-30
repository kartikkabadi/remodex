// FILE: ProviderCapabilities.swift
// Purpose: Capability flags used by the composer to hide/show rows based on
//          the selected model's provider rather than hardcoded identity checks.
// Layer: Model
// Exports: ProviderCapabilities
// Depends on: Foundation

import Foundation

struct ProviderCapabilities: Codable, Hashable, Sendable {
    let supportsAgentSelection: Bool
    let supportsReasoningEffort: Bool
    let supportsFastMode: Bool
    let supportsPlanMode: Bool
    let supportsStreamingTools: Bool
    let supportsApprovals: Bool
    let supportsFork: Bool
    let supportsVoice: Bool
    let supportsDesktopHandoff: Bool
    let supportsSlashCommands: Bool
    let supportsMCP: Bool
    let supportsWorktree: Bool

    enum CodingKeys: String, CodingKey {
        case supportsAgentSelection
        case supportsAgentSelectionSnake = "supports_agent_selection"
        case supportsReasoningEffort
        case supportsReasoningEffortSnake = "supports_reasoning_effort"
        case supportsFastMode
        case supportsFastModeSnake = "supports_fast_mode"
        case supportsPlanMode
        case supportsPlanModeSnake = "supports_plan_mode"
        case supportsStreamingTools
        case supportsStreamingToolsSnake = "supports_streaming_tools"
        case supportsApprovals
        case supportsApprovalsSnake = "supports_approvals"
        case supportsFork
        case supportsForkSnake = "supports_fork"
        case supportsVoice
        case supportsVoiceSnake = "supports_voice"
        case supportsDesktopHandoff
        case supportsDesktopHandoffSnake = "supports_desktop_handoff"
        case supportsSlashCommands
        case supportsSlashCommandsSnake = "supports_slash_commands"
        case supportsMCP
        case supportsMCPSnake = "supports_mcp"
        case supportsWorktree
        case supportsWorktreeSnake = "supports_worktree"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        supportsAgentSelection = try Self.decodeBool(container, camel: .supportsAgentSelection, snake: .supportsAgentSelectionSnake, fallback: false)
        supportsReasoningEffort = try Self.decodeBool(container, camel: .supportsReasoningEffort, snake: .supportsReasoningEffortSnake, fallback: false)
        supportsFastMode = try Self.decodeBool(container, camel: .supportsFastMode, snake: .supportsFastModeSnake, fallback: true)
        supportsPlanMode = try Self.decodeBool(container, camel: .supportsPlanMode, snake: .supportsPlanModeSnake, fallback: false)
        supportsStreamingTools = try Self.decodeBool(container, camel: .supportsStreamingTools, snake: .supportsStreamingToolsSnake, fallback: true)
        supportsApprovals = try Self.decodeBool(container, camel: .supportsApprovals, snake: .supportsApprovalsSnake, fallback: true)
        supportsFork = try Self.decodeBool(container, camel: .supportsFork, snake: .supportsForkSnake, fallback: true)
        supportsVoice = try Self.decodeBool(container, camel: .supportsVoice, snake: .supportsVoiceSnake, fallback: false)
        supportsDesktopHandoff = try Self.decodeBool(container, camel: .supportsDesktopHandoff, snake: .supportsDesktopHandoffSnake, fallback: true)
        supportsSlashCommands = try Self.decodeBool(container, camel: .supportsSlashCommands, snake: .supportsSlashCommandsSnake, fallback: true)
        supportsMCP = try Self.decodeBool(container, camel: .supportsMCP, snake: .supportsMCPSnake, fallback: true)
        supportsWorktree = try Self.decodeBool(container, camel: .supportsWorktree, snake: .supportsWorktreeSnake, fallback: false)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(supportsAgentSelection, forKey: .supportsAgentSelection)
        try container.encode(supportsReasoningEffort, forKey: .supportsReasoningEffort)
        try container.encode(supportsFastMode, forKey: .supportsFastMode)
        try container.encode(supportsPlanMode, forKey: .supportsPlanMode)
        try container.encode(supportsStreamingTools, forKey: .supportsStreamingTools)
        try container.encode(supportsApprovals, forKey: .supportsApprovals)
        try container.encode(supportsFork, forKey: .supportsFork)
        try container.encode(supportsVoice, forKey: .supportsVoice)
        try container.encode(supportsDesktopHandoff, forKey: .supportsDesktopHandoff)
        try container.encode(supportsSlashCommands, forKey: .supportsSlashCommands)
        try container.encode(supportsMCP, forKey: .supportsMCP)
        try container.encode(supportsWorktree, forKey: .supportsWorktree)
    }

    private static func decodeBool(
        _ container: KeyedDecodingContainer<CodingKeys>,
        camel: CodingKeys,
        snake: CodingKeys,
        fallback: Bool
    ) throws -> Bool {
        if let value = try container.decodeIfPresent(Bool.self, forKey: camel) {
            return value
        }
        if let value = try container.decodeIfPresent(Bool.self, forKey: snake) {
            return value
        }
        return fallback
    }

    static let defaultCodex = ProviderCapabilities(
        supportsAgentSelection: false,
        supportsReasoningEffort: false,
        supportsFastMode: true,
        supportsPlanMode: true,
        supportsStreamingTools: true,
        supportsApprovals: true,
        supportsFork: true,
        supportsVoice: true,
        supportsDesktopHandoff: true,
        supportsSlashCommands: true,
        supportsMCP: true,
        supportsWorktree: true
    )
}
