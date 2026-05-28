// FILE: CodexService+RuntimeConfig.swift
// Purpose: Runtime model/reasoning/access preferences, per-thread overrides, and model/list loading.
// Layer: Service
// Exports: CodexService runtime config APIs
// Depends on: CodexModelOption, CodexReasoningEffortOption, CodexAccessMode

import Foundation

private let runtimeDebugTimestampFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "HH:mm:ss.SSS"
    return formatter
}()

private enum RuntimeConfigLoadingPolicy {
    static let modelListTimeoutNanoseconds: UInt64 = 8_000_000_000
}

private enum RuntimeSelectionDefaults {
    static let modelId = "gpt-5.5"
    static let reasoningEffort = "medium"

    static func reasoningEffort(for unresolvedModelId: String?) -> String? {
        guard let unresolvedModelId,
              unresolvedModelId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == modelId else {
            return nil
        }
        return reasoningEffort
    }
}

private enum OpenCodeRuntimeSelectionDefaults {
    static let planAgentId = "plan"
}

extension CodexService {
    static func normalizedPreferredAgentRuntime(_ value: String?) -> String {
        AgentRuntime.normalize(value).rawValue
    }

    func setPreferredAgentRuntime(_ runtime: String) {
        let normalized = Self.normalizedPreferredAgentRuntime(runtime)
        preferredAgentRuntime = normalized
        defaults.set(normalized, forKey: Self.preferredAgentRuntimeDefaultsKey)
    }

    // Resolves the effective per-chat override record after normalizing the thread id.
    func threadRuntimeOverride(for threadId: String?) -> CodexThreadRuntimeOverride? {
        guard let normalizedThreadID = normalizedInterruptIdentifier(threadId) else {
            return nil
        }
        return threadRuntimeOverridesByThreadID[normalizedThreadID]
    }

    // Sends one request while trying approvalPolicy enum variants for cross-version compatibility.
    func sendRequestWithApprovalPolicyFallback(
        method: String,
        baseParams: RPCObject,
        context: String
    ) async throws -> RPCMessage {
        let policies = selectedAccessMode.approvalPolicyCandidates
        var lastError: Error?

        for (index, policy) in policies.enumerated() {
            var params = baseParams
            params["approvalPolicy"] = .string(policy)

            do {
                return try await sendRequest(method: method, params: .object(params))
            } catch {
                lastError = error
                let hasMorePolicies = index < (policies.count - 1)
                if hasMorePolicies, shouldRetryWithApprovalPolicyFallback(error) {
                    debugRuntimeLog("\(method) \(context) fallback approvalPolicy=\(policy)")
                    continue
                }
                throw error
            }
        }

        throw lastError ?? CodexServiceError.invalidResponse("\(method) failed with unknown approvalPolicy error")
    }

    func listModels() async throws {
        isLoadingModels = true
        defer { isLoadingModels = false }

        do {
            let response = try await sendRequest(
                method: "model/list",
                params: .object([
                    "cursor": .null,
                    "limit": .integer(50),
                    "includeHidden": .bool(false),
                ]),
                timeoutNanoseconds: RuntimeConfigLoadingPolicy.modelListTimeoutNanoseconds,
                timeoutMessage: "model/list timed out while syncing runtime options."
            )

            guard let resultObject = response.result?.objectValue else {
                throw CodexServiceError.invalidResponse("model/list response missing payload")
            }

            let items =
                resultObject["items"]?.arrayValue
                ?? resultObject["data"]?.arrayValue
                ?? resultObject["models"]?.arrayValue
                ?? []

            let decodedModels = items.compactMap { decodeModel(CodexModelOption.self, from: $0) }
            availableModels = decodedModels
            modelsErrorMessage = nil
            normalizeRuntimeSelectionsAfterModelsUpdate()

            debugRuntimeLog("model/list success count=\(decodedModels.count)")
        } catch {
            handleModelListFailure(error)
            throw error
        }
    }

