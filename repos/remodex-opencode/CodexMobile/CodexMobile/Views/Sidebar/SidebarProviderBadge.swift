// FILE: SidebarProviderBadge.swift
// Purpose: Compact runtime provider glyph for sidebar thread rows.
// Layer: View Component
// Exports: SidebarProviderBadge, SidebarOpenCodeBetaCapsule
// Depends on: SwiftUI, RuntimeProviderLogo, TurnComposerMetaMapper, CodexModelOption

import SwiftUI

struct SidebarProviderBadge: View {
    let provider: String?

    private var normalizedProvider: String {
        CodexModelOption.normalizedProvider(provider ?? "codex")
    }

    var body: some View {
        RuntimeProviderLogoView(provider: normalizedProvider, size: 13)
            .accessibilityHidden(true)
    }
}

struct SidebarOpenCodeBetaCapsule: View {
    var body: some View {
        Text("Beta")
            .font(AppFont.caption2(weight: .semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color(.tertiarySystemFill), in: Capsule())
            .accessibilityLabel("OpenCode beta")
    }
}

#if DEBUG
#Preview("Sidebar provider badge") {
    HStack(spacing: 8) {
        SidebarProviderBadge(provider: "codex")
        SidebarProviderBadge(provider: "opencode")
        SidebarOpenCodeBetaCapsule()
    }
    .padding()
}
#endif
