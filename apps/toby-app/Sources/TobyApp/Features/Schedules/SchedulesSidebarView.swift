import SwiftUI

struct SchedulesSidebarView: View {
	@Bindable var store: SchedulesStore
	let onDelete: (ScheduleViewModel) -> Void

	var body: some View {
		FeatureBrowserList(
			isLoading: store.isLoading,
			isEmpty: store.schedules.isEmpty,
			loadingText: "Loading schedules…",
			emptyText: "No schedules"
		) {
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
}
