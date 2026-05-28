// FILE: RuntimeProviderLogo.swift
// Purpose: Isolates runtime-provider logo lookup for SwiftUI views and UIKit menus.
// Layer: View Component
// Exports: RuntimeProviderLogo, RuntimeProviderLogoView
// Depends on: SwiftUI, UIKit, CodexModelOption, RemodexIcon

import SwiftUI
import UIKit

enum RuntimeProviderLogo {
    private static let assetsByProvider: [String: String] = [
        "codex": "provider-codex-logo",
        "opencode": "provider-opencode-logo",
    ]

    static func assetName(for provider: String) -> String? {
        assetsByProvider[CodexModelOption.normalizedProvider(provider)]
    }

    @ViewBuilder
    static func image(provider: String, size: CGFloat = 20) -> some View {
        if let assetName = assetName(for: provider) {
            Image(assetName)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
        } else {
            RemodexIcon.image(systemName: "cube", size: size)
        }
    }

    // UIMenu needs `UIImage`, so route provider rows through the same assets.
    static func menuUIImage(provider: String) -> UIImage? {
        guard let assetName = assetName(for: provider) else {
            return RemodexIcon.menuUIImage(systemName: "cube")
        }
        guard let image = UIImage(named: assetName) else { return nil }
        return resizedMenuImage(image).withRenderingMode(.alwaysOriginal)
    }

    private static func resizedMenuImage(_ image: UIImage) -> UIImage {
        let pointSize = UIFontMetrics.default.scaledValue(for: 20)
        let size = CGSize(width: pointSize, height: pointSize)
        let format = UIGraphicsImageRendererFormat.default()
        format.opaque = false
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}

struct RuntimeProviderLogoView: View {
    let provider: String
    var size: CGFloat = 20

    var body: some View {
        RuntimeProviderLogo.image(provider: provider, size: size)
    }
}
