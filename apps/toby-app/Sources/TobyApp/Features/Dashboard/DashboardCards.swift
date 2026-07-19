import AppKit
import SwiftUI

// MARK: - Card container

/// Shared layout tokens for equal-height non-onboarding dashboard blocks.
enum DashboardBlockLayout {
	/// Collapsed height for mail / tasks / calendar cards (aligned in a row).
	static let collapsedHeight: CGFloat = 340
	/// Soft fade over clipped body text (fully opaque at the bottom of the fade).
	/// Drawn as an overlay; does not reserve layout space inside the body.
	static let showMoreFadeHeight: CGFloat = 40
	/// Solid control bar under the fade, overlaid on the card’s lower edge.
	static let showMoreButtonHeight: CGFloat = 36
	static var showMoreChromeHeight: CGFloat {
		showMoreFadeHeight + showMoreButtonHeight
	}
}

private struct DashboardCardContentHeightKey: PreferenceKey {
	static let defaultValue: CGFloat = 0
	static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
		value = max(value, nextValue())
	}
}

/// Whether a dashboard card body may accept content interaction (text selection,
/// etc.). Collapsed cards set this to `false` so clicking a markdown sub-block
/// cannot expand/reflow clipped text in place — only “Show more” grows the card.
private struct DashboardCardBodyInteractiveKey: EnvironmentKey {
	static let defaultValue = true
}

extension EnvironmentValues {
	var dashboardCardBodyInteractive: Bool {
		get { self[DashboardCardBodyInteractiveKey.self] }
		set { self[DashboardCardBodyInteractiveKey.self] = newValue }
	}
}

/// Equal-height dashboard block with overflow “Show more”.
///
/// Collapsed height is shared across mail / tasks / calendar so a row of cards
/// aligns. Expanding grows the card **in layout** so siblings are not covered
/// and the parent ScrollView can scroll to the full content. Hovering away
/// collapses it again.
///
/// Only the “Show more” control expands a collapsed card. Body copy is
/// non-interactive while collapsed so sub-blocks cannot grow text in place.
struct DashboardCard<Content: View>: View {
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	@ViewBuilder private let content: () -> Content

	@State private var isExpanded = false
	@State private var isPointerInside = false
	@State private var intrinsicContentHeight: CGFloat = 0
	/// Ignores the hover-exit that fires when the “Show more” control is removed
	/// from under the cursor right after expand (would otherwise flash-collapse).
	@State private var suppressHoverCollapse = false

	init(@ViewBuilder content: @escaping () -> Content) {
		self.content = content
	}

	/// Content taller than the fixed collapsed card needs “Show more”.
	private var isOverflowing: Bool {
		intrinsicContentHeight > DashboardBlockLayout.collapsedHeight + 0.5
	}

	private var motion: Animation? {
		reduceMotion ? nil : DashboardSectionMotion.animation
	}