    func fetchAgentList() async throws {
        isAgentListLoading = true
        defer { isAgentListLoading = false }

        do {
            let response = try await sendRequest(
                method: "agent/list",
                params: .object([:]),
                timeoutNanoseconds: RuntimeConfigLoadingPolicy.modelListTimeoutNanoseconds,
                timeoutMessage: "agent/list timed out while syncing agent options."
            )

            guard let resultObject = response.result?.objectValue else {
                throw CodexServiceError.invalidResponse("agent/list response missing payload")
            }

            let items =
                resultObject["agents"]?.arrayValue
                ?? resultObject["items"]?.arrayValue
                ?? resultObject["data"]?.arrayValue
                ?? []

            let decodedAgents = items.compactMap { decodeModel(AgentOption.self, from: $0) }
            availableAgents = Self.orderedAgentOptions(from: decodedAgents)
            agentsErrorMessage = nil
            normalizeRuntimeSelectionsAfterModelsUpdate()

            debugRuntimeLog("agent/list success count=\(decodedAgents.count)")
        } catch {
            let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
            let normalized = message.isEmpty ? "Unable to load agents" : message
            agentsErrorMessage = normalized
            debugRuntimeLog("agent/list failed: \(normalized)")
            throw error
        }
    }

    func setSelectedModelId(_ modelId: String?) {
        let normalized = modelId?.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized?.isEmpty == false {
            selectedModelId = normalized
        } else {
            selectedModelId = RuntimeSelectionDefaults.modelId
            selectedReasoningEffort = RuntimeSelectionDefaults.reasoningEffort
        }
        hasPersistedSelectedModelId = true
        normalizeRuntimeSelectionsAfterModelsUpdate()
    }

    func setSelectedGitWriterModelId(_ modelId: String?) {
        let normalized = modelId?.trimmingCharacters(in: .whitespacesAndNewlines)
        selectedGitWriterModelId = (normalized?.isEmpty == false) ? normalized : nil
        normalizeRuntimeSelectionsAfterModelsUpdate()
    }

    func setSelectedReasoningEffort(_ effort: String?) {
        let normalized = effort?.trimmingCharacters(in: .whitespacesAndNewlines)
        selectedReasoningEffort = (normalized?.isEmpty == false) ? normalized : nil
        normalizeRuntimeSelectionsAfterModelsUpdate()
    }

    func setThreadReasoningEffortOverride(_ effort: String, for threadId: String?) {
        guard let normalizedThreadID = normalizedInterruptIdentifier(threadId) else {
            return
        }

        let normalizedEffort = effort.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedEffort.isEmpty else {
            clearThreadReasoningEffortOverride(for: normalizedThreadID)
            return
        }

        mutateThreadRuntimeOverride(for: normalizedThreadID) { override in
            override.reasoningEffort = normalizedEffort
            override.overridesReasoning = true
        }
    }

    func clearThreadReasoningEffortOverride(for threadId: String?) {
        guard let normalizedThreadID = normalizedInterruptIdentifier(threadId) else {
            return
        }

        mutateThreadRuntimeOverride(for: normalizedThreadID) { override in
            override.reasoningEffort = nil
            override.overridesReasoning = false
        }
    }

    func setSelectedServiceTier(_ serviceTier: CodexServiceTier?) {
        selectedServiceTier = normalizedServiceTierForSelectedModel(serviceTier)
        persistRuntimeSelections()
    }

    func setThreadServiceTierOverride(_ serviceTier: CodexServiceTier?, for threadId: String?) {
        guard let normalizedThreadID = normalizedInterruptIdentifier(threadId) else {
            return
        }

        let normalizedServiceTier = normalizedServiceTierForSelectedModel(serviceTier)
        mutateThreadRuntimeOverride(for: normalizedThreadID) { override in
            override.serviceTierRawValue = normalizedServiceTier?.rawValue
            override.overridesServiceTier = true
        }
    }

