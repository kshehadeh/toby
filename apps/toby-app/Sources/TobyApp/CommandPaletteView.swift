import SwiftUI

struct CommandPaletteView: View {
	let sessions: [SessionSummary]
	let onSelectSession: (String) -> Void
	let onNewChat: () -> Void
	let onOpenSettings: () -> Void
	let onDismiss: () -> Void

	@State private var query = ""
	@FocusState private var isSearchFocused: Bool
	@State private var selectedIndex = 0

	private var results: [CommandPaletteResult] {
		let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
		var items: [CommandPaletteResult] = []

		if trimmed.isEmpty || "new chat".localizedCaseInsensitiveContains(trimmed) {
			items.append(
				CommandPaletteResult(
					id: "action-new-chat",
					title: "New chat",
					subtitle: "Start a fresh session",
					systemImage: "square.and.pencil",
					kind: .action,
				),
			)
		}
		if trimmed.isEmpty || "settings".localizedCaseInsensitiveContains(trimmed)
			|| "configure".localizedCaseInsensitiveContains(trimmed)
		{
			items.append(
				CommandPaletteResult(
					id: "action-settings",
					title: "Open settings",
					subtitle: "Configure Toby",
					systemImage: "gearshape",
					kind: .action,
				),
			)
		}

		let filteredSessions = sessions.filter { session in
			guard !trimmed.isEmpty else { return true }
			if session.name.localizedCaseInsensitiveContains(trimmed) { return true }
			if session.id.localizedCaseInsensitiveContains(trimmed) { return true }
			if let updatedAt = session.updatedAt, updatedAt.localizedCaseInsensitiveContains(trimmed) {
				return true
			}
			return false
		}

		for session in filteredSessions {
			items.append(
				CommandPaletteResult(
					id: "session-\(session.id)",
					title: session.name,
					subtitle: sessionSubtitle(session),
					systemImage: "message",
					kind: .session(session.id),
				),
			)
		}
		return items
	}

	var body: some View {
		VStack(spacing: 0) {
			HStack(spacing: 10) {
				Image(systemName: "magnifyingglass")
					.foregroundStyle(AppTheme.secondaryText)
				TextField("Search sessions…", text: $query)
					.textFieldStyle(.plain)
					.font(.body)
					.foregroundStyle(AppTheme.primaryText)
					.focused($isSearchFocused)
					.onSubmit { activateSelection() }
					.onChange(of: query) {
						selectedIndex = 0
					}
				if !query.isEmpty {
					Button("Clear") { query = "" }
						.buttonStyle(.plain)
						.foregroundStyle(AppTheme.secondaryText)
				}
			}
			.padding(.horizontal, 16)
			.padding(.vertical, 14)
			.background(AppTheme.panelBackground)

			Divider().overlay(AppTheme.separator)

			if results.isEmpty {
				Text("No matching sessions")
					.font(.callout)
					.foregroundStyle(AppTheme.secondaryText)
					.frame(maxWidth: .infinity, alignment: .leading)
					.padding(16)
			} else {
				ScrollViewReader { proxy in
					ScrollView {
						LazyVStack(spacing: 2) {
							ForEach(Array(results.enumerated()), id: \.element.id) { index, result in
								Button {
									selectedIndex = index
									activate(result)
								} label: {
									CommandPaletteRow(
										result: result,
										isSelected: index == selectedIndex,
									)
								}
								.buttonStyle(.plain)
								.id(result.id)
							}
						}
						.padding(8)
					}
					.onChange(of: selectedIndex) {
						if selectedIndex < results.count {
							withAnimation {
								proxy.scrollTo(results[selectedIndex].id, anchor: .center)
							}
						}
					}
				}
			}
		}
		.frame(width: 560, height: 420)
		.background(AppTheme.contentBackground)
		.clipShape(RoundedRectangle(cornerRadius: AppTheme.cornerRadius))
		.overlay {
			RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
				.stroke(AppTheme.separator, lineWidth: 1)
		}
		.onAppear {
			isSearchFocused = true
			selectedIndex = 0
		}
		.onExitCommand(perform: onDismiss)
		.background {
			Button("") {
				moveSelection(by: -1)
			}
			.keyboardShortcut(.upArrow, modifiers: [])
			.hidden()
			Button("") {
				moveSelection(by: 1)
			}
			.keyboardShortcut(.downArrow, modifiers: [])
			.hidden()
			Button("") {
				activateSelection()
			}
			.keyboardShortcut(.return, modifiers: [])
			.hidden()
		}
	}

	private func moveSelection(by delta: Int) {
		guard !results.isEmpty else { return }
		selectedIndex = min(max(selectedIndex + delta, 0), results.count - 1)
	}

	private func activateSelection() {
		guard selectedIndex < results.count else { return }
		activate(results[selectedIndex])
	}

	private func activate(_ result: CommandPaletteResult) {
		switch result.kind {
		case .action where result.id == "action-new-chat":
			onDismiss()
			onNewChat()
		case .action where result.id == "action-settings":
			onDismiss()
			onOpenSettings()
		case .session(let id):
			onDismiss()
			onSelectSession(id)
		default:
			break
		}
	}

	private func sessionSubtitle(_ session: SessionSummary) -> String {
		if let updatedAt = session.updatedAt, !updatedAt.isEmpty {
			return updatedAt
		}
		return session.id
	}
}

private struct CommandPaletteResult: Identifiable {
	enum Kind {
		case action
		case session(String)
	}

	let id: String
	let title: String
	let subtitle: String
	let systemImage: String
	let kind: Kind
}

private struct CommandPaletteRow: View {
	let result: CommandPaletteResult
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: result.systemImage)
				.foregroundStyle(AppTheme.secondaryText)
				.frame(width: 18)
			VStack(alignment: .leading, spacing: 2) {
				Text(result.title)
					.font(.callout)
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
				Text(result.subtitle)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
			Spacer()
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 8)
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(isSelected ? AppTheme.selection : Color.clear)
		)
	}
}
