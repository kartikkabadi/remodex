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
}