    func clearThreadServiceTierOverride(for threadId: String?) {
        guard let normalizedThreadID = normalizedInterruptIdentifier(threadId) else {
            return
        }

        mutateThreadRuntimeOverride(for: normalizedThreadID) { override in
            override.serviceTierRawValue = nil
            override.overridesServiceTier = false
        }
    }

    func applyThreadRuntimeOverride(_ runtimeOverride: CodexThreadRuntimeOverride?, to threadId: String?) {
        guard let normalizedThreadID = normalizedInterruptIdentifier(threadId) else {
            return
        }

        guard let runtimeOverride, !runtimeOverride.isEmpty else {
            threadRuntimeOverridesByThreadID.removeValue(forKey: normalizedThreadID)
            persistThreadRuntimeOverrides()
            return
        }

        threadRuntimeOverridesByThreadID[normalizedThreadID] = runtimeOverride
        persistThreadRuntimeOverrides()
    }

    func setSelectedAccessMode(_ accessMode: CodexAccessMode) {
        selectedAccessMode = accessMode
        persistRuntimeSelections()
    }

    func selectedAgentId() -> String? {
        normalizedRuntimeSelectionIdentifier(
            defaults.string(forKey: Self.selectedAgentIdDefaultsKey)
        )
    }

    func setSelectedAgentId(_ agentId: String?) {
        let normalized = normalizedRuntimeSelectionIdentifier(agentId)
        if let normalized {
            defaults.set(normalized, forKey: Self.selectedAgentIdDefaultsKey)
        } else {
            defaults.removeObject(forKey: Self.selectedAgentIdDefaultsKey)
        }
    }

    func selectedVariantId() -> String? {
        normalizedRuntimeSelectionIdentifier(
            defaults.string(forKey: Self.selectedVariantIdDefaultsKey)
        )
    }

    func setSelectedVariantId(_ variantId: String?) {
        let normalized = normalizedRuntimeSelectionIdentifier(variantId)
        if let normalized {
            defaults.set(normalized, forKey: Self.selectedVariantIdDefaultsKey)
        } else {
            defaults.removeObject(forKey: Self.selectedVariantIdDefaultsKey)
        }
    }

    func setThreadAgentIdOverride(_ agentId: String?, for threadId: String?) {
        guard let normalizedThreadID = normalizedInterruptIdentifier(threadId) else {
            return
        }

        let normalizedAgentId = normalizedRuntimeSelectionIdentifier(agentId)
        guard let normalizedAgentId else {
            clearThreadAgentIdOverride(for: normalizedThreadID)
            return
        }

        mutateThreadRuntimeOverride(for: normalizedThreadID) { override in
            override.agentId = normalizedAgentId
            override.overridesAgent = true
        }
    }

    func clearThreadAgentIdOverride(for threadId: String?) {
        guard let normalizedThreadID = normalizedInterruptIdentifier(threadId) else {
            return
        }

        mutateThreadRuntimeOverride(for: normalizedThreadID) { override in
            override.agentId = nil
            override.overridesAgent = false
        }
    }

    func setThreadVariantIdOverride(_ variantId: String?, for threadId: String?) {
        guard let normalizedThreadID = normalizedInterruptIdentifier(threadId) else {
            return
        }

        let normalizedVariantId = normalizedRuntimeSelectionIdentifier(variantId)
        guard let normalizedVariantId else {
            clearThreadVariantIdOverride(for: normalizedThreadID)
            return
        }

        mutateThreadRuntimeOverride(for: normalizedThreadID) { override in
            override.variantId = normalizedVariantId
            override.overridesVariant = true
        }
    }

    func clearThreadVariantIdOverride(for threadId: String?) {
        guard let normalizedThreadID = normalizedInterruptIdentifier(threadId) else {
            return
        }

        mutateThreadRuntimeOverride(for: normalizedThreadID) { override in
            override.variantId = nil
            override.overridesVariant = false
        }
    }