	var body: some View {
		// Body is a fixed-height clipped band when collapsed. “Show more” is a
		// true overlay on the lower edge (not a layout sibling), so long content
		// cannot push the control below the card and out of view.
		cardBody
			// Header controls (refresh / menu) stay tappable; summary markdown
			// respects `dashboardCardBodyInteractive` and is inert while clipped.
			// Fully-visible (non-overflowing) bodies stay interactive.
			.environment(
				\.dashboardCardBodyInteractive,
				isExpanded || !isOverflowing
			)
			.frame(maxWidth: .infinity, alignment: .topLeading)
			.frame(
				maxHeight: isExpanded ? nil : DashboardBlockLayout.collapsedHeight,
				alignment: .topLeading
			)
			.frame(
				minHeight: DashboardBlockLayout.collapsedHeight,
				// Collapsed: fixed height. Expanded: grow with content (ScrollView can scroll).
				maxHeight: isExpanded ? .infinity : DashboardBlockLayout.collapsedHeight,
				alignment: .top
			)
			.fixedSize(horizontal: false, vertical: isExpanded)
			// Clip drawing + hit testing so clipped subviews cannot grow out of band.
			.contentShape(Rectangle())
			.clipped()
			.overlay(alignment: .bottom) {
				if !isExpanded, isOverflowing {
					showMoreChrome
				}
			}
			.background(
				RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
					.fill(AppTheme.panelBackground)
			)
			.overlay(
				RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
					.stroke(AppTheme.separator, lineWidth: 1)
			)
			.clipShape(RoundedRectangle(cornerRadius: AppTheme.cornerRadius))
			.shadow(
				color: isExpanded ? Color.black.opacity(0.18) : .clear,
				radius: isExpanded ? 12 : 0,
				x: 0,
				y: isExpanded ? 6 : 0
			)
			// Hidden unconstrained pass measures full content height for overflow.
			// Non-interactive so it never steals hits or selection from the real body.
			.background(alignment: .top) {
				cardBody
					.environment(\.dashboardCardBodyInteractive, false)
					.fixedSize(horizontal: false, vertical: true)
					.hidden()
					.allowsHitTesting(false)
					.background(
						GeometryReader { geo in
							Color.clear.preference(
								key: DashboardCardContentHeightKey.self,
								value: geo.size.height
							)
						}
					)
			}
			.onPreferenceChange(DashboardCardContentHeightKey.self) { height in
				intrinsicContentHeight = height
			}
			.onHover { hovering in
				isPointerInside = hovering
				guard isExpanded, !hovering else { return }
				// Clicking “Show more” removes the button under the cursor and
				// delivers a spurious hover-exit — ignore that until the pointer
				// has settled or left and re-entered.
				if suppressHoverCollapse { return }
				withAnimation(motion) {
					isExpanded = false
				}
			}
			.animation(motion, value: isExpanded)
			.accessibilityIdentifier(
				isExpanded ? "dashboard-card-expanded" : "dashboard-card-collapsed"
			)
	}

	private var cardBody: some View {
		VStack(alignment: .leading, spacing: 0) {
			content()
		}
		.frame(maxWidth: .infinity, alignment: .topLeading)
		.padding(22)
	}

	/// Fade + control overlaid on the card’s lower border (out of content flow).
	private var showMoreChrome: some View {
		VStack(spacing: 0) {
			LinearGradient(
				colors: [
					AppTheme.panelBackground.opacity(0),
					AppTheme.panelBackground,
				],
				startPoint: .top,
				endPoint: .bottom
			)
			.frame(height: DashboardBlockLayout.showMoreFadeHeight)
			.allowsHitTesting(false)

			Button {
				expandFromShowMore()
			} label: {
				Text("Show more")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(AppTheme.accent)
					.frame(maxWidth: .infinity)
					.frame(height: DashboardBlockLayout.showMoreButtonHeight)
					.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.background(AppTheme.panelBackground)
			.accessibilityLabel("Show more")
			.accessibilityIdentifier("dashboard-card-show-more")
			.help("Expand this card. Move the pointer away to collapse.")
		}
		.frame(maxWidth: .infinity)
		// Overlay must not expand the card’s layout height.
		.fixedSize(horizontal: false, vertical: true)
	}

	private func expandFromShowMore() {
		// Clicking “Show more” removes that control under the cursor, which
		// delivers a spurious hover-exit. Ignore hover-collapse briefly.
		suppressHoverCollapse = true
		isPointerInside = true
		withAnimation(motion) {
			isExpanded = true
		}
		Task { @MainActor in
			try? await Task.sleep(for: .milliseconds(400))
			suppressHoverCollapse = false
			// If the pointer already left during the grace window, collapse now.
			if isExpanded, !isPointerInside {
				withAnimation(motion) {
					isExpanded = false
				}
			}
		}
	}
}

/// Shared markdown styling for AI summaries inside dashboard cards.
enum DashboardSummaryMarkdown {
	static let bodyFont: Font = .system(size: 13)
	/// Slightly muted body copy; bold spans use pure theme primary.
	static let bodyColor = AppTheme.secondaryText
	static let strongColor = AppTheme.primaryText
	/// Section headings (h1–h3): muted, rendered uppercase by MarkdownText.
	static let headingColor = AppTheme.tertiaryText
}

private struct CardHeader<Trailing: View>: View {
	let systemImage: String?
	let iconColor: Color
	let title: String
	/// Default ~15% smaller than the previous 18pt card titles.
	var titleSize: CGFloat = 15
	let badgeValue: String
	let badgeLabel: String
	@ViewBuilder let trailing: () -> Trailing

