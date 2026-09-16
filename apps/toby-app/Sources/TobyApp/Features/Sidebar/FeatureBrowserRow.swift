import SwiftUI

/// Shared workspace-list row chrome: title, optional subtitle/badge/trailing,
/// and a snapped selection wash. Leading glyphs stay identity-stable — do not
/// swap SF Symbol names or attach `contentTransition` on select.
struct FeatureBrowserRow<Leading: View, Trailing: View>: View {
	let title: String
	var subtitle: String? = nil
	var badge: String? = nil
	let isSelected: Bool
	var drawsSelectionFill = true
	var accessibilityLabel: String? = nil
	let accessibilityIdentifier: String
	let leading: Leading
	let trailing: Trailing

	init(
		title: String,
		subtitle: String? = nil,
		badge: String? = nil,
		isSelected: Bool,
		drawsSelectionFill: Bool = true,
		accessibilityLabel: String? = nil,
		accessibilityIdentifier: String,
		@ViewBuilder leading: () -> Leading,
		@ViewBuilder trailing: () -> Trailing
	) {
		self.title = title
		self.subtitle = subtitle
		self.badge = badge
		self.isSelected = isSelected
		self.drawsSelectionFill = drawsSelectionFill
		self.accessibilityLabel = accessibilityLabel
		self.accessibilityIdentifier = accessibilityIdentifier
		self.leading = leading()
		self.trailing = trailing()
	}

	var body: some View {
		HStack(spacing: FeatureBrowserMetrics.rowContentSpacing) {
			leading
			VStack(alignment: .leading, spacing: 2) {
				HStack(spacing: 6) {
					Text(title)
						.font(.callout.weight(.medium))
						.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
						.lineLimit(1)
					if let badge {
						Text(badge)
							.font(.system(size: 9, weight: .semibold))
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(.horizontal, 5)
							.padding(.vertical, 1)
							.background(
								Capsule()
									.fill(AppTheme.primaryText.opacity(0.08))
							)
					}
				}
				if let subtitle, !subtitle.isEmpty {
					Text(subtitle)
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
			}
			Spacer(minLength: 0)
			trailing
		}
		.padding(.vertical, FeatureBrowserMetrics.rowVerticalPadding)
		.padding(.horizontal, FeatureBrowserMetrics.rowHorizontalPadding)
		.contentShape(Rectangle())
		.background {
			if drawsSelectionFill {
				RoundedRectangle(cornerRadius: FeatureBrowserMetrics.rowCornerRadius)
					.fill(isSelected ? AppTheme.selection : Color.clear)
			}
		}
		// Selection must snap like a native list highlight — no wash fade or
		// symbol-replace when the leading glyph tint changes.
		.transaction { $0.disablesAnimations = true }
		.accessibilityElement(children: .combine)
		.accessibilityLabel(resolvedAccessibilityLabel)
		.accessibilityAddTraits(isSelected ? [.isSelected] : [])
		.accessibilityIdentifier(accessibilityIdentifier)
	}

	private var resolvedAccessibilityLabel: String {
		if let accessibilityLabel { return accessibilityLabel }
		var parts = [title]
		if let badge { parts.append(badge) }
		if let subtitle, !subtitle.isEmpty { parts.append(subtitle) }
		return parts.joined(separator: ", ")
	}
}

extension FeatureBrowserRow where Trailing == EmptyView {
	init(
		title: String,
		subtitle: String? = nil,
		badge: String? = nil,
		isSelected: Bool,
		drawsSelectionFill: Bool = true,
		accessibilityLabel: String? = nil,
		accessibilityIdentifier: String,
		@ViewBuilder leading: () -> Leading
	) {
		self.init(
			title: title,
			subtitle: subtitle,
			badge: badge,
			isSelected: isSelected,
			drawsSelectionFill: drawsSelectionFill,
			accessibilityLabel: accessibilityLabel,
			accessibilityIdentifier: accessibilityIdentifier,
			leading: leading,
			trailing: { EmptyView() }
		)
	}
}

/// Stable SF Symbol for a feature-browser row. Keep `systemImage` constant
/// across selected/unselected; only the tint changes.
struct FeatureBrowserRowGlyph: View {
	let systemImage: String
	let isSelected: Bool

	var body: some View {
		Image(systemName: systemImage)
			.font(.system(size: 14, weight: .semibold))
			.foregroundStyle(isSelected ? AppTheme.accent : AppTheme.tertiaryText)
			.frame(
				width: FeatureBrowserMetrics.glyphSize,
				height: FeatureBrowserMetrics.glyphSize
			)
			.accessibilityHidden(true)
	}
}
