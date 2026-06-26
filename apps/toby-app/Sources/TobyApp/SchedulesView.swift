import SwiftUI

struct SchedulesView: View {
	@Bindable var store: SchedulesStore

	var body: some View {
		SchedulesDetailView(store: store, onDelete: { schedule in
			store.pendingDelete = SchedulesStore.PendingDelete(scheduleId: schedule.id, title: schedule.displayName)
		})
		.toolbarBackground(.visible)
		.background(SettingsDesign.canvasBackground)
		.task {
			await store.load()
		}
		.onDisappear {
			Task { await store.flushPendingSave() }
			store.closeRunDetail()
		}
		.sheet(isPresented: Binding(
			get: { store.selectedRunId != nil },
			set: { if !$0 { store.closeRunDetail() } }
		)) {
			if let run = store.selectedRunDetail {
				ScheduleRunDetailView(run: run, isLoading: store.isRunDetailLoading, error: store.runDetailError)
			} else {
				ScheduleRunDetailView(run: nil, isLoading: store.isRunDetailLoading, error: store.runDetailError)
			}
		}
		.alert(
			"Delete Schedule?",
			isPresented: Binding(
				get: { store.pendingDelete != nil },
				set: { if !$0 { store.pendingDelete = nil } },
			),
			presenting: store.pendingDelete,
		) { pending in
			Button("Cancel", role: .cancel) {
				store.pendingDelete = nil
			}
			Button("Delete", role: .destructive) {
				store.pendingDelete = nil
				Task { await store.deleteSchedule(id: pending.scheduleId) }
			}
		} message: { pending in
			Text("Are you sure you want to delete \"\(pending.title)\"? This cannot be undone.")
		}
	}
}

struct SchedulesSidebarView: View {
	@Bindable var store: SchedulesStore
	let onDelete: (ScheduleViewModel) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text("Schedules")
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.horizontal, 8)
				.padding(.top, 10)
			ScrollView {
				VStack(alignment: .leading, spacing: 2) {
					if store.isLoading && store.schedules.isEmpty {
						Text("Loading schedules…")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else if store.schedules.isEmpty {
						Text("No schedules")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else {
						ForEach(store.schedules) { schedule in
							Button {
								Task { await store.selectSchedule(id: schedule.id) }
							} label: {
								ScheduleSidebarRow(
									schedule: schedule,
									isSelected: schedule.id == store.selectedScheduleId,
								)
							}
							.buttonStyle(.plain)
							.contextMenu {
								Button("Delete Schedule", systemImage: "trash", role: .destructive) {
									onDelete(schedule)
								}
							}
						}
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(10)
			}
			.background(AppTheme.sidebarBackground)

			if !store.isLoading || !store.schedules.isEmpty {
				HStack(spacing: 4) {
					Text("\(store.totalCount) schedule\(store.totalCount == 1 ? "" : "s")")
						.foregroundStyle(AppTheme.tertiaryText)
					Text("·")
						.foregroundStyle(AppTheme.tertiaryText)
					Text("\(store.activeCount) active")
						.foregroundStyle(AppTheme.secondaryText)
				}
				.font(.caption)
				.padding(.horizontal, 14)
				.padding(.vertical, 10)
				.frame(maxWidth: .infinity, alignment: .leading)
				.background(AppTheme.sidebarBackground)
				.overlay(alignment: .top) {
					Rectangle()
						.fill(AppTheme.separator)
						.frame(height: 1)
				}
			}
		}
		.toolbar {
			ToolbarItem(placement: .confirmationAction) {
				Button {
					Task { await store.createSchedule() }
				} label: {
					Image(systemName: "plus")
				}
				.help("Create Schedule")
				.disabled(store.isLoading || store.isSaving)
			}
		}
	}
}

private struct ScheduleSidebarRow: View {
	let schedule: ScheduleViewModel
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: "clock")
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
				.frame(width: 20, height: 20)
			VStack(alignment: .leading, spacing: 2) {
				Text(schedule.displayName)
					.font(.callout.weight(.medium))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				Text(schedule.subtitle)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
			Spacer(minLength: 0)
			Circle()
				.fill(schedule.enabled ? Color.green : AppTheme.tertiaryText)
				.frame(width: 6, height: 6)
		}
		.padding(.vertical, 8)
		.padding(.horizontal, 10)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: 8)
				.fill(isSelected ? Color.white.opacity(0.10) : Color.clear)
		)
	}
}

