// FILE: CodexThreadRuntimeOverrideTests.swift
// Purpose: Verifies per-thread runtime overrides for reasoning and speed beat app defaults.
// Layer: Unit Test
// Exports: CodexThreadRuntimeOverrideTests
// Depends on: XCTest, CodexMobile

import XCTest
@testable import CodexMobile

@MainActor
final class CodexThreadRuntimeOverrideTests: XCTestCase {
    private static var retainedServices: [CodexService] = []

    func testTurnStartUsesThreadRuntimeOverridesInsteadOfAppDefaults() async throws {
        let service = makeService()
        service.isConnected = true
        service.availableModels = [makeModel()]
        service.setSelectedModelId("gpt-5.4")
        service.setSelectedReasoningEffort("medium")
        service.setSelectedServiceTier(.fast)
        service.setThreadReasoningEffortOverride("high", for: "thread-override")
        service.setThreadServiceTierOverride(nil, for: "thread-override")

        let capturedTurnStartParams = TurnStartParamsCapture()
        service.requestTransportOverride = turnStartTransportOverride(
            capture: capturedTurnStartParams,
            turnId: "turn-override"
        )

        try await service.sendTurnStart("Ship it", to: "thread-override")

        XCTAssertEqual(capturedTurnStartParams.values.count, 1)
        XCTAssertEqual(capturedTurnStartParams.values[0].objectValue?["effort"]?.stringValue, "high")
        XCTAssertNil(capturedTurnStartParams.values[0].objectValue?["serviceTier"]?.stringValue)
    }

    func testThreadServiceTierOverridePersistsExplicitNormalSelection() {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)

        let firstService = CodexService(defaults: defaults)
        Self.retainedServices.append(firstService)
        firstService.setSelectedServiceTier(.fast)
        firstService.setThreadServiceTierOverride(nil, for: "thread-normal")

        XCTAssertTrue(firstService.isThreadServiceTierOverridden("thread-normal"))
        XCTAssertNil(firstService.effectiveServiceTier(for: "thread-normal"))

        let secondService = CodexService(defaults: defaults)
        Self.retainedServices.append(secondService)

