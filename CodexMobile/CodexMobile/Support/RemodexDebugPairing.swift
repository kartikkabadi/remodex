// FILE: RemodexDebugPairing.swift
// Purpose: DEBUG-only simulator pairing token from launch args or environment (Wave 2A automation).
// Layer: Support
// Exports: RemodexDebugPairing
// Depends on: Foundation

import Foundation

#if DEBUG
enum RemodexDebugPairing {
    private static let launchArgumentName = "-RemodexDebugPairingRMX1"
    private static let environmentKey = "REMODOX_DEBUG_PAIRING_RMX1"

    // Reads `REMODOX_DEBUG_PAIRING_RMX1` or `-RemodexDebugPairingRMX1 <token>` from the process environment.
    static func loadToken() -> String? {
        if let environmentToken = normalizedToken(ProcessInfo.processInfo.environment[environmentKey]) {
            return environmentToken
        }

        let arguments = ProcessInfo.processInfo.arguments
        for index in arguments.indices {
            let argument = arguments[index]
            if argument == launchArgumentName {
                guard index + 1 < arguments.count else {
                    return nil
                }
                return normalizedToken(arguments[index + 1])
            }

            let prefix = "\(launchArgumentName)="
            if argument.hasPrefix(prefix) {
                return normalizedToken(String(argument.dropFirst(prefix.count)))
            }
        }

        return nil
    }

    private static func normalizedToken(_ raw: String?) -> String? {
        guard let raw else {
            return nil
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }
        if trimmed.hasPrefix("RMX1:") {
            return trimmed
        }
        return "RMX1:\(trimmed)"
    }
}
#endif
