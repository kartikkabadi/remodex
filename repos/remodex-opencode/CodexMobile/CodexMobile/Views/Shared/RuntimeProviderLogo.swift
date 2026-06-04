// FILE: RuntimeProviderLogo.swift
// Purpose: Isolates runtime-provider logo lookup for SwiftUI views and UIKit menus. (catalog-driven + SF fallback per RP-BRAND-5)
// Layer: View Component
// Exports: RuntimeProviderLogo, RuntimeProviderLogoView
// Depends on: SwiftUI, UIKit, CodexModelOption, RemodexIcon, CodexService (for catalog)

import SwiftUI
import UIKit

enum RuntimeProviderLogo {
    private static let assetsByProvider: [String: String] = [
        "codex": "provider-codex-logo",
        "opencode": "provider-opencode-logo",
        "opencode-go": "provider-opencode-go-logo",
        "opencode-zen": "provider-opencode-zen-logo",
    ]

    // Catalog resolver stub (RP-BRAND-5): lookup logoAssetId from runtime/catalog.opencode.providers
    // (populated by BRAND-1). Match by provider id (or logoProviderId value). If logoAssetId present
    // (for the 4 kept assets or future cleared) return it to drive asset render; else nil -> SF fallback.
    // Additive; no behavior change for codex or when catalog empty (hardcoded path remains).
    private enum CatalogLogoResolver {
        static func logoAssetId(for provider: String, in catalogProviders: [OpenCodeCatalogProvider]) -> String? {
            let norm = CodexModelOption.normalizedProvider(provider)
            for entry in catalogProviders {
                let en = CodexModelOption.normalizedProvider(entry.id)
                if en == norm || entry.id == provider || en == provider {
                    return entry.logoAssetId
                }
            }
            return nil
        }
    }

    static func assetName(for provider: String, catalogProviders: [OpenCodeCatalogProvider] = []) -> String? {
        if let fromCatalog = CatalogLogoResolver.logoAssetId(for: provider, in: catalogProviders) {
            return fromCatalog
        }
        return assetsByProvider[CodexModelOption.normalizedProvider(provider)]
    }

    // Back-compat overload (used if any external direct calls; delegates to catalog-aware with empty).
    static func assetName(for provider: String) -> String? {
        assetName(for: provider, catalogProviders: [])
    }

    static func sfSymbolName(for provider: String) -> String {
        let n = CodexModelOption.normalizedProvider(provider).lowercased()
        switch n {
        case "openai": return "cloud"
        case "anthropic": return "cpu"
        case "google", "gemini": return "globe"
        case "groq": return "network"
        default: return "globe"
        }
    }

    @ViewBuilder
    static func image(provider: String, size: CGFloat = 20, catalogProviders: [OpenCodeCatalogProvider] = []) -> some View {
        if let assetName = assetName(for: provider, catalogProviders: catalogProviders) {
            Image(assetName)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
        } else {
            RemodexIcon.image(systemName: sfSymbolName(for: provider), size: size)
        }
    }

    // Back-compat for any direct calls without catalog.
    @ViewBuilder
    static func image(provider: String, size: CGFloat = 20) -> some View {
        image(provider: provider, size: size, catalogProviders: [])
    }

    // UIMenu needs `UIImage`, so route provider rows through the same assets.
    static func menuUIImage(provider: String, catalogProviders: [OpenCodeCatalogProvider] = []) -> UIImage? {
        if let assetName = assetName(for: provider, catalogProviders: catalogProviders) {
            guard let image = UIImage(named: assetName) else { return nil }
            return resizedMenuImage(image).withRenderingMode(.alwaysOriginal)
        } else {
            return RemodexIcon.menuUIImage(systemName: sfSymbolName(for: provider))
        }
    }

    // Back-compat overload.
    static func menuUIImage(provider: String) -> UIImage? {
        menuUIImage(provider: provider, catalogProviders: [])
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

    @Environment(CodexService.self) private var codex: CodexService?

    var body: some View {
        RuntimeProviderLogo.image(
            provider: provider,
            size: size,
            catalogProviders: codex?.openCodeCatalogProviders ?? []
        )
    }
}
