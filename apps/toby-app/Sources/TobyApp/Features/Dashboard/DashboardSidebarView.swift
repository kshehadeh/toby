import SwiftUI

struct DashboardSidebarView: View {
	let sessions: [SessionSummary]
	let schedules: [ScheduleViewModel]
	let recordings: [ListenRecordingSummary]
	let memories: [MemoryItem]
	let isSessionsLoading: Bool
	let onOpenSession: (String) -> Void
	let onOpenScheduleRun: (DashboardScheduleRunItem) -> Void
	let onOpenRecording: (String) -> Void
	let onOpenMemory: (String) -> Void

	private var recentSessions: [SessionSummary] {
		Array(sessions.prefix(5))
	}

	private var recentScheduleRuns: [DashboardScheduleRunItem] {
		let runs = schedules.flatMap { schedule in
			schedule.recentRuns.map { run in
				DashboardScheduleRunItem(schedule: schedule, run: run)
			}
		}
		return Array(runs.sorted(by: dashboardScheduleRunSort).prefix(5))
	}

	private var recentRecordings: [ListenRecordingSummary] {
		Array(recordings.sorted(by: dashboardRecordingSort).prefix(5))
	}

	private var recentMemories: [MemoryItem] {
		Array(memories.sorted(by: dashboardMemoryCreatedSort).prefix(5))
	}

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 6) {
				SidebarSection(title: "Recent Chats") {
					if isSessionsLoading && recentSessions.isEmpty {
						DashboardSidebarEmptyRow(text: "Loading chats...")
					} else if recentSessions.isEmpty {
						DashboardSidebarEmptyRow(text: "No chats yet")
					} else {
						VStack(alignment: .leading, spacing: 2) {
							ForEach(recentSessions) { session in
								Button {
									onOpenSession(session.id)
								} label: {
									DashboardSidebarRow(
										systemImage: session.isExternal ? "bubble.left.and.bubble.right" : "message",
										title: session.name,
										subtitle: sidebarSessionDate(session) ?? "Chat",
										tint: Color(red: 0.35, green: 0.68, blue: 1)
									)
								}
								.buttonStyle(.plain)
							}
						}
					}
				}

				if !recentScheduleRuns.isEmpty {
					SidebarSection(title: "Recent Schedule Runs") {
						VStack(alignment: .leading, spacing: 2) {
							ForEach(recentScheduleRuns) { item in
								Button {
									onOpenScheduleRun(item)
								} label: {
									DashboardSidebarRow(
										systemImage: dashboardScheduleRunIcon(for: item.run.status),
										title: item.schedule.displayName,
										subtitle: item.run.label,
										tint: dashboardScheduleRunTint(for: item.run.status)
									)
								}
								.buttonStyle(.plain)
							}
						}
					}
				}

				if !recentRecordings.isEmpty {
					SidebarSection(title: "Recent Recordings") {
						VStack(alignment: .leading, spacing: 2) {
							ForEach(recentRecordings) { recording in
								Button {
									onOpenRecording(recording.id)
								} label: {
									DashboardSidebarRow(
										systemImage: recording.hasTranscript ? "doc.text" : "waveform",
										title: recordingSidebarTitle(recording),
										subtitle: recordingSummary(recording),
										tint: Color(red: 1, green: 0.36, blue: 0.42)
									)
								}
								.buttonStyle(.plain)
							}
						}
					}
				}

				if !recentMemories.isEmpty {
					SidebarSection(title: "Recent Memories") {
						VStack(alignment: .leading, spacing: 2) {
							ForEach(recentMemories) { memory in
								Button {
									onOpenMemory(memory.id)
								} label: {
									DashboardSidebarRow(
										systemImage: "brain.head.profile",
										title: memory.value,
										subtitle: memory.subject ?? dashboardSidebarDateText(memory.createdAt) ?? "Memory",
										tint: Color(red: 0.92, green: 0.58, blue: 0.86)
									)
								}
								.buttonStyle(.plain)
							}
						}
					}
				}
			}
			.padding(.bottom, 8)
		}
		.automaticScrollIndicators(axes: .vertical)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}
}

struct DashboardScheduleRunItem: Identifiable {
	let schedule: ScheduleViewModel
	let run: ScheduleRunViewModel

	var id: String { run.id }
}

private struct DashboardSidebarRow: View {
	let systemImage: String
	let title: String
	let subtitle: String
	let tint: Color

	var body: some View {
		HStack(alignment: .top, spacing: 8) {
			Image(systemName: systemImage)
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(tint)
				.frame(width: 16, height: 16)
				.padding(.top, 2)
			VStack(alignment: .leading, spacing: 2) {
				Text(title)
					.font(.system(size: 12, weight: .medium))
					.foregroundStyle(AppTheme.secondaryText)
					.lineLimit(1)
				Text(subtitle)
					.font(.system(size: 10))
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 6)
		.padding(.horizontal, 8)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(Color.white.opacity(0.0001))
		)
	}
}

private struct DashboardSidebarEmptyRow: View {
	let text: String

	var body: some View {
		Text(text)
			.font(.caption)
			.foregroundStyle(AppTheme.tertiaryText)
			.padding(.horizontal, 8)
			.padding(.vertical, 7)
	}
}

private func dashboardScheduleRunSort(
	_ lhs: DashboardScheduleRunItem,
	_ rhs: DashboardScheduleRunItem
) -> Bool {
	let left = dashboardSidebarDate(lhs.run.startedAt)
	let right = dashboardSidebarDate(rhs.run.startedAt)
	if let left, let right {
		return left > right
	}
	return lhs.run.label > rhs.run.label
}

private func dashboardRecordingSort(
	_ lhs: ListenRecordingSummary,
	_ rhs: ListenRecordingSummary
) -> Bool {
	let left = dashboardSidebarDate(lhs.startedAt) ?? dashboardSidebarDate(lhs.createdAt)
	let right = dashboardSidebarDate(rhs.startedAt) ?? dashboardSidebarDate(rhs.createdAt)
	if let left, let right {
		return left > right
	}
	return lhs.startedAt > rhs.startedAt
}

private func dashboardMemoryCreatedSort(_ lhs: MemoryItem, _ rhs: MemoryItem) -> Bool {
	let left = dashboardSidebarDate(lhs.createdAt)
	let right = dashboardSidebarDate(rhs.createdAt)
	if let left, let right {
		return left > right
	}
	return lhs.createdAt > rhs.createdAt
}

private func dashboardSidebarDateText(_ value: String?) -> String? {
	guard let date = dashboardSidebarDate(value) else { return nil }
	return SidebarDateFormatter.friendly.string(from: date)
}

private func dashboardSidebarDate(_ value: String?) -> Date? {
	guard let value, !value.isEmpty else { return nil }
	let fractional = ISO8601DateFormatter()
	fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
	return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}

private func dashboardScheduleRunIcon(for status: String) -> String {
	switch status {
	case "success": return "checkmark.circle"
	case "error": return "exclamationmark.circle"
	case "running": return "arrow.triangle.2.circlepath"
	default: return "clock"
	}
}

private func dashboardScheduleRunTint(for status: String) -> Color {
	switch status {
	case "success": return Color.green
	case "error": return Color.red
	case "running": return AppTheme.accent
	default: return AppTheme.tertiaryText
	}
}
