// FILE: CodexModelOptionCapabilitiesTests.swift
// Purpose: Verifies provider-aware capability fallbacks when model/list omits capabilities.
// Layer: Unit Test
// Exports: CodexModelOptionCapabilitiesTests
// Depends on: XCTest, CodexMobile

import XCTest
@testable import CodexMobile

final class CodexModelOptionCapabilitiesTests: XCTestCase {
    func testDecodeWithoutCapabilitiesUsesOpenCodeDefaultsForOpenCodeProvider() throws {
        let json = """
        {
          "id": "openai/gpt-5.5",
          "model": "openai/gpt-5.5",
          "modelProvider": "opencode",
          "displayName": "GPT-5.5"
        }
        """
        let data = try XCTUnwrap(json.data(using: .utf8))
        let option = try JSONDecoder().decode(CodexModelOption.self, from: data)

        XCTAssertEqual(option.capabilities, .defaultOpenCode)
        XCTAssertFalse(option.capabilities.supportsDesktopHandoff)
        XCTAssertFalse(option.capabilities.supportsStructuredSkillInput)
    }

    func testDecodeWithoutCapabilitiesUsesCodexDefaultsForCodexProvider() throws {
        let json = """
        {
          "id": "gpt-5.4",
          "model": "gpt-5.4",
          "modelProvider": "codex",
          "displayName": "GPT-5.4"
        }
        """
        let data = try XCTUnwrap(json.data(using: .utf8))
        let option = try JSONDecoder().decode(CodexModelOption.self, from: data)

        XCTAssertEqual(option.capabilities, .defaultCodex)
        XCTAssertTrue(option.capabilities.supportsDesktopHandoff)
    }
}