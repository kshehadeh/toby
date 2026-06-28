import SwiftUI

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
