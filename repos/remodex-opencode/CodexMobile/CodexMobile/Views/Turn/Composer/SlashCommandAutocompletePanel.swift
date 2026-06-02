// FILE: SlashCommandAutocompletePanel.swift
// Purpose: Inline slash-command picker for composer actions like Code Review and Fork.
// Layer: View Component
// Exports: SlashCommandAutocompletePanel
// Depends on: SwiftUI, AutocompleteRowButtonStyle, TurnViewModel

import SwiftUI

struct SlashCommandAutocompletePanel: View {
    let state: TurnComposerSlashCommandPanelState
    let availableCommands: [TurnComposerSlashCommandItem]
    let supportsSlashCommands: Bool
    let usesBridgeSlashCommands: Bool
    let isLoadingBridgeSlashCommands: Bool
    let showsBridgeSlashCommandsEmptyHint: Bool
    let supportsThreadFork: Bool
    let hasComposerContentConflictingWithReview: Bool
    let isThreadRunning: Bool
    let showsGitBranchSelector: Bool
    let isLoadingGitBranchTargets: Bool
    let availableGitBranchTargets: [String]
    let selectedGitBaseBranch: String
    let gitDefaultBranch: String
    let onSelectCommand: (TurnComposerSlashCommandItem) -> Void
    let onSelectReviewTarget: (TurnComposerReviewTarget) -> Void
    let onSelectForkDestination: (TurnComposerForkDestination) -> Void
    let onClose: () -> Void

    private static let rowHeight: CGFloat = 50
    private static let maxVisibleRows = 6

