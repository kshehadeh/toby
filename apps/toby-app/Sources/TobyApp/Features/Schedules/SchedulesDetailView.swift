import SwiftUI

struct SchedulesDetailView: View {
	@Bindable var store: SchedulesStore

	var body: some View {
		VStack(spacing: 0) {
			if store.isLoading && store.schedules.isEmpty {
				ProgressView("Loading schedules…")
					.frame(maxWidth: .infinity, maxHeight: .infinity)
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
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			}

			if let errorMessage = store.errorMessage, !store.schedules.isEmpty {
				Text(errorMessage)
					.font(.caption)
					.foregroundStyle(.red)
					.padding(.bottom, 8)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
	}
}