struct SchedulesDetailView: View {
	@Bindable var store: SchedulesStore
	let onDelete: (ScheduleViewModel) -> Void

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 24) {
				if store.isLoading && store.schedules.isEmpty {
					ProgressView("Loading schedules…")
						.frame(maxWidth: .infinity, minHeight: 240)
				} else if let schedule = store.selectedSchedule {
					ScheduleDetailContent(store: store, schedule: schedule)
				} else if let errorMessage = store.errorMessage, store.schedules.isEmpty {
					ContentUnavailableView {
						Label("Schedules unavailable", systemImage: "exclamationmark.triangle")
					} description: {
						Text(errorMessage)
					}
				} else {
					Text("Select a schedule")
						.foregroundStyle(SettingsDesign.rowDescription)
				}

				if let errorMessage = store.errorMessage, !store.schedules.isEmpty {
					Text(errorMessage)
						.font(.caption)
						.foregroundStyle(.red)
				}
			}
			.frame(maxWidth: SettingsDesign.contentMaxWidth)
			.frame(maxWidth: .infinity)
			.padding(.horizontal, 32)
			.padding(.vertical, 28)
		}
		.background(SettingsDesign.canvasBackground)
		.toolbar {
			ToolbarItem(placement: .primaryAction) {
				if let schedule = store.selectedSchedule {
					Button {
						Task { await store.runSchedule(id: schedule.id) }
					} label: {
						Label("Run now", systemImage: "play.fill")
					}
					.disabled(store.runningScheduleId != nil || store.isSaving)
				}
			}
			ToolbarItem(placement: .primaryAction) {
				if let schedule = store.selectedSchedule {
					Button {
						onDelete(schedule)
					} label: {
						Image(systemName: "trash")
					}
					.buttonStyle(.borderedProminent)
					.tint(.red)
					.disabled(store.deletingScheduleId != nil || store.isSaving)
				}
			}
		}
	}
}

private struct ScheduleDetailContent: View {
	@Bindable var store: SchedulesStore
	let schedule: ScheduleViewModel
	@FocusState private var isCronFieldFocused: Bool