        XCTAssertTrue(secondService.isThreadServiceTierOverridden("thread-normal"))
        XCTAssertNil(secondService.effectiveServiceTier(for: "thread-normal"))
    }

    func testClearingSelectedModelFallsBackToGPT55Medium() {
        let service = makeService()
        service.availableModels = [makeGPT55Model(), makeModel()]
        service.setSelectedModelId("gpt-5.4")
        service.setSelectedReasoningEffort("high")

        service.setSelectedModelId(nil)

        XCTAssertEqual(service.selectedModelId, "gpt-5.5")
        XCTAssertEqual(service.selectedReasoningEffort, "medium")
        XCTAssertEqual(service.runtimeModelIdentifierForTurn(), "gpt-5.5")
        XCTAssertEqual(service.selectedReasoningEffortForSelectedModel(), "medium")
    }

    func testPersistedModelSelectionIsUsableBeforeModelListRefresh() {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        defaults.set("gpt-5.3-codex", forKey: CodexService.selectedModelIdDefaultsKey)

        let service = CodexService(defaults: defaults)
        Self.retainedServices.append(service)

        XCTAssertTrue(service.availableModels.isEmpty)
        XCTAssertTrue(service.hasPersistedSelectedModelId)
        XCTAssertEqual(service.selectedModelId, "gpt-5.3-codex")
        XCTAssertEqual(service.runtimeModelIdentifierForTurn(), "gpt-5.3-codex")
        XCTAssertEqual(service.selectedReasoningEffortForSelectedModel(), "medium")
        XCTAssertEqual(
            TurnComposerMetaMapper.modelTitle(forIdentifier: service.selectedModelId),
            "GPT-5.3-Codex"
        )
    }

    func testComposerShowsLoadingForPersistedDefaultBeforeModelListRefresh() {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        defaults.set("gpt-5.5", forKey: CodexService.selectedModelIdDefaultsKey)

        let service = CodexService(defaults: defaults)
        Self.retainedServices.append(service)
        service.isBootstrappingConnectionSync = true

        XCTAssertTrue(service.availableModels.isEmpty)
        XCTAssertNil(service.visibleSelectedModelIDForComposer())
        XCTAssertTrue(service.isRuntimeSelectionLoadingForComposer())
        XCTAssertEqual(service.runtimeModelIdentifierForTurn(), "gpt-5.5")
    }

    func testComposerKeepsCustomPersistedModelVisibleDuringBootstrap() {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        defaults.set("gpt-5.3-codex", forKey: CodexService.selectedModelIdDefaultsKey)

        let service = CodexService(defaults: defaults)
        Self.retainedServices.append(service)
        service.isBootstrappingConnectionSync = true

        XCTAssertEqual(service.visibleSelectedModelIDForComposer(), "gpt-5.3-codex")
        XCTAssertFalse(service.isRuntimeSelectionLoadingForComposer())
    }

    func testDefaultModelFallbackIsNotPersistedBeforeModelListRefresh() {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)

        let service = CodexService(defaults: defaults)
        Self.retainedServices.append(service)
        service.normalizeRuntimeSelectionsAfterModelsUpdate()

        XCTAssertFalse(service.hasPersistedSelectedModelId)
        XCTAssertNil(service.selectedModelId)
        XCTAssertNil(service.selectedReasoningEffort)
        XCTAssertEqual(service.runtimeModelIdentifierForTurn(), "gpt-5.5")
        XCTAssertNil(defaults.string(forKey: CodexService.selectedModelIdDefaultsKey))
    }

    func testModelListRefreshPersistsResolvedDefaultForFutureLaunches() {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)

        let firstService = CodexService(defaults: defaults)
        Self.retainedServices.append(firstService)
        firstService.availableModels = [makeGPT55Model(), makeModel()]
        firstService.normalizeRuntimeSelectionsAfterModelsUpdate()

        XCTAssertTrue(firstService.hasPersistedSelectedModelId)
        XCTAssertEqual(firstService.selectedModelId, "gpt-5.5")
        XCTAssertEqual(defaults.string(forKey: CodexService.selectedModelIdDefaultsKey), "gpt-5.5")

        let secondService = CodexService(defaults: defaults)
        Self.retainedServices.append(secondService)

        XCTAssertTrue(secondService.hasPersistedSelectedModelId)
        XCTAssertEqual(secondService.selectedModelId, "gpt-5.5")
    }

    func testContinuationInheritsThreadRuntimeOverrides() {
        let service = makeService()
        service.availableModels = [makeModel()]
        service.setSelectedModelId("gpt-5.4")
        service.setThreadReasoningEffortOverride("high", for: "thread-old")
        service.setThreadServiceTierOverride(.fast, for: "thread-old")

        service.inheritThreadRuntimeOverrides(from: "thread-old", to: "thread-new")

        XCTAssertEqual(
            service.selectedReasoningEffortForSelectedModel(threadId: "thread-new"),
            "high"
        )
        XCTAssertEqual(service.effectiveServiceTier(for: "thread-new"), .fast)
    }

    func testStartThreadUsesProvidedRuntimeOverrideForServiceTier() async throws {
        let service = makeService()
        service.isConnected = true
        service.availableModels = [makeModel()]
        service.setSelectedModelId("gpt-5.4")
        service.setSelectedServiceTier(nil)

        var capturedThreadStartParams: [JSONValue] = []
        service.requestTransportOverride = { method, params in
            XCTAssertEqual(method, "thread/start")
            capturedThreadStartParams.append(params ?? .null)
            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([
                    "thread": .object([
                        "id": .string("thread-new"),
                        "cwd": .string("/tmp/project"),
                    ]),
                ]),
                includeJSONRPC: false
            )
        }

        let override = CodexThreadRuntimeOverride(
            reasoningEffort: "high",
            serviceTierRawValue: "fast",
            overridesReasoning: true,
            overridesServiceTier: true,
            overridesAgent: false,
            overridesVariant: false
        )
        let thread = try await service.startThread(runtimeOverride: override)

        XCTAssertEqual(thread.id, "thread-new")
        XCTAssertEqual(capturedThreadStartParams.first?.objectValue?["serviceTier"]?.stringValue, "fast")
        XCTAssertEqual(service.effectiveServiceTier(for: "thread-new"), .fast)
        XCTAssertTrue(service.hydratedThreadIDs.contains("thread-new"))
        XCTAssertTrue(service.initialTurnsLoadedByThreadID.contains("thread-new"))
    }

    func testStartThreadDropsFastRuntimeOverrideWhenSelectedModelDoesNotSupportFastMode() async throws {
        let service = makeService()
        service.isConnected = true
        service.availableModels = [makeLowOnlyModel()]
        service.setSelectedModelId("gpt-5.4-low")

        var capturedThreadStartParams: [JSONValue] = []
        service.requestTransportOverride = { method, params in
            XCTAssertEqual(method, "thread/start")
            capturedThreadStartParams.append(params ?? .null)
            return RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([
                    "thread": .object([
                        "id": .string("thread-new"),
                        "cwd": .string("/tmp/project"),
                    ]),
                ]),
                includeJSONRPC: false
            )
        }

        let override = CodexThreadRuntimeOverride(
            reasoningEffort: "low",
            serviceTierRawValue: "fast",
            overridesReasoning: true,
            overridesServiceTier: true,
            overridesAgent: false,
            overridesVariant: false
        )
        _ = try await service.startThread(runtimeOverride: override)

        XCTAssertNil(capturedThreadStartParams.first?.objectValue?["serviceTier"]?.stringValue)
    }

    func testLearnBridgeRuntimeCapabilitiesFromInitializeResponse() {
        let service = makeService()
        let response = RPCMessage(
            id: .string(UUID().uuidString),
            result: .object([
                "capabilities": .object([
                    "agentRuntime": .string("opencode"),
                    "supportsAgents": .bool(true),
                    "supportsVariants": .bool(true),
                    "requiresOpenaiAuth": .bool(false),
                ]),
            ]),
            includeJSONRPC: false
        )

        service.learnBridgeRuntimeCapabilitiesFromInitializeResponse(response)

        XCTAssertEqual(service.connectedBridgeProvider, "opencode")
        XCTAssertTrue(service.isOpenCodeRuntimeConnected)
        XCTAssertTrue(service.supportsAgents)
        XCTAssertFalse(service.requiresOpenaiAuth)
    }

    func testConnectedBridgeProviderDefaultsToCodexWhenCapabilitiesMissing() {
        let service = makeService()
        let response = RPCMessage(
            id: .string(UUID().uuidString),
            result: .object([:]),
            includeJSONRPC: false
        )

        service.learnBridgeRuntimeCapabilitiesFromInitializeResponse(response)

        XCTAssertEqual(service.connectedBridgeProvider, "codex")
        XCTAssertFalse(service.isOpenCodeRuntimeConnected)
        XCTAssertTrue(service.requiresOpenaiAuth)
    }

    func testResolvedVariantIdPrefersThreadOverrideThenGlobalThenModelDefault() {
        let service = makeService()
        service.availableModels = [
            CodexModelOption(
                id: "gpt-5.4",
                model: "gpt-5.4",
                displayName: "GPT-5.4",
                description: "Test model",
                isDefault: true,
                supportedReasoningEfforts: [],
                defaultReasoningEffort: nil,
                defaultVariant: "balanced"
            ),
        ]
        service.setSelectedModelId("gpt-5.4")
        service.setSelectedVariantId("fast")
        service.setThreadVariantIdOverride("high", for: "thread-variant")

        XCTAssertEqual(service.resolvedVariantId(for: "thread-variant"), "high")
        XCTAssertEqual(service.resolvedVariantId(for: "thread-other"), "fast")
        XCTAssertEqual(service.resolvedVariantId(), "fast")

        service.setSelectedVariantId(nil)
        XCTAssertEqual(service.resolvedVariantId(for: "thread-other"), "balanced")
    }

    func testTurnStartIncludesAgentAndVariantForOpenCodeRuntime() async throws {
        let service = makeService()
        service.isConnected = true
        service.bridgeRuntimeCapabilities = CodexBridgeRuntimeCapabilities(
            agentRuntime: "opencode",
            supportsAgents: true,
            supportsVariants: true,
            requiresOpenaiAuth: false
        )
        service.availableModels = [makeModel()]
        service.setSelectedAgentId("build")
        service.setSelectedVariantId("high")
        service.setThreadAgentIdOverride("custom", for: "thread-opencode")
        service.setThreadVariantIdOverride("thinking", for: "thread-opencode")

        let capturedTurnStartParams = TurnStartParamsCapture()
        service.requestTransportOverride = turnStartTransportOverride(
            capture: capturedTurnStartParams,
            turnId: "turn-opencode"
        )

        try await service.sendTurnStart("Ship it", to: "thread-opencode")

        XCTAssertEqual(capturedTurnStartParams.values.count, 1)
        XCTAssertEqual(capturedTurnStartParams.values[0].objectValue?["agent"]?.stringValue, "custom")
        XCTAssertEqual(capturedTurnStartParams.values[0].objectValue?["variant"]?.stringValue, "thinking")
    }

    func testTurnStartOmitsAgentAndVariantForCodexRuntime() async throws {
        let service = makeService()
        service.isConnected = true
        service.bridgeRuntimeCapabilities = .codexDefault
        service.setSelectedAgentId("build")
        service.setSelectedVariantId("high")

        let capturedTurnStartParams = TurnStartParamsCapture()
        service.requestTransportOverride = turnStartTransportOverride(
            capture: capturedTurnStartParams,
            turnId: "turn-codex"
        )

        try await service.sendTurnStart("Ship it", to: "thread-codex")

        XCTAssertEqual(capturedTurnStartParams.values.count, 1)
        XCTAssertNil(capturedTurnStartParams.values[0].objectValue?["agent"])
        XCTAssertNil(capturedTurnStartParams.values[0].objectValue?["variant"])
    }

    func testResolvedAgentIdPrefersThreadOverrideThenGlobalThenPlanAgent() {
        let service = makeService()
        service.setSelectedAgentId("build")
        service.setThreadAgentIdOverride("custom", for: "thread-agent")

        XCTAssertEqual(service.resolvedAgentId(for: "thread-agent"), "custom")
        XCTAssertEqual(service.resolvedAgentId(for: "thread-other"), "build")

        service.setSelectedAgentId(nil)
        XCTAssertEqual(
            service.resolvedAgentId(for: "thread-plan", collaborationMode: .plan),
            "plan"
        )

        service.planSessionSourceByThread["thread-plan"] = .requested
        XCTAssertEqual(service.resolvedAgentId(for: "thread-plan"), "plan")
    }

    func testUnsupportedThreadReasoningOverrideIsNotReportedAsActive() {
        let service = makeService()
        service.availableModels = [makeLowOnlyModel()]
        service.setSelectedModelId("gpt-5.4-low")
        service.setThreadReasoningEffortOverride("high", for: "thread-old")

        XCTAssertFalse(service.isThreadReasoningEffortOverridden("thread-old"))
        XCTAssertEqual(service.selectedReasoningEffortForSelectedModel(threadId: "thread-old"), "low")
    }

    private final class TurnStartParamsCapture: @unchecked Sendable {
        var values: [JSONValue] = []
    }

    private func turnStartTransportOverride(
        capture: TurnStartParamsCapture,
        turnId: String
    ) -> @Sendable (String, JSONValue?) -> RPCMessage {
        { method, params in
            switch method {
            case "workspace/checkpointCapture":
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object(["kind": .string("messageStart")]),
                    includeJSONRPC: false
                )
            case "workspace/checkpointCopy":
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object([
                        "kind": .string("turnStart"),
                        "copied": .bool(true),
                    ]),
                    includeJSONRPC: false
                )
            case "turn/start":
                capture.values.append(params ?? .null)
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object(["turnId": .string(turnId)]),
                    includeJSONRPC: false
                )
            default:
                XCTFail("Unexpected method \(method)")
                return RPCMessage(id: .string(UUID().uuidString), result: .object([:]), includeJSONRPC: false)
            }
        }
    }

    private func makeService() -> CodexService {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        let service = CodexService(defaults: defaults)
        Self.retainedServices.append(service)
        return service
    }

    private func makeModel() -> CodexModelOption {
        CodexModelOption(
            id: "gpt-5.4",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            description: "Test model",
            isDefault: true,
            supportsFastMode: true,
            supportedReasoningEfforts: [
                CodexReasoningEffortOption(reasoningEffort: "medium", description: "Medium"),
                CodexReasoningEffortOption(reasoningEffort: "high", description: "High"),
            ],
            defaultReasoningEffort: "medium"
        )
    }

    private func makeGPT55Model() -> CodexModelOption {
        CodexModelOption(
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Test model",
            isDefault: true,
            supportsFastMode: true,
            supportedReasoningEfforts: [
                CodexReasoningEffortOption(reasoningEffort: "medium", description: "Medium"),
                CodexReasoningEffortOption(reasoningEffort: "high", description: "High"),
            ],
            defaultReasoningEffort: "medium"
        )
    }

    private func makeLowOnlyModel() -> CodexModelOption {
        CodexModelOption(
            id: "gpt-5.4-low",
            model: "gpt-5.4-low",
            displayName: "GPT-5.4 Low",
            description: "Test model",
            isDefault: true,
            supportedReasoningEfforts: [
                CodexReasoningEffortOption(reasoningEffort: "low", description: "Low"),
            ],
            defaultReasoningEffort: "low"
        )
    }

    func testCodexThreadDecodesAgentRuntimeFromThreadReadPayload() throws {
        let payload: JSONValue = .object([
            "id": .string("thread-opencode"),
            "agentRuntime": .string("opencode"),
        ])
        let data = try JSONEncoder().encode(payload)
        let thread = try JSONDecoder().decode(CodexThread.self, from: data)

        XCTAssertEqual(thread.agentRuntime, "opencode")
        XCTAssertTrue(thread.isOpenCodeAgentRuntime)
    }

    func testCodexThreadDefaultsAgentRuntimeToCodexWhenMissing() throws {
        let payload: JSONValue = .object([
            "id": .string("thread-codex"),
        ])
        let data = try JSONEncoder().encode(payload)
        let thread = try JSONDecoder().decode(CodexThread.self, from: data)

        XCTAssertEqual(thread.agentRuntime, "codex")
        XCTAssertFalse(thread.isOpenCodeAgentRuntime)
    }

    func testPreferredAgentRuntimePersistsAcrossServiceInstances() {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)

        let firstService = CodexService(defaults: defaults)
        Self.retainedServices.append(firstService)
        firstService.setPreferredAgentRuntime("opencode")

        let secondService = CodexService(defaults: defaults)
        Self.retainedServices.append(secondService)
        XCTAssertEqual(secondService.preferredAgentRuntime, "opencode")
    }

    func testPreferredRuntimeMismatchHintWhenConnectedRuntimeDiffers() {
        let service = makeService()
        service.isConnected = true
        service.isInitialized = true
        service.setPreferredAgentRuntime("opencode")
        service.learnBridgeRuntimeCapabilitiesFromInitializeResponse(
            RPCMessage(
                id: .string(UUID().uuidString),
                result: .object([
                    "capabilities": .object([
                        "agentRuntime": .string("codex"),
                        "supportsAgents": .bool(false),
                        "supportsVariants": .bool(false),
                        "requiresOpenaiAuth": .bool(true),
                    ]),
                ]),
                includeJSONRPC: false
            )
        )

        XCTAssertEqual(
            service.preferredRuntimeMismatchHint,
            "Connected to a Codex bridge. Switch on this Mac to use OpenCode."
        )
    }

    func testFetchAgentListSurfacesErrorMessageWithoutThrowingFromRefreshPath() async {
        let service = makeService()
        service.isConnected = true
        service.isInitialized = true
        service.bridgeRuntimeCapabilities = CodexBridgeRuntimeCapabilities(
            agentRuntime: "opencode",
            supportsAgents: true,
            supportsVariants: true,
            requiresOpenaiAuth: false
        )
        service.requestTransportOverride = { method, _ in
            if method == "agent/list" {
                throw CodexServiceError.rpcError(
                    RPCError(code: -32000, message: "agent catalog offline")
                )
            }
            return RPCMessage(id: .string(UUID().uuidString), result: .object([:]), includeJSONRPC: false)
        }

        do {
            try await service.fetchAgentList()
            XCTFail("Expected fetchAgentList to throw")
        } catch {
            // Expected.
        }

        XCTAssertEqual(service.agentsErrorMessage, "RPC error -32000: agent catalog offline")
    }
}
