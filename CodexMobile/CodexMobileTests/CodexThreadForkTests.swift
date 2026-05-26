// FILE: CodexThreadForkTests.swift
// Purpose: Verifies native thread/fork payloads, hydration, and unsupported-runtime handling.
// Layer: Unit Test
// Exports: CodexThreadForkTests
// Depends on: XCTest, CodexMobile

import XCTest
@testable import CodexMobile

@MainActor
final class CodexThreadForkTests: XCTestCase {
    private static var retainedServices: [CodexService] = []

    func testForkThreadIfReadyWaitsForRuntimeInitializationDuringReconnect() async throws {
        let service = makeService()
        service.isConnected = true
        service.isInitialized = false
        service.threads = [makeSourceThread()]

        var didForkThread = false
        service.requestTransportOverride = { method, _ in
            switch method {
            case "thread/fork":
                XCTAssertTrue(service.isInitialized)
                didForkThread = true
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            case "thread/resume":
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                            "cwd": .string("/tmp/remodex"),
                            "title": .string("Fork Local"),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            case "thread/read":
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                            "cwd": .string("/tmp/remodex"),
                            "turns": .array([]),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            default:
                if let response = self.commonForkHydrationResponse(for: method) {
                    return response
                }
                XCTFail("Unexpected method: \(method)")
                throw CodexServiceError.invalidInput("Unexpected method")
            }
        }

        let readinessTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 50_000_000)
            service.isInitialized = true
        }
        defer { readinessTask.cancel() }

        let forkedThread = try await service.forkThreadIfReady(from: "source-thread", target: .currentProject)

        XCTAssertTrue(didForkThread)
        XCTAssertEqual(forkedThread.id, "fork-local")
        XCTAssertEqual(service.activeThreadId, "fork-local")
    }

    func testForkSendsMinimalParamsToThreadFork() async throws {
        let service = makeService()
        service.isConnected = true
        service.isInitialized = true
        service.threads = [makeSourceThread()]

        var capturedForkParams: [String: JSONValue] = [:]
        var capturedResumeParams: [String: JSONValue] = [:]
        service.requestTransportOverride = { method, params in
            switch method {
            case "thread/fork":
                capturedForkParams = params?.objectValue ?? [:]
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            case "thread/resume":
                capturedResumeParams = params?.objectValue ?? [:]
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                            "cwd": .string("/tmp/remodex-worktree"),
                            "title": .string("Fork Local"),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            case "thread/read":
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                            "cwd": .string("/tmp/remodex-worktree"),
                            "turns": .array([]),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            default:
                if let response = self.commonForkHydrationResponse(for: method) {
                    return response
                }
                XCTFail("Unexpected method: \(method)")
                throw CodexServiceError.invalidInput("Unexpected method")
            }
        }

        let forkedThread = try await service.forkThreadIfReady(
            from: "source-thread",
            target: .projectPath("/tmp/remodex-worktree")
        )

        XCTAssertEqual(capturedForkParams["threadId"]?.stringValue, "source-thread")
        XCTAssertEqual(capturedForkParams["excludeTurns"]?.boolValue, true)
        XCTAssertEqual(capturedForkParams["approvalPolicy"]?.stringValue, "on-request")
        XCTAssertNil(capturedForkParams["cwd"])
        XCTAssertEqual(capturedForkParams.count, 3)
        XCTAssertEqual(capturedResumeParams["threadId"]?.stringValue, "fork-local")
        XCTAssertEqual(capturedResumeParams["cwd"]?.stringValue, "/tmp/remodex-worktree")
        XCTAssertEqual(forkedThread.id, "fork-local")
        XCTAssertEqual(forkedThread.gitWorkingDirectory, "/tmp/remodex-worktree")
        XCTAssertEqual(service.activeThreadId, "fork-local")
    }

    func testForkMarksCreatedThreadAsForkedFromSource() async throws {
        let service = makeService()
        service.isConnected = true
        service.isInitialized = true
        service.threads = [makeSourceThread()]

        service.requestTransportOverride = { method, _ in
            switch method {
            case "thread/fork":
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            case "thread/resume":
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                            "cwd": .string("/tmp/remodex"),
                            "title": .string("Fork Local"),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            case "thread/read":
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                            "cwd": .string("/tmp/remodex"),
                            "turns": .array([]),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            default:
                if let response = self.commonForkHydrationResponse(for: method) {
                    return response
                }
                XCTFail("Unexpected method: \(method)")
                throw CodexServiceError.invalidInput("Unexpected method")
            }
        }

        let forkedThread = try await service.forkThreadIfReady(from: "source-thread", target: .currentProject)

        XCTAssertEqual(forkedThread.forkedFromThreadId, "source-thread")
        XCTAssertTrue(forkedThread.isForkedThread)
        XCTAssertEqual(service.thread(for: "fork-local")?.forkedFromThreadId, "source-thread")
    }

    func testForkInheritsOpenCodeRuntimeIdentityWhenResponsesOmitIt() async throws {
        let service = makeService()
        service.isConnected = true
        service.isInitialized = true
        service.threads = [
            makeSourceThread(
                agentRuntime: "opencode",
                agentSessionId: "ses_source",
                opencodeBuildAgentName: "build-agent",
                opencodePlanAgentName: "plan-agent"
            ),
        ]

        var capturedResumeParams: [String: JSONValue] = [:]
        service.requestTransportOverride = { method, params in
            switch method {
            case "thread/fork":
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            case "thread/resume":
                capturedResumeParams = params?.objectValue ?? [:]
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                            "cwd": .string("/tmp/remodex"),
                            "title": .string("Fork Local"),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            case "thread/read":
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                            "cwd": .string("/tmp/remodex"),
                            "turns": .array([]),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            default:
                if let response = self.commonForkHydrationResponse(for: method) {
                    return response
                }
                XCTFail("Unexpected method: \(method)")
                throw CodexServiceError.invalidInput("Unexpected method")
            }
        }

        let forkedThread = try await service.forkThreadIfReady(from: "source-thread", target: .currentProject)

        XCTAssertEqual(capturedResumeParams["agentRuntime"]?.stringValue, "opencode")
        XCTAssertEqual(capturedResumeParams["opencodeBuildAgentName"]?.stringValue, "build-agent")
        XCTAssertEqual(capturedResumeParams["opencodePlanAgentName"]?.stringValue, "plan-agent")
        XCTAssertEqual(forkedThread.agentRuntime, "opencode")
        XCTAssertEqual(forkedThread.agentSessionId, "ses_source")
        XCTAssertEqual(service.thread(for: "fork-local")?.agentRuntime, "opencode")
        XCTAssertEqual(service.thread(for: "fork-local")?.agentSessionId, "ses_source")
    }

    func testPersistedForkOriginRehydratesAfterServiceReload() async throws {
        let suiteName = "CodexThreadForkTests.persistedForkOrigin.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Expected isolated UserDefaults suite")
            return
        }
        defaults.removePersistentDomain(forName: suiteName)

        let service = makeService(defaults: defaults)
        service.isConnected = true
        service.isInitialized = true
        service.threads = [makeSourceThread()]

        service.requestTransportOverride = { method, _ in
            switch method {
            case "thread/fork":
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            case "thread/resume":
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                            "cwd": .string("/tmp/remodex"),
                            "title": .string("Fork Local"),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            case "thread/read":
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                            "cwd": .string("/tmp/remodex"),
                            "turns": .array([]),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            default:
                if let response = self.commonForkHydrationResponse(for: method) {
                    return response
                }
                XCTFail("Unexpected method: \(method)")
                throw CodexServiceError.invalidInput("Unexpected method")
            }
        }

        _ = try await service.forkThreadIfReady(from: "source-thread", target: .currentProject)

        let reloadedService = makeService(defaults: defaults)
        reloadedService.upsertThread(
            CodexThread(
                id: "fork-local",
                title: "Fork Local",
                cwd: "/tmp/remodex"
            )
        )

        XCTAssertEqual(reloadedService.thread(for: "fork-local")?.forkedFromThreadId, "source-thread")
        XCTAssertTrue(reloadedService.thread(for: "fork-local")?.isForkedThread == true)
    }

    func testUnsupportedThreadForkDisablesCapabilityAndShowsUpdatePrompt() async {
        let service = makeService()
        service.isConnected = true
        service.isInitialized = true
        service.threads = [makeSourceThread()]

        service.requestTransportOverride = { method, _ in
            XCTAssertEqual(method, "thread/fork")
            throw CodexServiceError.rpcError(
                RPCError(code: -32601, message: "Method not found: thread/fork")
            )
        }

        do {
            _ = try await service.forkThreadIfReady(from: "source-thread", target: .currentProject)
            XCTFail("Expected thread/fork to fail")
        } catch {
            XCTAssertFalse(service.supportsThreadFork)
            XCTAssertEqual(service.bridgeUpdatePrompt?.title, "Update Remodex on your device to use /fork")
        }
    }

    func testForkKeepsAuthoritativeProjectPathWhenResumeFallsBackToMissingRollout() async throws {
        let service = makeService()
        service.isConnected = true
        service.isInitialized = true
        service.threads = [makeSourceThread()]

        service.requestTransportOverride = { method, _ in
            switch method {
            case "thread/fork":
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "thread": .object([
                            "id": .string("fork-local"),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            case "thread/resume":
                throw CodexServiceError.rpcError(
                    RPCError(code: -32600, message: "no rollout found for thread id fork-local")
                )
            default:
                if let response = self.commonForkHydrationResponse(for: method) {
                    return response
                }
                XCTFail("Unexpected method: \(method)")
                throw CodexServiceError.invalidInput("Unexpected method")
            }
        }

        let forkedThread = try await service.forkThreadIfReady(
            from: "source-thread",
            target: .projectPath("/tmp/remodex-worktree")
        )

        XCTAssertEqual(forkedThread.gitWorkingDirectory, "/tmp/remodex-worktree")
        XCTAssertEqual(service.currentAuthoritativeProjectPath(for: "fork-local"), "/tmp/remodex-worktree")

        service.upsertThread(
            CodexThread(
                id: "fork-local",
                title: "Fork Local",
                cwd: "/tmp/remodex"
            ),
            treatAsServerState: true
        )

        XCTAssertEqual(service.thread(for: "fork-local")?.gitWorkingDirectory, "/tmp/remodex-worktree")
        XCTAssertEqual(service.currentAuthoritativeProjectPath(for: "fork-local"), "/tmp/remodex-worktree")

        service.upsertThread(
            CodexThread(
                id: "fork-local",
                title: "Fork Local",
                cwd: "/tmp/remodex-worktree"
            ),
            treatAsServerState: true
        )

        XCTAssertEqual(service.thread(for: "fork-local")?.gitWorkingDirectory, "/tmp/remodex-worktree")
        XCTAssertNil(service.currentAuthoritativeProjectPath(for: "fork-local"))
    }

    func testLocalForkReturnsNilWhenWorktreeThreadHasNoLocalCheckout() {
        let tempRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let worktreePath = tempRoot
            .appendingPathComponent(".codex/worktrees/a8b4/phodex-website", isDirectory: true)

        try? FileManager.default.createDirectory(at: worktreePath, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempRoot) }

        let worktreeThread = CodexThread(
            id: "source-thread",
            title: "Source",
            cwd: worktreePath.path,
            model: "gpt-5.4",
            modelProvider: "openai"
        )

        let fallbackPath = WorktreeFlowCoordinator.localForkProjectPath(
            for: worktreeThread,
            localCheckoutPath: nil
        )

        XCTAssertNil(fallbackPath)
    }

    private func makeService(defaults: UserDefaults? = nil) -> CodexService {
        let resolvedDefaults: UserDefaults
        if let defaults {
            resolvedDefaults = defaults
        } else {
            let suiteName = "CodexThreadForkTests.\(UUID().uuidString)"
            let isolatedDefaults = UserDefaults(suiteName: suiteName) ?? .standard
            isolatedDefaults.removePersistentDomain(forName: suiteName)
            resolvedDefaults = isolatedDefaults
        }
        let service = CodexService(defaults: resolvedDefaults)
        Self.retainedServices.append(service)
        return service
    }

    private func commonForkHydrationResponse(for method: String) -> RPCMessage? {
        switch method {
        case "thread/turns/list":
            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([
                    "data": .array([]),
                    "nextCursor": .null,
                ]),
                includeJSONRPC: false
            )
        case "thread/list":
            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([
                    "data": .array([]),
                    "nextCursor": .null,
                ]),
                includeJSONRPC: false
            )
        default:
            return nil
        }
    }

    private func makeSourceThread(
        agentRuntime: String = "codex",
        agentSessionId: String? = nil,
        opencodeBuildAgentName: String? = nil,
        opencodePlanAgentName: String? = nil
    ) -> CodexThread {
        CodexThread(
            id: "source-thread",
            title: "Source",
            cwd: "/tmp/remodex",
            agentRuntime: agentRuntime,
            agentSessionId: agentSessionId,
            opencodeBuildAgentName: opencodeBuildAgentName,
            opencodePlanAgentName: opencodePlanAgentName,
            model: "gpt-5.4",
            modelProvider: "openai"
        )
    }
}
