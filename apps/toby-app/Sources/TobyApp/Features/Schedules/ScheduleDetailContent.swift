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

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 22) {
				DetailHeading(
					title: schedule.displayName,
					accessibilityIdentifier: "schedule-detail-name"
				)

				DetailMetadataStack {
					DetailMetadataRow(
						label: "Enabled",
						value: schedule.enabled ? "On" : "Off"
					)
					DetailMetadataRow(
						label: "When it runs",
						value: schedule.runsFlow ? "Flow" : "Prompt"
					)
					if schedule.runsFlow, let flow = store.flow(for: schedule.flowId) {
						DetailMetadataRow(label: "Flow", value: flow.displayName)
					} else {
						if !schedule.personaName.isEmpty {
							DetailMetadataRow(label: "Persona", value: personaLabel)
						}
						if let projectId = schedule.projectId, let project = store.projectOptions.first(where: { $0.id == projectId }) {
							DetailMetadataRow(label: "Project", value: project.name)
						}
					}
					if !schedule.cronHumanReadable.isEmpty || !schedule.cronExpression.isEmpty {
						DetailMetadataRow(
							label: "Schedule",
							value: schedule.cronHumanReadable.isEmpty
								? schedule.cronExpression
								: schedule.cronHumanReadable
						)
					}
					if let nextRunText = schedule.nextRunText, schedule.enabled {
						DetailMetadataRow(label: "Next run", value: nextRunText)
					}
					if let lastRun = schedule.lastRunAt, !lastRun.isEmpty {
						DetailMetadataRow(label: "Last run", value: lastRun)
					}
				}

				recentRunsSection
			}
			.frame(maxWidth: SettingsDesign.contentMaxWidth + 80)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("schedule-details-tab")
	}

	private var personaLabel: String {
		store.personaOptions.first(where: { $0.name == schedule.personaName })?.label
			?? schedule.personaName
	}

	private var recentRunsSection: some View {
		DetailSection(title: "Recent runs") {
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
			if schedule.runsFlow {
				flowContent
			} else if schedule.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				ContentUnavailableView {
					Label {
						Text("No prompt")
					} icon: {
						Image(systemName: "text.alignleft")
							.accessibilityHidden(true)
					}
				} description: {
					Text("Add a prompt in Edit Schedule.")
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else {
				VStack(alignment: .leading, spacing: 8) {
					Text("Sent to Toby when this schedule runs")
						.font(.caption)
						.foregroundStyle(SettingsDesign.rowDescription)
					ScrollView {
						MarkdownText(
							text: schedule.prompt,
							font: .body,
							foregroundStyle: SettingsDesign.rowTitle
						)
						.textSelection(.enabled)
						.frame(maxWidth: .infinity, alignment: .leading)
					}
					.frame(maxWidth: .infinity, maxHeight: .infinity)
				}
			}
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("schedule-prompt-tab")
	}

	private var flowContent: some View {
		VStack(alignment: .leading, spacing: 12) {
			Text("This schedule runs the selected flow instead of a chat prompt.")
				.font(.caption)
				.foregroundStyle(SettingsDesign.rowDescription)

			if let flow = store.flow(for: schedule.flowId) {
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
				Text("No flow selected.")
					.font(.system(size: 12))
					.foregroundStyle(SettingsDesign.rowDescription)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}
}
