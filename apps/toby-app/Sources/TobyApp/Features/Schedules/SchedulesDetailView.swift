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
			} else if store.schedules.isEmpty {
				SchedulesEmptyStateView(store: store)
			} else {
				Text("Select a schedule")
					.foregroundStyle(SettingsDesign.rowDescription)
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			}

			if let errorMessage = store.errorMessage, !store.schedules.isEmpty {
				InlineStatusMessage(message: errorMessage, tone: .error, font: .caption)
					.padding(.horizontal, 16)
					.padding(.bottom, 8)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
	}
}

private struct SchedulesEmptyStateView: View {
	@Bindable var store: SchedulesStore

	var body: some View {
		VStack(spacing: 18) {
			Image(systemName: "calendar.badge.clock")
				.font(.system(size: 72, weight: .regular))
				.foregroundStyle(SettingsDesign.rowDescription)
				.accessibilityHidden(true)

			VStack(spacing: 8) {
				Text("Schedules")
					.font(.system(size: 28, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)

				Text("Schedules run recurring prompts through Toby's background daemon so routine work can happen automatically.")
					.font(.body)
					.foregroundStyle(SettingsDesign.rowDescription)
					.multilineTextAlignment(.center)
					.lineLimit(3)
					.frame(maxWidth: 480)
			}

			Button {
				Task { await store.createSchedule() }
			} label: {
				Label("Create Schedule", systemImage: "plus")
			}
			.buttonStyle(.borderedProminent)
			.disabled(store.isLoading || store.isSaving)
			.accessibilityIdentifier("empty-create-schedule-button")
		}
		.padding(32)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.accessibilityElement(children: .contain)
	}
}
