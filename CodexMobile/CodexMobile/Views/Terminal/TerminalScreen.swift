// FILE: TerminalScreen.swift
// Purpose: Full-page Ghostty SSH terminal route modeled after t3code-mobile's terminal screen.
// Layer: View
// Exports: TerminalScreen
// Depends on: CodexService, GhosttyTerminalSurface, RemodexTerminalModels

import Foundation
import SwiftUI
import UIKit

private let remodexTerminalDefaultFontSize = 10.0
private let remodexTerminalFontSizeStep = 0.5
private let remodexTerminalMinFontSize = 6.0
private let remodexTerminalMaxFontSize = 14.0
private let remodexTerminalAccessoryHeight: CGFloat = 52

private enum TerminalPendingModifier: Equatable {
    case ctrl
    case meta
}

private enum TerminalHostPlatform {
    case mac
    case linux
    case windows
    case unknown

    static func infer(from value: String?) -> TerminalHostPlatform {
        let lowercased = value?.lowercased() ?? ""
        if lowercased.contains("mac")
            || lowercased.contains("macbook")
            || lowercased.contains("mac mini")
            || lowercased.contains("imac")
            || lowercased.contains("darwin") {
            return .mac
        }
        if lowercased.contains("windows") || lowercased.contains("win") {
            return .windows
        }
        if lowercased.contains("linux")
            || lowercased.contains("ubuntu")
            || lowercased.contains("debian") {
            return .linux
        }
        return .unknown
    }
}

struct TerminalScreen: View {
    @Environment(CodexService.self) private var codex
    @Environment(\.colorScheme) private var colorScheme
    @State private var draftProfile = RemodexTerminalProfileStore.load()
    @State private var connectionDraft = RemodexTerminalProfileStore.load().connectionString
    @State private var privateKeyDraft = RemodexTerminalPrivateKeyStore.loadPrivateKey()
    @State private var passphraseDraft = RemodexTerminalPrivateKeyStore.loadPassphrase()
    @State private var isShowingConnectionEditor = false
    @State private var activeTerminalId = CodexService.defaultTerminalId
    @State private var bootstrappedTerminalIds = Set<String>()
    @State private var userClosedTerminalIds = Set<String>()
    @State private var isNativeTerminalAvailable = true
    @State private var actionErrorMessage: String?
    @State private var didApplyPreferredWorkingDirectory = false
    @State private var pendingModifier: TerminalPendingModifier?
    @AppStorage("codex.terminal.fontSize") private var terminalFontSize = remodexTerminalDefaultFontSize

    let preferredWorkingDirectory: String?

    private var theme: RemodexTerminalTheme {
        RemodexTerminalTheme.resolved(for: colorScheme)
    }

    private var hostPlatform: TerminalHostPlatform {
        TerminalHostPlatform.infer(
            from: [
                codex.trustedPairPresentation?.systemName,
                codex.trustedPairPresentation?.name,
                draftProfile.displayTarget,
            ]
            .compactMap { $0 }
            .joined(separator: " ")
        )
    }

    private var profileResolvedFromConnection: RemodexTerminalProfile {
        var profile = draftProfile
        profile.applyConnectionString(connectionDraft)
        return profile.normalizedForSave
    }

    private var hasConnectionConfiguration: Bool {
        let profile = profileResolvedFromConnection
        return !profile.host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !profile.username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && RemodexTerminalPrivateKeyStore.hasPrivateKey(privateKeyDraft)
    }

    private var isRunning: Bool {
        activeSnapshot.status == .running || activeSnapshot.status == .starting
    }

    private var terminalKey: String {
        "\(activeTerminalId):\(profileResolvedFromConnection.connectionString)"
    }

    private var activeSnapshot: RemodexTerminalSnapshot {
        codex.terminalSnapshot(for: activeTerminalId)
    }

    private var currentWorkingDirectory: String {
        firstNonEmpty([
            activeSnapshot.cwd,
            profileResolvedFromConnection.cwd,
            preferredWorkingDirectory,
        ]) ?? ""
    }

    private var terminalHostTitle: String {
        firstNonEmpty([
            profileResolvedFromConnection.nickname,
            codex.trustedPairPresentation?.name,
            profileResolvedFromConnection.displayTarget,
        ]) ?? "Terminal"
    }

