import SwiftUI

/// Shared layout tokens for home-dashboard blocks (mail, tasks, calendar, flows).
enum DashboardBlockLayout {
	/// Maximum collapsed height. Short cards keep their intrinsic height.
	static let maximumCollapsedHeight: CGFloat = 340
	/// Soft fade over clipped body text (fully opaque at the bottom of the fade).
	static let showMoreFadeHeight: CGFloat = 40
	/// Solid control bar under the fade, overlaid on the card’s lower edge.
	static let showMoreButtonHeight: CGFloat = 36
	static var showMoreChromeHeight: CGFloat {
		showMoreFadeHeight + showMoreButtonHeight
	}

	/// Home card column cap (informational / built-in cards).
	static let cardsMaxWidth: CGFloat = 940
	/// Preferred / min / max width of the Actions inspector column.
	static let actionsRailDefaultWidth: CGFloat = 156
	static let actionsRailMinWidth: CGFloat = 120
	static let actionsRailMaxWidth: CGFloat = 280
	/// Home Actions tile (Shortcuts-style colored card). Width is the minimum;
	/// tiles stretch to fill equal columns in the inspector.
	static let actionTileWidth: CGFloat = 100
	static let actionTileHeight: CGFloat = 68
	static let actionTileCornerRadius: CGFloat = 16
	static let actionIconGridSpacing: CGFloat = 12

	static let cardPadding: CGFloat = 16
	static let headerSpacing: CGFloat = 14
	static let titleSize: CGFloat = 14
	static let titleWeight: Font.Weight = .semibold
	static let titleTracking: CGFloat = 0
}

/// When the Siri-style outline should appear without waiting for the soft delay.
enum DashboardIntelligenceOutlinePolicy {
	static func showsImmediately(isForceUpdating: Bool, hasBody: Bool) -> Bool {
		isForceUpdating || !hasBody
	}
}

/// Quiet bordered content panel matching the compact Home reference.
struct DashboardBlockChrome: ViewModifier {
	var systemImage: String? = nil
	var isExpanded: Bool = false

	func body(content: Content) -> some View {
		let shape = AppTheme.concentricRect(minimum: AppTheme.cornerRadius)
		content
			.background {
				shape.fill(AppTheme.contentBackground)
			}
			.compositingGroup()
			.clipShape(shape)
			.overlay {
				shape.stroke(AppTheme.separator, lineWidth: 1)
			}
			.containerShape(
				RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
			)
	}
}

extension View {
	func dashboardBlockChrome(
		systemImage: String? = nil,
		isExpanded: Bool = false,
		isUpdating: Bool = false
	) -> some View {
		modifier(
			DashboardBlockChrome(
				systemImage: systemImage,
				isExpanded: isExpanded
			)
		)
		.intelligenceOutline(
			isActive: isUpdating,
			cornerRadius: AppTheme.cornerRadius,
			accessibilityIdentifier: "dashboard-card-intelligence-outline"
		)
	}
}
