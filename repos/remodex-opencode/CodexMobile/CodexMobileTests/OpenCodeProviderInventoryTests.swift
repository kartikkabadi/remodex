import XCTest
@testable import CodexMobile

final class OpenCodeProviderInventoryTests: XCTestCase {
    func testDecodesProviderInventoryEntryWithLogoProviderId() throws {
        let json = """
        {
          "id": "opencode",
          "displayName": "OpenCode Zen",
          "connectedOnServe": true,
          "authenticated": false,
          "modelCount": 3,
          "logoProviderId": "opencode-zen"
        }
        """
        let data = try XCTUnwrap(json.data(using: .utf8))
        let entry = try JSONDecoder().decode(OpenCodeProviderInventoryEntry.self, from: data)
        XCTAssertEqual(entry.id, "opencode")
        XCTAssertEqual(entry.logoProviderId, "opencode-zen")
        XCTAssertTrue(entry.connectedOnServe)
    }

    func testDecodesProviderInventoryEntryWithoutLogoProviderIdKey() throws {
        let json = """
        {
          "id": "opencode",
          "displayName": "OpenCode",
          "connectedOnServe": true,
          "authenticated": false,
          "modelCount": 1
        }
        """
        let data = try XCTUnwrap(json.data(using: .utf8))
        let entry = try JSONDecoder().decode(OpenCodeProviderInventoryEntry.self, from: data)
        XCTAssertEqual(entry.id, "opencode")
        XCTAssertNil(entry.logoProviderId)
    }

    func testDecodesProviderInventoryEntry() throws {
        let json = """
        {
          "id": "deepseek",
          "displayName": "DeepSeek",
          "connectedOnServe": false,
          "authenticated": true,
          "modelCount": null
        }
        """
        let data = try XCTUnwrap(json.data(using: .utf8))
        let entry = try JSONDecoder().decode(OpenCodeProviderInventoryEntry.self, from: data)
        XCTAssertEqual(entry.id, "deepseek")
        XCTAssertFalse(entry.connectedOnServe)
        XCTAssertTrue(entry.authenticated)
    }

    // Catalog resolver stub tests (RP-BRAND-5): unit coverage for fallback + known ids.
    // Exercises CatalogLogoResolver + assetName via catalog.providers shape from BRAND-1.
    func testDecodesOpenCodeRuntimeDetailsWithCatalogProvidersForLogos() throws {
        let json = """
        {
          "enabled": true,
          "providers": [
            { "id": "anthropic", "name": "Anthropic" },
            { "id": "opencode-go", "name": "OpenCode Go", "logoAssetId": "provider-opencode-go-logo" }
          ]
        }
        """
        let data = try XCTUnwrap(json.data(using: .utf8))
        let details = try JSONDecoder().decode(OpenCodeRuntimeDetails.self, from: data)
        XCTAssertEqual(details.providers?.count, 2)
        XCTAssertEqual(details.providers?.first?.id, "anthropic")
        XCTAssertNil(details.providers?.first?.logoAssetId)
        XCTAssertEqual(details.providers?.last?.logoAssetId, "provider-opencode-go-logo")
    }

    func testRuntimeProviderLogoCatalogResolverKnownIdsAndFallback() {
        let catalog: [OpenCodeCatalogProvider] = [
            OpenCodeCatalogProvider(id: "opencode-go", name: "Go", logoAssetId: "provider-opencode-go-logo"),
            OpenCodeCatalogProvider(id: "anthropic", name: "Anthropic", logoAssetId: nil),
            OpenCodeCatalogProvider(id: "openai", name: "OpenAI", logoAssetId: nil),
        ]

        // catalog provides logoAssetId -> use it (drives asset render for cleared)
        XCTAssertEqual(
            RuntimeProviderLogo.assetName(for: "opencode-go", catalogProviders: catalog),
            "provider-opencode-go-logo"
        )
        XCTAssertEqual(
            RuntimeProviderLogo.assetName(for: "opencode-go", catalogProviders: catalog), // also via backcompat path
            "provider-opencode-go-logo"
        )

        // catalog entry but no logoAssetId -> nil (triggers SF in image/menuUIImage)
        XCTAssertNil(RuntimeProviderLogo.assetName(for: "anthropic", catalogProviders: catalog))
        XCTAssertNil(RuntimeProviderLogo.assetName(for: "openai", catalogProviders: catalog))

        // no catalog match, falls back to hardcoded assets for the 4
        XCTAssertEqual(RuntimeProviderLogo.assetName(for: "codex", catalogProviders: []), "provider-codex-logo")
        XCTAssertEqual(RuntimeProviderLogo.assetName(for: "opencode", catalogProviders: catalog), "provider-opencode-logo")

        // unknown provider -> nil (SF fallback path)
        XCTAssertNil(RuntimeProviderLogo.assetName(for: "some-long-tail", catalogProviders: catalog))

        // SF symbol names (examples per plan)
        XCTAssertEqual(RuntimeProviderLogo.sfSymbolName(for: "openai"), "cloud")
        XCTAssertEqual(RuntimeProviderLogo.sfSymbolName(for: "anthropic"), "cpu")
        XCTAssertEqual(RuntimeProviderLogo.sfSymbolName(for: "google"), "globe")
        XCTAssertEqual(RuntimeProviderLogo.sfSymbolName(for: "groq"), "network")
        XCTAssertEqual(RuntimeProviderLogo.sfSymbolName(for: "unknown-foo"), "globe")
    }
}