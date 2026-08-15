import SwiftUI

struct ScheduleDetailContent: View {
	@Bindable var store: SchedulesStore
	let schedule: ScheduleViewModel
	var onOpenFlow: ((String) -> Void)?

	var body: some View {
		VStack(spacing: 0) {
			ScheduleHeader(schedule: schedule)
				.padding(.horizontal, 24)
				.padding(.vertical, 18)

			Divider().overlay(SettingsDesign.cardBorder)

			HStack(spacing: 0) {
				if isFlowAction {
					flowColumn
				} else {
					promptColumn
				}
				Divider().overlay(SettingsDesign.cardBorder)
				ScheduleInspectorSidebar(store: store, schedule: schedule)
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}

	private var isFlowAction: Bool {
		store.value(for: store.key(for: schedule.id, field: .action)) == "flow"
	}

	private var selectedFlowId: String? {
		let value = store.value(for: store.key(for: schedule.id, field: .flow))
		if value.isEmpty || value == "(none)" { return nil }
		return value
	}

	private var promptColumn: some View {
		VStack(alignment: .leading, spacing: 4) {
			Text("Prompt")
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Text("Sent to Toby when this schedule runs")
				.font(.caption)
				.foregroundStyle(SettingsDesign.rowDescription)
			SkillMarkdownEditor(text: binding(for: .prompt))
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.padding(.top, 8)
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}

	private var flowColumn: some View {
		VStack(alignment: .leading, spacing: 12) {
			Text("Flow")
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
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
				.padding(14)
				.frame(maxWidth: .infinity, alignment: .leading)
				.background(SettingsDesign.cardBackground)
				.clipShape(RoundedRectangle(cornerRadius: 10))
			} else {
				Text("Select a flow in the sidebar. Create one from the Flows screen if the list is empty.")
					.font(.system(size: 12))
					.foregroundStyle(SettingsDesign.rowDescription)
			}
			Spacer(minLength: 0)
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}

	private func binding(for field: ScheduleField) -> Binding<String> {
		Binding(
			get: { store.value(for: store.key(for: schedule.id, field: field)) },
			set: { store.setDraftValue(store.key(for: schedule.id, field: field), $0) },
		)
	}
}
