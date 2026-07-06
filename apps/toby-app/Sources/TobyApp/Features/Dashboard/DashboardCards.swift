import AppKit
import SwiftUI

// MARK: - Card container

struct DashboardCard<Content: View>: View {
	let content: Content

	init(@ViewBuilder content: () -> Content) {
		self.content = content()
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			content
		}
		.frame(maxWidth: .infinity, alignment: .topLeading)
		.padding(18)
		.background(
			RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
				.fill(AppTheme.panelBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
				.stroke(AppTheme.separator, lineWidth: 1)
		)
	}
}

private struct CardHeader: View {
	let systemImage: String
	let iconColor: Color
	let title: String
	let badgeValue: String
	let badgeLabel: String

	var body: some View {
		HStack(spacing: 8) {
			Image(systemName: systemImage)
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(iconColor)
			Text(title)
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(AppTheme.primaryText)
			Spacer()
			HStack(spacing: 4) {
				Text(badgeValue)
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(AppTheme.primaryText)
				Text(badgeLabel)
					.font(.system(size: 13))
					.foregroundStyle(AppTheme.secondaryText)
			}
		}
	}
}

private struct DashboardLinkButton: View {
	let title: String
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			HStack(spacing: 4) {
				Text(title)
				Image(systemName: "arrow.right")
					.font(.system(size: 11, weight: .semibold))
			}
			.font(.system(size: 13, weight: .medium))
			.foregroundStyle(Color(red: 0.35, green: 0.68, blue: 1))
		}
		.buttonStyle(.plain)
	}
}

// MARK: - Unread mail card

struct UnreadMailCard: View {
	let summary: DashboardCategorySummary?
	let onSummarize: () -> Void

	private let chipPalette: [Color] = [
		Color(red: 0.90, green: 0.35, blue: 0.35),
		Color(red: 0.96, green: 0.62, blue: 0.12),
		Color(red: 0.35, green: 0.68, blue: 1),
		Color(red: 0.55, green: 0.60, blue: 0.68),
		Color(red: 0.55, green: 0.60, blue: 0.68),
	]

	private var unreadItems: [DashboardItem] {
		Array((summary?.items ?? []).prefix(10))
	}

	var body: some View {
		DashboardCard {
			CardHeader(
				systemImage: "envelope",
				iconColor: AppTheme.accent,
				title: "Unread mail",
				badgeValue: "\(summary?.count ?? 0)",
				badgeLabel: "unread"
			)

			if let summary, summary.count > 0 {
				if !summary.groups.isEmpty {
					FlowLayout(spacing: 6) {
						ForEach(Array(summary.groups.enumerated()), id: \.element.id) { index, group in
							GroupChip(
								count: group.count,
								label: group.label,
								color: chipPalette[index % chipPalette.count]
							)
						}
					}
					.padding(.top, 14)
				}

				if !unreadItems.isEmpty {
					VStack(spacing: 0) {
						ForEach(unreadItems) { item in
							MailReplyRow(item: item)
						}
					}
					.padding(.top, 14)
				}

				HStack(spacing: 16) {
					DashboardLinkButton(title: "Open Mail", action: openMail)
					DashboardLinkButton(title: "Summarize all in chat", action: onSummarize)
				}
				.padding(.top, 16)
			} else {
				DashboardEmptyState(
					message: summary == nil
						? "Connect an email account to see unread mail."
						: "You're all caught up. No unread mail."
				)
				.padding(.top, 18)

				DashboardLinkButton(title: "Open Mail", action: openMail)
					.padding(.top, 14)
			}
		}
		.accessibilityIdentifier("dashboard-mail-card")
	}

	/// Open the provider's webmail inbox if declared, else the default mail client.
	private func openMail() {
		if let launch = summary?.sources.compactMap(\.launchUrl).first,
			let url = URL(string: launch)
		{
			NSWorkspace.shared.open(url)
			return
		}
		guard let mailto = URL(string: "mailto:") else { return }
		let workspace = NSWorkspace.shared
		if let appURL = workspace.urlForApplication(toOpen: mailto) {
			workspace.openApplication(at: appURL, configuration: NSWorkspace.OpenConfiguration())
		} else {
			workspace.open(mailto)
		}
	}
}

private struct GroupChip: View {
	let count: Int
	let label: String
	let color: Color

	var body: some View {
		HStack(spacing: 5) {
			Text("\(count)")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(color)
			Text(label)
				.font(.system(size: 12))
				.foregroundStyle(AppTheme.secondaryText)
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 5)
		.background(
			Capsule().fill(color.opacity(0.14))
		)
	}
}

