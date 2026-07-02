import SwiftUI

struct ScheduleDetailContent: View {
	@Bindable var store: SchedulesStore
	let schedule: ScheduleViewModel

	var body: some View {
		VStack(spacing: 0) {
			ScheduleHeader(schedule: schedule)
				.padding(.horizontal, 24)
				.padding(.vertical, 18)

			Divider().overlay(SettingsDesign.cardBorder)

			HStack(spacing: 0) {
				promptColumn
				Divider().overlay(SettingsDesign.cardBorder)
				ScheduleInspectorSidebar(store: store, schedule: schedule)
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
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

	private func binding(for field: ScheduleField) -> Binding<String> {
		Binding(
			get: { store.value(for: store.key(for: schedule.id, field: field)) },
			set: { store.setDraftValue(store.key(for: schedule.id, field: field), $0) },
		)
	}
}
