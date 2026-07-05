import SwiftUI

struct CommandPaletteView: View {
	let sessions: [SessionSummary]
	let integrations: [SettingsItem]
	let schedules: [ScheduleViewModel]
	let recordings: [ListenRecordingSummary]
	let onSelectSession: (String) -> Void
	let onNewChat: () -> Void
	let onOpenSettings: () -> Void
	let onNavigateToRoute: (DetailRoute) -> Void
	let onOpenIntegration: (String) -> Void
	let onOpenSchedule: (String) -> Void
	let onOpenRecording: (String) -> Void
	let onRestartServer: () -> Void
	let onDismiss: () -> Void

	@State private var query = ""
	@FocusState private var isSearchFocused: Bool
	@State private var selectedIndex = 0

	var results: [CommandPaletteResult] {
		results(for: query)
	}

	func results(for query: String) -> [CommandPaletteResult] {
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
		if trimmed.isEmpty || "restart server".localizedCaseInsensitiveContains(trimmed)
			|| "server".localizedCaseInsensitiveContains(trimmed)
		{
			items.append(
				CommandPaletteResult(
					id: "action-restart-server",
					title: "Restart server",
					subtitle: "Stop and start the background server",
					systemImage: "arrow.clockwise",
					kind: .action,
				),
			)
		}

		if trimmed.isEmpty || "integrations".localizedCaseInsensitiveContains(trimmed) {
			items.append(CommandPaletteResult(
				id: "action-integrations",
				title: "Open Integrations",
				subtitle: "Manage connected apps",
				systemImage: "square.grid.2x2",
				kind: .route(.integrations),
			))
		}

		if trimmed.isEmpty || "projects".localizedCaseInsensitiveContains(trimmed) {
			items.append(CommandPaletteResult(
				id: "action-projects",
				title: "Open Projects",
				subtitle: "Work in scoped project folders",
				systemImage: "folder",
				kind: .route(.projects),
			))
		}

		if trimmed.isEmpty || "skills".localizedCaseInsensitiveContains(trimmed) {
			items.append(CommandPaletteResult(
				id: "action-skills",
				title: "Open Skills",
				subtitle: "Manage installed skills",
				systemImage: "wand.and.stars",
				kind: .route(.skills),
			))
		}

		if trimmed.isEmpty || "schedules".localizedCaseInsensitiveContains(trimmed) {
			items.append(CommandPaletteResult(
				id: "action-schedules",
				title: "Open Schedules",
				subtitle: "Manage scheduled tasks",
				systemImage: "clock",
				kind: .route(.schedules),
			))
		}

		if trimmed.isEmpty || "recordings".localizedCaseInsensitiveContains(trimmed) {
			items.append(CommandPaletteResult(
				id: "action-recordings",
				title: "Open Recordings",
				subtitle: "Browse audio recordings",
				systemImage: "waveform",
				kind: .route(.recordings),
			))
		}

		if trimmed.isEmpty || "memories".localizedCaseInsensitiveContains(trimmed) {
			items.append(CommandPaletteResult(
				id: "action-memories",
				title: "Open Memories",
				subtitle: "Browse and manage memories",
				systemImage: "brain.head.profile",
				kind: .route(.memories),
			))
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

		let filteredIntegrations = integrations.filter { integration in
			guard !trimmed.isEmpty else { return true }
			return integration.label.localizedCaseInsensitiveContains(trimmed)
		}

		for integration in filteredIntegrations {
			items.append(
				CommandPaletteResult(
					id: "integration-\(integration.navKey ?? integration.key)",
					title: integration.label,
					subtitle: "Integration",
					systemImage: "puzzlepiece.extension",
					kind: .integration(integration.navKey ?? integration.key),
				),
			)
		}

		let filteredSchedules = schedules.filter { schedule in
			guard !trimmed.isEmpty else { return true }
			if schedule.displayName.localizedCaseInsensitiveContains(trimmed) { return true }
			if schedule.prompt.localizedCaseInsensitiveContains(trimmed) { return true }
			if schedule.personaName.localizedCaseInsensitiveContains(trimmed) { return true }
			return false
		}

		for schedule in filteredSchedules {
			items.append(
				CommandPaletteResult(
					id: "schedule-\(schedule.id)",
					title: schedule.displayName,
					subtitle: schedule.subtitle,
					systemImage: "clock",
					kind: .schedule(schedule.id),
				),
			)
		}

		let filteredRecordings = recordings.filter { recording in
			guard !trimmed.isEmpty else { return true }
			if recording.displayName.localizedCaseInsensitiveContains(trimmed) { return true }
			if let name = recording.name, name.localizedCaseInsensitiveContains(trimmed) { return true }
			if let description = recording.description, description.localizedCaseInsensitiveContains(trimmed) { return true }
			return false
		}

		for recording in filteredRecordings {
			items.append(
				CommandPaletteResult(
					id: "recording-\(recording.id)",
					title: recording.displayName,
					subtitle: recordingSubtitle(recording),
					systemImage: recording.hasTranscript ? "doc.text" : "waveform",
					kind: .recording(recording.id),
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
				TextField("Search…", text: $query)
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
				Text("No matching results")
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
		case .action where result.id == "action-restart-server":
			onDismiss()
			onRestartServer()
		case .route(let route):
			onDismiss()
			onNavigateToRoute(route)
		case .session(let id):
			onDismiss()
			onSelectSession(id)
		case .integration(let navKey):
			onDismiss()
			onOpenIntegration(navKey)
		case .schedule(let id):
			onDismiss()
			onOpenSchedule(id)
		case .recording(let id):
			onDismiss()
			onOpenRecording(id)
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

	private func recordingSubtitle(_ recording: ListenRecordingSummary) -> String {
		let duration = recordingDurationText(recording.durationMs)
		let transcript = recording.hasTranscript ? "Transcript" : nil
		let parts = [duration, transcript].compactMap { $0 }
		return parts.isEmpty ? "Recording" : parts.joined(separator: " · ")
	}

	private func recordingDurationText(_ durationMs: Int?) -> String {
		guard let durationMs else { return "Unknown duration" }
		let seconds = max(0, durationMs / 1000)
		let minutes = seconds / 60
		let remainder = seconds % 60
		return "\(minutes):\(String(format: "%02d", remainder))"
	}
}