private struct MailReplyRow: View {
	let item: DashboardItem

	private var sender: String { item.subtitle ?? item.title }

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			AvatarCircle(name: sender)
			VStack(alignment: .leading, spacing: 2) {
				Text(sender)
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
				Text(item.title)
					.font(.system(size: 12))
					.foregroundStyle(AppTheme.secondaryText)
					.lineLimit(1)
			}
			Spacer()
			if let day = DashboardFormat.shortWeekday(item.timestamp) {
				Text(day)
					.font(.system(size: 12))
					.foregroundStyle(AppTheme.tertiaryText)
			}
		}
		.padding(.vertical, 7)
	}
}

private struct AvatarCircle: View {
	let name: String

	private var initial: String {
		String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
	}

	var body: some View {
		Circle()
			.fill(AppTheme.elevatedBackground)
			.frame(width: 28, height: 28)
			.overlay(
				Text(initial)
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(AppTheme.secondaryText)
			)
	}
}

// MARK: - Tasks card

struct TasksCard: View {
	let summary: DashboardCategorySummary?
	let onAddTask: () -> Void

	private var taskItems: [DashboardItem] {
		Array((summary?.items ?? []).prefix(5))
	}

	private func source(
		for item: DashboardItem,
		in summary: DashboardCategorySummary
	) -> DashboardProviderSummary? {
		guard let provider = item.providerName else { return nil }
		return summary.sources.first { $0.providerName == provider }
	}

	private func sourceIconURL(
		for item: DashboardItem,
		in summary: DashboardCategorySummary
	) -> URL? {
		guard let icon = source(for: item, in: summary)?.iconUrl else { return nil }
		return URL(string: ConfigReader.baseURL().absoluteString + icon)
	}

	private func sourceName(
		for item: DashboardItem,
		in summary: DashboardCategorySummary
	) -> String? {
		source(for: item, in: summary)?.providerDisplayName
	}

	private func sourceLaunchURL(
		for item: DashboardItem,
		in summary: DashboardCategorySummary
	) -> URL? {
		guard let launch = source(for: item, in: summary)?.launchUrl else { return nil }
		return URL(string: launch)
	}

	var body: some View {
		DashboardCard {
			CardHeader(
				systemImage: "checklist",
				iconColor: AppTheme.accent,
				title: "Tasks",
				badgeValue: "\(summary?.count ?? 0)",
				badgeLabel: "open"
			)

			if let summary, summary.count > 0, !taskItems.isEmpty {
				VStack(spacing: 0) {
					ForEach(taskItems) { item in
						TaskRow(
							item: item,
							sourceIconURL: sourceIconURL(for: item, in: summary),
							sourceName: sourceName(for: item, in: summary),
							sourceLaunchURL: sourceLaunchURL(for: item, in: summary)
						)
					}
				}
				.padding(.top, 12)

				DashboardLinkButton(title: "Add a task", action: onAddTask)
					.padding(.top, 14)
			} else {
				DashboardEmptyState(
					message: summary == nil
						? "Connect a task provider to see open tasks."
						: "No open tasks. Nicely done."
				)
				.padding(.top, 18)

				DashboardLinkButton(title: "Add a task", action: onAddTask)
					.padding(.top, 14)
			}
		}
		.accessibilityIdentifier("dashboard-tasks-card")
	}
}

private struct TaskRow: View {
	let item: DashboardItem
	let sourceIconURL: URL?
	let sourceName: String?
	let sourceLaunchURL: URL?

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			Image(systemName: "circle")
				.font(.system(size: 15))
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.top, 1)
			VStack(alignment: .leading, spacing: 2) {
				Text(item.title)
					.font(.system(size: 13, weight: .medium))
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(2)
				let due = DashboardFormat.dueText(item.timestamp)
				Text(due.text)
					.font(.system(size: 12))
					.foregroundStyle(due.color)
			}
			Spacer()
			if let sourceIconURL {
				sourceIcon(url: sourceIconURL)
			}
		}
		.padding(.vertical, 7)
	}

	@ViewBuilder
	private func sourceIcon(url: URL) -> some View {
		let icon = SidebarIconView(
			url: url,
			fallbackSystemName: "checklist",
			isSelected: true
		)
		.frame(width: 16, height: 16)
		.padding(.top, 1)

		if let sourceLaunchURL {
			Button {
				NSWorkspace.shared.open(sourceLaunchURL)
			} label: {
				icon
			}
			.buttonStyle(.plain)
			.help(sourceName.map { "Open in \($0)" } ?? "")
			.accessibilityLabel(sourceName.map { "Open in \($0)" } ?? "Open task source")
		} else {
			icon
				.help(sourceName ?? "")
				.accessibilityLabel(sourceName ?? "Task source")
		}
	}
}