    func resolvedAgentId(
        for threadId: String? = nil,
        collaborationMode: CodexCollaborationModeKind? = nil
    ) -> String? {
        if let threadOverride = threadRuntimeOverride(for: threadId),
           threadOverride.overridesAgent,
           let agentId = normalizedRuntimeSelectionIdentifier(threadOverride.agentId) {
            return agentId
        }

        if let selectedAgentId = selectedAgentId() {
            return selectedAgentId
        }

        if collaborationMode == .plan {
            return OpenCodeRuntimeSelectionDefaults.planAgentId
        }

        if let normalizedThreadID = normalizedInterruptIdentifier(threadId),
           currentPlanSessionSource(for: normalizedThreadID) != nil {
            return OpenCodeRuntimeSelectionDefaults.planAgentId
        }

        return nil
    }

    func resolvedVariantId(for threadId: String? = nil) -> String? {
        if let threadOverride = threadRuntimeOverride(for: threadId),
           threadOverride.overridesVariant,
           let variantId = normalizedRuntimeSelectionIdentifier(threadOverride.variantId) {
            return variantId
        }

        if let selectedVariantId = selectedVariantId() {
            return selectedVariantId
        }

        return selectedModelOption()?.defaultVariant
    }

    func selectedModelOption() -> CodexModelOption? {
        selectedModelOption(from: availableModels)
    }

    // Composer chrome should not present the canonical fallback as a loaded user choice.
    func visibleSelectedModelIDForComposer() -> String? {
        if let selectedModel = selectedModelOption() {
            return selectedModel.id
        }

        guard hasPersistedSelectedModelId else {
            return nil
        }

        if shouldHidePersistedDefaultWhileRuntimeLoads {
            return nil
        }

        return selectedModelId
    }

    // Keeps the model pill honest while bridge runtime metadata is still in flight.
    func isRuntimeSelectionLoadingForComposer() -> Bool {
        if supportsAgents, availableAgents.isEmpty, isAgentListLoading {
            return true
        }
        guard visibleSelectedModelIDForComposer() == nil else {
            return false
        }
        return isBootstrappingConnectionSync || isLoadingThreads || isLoadingModels
    }

    func selectedGitWriterModelOption() -> CodexModelOption? {
        selectedGitWriterModelOption(from: availableModels)
    }

    func selectedModelSupportsServiceTier(_ serviceTier: CodexServiceTier) -> Bool {
        selectedModelOption()?.supportsServiceTier(serviceTier) == true
    }

    func gitWriterModelIdentifier() -> String? {
        selectedGitWriterModelOption()?.model
    }

    func supportedReasoningEffortsForSelectedModel() -> [CodexReasoningEffortOption] {
        selectedModelOption()?.supportedReasoningEfforts ?? []
    }

    func isThreadReasoningEffortOverridden(_ threadId: String?) -> Bool {
        guard let threadOverride = threadRuntimeOverride(for: threadId),
              threadOverride.overridesReasoning,
              let selectedReasoning = threadOverride.reasoningEffort else {
            return false
        }

        let supportedReasoningEfforts = Set(
            supportedReasoningEffortsForSelectedModel().map(\.reasoningEffort)
        )
        return supportedReasoningEfforts.contains(selectedReasoning)
    }

    func isThreadServiceTierOverridden(_ threadId: String?) -> Bool {
        threadRuntimeOverride(for: threadId)?.overridesServiceTier == true
    }

    func selectedReasoningEffortForSelectedModel(threadId: String? = nil) -> String? {
        guard let model = selectedModelOption() else {
            return RuntimeSelectionDefaults.reasoningEffort(for: selectedModelId)
                ?? selectedReasoningEffort
                ?? RuntimeSelectionDefaults.reasoningEffort
        }

        let supported = Set(model.supportedReasoningEfforts.map { $0.reasoningEffort })
        guard !supported.isEmpty else {
            return nil
        }

        if let threadOverride = threadRuntimeOverride(for: threadId),
           threadOverride.overridesReasoning,
           let selected = threadOverride.reasoningEffort,
           supported.contains(selected) {
            return selected
        }

        if let selected = selectedReasoningEffort,
           supported.contains(selected) {
            return selected
        }

        if let defaultEffort = model.defaultReasoningEffort,
           supported.contains(defaultEffort) {
            return defaultEffort
        }

        if supported.contains("medium") {
            return "medium"
        }

        return model.supportedReasoningEfforts.first?.reasoningEffort
    }

