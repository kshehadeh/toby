import SwiftUI

/// The Feed: a full-width Home section listing what needs attention across
/// connections, grouped by tier, each with a reason and calls to action.
struct FeedCardView: View {
	@Bindable var store: FeedStore
	/// Runs a chat / open action. Dismiss is handled by the store.
	var onPerform: (FeedAction) -> Void = { _ in }
	/// Opens Settings → Home (model setup).
	var onOpenSettings: () -> Void = {}
	/// Hides the section (Settings → Home → Show The Feed).
	var onHide: () -> Void = {}

	static let title = "The Feed"
	static let systemImage = "sparkles.rectangle.stack"

	private var content: FeedContent? { store.content }

	var body: some View {
		DashboardCard(systemImage: Self.systemImage, isUpdating: store.isLoading) {
			CardHeader(
				title: Self.title,
				systemImage: Self.systemImage,
				lastRanAtText: content?.status == .ok
					? DashboardFormat.flowRanAtText(content?.generatedAt)
					: nil
			) {
				CardHeaderTrailingControls(
					isRefreshing: store.isLoading,
					onRefresh: { Task { await store.update(force: true) } }
				) {
					Button("Feed settings…", action: onOpenSettings)
					Divider()
					Button("Hide The Feed", action: onHide)
				}
			}
			FeedCardBody(
				store: store,
				onPerform: onPerform,
				onOpenSettings: onOpenSettings
			)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.accessibilityIdentifier("dashboard-feed")
		.accessibilityValue(store.isLoading ? "Updating" : "")
	}
}

/// Feed body (everything below the header). Separate so it can be tested
/// without `CardHeader`, which ViewInspector can't traverse.
struct FeedCardBody: View {
	@Bindable var store: FeedStore
	var onPerform: (FeedAction) -> Void = { _ in }
	var onOpenSettings: () -> Void = {}

	private var content: FeedContent? { store.content }

	var body: some View {
		if let content, content.status == .setupRequired {
			FeedSetupPrompt(
				message: content.setupReason
					?? "Choose a Feed model that supports structured output.",
				onOpenSettings: onOpenSettings
			)
		} else if let content, content.status == .noSources {
			DashboardEmptyState(
				message: "Connect email, calendar, or a task provider to see what needs your attention."
			)
		} else if let content {
			itemsOrEmpty(content)
		} else if store.isLoading {
			SummarySkeletonView()
		} else if let error = store.error {
			DashboardEmptyState(message: "The Feed is unavailable. \(error)")
		} else {
			SummarySkeletonView()
		}
	}

	@ViewBuilder
	private func itemsOrEmpty(_ content: FeedContent) -> some View {
		let groups = store.groupedItems
		VStack(alignment: .leading, spacing: 14) {
			if content.status == .error {
				Label(
					"Couldn't update The Feed\(content.error.map { ": \($0)" } ?? "."). Showing the last results.",
					systemImage: "exclamationmark.triangle"
				)
				.font(.system(size: 11))
				.foregroundStyle(AppTheme.tertiaryText)
				.accessibilityIdentifier("feed-error-banner")
			}
			if groups.isEmpty {
				DashboardEmptyState(message: "Nothing needs your attention right now.")
			} else {
				ForEach(groups, id: \.tier) { group in
					FeedTierSection(
						tier: group.tier,
						items: group.items,
						onPerform: onPerform,
						onDismiss: { store.dismiss($0) }
					)
				}
			}
		}
	}
}

/// Setup state when no structured-output model is available.
struct FeedSetupPrompt: View {
	let message: String
	let onOpenSettings: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			DashboardEmptyState(message: message)
			Button("Choose a Feed model", action: onOpenSettings)
				.controlSize(.small)
				.accessibilityIdentifier("feed-choose-model")
		}
	}
}