	var body: some View {
		HStack(spacing: 8) {
			if let systemImage {
				Image(systemName: systemImage)
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(iconColor)
			}
			Text(title)
				.font(.system(size: titleSize, weight: .semibold))
				.foregroundStyle(AppTheme.primaryText)
			Spacer(minLength: 0)
			HStack(spacing: 4) {
				Text(badgeValue)
					.font(.system(size: 11, weight: .semibold))
					.foregroundStyle(AppTheme.primaryText)
				Text(badgeLabel)
					.font(.system(size: 11))
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
						.font(.system(size: 10, weight: .semibold))
						.foregroundStyle(AppTheme.tertiaryText)
						.rotationEffect(.degrees(angle))
				}
			} else {
				Image(systemName: "arrow.clockwise")
					.font(.system(size: 10, weight: .semibold))
					.foregroundStyle(AppTheme.tertiaryText)
			}
		}
		.buttonStyle(.plain)
		.disabled(isRefreshing)
		.help(isRefreshing ? "Refreshing..." : "Refresh")
		.accessibilityLabel("Refresh")
	}
}

/// Trailing `…` control that presents card actions in a dropdown menu.
private struct CardActionsMenu<Content: View>: View {
	@ViewBuilder let content: () -> Content

	var body: some View {
		Menu {
			content()
		} label: {
			Image(systemName: "ellipsis")
				.font(.system(size: 11, weight: .semibold))
				.foregroundStyle(AppTheme.tertiaryText)
				.frame(width: 18, height: 18)
				.contentShape(Rectangle())
		}
		.menuStyle(.borderlessButton)
		.menuIndicator(.hidden)
		.help("Actions")
		.accessibilityLabel("Actions")
		.accessibilityIdentifier("dashboard-card-actions-menu")
	}
}

/// Refresh + actions menu for the top-right of a dashboard card header.
private struct CardHeaderTrailingControls<MenuContent: View>: View {
	let isRefreshing: Bool
	let onRefresh: () -> Void
	@ViewBuilder let menuContent: () -> MenuContent

