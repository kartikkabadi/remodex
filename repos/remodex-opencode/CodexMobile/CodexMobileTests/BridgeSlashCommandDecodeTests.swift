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

        let commands = await service.fetchSlashCommands(directory: "/Users/me/work/repo")

        XCTAssertEqual(capturedMethod, "command/list")
        XCTAssertEqual(capturedDirectory, "/Users/me/work/repo")
        XCTAssertEqual(commands.count, 1)
        XCTAssertEqual(commands.first?.token, "/compact")

        let cached = await service.fetchSlashCommands(directory: "/Users/me/work/repo")
        XCTAssertEqual(cached.count, 1)
        XCTAssertEqual(capturedMethod, "command/list")
    }

    func testFetchSlashCommandsUsesCacheWithinTTL() async {
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

        _ = await service.fetchSlashCommands(directory: "/tmp/project-a")
        _ = await service.fetchSlashCommands(directory: "/tmp/project-a")

        XCTAssertEqual(requestCount, 1)
    }

    func testInvalidateSlashCommandCacheForcesRefetch() async {
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

        _ = await service.fetchSlashCommands(directory: "/tmp/project-b")
        service.invalidateSlashCommandCache()
        _ = await service.fetchSlashCommands(directory: "/tmp/project-b")

        XCTAssertEqual(requestCount, 2)
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
}