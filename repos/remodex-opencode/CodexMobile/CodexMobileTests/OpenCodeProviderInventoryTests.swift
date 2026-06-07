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
    func testDecodesOpenCodeRuntimeDetailsWithCatalogRevision() throws {
        let json = """
        {
          "enabled": true,
          "catalogRevision": "fp:1a2b3c4d",
          "providerInventory": [
            {
              "id": "opencode",
              "displayName": "OpenCode",
              "connectedOnServe": true,
              "authenticated": true,
              "modelCount": 2
            }
          ]
        }
        """
        let data = try XCTUnwrap(json.data(using: .utf8))
        let details = try JSONDecoder().decode(OpenCodeRuntimeDetails.self, from: data)
        XCTAssertEqual(details.catalogRevision, "fp:1a2b3c4d")
        XCTAssertEqual(details.providerInventory?.count, 1)
    }

    func testDecodesOpenCodeRuntimeDetailsWithCatalogProvidersForLogos() throws {
        let json = """
        {
          "enabled": true,
          "providers": [
            { "id": "anthropic", "name": "Anthropic", "logoAssetId": "provider-anthropic-logo" },
            { "id": "openai", "name": "OpenAI", "logoAssetId": "provider-openai-logo" },
            { "id": "opencode-go", "name": "OpenCode Go", "logoAssetId": "provider-opencode-go-logo" }
          ]
        }
        """
        let data = try XCTUnwrap(json.data(using: .utf8))
        let details = try JSONDecoder().decode(OpenCodeRuntimeDetails.self, from: data)
        XCTAssertEqual(details.providers?.count, 3)
        XCTAssertEqual(details.providers?.first?.id, "anthropic")
        XCTAssertEqual(details.providers?.first?.logoAssetId, "provider-anthropic-logo")
        XCTAssertEqual(details.providers?[1].logoAssetId, "provider-openai-logo")
        XCTAssertEqual(details.providers?.last?.logoAssetId, "provider-opencode-go-logo")
    }

    func testRuntimeProviderLogoCatalogResolverKnownIdsAndFallback() {
        let catalog: [OpenCodeCatalogProvider] = [
            OpenCodeCatalogProvider(id: "opencode-go", name: "Go", logoAssetId: "provider-opencode-go-logo"),
            OpenCodeCatalogProvider(id: "anthropic", name: "Anthropic", logoAssetId: "provider-anthropic-logo"),
            OpenCodeCatalogProvider(id: "openai", name: "OpenAI", logoAssetId: "provider-openai-logo"),
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

        // catalog provides logoAssetId for cleared providers
        XCTAssertEqual(
            RuntimeProviderLogo.assetName(for: "anthropic", catalogProviders: catalog),
            "provider-anthropic-logo"
        )
        XCTAssertEqual(
            RuntimeProviderLogo.assetName(for: "openai", catalogProviders: catalog),
            "provider-openai-logo"
        )

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