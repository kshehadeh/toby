import AppKit
import SwiftUI

// MARK: - Card container

/// Whether a dashboard card body may accept content interaction (text
/// selection, etc.). Read by the markdown views; Home cards always leave it on.
private struct DashboardCardBodyInteractiveKey: EnvironmentKey {
	static let defaultValue = true
}

extension EnvironmentValues {
	var dashboardCardBodyInteractive: Bool {
		get { self[DashboardCardBodyInteractiveKey.self] }
		set { self[DashboardCardBodyInteractiveKey.self] = newValue }
	}
}

/// Home content panel (used by The Feed).
///
/// Always lays out at its full intrinsic height; the Home `ScrollView` scrolls
/// to reach content past the window.
struct DashboardCard<Content: View>: View {
	/// SF Symbol used as the lower-right ghost glyph.
	var systemImage: String? = nil
	/// When true, the quiet hairline is replaced by the AI rainbow outline.
	var isUpdating: Bool = false
	@ViewBuilder private let content: () -> Content

	init(
		systemImage: String? = nil,
		isUpdating: Bool = false,
		@ViewBuilder content: @escaping () -> Content
	) {
		self.systemImage = systemImage
		self.isUpdating = isUpdating
		self.content = content
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			content()
		}
		.frame(maxWidth: .infinity, alignment: .topLeading)
		.padding(DashboardBlockLayout.cardPadding)
		.fixedSize(horizontal: false, vertical: true)
		.dashboardBlockChrome(systemImage: systemImage, isUpdating: isUpdating)
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
	@Environment(\.dashboardIsEditing) private var isEditing
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
			if let lastRanAtText, !isEditing {
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
struct CardHeaderTrailingControls<MenuContent: View>: View {
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

// MARK: - Shared helpers

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

