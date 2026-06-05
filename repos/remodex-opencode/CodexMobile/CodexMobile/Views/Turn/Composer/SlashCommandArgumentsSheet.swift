// FILE: SlashCommandArgumentsSheet.swift
// Purpose: PR5b placeholder for slash commands that require arguments (PR5a presents stub only).
// Layer: View Component
// Exports: SlashCommandArgumentsSheet
// Depends on: SwiftUI, BridgeSlashCommand

import SwiftUI

struct SlashCommandArgumentsSheet: View {
    let command: BridgeSlashCommand
    let onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                command.token,
                systemImage: "text.cursor",
                description: Text("Arguments for this command will be available in a future update.")
            )
            .navigationTitle("Command arguments")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", action: onDismiss)
                }
            }
        }
        .presentationDetents([.medium])
    }
}