    private var navigationTopLine: String {
        let topLine = [
            terminalHostTitle,
            projectDisplayName(for: currentWorkingDirectory),
        ]
        .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .joined(separator: " · ")

        return topLine.isEmpty ? "Terminal" : topLine
    }

    private var navigationBottomLine: String {
        firstNonEmpty([
            currentWorkingDirectory,
            profileResolvedFromConnection.connectionString,
            "SSH terminal",
        ]) ?? "SSH terminal"
    }

    private var statusLabel: String {
        switch activeSnapshot.status {
        case .running:
            return "Running"
        case .starting:
            return "Starting"
        case .error:
            return "Error"
        case .exited:
            return "Exited"
        case .closed:
            return "Closed"
        case .idle:
            return "Idle"
        }
    }

    private var terminalErrorDetail: String? {
        let value = actionErrorMessage ?? activeSnapshot.errorMessage
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private var statusTone: TerminalStatusTone {
        switch activeSnapshot.status {
        case .running:
            return TerminalStatusTone(tint: "#34d399", text: "#a3a3a3")
        case .starting:
            return TerminalStatusTone(tint: "#f59e0b", text: "#a3a3a3")
        case .error:
            return TerminalStatusTone(tint: "#ef4444", text: "#fca5a5")
        case .idle, .closed, .exited:
            return TerminalStatusTone(tint: "#ef4444", text: "#a3a3a3")
        }
    }

    private var terminalToolbarActions: [TerminalToolbarAction] {
        let modifierActions: [TerminalToolbarAction]
        switch hostPlatform {
        case .mac:
            modifierActions = [
                TerminalToolbarAction(kind: .modifier(.meta), key: "cmd", label: "cmd"),
                TerminalToolbarAction(kind: .modifier(.ctrl), key: "ctrl", label: "ctrl"),
            ]
        case .linux, .windows, .unknown:
            modifierActions = [
                TerminalToolbarAction(kind: .modifier(.ctrl), key: "ctrl", label: "ctrl"),
                TerminalToolbarAction(kind: .modifier(.meta), key: "alt", label: "alt"),
            ]
        }

        return [
            TerminalToolbarAction(kind: .send("\u{1B}"), key: "esc", label: "esc"),
        ] + modifierActions + [
            TerminalToolbarAction(kind: .send("\t"), key: "tab", label: "tab"),
            TerminalToolbarAction(kind: .send("\u{1B}[A"), key: "up", label: "↑"),
            TerminalToolbarAction(kind: .send("\u{1B}[B"), key: "down", label: "↓"),
            TerminalToolbarAction(kind: .send("\u{1B}[D"), key: "left", label: "←"),
            TerminalToolbarAction(kind: .send("\u{1B}[C"), key: "right", label: "→"),
            TerminalToolbarAction(kind: .send("~"), key: "tilde", label: "~"),
            TerminalToolbarAction(kind: .send("|"), key: "pipe", label: "|"),
            TerminalToolbarAction(kind: .send("/"), key: "slash", label: "/"),
            TerminalToolbarAction(kind: .send("-"), key: "dash", label: "-"),
        ]
    }

    private var terminalMenuSessions: [TerminalMenuSessionItem] {
        var snapshots = codex.knownTerminalSnapshots()
        if !snapshots.contains(where: { $0.terminalId == activeTerminalId }) {
            snapshots.append(activeSnapshot)
        }

        return snapshots.filter { snapshot in
            snapshot.terminalId == activeTerminalId || snapshot.status.isRunning
        }.map { snapshot in
            TerminalMenuSessionItem(
                terminalId: snapshot.terminalId,
                displayLabel: terminalDisplayLabel(snapshot.terminalId),
                status: snapshot.status,
                cwd: snapshot.cwd
            )
        }
    }

    var body: some View {
        ZStack {
            Color(hexString: theme.background)
                .ignoresSafeArea()

            terminalRouteBody
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color(hexString: theme.background), for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(colorScheme, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                TerminalRouteTitle(
                    topLine: navigationTopLine,
                    bottomLine: navigationBottomLine,
                    theme: theme
                )
            }
            ToolbarItem(placement: .topBarTrailing) {
                terminalOptionsMenu
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if hasConnectionConfiguration {
                TerminalRouteAccessoryBar(
                    actions: terminalToolbarActions,
                    pendingModifier: pendingModifier,
                    theme: theme,
                    isEnabled: activeSnapshot.status == .running,
                    onAction: handleToolbarActionPress
                )
            }
        }
        .sheet(isPresented: $isShowingConnectionEditor) {
            TerminalConnectionEditorSheet(
                profile: $draftProfile,
                connection: $connectionDraft,
                privateKey: $privateKeyDraft,
                passphrase: $passphraseDraft,
                canSave: hasConnectionConfiguration,
                onSave: {
                    Task { @MainActor in
                        await saveConnectionAndOpen()
                    }
                },
                onResetKnownHost: resetKnownHost
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .task(id: activeTerminalId) {
            await bootstrapTerminalRoute()
        }
        .onChange(of: preferredWorkingDirectory) { _, _ in
            didApplyPreferredWorkingDirectory = false
            applyPreferredWorkingDirectoryIfNeeded()
        }
    }

    @ViewBuilder
    private var terminalRouteBody: some View {
        if !hasConnectionConfiguration {
            TerminalRouteUnavailableView(
                title: "Terminal unavailable",
                detail: "SSH connection and key are required before opening a shell.",
                theme: theme,
                action: {
                    isShowingConnectionEditor = true
                }
            )
        } else {
            if isNativeTerminalAvailable {
                GhosttyTerminalSurface(
                    terminalKey: terminalKey,
                    buffer: activeSnapshot.bufferData,
                    fontSize: CGFloat(terminalFontSize),
                    colorScheme: colorScheme,
                    theme: theme,
                    onInput: handleTerminalDataInput,
                    onResize: resizeTerminal,
                    onNativeAvailabilityChanged: { isAvailable in
                        isNativeTerminalAvailable = isAvailable
                    }
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(8)
            } else {
                TerminalFallbackSurface(
                    snapshot: activeSnapshot,
                    fontSize: CGFloat(terminalFontSize),
                    theme: theme,
                    isRunning: isRunning,
                    onInput: handleTerminalTextInput,
                    onResize: resizeTerminal
                )
            }
        }
    }

    private var terminalOptionsMenu: some View {
        Menu {
            Text(statusLabel)
            if let terminalErrorDetail {
                Text(terminalErrorDetail)
            }

            Section("Text size") {
                Button("A- \(String(format: "%.1f", max(remodexTerminalMinFontSize, terminalFontSize - remodexTerminalFontSizeStep))) pt") {
                    adjustFontSize(-remodexTerminalFontSizeStep)
                }
                .disabled(terminalFontSize <= remodexTerminalMinFontSize)

                Button("A+ \(String(format: "%.1f", min(remodexTerminalMaxFontSize, terminalFontSize + remodexTerminalFontSizeStep))) pt") {
                    adjustFontSize(remodexTerminalFontSizeStep)
                }
                .disabled(terminalFontSize >= remodexTerminalMaxFontSize)
            }

            Section {
                ForEach(terminalMenuSessions) { session in
                    Button {
                        activeTerminalId = session.terminalId
                    } label: {
                        Label(session.displayLabel, systemImage: session.terminalId == activeTerminalId ? "checkmark" : "terminal")
                    }
                }

                Button {
                    Task { @MainActor in
                        await openNewTerminal()
                    }
                } label: {
                    Label("Open new terminal", systemImage: "plus")
                }
            }

            Section {
                Button(isRunning ? "Disconnect" : "Connect", systemImage: isRunning ? "xmark" : "terminal") {
                    Task { @MainActor in
                        if isRunning {
                            await closeTerminal()
                        } else {
                            userClosedTerminalIds.remove(activeTerminalId)
                            await openTerminal()
                        }
                    }
                }
                .disabled(!hasConnectionConfiguration && !isRunning)

                Button("SSH connection", systemImage: "lock.shield") {
                    isShowingConnectionEditor = true
                }

                Button("Clear", systemImage: "trash") {
                    clearTerminal()
                }
                .disabled(activeSnapshot.bufferData.isEmpty)

                Button("Reset host key", systemImage: "key") {
                    resetKnownHost()
                }
                .disabled(profileResolvedFromConnection.host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "circle.fill")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(Color(hexString: statusTone.tint))
                Text(statusLabel)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color(hexString: statusTone.text))
            }
        }
        .accessibilityLabel("Terminal options")
    }

    private func bootstrapTerminalRoute() async {
        if restoreRunningTerminalIfNeeded() {
            return
        }
        applyPreferredWorkingDirectoryIfNeeded()
        connectionDraft = draftProfile.connectionString
        try? await codex.refreshTerminalSnapshot()

        guard hasConnectionConfiguration else {
            isShowingConnectionEditor = true
            return
        }
        guard !bootstrappedTerminalIds.contains(activeTerminalId),
              !userClosedTerminalIds.contains(activeTerminalId) else { return }
        guard !isRunning else {
            bootstrappedTerminalIds.insert(activeTerminalId)
            return
        }

        bootstrappedTerminalIds.insert(activeTerminalId)
        await openTerminal()
    }

    private func restoreRunningTerminalIfNeeded() -> Bool {
        guard activeTerminalId == CodexService.defaultTerminalId else { return false }
        let runningSnapshots = codex.knownTerminalSnapshots().filter { $0.status.isRunning }
        guard let preferredSnapshot = runningSnapshots.first(where: { $0.terminalId == CodexService.defaultTerminalId })
            ?? runningSnapshots.first else {
            return false
        }
        guard preferredSnapshot.terminalId != activeTerminalId else {
            return false
        }
        activeTerminalId = preferredSnapshot.terminalId
        return true
    }

    private func saveConnectionAndOpen() async {
        isShowingConnectionEditor = false
        userClosedTerminalIds.remove(activeTerminalId)
        bootstrappedTerminalIds.insert(activeTerminalId)
        await openTerminal()
    }

    private func openNewTerminal() async {
        let nextTerminalId = nextOpenTerminalId()
        draftProfile.applyPreferredWorkingDirectoryOverride(currentWorkingDirectory)
        activeTerminalId = nextTerminalId
        userClosedTerminalIds.remove(nextTerminalId)
        bootstrappedTerminalIds.insert(nextTerminalId)
        actionErrorMessage = nil
        await openTerminal()
    }

    private func openTerminal() async {
        draftProfile = profileResolvedFromConnection
        let selectedCWD = activeSnapshot.cwd.trimmingCharacters(in: .whitespacesAndNewlines)
        if !selectedCWD.isEmpty {
            draftProfile.cwd = selectedCWD
        }
        guard hasConnectionConfiguration else {
            isShowingConnectionEditor = true
            return
        }

        actionErrorMessage = nil
        RemodexTerminalProfileStore.save(draftProfile)
        RemodexTerminalPrivateKeyStore.savePrivateKey(privateKeyDraft)
        RemodexTerminalPrivateKeyStore.savePassphrase(passphraseDraft)

        do {
            try await codex.openTerminal(
                terminalId: activeTerminalId,
                profile: draftProfile,
                cols: activeSnapshot.cols,
                rows: activeSnapshot.rows
            )
        } catch {
            actionErrorMessage = terminalErrorText(error)
        }
    }

    private func closeTerminal() async {
        userClosedTerminalIds.insert(activeTerminalId)
        actionErrorMessage = nil
        do {
            try await codex.closeTerminal(terminalId: activeTerminalId)
        } catch {
            actionErrorMessage = terminalErrorText(error)
        }
    }

    private func resetKnownHost() {
        let profile = profileResolvedFromConnection.normalizedForSave
        guard !profile.host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }
        RemodexSSHKnownHostStore.delete(host: profile.host, port: profile.port)
        actionErrorMessage = nil
    }

    private func clearTerminal() {
        actionErrorMessage = nil
        Task { @MainActor in
            do {
                try await codex.clearTerminalBuffer(terminalId: activeTerminalId)
            } catch {
                actionErrorMessage = terminalErrorText(error)
            }
        }
    }

    private func applyPreferredWorkingDirectoryIfNeeded() {
        guard !didApplyPreferredWorkingDirectory else { return }
        didApplyPreferredWorkingDirectory = true
        draftProfile.applyPreferredWorkingDirectoryOverride(preferredWorkingDirectory)
        let trimmedCWD = draftProfile.cwd.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedCWD.isEmpty,
              activeSnapshot.status == .running,
              activeSnapshot.cwd != trimmedCWD else {
            return
        }
        Task { @MainActor in
            do {
                try await codex.changeTerminalWorkingDirectory(trimmedCWD, terminalId: activeTerminalId)
            } catch {
                actionErrorMessage = terminalErrorText(error)
            }
        }
    }

    private func handleTerminalDataInput(_ data: Data) {
        guard !data.isEmpty else { return }
        guard let text = String(data: data, encoding: .utf8) else {
            writeInput(data)
            return
        }
        handleTerminalTextInput(text)
    }

    private func handleTerminalTextInput(_ text: String) {
        guard !text.isEmpty else { return }

        let outputText: String
        switch pendingModifier {
        case .ctrl:
            pendingModifier = nil
            outputText = Self.applyCtrlModifier(text)
        case .meta:
            pendingModifier = nil
            outputText = "\u{1B}\(text)"
        case nil:
            outputText = text
        }

        writeInput(Data(outputText.utf8))
    }

    private func handleToolbarActionPress(_ action: TerminalToolbarAction) {
        switch action.kind {
        case .modifier(let modifier):
            pendingModifier = pendingModifier == modifier ? nil : modifier
        case .send(let data):
            handleTerminalTextInput(data)
        }
    }

    private func writeInput(_ data: Data) {
        guard activeSnapshot.status == .running else { return }
        Task { @MainActor in
            try? await codex.writeTerminalInput(data, terminalId: activeTerminalId)
        }
    }

    private func resizeTerminal(cols: Int, rows: Int) {
        Task { @MainActor in
            try? await codex.resizeTerminal(terminalId: activeTerminalId, cols: cols, rows: rows)
        }
    }

    private func adjustFontSize(_ delta: Double) {
        terminalFontSize = min(
            remodexTerminalMaxFontSize,
            max(remodexTerminalMinFontSize, terminalFontSize + delta)
        )
    }

    private func terminalErrorText(_ error: Error) -> String {
        if case CodexServiceError.rpcError(let rpcError) = error {
            return rpcError.message
        }
        if let localizedError = error as? LocalizedError,
           let description = localizedError.errorDescription {
            return description
        }
        return error.localizedDescription
    }

    private func firstNonEmpty(_ values: [String?]) -> String? {
        for value in values {
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !trimmed.isEmpty {
                return trimmed
            }
        }
        return nil
    }

    private func projectDisplayName(for path: String) -> String? {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return URL(fileURLWithPath: trimmed).lastPathComponent
    }

    private func terminalDisplayLabel(_ terminalId: String) -> String {
        let index = terminalIndex(terminalId)
        guard index > 1 else { return "Terminal" }
        return "Terminal \(index)"
    }

    private func nextOpenTerminalId() -> String {
        let existingIndexes = terminalMenuSessions.map { terminalIndex($0.terminalId) }
        let nextIndex = (existingIndexes.max() ?? 0) + 1
        return "term-\(max(1, nextIndex))"
    }

    private func terminalIndex(_ terminalId: String) -> Int {
        guard terminalId.hasPrefix("term-"),
              let value = Int(terminalId.dropFirst(5)) else {
            return 1
        }
        return value
    }

    private static func applyCtrlModifier(_ input: String) -> String {
        guard let firstCharacter = input.first else {
            return input
        }

        let lowerCharacter = Character(firstCharacter.lowercased())
        if let scalar = lowerCharacter.unicodeScalars.first,
           lowerCharacter >= "a",
           lowerCharacter <= "z" {
            return String(UnicodeScalar(scalar.value - 96) ?? scalar)
        }

        switch firstCharacter {
        case "@": return "\u{0}"
        case "[": return "\u{1B}"
        case "\\": return "\u{1C}"
        case "]": return "\u{1D}"
        case "^": return "\u{1E}"
        case "_": return "\u{1F}"
        case "?": return "\u{7F}"
        default: return input
        }
    }
}

// MARK: - t3code-style route chrome

private struct TerminalRouteTitle: View {
    let topLine: String
    let bottomLine: String
    let theme: RemodexTerminalTheme

    var body: some View {
        VStack(spacing: 1) {
            Text(topLine)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color(hexString: theme.foreground))
                .lineLimit(1)

            Text(bottomLine)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(Color(hexString: theme.mutedForeground))
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .frame(maxWidth: 240)
    }
}

private struct TerminalRouteAccessoryBar: View {
    let actions: [TerminalToolbarAction]
    let pendingModifier: TerminalPendingModifier?
    let theme: RemodexTerminalTheme
    let isEnabled: Bool
    let onAction: (TerminalToolbarAction) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(actions) { action in
                    TerminalRouteKeyButton(
                        action: action,
                        isActive: action.modifier == pendingModifier,
                        theme: theme,
                        isEnabled: isEnabled,
                        onAction: onAction
                    )
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .frame(minHeight: remodexTerminalAccessoryHeight)
        }
        .background(Color(hexString: theme.background))
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color(hexString: theme.border))
                .frame(height: 1)
        }
    }
}

