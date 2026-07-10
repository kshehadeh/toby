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

private struct CardHeader<Trailing: View>: View {
	let systemImage: String?
	let iconColor: Color
	let title: String
	var titleSize: CGFloat = 14
	let badgeValue: String
	let badgeLabel: String
	@ViewBuilder let trailing: () -> Trailing

	var body: some View {
		HStack(spacing: 8) {
			if let systemImage {
				Image(systemName: systemImage)
					.font(.system(size: 14, weight: .semibold))
					.foregroundStyle(iconColor)
			}
			Text(title)
				.font(.system(size: titleSize, weight: .semibold))
				.foregroundStyle(AppTheme.primaryText)
			Spacer(minLength: 0)
			HStack(spacing: 4) {
				Text(badgeValue)
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(AppTheme.primaryText)
				Text(badgeLabel)
					.font(.system(size: 13))
					.foregroundStyle(AppTheme.secondaryText)
			}
			trailing()
		}
	}
}

/// Small refresh icon button that rotates only while actively refreshing
/// and is clickable to force a refresh when idle.
struct CardRefreshButton: View {
	let isRefreshing: Bool
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			if isRefreshing {
				TimelineView(.animation) { context in
					let t = context.date.timeIntervalSinceReferenceDate
					let angle = (t.truncatingRemainder(dividingBy: 0.8) / 0.8) * 360
					Image(systemName: "arrow.clockwise")
						.font(.system(size: 12, weight: .semibold))
						.foregroundStyle(AppTheme.tertiaryText)
						.rotationEffect(.degrees(angle))
				}
			} else {
				Image(systemName: "arrow.clockwise")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(AppTheme.tertiaryText)
			}
		}
		.buttonStyle(.plain)
		.disabled(isRefreshing)
		.help(isRefreshing ? "Refreshing..." : "Refresh")
		.accessibilityLabel("Refresh")
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

// MARK: - Summary skeleton

/// Pulsing placeholder lines shown while an AI summary is being generated.
struct SummarySkeletonView: View {
	@State private var pulse = false

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			ForEach(0..<4, id: \.self) { index in
				RoundedRectangle(cornerRadius: 4)
					.fill(AppTheme.elevatedBackground)
					.frame(maxWidth: .infinity)
					.frame(height: 12)
					.opacity(pulse ? 0.5 : 0.9)
			}
		}
		.animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: pulse)
		.onAppear { pulse = true }
		.accessibilityIdentifier("dashboard-summary-skeleton")
	}
}

// MARK: - Unread mail card

struct UnreadMailCard: View {
	let summary: DashboardCategorySummary?
	let aiSummary: DashboardCategoryAiSummary?
	let isSummaryLoading: Bool
	let summaryError: String?
	let isRefreshing: Bool
	let onRefresh: () -> Void
	let onSummarize: () -> Void

	private let chipPalette: [Color] = [
		Color(red: 0.90, green: 0.35, blue: 0.35),
		Color(red: 0.96, green: 0.62, blue: 0.12),
		Color(red: 0.35, green: 0.68, blue: 1),
		Color(red: 0.55, green: 0.60, blue: 0.68),
		Color(red: 0.55, green: 0.60, blue: 0.68),
	]

