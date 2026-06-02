// FILE: OpenCodeRuntimeDetails.swift
// Purpose: Nested OpenCode status from runtime/catalog and bridge-status.json opencode blocks.
// Layer: Model
// Exports: OpenCodeRuntimeDetails
// Depends on: Foundation

import Foundation

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
}