// FILE: RuntimeProviderLogo.swift
// Purpose: Compact sidebar/composer glyph for Codex vs OpenCode agent runtimes.
// Layer: View Component
// Exports: RuntimeProviderLogo

import SwiftUI

struct RuntimeProviderLogo: View {
    let agentRuntime: String
    var size: CGFloat = 14

    private var normalizedRuntime: String {
        agentRuntime.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    var body: some View {
        Group {
            if normalizedRuntime == "opencode" {
                Image(systemName: "terminal")
                    .symbolRenderingMode(.hierarchical)
            } else {
                RemodexIcon.image(systemName: "sparkles")
                    .symbolRenderingMode(.hierarchical)
            }
        }
        .font(.system(size: size, weight: .semibold))
        .foregroundStyle(.secondary)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        normalizedRuntime == "opencode" ? "OpenCode thread" : "Codex thread"
    }
}
