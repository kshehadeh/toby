import AppKit
import SwiftUI

// MARK: - Card container

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
	@Environment(\.dashboardIsEditing) private var isEditing

	/// SF Symbol used as the lower-right ghost glyph.
	var systemImage: String? = nil
	/// When true, the quiet hairline is replaced by the AI rainbow outline.
	var isUpdating: Bool = false
	@ViewBuilder private let content: () -> Content

	@State private var isExpanded = false
	@State private var isPointerInside = false
	@State private var intrinsicContentHeight: CGFloat = 0
	/// Ignores the hover-exit that fires when the “Show more” control is removed
	/// from under the cursor right after expand (would otherwise flash-collapse).
	@State private var suppressHoverCollapse = false

	init(
		systemImage: String? = nil,
		isUpdating: Bool = false,
		@ViewBuilder content: @escaping () -> Content
	) {
		self.systemImage = systemImage
		self.isUpdating = isUpdating
		self.content = content
	}

	/// Content taller than the fixed collapsed card needs “Show more”.
	private var isOverflowing: Bool {
		intrinsicContentHeight > DashboardBlockLayout.maximumCollapsedHeight + 0.5
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
				maxHeight: isExpanded ? nil : DashboardBlockLayout.maximumCollapsedHeight,
				alignment: .topLeading
			)
			.frame(
				// Short cards stay intrinsic; overflowing cards stop at the cap.
				maxHeight: isExpanded ? .infinity : DashboardBlockLayout.maximumCollapsedHeight,
				alignment: .top
			)
			.fixedSize(horizontal: false, vertical: isExpanded)
			// Clip drawing + hit testing so clipped subviews cannot grow out of band.
			.contentShape(Rectangle())
			.clipped()
			.overlay(alignment: .bottom) {
				if !isEditing, !isExpanded, isOverflowing {
					showMoreChrome
				}
			}
			.dashboardBlockChrome(
				systemImage: systemImage,
				isExpanded: isExpanded,
				isUpdating: isUpdating
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
			.onChange(of: isEditing) { _, editing in
				if editing {
					isExpanded = false
				}
			}
			.onHover { hovering in
				isPointerInside = hovering
				guard !isEditing, isExpanded, !hovering else { return }
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
		.padding(DashboardBlockLayout.cardPadding)
	}

	/// Fade + control overlaid on the card’s lower border (out of content flow).
	private var showMoreChrome: some View {
		VStack(spacing: 0) {
			LinearGradient(
				colors: [
					AppTheme.contentBackground.opacity(0),
					AppTheme.contentBackground,
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
			.background(AppTheme.contentBackground)
			.accessibilityLabel("Show more")
			.accessibilityIdentifier("dashboard-card-show-more")
			.help("Expand this card. Move the pointer away to collapse.")
		}
		.frame(maxWidth: .infinity)
		// Overlay must not expand the card’s layout height.
		.fixedSize(horizontal: false, vertical: true)
	}

	private func expandFromShowMore() {
		guard !isEditing else { return }
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
/// Serif body matches assistant answers so anything Toby wrote reads in Toby’s voice.
enum DashboardSummaryMarkdown {
	static let bodyFont: Font = .system(size: 13)
	static let bodyLineSpacing: CGFloat = 4
	/// Slightly muted body copy; bold spans use pure theme primary.
	static let bodyColor = AppTheme.secondaryText
	static let strongColor = AppTheme.primaryText
	/// Section headings (h1–h3): muted, rendered uppercase by MarkdownText.
	static let headingColor = AppTheme.tertiaryText
}

/// Static header chrome: title, optional last-run timestamp, trailing actions.
struct CardHeader<Trailing: View>: View {
	let title: String
	let systemImage: String
	/// Short date + HH:mm when the block flow last produced content.
	var lastRanAtText: String? = nil
	@ViewBuilder let trailing: () -> Trailing

	var body: some View {
		HStack(alignment: .firstTextBaseline, spacing: 10) {
			Image(systemName: systemImage)
				.font(.system(size: 14, weight: .medium))
				.foregroundStyle(AppTheme.primaryText)
				.accessibilityHidden(true)
			Text(title)
				.font(.system(size: DashboardBlockLayout.titleSize, weight: DashboardBlockLayout.titleWeight))
				.tracking(DashboardBlockLayout.titleTracking)
				.foregroundStyle(AppTheme.primaryText)
				.lineLimit(1)
			Spacer(minLength: 0)
			if let lastRanAtText {
				Text(lastRanAtText)
					.font(.system(size: 11, weight: .medium))
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
					.help("Last updated \(lastRanAtText)")
					.accessibilityLabel("Last updated \(lastRanAtText)")
			}
			trailing()
		}
		.padding(.bottom, DashboardBlockLayout.headerSpacing)
		.overlay(alignment: .bottom) {
			Divider().overlay(AppTheme.separator)
		}
		.padding(.bottom, 12)
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
	@Environment(\.dashboardIsEditing) private var isEditing
	let isRefreshing: Bool
	let onRefresh: () -> Void
	@ViewBuilder let menuContent: () -> MenuContent

	var body: some View {
		if isEditing {
			EmptyView()
		} else {
			HStack(spacing: 2) {
				CardRefreshButton(isRefreshing: isRefreshing, action: onRefresh)
				CardActionsMenu(content: menuContent)
			}
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

// MARK: - Generic data-block card

/// One home-dashboard card: definition-owned static header + flow-output body.
struct DashboardBlockCard: View {
	@Bindable var block: CategoryDashboardBlock
	var actionContext: DashboardBlockActionContext = .init()
	/// Opens guided news setup when the News card has no connected account.
	var onSetupNews: () -> Void = {}

	private var actions: [DashboardBlockAction] { block.actions(context: actionContext) }
	private var content: DashboardBlockContent? { block.content }

	/// Skeleton while loading with no body yet (including force refresh).
	private var showContentSkeleton: Bool {
		block.isUpdating && !(content?.hasBody ?? false)
	}

	var body: some View {
		DashboardCard(systemImage: block.systemImage, isUpdating: block.isUpdating) {
			CardHeader(
				title: block.title,
				systemImage: block.systemImage,
				lastRanAtText: DashboardFormat.flowRanAtText(content?.generatedAt)
			) {
				CardHeaderTrailingControls(
					isRefreshing: block.isUpdating,
					onRefresh: { Task { await block.update(force: true) } }
				) {
					ForEach(actions) { action in
						Button(action.title, action: action.perform)
							.disabled(!action.isEnabled)
					}
				}
			}

			bodyContent
		}
		.accessibilityIdentifier(block.accessibilityIdentifier)
		.accessibilityValue(block.isUpdating ? "Updating" : "")
	}

	@ViewBuilder
	private var bodyContent: some View {
		if showContentSkeleton {
			SummarySkeletonView()
		} else if let content, content.hasBody {
			if let sections = content.resolvedSections, !sections.isEmpty {
				DashboardStructuredContent(sections: sections)
			} else {
				MarkdownText(
					text: content.text,
					font: DashboardSummaryMarkdown.bodyFont,
					foregroundStyle: DashboardSummaryMarkdown.bodyColor,
					strongForegroundStyle: DashboardSummaryMarkdown.strongColor,
					headingForegroundStyle: DashboardSummaryMarkdown.headingColor,
					uppercaseHeadings: true
				)
				.lineSpacing(DashboardSummaryMarkdown.bodyLineSpacing)
			}
		} else if let error = block.error {
			DashboardEmptyState(message: "Content unavailable. \(error)")
		} else if content == nil {
			if block.id == .news {
				DashboardSetupPrompt(
					message: block.descriptor.emptyWhenNil,
					buttonTitle: "Set up News",
					accessibilityIdentifier: "dashboard-news-setup-button",
					action: onSetupNews
				)
			} else {
				DashboardEmptyState(message: block.descriptor.emptyWhenNil)
			}
		} else {
			// Connected / loaded but zero items or empty markdown.
			DashboardEmptyState(message: block.descriptor.emptyWhenZero)
		}
	}
}

private struct DashboardStructuredContent: View {
	let sections: [DashboardBlockContentSection]

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			ForEach(Array(sections.enumerated()), id: \.element.id) { index, section in
				if index > 0 {
					Divider()
						.overlay(AppTheme.separator)
						.padding(.vertical, 12)
				}
				DashboardStructuredSection(section: section)
			}
		}
		.accessibilityIdentifier("dashboard-structured-content")
	}
}

private struct DashboardStructuredSection: View {
	let section: DashboardBlockContentSection

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			if let eyebrow = section.eyebrow {
				Text(eyebrow.uppercased())
					.font(.system(size: 10, weight: .semibold))
					.tracking(0.7)
					.foregroundStyle(AppTheme.tertiaryText)
			}
			if let title = section.title {
				Text(title)
					.font(.system(size: 17, weight: .semibold))
					.foregroundStyle(AppTheme.primaryText)
					.fixedSize(horizontal: false, vertical: true)
			}
			if let body = section.body {
				MarkdownText(
					text: body,
					font: DashboardSummaryMarkdown.bodyFont,
					foregroundStyle: DashboardSummaryMarkdown.bodyColor,
					strongForegroundStyle: DashboardSummaryMarkdown.strongColor,
					headingForegroundStyle: DashboardSummaryMarkdown.headingColor
				)
				.lineSpacing(4)
			}
			if !section.items.isEmpty {
				VStack(alignment: .leading, spacing: 0) {
					ForEach(Array(section.items.enumerated()), id: \.offset) { index, item in
						if index > 0 {
							Divider().overlay(AppTheme.separator)
						}
						DashboardStructuredItemRow(item: item)
					}
				}
				.padding(.top, 4)
			}
		}
	}
}

private struct DashboardStructuredItemRow: View {
	let item: DashboardBlockContentItem

	var body: some View {
		Group {
			if let rawURL = item.url, let url = URL(string: rawURL) {
				Link(destination: url) { rowContent(showsChevron: true) }
					.buttonStyle(.plain)
			} else {
				rowContent(showsChevron: false)
			}
		}
		.accessibilityElement(children: .combine)
	}

	private func rowContent(showsChevron: Bool) -> some View {
		HStack(spacing: 10) {
			VStack(alignment: .leading, spacing: 2) {
				Text(item.title)
					.font(.system(size: 13, weight: .medium))
					.foregroundStyle(AppTheme.primaryText)
					.fixedSize(horizontal: false, vertical: true)
				if let subtitle = item.subtitle {
					Text(subtitle)
						.font(.system(size: 11))
						.foregroundStyle(AppTheme.secondaryText)
						.lineLimit(2)
				}
			}
			Spacer(minLength: 0)
			if showsChevron {
				Image(systemName: "chevron.right")
					.font(.system(size: 10, weight: .semibold))
					.foregroundStyle(AppTheme.tertiaryText)
					.accessibilityHidden(true)
			}
		}
		.padding(.vertical, 9)
		.contentShape(Rectangle())
	}
}

// MARK: - Shared helpers

struct DashboardSetupPrompt: View {
	let message: String
	let buttonTitle: String
	let accessibilityIdentifier: String
	let action: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			DashboardEmptyState(message: message)
			Button(buttonTitle, action: action)
				.buttonStyle(.borderedProminent)
				.controlSize(.small)
				.accessibilityIdentifier(accessibilityIdentifier)
		}
	}
}

struct DashboardEmptyState: View {
	let message: String

	var body: some View {
		Text(message)
			.font(DashboardSummaryMarkdown.bodyFont)
			.foregroundStyle(AppTheme.tertiaryText)
			.lineSpacing(DashboardSummaryMarkdown.bodyLineSpacing)
			.frame(maxWidth: .infinity, alignment: .leading)
	}
}

enum DashboardFormat {
	/// Locale short date + 24h `HH:mm` for when a block flow last ran.
	/// Returns `nil` when the ISO timestamp cannot be parsed.
	static func flowRanAtText(_ raw: String?) -> String? {
		guard let date = DashboardDate.parse(raw) else { return nil }
		let datePart = DateFormatter()
		datePart.dateStyle = .short
		datePart.timeStyle = .none
		// `HH` is always 24-hour (Unicode pattern), independent of 12h locale prefs.
		let timePart = DateFormatter()
		timePart.dateFormat = "HH:mm"
		return "\(datePart.string(from: date)) \(timePart.string(from: date))"
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


