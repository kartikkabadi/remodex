// FILE: SettingsConnectionCardTests.swift
// Purpose: Verifies keep-awake footer copy across connection states.
// Layer: Unit Test
// Exports: SettingsConnectionCardTests
// Depends on: XCTest, CodexMobile

import XCTest
@testable import CodexMobile

final class SettingsConnectionCardTests: XCTestCase {
    func testKeepAwakeFooterShowsDisconnectedSyncHintWhenEnabled() {
        let footer = SettingsConnectionCard.keepAwakeFooterText(
            supportsKeepAwake: true,
            keepAwakeEnabled: true,
            isConnected: false
        )

        XCTAssertEqual(
            footer,
            "Preference is saved on this iPhone and syncs when the bridge reconnects."
        )
    }

    func testKeepAwakeFooterShowsReachabilityCopyWhenConnected() {
        let footer = SettingsConnectionCard.keepAwakeFooterText(
            supportsKeepAwake: true,
            keepAwakeEnabled: true,
            isConnected: true
        )

        XCTAssertEqual(
            footer,
            "Keeps your Mac reachable while the bridge is running. Best while charging."
        )
    }

    func testKeepAwakeFooterHiddenWhenBridgeDoesNotSupportFeature() {
        XCTAssertNil(
            SettingsConnectionCard.keepAwakeFooterText(
                supportsKeepAwake: false,
                keepAwakeEnabled: true,
                isConnected: false
            )
        )
    }
}
