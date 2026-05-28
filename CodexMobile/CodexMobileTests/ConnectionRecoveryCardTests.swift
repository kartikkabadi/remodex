// FILE: ConnectionRecoveryCardTests.swift
// Purpose: Verifies recovery card accessibility sizing constants.
// Layer: Unit Test
// Exports: ConnectionRecoveryCardTests
// Depends on: XCTest, CodexMobile

import XCTest
@testable import CodexMobile

final class ConnectionRecoveryCardTests: XCTestCase {
    func testDismissHitTargetMeetsMinimumTouchSize() {
        XCTAssertGreaterThanOrEqual(ConnectionRecoveryCard.dismissHitTargetSize, 44)
    }
}
