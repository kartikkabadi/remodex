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

    // --- RP-BRAND-2 catalog-driven logo resolver tests ---

    func testRuntimeProviderLogoHardcodedKnownIds() {
        XCTAssertEqual(RuntimeProviderLogo.assetName(for: "codex"), "provider-codex-logo")
        XCTAssertEqual(RuntimeProviderLogo.assetName(for: "opencode"), "provider-opencode-logo")
        XCTAssertEqual(RuntimeProviderLogo.assetName(for: "opencode-go"), "provider-opencode-go-logo")
        XCTAssertEqual(RuntimeProviderLogo.assetName(for: "opencode-zen"), "provider-opencode-zen-logo")
        // normalized variants
        XCTAssertEqual(RuntimeProviderLogo.assetName(for: "OpenCode"), "provider-opencode-logo")
    }

    func testRuntimeProviderLogoCatalogMatchById() {
        let catalog: [OpenCodeProviderLogoCatalogEntry] = [
            OpenCodeProviderLogoCatalogEntry(id: "anthropic", name: "Anthropic", logoAssetId: "provider-anthropic-logo"),
            OpenCodeProviderLogoCatalogEntry(id: "openai", name: "OpenAI", logoAssetId: nil),
        ]
        XCTAssertEqual(RuntimeProviderLogo.assetName(for: "anthropic", catalogProviders: catalog), "provider-anthropic-logo")
        // no asset in catalog -> nil (SF fallback path)
        XCTAssertNil(RuntimeProviderLogo.assetName(for: "openai", catalogProviders: catalog))
    }

    func testRuntimeProviderLogoFallsBackToHardcodedEvenWithCatalogForKnown() {
        let catalog: [OpenCodeProviderLogoCatalogEntry] = [
            OpenCodeProviderLogoCatalogEntry(id: "opencode-zen", name: "Zen", logoAssetId: "provider-opencode-zen-logo"),
        ]
        // hard wins for core 4
        XCTAssertEqual(RuntimeProviderLogo.assetName(for: "opencode-zen", catalogProviders: catalog), "provider-opencode-zen-logo")
    }

    func testRuntimeProviderLogoUnknownWithoutCatalogIsNilForSFFallback() {
        XCTAssertNil(RuntimeProviderLogo.assetName(for: "some-future-provider"))
        let empty: [OpenCodeProviderLogoCatalogEntry] = []
        XCTAssertNil(RuntimeProviderLogo.assetName(for: "another", catalogProviders: empty))
    }

    func testDecodesOpenCodeRuntimeDetailsWithProvidersCatalog() throws {
        let json = """
        {
          "enabled": true,
          "providers": [
            {"id": "anthropic", "name": "Anthropic", "logoAssetId": "provider-anthropic-logo"},
            {"id": "groq", "name": "Groq"}
          ]
        }
        """
        let data = try XCTUnwrap(json.data(using: .utf8))
        let details = try JSONDecoder().decode(OpenCodeRuntimeDetails.self, from: data)
        XCTAssertEqual(details.providers?.count, 2)
        XCTAssertEqual(details.providers?.first?.id, "anthropic")
        XCTAssertEqual(details.providers?.first?.logoAssetId, "provider-anthropic-logo")
        XCTAssertEqual(details.providers?.last?.name, "Groq")
        XCTAssertNil(details.providers?.last?.logoAssetId)
    }
}