private struct TerminalRouteKeyButton: View {
    let action: TerminalToolbarAction
    let isActive: Bool
    let theme: RemodexTerminalTheme
    let isEnabled: Bool
    let onAction: (TerminalToolbarAction) -> Void

    var body: some View {
        Button {
            onAction(action)
        } label: {
            Text(action.label)
                .font(.system(size: 12, weight: .bold))
                .textCase(action.isModifier ? .uppercase : nil)
                .foregroundStyle(textColor)
                .frame(minWidth: action.label.count > 1 ? 46 : 38)
                .padding(.horizontal, 11)
                .padding(.vertical, 8)
                .background(backgroundColor, in: RoundedRectangle(cornerRadius: 12))
                .overlay {
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(borderColor, lineWidth: 1)
                }
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.35)
        .accessibilityLabel(action.label)
    }

    private var activeAccent: Color {
        Color(hexString: theme.palette[safe: 10] ?? theme.foreground)
    }

    private var textColor: Color {
        isActive ? activeAccent : Color(hexString: theme.foreground)
    }

    private var backgroundColor: Color {
        isActive ? activeAccent.opacity(0.18) : Color(hexString: theme.foreground).opacity(0.07)
    }

    private var borderColor: Color {
        isActive ? activeAccent.opacity(0.32) : Color(hexString: theme.border)
    }
}

