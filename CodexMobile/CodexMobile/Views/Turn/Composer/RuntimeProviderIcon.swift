// FILE: RuntimeProviderIcon.swift
// Purpose: Centralizes provider-specific icon assets for runtime model pickers.
// Layer: View Helper
// Exports: RuntimeProviderIcon
// Depends on: SwiftUI, UIKit, CodexModelOption, RemodexIcon

import SwiftUI
import UIKit

enum RuntimeProviderIcon {
    static func systemName(for provider: String) -> String {
        switch CodexModelOption.normalizedProvider(provider) {
        case "codex":
            return "sparkles"
        case "cursor":
            return "remodex.cursor-logo"
        case "opencode":
            return "terminal"
        case "claude":
            return "textformat"
        default:
            return "cube"
        }
    }

    static func menuUIImage(for provider: String) -> UIImage? {
        RemodexIcon.menuUIImage(systemName: systemName(for: provider))
    }

    static func image(
        for provider: String,
        size: CGFloat? = nil,
        weight: Font.Weight? = nil,
        relativeTo textStyle: Font.TextStyle = .body
    ) -> some View {
        RemodexIcon.image(
            systemName: systemName(for: provider),
            size: size,
            weight: weight,
            relativeTo: textStyle
        )
    }
}
