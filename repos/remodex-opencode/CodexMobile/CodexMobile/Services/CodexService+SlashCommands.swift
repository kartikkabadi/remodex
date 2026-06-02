// FILE: CodexService+SlashCommands.swift
// Purpose: Fetches OpenCode slash commands via bridge command/list with per-directory caching.
// Layer: Service
// Exports: CodexService slash-command fetch/decode helpers
// Depends on: Foundation, CodexService, RPCMessage

import Foundation

private struct SlashCommandCacheEntry: Sendable {
    let commands: [BridgeSlashCommand]
    let fetchedAt: Date
    let directory: String
}

extension CodexService {
    static let slashCommandCacheTTL: TimeInterval = 60

    // Loads slash commands for a project directory, using a short-lived per-directory cache on success only.
    func fetchSlashCommands(directory: String?) async throws -> [BridgeSlashCommand] {
        let normalizedDirectory = Self.normalizedSlashCommandDirectory(directory)
        let cacheKey = normalizedDirectory ?? "__global__"

        if let cached = slashCommandCacheByDirectory[cacheKey],
           Date().timeIntervalSince(cached.fetchedAt) < Self.slashCommandCacheTTL,
           cached.directory == cacheKey {
            return cached.commands
        }

        var paramsObject: RPCObject = [:]
        if let normalizedDirectory {
            paramsObject["directory"] = .string(normalizedDirectory)
        }

        do {
            let response = try await sendRequest(method: "command/list", params: .object(paramsObject))
            let commands = decodeSlashCommands(from: response.result) ?? []
            slashCommandCacheByDirectory[cacheKey] = SlashCommandCacheEntry(
                commands: commands,
                fetchedAt: Date(),
                directory: cacheKey
            )
            return commands
        } catch {
            print("[CodexService] command/list failed for \(cacheKey): \(error.localizedDescription)")
            throw error
        }
    }

    func invalidateSlashCommandCache() {
        slashCommandCacheByDirectory.removeAll()
    }

    func invalidateSlashCommandCache(directory: String?) {
        let normalizedDirectory = Self.normalizedSlashCommandDirectory(directory)
        let cacheKey = normalizedDirectory ?? "__global__"
        slashCommandCacheByDirectory.removeValue(forKey: cacheKey)
    }

    // Parses `result.commands` so tests can validate decoding without transport wiring.
    func decodeSlashCommands(from result: JSONValue?) -> [BridgeSlashCommand]? {
        guard let resultObject = result?.objectValue,
              let commandsValue = resultObject["commands"] else {
            return nil
        }

        return decodeModel([BridgeSlashCommand].self, from: commandsValue)
    }

    static func usesBridgeSlashCommands(modelProvider: String) -> Bool {
        CodexModelOption.normalizedProvider(modelProvider) == "opencode"
    }

    private static func normalizedSlashCommandDirectory(_ directory: String?) -> String? {
        let trimmed = directory?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}

// MARK: - Cache storage (CodexService)

extension CodexService {
    @ObservationIgnored var slashCommandCacheByDirectory: [String: SlashCommandCacheEntry] = [:]
}