// MARK: - Shared helpers

/// A compact stat tile for the dashboard metrics row (recordings, skills,
/// schedules, memories). Tapping navigates to the related area.
struct DashboardMetric: Identifiable {
	let route: DetailRoute
	let count: Int
	let label: String
	let systemImage: String
	var id: String { route.rawValue }
}

struct DashboardMetricTile: View {
	let metric: DashboardMetric
	let action: () -> Void

	@State private var isHovered = false

	var body: some View {
		Button(action: action) {
			VStack(alignment: .leading, spacing: 8) {
				Image(systemName: metric.systemImage)
					.font(.system(size: 15, weight: .semibold))
					.foregroundStyle(AppTheme.accent)
				Text("\(metric.count)")
					.font(.system(size: 22, weight: .bold))
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
				Text(metric.label)
					.font(.system(size: 12))
					.foregroundStyle(AppTheme.secondaryText)
					.lineLimit(1)
			}
			.frame(maxWidth: .infinity, alignment: .topLeading)
			.padding(14)
			.background(
				RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
					.fill(AppTheme.panelBackground)
			)
			.overlay(
				RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
					.stroke(AppTheme.separator, lineWidth: 1)
			)
			.overlay(
				RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
					.fill(AppTheme.accent.opacity(isHovered ? 0.08 : 0))
			)
		}
		.buttonStyle(.plain)
		.onHover { isHovered = $0 }
		.accessibilityLabel("\(metric.count) \(metric.label)")
		.accessibilityHint("Open \(metric.label)")
	}
}

struct DashboardEmptyState: View {
	let message: String

	var body: some View {
		Text(message)
			.font(.system(size: 13))
			.foregroundStyle(AppTheme.tertiaryText)
			.frame(maxWidth: .infinity, alignment: .leading)
	}
}

enum DashboardFormat {
	static func shortWeekday(_ raw: String?) -> String? {
		guard let date = DashboardDate.parse(raw) else { return nil }
		let formatter = DateFormatter()
		formatter.dateFormat = "EEE"
		return formatter.string(from: date)
	}

	static func dueText(_ raw: String?) -> (text: String, color: Color) {
		guard let date = DashboardDate.parse(raw) else {
			return ("No due date", AppTheme.tertiaryText)
		}
		let calendar = Calendar.current
		let today = calendar.startOfDay(for: Date())
		let dueDay = calendar.startOfDay(for: date)
		let days = calendar.dateComponents([.day], from: today, to: dueDay).day ?? 0
		if days < 0 {
			return ("Overdue", Color(red: 0.90, green: 0.35, blue: 0.35))
		}
		if days == 0 {
			return ("Due today", AppTheme.accent)
		}
		if days == 1 {
			return ("Due tomorrow", AppTheme.accent)
		}
		let formatter = DateFormatter()
		formatter.dateFormat = "MMM d"
		return ("Due \(formatter.string(from: date))", AppTheme.secondaryText)
	}
}

// MARK: - Flow layout

struct FlowLayout: Layout {
	var spacing: CGFloat = 6

	func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize {
		let maxWidth = proposal.width ?? .infinity
		var rowWidth: CGFloat = 0
		var rowHeight: CGFloat = 0
		var totalHeight: CGFloat = 0
		var totalWidth: CGFloat = 0

		for subview in subviews {
			let size = subview.sizeThatFits(.unspecified)
			if rowWidth + size.width > maxWidth, rowWidth > 0 {
				totalWidth = max(totalWidth, rowWidth - spacing)
				totalHeight += rowHeight + spacing
				rowWidth = 0
				rowHeight = 0
			}
			rowWidth += size.width + spacing
			rowHeight = max(rowHeight, size.height)
		}
		totalWidth = max(totalWidth, rowWidth - spacing)
		totalHeight += rowHeight
		return CGSize(width: min(totalWidth, maxWidth), height: totalHeight)
	}

	func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {
		var x = bounds.minX
		var y = bounds.minY
		var rowHeight: CGFloat = 0

		for subview in subviews {
			let size = subview.sizeThatFits(.unspecified)
			if x + size.width > bounds.maxX, x > bounds.minX {
				x = bounds.minX
				y += rowHeight + spacing
				rowHeight = 0
			}
			subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
			x += size.width + spacing
			rowHeight = max(rowHeight, size.height)
		}
	}
}
