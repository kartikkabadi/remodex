// FILE: CodexService+SlashCommands.swift
// Purpose: Fetches OpenCode slash commands via bridge command/list with per-directory caching.
// Layer: Service
// Exports: CodexService slash-command fetch/decode helpers
// Depends on: Foundation, CodexService, RPCMessage

import Foundation

struct SlashCommandCacheEntry: Sendable {
    let commands: [BridgeSlashCommand]
    let fetchedAt: Date
    let directory: String
}

extension SlashCommandCacheEntry: Codable {}

extension CodexService {
    static let slashCommandCacheTTL: TimeInterval = 60
    static let persistedSlashCommandsCacheTTL: TimeInterval = 24 * 60 * 60

    // Loads slash commands for a project directory, using a short-lived per-directory cache on success only.
    // Persisted long-term cache (~/.remodex/slash-commands-cache.json, 24h TTL) is written on successful
    // fetch and loaded on startup; on RPC error we fall back to it (if within TTL) for bridge-down resilience
    // + to ensure OC slash never empty when supportsSlashCommands (dynamic primary; minimal static also in UI layer).
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
            savePersistedSlashCommandCache()
            return commands
        } catch {
            print("[CodexService] command/list failed for \(cacheKey): \(error.localizedDescription)")
            if let fallback = loadPersistedEntry(for: cacheKey) {
                // bridge-down / startup-before-connect / fetch error: serve last successful (written only on prior success)
                // refresh in-mem ts for 60s window; persisted ts unchanged (only success writes it)
                slashCommandCacheByDirectory[cacheKey] = SlashCommandCacheEntry(
                    commands: fallback.commands,
                    fetchedAt: Date(),
                    directory: fallback.directory
                )
                return fallback.commands
            }
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

    // MARK: - Persisted slash cache (RP-CMD-3: 24h TTL, written on success, loaded at startup + fallback on error)
    // File lives at ~/.remodex/slash-commands-cache.json (in practice under iOS app support or container home).
    // Schema is JSON object: { "<cacheKey>": { "commands": [BridgeSlashCommand], "fetchedAt": "ISO8601", "directory": "..." }, ... }
    // This + the minimal static fallback in TurnComposerCommandState ensures OC never sees empty panel in degraded.

    func loadPersistedSlashCommandCache() {
        let url = persistedSlashCommandsCacheURL()
        guard let data = try? Data(contentsOf: url) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let entries = try? decoder.decode([String: SlashCommandCacheEntry].self, from: data) else { return }
        let now = Date()
        for (key, entry) in entries {
            if now.timeIntervalSince(entry.fetchedAt) < Self.persistedSlashCommandsCacheTTL {
                slashCommandCacheByDirectory[key] = entry
            }
        }
    }

    func savePersistedSlashCommandCache() {
        let url = persistedSlashCommandsCacheURL()
        let now = Date()
        let toSave = slashCommandCacheByDirectory.filter { _, entry in
            now.timeIntervalSince(entry.fetchedAt) < Self.persistedSlashCommandsCacheTTL
        }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(toSave) else { return }
        let directory = url.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: url, options: [.atomic])
    }

    private func loadPersistedEntry(for cacheKey: String) -> SlashCommandCacheEntry? {
        let url = persistedSlashCommandsCacheURL()
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let entries = try? decoder.decode([String: SlashCommandCacheEntry].self, from: data) else { return nil }
        guard let entry = entries[cacheKey] else { return nil }
        if Date().timeIntervalSince(entry.fetchedAt) < Self.persistedSlashCommandsCacheTTL {
            return entry
        }
        return nil
    }

    private func persistedSlashCommandsCacheURL() -> URL {
        // Matches spec path ~/.remodex/slash-commands-cache.json (effective location is sandboxed on iOS).
        let home = URL(fileURLWithPath: NSHomeDirectory())
        let dir = home.appendingPathComponent(".remodex", isDirectory: true)
        return dir.appendingPathComponent("slash-commands-cache.json")
    }
}
