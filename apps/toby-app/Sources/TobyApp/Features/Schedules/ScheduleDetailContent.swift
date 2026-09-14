import SwiftUI

enum ScheduleDetailTab: String, Hashable, CaseIterable {
	case details
	case prompt
}

struct ScheduleDetailContent: View {
	@Bindable var store: SchedulesStore
	let schedule: ScheduleViewModel
	var onOpenFlow: ((String) -> Void)?

	var body: some View {
		TabView(selection: $store.selectedDetailTab) {
			Tab(value: ScheduleDetailTab.details) {
				ScheduleDetailsPane(store: store, schedule: schedule)
			} label: {
				Text("Details")
			}
			Tab(value: ScheduleDetailTab.prompt) {
				SchedulePromptPane(
					store: store,
					schedule: schedule,
					onOpenFlow: onOpenFlow
				)
			} label: {
				Text("Prompt")
			}
		}
		.padding(AppTheme.contentPadding)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("schedule-detail-tabs")
	}
}

struct ScheduleDetailsPane: View {
	@Bindable var store: SchedulesStore
	let schedule: ScheduleViewModel

	@FocusState private var isCronFieldFocused: Bool

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 16) {
				nameField
				actionField
				if isFlowAction {
					flowField
				} else {
					personaField
					projectField
				}
				cronField
				enableRow
				runInfoSection
				recentRunsSection
			}
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("schedule-details-tab")
	}

	private var nameField: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Name")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			TextField("Schedule name", text: nameBinding)
				.textFieldStyle(.roundedBorder)
				.controlSize(.regular)
				.accessibilityIdentifier("schedule-title-field")
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private var actionField: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("When it runs")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Picker("When it runs", selection: actionBinding) {
				Text("Prompt").tag("prompt")
				Text("Flow").tag("flow")
			}
			.labelsHidden()
			.pickerStyle(.menu)
			.controlSize(.regular)
			.accessibilityIdentifier("schedule-action-picker")
			Text(
				isFlowAction
					? "Runs the selected flow on this timetable."
					: "Sends the prompt through chat when this timetable fires."
			)
			.font(.system(size: 11))
			.foregroundStyle(SettingsDesign.rowDescription)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private var flowField: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Flow")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			if store.flowOptions.isEmpty {
				Text("Create a flow first, then pick it here.")
					.font(.system(size: 11))
					.foregroundStyle(SettingsDesign.rowDescription)
			} else {
				Picker("Flow", selection: flowBinding) {
					Text("Select a flow").tag("(none)")
					ForEach(store.flowOptions) { flow in
						Label(
							flow.builtin ? "\(flow.displayName) (built-in)" : flow.displayName,
							systemImage: flow.systemImage
						)
						.tag(flow.id)
					}
				}
				.labelsHidden()
				.pickerStyle(.menu)
				.controlSize(.regular)
				.accessibilityIdentifier("schedule-flow-picker")
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private var personaField: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Persona")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Picker("Persona", selection: personaBinding) {
				ForEach(store.personaOptions, id: \.name) { option in
					Text(option.label).tag(option.name)
				}
			}
			.labelsHidden()
			.pickerStyle(.menu)
			.controlSize(.regular)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private var projectField: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Project")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Picker("Project", selection: binding(for: .project)) {
				Text("No project").tag("(none)")
				ForEach(store.projectOptions) { project in
					Text(project.name).tag(project.id)
				}
			}
			.labelsHidden()
			.pickerStyle(.menu)
			.controlSize(.regular)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private var cronField: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Schedule")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			VStack(alignment: .leading, spacing: 4) {
				Text(
					"Accepts a cron expression or a plain-language description like \u{201C}every weekday at 9am\u{201D}."
				)
				.font(.system(size: 11))
				.foregroundStyle(SettingsDesign.rowDescription)
				Link(
					"Learn how to write a crontab",
					destination: URL(string: "https://crontab.guru")!
				)
				.font(.system(size: 11))
				.foregroundStyle(AppTheme.accent)
			}
			let cronBinding = binding(for: .cron)
			let isParsing = store.isParsingCron(for: schedule.id)
			let isCronValid = store.isCronValid(for: schedule.id)
			let cronText = cronBinding.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines)
			HStack(spacing: 8) {
				SettingsInlineField(text: cronBinding, placeholder: "0 9 * * *")
					.disabled(isParsing)
					.focused($isCronFieldFocused)
					.onChange(of: isCronFieldFocused) { _, isFocused in
						if !isFocused {
							store.validateCronOnBlur(for: schedule.id)
						}
					}
				Button {
					Task { await store.parseCron(for: schedule.id) }
				} label: {
					if isParsing {
						ProgressView()
							.controlSize(.small)
					} else if isCronValid {
						Label("Valid", systemImage: "checkmark.circle.fill")
					} else {
						Label("Convert", systemImage: "sparkles")
					}
				}
				.buttonStyle(.bordered)
				.controlSize(.regular)
				.frame(width: 96)
				.disabled(isParsing || cronBinding.wrappedValue.isEmpty || isCronValid)
				.help(
					cronBinding.wrappedValue.isEmpty
						? "Enter a schedule expression"
						: isCronValid ? "Valid crontab" : "Convert to valid crontab"
				)
				.accessibilityIdentifier("validate-schedule-button")
			}
			if isParsing {
				HStack(spacing: 6) {
					ProgressView()
						.controlSize(.mini)
					Text("Converting natural language to cron…")
						.font(.system(size: 11))
						.foregroundStyle(SettingsDesign.rowDescription)
				}
				.accessibilityIdentifier("cron-converting-status")
			} else if let error = store.cronValidationErrors[schedule.id], !error.isEmpty {
				InlineStatusMessage(message: error, tone: .error, font: .system(size: 11))
			} else if !cronText.isEmpty && !isCronValid {
				Text("Click Convert to turn this into a cron expression.")
					.font(.system(size: 11))
					.foregroundStyle(SettingsDesign.rowDescription)
					.accessibilityIdentifier("cron-needs-convert-hint")
			}
		}
	}

	private var enableRow: some View {
		HStack {
			VStack(alignment: .leading, spacing: 2) {
				Text("Enabled")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Text(enabledDescription)
					.font(.system(size: 11))
					.foregroundStyle(SettingsDesign.rowDescription)
			}
			Spacer()
			SettingsToggle(isOn: enabledBinding)
		}
	}

	@ViewBuilder
	private var runInfoSection: some View {
		if let nextRunText = schedule.nextRunText, enabledBinding.wrappedValue {
			metadataRow(label: "Next run", value: nextRunText)
		}
		if let lastRun = schedule.lastRunAt, !lastRun.isEmpty {
			metadataRow(label: "Last run", value: lastRun)
		}
	}

	private var recentRunsSection: some View {
		VStack(alignment: .leading, spacing: 12) {
			Text("Recent runs")
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)

			if schedule.recentRuns.isEmpty {
				Text("No runs yet")
					.font(.system(size: 13))
					.foregroundStyle(SettingsDesign.rowDescription)
			} else {
				VStack(alignment: .leading, spacing: 0) {
					ForEach(Array(schedule.recentRuns.enumerated()), id: \.element.id) {
						index, run in
						Button {
							Task { await store.selectRun(id: run.id) }
						} label: {
							HStack(spacing: 8) {
								Circle()
									.fill(runStatusColor(run.status))
									.frame(width: 8, height: 8)
								Text(run.label)
									.font(.system(size: 12))
									.foregroundStyle(SettingsDesign.rowTitle)
									.lineLimit(1)
								Spacer(minLength: 0)
								Image(systemName: "chevron.right")
									.font(.system(size: 10))
									.foregroundStyle(SettingsDesign.rowDescription)
							}
							.padding(.vertical, 8)
							.contentShape(Rectangle())
						}
						.buttonStyle(.plain)
						if index < schedule.recentRuns.count - 1 {
							Rectangle()
								.fill(SettingsDesign.cardBorder)
								.frame(height: 1)
						}
					}
				}
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private func metadataRow(label: String, value: String) -> some View {
		HStack {
			Text(label)
				.font(.system(size: 11))
				.foregroundStyle(SettingsDesign.rowDescription)
			Spacer()
			Text(value)
				.font(.system(size: 11))
				.foregroundStyle(SettingsDesign.rowTitle)
		}
	}

	private func binding(for field: ScheduleField) -> Binding<String> {
		Binding(
			get: { store.value(for: store.key(for: schedule.id, field: field)) },
			set: { store.setDraftValue(store.key(for: schedule.id, field: field), $0) },
		)
	}

	private var isFlowAction: Bool {
		store.value(for: store.key(for: schedule.id, field: .action)) == "flow"
	}

	private var nameBinding: Binding<String> {
		Binding(
			get: {
				let value = store.value(for: store.key(for: schedule.id, field: .name))
				return value.isEmpty ? schedule.name : value
			},
			set: {
				store.setDraftValue(
					store.key(for: schedule.id, field: .name),
					$0,
					autosaveImmediately: true,
				)
			},
		)
	}

	private var actionBinding: Binding<String> {
		Binding(
			get: { isFlowAction ? "flow" : "prompt" },
			set: { store.setAction($0, for: schedule.id) },
		)
	}

	private var flowBinding: Binding<String> {
		Binding(
			get: {
				let value = store.value(for: store.key(for: schedule.id, field: .flow))
				return value.isEmpty ? "(none)" : value
			},
			set: {
				store.setDraftValue(
					store.key(for: schedule.id, field: .flow),
					$0,
					autosaveImmediately: true,
				)
			},
		)
	}

	private var personaBinding: Binding<String> {
		Binding(
			get: { store.value(for: store.key(for: schedule.id, field: .persona)) },
			set: {
				store.setDraftValue(
					store.key(for: schedule.id, field: .persona),
					$0,
					autosaveImmediately: true,
				)
			},
		)
	}

	private var enabledBinding: Binding<Bool> {
		Binding(
			get: {
				let value = store.value(for: store.key(for: schedule.id, field: .enabled))
				if value.isEmpty { return schedule.enabled }
				return value.lowercased() == "yes"
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

	private var enabledDescription: String {
		enabledBinding.wrappedValue
			? "This schedule is currently enabled." : "This schedule is currently disabled."
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

struct SchedulePromptPane: View {
	@Bindable var store: SchedulesStore
	let schedule: ScheduleViewModel
	var onOpenFlow: ((String) -> Void)?

	var body: some View {
		Group {
			if isFlowAction {
				flowContent
			} else {
				promptEditor
			}
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("schedule-prompt-tab")
	}

	private var promptEditor: some View {
		VStack(alignment: .leading, spacing: 8) {
			Text("Sent to Toby when this schedule runs")
				.font(.caption)
				.foregroundStyle(SettingsDesign.rowDescription)
			SkillMarkdownEditor(text: binding(for: .prompt))
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}

	private var flowContent: some View {
		VStack(alignment: .leading, spacing: 12) {
			Text("This schedule runs the selected flow instead of a chat prompt.")
				.font(.caption)
				.foregroundStyle(SettingsDesign.rowDescription)

			if let flowId = selectedFlowId, let flow = store.flow(for: flowId) {
				VStack(alignment: .leading, spacing: 8) {
					HStack(spacing: 8) {
						Image(systemName: flow.systemImage)
							.foregroundStyle(AppTheme.accent)
						Text(flow.displayName)
							.font(.system(size: 16, weight: .semibold))
							.foregroundStyle(SettingsDesign.rowTitle)
						if flow.builtin {
							Text("Built-in")
								.font(.system(size: 10, weight: .semibold))
								.foregroundStyle(SettingsDesign.rowDescription)
						}
					}
					Text(flow.subtitle)
						.font(.system(size: 12))
						.foregroundStyle(SettingsDesign.rowDescription)
					if let destinations = flow.destinations, !destinations.isEmpty {
						Text(destinations.map(\.summary).joined(separator: " · "))
							.font(.system(size: 11))
							.foregroundStyle(SettingsDesign.rowDescription)
					}
					if let onOpenFlow {
						Button("Open in Flows") {
							onOpenFlow(flow.id)
						}
						.buttonStyle(.bordered)
						.controlSize(.regular)
						.accessibilityIdentifier("schedule-open-flow-button")
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
			} else {
				Text("Select a flow on the Details tab.")
					.font(.system(size: 12))
					.foregroundStyle(SettingsDesign.rowDescription)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}

	private func binding(for field: ScheduleField) -> Binding<String> {
		Binding(
			get: { store.value(for: store.key(for: schedule.id, field: field)) },
			set: { store.setDraftValue(store.key(for: schedule.id, field: field), $0) },
		)
	}

	private var isFlowAction: Bool {
		store.value(for: store.key(for: schedule.id, field: .action)) == "flow"
	}

	private var selectedFlowId: String? {
		let value = store.value(for: store.key(for: schedule.id, field: .flow))
		if value.isEmpty || value == "(none)" { return nil }
		return value
	}
}