    func runtimeModelIdentifierForTurn() -> String? {
        selectedModelOption()?.model ?? selectedModelId ?? RuntimeSelectionDefaults.modelId
    }

    func effectiveServiceTier(for threadId: String? = nil) -> CodexServiceTier? {
        let candidate: CodexServiceTier?
        if let threadOverride = threadRuntimeOverride(for: threadId),
           threadOverride.overridesServiceTier {
            candidate = threadOverride.serviceTier
        } else {
            candidate = selectedServiceTier
        }

        guard let candidate else {
            return nil
        }
        return selectedModelSupportsServiceTier(candidate) ? candidate : nil
    }

    func runtimeServiceTierForTurn(threadId: String? = nil) -> String? {
        guard supportsServiceTier else {
            return nil
        }
        return effectiveServiceTier(for: threadId)?.rawValue
    }

    // Copies per-chat runtime overrides forward when we continue an archived thread.
    func inheritThreadRuntimeOverrides(from sourceThreadId: String?, to destinationThreadId: String?) {
        guard let normalizedSourceThreadID = normalizedInterruptIdentifier(sourceThreadId),
              let normalizedDestinationThreadID = normalizedInterruptIdentifier(destinationThreadId),
              normalizedSourceThreadID != normalizedDestinationThreadID else {
            return
        }

        guard let sourceOverride = threadRuntimeOverridesByThreadID[normalizedSourceThreadID] else {
            applyThreadRuntimeOverride(nil, to: normalizedDestinationThreadID)
            return
        }

        applyThreadRuntimeOverride(sourceOverride, to: normalizedDestinationThreadID)
    }

    func runtimeSandboxPolicyObject(for accessMode: CodexAccessMode) -> JSONValue {
        switch accessMode {
        case .onRequest:
            return .object([
                "type": .string("workspaceWrite"),
                "networkAccess": .bool(true),
            ])
        case .fullAccess:
            return .object([
                "type": .string("dangerFullAccess"),
            ])
        }
    }

    func shouldFallbackFromSandboxPolicy(_ error: Error) -> Bool {
        guard let serviceError = error as? CodexServiceError,
              case .rpcError(let rpcError) = serviceError else {
            return false
        }

        if rpcError.code != -32602 && rpcError.code != -32600 {
            return false
        }

        let loweredMessage = rpcError.message.lowercased()
        if loweredMessage.contains("thread not found") || loweredMessage.contains("unknown thread") {
            return false
        }

        return loweredMessage.contains("invalid params")
            || loweredMessage.contains("invalid param")
            || loweredMessage.contains("unknown field")
            || loweredMessage.contains("unexpected field")
            || loweredMessage.contains("unrecognized field")
            || loweredMessage.contains("failed to parse")
            || loweredMessage.contains("unsupported")
    }

    func sendRequestWithSandboxFallback(method: String, baseParams: RPCObject) async throws -> RPCMessage {
        var firstAttemptParams = baseParams
        firstAttemptParams["sandboxPolicy"] = runtimeSandboxPolicyObject(for: selectedAccessMode)

        do {
            debugRuntimeLog("\(method) using sandboxPolicy")
            return try await sendRequestWithApprovalPolicyFallback(
                method: method,
                baseParams: firstAttemptParams,
                context: "sandboxPolicy"
            )
        } catch {
            guard shouldFallbackFromSandboxPolicy(error) else {
                throw error
            }
        }

        var secondAttemptParams = baseParams
        secondAttemptParams["sandbox"] = .string(selectedAccessMode.sandboxLegacyValue)

        do {
            debugRuntimeLog("\(method) fallback using sandbox")
            return try await sendRequestWithApprovalPolicyFallback(
                method: method,
                baseParams: secondAttemptParams,
                context: "sandbox"
            )
        } catch {
            guard shouldFallbackFromSandboxPolicy(error) else {
                throw error
            }
        }

        let finalAttemptParams = baseParams
        debugRuntimeLog("\(method) fallback using minimal payload")
        return try await sendRequestWithApprovalPolicyFallback(
            method: method,
            baseParams: finalAttemptParams,
            context: "minimal"
        )
    }