/// One tier heading plus its rows.
struct FeedTierSection: View {
	let tier: FeedTier
	let items: [FeedItem]
	let onPerform: (FeedAction) -> Void
	let onDismiss: (FeedItem) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text(tier.title.uppercased())
				.font(.system(size: 10, weight: .semibold))
				.tracking(0.6)
				.foregroundStyle(AppTheme.tertiaryText)
				.accessibilityAddTraits(.isHeader)
			VStack(spacing: 0) {
				ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
					if index > 0 {
						Divider().overlay(AppTheme.separator)
					}
					FeedItemRow(
						item: item,
						onPerform: onPerform,
						onDismiss: { onDismiss(item) }
					)
				}
			}
		}
		.accessibilityIdentifier("feed-tier-\(tier.rawValue)")
	}
}

/// A Feed row: source icon, title, reason, and calls to action.
struct FeedItemRow: View {
	let item: FeedItem
	let onPerform: (FeedAction) -> Void
	let onDismiss: () -> Void

	private var actions: [FeedAction] { item.performableActions }

	var body: some View {
		HStack(alignment: .top, spacing: 12) {
			Image(systemName: item.systemImage)
				.font(.system(size: 14, weight: .medium))
				.foregroundStyle(AppTheme.secondaryText)
				.frame(width: 20)
				.padding(.top, 1)
				.accessibilityHidden(true)
			VStack(alignment: .leading, spacing: 4) {
				HStack(alignment: .firstTextBaseline, spacing: 8) {
					Text(item.title)
						.font(.system(size: 13, weight: .semibold))
						.foregroundStyle(AppTheme.primaryText)
						.lineLimit(2)
					Spacer(minLength: 0)
					if let when = FeedFormat.relativeTime(item.timestamp) {
						Text(when)
							.font(.system(size: 11))
							.foregroundStyle(AppTheme.tertiaryText)
							.lineLimit(1)
					}
				}
				if let subtitle = item.subtitle, !subtitle.isEmpty {
					Text(subtitle)
						.font(.system(size: 11))
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
				Text(item.reason)
					.font(.system(size: 13))
					.foregroundStyle(AppTheme.secondaryText)
					.lineSpacing(2)
					.fixedSize(horizontal: false, vertical: true)
				actionBar
					.padding(.top, 4)
			}
		}
		.padding(.vertical, 10)
		.contentShape(Rectangle())
		.accessibilityElement(children: .contain)
		.accessibilityIdentifier("feed-item-\(item.id)")
	}

	private var actionBar: some View {
		HStack(spacing: 8) {
			ForEach(Array(actions.prefix(2).enumerated()), id: \.element.id) { index, action in
				actionButton(action, prominent: index == 0)
			}
			Spacer(minLength: 0)
			if actions.count > 2 || item.canDismiss {
				Menu {
					ForEach(actions.dropFirst(2)) { action in
						Button(action.label) { onPerform(action) }
					}
					if item.canDismiss {
						if actions.count > 2 { Divider() }
						Button("Dismiss", action: onDismiss)
							.accessibilityIdentifier("feed-dismiss-\(item.id)")
					}
				} label: {
					Image(systemName: "ellipsis")
						.font(.system(size: 11, weight: .semibold))
						.foregroundStyle(AppTheme.tertiaryText)
						.frame(width: 18, height: 18)
						.contentShape(Rectangle())
				}
				.menuStyle(.borderlessButton)
				.menuIndicator(.hidden)
				.fixedSize()
				.help("More")
				.accessibilityLabel("More actions")
			}
		}
	}

	@ViewBuilder
	private func actionButton(_ action: FeedAction, prominent: Bool) -> some View {
		let button = Button(action.label) { onPerform(action) }
			.controlSize(.small)
			.accessibilityIdentifier("feed-action-\(action.id)")
		if prominent {
			button.buttonStyle(.borderedProminent)
		} else {
			button.buttonStyle(.bordered)
		}
	}
}

enum FeedFormat {
	/// "in 20 min" / "2 hr ago"; nil when the timestamp can't be parsed.
	static func relativeTime(_ raw: String?, now: Date = Date()) -> String? {
		guard let date = DashboardDate.parse(raw) else { return nil }
		let formatter = RelativeDateTimeFormatter()
		formatter.unitsStyle = .abbreviated
		return formatter.localizedString(for: date, relativeTo: now)
	}
}
