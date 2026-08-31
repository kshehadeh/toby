import SwiftUI

struct SchedulesSidebarView: View {
	@Bindable var store: SchedulesStore
	let onDelete: (ScheduleViewModel) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Button {
				store.selectHome()
			} label: {
				HStack(spacing: 8) {
					Image(systemName: "square.grid.2x2")
						.font(.system(size: 12, weight: .semibold))
						.foregroundStyle(store.selectedScheduleId == nil ? AppTheme.accent : AppTheme.tertiaryText)
						.frame(width: 16)
					Text("Schedules")
						.font(.caption.weight(.medium))
						.foregroundStyle(store.selectedScheduleId == nil ? AppTheme.primaryText : AppTheme.secondaryText)
					Spacer(minLength: 0)
				}
				.padding(.horizontal, 10)
				.padding(.vertical, 8)
				.contentShape(Rectangle())
				.background(
					RoundedRectangle(cornerRadius: 8)
						.fill(store.selectedScheduleId == nil ? Color.white.opacity(0.10) : Color.clear)
				)
			}
			.buttonStyle(.plain)
			.accessibilityIdentifier("schedules-home-button")
			.accessibilityAddTraits(store.selectedScheduleId == nil ? [.isSelected] : [])
			.padding(.horizontal, 10)
			.padding(.top, 10)

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