    func handleModelListFailure(_ error: Error) {
        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized = message.isEmpty ? "Unable to load models" : message
        modelsErrorMessage = normalized
        debugRuntimeLog("model/list failed: \(normalized)")
    }

    func debugRuntimeLog(_ message: String) {
        let entry = "[\(runtimeDebugTimestampFormatter.string(from: Date()))] \(message)"
        runtimeDebugLogEntries.append(entry)
        if runtimeDebugLogEntries.count > 400 {
            runtimeDebugLogEntries.removeFirst(runtimeDebugLogEntries.count - 400)
        }
#if DEBUG
        print("[CodexRuntime] \(entry)")
#endif
    }

    func clearRuntimeDebugLog() {
        runtimeDebugLogEntries.removeAll()
    }

    func shouldRetryWithApprovalPolicyFallback(_ error: Error) -> Bool {
        guard let serviceError = error as? CodexServiceError,
              case .rpcError(let rpcError) = serviceError else {
            return false
        }

        if rpcError.code != -32600 && rpcError.code != -32602 {
            return false
        }

        let message = rpcError.message.lowercased()
        return message.contains("approval")
            || message.contains("unknown variant")
            || message.contains("expected one of")
            || message.contains("onrequest")
            || message.contains("on-request")
    }

    func normalizedServiceTierForSelectedModel(_ serviceTier: CodexServiceTier?) -> CodexServiceTier? {
        guard let serviceTier else {
            return nil
        }
        guard let selectedModel = selectedModelOption() else {
            return serviceTier
        }
        return selectedModel.supportsServiceTier(serviceTier) ? serviceTier : nil
    }
}

private extension CodexService {
    var shouldHidePersistedDefaultWhileRuntimeLoads: Bool {
        guard availableModels.isEmpty else {
            return false
        }

        guard let selectedModelId else {
            return false
        }

        let normalizedSelection = selectedModelId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalizedSelection == RuntimeSelectionDefaults.modelId
            && (isBootstrappingConnectionSync || isLoadingModels)
    }

    // Centralizes thread-override mutation so empty records never linger in storage.
    func mutateThreadRuntimeOverride(
        for threadId: String,
        mutate: (inout CodexThreadRuntimeOverride) -> Void
    ) {
        var currentOverride = threadRuntimeOverridesByThreadID[threadId] ?? CodexThreadRuntimeOverride(
            reasoningEffort: nil,
            serviceTierRawValue: nil,
            agentId: nil,
            variantId: nil,
            overridesReasoning: false,
            overridesServiceTier: false,
            overridesAgent: false,
            overridesVariant: false
        )

        mutate(&currentOverride)

        if currentOverride.isEmpty {
            threadRuntimeOverridesByThreadID.removeValue(forKey: threadId)
        } else {
            threadRuntimeOverridesByThreadID[threadId] = currentOverride
        }

        persistThreadRuntimeOverrides()
    }

    func selectedModelOption(from models: [CodexModelOption]) -> CodexModelOption? {
        guard !models.isEmpty else {
            return nil
        }

        if let selectedModelId,
           let directMatch = models.first(where: { $0.id == selectedModelId || $0.model == selectedModelId }) {
            return directMatch
        }

        return nil
    }

    func selectedGitWriterModelOption(
        from models: [CodexModelOption],
        explicitModelId: String? = nil
    ) -> CodexModelOption? {
        guard !models.isEmpty else {
            return nil
        }

        let savedSelection = explicitModelId ?? selectedGitWriterModelId
        if let savedSelection,
           let directMatch = models.first(where: { $0.id == savedSelection || $0.model == savedSelection }) {
            return directMatch
        }

        if let miniModel = models.first(where: { $0.id == "gpt-5.4-mini" || $0.model == "gpt-5.4-mini" }) {
            return miniModel
        }

        if let runtimeSelected = selectedModelOption(from: models) {
            return runtimeSelected
        }

        return fallbackModel(from: models)
    }

