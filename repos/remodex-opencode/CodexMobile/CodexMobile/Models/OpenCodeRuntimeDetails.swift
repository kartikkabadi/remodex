// FILE: OpenCodeRuntimeDetails.swift
// Purpose: Nested OpenCode status from runtime/catalog and bridge-status.json opencode blocks.
// Layer: Model
// Exports: OpenCodeRuntimeDetails, OpenCodeConnectedProviderSummary, OpenCodeModelListMeta, OpenCodeProviderLogoCatalogEntry
// Depends on: Foundation

import Foundation

struct OpenCodeConnectedProviderSummary: Codable, Hashable, Sendable {
    let id: String
    let displayName: String
    let modelCount: Int?
}

struct OpenCodeProviderInventoryEntry: Codable, Hashable, Sendable {
    let id: String
    let displayName: String
    let connectedOnServe: Bool
    let authenticated: Bool
    let modelCount: Int?
    let logoProviderId: String?
}

struct OpenCodeModelListMeta: Codable, Hashable, Sendable {
    let reasonCode: String?
    let connectedProviderIds: [String]?
    let fetchedAt: String?
    let stale: Bool?
    let modelCountBeforeCap: Int?
    let modelCountAfterCap: Int?
}

struct OpenCodeRuntimeDetails: Codable, Hashable, Sendable {
    let enabled: Bool?
    let serveUrl: String?
    let version: String?
    let minVersion: String?
    let versionBelowMinimum: Bool?
    let sessionCount: Int?
    let lastError: String?
    let command: String?
    let handoffEnvEnabled: Bool?
    let authConfigured: Bool?
    let connectedProviders: [OpenCodeConnectedProviderSummary]?
    let providerInventory: [OpenCodeProviderInventoryEntry]?
    let providerDiscoveryReasonCode: String?
    let authDiscoveryReasonCode: String?
    let providerInventoryPartial: Bool?
    let providers: [OpenCodeProviderLogoCatalogEntry]?
}

// Catalog entry for logo resolution (from runtime/catalog opencode.providers per RP-BRAND-1/2).
// Matches on id (or caller-supplied logoProviderId key) to logoAssetId; enables catalog-driven
// without hardcoding beyond the 4 core assets.
struct OpenCodeProviderLogoCatalogEntry: Codable, Hashable, Sendable {
    let id: String
    let name: String
    let logoAssetId: String?
}