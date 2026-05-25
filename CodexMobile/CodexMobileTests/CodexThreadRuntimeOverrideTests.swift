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

        var capturedTurnStartParams: [JSONValue] = []
        service.requestTransportOverride = { method, params in
            switch method {
            case "workspace/checkpointCapture":
                return self.workspaceCheckpointResponse(kind: "messageStart", threadId: "thread-override")
            case "workspace/checkpointCopy":
                return self.workspaceCheckpointResponse(kind: "turnStart", threadId: "thread-override", copied: true)
            case "turn/start":
                capturedTurnStartParams.append(params ?? .null)
                return RPCMessage(
                    id: .string(UUID().uuidString),
                    result: .object(["turnId": .string("turn-override")]),
                    includeJSONRPC: false
                )
            default:
                XCTFail("Unexpected request method \(method)")
                return RPCMessage(id: .string(UUID().uuidString), result: .object([:]), includeJSONRPC: false)
            }
        }

        try await service.sendTurnStart("Ship it", to: "thread-override")

        XCTAssertEqual(capturedTurnStartParams.count, 1)
        XCTAssertEqual(capturedTurnStartParams[0].objectValue?["effort"]?.stringValue, "high")
        XCTAssertNil(capturedTurnStartParams[0].objectValue?["serviceTier"]?.stringValue)
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
            overridesServiceTier: true
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
            overridesServiceTier: true
        )
        _ = try await service.startThread(runtimeOverride: override)

        XCTAssertNil(capturedThreadStartParams.first?.objectValue?["serviceTier"]?.stringValue)
    }

    func testUnsupportedThreadReasoningOverrideIsNotReportedAsActive() {
        let service = makeService()
        service.availableModels = [makeLowOnlyModel()]
        service.setSelectedModelId("gpt-5.4-low")
        service.setThreadReasoningEffortOverride("high", for: "thread-old")

        XCTAssertFalse(service.isThreadReasoningEffortOverridden("thread-old"))
        XCTAssertEqual(service.selectedReasoningEffortForSelectedModel(threadId: "thread-old"), "low")
    }

    func testLockedOpenCodeThreadUsesThreadModelBeforeRuntimeGlobalSelection() {
        let service = makeService()
        service.agentRuntimeDescriptors = [.codex, makeOpenCodeDescriptor()]
        service.setSelectedModelId("opencode-go/deepseek-v4-flash", forAgentRuntime: "opencode")
        let thread = CodexThread(
            id: "thread-opencode",
            agentRuntime: "opencode",
            agentSessionId: "ses_123",
            model: "opencode-go/qwen3.6-plus",
            modelProvider: "opencode-go"
        )

        XCTAssertEqual(service.selectedModelOption(for: thread)?.id, "opencode-go/qwen3.6-plus")
        XCTAssertEqual(service.runtimeModelIdentifierForTurn(thread: thread), "opencode-go/qwen3.6-plus")
    }

    func testSelectingProviderForLockedOpenCodeThreadPersistsThreadModel() {
        let service = makeService()
        service.agentRuntimeDescriptors = [.codex, makeOpenCodeDescriptor()]
        var thread = CodexThread(
            id: "thread-opencode",
            agentRuntime: "opencode",
            agentSessionId: "ses_123",
            model: "opencode-go/deepseek-v4-flash",
            modelProvider: "opencode-go"
        )
        service.upsertThread(thread)

        service.setSelectedRuntimeProviderId("vercel", for: thread)

        thread = service.thread(for: "thread-opencode") ?? thread
        XCTAssertEqual(thread.model, "vercel/alibaba/qwen3.6-plus")
        XCTAssertEqual(thread.modelProvider, "vercel")
        XCTAssertEqual(service.runtimeModelIdentifierForTurn(thread: thread), "vercel/alibaba/qwen3.6-plus")
    }

    private func makeService() -> CodexService {
        let suiteName = "CodexThreadRuntimeOverrideTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        let service = CodexService(defaults: defaults)
        Self.retainedServices.append(service)
        return service
    }

    private func workspaceCheckpointResponse(kind: String, threadId: String, copied: Bool? = nil) -> RPCMessage {
        var result: RPCObject = [
            "repoRoot": .string("/tmp/remodex-local"),
            "checkpointRef": .string("refs/remodex/checkpoints/test"),
            "checkpointKind": .string(kind),
            "threadId": .string(threadId),
        ]
        if let copied {
            result["copied"] = .bool(copied)
        }
        return RPCMessage(
            id: .string(UUID().uuidString),
            result: .object(result),
            includeJSONRPC: false
        )
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

    private func makeOpenCodeDescriptor() -> AgentRuntimeDescriptor {
        AgentRuntimeDescriptor(
            id: "opencode",
            displayName: "OpenCode",
            status: "ready",
            capabilities: .coreOnly,
            modelCatalog: AgentRuntimeModelCatalog(
                defaultModelId: "opencode-go/deepseek-v4-flash",
                defaultProviderId: "opencode-go",
                status: nil,
                statusMessage: nil,
                providers: [
                    AgentRuntimeModelProvider(
                        id: "opencode-go",
                        displayName: "OpenCode Go",
                        modelIds: [
                            "opencode-go/deepseek-v4-flash",
                            "opencode-go/qwen3.6-plus",
                        ],
                        isDefault: true
                    ),
                    AgentRuntimeModelProvider(
                        id: "vercel",
                        displayName: "Vercel",
                        modelIds: ["vercel/alibaba/qwen3.6-plus"],
                        isDefault: false
                    ),
                ],
                models: [
                    makeOpenCodeModel(
                        id: "opencode-go/deepseek-v4-flash",
                        providerID: "opencode-go",
                        modelID: "deepseek-v4-flash",
                        isDefault: true
                    ),
                    makeOpenCodeModel(
                        id: "opencode-go/qwen3.6-plus",
                        providerID: "opencode-go",
                        modelID: "qwen3.6-plus"
                    ),
                    makeOpenCodeModel(
                        id: "vercel/alibaba/qwen3.6-plus",
                        providerID: "vercel",
                        modelID: "alibaba/qwen3.6-plus"
                    ),
                ]
            )
        )
    }

    private func makeOpenCodeModel(
        id: String,
        providerID: String,
        modelID: String,
        isDefault: Bool = false
    ) -> CodexModelOption {
        CodexModelOption(
            id: id,
            model: id,
            displayName: id,
            description: "OpenCode model",
            isDefault: isDefault,
            supportedReasoningEfforts: [],
            defaultReasoningEffort: nil,
            providerID: providerID,
            providerDisplayName: providerID,
            modelID: modelID,
            modelDisplayName: modelID
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
}