    func fallbackModel(from models: [CodexModelOption]) -> CodexModelOption? {
        // Prefer GPT-5.5 when the bridge advertises it; the rest of the app treats
        // it as the canonical default regardless of the bridge's `isDefault` flag.
        if let preferred = models.first(where: {
            $0.id.lowercased() == "gpt-5.5" || $0.model.lowercased() == "gpt-5.5"
        }) {
            return preferred
        }
        if let defaultModel = models.first(where: { $0.isDefault }) {
            return defaultModel
        }
        return models.first
    }

    func persistRuntimeSelections() {
        if let selectedModelId, !selectedModelId.isEmpty, hasPersistedSelectedModelId {
            defaults.set(selectedModelId, forKey: Self.selectedModelIdDefaultsKey)
        } else {
            defaults.removeObject(forKey: Self.selectedModelIdDefaultsKey)
        }

        if let selectedGitWriterModelId, !selectedGitWriterModelId.isEmpty {
            defaults.set(selectedGitWriterModelId, forKey: Self.selectedGitWriterModelIdDefaultsKey)
        } else {
            defaults.removeObject(forKey: Self.selectedGitWriterModelIdDefaultsKey)
        }

        if let selectedReasoningEffort, !selectedReasoningEffort.isEmpty {
            defaults.set(selectedReasoningEffort, forKey: Self.selectedReasoningEffortDefaultsKey)
        } else {
            defaults.removeObject(forKey: Self.selectedReasoningEffortDefaultsKey)
        }

        if let selectedServiceTier {
            defaults.set(selectedServiceTier.rawValue, forKey: Self.selectedServiceTierDefaultsKey)
        } else {
            defaults.removeObject(forKey: Self.selectedServiceTierDefaultsKey)
        }

        defaults.set(selectedAccessMode.rawValue, forKey: Self.selectedAccessModeDefaultsKey)
        persistThreadRuntimeOverrides()
    }

    func persistThreadRuntimeOverrides() {
        guard !threadRuntimeOverridesByThreadID.isEmpty,
              let encodedOverrides = try? encoder.encode(threadRuntimeOverridesByThreadID) else {
            defaults.removeObject(forKey: macScopedDefaultsKey(Self.threadRuntimeOverridesDefaultsKey))
            return
        }

        defaults.set(encodedOverrides, forKey: macScopedDefaultsKey(Self.threadRuntimeOverridesDefaultsKey))
    }

    func normalizedRuntimeSelectionIdentifier(_ rawValue: String?) -> String? {
        let normalized = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let normalized, !normalized.isEmpty else {
            return nil
        }
        return normalized
    }
}

extension CodexService {
    static let selectedAgentIdDefaultsKey = "codex.selectedAgentId"
    static let selectedVariantIdDefaultsKey = "codex.selectedVariantId"

    func normalizeRuntimeSelectionsAfterModelsUpdate() {
        guard !availableModels.isEmpty else {
            if selectedModelId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
                selectedModelId = nil
            }
            if selectedReasoningEffort?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true {
                selectedReasoningEffort = nil
            }
            pruneInvalidAgentAndVariantSelections()
            persistRuntimeSelections()
            return
        }

        let resolvedModel = selectedModelOption(from: availableModels) ?? fallbackModel(from: availableModels)
        selectedModelId = resolvedModel?.id
        hasPersistedSelectedModelId = resolvedModel != nil

