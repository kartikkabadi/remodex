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
    let supportsSkillAutocomplete: Bool
    let supportsStructuredSkillInput: Bool
    let supportsSteer: Bool
    let supportsQueue: Bool

    init(
        supportsAgentSelection: Bool,
        supportsReasoningEffort: Bool,
        supportsFastMode: Bool,
        supportsPlanMode: Bool,
        supportsStreamingTools: Bool,
        supportsApprovals: Bool,
        supportsFork: Bool,
        supportsVoice: Bool,
        supportsDesktopHandoff: Bool,
        supportsSlashCommands: Bool,
        supportsMCP: Bool,
        supportsWorktree: Bool,
        supportsSkillAutocomplete: Bool,
        supportsStructuredSkillInput: Bool = false,
        supportsSteer: Bool,
        supportsQueue: Bool
    ) {
        self.supportsAgentSelection = supportsAgentSelection
        self.supportsReasoningEffort = supportsReasoningEffort
        self.supportsFastMode = supportsFastMode
        self.supportsPlanMode = supportsPlanMode
        self.supportsStreamingTools = supportsStreamingTools
        self.supportsApprovals = supportsApprovals
        self.supportsFork = supportsFork
        self.supportsVoice = supportsVoice
        self.supportsDesktopHandoff = supportsDesktopHandoff
        self.supportsSlashCommands = supportsSlashCommands
        self.supportsMCP = supportsMCP
        self.supportsWorktree = supportsWorktree
        self.supportsSkillAutocomplete = supportsSkillAutocomplete
        self.supportsStructuredSkillInput = supportsStructuredSkillInput
        self.supportsSteer = supportsSteer
        self.supportsQueue = supportsQueue
    }

    enum CodingKeys: String, CodingKey {
        case supportsAgentSelection
        case supportsReasoningEffort
        case supportsFastMode
        case supportsPlanMode
        case supportsStreamingTools
        case supportsApprovals
        case supportsFork
        case supportsVoice
        case supportsDesktopHandoff
        case supportsSlashCommands
        case supportsMCP
        case supportsWorktree
        case supportsSkillAutocomplete
        case supportsStructuredSkillInput
        case supportsSteer
        case supportsQueue
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        supportsAgentSelection = (try? container.decodeIfPresent(Bool.self, forKey: .supportsAgentSelection)) ?? false
        supportsReasoningEffort = (try? container.decodeIfPresent(Bool.self, forKey: .supportsReasoningEffort)) ?? false
        supportsFastMode = (try? container.decodeIfPresent(Bool.self, forKey: .supportsFastMode)) ?? true
        supportsPlanMode = (try? container.decodeIfPresent(Bool.self, forKey: .supportsPlanMode)) ?? false
        supportsStreamingTools = (try? container.decodeIfPresent(Bool.self, forKey: .supportsStreamingTools)) ?? true
        supportsApprovals = (try? container.decodeIfPresent(Bool.self, forKey: .supportsApprovals)) ?? true
        supportsFork = (try? container.decodeIfPresent(Bool.self, forKey: .supportsFork)) ?? true
        supportsVoice = (try? container.decodeIfPresent(Bool.self, forKey: .supportsVoice)) ?? false
        supportsDesktopHandoff = (try? container.decodeIfPresent(Bool.self, forKey: .supportsDesktopHandoff)) ?? true
        supportsSlashCommands = (try? container.decodeIfPresent(Bool.self, forKey: .supportsSlashCommands)) ?? true
        supportsMCP = (try? container.decodeIfPresent(Bool.self, forKey: .supportsMCP)) ?? true
        supportsWorktree = (try? container.decodeIfPresent(Bool.self, forKey: .supportsWorktree)) ?? false
        supportsSkillAutocomplete = (try? container.decodeIfPresent(Bool.self, forKey: .supportsSkillAutocomplete)) ?? false
        supportsStructuredSkillInput =
            (try? container.decodeIfPresent(Bool.self, forKey: .supportsStructuredSkillInput)) ?? false
        supportsSteer = (try? container.decodeIfPresent(Bool.self, forKey: .supportsSteer)) ?? false
        supportsQueue = (try? container.decodeIfPresent(Bool.self, forKey: .supportsQueue)) ?? true
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
        try container.encode(supportsSkillAutocomplete, forKey: .supportsSkillAutocomplete)
        try container.encode(supportsStructuredSkillInput, forKey: .supportsStructuredSkillInput)
        try container.encode(supportsSteer, forKey: .supportsSteer)
        try container.encode(supportsQueue, forKey: .supportsQueue)
    }

    static let defaultCodex = ProviderCapabilities(
        supportsAgentSelection: false,
        supportsReasoningEffort: true,
        supportsFastMode: true,
        supportsPlanMode: true,
        supportsStreamingTools: true,
        supportsApprovals: true,
        supportsFork: true,
        supportsVoice: true,
        supportsDesktopHandoff: true,
        supportsSlashCommands: true,
        supportsMCP: true,
        supportsWorktree: true,
        supportsSkillAutocomplete: true,
        supportsStructuredSkillInput: true,
        supportsSteer: true,
        supportsQueue: true
    )

    static let defaultOpenCode = ProviderCapabilities(
        supportsAgentSelection: true,
        supportsReasoningEffort: false,
        supportsFastMode: false,
        supportsPlanMode: false,
        supportsStreamingTools: true,
        supportsApprovals: true,
        supportsFork: true,
        supportsVoice: false,
        supportsDesktopHandoff: false,
        supportsSlashCommands: true,
        supportsMCP: false,
        supportsWorktree: false,
        supportsSkillAutocomplete: true,
        supportsStructuredSkillInput: false,
        supportsSteer: false,
        supportsQueue: true
    )
}
