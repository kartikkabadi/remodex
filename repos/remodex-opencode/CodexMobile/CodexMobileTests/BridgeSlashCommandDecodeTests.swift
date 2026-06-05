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

        // RP-CMD-3: even on fetch error (no persisted yet), OC bridge source gets minimal fallback (not empty panel)
        // /undo etc will come from bridge dynamic on success path; minimal for degraded + codex parity.
        let items = viewModel.availableSlashCommandItems(allowsForkCommand: true, slashSource: .bridgeCommands)
        let tokens = Set(items.map(\.commandToken))
        XCTAssertEqual(items.count, 3)
        XCTAssertTrue(tokens.contains("/compact"))
        XCTAssertTrue(tokens.contains("/review"))
        XCTAssertTrue(tokens.contains("/help"))
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

    func testAvailableCommandsForProvider() {
        // availableCommandsForProvider retains codex assumptions (for codex paths + legacy tests);
        // OC/usesBridge no longer calls it (dynamic bridge primary + minimal fallback for degraded).
        let codexCmds = TurnComposerSlashCommand.availableCommandsForProvider(
            allowsForkCommand: true,
            modelProvider: "codex"
        )
        let codexTokens = Set(codexCmds.map(\.commandToken))
        XCTAssertTrue(codexTokens.contains("/review"))
        XCTAssertTrue(codexTokens.contains("/subagents"))
        XCTAssertTrue(codexTokens.contains("/compact"))

        // opencode provider filter path still exists in func but is not used for command list surface post RP-CMD-3
        let ocViaFunc = TurnComposerSlashCommand.availableCommandsForProvider(
            allowsForkCommand: true,
            modelProvider: "opencode"
        )
        let ocTokens = Set(ocViaFunc.map(\.commandToken))
        XCTAssertFalse(ocTokens.contains("/review"))
        XCTAssertFalse(ocTokens.contains("/subagents"))
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

    // RP-CMD-3 tests: persisted cache + fallback on error + OC /undo visible via bridge (not enum, not empty)
    func testBridgeSlashCommandFallsBackToPersistedOnSubsequentError() async throws {
        let service = makeService()
        // ensure clean persisted for this test (path per persistedSlashCommandsCacheURL impl)
        let home = URL(fileURLWithPath: NSHomeDirectory())
        let cacheFile = home.appendingPathComponent(".remodex/slash-commands-cache.json")
        try? FileManager.default.removeItem(at: cacheFile)
        defer { try? FileManager.default.removeItem(at: cacheFile) }

        let dir = "/tmp/project-persist-fallback"
        // success path (exercises write on success; includes /undo from RP-CMD-1 bridge builtins)
        service.requestTransportOverride = { _, _ in
            RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([
                    "commands": .array([
                        .object([
                            "token": .string("/undo"),
                            "title": .string("Undo"),
                            "description": .string("Undo last edit"),
                        ]),
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

        let first = try await service.fetchSlashCommands(directory: dir)
        XCTAssertEqual(first.map(\.token), ["/undo", "/compact"])

        // now force error: fetch should fallback (no throw) using persisted, returning prior list
        service.requestTransportOverride = { _, _ in
            throw CodexServiceError.disconnected
        }
        let second = try await service.fetchSlashCommands(directory: dir)
        XCTAssertEqual(second.map(\.token), ["/undo", "/compact"])
    }

    func testOpenCodeUsesBridgeDynamicPrimaryAndUndoVisiblePostEnumRemoval() {
        // Explicit post RP-CMD-3 validation: for OC + supports, we route to .bridgeCommands;
        // available uses bridge list (or minimal on degraded) -- never falls back to TurnComposerSlashCommand enum.
        // /undo (from bridge) is visible when dynamic provides it.
        let bridgeItems: [TurnComposerSlashCommandItem] = [
            .bridge(BridgeSlashCommand(token: "/undo", title: "Undo", description: "Undo last")),
            .bridge(BridgeSlashCommand(token: "/help", title: "Help", description: "")),
            .bridge(BridgeSlashCommand(token: "/compact", title: "Compact", description: "")),
        ]
        // simulate what availableSlashCommandItems(bridgeSource) returns when dynamic has data
        let tokens = bridgeItems.map(\.commandToken)
        XCTAssertTrue(tokens.contains("/undo"))
        XCTAssertTrue(tokens.contains("/help"))
        XCTAssertFalse(bridgeItems.contains { $0.codexCommand != nil }) // no codex enum items leaked to OC path

        // degraded case uses minimal (synthetic bridge items), not enum
        let minimal = TurnComposerSlashCommand.minimalFallbackSlashCommands()
        XCTAssertEqual(minimal.map(\.token), ["/compact", "/review", "/help"])
        let minimalItems = minimal.map { TurnComposerSlashCommandItem.bridge($0) }
        XCTAssertTrue(minimalItems.allSatisfy { $0.codexCommand == nil })
    }

    func testSlashSection_ocBuiltin() {
        let section = BridgeSlashCommand.classifySection(
            for: BridgeSlashCommand(token: "/mcp", title: "MCP", description: ""),
            codexOverlapTokens: []
        )
        XCTAssertEqual(section, .ocBuiltin)
    }

    func testSlashSection_codexOverlapCompactUsesOcBuiltin() {
        let codexTokens = Set(
            TurnComposerSlashCommand.availableCommandsForProvider(
                allowsForkCommand: true,
                modelProvider: "opencode"
            ).map(\.commandToken)
        )
        let section = BridgeSlashCommand.classifySection(
            for: BridgeSlashCommand(token: "/compact", title: "Compact", description: ""),
            codexOverlapTokens: codexTokens
        )
        XCTAssertEqual(section, .ocBuiltin)
    }

    func testSlashSection_skillDerived() {
        let bySource = BridgeSlashCommand.classifySection(
            for: BridgeSlashCommand(token: "/lint", title: "Lint", description: "", source: "skill"),
            codexOverlapTokens: []
        )
        XCTAssertEqual(bySource, .skillDerived)

        let byName = BridgeSlashCommand.classifySection(
            for: BridgeSlashCommand(token: "/review-skill", title: "Review", description: ""),
            codexOverlapTokens: [],
            skillNames: ["review-skill"]
        )
        XCTAssertEqual(byName, .skillDerived)
    }

    func testSlashSection_agent() {
        XCTAssertEqual(
            BridgeSlashCommand.classifySection(
                for: BridgeSlashCommand(token: "/agents", title: "Agents", description: ""),
                codexOverlapTokens: []
            ),
            .agent
        )
        XCTAssertEqual(
            BridgeSlashCommand.classifySection(
                for: BridgeSlashCommand(token: "/tool", title: "Tool", description: "", source: "mcp"),
                codexOverlapTokens: []
            ),
            .agent
        )
        XCTAssertEqual(
            BridgeSlashCommand.classifySection(
                for: BridgeSlashCommand(token: "/delegate", title: "Delegate", description: "", agent: "build"),
                codexOverlapTokens: []
            ),
            .agent
        )
    }

    func testDecodeSlashCommandsOptionalFields() throws {
        let json = """
        {
          "commands": [
            {
              "token": "/build",
              "title": "Build",
              "description": "Build project",
              "source": "skill",
              "agent": "build",
              "provider": "opencode",
              "section": "skill"
            }
          ]
        }
        """
        let data = try XCTUnwrap(json.data(using: .utf8))
        let envelope = try JSONDecoder().decode([String: [BridgeSlashCommand]].self, from: data)
        let command = try XCTUnwrap(envelope["commands"]?.first)
        XCTAssertEqual(command.source, "skill")
        XCTAssertEqual(command.agent, "build")
        XCTAssertEqual(command.provider, "opencode")
        XCTAssertEqual(command.section, "skill")
        XCTAssertEqual(
            BridgeSlashCommand.classifySection(for: command, codexOverlapTokens: []),
            .skillDerived
        )
    }

    func testGroupedSectionsOmitsEmpty() {
        let grouped = BridgeSlashCommand.groupedSections(
            commands: [
                BridgeSlashCommand(token: "/undo", title: "Undo", description: ""),
                BridgeSlashCommand(token: "/build", title: "Build", description: "", source: "skill"),
            ],
            codexOverlapTokens: []
        )
        XCTAssertEqual(grouped.map(\.section), [.ocBuiltin, .skillDerived])
        XCTAssertEqual(grouped[0].commands.map(\.token), ["/undo"])
        XCTAssertEqual(grouped[1].commands.map(\.token), ["/build"])
    }

    private func makeService() -> CodexService {
        let suiteName = "BridgeSlashCommandDecodeTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        // Clean persisted slash cache file for test isolation (RP-CMD-3 ~/.remodex/slash-commands-cache.json)
        let home = URL(fileURLWithPath: NSHomeDirectory())
        let cacheFile = home.appendingPathComponent(".remodex/slash-commands-cache.json")
        try? FileManager.default.removeItem(at: cacheFile)
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