        if let resolvedModel {
            let supported = Set(resolvedModel.supportedReasoningEfforts.map { $0.reasoningEffort })
            if supported.isEmpty {
                selectedReasoningEffort = nil
            } else if let selectedReasoningEffort,
                      supported.contains(selectedReasoningEffort) {
                // Keep current reasoning.
            } else if let modelDefault = resolvedModel.defaultReasoningEffort,
                      supported.contains(modelDefault) {
                selectedReasoningEffort = modelDefault
            } else if supported.contains("medium") {
                selectedReasoningEffort = "medium"
            } else {
                selectedReasoningEffort = resolvedModel.supportedReasoningEfforts.first?.reasoningEffort
            }

            if let selectedServiceTier,
               !resolvedModel.supportsServiceTier(selectedServiceTier) {
                self.selectedServiceTier = nil
            }
        } else {
            selectedReasoningEffort = nil
            selectedServiceTier = nil
        }

        if let selectedGitWriterModelId,
           !availableModels.contains(where: {
               $0.id == selectedGitWriterModelId || $0.model == selectedGitWriterModelId
           }) {
            self.selectedGitWriterModelId = nil
        }

        pruneInvalidAgentAndVariantSelections()
        persistRuntimeSelections()
    }

    func pruneInvalidAgentAndVariantSelections() {
        if !availableAgents.isEmpty {
            let validAgentIds = Set(availableAgents.map(\.id))
            if let selectedAgentId = selectedAgentId(),
               !validAgentIds.contains(selectedAgentId) {
                setSelectedAgentId(nil)
            }

            for threadId in Array(threadRuntimeOverridesByThreadID.keys) {
                guard var override = threadRuntimeOverridesByThreadID[threadId],
                      override.overridesAgent,
                      let agentId = normalizedRuntimeSelectionIdentifier(override.agentId),
                      !validAgentIds.contains(agentId) else {
                    continue
                }
                override.agentId = nil
                override.overridesAgent = false
                if override.isEmpty {
                    threadRuntimeOverridesByThreadID.removeValue(forKey: threadId)
                } else {
                    threadRuntimeOverridesByThreadID[threadId] = override
                }
            }
        }

        guard let resolvedModel = selectedModelOption(from: availableModels) else {
            return
        }

        let supportedReasoning = Set(resolvedModel.supportedReasoningEfforts.map(\.reasoningEffort))
        let validVariantIds = Set(resolvedModel.supportedVariants.map(\.id))

        if let selectedVariantId = selectedVariantId(),
           validVariantIds.isEmpty || !validVariantIds.contains(selectedVariantId) {
            setSelectedVariantId(nil)
        }

        for threadId in Array(threadRuntimeOverridesByThreadID.keys) {
            guard var override = threadRuntimeOverridesByThreadID[threadId] else {
                continue
            }
            var changed = false

            if override.overridesVariant {
                let variantId = normalizedRuntimeSelectionIdentifier(override.variantId)
                let variantIsStale = variantId == nil
                    || validVariantIds.isEmpty
                    || (variantId.map { !validVariantIds.contains($0) } ?? true)
                if variantIsStale {
                    override.variantId = nil
                    override.overridesVariant = false
                    changed = true
                }
            }

            if override.overridesReasoning,
               let reasoningEffort = normalizedRuntimeSelectionIdentifier(override.reasoningEffort),
               !supportedReasoning.isEmpty,
               !supportedReasoning.contains(reasoningEffort) {
                override.reasoningEffort = nil
                override.overridesReasoning = false
                changed = true
            }

            guard changed else {
                continue
            }
            if override.isEmpty {
                threadRuntimeOverridesByThreadID.removeValue(forKey: threadId)
            } else {
                threadRuntimeOverridesByThreadID[threadId] = override
            }
        }
    }
}

extension CodexService {
    static func orderedAgentOptions(from agents: [AgentOption]) -> [AgentOption] {
        let priority = ["build", "plan", "general", "explore"]
        return agents.sorted { lhs, rhs in
            let leftRank = priority.firstIndex(of: lhs.id) ?? Int.max
            let rightRank = priority.firstIndex(of: rhs.id) ?? Int.max
            if leftRank != rightRank {
                return leftRank < rightRank
            }
            return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
        }
    }
}
