// FILE: BridgeSlashCommandDecodeTests.swift
// Purpose: Verifies command/list response decoding and slash-command routing helpers.
// Layer: Unit Test
// Exports: BridgeSlashCommandDecodeTests
// Depends on: XCTest, CodexMobile

import XCTest
@testable import CodexMobile

@MainActor
final class BridgeSlashCommandDecodeTests: XCTestCase {
    private static var retainedServices: [CodexService] = []
    private static var retainedViewModels: [TurnViewModel] = []

    func testDecodeSlashCommandsParsesCommandListShape() {
        let service = makeService()
        let result: JSONValue = .object([
            "commands": .array([
                .object([
                    "token": .string("/build"),
                    "title": .string("Build"),
                    "description": .string("Build the project"),
                ]),
                .object([
                    "token": .string("/test"),
                    "title": .string("Test"),
                    "description": .string("Run tests"),
                ]),
            ]),
        ])

        let commands = service.decodeSlashCommands(from: result)

        XCTAssertEqual(commands?.count, 2)
        XCTAssertEqual(commands?.first?.token, "/build")
        XCTAssertEqual(commands?.first?.title, "Build")
        XCTAssertEqual(commands?.first?.description, "Build the project")
        XCTAssertEqual(commands?.last?.token, "/test")
    }

    func testDecodeSlashCommandsReturnsNilWhenCommandsMissing() {
        let service = makeService()
        XCTAssertNil(service.decodeSlashCommands(from: .object([:])))
    }