	var body: some View {
		VStack(alignment: .leading, spacing: 24) {
			ScheduleHeader(schedule: schedule)

			ScheduleSection(title: "General") {
				VStack(spacing: 0) {
					ScheduleFieldRow(title: "Name") {
						SettingsInlineField(text: binding(for: .name), placeholder: "Schedule name")
					}
					ScheduleFieldRow(title: "Persona") {
						personaMenu
					}
					ScheduleFieldRow(
						title: "Schedule",
						descriptionView: AnyView(
							VStack(alignment: .leading, spacing: 2) {
								Text("Accepts a cron expression or a plain-language description like “every weekday at 9am”.")
								Link("Learn how to write a crontab", destination: URL(string: "https://crontab.guru")!)
									.foregroundStyle(AppTheme.accent)
							}
							.font(.subheadline)
							.foregroundStyle(SettingsDesign.rowDescription)
						),
						error: store.cronValidationErrors[schedule.id]
					) {
						let cronBinding = binding(for: .cron)
						let isParsing = store.parsingCronScheduleId == schedule.id
						let isCronValid = store.isCronValid(for: schedule.id)
						HStack(spacing: 8) {
							SettingsInlineField(text: cronBinding, placeholder: "0 9 * * *")
								.disabled(isParsing)
								.focused($isCronFieldFocused)
							Button {
								Task { await store.parseCron(for: schedule.id) }
							} label: {
								if isParsing {
									ProgressView()
										.controlSize(.small)
										.frame(width: 80, height: 24)
								} else if isCronValid {
									HStack(spacing: 4) {
										Image(systemName: "checkmark.circle.fill")
										Text("Valid")
									}
									.font(.caption.weight(.semibold))
									.foregroundStyle(.green)
									.padding(.horizontal, 8)
									.padding(.vertical, 4)
									.background(.green.opacity(0.1))
									.clipShape(Capsule())
									.overlay(Capsule().stroke(.green, lineWidth: 1))
								} else {
									HStack(spacing: 4) {
										Image(systemName: "sparkles")
										Text("Convert")
									}
									.font(.caption.weight(.semibold))
									.foregroundStyle(.orange)
									.padding(.horizontal, 8)
									.padding(.vertical, 4)
									.background(.orange.opacity(0.1))
									.clipShape(Capsule())
									.overlay(Capsule().stroke(.orange, lineWidth: 1))
								}
							}
							.buttonStyle(.plain)
							.disabled(isParsing || cronBinding.wrappedValue.isEmpty || isCronValid)
							.help(
								cronBinding.wrappedValue.isEmpty
									? "Enter a schedule expression"
									: isCronValid ? "Valid crontab" : "Convert to valid crontab"
							)
							.accessibilityIdentifier("validate-schedule-button")
						}
						.onChange(of: isCronFieldFocused) { _, isFocused in
							if !isFocused {
								store.validateCronOnBlur(for: schedule.id)
							}
						}
					}
				}
			}

			ScheduleSection(title: "Status") {
				VStack(spacing: 0) {
					ScheduleFieldRow(title: "Enabled", description: enabledDescription) {
						SettingsToggle(isOn: enabledBinding)
					}
				}
			}

			ScheduleSection(title: "Prompt") {
				VStack(alignment: .leading, spacing: 12) {
					TextEditor(text: binding(for: .prompt))
						.font(.body.monospaced())
						.foregroundStyle(SettingsDesign.rowTitle)
						.scrollContentBackground(.hidden)
						.frame(minHeight: 160)
						.padding(10)
						.background(
							RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
								.fill(SettingsDesign.canvasBackground.opacity(0.55))
						)
						.overlay {
							RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
								.stroke(SettingsDesign.controlBorder, lineWidth: 1)
						}
				}
				.padding(SettingsDesign.rowHorizontalPadding)
				.padding(.vertical, SettingsDesign.rowVerticalPadding)
			}

			if let lastRun = schedule.lastRunAt, !lastRun.isEmpty {
				ScheduleSection(title: "Last run") {
					Text(lastRun)
						.font(.body)
						.foregroundStyle(SettingsDesign.rowDescription)
						.frame(maxWidth: .infinity, alignment: .leading)
						.padding(SettingsDesign.rowHorizontalPadding)
						.padding(.vertical, SettingsDesign.rowVerticalPadding)
				}
			}

			if !schedule.recentRuns.isEmpty {
				ScheduleSection(title: "Recent runs") {
					VStack(alignment: .leading, spacing: 0) {
						ForEach(Array(schedule.recentRuns.enumerated()), id: \.element.id) { index, run in
							Button {
								Task { await store.selectRun(id: run.id) }
							} label: {
								HStack(spacing: 8) {
									Circle()
										.fill(runStatusColor(run.status))
										.frame(width: 8, height: 8)
									Text(run.label)
										.font(.body)
										.foregroundStyle(SettingsDesign.rowTitle)
										.lineLimit(1)
									Spacer(minLength: 0)
									Image(systemName: "chevron.right")
										.font(.caption2)
										.foregroundStyle(SettingsDesign.rowDescription)
								}
								.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
								.padding(.vertical, SettingsDesign.rowVerticalPadding)
								.contentShape(Rectangle())
							}
							.buttonStyle(.plain)
							if index < schedule.recentRuns.count - 1 {
								Rectangle()
									.fill(SettingsDesign.cardBorder)
									.frame(height: 1)
									.padding(.leading, SettingsDesign.rowHorizontalPadding)
							}
						}
					}
				}
			}
		}
	}

	private var personaMenu: some View {
		Menu {
			ForEach(store.personaOptions) { persona in
				Button(persona.label) {
					store.setDraftValue(
						store.key(for: schedule.id, field: .persona),
						persona.name,
						autosaveImmediately: true,
					)
				}
			}
		} label: {
			SettingsDropdownLabel(title: currentPersonaLabel)
		}
		.menuStyle(.borderlessButton)
		.fixedSize()
	}

	private var currentPersonaLabel: String {
		let value = store.value(for: store.key(for: schedule.id, field: .persona))
		return store.personaOptions.first { $0.name == value }?.label ?? value
	}

	private var enabledDescription: String {
		enabledBinding.wrappedValue ? "This schedule is currently enabled." : "This schedule is currently disabled."
	}