	var body: some View {
		DashboardCard {
			// Leading inset keeps the title clear of the corner icon.
			CardHeader(
				systemImage: nil,
				iconColor: AppTheme.accent,
				title: "Unread mail",
				titleSize: 18,
				badgeValue: "\(summary?.count ?? 0)",
				badgeLabel: "unread"
			) {
				CardRefreshButton(isRefreshing: isRefreshing, action: onRefresh)
			}
			.padding(.leading, 40)

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

				summaryContent
					.padding(.top, 14)

				HStack(spacing: 16) {
					DashboardLinkButton(title: "Open Mail", action: openMail)
					DashboardLinkButton(title: "Summarize all in chat", action: onSummarize)
				}
				.padding(.top, 16)
			} else {
				DashboardEmptyState(
					message: summary == nil
						? "No email found. Connect an email account to see unread mail."
						: "You're all caught up. No unread mail."
				)
				.padding(.top, 18)

				DashboardLinkButton(title: "Open Mail", action: openMail)
					.padding(.top, 14)
			}
		}
		.overlay(alignment: .topLeading) {
			// Large decorative stamp that straddles the card border.
			Image(systemName: "envelope.fill")
				.font(.system(size: 54, weight: .semibold))
				.symbolRenderingMode(.hierarchical)
				.foregroundStyle(AppTheme.accent)
				.rotationEffect(.degrees(-30))
				.shadow(color: .black.opacity(0.4), radius: 10, x: 1, y: 3)
				.offset(x: -16, y: -20)
				.allowsHitTesting(false)
				.accessibilityHidden(true)
		}
		// Room so the overhanging icon isn't clipped by the scroll view.
		.padding(.top, 22)
		.padding(.leading, 18)
		.accessibilityIdentifier("dashboard-mail-card")
	}

	@ViewBuilder
	private var summaryContent: some View {
		if let aiSummary {
			MarkdownText(
				text: aiSummary.text,
				font: .system(size: 13),
				foregroundStyle: AppTheme.primaryText
			)
		} else if isSummaryLoading {
			SummarySkeletonView()
		} else if let summaryError {
			DashboardEmptyState(message: "Summary unavailable. \(summaryError)")
		} else {
			DashboardEmptyState(message: "No summary available.")
		}
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

// MARK: - Tasks card

struct TasksCard: View {
	let summary: DashboardCategorySummary?
	let aiSummary: DashboardCategoryAiSummary?
	let isSummaryLoading: Bool
	let summaryError: String?
	let isRefreshing: Bool
	let onRefresh: () -> Void
	let onAddTask: () -> Void

	var body: some View {
		DashboardCard {
			// Leading inset keeps the title clear of the corner icon.
			CardHeader(
				systemImage: nil,
				iconColor: AppTheme.accent,
				title: "Tasks",
				titleSize: 18,
				badgeValue: "\(summary?.count ?? 0)",
				badgeLabel: "open"
			) {
				CardRefreshButton(isRefreshing: isRefreshing, action: onRefresh)
			}
			.padding(.leading, 40)

			if let summary, summary.count > 0 {
				summaryContent
					.padding(.top, 12)

				HStack(spacing: 16) {
					DashboardLinkButton(title: "Add a task", action: onAddTask)
					ForEach(summary.sources.indices, id: \.self) { idx in
						let source = summary.sources[idx]
						if let launch = source.launchUrl, let url = URL(string: launch) {
							DashboardLinkButton(title: "Open \(source.providerDisplayName)") {
								NSWorkspace.shared.open(url)
							}
						}
					}
				}
				.padding(.top, 14)
			} else {
				DashboardEmptyState(
					message: summary == nil
						? "No tasks found. Connect a task provider to see open tasks."
						: "No open tasks. Nicely done."
				)
				.padding(.top, 18)

				DashboardLinkButton(title: "Add a task", action: onAddTask)
					.padding(.top, 14)
			}
		}
		.overlay(alignment: .topLeading) {
			// Large decorative stamp that straddles the card border.
			Image(systemName: "checklist")
				.font(.system(size: 54, weight: .semibold))
				.symbolRenderingMode(.hierarchical)
				.foregroundStyle(AppTheme.accent)
				.rotationEffect(.degrees(-30))
				.shadow(color: .black.opacity(0.4), radius: 10, x: 1, y: 3)
				.offset(x: -16, y: -20)
				.allowsHitTesting(false)
				.accessibilityHidden(true)
		}
		// Room so the overhanging icon isn't clipped by the scroll view.
		.padding(.top, 22)
		.padding(.leading, 18)
		.accessibilityIdentifier("dashboard-tasks-card")
	}

	@ViewBuilder
	private var summaryContent: some View {
		if let aiSummary {
			MarkdownText(
				text: aiSummary.text,
				font: .system(size: 13),
				foregroundStyle: AppTheme.primaryText
			)
		} else if isSummaryLoading {
			SummarySkeletonView()
		} else if let summaryError {
			DashboardEmptyState(message: "Summary unavailable. \(summaryError)")
		} else {
			DashboardEmptyState(message: "No summary available.")
		}
	}
}

// MARK: - Shared helpers

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