	var body: some View {
		HStack(spacing: 2) {
			CardRefreshButton(isRefreshing: isRefreshing, action: onRefresh)
			CardActionsMenu(content: menuContent)
		}
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

	private var chipPalette: [Color] {
		[
			Color(red: 0.90, green: 0.35, blue: 0.35),
			AppTheme.accent,
			Color(red: 0.35, green: 0.68, blue: 1),
			Color(red: 0.55, green: 0.60, blue: 0.68),
			Color(red: 0.55, green: 0.60, blue: 0.68),
		]
	}

	var body: some View {
		DashboardCard {
			// Leading inset keeps the title clear of the corner icon.
			CardHeader(
				systemImage: nil,
				iconColor: AppTheme.accent,
				title: "Unread mail",
				titleSize: 15,
				badgeValue: "\(summary?.count ?? 0)",
				badgeLabel: "unread"
			) {
				CardHeaderTrailingControls(isRefreshing: isRefreshing, onRefresh: onRefresh) {
					Button("Open Mail", action: openMail)
					if let summary, summary.count > 0 {
						Button("Summarize all in chat", action: onSummarize)
					}
				}
			}
			.padding(.leading, 40)

			Divider()
				.overlay(AppTheme.separator)
				.padding(.top, 14)
				.padding(.bottom, 16)

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
					.padding(.bottom, 14)
				}

				summaryContent
			} else {
				DashboardEmptyState(
					message: summary == nil
						? "No email found. Connect an email account to see unread mail."
						: "You're all caught up. No unread mail."
				)
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
				font: DashboardSummaryMarkdown.bodyFont,
				foregroundStyle: DashboardSummaryMarkdown.bodyColor,
				strongForegroundStyle: DashboardSummaryMarkdown.strongColor,
				headingForegroundStyle: DashboardSummaryMarkdown.headingColor,
				uppercaseHeadings: true
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
				titleSize: 15,
				badgeValue: "\(summary?.count ?? 0)",
				badgeLabel: "open"
			) {
				CardHeaderTrailingControls(isRefreshing: isRefreshing, onRefresh: onRefresh) {
					Button("Add a task", action: onAddTask)
					if let summary {
						ForEach(summary.sources.indices, id: \.self) { idx in
							let source = summary.sources[idx]
							if let launch = source.launchUrl, let url = URL(string: launch) {
								Button("Open \(source.providerDisplayName)") {
									NSWorkspace.shared.open(url)
								}
							}
						}
					}
				}
			}
			.padding(.leading, 40)

			Divider()
				.overlay(AppTheme.separator)
				.padding(.top, 14)
				.padding(.bottom, 16)

			if let summary, summary.count > 0 {
				summaryContent
			} else {
				DashboardEmptyState(
					message: summary == nil
						? "No tasks found. Connect a task provider to see open tasks."
						: "No open tasks. Nicely done."
				)
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
				font: DashboardSummaryMarkdown.bodyFont,
				foregroundStyle: DashboardSummaryMarkdown.bodyColor,
				strongForegroundStyle: DashboardSummaryMarkdown.strongColor,
				headingForegroundStyle: DashboardSummaryMarkdown.headingColor,
				uppercaseHeadings: true
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

// MARK: - Upcoming events card

struct UpcomingEventsCard: View {
	let summary: DashboardCategorySummary?
	let aiSummary: DashboardCategoryAiSummary?
	let isSummaryLoading: Bool
	let summaryError: String?
	let isRefreshing: Bool
	let onRefresh: () -> Void
	let onPlanInChat: () -> Void

	var body: some View {
		DashboardCard {
			// Leading inset keeps the title clear of the corner icon.
			CardHeader(
				systemImage: nil,
				iconColor: AppTheme.accent,
				title: "Upcoming",
				titleSize: 15,
				badgeValue: "\(summary?.count ?? 0)",
				badgeLabel: "events"
			) {
				CardHeaderTrailingControls(isRefreshing: isRefreshing, onRefresh: onRefresh) {
					// Single open action uses the provider launchUrl (see openCalendar).
					// Do not also list per-source "Open Apple Calendar" rows — same target.
					Button("Open Calendar", action: openCalendar)
					Button("Plan in chat", action: onPlanInChat)
				}
			}
			.padding(.leading, 40)

			Divider()
				.overlay(AppTheme.separator)
				.padding(.top, 14)
				.padding(.bottom, 16)

			if let summary, summary.count > 0 {
				summaryContent
			} else {
				DashboardEmptyState(
					message: summary == nil
						? "No events found. Connect a calendar provider to see upcoming events."
						: "Nothing on the calendar for the next 7 days."
				)
			}
		}
		.overlay(alignment: .topLeading) {
			// Large decorative stamp that straddles the card border.
			Image(systemName: "calendar")
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
		.accessibilityIdentifier("dashboard-calendar-card")
	}

	@ViewBuilder
	private var summaryContent: some View {
		if let aiSummary {
			MarkdownText(
				text: aiSummary.text,
				font: DashboardSummaryMarkdown.bodyFont,
				foregroundStyle: DashboardSummaryMarkdown.bodyColor,
				strongForegroundStyle: DashboardSummaryMarkdown.strongColor,
				headingForegroundStyle: DashboardSummaryMarkdown.headingColor,
				uppercaseHeadings: true
			)
		} else if isSummaryLoading {
			SummarySkeletonView()
		} else if let summaryError {
			DashboardEmptyState(message: "Summary unavailable. \(summaryError)")
		} else {
			DashboardEmptyState(message: "No summary available.")
		}
	}

	/// Open the calendar provider app via its plugin-declared `launchUrl`
	/// (same path as email/tasks dashboard sources). Fall back to Calendar.app.
	private func openCalendar() {
		if let launch = summary?.sources.compactMap(\.launchUrl).first,
			let url = URL(string: launch)
		{
			NSWorkspace.shared.open(url)
			return
		}
		// Plugin did not advertise a launch URL — open Calendar.app by bundle id.
		let workspace = NSWorkspace.shared
		if let appURL = workspace.urlForApplication(withBundleIdentifier: "com.apple.iCal") {
			workspace.openApplication(at: appURL, configuration: NSWorkspace.OpenConfiguration())
			return
		}
		if let url = URL(string: "ical://") {
			workspace.open(url)
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