private struct TerminalRouteUnavailableView: View {
    let title: String
    let detail: String
    let theme: RemodexTerminalTheme
    let action: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "terminal")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(Color(hexString: theme.foreground))

            Text(title)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Color(hexString: theme.foreground))

            Text(detail)
                .font(.system(size: 12))
                .foregroundStyle(Color(hexString: theme.mutedForeground))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)

            Button("SSH connection", action: action)
                .font(.system(size: 12, weight: .bold))
                .buttonStyle(.borderedProminent)
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(hexString: theme.background))
    }
}

private struct TerminalFallbackSurface: View {
    let snapshot: RemodexTerminalSnapshot
    let fontSize: CGFloat
    let theme: RemodexTerminalTheme
    let isRunning: Bool
    let onInput: (String) -> Void
    let onResize: (Int, Int) -> Void
    @State private var input = ""

    private var statusLabel: String {
        isRunning ? "Native terminal unavailable. Using text fallback." : "Open terminal to start a shell."
    }

    private var renderedBuffer: String {
        let text = String(decoding: snapshot.bufferData, as: UTF8.self)
        return text.isEmpty ? "$ " : text
    }

    var body: some View {
        GeometryReader { proxy in
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(statusLabel)
                        .font(.system(size: 11))
                        .foregroundStyle(Color(hexString: theme.mutedForeground))

                    ScrollView(.vertical, showsIndicators: false) {
                        Text(renderedBuffer)
                            .font(.system(size: fontSize, design: .monospaced))
                            .foregroundStyle(Color(hexString: theme.foreground))
                            .lineSpacing(max(0, round(fontSize * 0.35) - 1))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                            .padding(.bottom, 12)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

                HStack(spacing: 8) {
                    TextField("type and press return", text: $input)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(Color(hexString: theme.foreground))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(!isRunning)
                        .onSubmit(sendInput)

                    Button("Ctrl-C") {
                        onInput("\u{3}")
                    }
                    .font(.system(size: 11, weight: .bold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color(hexString: theme.border), in: RoundedRectangle(cornerRadius: 8))
                    .foregroundStyle(Color(hexString: theme.foreground))
                    .disabled(!isRunning)
                    .opacity(isRunning ? 1 : 0.35)
                }
                .padding(8)
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(Color(hexString: theme.border))
                        .frame(height: 1)
                }
            }
            .background(Color(hexString: theme.background))
            .onAppear {
                emitResize(for: proxy.size)
            }
            .onChange(of: proxy.size) { _, size in
                emitResize(for: size)
            }
        }
    }