    private static func visibleListHeight(for count: Int) -> CGFloat {
        rowHeight * CGFloat(min(count, maxVisibleRows))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch state {
            case .hidden:
                EmptyView()

            case .commands(let query):
                commandList(query: query)

            case .codeReviewTargets:
                reviewTargetList

            case .forkDestinations(let destinations):
                forkDestinationList(destinations: destinations)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .padding(4)
        .adaptiveGlass(.regular, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .padding(.horizontal, 4)
    }

    @ViewBuilder
    private func commandList(query: String) -> some View {
        let items = TurnComposerSlashCommandItem.filtered(matching: query, within: availableCommands)

        VStack(alignment: .leading, spacing: 0) {
            if !supportsSlashCommands {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(AppFont.caption2())
                        .foregroundStyle(.secondary)
                    Text("Slash commands not supported by this runtime")
                        .font(AppFont.caption())
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }

            if isLoadingBridgeSlashCommands {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Loading commands…")
                        .font(AppFont.caption())
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            } else if items.isEmpty {
                if showsBridgeSlashCommandsEmptyHint, query.isEmpty {
                    Text("No commands for this project")
                        .font(AppFont.footnote())
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                } else {
                    Text("No commands for /\(query)")
                        .font(AppFont.footnote())
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                }
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(items) { item in
                            let isEnabled = isCommandEnabled(item) && supportsSlashCommands
                            let disabledReason: String? = !supportsSlashCommands
                                ? ComposerCapabilityCopy.capabilityReason(for: .slashCommands)
                                : (!isCommandEnabled(item) ? commandSubtitle(for: item) : nil)
                            Button {
                                HapticFeedback.shared.triggerImpactFeedback(style: .light)
                                onSelectCommand(item)
                            } label: {
                                HStack(spacing: 10) {
                                    commandIcon(for: item, isEnabled: isEnabled)

                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(item.commandToken)
                                            .font(AppFont.subheadline(weight: .semibold))
                                            .foregroundStyle(commandPrimaryStyle(isEnabled: isEnabled))
                                            .lineLimit(1)

                                        Text(commandSubtitle(for: item))
                                            .font(AppFont.caption2())
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }

                                    Spacer(minLength: 8)

                                    Text(item.title)
                                        .font(AppFont.footnote())
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .frame(height: Self.rowHeight)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(AutocompleteRowButtonStyle())
                            .capabilityGreyOut(isEnabled: isEnabled, reason: disabledReason)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .scrollIndicators(.visible)
                .frame(height: Self.visibleListHeight(for: items.count))
            }
        }
    }

    private var reviewTargetList: some View {
        VStack(alignment: .leading, spacing: 0) {
            submenuHeader(
                title: "Code Review",
                subtitle: "Choose what the reviewer should compare.",
                closeAccessibilityLabel: "Close code review options"
            )

            VStack(alignment: .leading, spacing: 0) {
                reviewTargetButton(
                    target: .uncommittedChanges,
                    subtitle: "Review everything currently modified in the repo",
                    isEnabled: true
                )

                if showsGitBranchSelector {
                    reviewTargetButton(
                        target: .baseBranch,
                        subtitle: baseBranchSubtitle,
                        isEnabled: isBaseBranchTargetAvailable
                    )
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func forkDestinationList(destinations: [TurnComposerForkDestination]) -> some View {
        return VStack(alignment: .leading, spacing: 0) {
            submenuHeader(
                title: "Fork",
                subtitle: forkDestinationSubtitle(for: destinations),
                closeAccessibilityLabel: "Close fork options"
            )

            VStack(alignment: .leading, spacing: 0) {
                ForEach(destinations) { destination in
                    forkDestinationButton(destination)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func forkDestinationSubtitle(for destinations: [TurnComposerForkDestination]) -> String {
        let showsLocal = destinations.contains(.local)
        let showsNewWorktree = destinations.contains(.newWorktree)

        switch (showsLocal, showsNewWorktree) {
        case (true, true):
            return "Fork this thread into local or a new worktree."
        case (true, false):
            return "Fork this thread into a new local thread."
        case (false, true):
            return "Fork this thread into a new worktree."
        default:
            return "Fork this thread."
        }
    }

    private func reviewTargetButton(
        target: TurnComposerReviewTarget,
        subtitle: String,
        isEnabled: Bool
    ) -> some View {
        Button {
            HapticFeedback.shared.triggerImpactFeedback(style: .light)
            onSelectReviewTarget(target)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(target.title)
                    .font(AppFont.subheadline(weight: .semibold))
                    .foregroundStyle(isEnabled ? .primary : .secondary)
                    .lineLimit(1)

                Text(subtitle)
                    .font(AppFont.caption2())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: Self.rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(AutocompleteRowButtonStyle())
        .disabled(!isEnabled)
    }

    private func forkDestinationButton(_ destination: TurnComposerForkDestination) -> some View {
        Button {
            HapticFeedback.shared.triggerImpactFeedback(style: .light)
            onSelectForkDestination(destination)
        } label: {
            HStack(spacing: 10) {
                forkDestinationIcon(for: destination)

                VStack(alignment: .leading, spacing: 4) {
                    Text(destination.title)
                        .font(AppFont.subheadline(weight: .semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    Text(destination.subtitle)
                        .font(AppFont.caption2())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: Self.rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(AutocompleteRowButtonStyle())
    }

    @ViewBuilder
    private func commandIcon(for command: TurnComposerSlashCommandItem, isEnabled: Bool) -> some View {
        switch command {
        case .codex(let codexCommand):
            if codexCommand == .fork {
                RemodexIcon.image(systemName: "remodex.git-branch", size: 16)
                    .foregroundStyle(commandPrimaryStyle(isEnabled: isEnabled))
                    .frame(width: 22)
            } else {
                RemodexIcon.image(systemName: codexCommand.symbolName)
                    .font(AppFont.system(size: 15, weight: .semibold))
                    .foregroundStyle(commandPrimaryStyle(isEnabled: isEnabled))
                    .frame(width: 22)
            }
        case .bridge:
            RemodexIcon.image(systemName: "terminal")
                .font(AppFont.system(size: 15, weight: .semibold))
                .foregroundStyle(commandPrimaryStyle(isEnabled: isEnabled))
                .frame(width: 22)
        }
    }

    private func commandPrimaryStyle(isEnabled: Bool) -> Color {
        isEnabled ? .primary : .secondary
    }

    @ViewBuilder
    private func forkDestinationIcon(for destination: TurnComposerForkDestination) -> some View {
        switch destination {
        case .local:
            RemodexIcon.image(systemName: destination.symbolName)
                .font(AppFont.system(size: 15, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(width: 22)
        case .newWorktree:
            RemodexIcon.image(systemName: "remodex.git-branch", size: 16)
                .foregroundStyle(.primary)
                .frame(width: 22)
        }
    }

    private var resolvedBaseBranchName: String? {
        let trimmedSelected = selectedGitBaseBranch.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedSelected.isEmpty {
            return trimmedSelected
        }

        return remodexSelectableDefaultBranch(
            defaultBranch: gitDefaultBranch,
            availableGitBranchTargets: availableGitBranchTargets
        )
    }

    private var isBaseBranchTargetAvailable: Bool {
        resolvedBaseBranchName != nil
    }

    private var baseBranchSubtitle: String {
        if let resolvedBaseBranchName {
            return "Diff against \(resolvedBaseBranchName)"
        }

        if isLoadingGitBranchTargets {
            return "Loading base branches..."
        }

        return "Pick a base branch first"
    }

    private func isCommandEnabled(_ command: TurnComposerSlashCommandItem) -> Bool {
        switch command {
        case .bridge:
            return true
        case .codex(let codexCommand):
            switch codexCommand {
            case .codeReview:
                return !hasComposerContentConflictingWithReview
            case .compact:
                return !isThreadRunning
            case .feedback:
                return true
            case .fork:
                return supportsThreadFork && !isThreadRunning
            case .status:
                return true
            case .subagents:
                return true
            }
        }
    }

    private func commandSubtitle(for command: TurnComposerSlashCommandItem) -> String {
        switch command {
        case .bridge(let bridgeCommand):
            return bridgeCommand.description
        case .codex(let codexCommand):
            if codexCommand == .fork, !supportsThreadFork {
                return "Fork not supported by this runtime"
            }

            if (codexCommand == .compact || codexCommand == .fork), isThreadRunning {
                return "Wait for the current response to finish first"
            }

            guard isCommandEnabled(command) else {
                return "Clear draft text, files, skills, and images first"
            }

            return codexCommand.subtitle
        }
    }

    private func submenuHeader(
        title: String,
        subtitle: String,
        closeAccessibilityLabel: String
    ) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(AppFont.subheadline(weight: .semibold))
                    .foregroundStyle(.primary)

                Text(subtitle)
                    .font(AppFont.caption())
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            Button(action: onClose) {
                RemodexIcon.image(systemName: "xmark")
                    .font(AppFont.system(size: 11, weight: .bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 28)
                    .background(Color(.secondarySystemFill), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(closeAccessibilityLabel)
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 6)
    }
}