    func testFetchSlashCommandsCallsCommandListWithDirectory() async throws {
        let service = makeService()
        var capturedMethod: String?
        var capturedDirectory: String?

        service.requestTransportOverride = { method, params in
            capturedMethod = method
            capturedDirectory = params?.objectValue?["directory"]?.stringValue
            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([
                    "commands": .array([
                        .object([
                            "token": .string("/compact"),
                            "title": .string("Compact"),
                            "description": .string("Summarize context"),
                        ]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        }

        let commands = try await service.fetchSlashCommands(directory: "/Users/me/work/repo")

        XCTAssertEqual(capturedMethod, "command/list")
        XCTAssertEqual(capturedDirectory, "/Users/me/work/repo")
        XCTAssertEqual(commands.count, 1)
        XCTAssertEqual(commands.first?.token, "/compact")

        let cached = try await service.fetchSlashCommands(directory: "/Users/me/work/repo")
        XCTAssertEqual(cached.count, 1)
        XCTAssertEqual(capturedMethod, "command/list")
    }

    func testFetchSlashCommandsDoesNotCacheFailures() async {
        let service = makeService()
        var requestCount = 0

        service.requestTransportOverride = { _, _ in
            requestCount += 1
            throw CodexServiceError.disconnected
        }

        do {
            _ = try await service.fetchSlashCommands(directory: "/tmp/failed-project")
            XCTFail("Expected fetchSlashCommands to throw")
        } catch {
            XCTAssertEqual(requestCount, 1)
        }

        do {
            _ = try await service.fetchSlashCommands(directory: "/tmp/failed-project")
            XCTFail("Expected fetchSlashCommands to throw on retry")
        } catch {
            XCTAssertEqual(requestCount, 2)
        }
    }

    func testFetchSlashCommandsUsesCacheWithinTTL() async throws {
        let service = makeService()
        var requestCount = 0

        service.requestTransportOverride = { method, _ in
            XCTAssertEqual(method, "command/list")
            requestCount += 1
            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([
                    "commands": .array([
                        .object([
                            "token": .string("/status"),
                            "title": .string("Status"),
                            "description": .string("Show status"),
                        ]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        }

        _ = try await service.fetchSlashCommands(directory: "/tmp/project-a")
        _ = try await service.fetchSlashCommands(directory: "/tmp/project-a")

        XCTAssertEqual(requestCount, 1)
    }

    func testInvalidateSlashCommandCacheForcesRefetch() async throws {
        let service = makeService()
        var requestCount = 0

        service.requestTransportOverride = { _, _ in
            requestCount += 1
            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object(["commands": .array([])]),
                includeJSONRPC: false
            )
        }

        _ = try await service.fetchSlashCommands(directory: "/tmp/project-b")
        service.invalidateSlashCommandCache()
        _ = try await service.fetchSlashCommands(directory: "/tmp/project-b")

        XCTAssertEqual(requestCount, 2)
    }

    func testBridgeSlashCommandLoadFailureShowsRetryInsteadOfEmptyHint() async {
        let service = makeService()
        service.requestTransportOverride = { _, _ in
            throw CodexServiceError.disconnected
        }
        service.upsertThread(CodexThread(
            id: "thread-slash-failure",
            cwd: "/tmp/project-failure",
            model: "opencode/gpt-5.5",
            modelProvider: "opencode"
        ))

        let viewModel = makeViewModel()
        let thread = CodexThread(
            id: "thread-slash-failure",
            cwd: "/tmp/project-failure",
            model: "opencode/gpt-5.5",
            modelProvider: "opencode"
        )

        viewModel.onInputChangedForSlashCommandAutocomplete(
            "/",
            codex: service,
            thread: thread,
            supportsSlashCommands: true,
            activeTurnID: nil
        )

        for _ in 0..<50 {
            if viewModel.bridgeSlashCommandsLoadError != nil || !viewModel.isLoadingBridgeSlashCommands {
                break
            }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }

        XCTAssertEqual(viewModel.bridgeSlashCommandsLoadError, "Couldn't load commands. Tap to retry.")
        XCTAssertFalse(viewModel.didLoadBridgeSlashCommandsSuccessfully)
        XCTAssertFalse(viewModel.showsBridgeSlashCommandsEmptyHint)
    }

    func testDirectoryChangeDuringFetchUsesLatestDirectoryCommands() async throws {
        let service = makeService()
        let firstDirectoryReady = expectation(description: "first directory fetch started")
        let releaseFirstDirectory = expectation(description: "release first directory fetch")
        var firstFetchStarted = false

        service.requestTransportOverride = { _, params in
            let directory = params?.objectValue?["directory"]?.stringValue
            if directory == "/tmp/project-first" {
                if !firstFetchStarted {
                    firstFetchStarted = true
                    firstDirectoryReady.fulfill()
                }
                await self.fulfillment(of: [releaseFirstDirectory], timeout: 2.0)
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "commands": .array([
                            .object([
                                "token": .string("/stale"),
                                "title": .string("Stale"),
                                "description": .string("Should not win"),
                            ]),
                        ]),
                    ]),
                    includeJSONRPC: false
                )
            }

            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([
                    "commands": .array([
                        .object([
                            "token": .string("/fresh"),
                            "title": .string("Fresh"),
                            "description": .string("Latest directory"),
                        ]),
                    ]),
                ]),
                includeJSONRPC: false
            )
        }

        service.upsertThread(CodexThread(
            id: "thread-slash-race",
            cwd: "/tmp/project-first",
            model: "opencode/gpt-5.5",
            modelProvider: "opencode"
        ))

        let viewModel = makeViewModel()
        let firstThread = CodexThread(
            id: "thread-slash-race",
            cwd: "/tmp/project-first",
            model: "opencode/gpt-5.5",
            modelProvider: "opencode"
        )
        let secondThread = CodexThread(
            id: "thread-slash-race",
            cwd: "/tmp/project-second",
            model: "opencode/gpt-5.5",
            modelProvider: "opencode"
        )

        viewModel.onInputChangedForSlashCommandAutocomplete(
            "/",
            codex: service,
            thread: firstThread,
            supportsSlashCommands: true,
            activeTurnID: nil
        )

        await fulfillment(of: [firstDirectoryReady], timeout: 2.0)

        viewModel.onInputChangedForSlashCommandAutocomplete(
            "/",
            codex: service,
            thread: secondThread,
            supportsSlashCommands: true,
            activeTurnID: nil
        )

        releaseFirstDirectory.fulfill()

        for _ in 0..<100 {
            if viewModel.bridgeSlashCommands.map(\.token) == ["/fresh"] {
                break
            }
            try await Task.sleep(nanoseconds: 20_000_000)
        }

        XCTAssertEqual(viewModel.bridgeSlashCommands.map(\.token), ["/fresh"])
        XCTAssertTrue(viewModel.didLoadBridgeSlashCommandsSuccessfully)
        XCTAssertNil(viewModel.bridgeSlashCommandsLoadError)
    }

    func testBridgeSlashCommandFilteredMatchesTokenTitleAndDescription() {
        let commands = [
            BridgeSlashCommand(token: "/build", title: "Build", description: "Build the project"),
            BridgeSlashCommand(token: "/test", title: "Test", description: "Run tests"),
        ]

        XCTAssertEqual(
            BridgeSlashCommand.filtered(matching: "run", within: commands).map(\.token),
            ["/test"]
        )
        XCTAssertEqual(
            BridgeSlashCommand.filtered(matching: "build", within: commands).map(\.token),
            ["/build"]
        )
    }

    func testAvailableCommandsForOpenCodeProviderExcludeReviewAndSubagents() {
        let commands = TurnComposerSlashCommand.availableCommandsForProvider(
            allowsForkCommand: true,
            modelProvider: "opencode"
        )
        let tokens = Set(commands.map(\.commandToken))
        XCTAssertFalse(tokens.contains("/review"))
        XCTAssertFalse(tokens.contains("/subagents"))
        XCTAssertTrue(tokens.contains("/compact"))
    }

    func testSlashCommandRoutingUsesBridgeListForOpenCodeProvider() {
        XCTAssertEqual(
            TurnComposerSlashCommandRouting.source(
                supportsSlashCommands: true,
                modelProvider: "opencode"
            ),
            .bridgeCommands
        )
        XCTAssertEqual(
            TurnComposerSlashCommandRouting.source(
                supportsSlashCommands: true,
                modelProvider: "codex"
            ),
            .codexEnum
        )
        XCTAssertEqual(
            TurnComposerSlashCommandRouting.source(
                supportsSlashCommands: false,
                modelProvider: "opencode"
            ),
            .disabled
        )
    }

    func testTurnComposerSlashCommandItemFilteredMatchesBridgeMetadata() {
        let items: [TurnComposerSlashCommandItem] = [
            .bridge(BridgeSlashCommand(token: "/plan", title: "Plan", description: "Planning mode")),
            .codex(.status),
        ]

        XCTAssertEqual(
            TurnComposerSlashCommandItem.filtered(matching: "plan", within: items).count,
            1
        )
        XCTAssertEqual(
            TurnComposerSlashCommandItem.filtered(matching: "status", within: items).first?.commandToken,
            "/status"
        )
    }

    private func makeService() -> CodexService {
        let suiteName = "BridgeSlashCommandDecodeTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        let service = CodexService(defaults: defaults)
        service.messagesByThread = [:]
        service.invalidateSlashCommandCache()

        Self.retainedServices.append(service)
        return service
    }

    private func makeViewModel() -> TurnViewModel {
        let viewModel = TurnViewModel()
        Self.retainedViewModels.append(viewModel)
        return viewModel
    }
}