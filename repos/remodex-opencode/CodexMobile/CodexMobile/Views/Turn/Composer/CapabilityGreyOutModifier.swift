// FILE: CapabilityGreyOutModifier.swift
// Purpose: ViewModifier implementing the ADR-002 tri-state capability model
//          (enabled / greyed / hidden) for composer controls.
// Layer: View Helper
// Exports: CapabilityGreyOutModifier, View.capabilityGreyOut(isEnabled:reason:)
// Depends on: SwiftUI

import SwiftUI

struct CapabilityGreyOutModifier: ViewModifier {
    let isEnabled: Bool
    let reason: String?

    func body(content: Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            content
                .disabled(!isEnabled)
                .opacity(isEnabled ? 1.0 : 0.5)

            if let reason, !isEnabled {
                Text(reason)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }
}

extension View {
    func capabilityGreyOut(isEnabled: Bool, reason: String? = nil) -> some View {
        modifier(CapabilityGreyOutModifier(isEnabled: isEnabled, reason: reason))
    }
}