    private func sendInput() {
        guard !input.isEmpty else { return }
        onInput("\(input)\n")
        input = ""
    }

    private func emitResize(for size: CGSize) {
        let cellWidth = max(fontSize * 0.62, 1)
        let cellHeight = max(fontSize * 1.35, 1)
        onResize(
            max(20, min(400, Int(size.width / cellWidth))),
            max(5, min(200, Int(size.height / cellHeight)))
        )
    }
}

private struct TerminalStatusTone {
    let tint: String
    let text: String
}

private struct TerminalMenuSessionItem: Identifiable {
    let terminalId: String
    let displayLabel: String
    let status: RemodexTerminalStatus
    let cwd: String

    var id: String { terminalId }
}

private enum TerminalToolbarActionKind {
    case send(String)
    case modifier(TerminalPendingModifier)
}

private struct TerminalToolbarAction: Identifiable {
    let kind: TerminalToolbarActionKind
    let key: String
    let label: String

    var id: String { key }

    var modifier: TerminalPendingModifier? {
        if case .modifier(let modifier) = kind {
            return modifier
        }
        return nil
    }

    var isModifier: Bool {
        modifier != nil
    }
}

// MARK: - SSH connection sheet

private struct TerminalConnectionEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var profile: RemodexTerminalProfile
    @Binding var connection: String
    @Binding var privateKey: String
    @Binding var passphrase: String

    let canSave: Bool
    let onSave: () -> Void
    let onResetKnownHost: () -> Void
    @State private var isShowingAdvanced = false
    @State private var isShowingKeyEditor = false
    @State private var isConfirmingKnownHostReset = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    TerminalEditorSection(title: "Connection") {
                        TerminalConnectionStringField(connection: $connection)
                    }

                    TerminalEditorSection(title: "Nickname") {
                        TerminalRoundedTextField(
                            placeholder: "Nickname",
                            text: $profile.nickname
                        )
                    }

                    TerminalEditorSection(title: "Authentication") {
                        VStack(spacing: 0) {
                            TerminalEditorRow(title: "Method", value: "SSH Key")
                            Divider()
                            Button {
                                withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
                                    isShowingKeyEditor.toggle()
                                }
                            } label: {
                                TerminalEditorRow(
                                    title: "SSH Key",
                                    value: keyLabel,
                                    showsChevron: true
                                )
                            }
                            .buttonStyle(.plain)

                            if isShowingKeyEditor || !RemodexTerminalPrivateKeyStore.hasPrivateKey(privateKey) {
                                TerminalPrivateKeyEditor(privateKey: $privateKey, passphrase: $passphrase)
                                    .padding(.top, 14)
                            }
                        }
                        .padding(16)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
                    }

                    TerminalEditorSection(title: "SSH") {
                        VStack(spacing: 0) {
                            Button {
                                withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
                                    isShowingAdvanced.toggle()
                                }
                            } label: {
                                TerminalEditorRow(
                                    title: "Advanced Configuration",
                                    value: advancedLabel,
                                    showsChevron: true
                                )
                            }
                            .buttonStyle(.plain)

                            if isAdvancedVisible {
                                Divider()
                                HStack(spacing: 12) {
                                    TerminalTextField(
                                        title: "Port",
                                        text: portBinding,
                                        placeholder: "22",
                                        keyboardType: .numberPad
                                    )
                                    TerminalTextField(
                                        title: "Working directory",
                                        text: $profile.cwd,
                                        placeholder: "/Users/name"
                                    )
                                }
                                .padding(.top, 14)
                            }

                            Divider()
                            Button {
                                isConfirmingKnownHostReset = true
                            } label: {
                                TerminalEditorRow(
                                    title: "Known Host",
                                    value: "Reset"
                                )
                            }
                            .buttonStyle(.plain)
                            .disabled(profile.host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                        .padding(16)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 22)
            }
            .navigationTitle("New Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Connect") {
                        onSave()
                    }
                    .font(.system(size: 15, weight: .bold))
                    .disabled(!canSave)
                }
            }
            .confirmationDialog(
                "Reset saved SSH host key?",
                isPresented: $isConfirmingKnownHostReset,
                titleVisibility: .visible
            ) {
                Button("Reset Host Key", role: .destructive, action: onResetKnownHost)
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The next connection to this host will trust the key it presents.")
            }
        }
    }

    private var keyLabel: String {
        RemodexTerminalPrivateKeyStore.hasPrivateKey(privateKey) ? "Imported" : "Import"
    }

    private var advancedLabel: String {
        profile.port == 22 && profile.cwd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Default"
            : "Custom"
    }

    private var isAdvancedVisible: Bool {
        isShowingAdvanced
            || profile.port != 22
            || !profile.cwd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var portBinding: Binding<String> {
        Binding(
            get: { String(profile.port) },
            set: { value in
                if let parsedPort = Int(value) {
                    profile.port = max(1, min(65535, parsedPort))
                }
            }
        )
    }
}

