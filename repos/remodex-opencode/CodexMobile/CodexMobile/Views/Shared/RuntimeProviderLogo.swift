// FILE: RuntimeProviderLogo.swift
// Purpose: Isolates runtime-provider logo lookup for SwiftUI views and UIKit menus. Catalog-driven via runtime/catalog .opencode.providers (id/logoProviderId -> logoAssetId); SF globe fallback; keep 4 core assets.
// Layer: View Component
// Exports: RuntimeProviderLogo, RuntimeProviderLogoView, OpenCodeProviderLogoCatalogEntry (re-export via model)
// Depends on: SwiftUI, UIKit, CodexModelOption, RemodexIcon, OpenCodeProviderLogoCatalogEntry, CodexService

import SwiftUI
import UIKit

enum RuntimeProviderLogo {
    // Core 4 assets kept (per RP-BRAND plan); catalog augments for others via .opencode.providers
    private static let assetsByProvider: [String: String] = [
        "codex": "provider-codex-logo",
        "opencode": "provider-opencode-logo",
        "opencode-go": "provider-opencode-go-logo",
        "opencode-zen": "provider-opencode-zen-logo",
    ]

    static func assetName(for provider: String) -> String? {
        assetName(for: provider, catalogProviders: nil)
    }

    // Catalog-driven: match key (id or logoProviderId from callers) against catalog entry.id
    // (populated from runtime/catalog .opencode.providers); asset if present else nil (SF path).
    static func assetName(for provider: String, catalogProviders: [OpenCodeProviderLogoCatalogEntry]?) -> String? {
        let norm = CodexModelOption.normalizedProvider(provider)
        if let hard = assetsByProvider[norm] {
            return hard
        }
        guard let list = catalogProviders else {
            return nil
        }
        let key = norm
        for entry in list {
            if CodexModelOption.normalizedProvider(entry.id) == key {
                if let asset = entry.logoAssetId, !asset.isEmpty {
                    return asset
                }
            }
        }
        return nil
    }

    @ViewBuilder
    static func image(provider: String, size: CGFloat = 20) -> some View {
        image(provider: provider, catalogProviders: nil, size: size)
    }

    @ViewBuilder
    static func image(provider: String, catalogProviders: [OpenCodeProviderLogoCatalogEntry]?, size: CGFloat = 20) -> some View {
        if let assetName = assetName(for: provider, catalogProviders: catalogProviders) {
            Image(assetName)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
        } else {
            // SF fallback (globe per design for long-tail; cloud/cpu variants noted for future refine)
            RemodexIcon.image(systemName: "globe", size: size)
        }
    }

    // UIMenu needs `UIImage`, so route provider rows through the same assets.
    static func menuUIImage(provider: String) -> UIImage? {
        menuUIImage(provider: provider, catalogProviders: nil)
    }

    static func menuUIImage(provider: String, catalogProviders: [OpenCodeProviderLogoCatalogEntry]?) -> UIImage? {
        guard let assetName = assetName(for: provider, catalogProviders: catalogProviders) else {
            return RemodexIcon.menuUIImage(systemName: "globe")
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

    @Environment(CodexService.self) private var codex

    var body: some View {
        RuntimeProviderLogo.image(
            provider: provider,
            catalogProviders: codex.openCodeLogoProviders,
            size: size
        )
    }
}
