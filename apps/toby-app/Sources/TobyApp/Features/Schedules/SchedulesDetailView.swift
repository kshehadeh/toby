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
			} else if let errorMessage = store.errorMessage, store.schedules.isEmpty {
				ContentUnavailableView {
					Label("Schedules unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
			} else if store.schedules.isEmpty {
				SchedulesEmptyStateView(store: store)
			} else {
				SchedulesHomeView(store: store)
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

struct SchedulesHomeView: View {
	@Bindable var store: SchedulesStore

	private let columns = [
		GridItem(.adaptive(minimum: 240, maximum: 360), spacing: 16),
	]

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				header
				LazyVGrid(columns: columns, spacing: 16) {
					ForEach(store.schedules) { schedule in
						Button {
							Task { await store.selectSchedule(id: schedule.id) }
						} label: {
							ScheduleCard(schedule: schedule)
						}
						.buttonStyle(.plain)
						.accessibilityIdentifier("schedule-card-\(schedule.id)")
					}
				}
			}
			.padding(24)
			.frame(maxWidth: 980)
			.frame(maxWidth: .infinity)
		}
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("schedules-home-view")
	}

	private var header: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Schedules")
				.font(.system(size: 24, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Text("Recurring prompts and flows that Toby runs automatically. Select a schedule to edit it or review its recent runs.")
				.font(.body)
				.foregroundStyle(SettingsDesign.rowDescription)
				.fixedSize(horizontal: false, vertical: true)
		}
	}
}

struct ScheduleCard: View {
	let schedule: ScheduleViewModel

	private var actionLabel: String {
		schedule.runsFlow ? "Runs a flow" : "Prompt · \(schedule.personaName)"
	}

	private var nextRunLabel: String {
		guard schedule.enabled else { return "Paused" }
		guard let nextRunText = schedule.nextRunText else { return "No upcoming run" }
		return "Next run \(nextRunText)"
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			HStack(alignment: .top, spacing: 12) {
				RoundedRectangle(cornerRadius: 10)
					.fill(AppTheme.accent.opacity(0.16))
					.frame(width: 40, height: 40)
					.overlay {
						Image(systemName: "clock")
							.font(.system(size: 17, weight: .semibold))
							.foregroundStyle(AppTheme.accent)
							.accessibilityHidden(true)
					}
				VStack(alignment: .leading, spacing: 4) {
					Text(schedule.displayName)
						.font(.system(size: 15, weight: .semibold))
						.foregroundStyle(SettingsDesign.rowTitle)
						.lineLimit(2)
						.multilineTextAlignment(.leading)
					Text(schedule.enabled ? "Active" : "Paused")
						.font(.system(size: 11, weight: .medium))
						.foregroundStyle(schedule.enabled ? .green : AppTheme.tertiaryText)
				}
				Spacer(minLength: 0)
			}

			Text(schedule.subtitle)
				.font(.system(size: 12))
				.foregroundStyle(SettingsDesign.rowDescription)
				.lineLimit(3)
				.multilineTextAlignment(.leading)
				.frame(maxWidth: .infinity, alignment: .leading)
				.frame(minHeight: 48, alignment: .topLeading)

			HStack {
				VStack(alignment: .leading, spacing: 2) {
					Text(actionLabel)
					Text(nextRunLabel)
				}
				.font(.system(size: 11))
				.foregroundStyle(AppTheme.secondaryText)
				.lineLimit(1)
				Spacer()
				Image(systemName: "chevron.right")
					.font(.system(size: 11, weight: .semibold))
					.foregroundStyle(AppTheme.tertiaryText)
					.accessibilityHidden(true)
			}
		}
		.padding(16)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		)
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

				Text("Schedules run a prompt or a flow through Toby's background daemon so routine work can happen automatically.")
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
