import SwiftUI

struct SchedulesDetailView: View {
	@Bindable var store: SchedulesStore
	var onOpenFlow: ((String) -> Void)?

	var body: some View {
		VStack(spacing: 0) {
			if store.isLoading && store.schedules.isEmpty {
				ProgressView("Loading schedules…")
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if let schedule = store.selectedSchedule {
				ScheduleDetailContent(store: store, schedule: schedule, onOpenFlow: onOpenFlow)
					.id(schedule.id)
			} else if let errorMessage = store.errorMessage, store.schedules.isEmpty {
				ContentUnavailableView {
					Label("Schedules unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
			} else {
				FeatureBrowserPlaceholder(
					systemImage: DetailRoute.schedules.systemImage,
					title: "No schedule selected",
					prompt: "Select a schedule",
					onCreate: { store.startCreate() },
					createAccessibilityIdentifier: "empty-create-schedule-button"
				)
			}

			if let errorMessage = store.errorMessage, !store.schedules.isEmpty {
				InlineStatusMessage(message: errorMessage, tone: .error, font: .caption)
					.padding(.horizontal, 16)
					.padding(.bottom, 8)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground, ignoresSafeAreaEdges: [])
	}
}
