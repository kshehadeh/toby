import SwiftUI

/// Shared layout tokens for Home sections (The Feed, onboarding, Actions rail).
enum DashboardBlockLayout {
	/// Home content column cap (The Feed and onboarding).
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

/// Quiet bordered content panel matching the compact Home reference.
struct DashboardBlockChrome: ViewModifier {
	@Environment(\.dashboardBlockColor) private var blockColor
	var systemImage: String? = nil

	func body(content: Content) -> some View {
		let shape = AppTheme.concentricRect(minimum: AppTheme.cornerRadius)
		content
			.background {
				shape.fill(DashboardBlockColor.background(blockColor))
			}
			.compositingGroup()
			.clipShape(shape)
			.overlay {
				shape.stroke(DashboardBlockColor.border(blockColor), lineWidth: 1)
			}
			.containerShape(
				RoundedRectangle(cornerRadius: AppTheme.cornerRadius, style: .continuous)
			)
	}
}

extension View {
	func dashboardBlockChrome(
		systemImage: String? = nil,
		isUpdating: Bool = false
	) -> some View {
		modifier(DashboardBlockChrome(systemImage: systemImage))
		.intelligenceOutline(
			isActive: isUpdating,
			cornerRadius: AppTheme.cornerRadius,
			accessibilityIdentifier: "dashboard-card-intelligence-outline"
		)
	}
}