	private func binding(for field: ScheduleField) -> Binding<String> {
		Binding(
			get: { store.value(for: store.key(for: schedule.id, field: field)) },
			set: { store.setDraftValue(store.key(for: schedule.id, field: field), $0) },
		)
	}

	private var enabledBinding: Binding<Bool> {
		Binding(
			get: {
				store.value(for: store.key(for: schedule.id, field: .enabled)).lowercased() == "yes"
			},
			set: {
				store.setDraftValue(
					store.key(for: schedule.id, field: .enabled),
					$0 ? "Yes" : "No",
					autosaveImmediately: true,
				)
			},
		)
	}

	private func runStatusColor(_ status: String) -> Color {
		switch status.lowercased() {
		case "success":
			return Color.green
		case "error":
			return Color.red
		case "running":
			return Color.orange
		default:
			return AppTheme.tertiaryText
		}
	}
}

private struct ScheduleHeader: View {
	let schedule: ScheduleViewModel

	var body: some View {
		HStack(spacing: 14) {
			RoundedRectangle(cornerRadius: 12)
				.fill(AppTheme.accent.opacity(0.18))
				.frame(width: 48, height: 48)
				.overlay {
					Image(systemName: "clock")
						.font(.system(size: 22, weight: .medium))
						.foregroundStyle(AppTheme.accent)
				}
			VStack(alignment: .leading, spacing: 4) {
				Text(schedule.displayName)
					.font(.title3.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
				HStack(spacing: 6) {
					Circle()
						.fill(schedule.enabled ? Color.green : AppTheme.tertiaryText)
						.frame(width: 6, height: 6)
					Text(statusText)
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
				}
			}
		}
	}

	private var statusText: String {
		var parts: [String] = [schedule.enabled ? "Enabled" : "Disabled"]
		if let nextRunText = schedule.nextRunText, schedule.enabled {
			parts.append("Next run \(nextRunText)")
		}
		return parts.joined(separator: " · ")
	}
}

private struct ScheduleSection<Content: View>: View {
	let title: String
	@ViewBuilder let content: Content

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			Text(title)
				.font(.caption.weight(.semibold))
				.foregroundStyle(AppTheme.tertiaryText)
				.textCase(.uppercase)
			SettingsCard {
				content
			}
		}
	}
}

private struct ScheduleFieldRow<Control: View>: View {
	let title: String
	var description: String?
	var descriptionView: AnyView?
	var error: String?
	var showsDivider: Bool = true
	@ViewBuilder let control: Control