private struct TerminalEditorSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.primary)
            content
        }
    }
}

private struct TerminalConnectionStringField: View {
    @Binding var connection: String

    var body: some View {
        HStack(spacing: 14) {
            HStack(spacing: 4) {
                Text("ssh")
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 13, weight: .semibold))
            }
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(.secondary)

            TextField("user@hostname", text: $connection)
                .font(.system(size: 15, weight: .medium))
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        }
        .padding(.horizontal, 22)
        .frame(height: 64)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 24))
    }
}

private struct TerminalRoundedTextField: View {
    let placeholder: String
    @Binding var text: String

    var body: some View {
        TextField(placeholder, text: $text)
            .font(.system(size: 15, weight: .medium))
            .textInputAutocapitalization(.words)
            .autocorrectionDisabled()
            .padding(.horizontal, 22)
            .frame(height: 64)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 24))
    }
}

private struct TerminalEditorRow: View {
    let title: String
    let value: String
    var showsChevron = false

    var body: some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.system(size: 15))
                .foregroundStyle(.primary)
            Spacer(minLength: 8)
            Text(value)
                .font(.system(size: 15))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(minHeight: 46)
    }
}

private struct TerminalPrivateKeyEditor: View {
    @Binding var privateKey: String
    @Binding var passphrase: String
    @State private var isShowingKey = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Private key")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Button(isShowingKey ? "Hide" : "Paste/Edit") {
                    withAnimation(.spring(response: 0.25, dampingFraction: 0.9)) {
                        isShowingKey.toggle()
                    }
                }
                .font(.system(size: 11, weight: .semibold))
                .buttonStyle(.plain)
            }

            if isShowingKey || !RemodexTerminalPrivateKeyStore.hasPrivateKey(privateKey) {
                TextEditor(text: $privateKey)
                    .font(.system(size: 11, design: .monospaced))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .frame(minHeight: 124)
                    .padding(8)
                    .scrollContentBackground(.hidden)
                    .background(Color(.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
            } else {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(.green)
                    Text("Private key saved")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10)
                .frame(height: 36)
                .background(Color(.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
            }

            SecureField("Passphrase (optional)", text: $passphrase)
                .font(.system(size: 11, design: .monospaced))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 10)
                .frame(height: 36)
                .background(Color(.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
        }
    }
}

private struct TerminalTextField: View {
    let title: String
    @Binding var text: String
    var placeholder: String = ""
    var keyboardType: UIKeyboardType = .default

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
            TextField(placeholder.isEmpty ? title : placeholder, text: $text)
                .font(.system(size: 11, design: .monospaced))
                .keyboardType(keyboardType)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 10)
                .frame(height: 36)
                .background(Color(.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

private extension Color {
    init(hexString: String) {
        let sanitized = hexString.replacingOccurrences(of: "#", with: "")
        let value = Int(sanitized, radix: 16) ?? 0
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
