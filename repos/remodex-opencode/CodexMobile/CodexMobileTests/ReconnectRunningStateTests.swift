// FILE: ReconnectRunningStateTests.swift
// Purpose: Verifies transport-only teardown preserves running markers, turn maps, timeline, and permission queues.
// Layer: Unit Test
// Exports: ReconnectRunningStateTests
// Depends on: XCTest, CodexMobile

import Network
import XCTest
@testable import CodexMobile

@MainActor
final class ReconnectRunningStateTests: XCTestCase {
    private static var retainedServices: [CodexService] = []

    func testTransportOnlyDisconnectPreservesActiveTurnIdByThread() async {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"

        service.isConnected = true
        service.activeTurnIdByThread[threadID] = turnID
        service.activeTurnId = turnID
        service.runningThreadIDs.insert(threadID)

        await service.disconnect(preserveReconnectIntent: true)

        XCTAssertEqual(service.activeTurnID(for: threadID), turnID)
        XCTAssertEqual(service.activeTurnId, turnID)
        XCTAssertEqual(service.threadRunBadgeState(for: threadID), .running)
    }

    func testTransportOnlyDisconnectPreservesRunningThreadIDs() async {
        let service = makeService()
        let threadA = "thread-a-\(UUID().uuidString)"
        let threadB = "thread-b-\(UUID().uuidString)"

        service.isConnected = true
        service.runningThreadIDs = [threadA, threadB]
        service.activeTurnIdByThread[threadA] = "turn-a"
        service.activeTurnIdByThread[threadB] = "turn-b"

        await service.disconnect(preserveReconnectIntent: true)

        XCTAssertTrue(service.runningThreadIDs.contains(threadA))
        XCTAssertTrue(service.runningThreadIDs.contains(threadB))
    }

    func testTransportOnlyDisconnectPreservesPendingApprovals() async {
        let service = makeService()
        let request = CodexApprovalRequest(
            id: "approval-1",
            requestID: .string("req-1"),
            method: "item/commandExecution/requestApproval",
            command: "npm test",
            reason: nil,
            threadId: "thread-approval",
            turnId: "turn-approval",
            params: nil
        )

        service.isConnected = true
        service.enqueuePendingApproval(request)

        await service.disconnect(preserveReconnectIntent: true)

        XCTAssertEqual(service.pendingApprovals.count, 1)
        XCTAssertEqual(service.pendingApproval(for: "thread-approval")?.id, "approval-1")
    }

    func testTransportOnlyDisconnectPreservesPendingOpenCodePermissions() async {
        let service = makeService()
        let permission = OpenCodePermissionRequest(
            permissionId: "perm-abc",
            threadId: "thread-oc",
            turnId: "turn-oc",
            sessionId: "ses-oc",
            tool: "bash",
            argsSummary: "npm test",
            cwd: "/Users/me/project",
            receivedAt: Date()
        )

        service.isConnected = true
        service.enqueuePendingOpenCodePermission(permission)

        await service.disconnect(preserveReconnectIntent: true)

        XCTAssertEqual(service.pendingOpenCodePermissions.count, 1)
        XCTAssertEqual(service.pendingOpenCodePermission(for: "thread-oc")?.permissionId, "perm-abc")
    }

    func testFullDisconnectWipesRunningState() async {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"

        service.isConnected = true
        service.activeTurnIdByThread[threadID] = "turn-wipe"
        service.runningThreadIDs.insert(threadID)

        await service.disconnect(preserveReconnectIntent: false)

        XCTAssertNil(service.activeTurnID(for: threadID))
        XCTAssertFalse(service.runningThreadIDs.contains(threadID))
        XCTAssertEqual(service.threadRunBadgeState(for: threadID), .idle)
    }

    func testReceiveErrorWithReconnectPreservesRunningMarkers() {
        let service = makeService()
        let threadID = "thread-\(UUID().uuidString)"
        let turnID = "turn-\(UUID().uuidString)"

        service.isConnected = true
        service.isInitialized = true
        service.activeTurnIdByThread[threadID] = turnID
        service.activeTurnId = turnID
        service.runningThreadIDs.insert(threadID)

        service.handleReceiveError(NWError.posix(.ECONNABORTED))

        XCTAssertFalse(service.isConnected)
        XCTAssertTrue(service.shouldAutoReconnectOnForeground)
        XCTAssertEqual(service.activeTurnID(for: threadID), turnID)
        XCTAssertEqual(service.activeTurnId, turnID)
        XCTAssertEqual(service.threadRunBadgeState(for: threadID), .running)
    }

    func testTransportOnlyDisconnectPreservesTimelineState() async {
        let service = makeService()
        let threadID = "thread-timeline-\(UUID().uuidString)"

        service.isConnected = true
        service.runningThreadIDs.insert(threadID)
        service.activeTurnIdByThread[threadID] = "turn-timeline"
        service.upsertThread(CodexThread(id: threadID, title: "Running chat"))
        service.messagesByThread[threadID] = [
            CodexMessage(id: "msg-1", role: .assistant, text: "Partial answer", isStreaming: true)
        ]

        await service.disconnect(preserveReconnectIntent: true)

        let messages = service.messagesByThread[threadID]
        XCTAssertEqual(messages?.count, 1)
        XCTAssertEqual(messages?.first?.text, "Partial answer")
        XCTAssertEqual(messages?.first?.isStreaming, false)
        XCTAssertEqual(service.activeTurnID(for: threadID), "turn-timeline")
    }

    private func makeService() -> CodexService {
        let suiteName = "ReconnectRunningStateTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        let service = CodexService(defaults: defaults)
        Self.retainedServices.append(service)
        return service
    }
}