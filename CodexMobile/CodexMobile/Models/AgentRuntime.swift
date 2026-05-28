// FILE: AgentRuntime.swift
// Purpose: Canonical agent runtime identity for bridge connection and per-thread metadata.
// Layer: Model
// Exports: AgentRuntime
// Depends on: Foundation

import Foundation

enum AgentRuntime: String, Codable, Hashable, Sendable {
    case codex
    case opencode

    /// Normalizes bridge/thread wire values to a supported runtime (unknown → codex).
    static func normalize(_ raw: String?) -> AgentRuntime {
        guard let raw else {
            return .codex
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return trimmed == "opencode" ? .opencode : .codex
    }

    var isOpenCode: Bool {
        self == .opencode
    }
}
