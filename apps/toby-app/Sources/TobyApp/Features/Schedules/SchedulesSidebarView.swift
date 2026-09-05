import SwiftUI

struct SchedulesSidebarView: View {
	@Bindable var store: SchedulesStore
	let onDelete: (ScheduleViewModel) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			ScrollView {
				VStack(alignment: .leading, spacing: 2) {
					if store.isLoading && store.schedules.isEmpty {
						Text("Loading schedules…")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else if store.schedules.isEmpty {
						Text("No schedules")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else {
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
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(10)
			}
			.background(AppTheme.sidebarBackground)

			if !store.isLoading || !store.schedules.isEmpty {
				HStack(spacing: 4) {
					Text("\(store.totalCount) schedule\(store.totalCount == 1 ? "" : "s")")
						.foregroundStyle(AppTheme.tertiaryText)
					Text("·")
						.foregroundStyle(AppTheme.tertiaryText)
					Text("\(store.activeCount) active")
						.foregroundStyle(AppTheme.secondaryText)
				}
				.font(.caption)
				.padding(.horizontal, 14)
				.padding(.vertical, 10)
				.frame(maxWidth: .infinity, alignment: .leading)
				.background(AppTheme.sidebarBackground)
				.overlay(alignment: .top) {
					Rectangle()
						.fill(AppTheme.separator)
						.frame(height: 1)
				}
			}
		}
	}
}
