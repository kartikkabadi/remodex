// FILE: CodexBridgeRuntimeCapabilities.swift
// Purpose: Decodes bridge runtime capabilities from initialize for connected-session gating.
// Layer: Model
// Exports: CodexBridgeRuntimeCapabilities
// Depends on: Foundation

import Foundation

struct CodexBridgeRuntimeCapabilities: Equatable, Sendable {
    static let codexDefault = CodexBridgeRuntimeCapabilities(
        agentRuntime: .codex,
        supportsAgents: false,
        supportsVariants: false,
        requiresOpenaiAuth: true
    )

    let agentRuntime: AgentRuntime
    let supportsAgents: Bool
    let supportsVariants: Bool
    let requiresOpenaiAuth: Bool

    var isOpenCodeConnected: Bool {
        agentRuntime.isOpenCode
    }
}
