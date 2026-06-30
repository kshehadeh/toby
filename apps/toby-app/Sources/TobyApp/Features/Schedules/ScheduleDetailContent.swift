import SwiftUI

struct ScheduleDetailContent: View {
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
						.frame(minHeight: 160)
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
		SettingsSelectChoiceField(
			title: "Persona",
			choices: store.personaOptions.map {
				SettingsSelectChoice(value: $0.name, label: $0.label)
			},
			selection: personaBinding,
		)
		.fixedSize()
	}

	private var currentPersonaLabel: String {
		let value = store.value(for: store.key(for: schedule.id, field: .persona))
		return store.personaOptions.first { $0.name == value }?.label ?? value
	}

	private var enabledDescription: String {
		enabledBinding.wrappedValue ? "This schedule is currently enabled." : "This schedule is currently disabled."
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