	var body: some View {
		VStack(spacing: 0) {
			HStack(alignment: .center, spacing: 16) {
				VStack(alignment: .leading, spacing: 4) {
					Text(title)
						.font(.body)
						.foregroundStyle(SettingsDesign.rowTitle)
					if let descriptionView {
						descriptionView
					} else if let description, !description.isEmpty {
						Text(description)
							.font(.subheadline)
							.foregroundStyle(SettingsDesign.rowDescription)
							.fixedSize(horizontal: false, vertical: true)
					}
					if let error, !error.isEmpty {
						Text(error)
							.font(.subheadline)
							.foregroundStyle(.red)
							.fixedSize(horizontal: false, vertical: true)
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				control
					.layoutPriority(1)
			}
			.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
			.padding(.vertical, SettingsDesign.rowVerticalPadding)

			if showsDivider {
				Rectangle()
					.fill(SettingsDesign.cardBorder)
					.frame(height: 1)
					.padding(.leading, SettingsDesign.rowHorizontalPadding)
			}
		}
	}
}

private struct ScheduleRunDetailView: View {
	@Environment(\.dismiss) private var dismiss
	let run: ScheduleRunDetail?
	let isLoading: Bool
	let error: String?
	@State private var currentTime = Date()
	private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

	var body: some View {
		NavigationStack {
			ScrollView {
				VStack(alignment: .leading, spacing: 20) {
					if isLoading && run == nil {
						ProgressView("Loading run…")
							.frame(maxWidth: .infinity, minHeight: 200)
					} else if let error, run == nil {
						ContentUnavailableView {
							Label("Run unavailable", systemImage: "exclamationmark.triangle")
						} description: {
							Text(error)
						}
					} else if let run {
						runContent(run)
					}
				}
				.frame(maxWidth: SettingsDesign.contentMaxWidth)
				.frame(maxWidth: .infinity)
				.padding(.horizontal, 24)
				.padding(.vertical, 20)
			}
			.background(SettingsDesign.canvasBackground)
			.navigationTitle(titleText)
			.toolbar {
				ToolbarItem(placement: .cancellationAction) {
					Button("Close") {
						dismiss()
					}
				}
			}
		}
		.frame(minWidth: 560, minHeight: 400)
		.onReceive(timer) { _ in
			currentTime = Date()
		}
	}

	private var titleText: String {
		guard let run else { return "Run" }
		let elapsed = runElapsedSeconds(run, now: currentTime)
		return "\(run.titleScheduleName) - \(formatDuration(elapsed))"
	}

	private func runElapsedSeconds(_ run: ScheduleRunDetail, now: Date) -> TimeInterval {
		let start = ISO8601DateParser.date(from: run.startedAt) ?? now
		let end = run.completedAt.flatMap(ISO8601DateParser.date) ?? now
		return max(0, end.timeIntervalSince(start))
	}

	private func runContent(_ run: ScheduleRunDetail) -> some View {
		VStack(alignment: .leading, spacing: 20) {
			HStack(spacing: 12) {
				RoundedRectangle(cornerRadius: 10)
					.fill(runStatusColor(run.status).opacity(0.18))
					.frame(width: 40, height: 40)
					.overlay {
						Image(systemName: statusIcon(for: run.status))
							.font(.system(size: 18))
							.foregroundStyle(runStatusColor(run.status))
					}
				VStack(alignment: .leading, spacing: 2) {
					Text(run.displayStatus)
						.font(.headline)
						.foregroundStyle(AppTheme.primaryText)
					Text(timeText(for: run))
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
				}
			}

			if let error = run.error, !error.isEmpty {
				ScheduleSection(title: "Error") {
					Text(error)
						.font(.body)
						.foregroundStyle(.red)
						.frame(maxWidth: .infinity, alignment: .leading)
						.padding(SettingsDesign.rowHorizontalPadding)
						.padding(.vertical, SettingsDesign.rowVerticalPadding)
				}
			}

			if let output = run.output, !output.isEmpty {
				ScheduleSection(title: "Output") {
					Text(output)
						.font(.body.monospaced())
						.foregroundStyle(SettingsDesign.rowTitle)
						.frame(maxWidth: .infinity, alignment: .leading)
						.padding(SettingsDesign.rowHorizontalPadding)
						.padding(.vertical, SettingsDesign.rowVerticalPadding)
				}
			}

			if !run.transcript.isEmpty {
				ScheduleSection(title: "Transcript") {
					VStack(alignment: .leading, spacing: 0) {
						ForEach(renderedTranscript(from: run.transcript)) { item in
							transcriptRow(item)
							if item.id != renderedTranscript(from: run.transcript).last?.id {
								Rectangle()
									.fill(SettingsDesign.cardBorder)
									.frame(height: 1)
									.padding(.leading, SettingsDesign.rowHorizontalPadding)
							}
						}
					}
				}
			}
		}
	}

	private func renderedTranscript(from events: [ScheduleRunTranscriptEvent]) -> [TranscriptRenderItem] {
		var items: [TranscriptRenderItem] = []
		var assistantBuffer: String = ""
		var assistantHeader: String? = nil
		var reasoningBuffer: String = ""

		func flushAssistant() {
			if !assistantBuffer.isEmpty || assistantHeader != nil {
				items.append(TranscriptRenderItem(
					id: "assistant-\(items.count)",
					text: assistantBuffer,
					icon: "text.bubble",
					color: AppTheme.primaryText,
					header: assistantHeader
				))
				assistantBuffer = ""
				assistantHeader = nil
			}
		}

		func flushReasoning() {
			if !reasoningBuffer.isEmpty {
				items.append(TranscriptRenderItem(
					id: "reasoning-\(items.count)",
					text: reasoningBuffer,
					icon: "brain",
					color: AppTheme.tertiaryText,
					header: "Thinking"
				))
				reasoningBuffer = ""
			}
		}

		for event in events {
			switch event.type {
			case "lifecycle_start":
				flushAssistant(); flushReasoning()
				items.append(TranscriptRenderItem(
					id: "lifecycle-\(items.count)",
					text: event.header ?? "",
					icon: "gear",
					color: AppTheme.tertiaryText,
					header: event.header
				))
			case "lifecycle_end":
				items.append(TranscriptRenderItem(
					id: "lifecycle-\(items.count)",
					text: event.detail ?? "",
					icon: "checkmark",
					color: AppTheme.tertiaryText,
					header: nil
				))
			case "assistant_segment_start":
				flushAssistant(); flushReasoning()
				assistantHeader = event.header
			case "assistant_text_delta":
				assistantBuffer.append(event.delta ?? "")
			case "assistant_segment_end":
				flushAssistant()
			case "reasoning_start":
				flushAssistant()
			case "reasoning_delta":
				reasoningBuffer.append(event.text ?? "")
			case "reasoning_end":
				flushReasoning()
			case "tool_call_start":
				flushAssistant(); flushReasoning()
				items.append(TranscriptRenderItem(
					id: "tool-start-\(items.count)",
					text: event.toolName ?? "Tool",
					icon: "wrench",
					color: AppTheme.accent,
					header: "Using \(event.toolName ?? "tool")"
				))
			case "tool_call_complete":
				let duration = event.durationMs.map { " \($0)ms" } ?? ""
				items.append(TranscriptRenderItem(
					id: "tool-done-\(items.count)",
					text: (event.toolName ?? "Tool") + duration,
					icon: event.error == nil ? "checkmark.circle" : "xmark.circle",
					color: event.error == nil ? Color.green : Color.red,
					header: nil
				))
			case "transcript_notice":
				flushAssistant(); flushReasoning()
				items.append(TranscriptRenderItem(
					id: "notice-\(items.count)",
					text: event.text ?? "",
					icon: "info.circle",
					color: AppTheme.secondaryText,
					header: nil
				))
			default:
				break
			}
		}
		flushAssistant()
		flushReasoning()
		return items
	}

	private func transcriptRow(_ item: TranscriptRenderItem) -> some View {
		HStack(alignment: .top, spacing: 10) {
			Image(systemName: item.icon)
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(item.color)
				.frame(width: 18, height: 18)
			VStack(alignment: .leading, spacing: 4) {
				if let header = item.header {
					Text(header)
						.font(.caption.weight(.medium))
						.foregroundStyle(AppTheme.tertiaryText)
				}
				Text(item.text)
					.font(.body)
					.foregroundStyle(item.color)
					.frame(maxWidth: .infinity, alignment: .leading)
			}
		}
		.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
		.padding(.vertical, SettingsDesign.rowVerticalPadding)
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private func timeText(for run: ScheduleRunDetail) -> String {
		let started = DateFormatter.localizedString(from: ISO8601DateParser.date(from: run.startedAt) ?? Date(), dateStyle: .medium, timeStyle: .short)
		if let completedAt = run.completedAt, let completed = ISO8601DateParser.date(from: completedAt) {
			let duration = completed.timeIntervalSince(ISO8601DateParser.date(from: run.startedAt) ?? Date())
			return "Started \(started) · \(formatDuration(duration))"
		}
		return "Started \(started)"
	}

	private func formatDuration(_ seconds: TimeInterval) -> String {
		let minutes = Int(seconds / 60)
		let remainingSeconds = Int(seconds) % 60
		if minutes > 0 {
			return "\(minutes)m \(remainingSeconds)s"
		}
		return "\(remainingSeconds)s"
	}

	private func statusIcon(for status: String) -> String {
		switch status.lowercased() {
		case "success": return "checkmark.circle"
		case "error": return "xmark.circle"
		case "running": return "clock"
		default: return "clock"
		}
	}

	private func runStatusColor(_ status: String) -> Color {
		switch status.lowercased() {
		case "success": return Color.green
		case "error": return Color.red
		case "running": return Color.orange
		default: return AppTheme.tertiaryText
		}
	}
}

private struct TranscriptRenderItem: Identifiable {
	let id: String
	let text: String
	let icon: String
	let color: Color
	let header: String?
}

private enum ISO8601DateParser {
	static func date(from string: String) -> Date? {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return formatter.date(from: string)
	}
}
